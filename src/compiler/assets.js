// ============================================================================
//  모양(그림) · 소리 리소스
//
//  엔트리는 리소스를 temp/<앞2자>/<다음2자>/image|sound/<파일명>.<확장자> 에 담고,
//  project.json 의 fileurl 이 그 경로를 가리킨다.
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { seedFrom } from './ids.js';
import { audioDuration } from './audio.js';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

const IMAGE_TYPES = { '.png': 'png', '.jpg': 'jpg', '.jpeg': 'jpg', '.gif': 'gif', '.svg': 'svg', '.bmp': 'bmp' };
const SOUND_TYPES = new Set(['.mp3', '.wav', '.ogg', '.m4a']);

/** 엔트리 리소스 파일명(32자)을 내용/경로에서 결정적으로 만든다 */
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

/** PNG · JPEG · GIF · SVG 에서 원본 크기를 읽는다. 못 읽으면 null */
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
 * SVG 는 매직 바이트가 없는 XML 텍스트라 PNG/GIF/JPEG 처럼 헤더를 읽을 수 없다.
 * 그렇다고 크기를 못 읽으면(예전엔 그랬다) makeAsset 이 무조건 100x100 으로 대체하는데,
 * 엔트리는 project.json 의 dimension 값을 그대로 믿고 렌더링 크기를 정한다(entryjs
 * entity.js setImage: `this.setWidth(dimension.width)`) — 실제로 로드한 이미지 픽셀 크기를
 * 다시 재서 쓰지 않는다. 그래서 SVG 원본이 100x100 이 아닌데(예: 무대 전체를 덮는 배경
 * 그림) scale_x/scale_y 가 그 원본 크기 기준으로 정해져 있으면(디컴파일한 소스가 그렇다),
 * 100x100 을 기준으로 다시 스케일된 결과가 원래 크기보다 훨씬 작게 나온다 — 예를 들어
 * 원본이 800x490 인데 100x100 으로 잘못 알면, scale_x 61% 로 정확히 488px(무대 폭에 맞춘 값)가
 * 나와야 할 것이 61px 밖에 안 되는 식이다. `width`/`height` 속성을 우선 쓰고, 없으면
 * `viewBox` 의 폭·높이를 쓴다(브라우저가 SVG 고유 크기를 정하는 순서와 같다).
 */
function svgSize(buffer) {
  const text = buffer.toString('utf-8');
  const tag = text.match(/<svg\b[^>]*>/i)?.[0];
  if (!tag) return null;

  const length = (attr) => {
    const raw = tag.match(new RegExp(`\\b${attr}\\s*=\\s*["']([^"']+)["']`, 'i'))?.[1]?.trim();
    if (!raw) return null;
    const match = raw.match(/^([\d.]+)(px)?$/i); // % 나 다른 단위는 픽셀 크기를 못 정하니 무시한다
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
 * 선언된 파일을 실제로 찾아보고 엔트리 리소스 항목을 만든다.
 *
 * 파일을 찾으면 그림은 크기를, 소리는 재생 길이를 파일에서 직접 잰다. 엔트리는
 * project.json 에 적힌 값을 그대로 믿고 쓰므로(모양은 화면에 그릴 크기, 소리는 목록에
 * 보여 줄 길이), 이 값을 구하지 못하면 100×100 과 1초로 굳어 버린다. 코드에
 * `size W H` 나 `for N` 을 적어 두었으면 그 값을 먼저 쓴다.
 *
 * 파일을 못 찾아도 그 정보를 코드에 적어 뒀으면 그대로 쓰고 아무 말도 하지 않는다.
 * 그림을 나중에 넣을 생각으로 구조부터 짜는 흐름을 방해하지 않기 위해서다.
 * 적어 두지도 않았고 파일도 없을 때만 경고한다.
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

/** 소스 파일 옆(또는 --assets 로 지정한 곳)에서 리소스를 찾는다 */
function findAsset(file, ctx) {
  for (const dir of ctx.options.assetDirs ?? []) {
    const candidate = path.resolve(dir, file);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}
