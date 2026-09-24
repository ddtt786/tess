import { defineConfig } from 'vite';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const BLOCKLY = path.resolve(ROOT, '../blockly');

// Blockly comes from the fork in packages/blockly, compiled with Blockly's own
// class-field semantics (see its tsconfig). The build is incremental.
execFileSync(
  process.execPath,
  [path.resolve(ROOT, '../../node_modules/typescript/bin/tsc'), '-p', path.join(BLOCKLY, 'tsconfig.json')],
  { stdio: 'inherit' },
);

/** Entry answers its api for its own pages only; the referer says the call is one (as `tessvm run` does). */
const ENTRY_API = {
  target: 'https://playentry.org',
  changeOrigin: true,
  headers: { referer: 'https://playentry.org/' },
};

// Sibling packages are imported from their TypeScript sources, so the dev
// server has to serve files from the repository root as well.
export default defineConfig({
  oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  resolve: {
    dedupe: ['preact'],
    alias: [
      { find: /^blockly\/core$/, replacement: path.join(BLOCKLY, 'build/core/blockly.js') },
      { find: /^@blockly\/field-colour$/, replacement: path.join(BLOCKLY, 'build/plugins/field-colour/field_colour.js') },
    ],
  },
  server: {
    fs: { allow: [path.resolve(ROOT, '../..')] },
    // Expansion blocks (translate, read aloud) call entry's api on the page's
    // own origin, as they do on entry's site; the dev server passes it on.
    proxy: { '/api/expansionBlock': ENTRY_API },
  },
  preview: { proxy: { '/api/expansionBlock': ENTRY_API } },
  build: { target: 'es2022', chunkSizeWarningLimit: 4096 },
});
