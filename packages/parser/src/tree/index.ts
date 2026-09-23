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

let loaded: Loaded | null = null;
let loading: Promise<boolean> | null = null;

/** Loads tree-sitter; resolves false (and parsing stays on Chevrotain) when it cannot. */
export function initTreeSitter(files: TreeSitterFiles = {}): Promise<boolean> {
  loading ??= load(files).then(
    (result) => {
      loaded = result;
      return true;
    },
    () => {
      loading = null;
      return false;
    },
  );
  return loading;
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
  return loaded !== null;
}

/** The program's AST, or null when tree-sitter is not loaded or the source has errors. */
export function parseProgramWithTree(source: string): ProgramNode | null {
  if (!loaded) return null;
  const tree = loaded.parser.parse(source);
  if (!tree) return null;
  try {
    if (tree.rootNode.hasError) return null;
    return programFromTree(plainTree(tree.walk(), loaded.language), source);
  } finally {
    tree.delete();
  }
}
