// Mirrors the PAINTER_CSS template literal into dist/painter.css so consumers
// can `import 'painter/style.css'` instead of relying on runtime injection.
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const source = await readFile(new URL('../src/ui/styles.ts', import.meta.url), 'utf8');
const match = /export const PAINTER_CSS = `([\s\S]*?)`;/.exec(source);
if (!match) {
  console.error('[painter] could not find PAINTER_CSS in src/ui/styles.ts');
  process.exit(1);
}
await mkdir(new URL('../dist/', import.meta.url), { recursive: true });
await writeFile(new URL('../dist/painter.css', import.meta.url), `${match[1].trim()}\n`, 'utf8');
console.log('[painter] wrote dist/painter.css');
