/**
 * @fileoverview 엔트리 작품 파일(.ent)을 생성하는 모듈입니다.
 * 
 * .ent 파일은 tar 포맷으로 압축되며, 모든 데이터는 temp/ 디렉토리 내부에 저장됩니다:
 * - temp/project.json
 * - temp/<앞2자>/<다음2자>/image/<파일명>.png
 * - temp/<앞2자>/<다음2자>/sound/<파일명>.mp3
 * 
 * 데이터를 디스크에 저장하지 않고 모두 메모리에서 처리합니다.
 * `tar.create` 대신 `tar.Header`를 이용해 블록을 직접 구성하여 성능을 최적화합니다.
 */
import fs from 'node:fs';
import { Header } from 'tar';
import { makeThumbnail } from './thumbnail.ts';
import type { AssetFile, EntryProject } from './types.ts';

/** 
 * tar 파일에 포함될 단일 파일의 정보입니다.
 * @example
 * const entry: TarEntry = { name: 'temp/project.json', data: Buffer.from('{...}') };
 */
interface TarEntry {
  name: string;
  data: Buffer;
}

const BLOCK_SIZE = 512;

function padding(size: number): Buffer {
  const remainder = size % BLOCK_SIZE;
  return remainder === 0 ? Buffer.alloc(0) : Buffer.alloc(BLOCK_SIZE - remainder);
}

/** 
 * tar 항목의 512바이트 크기 헤더 버퍼를 생성합니다.
 * @example
 * const headerBuffer = header('temp/file.txt', 1024, new Date());
 */
function header(name: string, size: number, mtime: Date): Buffer {
  const block = Buffer.alloc(BLOCK_SIZE);
  new Header({
    path: name, size, mtime, type: 'File', mode: 0o644, uid: 0, gid: 0,
  }).encode(block, 0);
  return block;
}

/** 
 * 여러 파일 항목을 하나의 tar 바이트열로 압축합니다.
 * @example
 * const tarBuffer = makeTar([{ name: 'test.txt', data: Buffer.from('hello') }]);
 */
export function makeTar(entries: TarEntry[]): Buffer {
  const mtime = new Date();
  const chunks: Buffer[] = [];
  for (const { name, data } of entries) {
    chunks.push(header(name, data.length, mtime), data, padding(data.length));
  }
  chunks.push(Buffer.alloc(BLOCK_SIZE * 2)); // 끝을 알리는 빈 블록 두 개
  return Buffer.concat(chunks);
}

/**
 * 컴파일된 프로젝트 데이터와 리소스 파일들을 .ent 포맷의 tar 바이트열로 변환합니다.
 * 미리보기를 생성하는 과정이 포함되어 있어 비동기적으로 동작합니다.
 * 
 * @param project - 컴파일이 완료된 엔트리 프로젝트 객체
 * @param assets - 프로젝트에 포함할 추가 리소스 파일 목록
 * @returns 생성된 .ent 파일의 버퍼 객체
 * @example
 * const bundleBuffer = await makeEntryBundle(myProject, myAssets);
 */
export async function makeEntryBundle(
  project: EntryProject,
  assets: AssetFile[] = [],
): Promise<Buffer> {
  const entries: TarEntry[] = [{
    name: 'temp/project.json',
    data: Buffer.from(JSON.stringify(project), 'utf-8'),
  }];

  const packed = new Set<string>();
  const pending: Array<{ index: number; name: string; data: Buffer }> = [];
  for (const asset of assets) {
    if (packed.has(asset.target)) continue;
    packed.add(asset.target);
    const data = fs.readFileSync(asset.source);
    const index = entries.push({ name: asset.target, data }) - 1;

    // 그림은 미리보기도 같이 담는다 — 엔트리 편집기의 오브젝트·모양 목록이 이걸
    // 쓰고, 실제 작품 파일도 image/ 옆에 thumb/ 를 나란히 갖고 있다.
    const thumbName = asset.target.replace('/image/', '/thumb/');
    if (thumbName === asset.target || packed.has(thumbName)) continue;
    packed.add(thumbName);
    pending.push({ index, name: thumbName, data });
  }

  // 미리보기는 서로 상관이 없으니 한꺼번에 그린다.
  const thumbs = await Promise.all(pending.map(({ data }) => makeThumbnail(data)));

  // 원본 바로 뒤에 미리보기가 오도록, 뒤에서부터 끼워 넣는다.
  for (let i = pending.length - 1; i >= 0; i -= 1) {
    const thumb = thumbs[i];
    if (!thumb) continue; // SVG 처럼 못 그리는 형식은 엔트리도 미리보기를 안 만든다
    entries.splice(pending[i]!.index + 1, 0, { name: pending[i]!.name, data: thumb });
  }
  return makeTar(entries);
}
