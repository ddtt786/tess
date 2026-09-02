/**
 * @fileoverview 파서 진입점(Entry point) 모듈입니다.
 * 
 * 외부 모듈이 파서의 세부 구현(렉서, 파서, 방문자 등)을 직접 다루지 않고,
 * 단순히 소스 코드를 구문 분석하고 결과를 확인할 수 있도록 래핑된 API를 제공합니다.
 * 에러 발생 시 CLI에서 쉽게 라인 및 컬럼을 추적할 수 있도록 오프셋 기반의 실패 정보를 반환합니다.
 */
import { EOF } from 'chevrotain';
import type { CstNode, ILexingError, IRecognitionException, IToken } from 'chevrotain';
import { codeFrameColumns } from '@babel/code-frame';
import { tokenize } from './tokens.ts';
import { parser } from './parser.ts';
import { toAst } from './visitor.ts';
import type { ParseRoot } from '../ast.ts';

/**
 * 구문 분석을 시작할 수 있는 시작 규칙(Start Rule) 이름의 타입입니다.
 * 언어 명세(Language Reference)에서 정의된 이름과 동일하게 사용합니다.
 */
export type StartRule = 'Program' | 'SceneFragment' | 'ObjectFragment' | 'Statement' | 'Expr';

/**
 * 구문 분석 실패 시 반환되는 에러 정보 객체입니다.
 * 실패한 위치(오프셋)와 에러 메시지를 포함하며, 추가적인 세부 정보가 있을 수 있습니다.
 */
export interface ParseFailure {
  offset: number;
  message: string;
  detail: string | null;
}

/** 
 * 시작 규칙 이름과 실제 파서 내의 구현 규칙을 매핑하는 객체입니다.
 */
const START_RULES: Record<string, string> = {
  Program: 'program',
  SceneFragment: 'sceneFragment',
  ObjectFragment: 'objectFragment',
  Statement: 'statement',
  Expr: 'expr',
};

/**
 * 주어진 시작 규칙에 해당하는 실제 파서 규칙 이름을 반환합니다.
 *
 * @param startRule - 구문 분석의 시작 규칙
 * @returns 매핑된 파서 규칙 이름 문자열
 */
function ruleFor(startRule: StartRule | undefined): string {
  const rule = START_RULES[startRule ?? 'Program'];
  if (!rule) throw new Error(`알 수 없는 시작 규칙입니다: ${startRule}`);
  return rule;
}

/**
 * 구문 분석 중 실패가 발생한 위치(오프셋)를 계산합니다.
 * 토큰이 존재하지 않을 경우 소스의 끝 길이를 반환합니다.
 *
 * @param source - 원본 소스 코드 문자열
 * @param token - 실패한 위치에 해당하는 토큰
 * @returns 오프셋(offset) 번호
 */
const offsetOf = (source: string, token: IToken | undefined) => (
  token && Number.isInteger(token.startOffset) && token.startOffset >= 0
    ? token.startOffset
    : source.length
);

/**
 * 실패한 코드 라인을 사용자에게 시각적으로 보여주는 프레임을 생성합니다.
 * 소스 코드 일부를 자르고 꺾쇠 기호 등을 이용해 에러 위치를 가리킵니다.
 *
 * @param source - 원본 소스 코드 문자열
 * @param offset - 에러 발생 오프셋
 * @param message - 에러 메시지
 * @returns 시각적인 코드 프레임 문자열
 */
function frame(source: string, offset: number, message: string): string {
  const upto = source.slice(0, offset);
  const line = upto.split('\n').length;
  const column = offset - (upto.lastIndexOf('\n') + 1) + 1;
  return codeFrameColumns(source, { start: { line, column } }, { message });
}

const failure = (source: string, offset: number, message: string): ParseFailure => ({
  offset,
  message,
  detail: frame(source, offset, message),
});

/** 
 * 렉서(어휘 분석) 실패 또는 파서(구문 분석) 실패를 통합하여 나타내는 타입입니다.
 */
type LexOrParseError = (ILexingError & { token?: undefined }) | (IRecognitionException & { offset?: undefined });

/**
 * 렉서나 파서에서 발생한 내부 에러 객체를 사용자가 읽기 쉬운 CLI 출력 형태(`ParseFailure`)로 변환합니다.
 *
 * @param source - 원본 소스 코드 문자열
 * @param error - 내부 에러 객체
 * @returns 표준 포맷팅된 실패 객체
 */
function toFailure(source: string, error: LexOrParseError): ParseFailure {
  if (error.offset !== undefined) {
    const character = JSON.stringify(source[error.offset] ?? '');
    return failure(source, error.offset, `읽을 수 없는 글자입니다: ${character}`);
  }
  return failure(source, offsetOf(source, error.token), error.message);
}

/**
 * 전달받은 소스 코드 텍스트를 파싱하여 AST(추상 구문 트리)를 생성합니다.
 *
 * @param source - 파싱할 소스 텍스트 문자열
 * @param options - 파싱 옵션 객체 (시작 규칙 포함)
 * @returns 파싱 성공 여부, AST 결과 객체, 에러 목록을 포함한 결과
 * 
 * @example
 * const result = parseSource("장면 1:\n  오브젝트 1:\n    클릭했을 때:\n      안녕 말하기");
 * if (result.ok) {
 *   console.log(result.ast);
 * } else {
 *   console.error(result.errors);
 * }
 */
export function parseSource(
  source: string,
  options: { startRule?: StartRule } = {},
): { ok: boolean; ast: ParseRoot | null; errors: ParseFailure[] } {
  const rule = ruleFor(options.startRule);
  const { tokens, errors: lexErrors } = tokenize(source);

  if (lexErrors.length > 0) {
    return { ok: false, ast: null, errors: [toFailure(source, lexErrors[0])] };
  }

  parser.input = tokens;
  const cst = (parser as unknown as Record<string, () => CstNode>)[rule]!();

  if (parser.errors.length > 0) {
    return { ok: false, ast: null, errors: [toFailure(source, parser.errors[0])] };
  }

  // 일찍 매칭이 끝난 규칙은 남은 토큰을 무시합니다. 이는 전체 텍스트 매칭 실패로 간주합니다.
  const next = (parser as unknown as { LA(n: number): IToken }).LA(1);
  if (next.tokenTypeIdx !== EOF.tokenTypeIdx) {
    const message = `입력의 끝이 와야 하는데 '${next.image}' 이(가) 있습니다.`;
    return { ok: false, ast: null, errors: [failure(source, offsetOf(source, next), message)] };
  }

  return { ok: true, ast: toAst(cst, source.length), errors: [] };
}

/**
 * 소스 코드 문자열이 지정된 문법 규칙과 완벽하게 일치하는지 여부를 검증합니다.
 *
 * @param source - 검증할 텍스트 소스
 * @param startRule - 시작 규칙 (기본값: 'Program')
 * @returns 매칭 성공(true) 또는 실패(false)
 * 
 * @example
 * const isValid = checkSource("10 + 20", "Expr");
 * console.log(isValid); // true
 */
export function checkSource(source: string, startRule?: StartRule): boolean {
  return parseSource(source, { startRule }).ok;
}
