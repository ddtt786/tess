/**
 * @fileoverview @tess/compiler 패키지 진입점
 * 
 * 추상 구문 트리(AST)를 분석하여 실제 실행 가능한 엔트리(Entry) 작품 형식으로 변환하는 모듈입니다.
 */
import { compileProject as compile } from "./src/index.ts";
import { loadProgram as load } from "./src/include.ts";
import { NODE_HOST } from "./src/node-host.ts";
import type { CompileOptions, CompileResult } from "./src/types.ts";

/**
 * Tess 소스를 엔트리 작품으로 컴파일합니다. 파일은 노드의 파일 시스템에서 읽습니다.
 *
 * 브라우저에서는 `src/index.ts` 의 `compileProject` 를 직접 부르고, 파일이 필요하면
 * `host` 옵션으로 읽을 곳을 넘깁니다.
 */
export function compileProject(source: string, options: CompileOptions = {}): CompileResult {
  return compile(source, { host: NODE_HOST, ...options });
}

export function loadProgram(input: Parameters<typeof load>[0]) {
  return load({ host: NODE_HOST, ...input });
}

export { createCompileCache } from "./src/index.ts";
export { NODE_HOST } from "./src/node-host.ts";
export type { CompilerHost } from "./src/host.ts";
export { makeEntryBundle, makeTar } from "./src/bundle.ts";
export { verifyEntryProject } from "./src/verify.ts";
export { BLOCK_PARAM_COUNTS } from "./src/block-params.ts";
export { assetFilename, fileUrlFor, imageSize, makeAsset } from "./src/assets.ts";
export { audioDuration } from "./src/audio.ts";
export { makeThumbnail, THUMB_BOX } from "./src/thumbnail.ts";
export type * from "./src/types.ts";
