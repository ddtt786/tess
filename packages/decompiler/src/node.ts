/**
 * @fileoverview The parts of decompiling that need a filesystem.
 *
 * Everything else in this package runs anywhere, so the entry that reads a
 * `.ent` and the lookup of entry's own bundled costumes live here on their own
 * and are handed in to the portable core.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findLocalRuntime } from '@tess/player';
import { readTar } from './tar.ts';
import { decompileProject } from './index.ts';
import type { DecompileOptions, DecompileResult } from './types.ts';

// 엔트리 기본 오브젝트의 모양·소리는 작품 파일에 없고, 실행기가 함께 배포하는 파일을
// 가리키기만 한다. 설치된 entryjs 에서 실제 파일을 꺼내 assets/ 에 담는다.
// 폴더 이름은 엔트리 버전에 따라 entry-js 이거나 entryjs 다.
const BUILTIN_ASSET = /(?:^|\/)bower_components\/[^/]+\/(images\/[^?#]+)$/;

/** entryjs 를 작업 폴더에서 먼저 찾고, 없으면 tess 가 설치된 곳에서 찾는다 */
function findRuntimeDir(): string | null {
  return findLocalRuntime() ?? findLocalRuntime(path.dirname(fileURLToPath(import.meta.url)));
}

/** 엔트리 번들에 들어 있는 기본 리소스의 실제 바이트열. 못 찾으면 null */
export function builtinAssets(): (fileurl: string) => Uint8Array | null {
  let dir: string | null | undefined;
  return (fileurl) => {
    const match = BUILTIN_ASSET.exec(fileurl ?? '');
    if (!match) return null;
    if (dir === undefined) dir = findRuntimeDir();
    if (!dir) return null;
    // 남의 작품에서 온 경로라 패키지 바깥을 가리키면 읽지 않는다
    if (match[1]!.split('/').includes('..')) return null;
    const file = path.join(dir, match[1]!);
    return fs.existsSync(file) && fs.statSync(file).isFile() ? fs.readFileSync(file) : null;
  };
}

/**
 * 주어진 엔트리 파일(.ent) 바이트 배열을 파싱하여 Tess 소스 코드로 디컴파일합니다.
 *
 * @param bytes 엔트리 작품 파일의 바이트 데이터
 * @param options 디컴파일 옵션
 * @returns 디컴파일 결과 객체를 포함하는 Promise
 * @example
 * const result = await decompileEnt(buffer, { sizes: true });
 */
export async function decompileEnt(
  bytes: Buffer,
  options: DecompileOptions = {},
): Promise<DecompileResult> {
  const entries = await readTar(bytes);
  const projectEntry = entries.find((e) => e.name.endsWith('project.json'));
  if (!projectEntry) {
    throw new Error('project.json 을 찾지 못했습니다 — .ent(엔트리 작품) 파일이 맞는지 확인하세요.');
  }
  const project = JSON.parse(new TextDecoder('utf-8').decode(projectEntry.data));
  return decompileProject(project, entries, { builtinAssets: builtinAssets(), ...options });
}
