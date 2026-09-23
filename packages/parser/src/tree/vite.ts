/**
 * @fileoverview tree-sitter start-up for pages built with Vite: the two wasm
 * files are emitted as assets and loaded from their URLs.
 */
import runtime from 'web-tree-sitter/web-tree-sitter.wasm?url';
import language from '../../tree-sitter/tree-sitter-tess.wasm?url';
import { initTreeSitter } from './index.ts';

/** Starts loading tree-sitter; parsing uses Chevrotain until it is ready. */
export function initTreeSitterForVite(): Promise<boolean> {
  return initTreeSitter({ runtime, language });
}
