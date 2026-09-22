/**
 * @fileoverview Where costumes and sounds are kept.
 *
 * The project itself only holds a reference (`asset:<id>`); the bytes live in
 * IndexedDB, which has room for real files. A copy stays in memory as a data
 * url, so the stage, the painter and the Tess writer can all read it without
 * waiting.
 */
const DATABASE = 'tessblock';
const STORE = 'assets';
const PREFIX = 'asset:';

const cache = new Map<string, string>();
/** Ids written a moment ago; the collector leaves these alone. */
const recent = new Map<string, number>();
const GRACE_MS = 60_000;
let database: IDBDatabase | null = null;

function open(): Promise<IDBDatabase> {
  if (database) return Promise.resolve(database);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => {
      database = request.result;
      resolve(database);
    };
    request.onerror = () => reject(request.error ?? new Error('자산 저장소를 열지 못했습니다.'));
  });
}

/** Reads every stored asset into memory. Call once, before the first render. */
export async function openAssets(): Promise<void> {
  try {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const store = db.transaction(STORE, 'readonly').objectStore(STORE);
      const request = store.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve();
          return;
        }
        if (typeof cursor.value === 'string') cache.set(String(cursor.key), cursor.value);
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
    });
  } catch {
    // No IndexedDB (private window, blocked storage): assets stay in memory
    // for this session only.
  }
}

export function isAssetRef(url: string): boolean {
  return url.startsWith(PREFIX);
}

/** The data url behind a reference, or the url itself when it is a plain one. */
export function resolveAsset(url: string): string {
  if (!isAssetRef(url)) return url;
  return cache.get(url.slice(PREFIX.length)) ?? '';
}

/** Keeps a file and hands back the reference the project stores. */
export async function saveAsset(dataUrl: string): Promise<string> {
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  cache.set(id, dataUrl);
  recent.set(id, Date.now());
  try {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readwrite');
      transaction.objectStore(STORE).put(dataUrl, id);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } catch {
    // Kept in memory only; the project still works until the page is closed.
  }
  return `${PREFIX}${id}`;
}

/** Throws away everything the project no longer points at. */
export async function keepOnly(references: Iterable<string>): Promise<void> {
  const wanted = new Set<string>();
  for (const reference of references) {
    if (isAssetRef(reference)) wanted.add(reference.slice(PREFIX.length));
  }
  // A file saved a moment ago may not be referenced yet — the costume it
  // belongs to is still being written.
  const now = Date.now();
  for (const [id, at] of recent) {
    if (now - at < GRACE_MS) wanted.add(id);
    else recent.delete(id);
  }
  for (const id of [...cache.keys()]) if (!wanted.has(id)) cache.delete(id);
  try {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const store = db.transaction(STORE, 'readwrite').objectStore(STORE);
      const request = store.getAllKeys();
      request.onsuccess = () => {
        for (const key of request.result) if (!wanted.has(String(key))) store.delete(key);
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  } catch {
    // Nothing kept, nothing to clean.
  }
}

/** Forgets an asset nothing points at any more. */
export async function dropAsset(url: string): Promise<void> {
  if (!isAssetRef(url)) return;
  const id = url.slice(PREFIX.length);
  cache.delete(id);
  try {
    const db = await open();
    db.transaction(STORE, 'readwrite').objectStore(STORE).delete(id);
  } catch {
    // Nothing to do: the reference is gone from the project either way.
  }
}
