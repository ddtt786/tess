/**
 * 모양(그림) 및 소리 리소스 처리 모듈입니다.
 * 
 * 엔트리 프로젝트는 리소스를 `temp/<앞2자>/<다음2자>/image|sound/<파일명>.<확장자>` 경로에 저장하며,
 * `project.json`의 `fileurl` 속성이 이 경로를 가리킵니다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { seedFrom } from './ids.ts';
import { audioDuration } from './audio.ts';
import type { Node } from '@tess/parser';
import type { Context } from './context.ts';
import type { EntryAsset } from './types.ts';

/**
 * 이미지나 소리 파일의 크기 정보를 나타내는 인터페이스입니다.
 * 
 * @example
 * ```typescript
 * const size: Size = { width: 100, height: 100 };
 * ```
 */
interface Size {
  width: number;
  height: number;
}

/**
 * `costume` 또는 `sound` 선언에서 지정된 파일의 정보를 나타냅니다.
 * 
 * @example
 * ```typescript
 * const decl: AssetDecl = { id: 'abc', file: 'image.png', width: 100, height: 100 };
 * ```
 */
interface AssetDecl {
  id: string;
  file: string;
  name?: string | null;
  width?: number | null;
  height?: number | null;
  duration?: number | null;
}

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

const IMAGE_TYPES: Record<string, string> = { '.png': 'png', '.jpg': 'jpg', '.jpeg': 'jpg', '.gif': 'gif', '.svg': 'svg', '.bmp': 'bmp' };
const SOUND_TYPES = new Set(['.mp3', '.wav', '.ogg', '.m4a']);

/** 
 * 엔트리 리소스 파일명(32자)을 리소스의 키(내용/경로 등)를 기반으로 결정적으로 생성합니다.
 * 
 * @param key 파일명을 생성할 기준이 되는 문자열 키
 * @returns 32자 길이의 결정적인 영숫자 파일명
 * @example
 * ```typescript
 * const filename = assetFilename('image:my_image.png:1024');
 * ```
 */
export function assetFilename(key: string): string {
  let state = seedFrom(key) || 1;
  let name = '';
  for (let i = 0; i < 32; i += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    name += ALPHABET[state % ALPHABET.length];
  }
  return name;
}

/**
 * 주어진 리소스 정보를 바탕으로 엔트리 프로젝트 내의 파일 경로(`fileurl`)를 생성합니다.
 * 
 * @param kind 리소스의 종류 ('image' 또는 'sound')
 * @param filename 32자로 생성된 리소스 파일명
 * @param ext 리소스의 파일 확장자 (예: '.png', '.mp3')
 * @returns 엔트리 프로젝트 구조에 맞는 파일 경로 문자열
 * @example
 * ```typescript
 * const url = fileUrlFor('image', 'abcdefghijklmnopqrstuvwxyz012345', '.png');
 * // 'temp/ab/cd/image/abcdefghijklmnopqrstuvwxyz012345.png'
 * ```
 */
export function fileUrlFor(kind: string, filename: string, ext: string): string {
  return `temp/${filename.slice(0, 2)}/${filename.slice(2, 4)}/${kind}/${filename}${ext}`;
}

/** 
 * PNG, JPEG, GIF, SVG 파일의 바이너리 데이터에서 원본 이미지의 가로/세로 크기를 읽어옵니다.
 * 
 * @param buffer 이미지 파일의 바이너리 데이터
 * @returns 이미지의 크기 객체, 파싱할 수 없는 경우 `null`
 * @example
 * ```typescript
 * const buffer = fs.readFileSync('image.png');
 * const size = imageSize(buffer);
 * if (size) console.log(size.width, size.height);
 * ```
 */
export function imageSize(buffer: Buffer): Size | null {
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
 * SVG 파일의 바이너리 데이터에서 이미지의 가로/세로 크기를 읽어옵니다.
 * `width`/`height` 속성을 우선적으로 확인하며, 없는 경우 `viewBox` 속성을 사용하여 크기를 계산합니다.
 * 
 * @param buffer SVG 파일의 바이너리 데이터
 * @returns SVG 이미지의 크기 객체, 파싱할 수 없는 경우 `null`
 * @example
 * ```typescript
 * const buffer = Buffer.from('<svg width="100" height="200"></svg>');
 * const size = svgSize(buffer); // { width: 100, height: 200 }
 * ```
 */
function svgSize(buffer: Buffer): Size | null {
  const text = buffer.toString('utf-8');
  const tag = text.match(/<svg\b[^>]*>/i)?.[0];
  if (!tag) return null;

  const length = (attr: string): number | null => {
    const raw = tag.match(new RegExp(`\\b${attr}\\s*=\\s*["']([^"']+)["']`, 'i'))?.[1]?.trim();
    if (!raw) return null;
    const match = raw.match(/^([\d.]+)(px)?$/i); // % 나 다른 단위는 픽셀 크기를 못 정하니 무시한다
    const value = match ? Number(match[1]) : null;
    return value !== null && Number.isFinite(value) && value > 0 ? value : null;
  };

  const width = length('width');
  const height = length('height');
  if (width && height) return { width, height };

  const viewBox = tag.match(/\bviewBox\s*=\s*["']([^"']+)["']/i)?.[1];
  if (viewBox) {
    const parts = viewBox.trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts.every(Number.isFinite) && parts[2]! > 0 && parts[3]! > 0) {
      return { width: parts[2]!, height: parts[3]! };
    }
  }
  return null;
}

/**
 * 선언된 리소스 파일을 실제 시스템에서 찾아 엔트리 프로젝트용 리소스 객체를 생성합니다.
 * 파일이 존재하는 경우 파일에서 직접 크기나 길이를 측정하며, 명시적으로 선언된 `size`나 `for` 값이 있으면 그 값을 우선합니다.
 * 파일을 찾을 수 없고 선언된 정보도 없을 경우에만 경고를 발생시킵니다.
 * 
 * @param kind 리소스의 종류 ('image' 또는 'sound')
 * @param decl 리소스 선언 정보 객체
 * @param ctx 컴파일러 컨텍스트
 * @param node 원본 AST 노드 (경고 발생 시 위치 정보용)
 * @returns 생성된 엔트리 에셋 객체
 * @example
 * ```typescript
 * const asset = makeAsset('image', { id: 'img1', file: 'cat.png' }, ctx, node);
 * ```
 */
export function makeAsset(
  kind: 'image' | 'sound',
  { id, file, name, width, height, duration }: AssetDecl,
  ctx: Context,
  node: Node,
): EntryAsset {
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
  const asset: EntryAsset = {
    id,
    name: name ?? path.basename(file),
    filename,
    fileurl: fileUrlFor(kind, filename, ext),
    ext,
  };

  if (isImage) {
    asset.imageType = IMAGE_TYPES[ext] ?? 'png';
    asset.dimension = { width: size!.width, height: size!.height };
    delete asset.ext;
  } else {
    asset.duration = seconds ?? 1;
  }

  if (resolved) ctx.assetFiles.push({ source: resolved, target: asset.fileurl });
  return asset;
}

/** 
 * 소스 파일과 같은 디렉터리 또는 컴파일 옵션으로 지정된 에셋 디렉터리들에서 파일을 찾습니다.
 * 
 * @param file 찾을 파일의 상대 경로
 * @param ctx 컴파일러 컨텍스트
 * @returns 찾은 파일의 절대 경로, 찾지 못한 경우 `null`
 * @example
 * ```typescript
 * const path = findAsset('image.png', ctx);
 * ```
 */
function findAsset(file: string, ctx: Context): string | null {
  for (const dir of ctx.options.assetDirs ?? []) {
    const candidate = path.resolve(dir, file);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}
