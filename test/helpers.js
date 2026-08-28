import assert from 'node:assert/strict';
import { parse } from '../src/parse.js';
import { grammar } from '../src/grammar.js';
import { semantics } from '../src/ast.js';

/** Wraps a list of statements in an object's when block. */
export function inObject(code, kind = 'object') {
  const indented = code.split('\n').map((line) => `    ${line}`).join('\n');
  return `${kind} "o":\n  when start do\n${indented}\n  end\nend`;
}

/** Checks grammar validity only (no semantic validation). */
export function assertParses(source, label = source.slice(0, 40)) {
  const match = grammar.match(source);
  assert.ok(match.succeeded(), `파싱에 실패했습니다 [${label}]\n${match.message}`);
}

export function assertRejects(source, label = source.slice(0, 40)) {
  const match = grammar.match(source);
  assert.ok(match.failed(), `파싱에 성공하면 안 됩니다 [${label}]`);
}

/** Parses a single expression into an AST. */
export function expr(source) {
  const match = grammar.match(source, 'Expr');
  assert.ok(match.succeeded(), `표현식 파싱 실패: ${source}\n${match.message}`);
  return strip(semantics(match).ast());
}

/** Parses a single statement into an AST. */
export function stmt(source) {
  const match = grammar.match(source, 'Statement');
  assert.ok(match.succeeded(), `문장 파싱 실패: ${source}\n${match.message}`);
  return strip(semantics(match).ast());
}

/** Strips loc so nodes are easier to compare. */
export function strip(node) {
  return JSON.parse(JSON.stringify(node, (key, value) => (key === 'loc' ? undefined : value)));
}

export { parse };
