// ============================================================================
//  Tess public API.
// ============================================================================
import { grammar } from './grammar.js';
import { semantics } from './ast.js';
import { lineAndColumn, validate } from './validate.js';

/**
 * Parses Tess source and returns the AST plus diagnostics.
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

/** Throws on a parse failure, otherwise returns the AST. */
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

/** Quickly checks whether the code matches the grammar, nothing more. */
export function check(source) {
  return grammar.match(source).succeeded();
}

/** Shows the parser's step-by-step decisions (for debugging). */
export function trace(source, startRule) {
  return (startRule ? grammar.trace(source, startRule) : grammar.trace(source)).toString();
}

export { grammar, semantics, validate, lineAndColumn };
