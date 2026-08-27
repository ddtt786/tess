// ============================================================================
//  Tess 공개 API
// ============================================================================
import { grammar } from './grammar.js';
import { semantics } from './ast.js';
import { lineAndColumn, validate } from './validate.js';

/**
 * Tess 소스를 파싱해서 AST 와 진단 결과를 돌려준다.
 *
 * @param {string} source
 * @param {{validate?: boolean, startRule?: string}} [options]
 * @returns {{ok: boolean, ast: object|null, errors: Array, warnings: Array, match: object}}
 */
export function parse(source, options = {}) {
  const { validate: runValidation = true, startRule } = options;
  const match = startRule ? grammar.match(source, startRule) : grammar.match(source);

  if (match.failed()) {
    const offset = match.getRightmostFailurePosition();
    const { line, column } = lineAndColumn(source, offset);
    return {
      ok: false,
      ast: null,
      match,
      warnings: [],
      errors: [{ line, column, offset, message: match.shortMessage, detail: match.message }],
    };
  }

  const ast = semantics(match).ast();
  if (!runValidation) return { ok: true, ast, match, errors: [], warnings: [] };

  const { errors, warnings } = validate(ast, source);
  return { ok: errors.length === 0, ast, match, errors, warnings };
}

/** 파싱에 실패하면 예외를 던지고, 성공하면 AST 를 돌려준다. */
export function parseOrThrow(source, options = {}) {
  const result = parse(source, options);
  if (!result.ok) {
    const first = result.errors[0];
    const error = new Error(first.detail ?? `${first.line}:${first.column} ${first.message}`);
    error.errors = result.errors;
    error.warnings = result.warnings;
    throw error;
  }
  return result.ast;
}

/** 문법에 맞는 코드인지만 빠르게 확인한다. */
export function check(source) {
  return grammar.match(source).succeeded();
}

/** 파서가 어떤 판단을 내렸는지 단계별로 보여준다 (디버깅용). */
export function trace(source, startRule) {
  return (startRule ? grammar.trace(source, startRule) : grammar.trace(source)).toString();
}

export { grammar, semantics, validate, lineAndColumn };
