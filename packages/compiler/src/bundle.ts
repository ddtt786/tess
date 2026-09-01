// ============================================================================
//  엔트리 작품 파일(.ent) 만들기
//
//  .ent 는 tar 묶음이고, 모든 내용이 temp/ 폴더 안에 들어간다.
//    temp/project.json
//    temp/<앞2자>/<다음2자>/image/<파일명>.png
//    temp/<앞2자>/<다음2자>/sound/<파일명>.mp3
//
//  담을 내용이 전부 메모리에 있어서(project.json 과 방금 만든 미리보기는 디스크에
//  없다) `tar.create` 대신 `tar.Header` 로 블록을 직접 쌓는다 — ustar 헤더의
//  자릿수와 체크섬은 그 패키지가 맡는다.
// ============================================================================
import fs from 'node:fs';
import { Header } from 'tar';
import { makeThumbnail } from './thumbnail.ts';
import type { AssetFile, EntryProject } from './types.ts';

/** One file on its way into the tar. */
interface TarEntry {
  name: string;
  data: Buffer;
}

const BLOCK_SIZE = 512;

function padding(size: number): Buffer {
  const remainder = size % BLOCK_SIZE;
  return remainder === 0 ? Buffer.alloc(0) : Buffer.alloc(BLOCK_SIZE - remainder);
}

/** tar 엔트리 하나의 헤더(512바이트) */
function header(name: string, size: number, mtime: Date): Buffer {
  const block = Buffer.alloc(BLOCK_SIZE);
  new Header({
    path: name, size, mtime, type: 'File', mode: 0o644, uid: 0, gid: 0,
  }).encode(block, 0);
  return block;
}

/** tar 바이트열로 묶는다 */
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
 * 컴파일 결과를 .ent 묶음 바이트열로 만든다.
 *
 * 미리보기를 그리는 동안 기다려야 해서 비동기다. `run` 은 이 일을 하지 않는다 —
 * 내려받기를 눌렀을 때만 부른다 (packages/player/src/server.ts).
 *
 * @param project compileProject() 가 만든 프로젝트 객체
 * @param assets  함께 담을 리소스 파일
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
