// ============================================================================
//  Typed boundary onto the Tess compiler front end
//
//  The language server never re-implements the language: it calls the same
//  lexer, parser and validator the CLI compiles with, so an editor diagnostic
//  and a build failure are always the same check.
// ============================================================================
/* eslint-disable @typescript-eslint/no-explicit-any */
import * as parseModule from '../../../../src/parse.js';
import * as tokenModule from '../../../../src/parser/tokens.js';
import * as builtinModule from '../../../../src/builtins.js';
import * as suggestModule from '../../../../src/compiler/suggest.js';

/** Half open source span, in UTF-16 offsets. */
export interface TessLoc {
    start: number;
    end: number;
    file?: string;
}

/** A node of the AST the compiler consumes. */
export interface TessNode {
    type: string;
    loc?: TessLoc;
    [key: string]: unknown;
}

export interface TessDiagnostic {
    line: number;
    column: number;
    offset: number;
    file?: string;
    message: string;
    detail?: string;
}

export interface TessParse {
    ok: boolean;
    ast: TessNode | null;
    errors: TessDiagnostic[];
    warnings: TessDiagnostic[];
}

/** One lexed token, as chevrotain reports it. */
export interface TessToken {
    image: string;
    startOffset: number;
    endOffset: number;
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
    tokenType: { name: string; CATEGORIES?: Array<{ name: string }> };
    tokenTypeIdx: number;
}

export interface TessLexResult {
    tokens: TessToken[];
    errors: Array<{ offset: number; message: string }>;
}

export const parse: (source: string, options?: { validate?: boolean; startRule?: string }) => TessParse =
    (parseModule as any).parse;

export const tokenize: (source: string) => TessLexResult = (tokenModule as any).tokenize;

/** Every keyword the grammar knows, in reference order. */
export const KEYWORDS: string[] = (tokenModule as any).KEYWORDS;

/** Keywords that may not double as a name. */
export const RESERVED: Set<string> = (tokenModule as any).RESERVED;

export const STATE_VALUES: Set<string> = (builtinModule as any).STATE_VALUES;
export const BUILTIN_FUNCTIONS: Set<string> = (builtinModule as any).BUILTIN_FUNCTIONS;
export const OPTION_KEYWORDS: Set<string> = (builtinModule as any).OPTION_KEYWORDS;
export const OBJECT_PROPERTIES: Set<string> = (builtinModule as any).OBJECT_PROPERTIES;
export const TEXT_ONLY_PROPERTIES: Set<string> = (builtinModule as any).TEXT_ONLY_PROPERTIES;

export const didYouMean: (name: string, known: Iterable<string>) => string | null =
    (suggestModule as any).didYouMean;

/** True when the token may stand where a name is expected. */
export function isNameToken(token: TessToken): boolean {
    if (token.tokenType.name === 'Identifier') return true;
    return (token.tokenType.CATEGORIES ?? []).some((category) => category.name === 'IdentLike');
}

/** True when the token is a keyword rather than a plain identifier. */
export function isKeywordToken(token: TessToken): boolean {
    return token.tokenType.name.startsWith('kw_');
}
