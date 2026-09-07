/**
 * @fileoverview The compiler's filesystem port, on node.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { CompilerHost } from './host.ts';

export const NODE_HOST: CompilerHost = {
  resolve: (base, target) => path.resolve(base, target),
  isFile(file) {
    try {
      return fs.existsSync(file) && fs.statSync(file).isFile();
    } catch {
      return false;
    }
  },
  readFile(file) {
    try {
      return fs.readFileSync(file);
    } catch {
      return null;
    }
  },
  readText(file) {
    try {
      return fs.readFileSync(file, 'utf-8');
    } catch {
      return null;
    }
  },
};
