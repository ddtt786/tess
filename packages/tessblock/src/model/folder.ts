/**
 * @fileoverview Keeping the work in a folder on disk (File System Access API).
 *
 * The folder holds `project.tessproj` and an `assets/` folder with every costume
 * and sound as its own file. Once a folder is attached, each change is written
 * back to it; opening it again reads the work from there.
 */
import { signal } from '@preact/signals';
import { isAssetRef, resolveAsset, saveAsset } from './assets.ts';
import { loadEntFile } from './ent-import.ts';
import { project, replaceProject } from './store.ts';
import type { TessObject, TessProject } from './types.ts';

const PROJECT_FILE = 'project.tessproj';
const ASSET_DIR = 'assets';
const WRITE_DELAY_MS = 600;

/** Chrome and Edge only; the buttons stay hidden elsewhere. */
export const canUseFolders = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

/** The attached folder's name, and whether it still needs permission to be used. */
export const folderState = signal<{ name: string; connected: boolean } | null>(null);

let root: FileSystemDirectoryHandle | null = null;
let writeTimer: number | undefined;
let writing: Promise<void> = Promise.resolve();
/** Asset files already in the folder, so each is written once. */
const written = new Set<string>();
/** Where a reference read from the folder came from, so it is saved back to the same file. */
const pathOf = new Map<string, string>();
/** Set while a work read from the folder is being put in place, so it is not written straight back. */
let loading = false;

export type FolderResult = 'loaded' | 'imported' | 'created';

/** Asks for a folder and opens the work in it (or puts the current work there). */
export async function openFolder(): Promise<FolderResult> {
  const picker = (window as unknown as {
    showDirectoryPicker(options: { mode: 'readwrite'; id: string }): Promise<FileSystemDirectoryHandle>;
  }).showDirectoryPicker;
  const handle = await picker.call(window, { mode: 'readwrite', id: 'tessblock' });
  const result = await attach(handle);
  await storeHandle(handle);
  return result;
}

/** Asks for a folder and saves the current work into it, whatever the folder held. */
export async function saveIntoFolder(): Promise<void> {
  const picker = (window as unknown as {
    showDirectoryPicker(options: { mode: 'readwrite'; id: string }): Promise<FileSystemDirectoryHandle>;
  }).showDirectoryPicker;
  const handle = await picker.call(window, { mode: 'readwrite', id: 'tessblock' });
  root = handle;
  written.clear();
  pathOf.clear();
  folderState.value = { name: handle.name, connected: true };
  await storeHandle(handle);
  await saveFolderNow();
}

/** Writes the work to the attached folder now instead of after the usual pause. */
export async function saveFolderNow(): Promise<void> {
  if (writeTimer !== undefined) clearTimeout(writeTimer);
  writeTimer = undefined;
  const target = root;
  if (!target) return;
  writing = writing.then(() => writeWork(target, project.peek()));
  await writing;
}

/** Reattaches the folder used last time; the browser asks for permission again. */
export async function reconnectFolder(): Promise<FolderResult | null> {
  const handle = await storedHandle();
  if (!handle) return null;
  const permission = await (handle as unknown as {
    requestPermission(options: { mode: 'readwrite' }): Promise<PermissionState>;
  }).requestPermission({ mode: 'readwrite' });
  if (permission !== 'granted') return null;
  return attach(handle);
}

/** Stops writing to the folder; the work stays open. */
export function detachFolder(): void {
  root = null;
  written.clear();
  pathOf.clear();
  folderState.value = null;
  if (writeTimer !== undefined) clearTimeout(writeTimer);
  void storeHandle(null);
}

/** Shows the folder used last time, without touching it, so it can be reconnected. */
export async function restoreFolderState(): Promise<void> {
  if (!canUseFolders) return;
  const handle = await storedHandle().catch(() => null);
  if (handle) folderState.value = { name: handle.name, connected: false };
}

/** Works in the given folder: opens the work there, or puts the current one in it. */
export async function attach(handle: FileSystemDirectoryHandle): Promise<FolderResult> {
  root = handle;
  written.clear();
  pathOf.clear();
  folderState.value = { name: handle.name, connected: true };

  const saved = await readText(handle, PROJECT_FILE);
  if (saved) {
    const model = await fromFolder(JSON.parse(saved) as TessProject, handle);
    loading = true;
    try {
      replaceProject(model);
    } finally {
      loading = false;
    }
    return 'loaded';
  }
  for await (const entry of (handle as unknown as { values(): AsyncIterable<FileSystemHandle> }).values()) {
    if (entry.kind === 'file' && /\.ent$/i.test(entry.name)) {
      await loadEntFile(await (entry as FileSystemFileHandle).getFile());
      scheduleWrite(0);
      return 'imported';
    }
  }
  scheduleWrite(0);
  return 'created';
}

project.subscribe(() => {
  if (root && !loading) scheduleWrite(WRITE_DELAY_MS);
});

function scheduleWrite(delay: number): void {
  if (writeTimer !== undefined) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    writeTimer = undefined;
    const target = root;
    if (!target) return;
    // One write at a time; a later change waits for the one before it.
    writing = writing.then(() => writeWork(target, project.peek())).catch(() => {
      folderState.value = folderState.value && { ...folderState.value, connected: false };
    });
  }, delay) as unknown as number;
}

async function writeWork(folder: FileSystemDirectoryHandle, model: TessProject): Promise<void> {
  const objects: TessObject[] = [];
  for (const object of model.objects) {
    objects.push({
      ...object,
      costumes: await Promise.all(object.costumes.map(async (costume) => ({ ...costume, url: await toFile(folder, costume.url) }))),
      sounds: await Promise.all(object.sounds.map(async (sound) => ({ ...sound, url: await toFile(folder, sound.url) }))),
    });
  }
  await writeFile(folder, PROJECT_FILE, JSON.stringify({ ...model, objects }, null, 2));
}

/** An asset reference as a file under `assets/`, written the first time it is seen. */
async function toFile(folder: FileSystemDirectoryHandle, url: string): Promise<string> {
  if (!isAssetRef(url)) return url;
  const known = pathOf.get(url);
  if (known) return known;
  const dataUrl = resolveAsset(url);
  const parsed = /^data:([^;,]+)(;base64)?,/.exec(dataUrl);
  if (!parsed) return url;
  const path = `${ASSET_DIR}/${url.slice('asset:'.length)}.${extensionOf(parsed[1]!)}`;
  if (!written.has(path)) {
    const response = await fetch(dataUrl);
    await writeFile(folder, path, await response.blob());
    written.add(path);
  }
  return path;
}

/** Turns the folder's asset paths back into references the editor uses. */
async function fromFolder(model: TessProject, folder: FileSystemDirectoryHandle): Promise<TessProject> {
  const refs = new Map<string, Promise<string>>();
  const load = (url: string): Promise<string> => {
    if (!url.startsWith(`${ASSET_DIR}/`)) return Promise.resolve(url);
    if (!refs.has(url)) {
      refs.set(url, (async () => {
        const file = await readFile(folder, url);
        if (!file) return url;
        written.add(url);
        const ref = await saveAsset(await asDataUrl(file));
        pathOf.set(ref, url);
        return ref;
      })());
    }
    return refs.get(url)!;
  };
  const objects: TessObject[] = [];
  for (const object of model.objects ?? []) {
    objects.push({
      ...object,
      costumes: await Promise.all(object.costumes.map(async (costume) => ({ ...costume, url: await load(costume.url) }))),
      sounds: await Promise.all(object.sounds.map(async (sound) => ({ ...sound, url: await load(sound.url) }))),
    });
  }
  return { ...model, objects };
}

// --- files ------------------------------------------------------------------

async function directoryOf(folder: FileSystemDirectoryHandle, path: string, create: boolean) {
  const parts = path.split('/');
  const name = parts.pop()!;
  let dir = folder;
  for (const part of parts) dir = await dir.getDirectoryHandle(part, { create });
  return { dir, name };
}

async function writeFile(folder: FileSystemDirectoryHandle, path: string, data: string | Blob): Promise<void> {
  const { dir, name } = await directoryOf(folder, path, true);
  const handle = await dir.getFileHandle(name, { create: true });
  const stream = await (handle as unknown as {
    createWritable(): Promise<{ write(data: string | Blob): Promise<void>; close(): Promise<void> }>;
  }).createWritable();
  await stream.write(data);
  await stream.close();
}

async function readFile(folder: FileSystemDirectoryHandle, path: string): Promise<File | null> {
  try {
    const { dir, name } = await directoryOf(folder, path, false);
    return await (await dir.getFileHandle(name)).getFile();
  } catch {
    return null;
  }
}

async function readText(folder: FileSystemDirectoryHandle, path: string): Promise<string | null> {
  const file = await readFile(folder, path);
  return file ? file.text() : null;
}

function asDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/webp': 'webp',
  'image/bmp': 'bmp', 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav',
  'audio/ogg': 'ogg', 'audio/webm': 'webm',
};

function extensionOf(mime: string): string {
  return EXTENSIONS[mime.toLowerCase()] ?? 'bin';
}

// --- the folder used last time ------------------------------------------------

const HANDLE_DB = 'tessblock-folder';

function handleStore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(HANDLE_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('handles');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function storeHandle(handle: FileSystemDirectoryHandle | null): Promise<void> {
  try {
    const db = await handleStore();
    const store = db.transaction('handles', 'readwrite').objectStore('handles');
    if (handle) store.put(handle, 'root');
    else store.delete('root');
  } catch {
    // Not remembered; the folder can still be picked again.
  }
}

async function storedHandle(): Promise<FileSystemDirectoryHandle | null> {
  const db = await handleStore();
  return new Promise((resolve) => {
    const request = db.transaction('handles', 'readonly').objectStore('handles').get('root');
    request.onsuccess = () => resolve((request.result as FileSystemDirectoryHandle | undefined) ?? null);
    request.onerror = () => resolve(null);
  });
}
