/**
 * @fileoverview @tess/decompiler 패키지 진입점
 * 
 * 엔트리(Entry) 작품을 분석하여 사람이 읽을 수 있는 형태의 Tess 소스 코드로 복원(역컴파일)하는 모듈입니다.
 */
import { decompileProject as decompile } from "./src/index.ts";
import { builtinAssets } from "./src/node.ts";
import type { DecompileOptions, DecompileResult, RawEntity, TarEntry } from "./src/types.ts";

/**
 * 엔트리 작품 데이터를 Tess 소스로 되돌립니다. 엔트리가 함께 배포하는 기본 모양은
 * 설치된 entryjs 에서 꺼냅니다.
 *
 * 브라우저에서는 `src/index.ts` 의 `decompileProject` 를 직접 부릅니다.
 */
export function decompileProject(
  project: RawEntity,
  entries: TarEntry[],
  options: DecompileOptions = {},
): DecompileResult {
  return decompile(project, entries, { builtinAssets: builtinAssets(), ...options });
}

export { decompileEnt } from "./src/node.ts";
export { readTar } from "./src/tar.ts";
export type * from "./src/types.ts";
