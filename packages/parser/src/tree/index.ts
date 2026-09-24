/**
 * @fileoverview tree-sitter front end for whole programs.
 *
 * `initTreeSitter` loads the runtime and the Tess grammar once; after that,
 * `parseSource` reads Program sources through tree-sitter and falls back to
 * the Chevrotain parser for fragments and for anything tree-sitter flags as
 * an error, so error messages always come from Chevrotain.
 */
import type { ProgramNode } from '../ast.ts';
import { plainTree, programFromTree } from './convert.ts';

/** Where the two wasm files come from: a path, a URL, or the bytes. */
export interface TreeSitterFiles {
  /** `web-tree-sitter.wasm`; by default found next to the web-tree-sitter module. */
  runtime?: string | URL | Uint8Array;
  /** `tree-sitter-tess.wasm`; by default `packages/parser/tree-sitter/`. */
  language?: string | URL | Uint8Array;
}

interface Loaded {
  parser: import('web-tree-sitter').Parser;
  language: import('web-tree-sitter').Language;
}

interface Shared {
  loaded: Loaded | null;
  loading: Promise<boolean> | null;
}

// `Parser.init` replaces the wasm module under every parser made before it, so
// all copies of this module (bundlers can load it twice) share one load.
const shared: Shared = ((globalThis as { [key: symbol]: Shared })[Symbol.for('@tess/parser/tree-sitter')] ??= {
  loaded: null,
  loading: null,
});

/** Loads tree-sitter; resolves false (and parsing stays on Chevrotain) when it cannot. */
export function initTreeSitter(files: TreeSitterFiles = {}): Promise<boolean> {
  shared.loading ??= load(files).then(
    (result) => {
      shared.loaded = result;
      return true;
    },
    () => {
      shared.loading = null;
      return false;
    },
  );
  return shared.loading;
}

async function load(files: TreeSitterFiles): Promise<Loaded> {
  const { Parser, Language } = await import('web-tree-sitter');
  const runtime = files.runtime;
  await Parser.init(
    runtime instanceof Uint8Array
      ? { wasmBinary: runtime }
      : runtime !== undefined
        ? { locateFile: () => String(runtime) }
        : {},
  );
  const language = await Language.load(files.language ?? defaultLanguageFile());
  const parser = new Parser();
  parser.setLanguage(language);
  return { parser, language };
}

function defaultLanguageFile(): string | URL {
  const url = new URL('../../tree-sitter/tree-sitter-tess.wasm', import.meta.url);
  return url.protocol === 'file:' ? decodeURIComponent(url.pathname) : url;
}

/** Whether `initTreeSitter` has finished. */
export function treeSitterReady(): boolean {
  return shared.loaded !== null;
}

/** The program's AST, or null when tree-sitter is not loaded or the source has errors. */
export function parseProgramWithTree(source: string): ProgramNode | null {
  const { loaded } = shared;
  if (!loaded) return null;
  const tree = loaded.parser.parse(source);
  if (!tree) return null;
  try {
    if (tree.rootNode.hasError) return null;
    // Cursors are deleted by hand: their GC finalizer frees whatever cursor the
    // shared transfer buffer holds at that moment, corrupting the heap.
    const cursor = tree.walk();
    try {
      return programFromTree(plainTree(cursor, loaded.language), source);
    } finally {
      cursor.delete();
    }
  } catch {
    // A tree the converter does not expect is left to Chevrotain.
    return null;
  } finally {
    tree.delete();
  }
}
