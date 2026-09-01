// ============================================================================
//  Tess 공개 API
// ============================================================================
import { parseSource, checkSource } from './parser/index.ts';
import type { StartRule } from './parser/index.ts';
import { lineAndColumn, validate } from './validate.ts';
import type { Diagnostic, ParseResult, ParseRoot, ProgramNode } from './ast.ts';

/** How `parse` should read the source, and how far it should check it. */
export interface ParseOptions {
  validate?: boolean;
  startRule?: StartRule;
}

/** Thrown by `parseOrThrow`, carrying everything `parse` would have reported. */
export class TessParseError extends Error {
  errors: Diagnostic[];

  warnings: Diagnostic[];

  constructor(message: string, errors: Diagnostic[], warnings: Diagnostic[]) {
    super(message);
    this.name = 'TessParseError';
    this.errors = errors;
    this.warnings = warnings;
  }
}

/** Tess 소스를 파싱해서 AST 와 진단 결과를 돌려준다. */
export function parse(source: string, options: ParseOptions = {}): ParseResult {
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

  const ast = result.ast!;
  if (!runValidation) {
    return {
      ok: true, ast, errors: [], warnings: [],
    };
  }

  const { errors, warnings } = validate(ast as ProgramNode, source);
  return {
    ok: errors.length === 0, ast, errors, warnings,
  };
}

/** 파싱에 실패하면 예외를 던지고, 성공하면 AST 를 돌려준다. */
export function parseOrThrow(source: string, options: ParseOptions = {}): ParseRoot {
  const result = parse(source, options);
  if (!result.ok) {
    const first = result.errors[0]!;
    throw new TessParseError(
      first.detail ?? `${first.line}:${first.column} ${first.message}`,
      result.errors,
      result.warnings,
    );
  }
  return result.ast!;
}

/** 문법에 맞는 코드인지만 빠르게 확인한다. */
export function check(source: string, startRule?: StartRule): boolean {
  return checkSource(source, startRule);
}

export { validate, lineAndColumn };
