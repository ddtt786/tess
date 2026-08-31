// ============================================================================
//  Parser entry point
//
//  Wraps the lexer, parser and visitor behind the small surface the rest of the
//  project uses, and reports the first failure with an offset the CLI can turn
//  into a line and column.
// ============================================================================
import { EOF } from 'chevrotain';
import { codeFrameColumns } from '@babel/code-frame';
import { tokenize } from './tokens.js';
import { parser } from './parser.js';
import { toAst } from './visitor.js';

/** Start rules callers may name, mapped to the parser rule that implements them. */
const START_RULES = {
  Program: 'program',
  SceneFragment: 'sceneFragment',
  ObjectFragment: 'objectFragment',
  Statement: 'statement',
  Expr: 'expr',
};

/** Reads a rule name the way the language reference spells it. */
function ruleFor(startRule) {
  const rule = START_RULES[startRule ?? 'Program'];
  if (!rule) throw new Error(`알 수 없는 시작 규칙입니다: ${startRule}`);
  return rule;
}

/** Where a failure sits. The end-of-input token carries no real offset. */
const offsetOf = (source, token) => (
  Number.isInteger(token?.startOffset) && token.startOffset >= 0
    ? token.startOffset
    : source.length
);

/** Points at the offending line with the source above and a caret below. */
function frame(source, offset, message) {
  const upto = source.slice(0, offset);
  const line = upto.split('\n').length;
  const column = offset - (upto.lastIndexOf('\n') + 1) + 1;
  return codeFrameColumns(source, { start: { line, column } }, { message });
}

const failure = (source, offset, message) => ({
  offset,
  message,
  detail: frame(source, offset, message),
});

/** Turns a lexer or parser failure into the shape the CLI prints. */
function toFailure(source, error) {
  if (error.offset !== undefined) {
    const character = JSON.stringify(source[error.offset] ?? '');
    return failure(source, error.offset, `읽을 수 없는 글자입니다: ${character}`);
  }
  return failure(source, offsetOf(source, error.token), error.message);
}

/**
 * Parses one source text.
 *
 * @param {string} source
 * @param {{startRule?: string}} [options]
 * @returns {{ok: boolean, ast: object|null, errors: Array<{offset: number, message: string, detail: string|null}>}}
 */
export function parseSource(source, options = {}) {
  const rule = ruleFor(options.startRule);
  const { tokens, errors: lexErrors } = tokenize(source);

  if (lexErrors.length > 0) {
    return { ok: false, ast: null, errors: [toFailure(source, lexErrors[0])] };
  }

  parser.input = tokens;
  const cst = parser[rule]();

  if (parser.errors.length > 0) {
    return { ok: false, ast: null, errors: [toFailure(source, parser.errors[0])] };
  }

  // A rule that stops early leaves tokens behind; the reference parser treats
  // that as a failure to match the whole input.
  const next = parser.LA(1);
  if (next.tokenTypeIdx !== EOF.tokenTypeIdx) {
    const message = `입력의 끝이 와야 하는데 '${next.image}' 이(가) 있습니다.`;
    return { ok: false, ast: null, errors: [failure(source, offsetOf(source, next), message)] };
  }

  return { ok: true, ast: toAst(cst, source.length), errors: [] };
}

/** True when the source matches the grammar. */
export function checkSource(source, startRule) {
  return parseSource(source, { startRule }).ok;
}
