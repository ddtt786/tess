// Costume (image) and sound resources.
//
// Entry stores resources at temp/<first2>/<next2>/image|sound/<filename>.<ext>,
// and project.json's fileurl points at that path.
import fs from 'node:fs';
import path from 'node:path';
import { seedFrom } from './ids.js';
import { audioDuration } from './audio.js';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

const IMAGE_TYPES = { '.png': 'png', '.jpg': 'jpg', '.jpeg': 'jpg', '.gif': 'gif', '.svg': 'svg', '.bmp': 'bmp' };
const SOUND_TYPES = new Set(['.mp3', '.wav', '.ogg', '.m4a']);

/** Deterministically derives a 32-char Entry resource filename from a key. */
export function assetFilename(key) {
  let state = seedFrom(key) || 1;
  let name = '';
  for (let i = 0; i < 32; i += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    name += ALPHABET[state % ALPHABET.length];
  }
  return name;
}

export function fileUrlFor(kind, filename, ext) {
  return `temp/${filename.slice(0, 2)}/${filename.slice(2, 4)}/${kind}/${filename}${ext}`;
}

/** Reads intrinsic size from PNG, JPEG, GIF, or SVG data; null if unreadable. */
export function imageSize(buffer) {
  if (buffer.length >= 24 && buffer.readUInt32BE(0) === 0x89504e47) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (buffer.length >= 10 && buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
    return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
  }
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) { offset += 1; continue; }
      const marker = buffer[offset + 1];
      const length = buffer.readUInt16BE(offset + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
      }
      offset += 2 + length;
    }
  }
  if (buffer.includes('<svg')) return svgSize(buffer);
  return null;
}

/**
 * SVG has no magic bytes, so its size can't be read from a header like
 * PNG/GIF/JPEG. If unreadable, makeAsset falls back to 100x100, but Entry
 * trusts project.json's dimension value verbatim for render size (entryjs
 * entity.js setImage: `this.setWidth(dimension.width)`) rather than
 * re-measuring the loaded image's pixel size. So when a non-square SVG's
 * scale_x/scale_y were set relative to its true size (as in decompiled
 * source), a wrong 100x100 fallback scales the render far smaller than
 * intended — e.g. an 800x490 original misread as 100x100 renders scale_x
 * 61% as 61px instead of the intended 488px. Prefers the `width`/`height`
 * attributes, falling back to `viewBox`, matching how browsers derive an
 * SVG's intrinsic size.
 */
function svgSize(buffer) {
  const text = buffer.toString('utf-8');
  const tag = text.match(/<svg\b[^>]*>/i)?.[0];
  if (!tag) return null;

  const length = (attr) => {
    const raw = tag.match(new RegExp(`\\b${attr}\\s*=\\s*["']([^"']+)["']`, 'i'))?.[1]?.trim();
    if (!raw) return null;
    const match = raw.match(/^([\d.]+)(px)?$/i); // ignore % or other units — can't resolve to pixels
    const value = match && Number(match[1]);
    return Number.isFinite(value) && value > 0 ? value : null;
  };

  const width = length('width');
  const height = length('height');
  if (width && height) return { width, height };

  const viewBox = tag.match(/\bviewBox\s*=\s*["']([^"']+)["']/i)?.[1];
  if (viewBox) {
    const parts = viewBox.trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts.every(Number.isFinite) && parts[2] > 0 && parts[3] > 0) {
      return { width: parts[2], height: parts[3] };
    }
  }
  return null;
}

/**
 * Resolves a declared file and builds the Entry resource entry.
 *
 * When the file is found, measures image size / sound duration directly
 * from it. Entry trusts project.json's values verbatim, so an unmeasurable
 * asset falls back to 100x100 / 1s. Explicit `size W H` / `for N` take
 * priority. Warns only when the file is missing and nothing was declared.
 */
export function makeAsset(kind, { id, file, name, width, height, duration }, ctx, node) {
  const ext = path.extname(file).toLowerCase();
  const isImage = kind === 'image';

  if (isImage && !IMAGE_TYPES[ext]) ctx.warn(node, `'${file}' 은(는) 엔트리가 아는 이미지 형식이 아닙니다.`);
  if (!isImage && !SOUND_TYPES.has(ext)) ctx.warn(node, `'${file}' 은(는) 엔트리가 아는 소리 형식이 아닙니다.`);

  const resolved = findAsset(file, ctx);
  const declared = isImage ? Boolean(width && height) : duration !== null && duration !== undefined;
  let size = width && height ? { width, height } : null;
  let seconds = duration ?? null;
  let bytes = null;

  if (resolved) {
    bytes = fs.readFileSync(resolved);
    if (isImage && !size) size = imageSize(bytes);
    if (!isImage && seconds === null) seconds = audioDuration(bytes, ext);
  } else if (!declared) {
    const hint = isImage ? `size ${'가로'} ${'세로'}` : 'for 초';
    ctx.warn(node, `리소스 파일 '${file}' 을(를) 찾지 못했습니다. 경로만 기록합니다. (${hint} 를 적어 두면 이 알림이 사라집니다)`);
  }
  if (isImage && !size) size = { width: 100, height: 100 };

  const filename = assetFilename(`${kind}:${file}:${bytes ? bytes.length : 0}`);
  const asset = {
    id,
    name: name ?? path.basename(file),
    filename,
    fileurl: fileUrlFor(kind, filename, ext),
    ext,
  };

  if (isImage) {
    asset.imageType = IMAGE_TYPES[ext] ?? 'png';
    asset.dimension = { width: size.width, height: size.height };
    delete asset.ext;
  } else {
    asset.duration = seconds ?? 1;
  }

  if (resolved) ctx.assetFiles.push({ source: resolved, target: asset.fileurl });
  return asset;
}

/** Looks for the resource next to the source file, or under --assets dirs. */
function findAsset(file, ctx) {
  for (const dir of ctx.options.assetDirs ?? []) {
    const candidate = path.resolve(dir, file);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}
