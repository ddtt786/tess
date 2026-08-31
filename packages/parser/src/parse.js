// ============================================================================
//  Tess 공개 API
// ============================================================================
import { parseSource, checkSource } from './parser/index.js';
import { lineAndColumn, validate } from './validate.js';

/**
 * Tess 소스를 파싱해서 AST 와 진단 결과를 돌려준다.
 *
 * @param {string} source
 * @param {{validate?: boolean, startRule?: string}} [options]
 * @returns {{ok: boolean, ast: object|null, errors: Array, warnings: Array}}
 */
export function parse(source, options = {}) {
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

  const { ast } = result;
  if (!runValidation) {
    return {
      ok: true, ast, errors: [], warnings: [],
    };
  }

  const { errors, warnings } = validate(ast, source);
  return {
    ok: errors.length === 0, ast, errors, warnings,
  };
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
export function check(source, startRule) {
  return checkSource(source, startRule);
}

export { validate, lineAndColumn };
