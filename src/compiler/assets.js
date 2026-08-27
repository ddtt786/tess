// ============================================================================
//  모양(그림) · 소리 리소스
//
//  엔트리는 리소스를 temp/<앞2자>/<다음2자>/image|sound/<파일명>.<확장자> 에 담고,
//  project.json 의 fileurl 이 그 경로를 가리킨다.
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { seedFrom } from './ids.js';

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

/** PNG · JPEG · GIF 헤더에서 원본 크기를 읽는다. 못 읽으면 null */
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
  return null;
}

/**
 * 선언된 파일을 실제로 찾아보고 엔트리 리소스 항목을 만든다.
 *
 * 파일을 못 찾아도 필요한 정보(모양은 `size W H`, 소리는 `for N`)를 코드에 적어 뒀으면
 * 그대로 쓰고 아무 말도 하지 않는다. 그림을 나중에 넣을 생각으로 구조부터 짜는 흐름을
 * 방해하지 않기 위해서다. 적어 두지도 않았고 파일도 없을 때만 경고한다.
 */
export function makeAsset(kind, { id, file, name, width, height, duration }, ctx, node) {
  const ext = path.extname(file).toLowerCase();
  const isImage = kind === 'image';

  if (isImage && !IMAGE_TYPES[ext]) ctx.warn(node, `'${file}' 은(는) 엔트리가 아는 이미지 형식이 아닙니다.`);
  if (!isImage && !SOUND_TYPES.has(ext)) ctx.warn(node, `'${file}' 은(는) 엔트리가 아는 소리 형식이 아닙니다.`);

  const resolved = findAsset(file, ctx);
  const declared = isImage ? Boolean(width && height) : duration !== null && duration !== undefined;
  let size = width && height ? { width, height } : null;
  let bytes = null;

  if (resolved) {
    bytes = fs.readFileSync(resolved);
    if (isImage && !size) size = imageSize(bytes);
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
    asset.duration = duration ?? 1;
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
