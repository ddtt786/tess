import assert from 'node:assert/strict';
import { parse } from '@tess/parser';
import type { Expr, ParseRoot, StartRule, Stmt } from '@tess/parser';

/** 문장 목록을 오브젝트의 when 블록으로 감싼다. */
export function inObject(code: string, kind = 'object'): string {
  const indented = code.split('\n').map((line) => `    ${line}`).join('\n');
  return `${kind} "o":\n  when start do\n${indented}\n  end\nend`;
}

const attempt = (source: string, startRule?: StartRule) => parse(source, { startRule, validate: false });

/** 문법에 맞는지 확인 (시맨틱 검증은 하지 않음) */
export function assertParses(source: string, label = source.slice(0, 40)) {
  const result = attempt(source);
  assert.ok(result.ok, `파싱에 실패했습니다 [${label}]\n${result.errors[0]?.message ?? ''}`);
}

export function assertRejects(source: string, label = source.slice(0, 40)) {
  assert.ok(!attempt(source).ok, `파싱에 성공하면 안 됩니다 [${label}]`);
}

/** 표현식 하나만 파싱해서 AST 로 */
export function expr(source: string): any {
  const result = attempt(source, 'Expr');
  assert.ok(result.ok, `표현식 파싱 실패: ${source}\n${result.errors[0]?.message ?? ''}`);
  return strip(result.ast);
}

/** 문장 하나만 파싱해서 AST 로 */
export function stmt(source: string): any {
  const result = attempt(source, 'Statement');
  assert.ok(result.ok, `문장 파싱 실패: ${source}\n${result.errors[0]?.message ?? ''}`);
  return strip(result.ast);
}

/** loc 를 제거해서 비교하기 쉽게 */
export function strip(node: unknown): any {
  return JSON.parse(JSON.stringify(node, (key, value) => (key === 'loc' ? undefined : value)));
}

export { parse };
