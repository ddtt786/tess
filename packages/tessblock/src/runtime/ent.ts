/**
 * @fileoverview Building an `.ent` — the file entry opens.
 *
 * The work is compiled the usual way, with every costume and sound behind a
 * url. Those files are then fetched, given the names entry stores them under,
 * and packed next to `project.json` in one tar.
 */
import { assetFilename, fileUrlFor } from '../../../compiler/src/assets.ts';
import type { EntryProject } from '../../../compiler/src/types.ts';
import type { CompileDiagnostic } from '../../../compiler/src/types.ts';
import { build } from './run.ts';
import { makeTar, type TarFile } from './tar.ts';

const THUMB_BOX = 96;

export interface EntResult {
  blob: Blob | null;
  errors: CompileDiagnostic[];
}

export async function buildEnt(source: string, name: string): Promise<EntResult> {
  const built = build(source, name);
  if (!built.project) return { blob: null, errors: built.errors };

  const project = structuredClone(built.project) as EntryProject;
  const files: TarFile[] = [];
  const packed = new Set<string>();

  for (const object of project.objects) {
    for (const picture of object.sprite.pictures ?? []) {
      await pack(picture as Packable, 'image', files, packed);
    }
    for (const sound of object.sprite.sounds ?? []) {
      await pack(sound as Packable, 'sound', files, packed);
    }
  }

  files.unshift({ name: 'temp/project.json', data: new TextEncoder().encode(JSON.stringify(project)) });
  return { blob: new Blob([makeTar(files)], { type: 'application/x-tar' }), errors: [] };
}

interface Packable {
  id: string;
  name: string;
  filename: string;
  fileurl: string;
  ext?: string;
  imageType?: string;
}

/** Fetches one file, renames it the way entry does, and adds it to the tar. */
async function pack(asset: Packable, kind: 'image' | 'sound', files: TarFile[], packed: Set<string>): Promise<void> {
  const source = asset.fileurl;
  if (!source) return;
  const bytes = await readBytes(source);
  if (!bytes) return;

  const ext = extensionOf(source, kind);
  const filename = assetFilename(`${kind}:${asset.id}:${asset.name}:${bytes.length}`);
  const target = fileUrlFor(kind, filename, ext);
  asset.filename = filename;
  asset.ext = ext;
  asset.fileurl = target;
  if (kind === 'image') asset.imageType = ext.slice(1);
  if (packed.has(target)) return;
  packed.add(target);
  files.push({ name: target, data: bytes });

  if (kind !== 'image' || ext === '.svg') return;
  const thumb = await makeThumbnail(bytes, ext);
  if (thumb) files.push({ name: target.replace('/image/', '/thumb/'), data: thumb });
}

async function readBytes(url: string): Promise<Uint8Array<ArrayBuffer> | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return new Uint8Array(await response.arrayBuffer());
  } catch {
    return null;
  }
}

function extensionOf(url: string, kind: 'image' | 'sound'): string {
  const data = /^data:([^;,]+)/i.exec(url)?.[1]?.toLowerCase();
  if (data) {
    const known: Record<string, string> = {
      'image/svg+xml': '.svg', 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif',
      'audio/mpeg': '.mp3', 'audio/mp3': '.mp3', 'audio/wav': '.wav', 'audio/x-wav': '.wav', 'audio/ogg': '.ogg',
    };
    return known[data] ?? (kind === 'image' ? '.png' : '.mp3');
  }
  const found = /\.([a-z0-9]+)(?:$|\?)/i.exec(url)?.[1]?.toLowerCase();
  return found ? `.${found}` : kind === 'image' ? '.png' : '.mp3';
}

/** Entry keeps a 96px preview beside every raster costume. */
async function makeThumbnail(bytes: Uint8Array<ArrayBuffer>, ext: string): Promise<Uint8Array<ArrayBuffer> | null> {
  try {
    const source = new Blob([bytes], { type: `image/${ext.slice(1)}` });
    const bitmap = await createImageBitmap(source);
    const scale = Math.min(THUMB_BOX / bitmap.width, THUMB_BOX / bitmap.height, 1);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  } catch {
    return null;
  }
}
