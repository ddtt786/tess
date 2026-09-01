// ============================================================================
//  Parser entry point
//
//  Wraps the lexer, parser and visitor behind the small surface the rest of the
//  project uses, and reports the first failure with an offset the CLI can turn
//  into a line and column.
// ============================================================================
import { EOF } from 'chevrotain';
import type { CstNode, ILexingError, IRecognitionException, IToken } from 'chevrotain';
import { codeFrameColumns } from '@babel/code-frame';
import { tokenize } from './tokens.ts';
import { parser } from './parser.ts';
import { toAst } from './visitor.ts';
import type { ParseRoot } from '../ast.ts';

/** A start rule spelled the way the language reference spells it. */
export type StartRule = 'Program' | 'SceneFragment' | 'ObjectFragment' | 'Statement' | 'Expr';

/** What a lexer or parser failure looks like before it gets a line and column. */
export interface ParseFailure {
  offset: number;
  message: string;
  detail: string | null;
}

/** Start rules callers may name, mapped to the parser rule that implements them. */
const START_RULES: Record<string, string> = {
  Program: 'program',
  SceneFragment: 'sceneFragment',
  ObjectFragment: 'objectFragment',
  Statement: 'statement',
  Expr: 'expr',
};

/** Reads a rule name the way the language reference spells it. */
function ruleFor(startRule: StartRule | undefined): string {
  const rule = START_RULES[startRule ?? 'Program'];
  if (!rule) throw new Error(`알 수 없는 시작 규칙입니다: ${startRule}`);
  return rule;
}

/** Where a failure sits. The end-of-input token carries no real offset. */
const offsetOf = (source: string, token: IToken | undefined) => (
  token && Number.isInteger(token.startOffset) && token.startOffset >= 0
    ? token.startOffset
    : source.length
);

/** Points at the offending line with the source above and a caret below. */
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

/** Either failure the parse can report — lexing stops at an offset, parsing at a token. */
type LexOrParseError = (ILexingError & { token?: undefined }) | (IRecognitionException & { offset?: undefined });

/** Turns a lexer or parser failure into the shape the CLI prints. */
function toFailure(source: string, error: LexOrParseError): ParseFailure {
  if (error.offset !== undefined) {
    const character = JSON.stringify(source[error.offset] ?? '');
    return failure(source, error.offset, `읽을 수 없는 글자입니다: ${character}`);
  }
  return failure(source, offsetOf(source, error.token), error.message);
}

/** Parses one source text. */
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

  // A rule that stops early leaves tokens behind; the reference parser treats
  // that as a failure to match the whole input.
  const next = (parser as unknown as { LA(n: number): IToken }).LA(1);
  if (next.tokenTypeIdx !== EOF.tokenTypeIdx) {
    const message = `입력의 끝이 와야 하는데 '${next.image}' 이(가) 있습니다.`;
    return { ok: false, ast: null, errors: [failure(source, offsetOf(source, next), message)] };
  }

  return { ok: true, ast: toAst(cst, source.length), errors: [] };
}

/** True when the source matches the grammar. */
export function checkSource(source: string, startRule?: StartRule): boolean {
  return parseSource(source, { startRule }).ok;
}
