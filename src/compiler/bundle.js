// ============================================================================
//  엔트리 작품 파일(.ent) 만들기
//
//  .ent 는 tar 묶음이고, 모든 내용이 temp/ 폴더 안에 들어간다.
//    temp/project.json
//    temp/<앞2자>/<다음2자>/image/<파일명>.png
//    temp/<앞2자>/<다음2자>/sound/<파일명>.mp3
//
//  의존성 없이 쓰기 위해 ustar 헤더를 직접 만든다.
// ============================================================================
import fs from 'node:fs';

const BLOCK_SIZE = 512;

/** tar 엔트리 하나의 헤더(512바이트) */
function header(name, size, mtime) {
  const buffer = Buffer.alloc(BLOCK_SIZE);
  const write = (text, offset, length) => buffer.write(String(text), offset, length, 'utf-8');
  const octal = (value, length) => `${value.toString(8).padStart(length - 1, '0')}\0`;

  if (Buffer.byteLength(name) > 100) throw new Error(`tar 경로가 너무 깁니다: ${name}`);
  write(name, 0, 100);
  write(octal(0o644, 8), 100, 8);   // mode
  write(octal(0, 8), 108, 8);       // uid
  write(octal(0, 8), 116, 8);       // gid
  write(octal(size, 12), 124, 12);
  write(octal(mtime, 12), 136, 12);
  write('        ', 148, 8);        // 체크섬 자리는 공백으로 두고 계산한다
  write('0', 156, 1);               // typeflag: 일반 파일
  write('ustar\0', 257, 6);
  write('00', 263, 2);

  let checksum = 0;
  for (const byte of buffer) checksum += byte;
  write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8);
  return buffer;
}

function padding(size) {
  const remainder = size % BLOCK_SIZE;
  return remainder === 0 ? Buffer.alloc(0) : Buffer.alloc(BLOCK_SIZE - remainder);
}

/**
 * @param {Array<{name: string, data: Buffer}>} entries
 * @returns {Buffer} tar 바이트열
 */
export function makeTar(entries) {
  const mtime = Math.floor(Date.now() / 1000);
  const chunks = [];
  for (const { name, data } of entries) {
    chunks.push(header(name, data.length, mtime), data, padding(data.length));
  }
  chunks.push(Buffer.alloc(BLOCK_SIZE * 2)); // 끝을 알리는 빈 블록 두 개
  return Buffer.concat(chunks);
}

/**
 * 컴파일 결과를 .ent 묶음 바이트열로 만든다.
 *
 * @param {object} project compileProject() 가 만든 프로젝트 객체
 * @param {Array<{source: string, target: string}>} assets 함께 담을 리소스 파일
 */
export function makeEntryBundle(project, assets = []) {
  const entries = [{
    name: 'temp/project.json',
    data: Buffer.from(JSON.stringify(project), 'utf-8'),
  }];

  const packed = new Set();
  for (const asset of assets) {
    if (packed.has(asset.target)) continue;
    packed.add(asset.target);
    entries.push({ name: asset.target, data: fs.readFileSync(asset.source) });
  }
  return makeTar(entries);
}
