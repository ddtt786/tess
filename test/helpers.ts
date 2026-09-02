import assert from 'node:assert/strict';
import { parse } from '@tess/parser';
import type { Expr, ParseRoot, StartRule, Stmt } from '@tess/parser';

/**
 * 문장 목록을 오브젝트의 when 블록으로 감쌉니다.
 *
 * @param code 감쌀 문장 목록
 * @param kind 선언 종류 (기본값: 'object')
 * @returns 감싸진 코드 문자열
 */
export function inObject(code: string, kind = 'object'): string {
  const indented = code.split('\n').map((line) => `    ${line}`).join('\n');
  return `${kind} "o":\n  when start do\n${indented}\n  end\nend`;
}

const attempt = (source: string, startRule?: StartRule) => parse(source, { startRule, validate: false });

/**
 * 코드가 문법에 맞는지 확인합니다. 시맨틱 검증은 수행하지 않습니다.
 *
 * @param source 파싱할 소스 코드
 * @param label 테스트 식별을 위한 레이블
 */
export function assertParses(source: string, label = source.slice(0, 40)) {
  const result = attempt(source);
  assert.ok(result.ok, `파싱에 실패했습니다 [${label}]\n${result.errors[0]?.message ?? ''}`);
}

/**
 * 코드가 문법적으로 올바르지 않아 파싱에 실패하는지 확인합니다.
 *
 * @param source 파싱할 소스 코드
 * @param label 테스트 식별을 위한 레이블
 */
export function assertRejects(source: string, label = source.slice(0, 40)) {
  assert.ok(!attempt(source).ok, `파싱에 성공하면 안 됩니다 [${label}]`);
}

/**
 * 표현식 하나를 파싱하여 AST로 반환합니다.
 *
 * @param source 파싱할 표현식 소스 코드
 * @returns 파싱된 AST 노드
 */
export function expr(source: string): any {
  const result = attempt(source, 'Expr');
  assert.ok(result.ok, `표현식 파싱 실패: ${source}\n${result.errors[0]?.message ?? ''}`);
  return strip(result.ast);
}

/**
 * 문장 하나를 파싱하여 AST로 반환합니다.
 *
 * @param source 파싱할 문장 소스 코드
 * @returns 파싱된 AST 노드
 */
export function stmt(source: string): any {
  const result = attempt(source, 'Statement');
  assert.ok(result.ok, `문장 파싱 실패: ${source}\n${result.errors[0]?.message ?? ''}`);
  return strip(result.ast);
}

/**
 * AST 노드에서 위치 정보(loc)를 제거하여 구조 비교를 용이하게 합니다.
 *
 * @param node 위치 정보를 제거할 AST 노드
 * @returns 위치 정보가 제거된 AST 노드
 */
export function strip(node: unknown): any {
  return JSON.parse(JSON.stringify(node, (key, value) => (key === 'loc' ? undefined : value)));
}

export { parse };
