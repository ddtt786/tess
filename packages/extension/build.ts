/**
 * @fileoverview Builds the loadable extension folder.
 *
 * No bundler: every module keeps its own file, its own lines and its own name,
 * exactly as the run server serves them. The graph is walked from the three
 * entry points, types are stripped, and the import specifiers are pointed at
 * where each file lands — tessvm's browser sources under `vendor/tessvm`, pixi
 * next to them.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';
import { icon } from './icons.ts';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const SRC = path.join(ROOT, 'src');
const VM_SRC = path.resolve(ROOT, '../tessvm/src');
const DIST = path.join(ROOT, 'dist');
const VENDOR = path.join(DIST, 'vendor');
const VM_OUT = path.join(VENDOR, 'tessvm');
const PIXI_OUT = path.join(VENDOR, 'pixi.mjs');

const ENTRY_POINTS = ['content.ts', 'page/main.ts', 'popup/popup.ts'];
const ICON_SIZES = [16, 32, 48, 128];

/** Relative `.ts` specifiers and the one bare specifier tessvm uses. */
const RELATIVE_IMPORT = /(['"])(\.\.?\/[^'"]*\.ts)\1/g;
const PIXI_IMPORT = /(['"])pixi\.js\1/g;

function outputFor(file: string): string {
  const inSrc = path.relative(SRC, file);
  if (!inSrc.startsWith('..') && !path.isAbsolute(inSrc)) {
    return path.join(DIST, inSrc).replace(/\.ts$/, '.js');
  }
  const inVm = path.relative(VM_SRC, file);
  if (!inVm.startsWith('..') && !path.isAbsolute(inVm)) {
    return path.join(VM_OUT, inVm).replace(/\.ts$/, '.js');
  }
  throw new Error(`확장에 포함할 수 없는 모듈입니다: ${file}`);
}

function link(from: string, to: string): string {
  const relative = path.relative(path.dirname(from), to).split(path.sep).join('/');
  return relative.startsWith('.') ? relative : `./${relative}`;
}

/** Strips types and repoints the imports; returns what this file pulls in. */
function emit(file: string): string[] {
  const out = outputFor(file);
  const found: string[] = [];
  const stripped = stripTypeScriptTypes(fs.readFileSync(file, 'utf-8'), { mode: 'strip' });
  const code = stripped
    .replace(RELATIVE_IMPORT, (_match, quote: string, specifier: string) => {
      const target = path.resolve(path.dirname(file), specifier);
      found.push(target);
      return `${quote}${link(out, outputFor(target))}${quote}`;
    })
    .replace(PIXI_IMPORT, (_match, quote: string) => `${quote}${link(out, PIXI_OUT)}${quote}`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, code);
  return found;
}

function emitGraph(roots: string[]): number {
  const seen = new Set<string>();
  const queue = [...roots];
  while (queue.length) {
    const file = queue.shift()!;
    if (seen.has(file)) {
      continue;
    }
    seen.add(file);
    queue.push(...emit(file));
  }
  return seen.size;
}

/** The dist build of pixi, with its source map comment dropped. */
function copyPixi(): void {
  const require = createRequire(path.join(ROOT, '../tessvm/package.json'));
  let dir = path.dirname(require.resolve('pixi.js'));
  while (!fs.existsSync(path.join(dir, 'package.json'))) {
    const up = path.dirname(dir);
    if (up === dir) {
      throw new Error('pixi.js 를 찾지 못했습니다');
    }
    dir = up;
  }
  const source = path.join(dir, 'dist', 'pixi.min.mjs');
  const code = fs.readFileSync(source, 'utf-8').replace(/\n?\/\/# sourceMappingURL=.*$/, '\n');
  fs.mkdirSync(VENDOR, { recursive: true });
  fs.writeFileSync(PIXI_OUT, code);
}

function copy(from: string, to: string): void {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true });
}

function writeIcons(): void {
  const dir = path.join(DIST, 'icons');
  fs.mkdirSync(dir, { recursive: true });
  for (const size of ICON_SIZES) {
    fs.writeFileSync(path.join(dir, `icon-${size}.png`), icon(size));
  }
}

fs.rmSync(DIST, { recursive: true, force: true });
const modules = emitGraph(ENTRY_POINTS.map((entry) => path.join(SRC, entry)));
copyPixi();
copy(path.join(ROOT, 'manifest.json'), path.join(DIST, 'manifest.json'));
copy(path.join(ROOT, '_locales'), path.join(DIST, '_locales'));
copy(path.join(SRC, 'player.css'), path.join(DIST, 'player.css'));
copy(path.join(SRC, 'popup', 'popup.html'), path.join(DIST, 'popup', 'popup.html'));
copy(path.join(SRC, 'popup', 'popup.css'), path.join(DIST, 'popup', 'popup.css'));
writeIcons();

console.log(`확장을 만들었습니다: ${path.relative(process.cwd(), DIST)} (모듈 ${modules}개)`);
