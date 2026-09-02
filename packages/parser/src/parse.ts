/**
 * Tess 파서 공개 API
 */
import { parseSource, checkSource } from './parser/index.ts';
import type { StartRule } from './parser/index.ts';
import { lineAndColumn, validate } from './validate.ts';
import type { Diagnostic, ParseResult, ParseRoot, ProgramNode } from './ast.ts';

/** 
 * 파싱 수행 시 사용할 옵션을 정의합니다.
 */
export interface ParseOptions {
  validate?: boolean;
  startRule?: StartRule;
}

/** 
 * parseOrThrow 호출 시 파싱 또는 검증에 실패하면 발생하는 예외입니다. 
 * 파싱 중 발견된 에러와 경고를 포함합니다.
 */
export class TessParseError extends Error {
  errors: Diagnostic[];

  warnings: Diagnostic[];

  constructor(message: string, errors: Diagnostic[], warnings: Diagnostic[]) {
    super(message);
    this.name = 'TessParseError';
    this.errors = errors;
    this.warnings = warnings;
  }
}

/** 
 * Tess 소스 코드를 파싱하여 AST(추상 구문 트리)와 진단 결과를 반환합니다.
 * 
 * @param source 파싱할 소스 코드 문자열
 * @param options 파싱 옵션 (검증 여부, 시작 규칙 등)
 * @returns 파싱 성공 여부, AST, 에러 및 경고 목록을 포함하는 결과 객체
 * @example
 * const result = parse("var a = 1");
 * if (result.ok) {
 *   console.log(result.ast);
 * }
 */
export function parse(source: string, options: ParseOptions = {}): ParseResult {
  const { validate: runValidation = true, startRule } = options;
  const result = parseSource(source, { startRule });

  if (!result.ok) {
    const errors = result.errors.map((error) => ({
      ...lineAndColumn(source, error.offset),
      offset: error.offset,
      message: error.message,
      detail: error.detail,
    }));
    return {
      ok: false, ast: null, errors, warnings: [],
    };
  }

  const ast = result.ast!;
  if (!runValidation) {
    return {
      ok: true, ast, errors: [], warnings: [],
    };
  }

  const { errors, warnings } = validate(ast as ProgramNode, source);
  return {
    ok: errors.length === 0, ast, errors, warnings,
  };
}

/** 
 * 소스 코드를 파싱하며, 실패할 경우 예외를 던지고 성공 시 AST를 반환합니다.
 * 
 * @param source 파싱할 소스 코드 문자열
 * @param options 파싱 옵션
 * @returns 성공적으로 생성된 AST의 최상위 노드
 * @throws {TessParseError} 파싱 또는 검증 중 에러가 발생한 경우
 * @example
 * try {
 *   const ast = parseOrThrow("var a = 1");
 * } catch (e) {
 *   console.error(e.errors);
 * }
 */
export function parseOrThrow(source: string, options: ParseOptions = {}): ParseRoot {
  const result = parse(source, options);
  if (!result.ok) {
    const first = result.errors[0]!;
    throw new TessParseError(
      first.detail ?? `${first.line}:${first.column} ${first.message}`,
      result.errors,
      result.warnings,
    );
  }
  return result.ast!;
}

/** 
 * AST를 생성하지 않고 코드의 문법적 유효성만 빠르게 확인합니다.
 * 
 * @param source 검사할 소스 코드 문자열
 * @param startRule 시작할 파서 규칙
 * @returns 문법에 맞으면 true, 아니면 false
 * @example
 * const isValid = check("var a = 1");
 */
export function check(source: string, startRule?: StartRule): boolean {
  return checkSource(source, startRule);
}

export { validate, lineAndColumn };
