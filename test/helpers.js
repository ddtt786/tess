import assert from 'node:assert/strict';
import { parse } from '../src/parse.js';
import { grammar } from '../src/grammar.js';
import { semantics } from '../src/ast.js';

/** 문장 목록을 오브젝트의 when 블록으로 감싼다. */
export function inObject(code, kind = 'object') {
  const indented = code.split('\n').map((line) => `    ${line}`).join('\n');
  return `${kind} "o":\n  when start do\n${indented}\n  end\nend`;
}

/** 문법에 맞는지 확인 (시맨틱 검증은 하지 않음) */
export function assertParses(source, label = source.slice(0, 40)) {
  const match = grammar.match(source);
  assert.ok(match.succeeded(), `파싱에 실패했습니다 [${label}]\n${match.message}`);
}

export function assertRejects(source, label = source.slice(0, 40)) {
  const match = grammar.match(source);
  assert.ok(match.failed(), `파싱에 성공하면 안 됩니다 [${label}]`);
}

/** 표현식 하나만 파싱해서 AST 로 */
export function expr(source) {
  const match = grammar.match(source, 'Expr');
  assert.ok(match.succeeded(), `표현식 파싱 실패: ${source}\n${match.message}`);
  return strip(semantics(match).ast());
}

/** 문장 하나만 파싱해서 AST 로 */
export function stmt(source) {
  const match = grammar.match(source, 'Statement');
  assert.ok(match.succeeded(), `문장 파싱 실패: ${source}\n${match.message}`);
  return strip(semantics(match).ast());
}

/** loc 를 제거해서 비교하기 쉽게 */
export function strip(node) {
  return JSON.parse(JSON.stringify(node, (key, value) => (key === 'loc' ? undefined : value)));
}

export { parse };
