/**
 * @fileoverview @tess/parser 패키지 진입점
 * 
 * Tess 소스 코드를 토큰(Token)으로 분해하고, 구문 트리(CST, AST)를 생성하며, 의미론적(Semantic) 검사를 수행하는 모듈입니다.
 */
export { parse, parseOrThrow, check, validate, lineAndColumn } from "./src/parse.ts";
export { lineIndex } from "./src/validate.ts";
export { KEYWORDS, UNUSABLE_AS_NAME } from "./src/parser/tokens.ts";
export { TessParseError } from "./src/parse.ts";
export type { ParseOptions } from "./src/parse.ts";
export type { StartRule } from "./src/parser/index.ts";
export type * from "./src/ast.ts";
