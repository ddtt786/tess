/**
 * @fileoverview The esbuild settings the extension is bundled with.
 *
 * Kept apart from the build command so tests can bundle the same way the
 * shipped files are bundled, and check the result actually links.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BuildOptions } from 'esbuild';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const SRC = path.join(HERE, 'src');
export const OUT = path.join(HERE, 'dist');
export const TARGETS = ['chrome', 'firefox'] as const;

export interface BundleEntry {
  input: string;
  output: string;
}

export const ENTRIES: BundleEntry[] = [
  { input: path.join(SRC, 'page', 'index.ts'), output: 'page.js' },
  { input: path.join(SRC, 'content.ts'), output: 'content.js' },
  { input: path.join(SRC, 'background.ts'), output: 'background.js' },
  { input: path.join(SRC, 'popup', 'popup.ts'), output: 'popup.js' },
];

const shim = (name: string) => path.join(SRC, 'shims', name);

/**
 * The parser, the compiler, the decompiler and tessvm all go into one page
 * script — a script in the page cannot fetch modules of its own out of the
 * extension. What those packages import on the command line is swapped for
 * browser stand-ins here.
 */
export function bundleOptions({ dev = false }: { dev?: boolean } = {}): BuildOptions {
  return {
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['chrome110', 'firefox128'],
    minify: !dev,
    sourcemap: dev ? 'inline' : false,
    legalComments: 'none',
    logLevel: 'warning',
    alias: {
      'node:fs': shim('fs.ts'),
      'node:path': shim('path.ts'),
      'node:url': shim('url.ts'),
      tar: shim('tar.ts'),
      sharp: shim('sharp.ts'),
      '@tess/player': shim('player.ts'),
    },
    inject: [shim('buffer.ts'), shim('process.ts')],
    define: {
      // The decompiler asks where it is installed so it can read entry's own
      // costumes off the disk. There is no disk here and no module url either.
      'import.meta.url': '""',
    },
  };
}
