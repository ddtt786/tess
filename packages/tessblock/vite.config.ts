import { defineConfig } from 'vite';
import path from 'node:path';

const ROOT = path.dirname(new URL(import.meta.url).pathname);

// Sibling packages are imported from their TypeScript sources, so the dev
// server has to serve files from the repository root as well.
export default defineConfig({
  oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  resolve: { dedupe: ['preact', 'blockly'] },
  server: { fs: { allow: [path.resolve(ROOT, '../..')] } },
  build: { target: 'es2022', chunkSizeWarningLimit: 4096 },
});
