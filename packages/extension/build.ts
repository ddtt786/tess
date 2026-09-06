/**
 * @fileoverview Builds the loadable extension folder.
 *
 * No bundler: every module keeps its own file, its own lines and its own name,
 * exactly as the run server serves them. The graph is walked from the entry
 * points, types are stripped, and the import specifiers are pointed at where
 * each file lands — tessvm's browser sources under `vendor/tessvm`, pixi next
 * to them.
 *
 * The content script is the exception. A file listed in `content_scripts` is
 * loaded as a **classic script**, where `import` is a syntax error and nothing
 * in the file runs, so its own small graph is flattened into one script instead.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';
import { icon } from './icons.ts';
import { zipDirectory } from './pack.ts';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const SRC = path.join(ROOT, 'src');
const VM_SRC = path.resolve(ROOT, '../tessvm/src');
const DIST = path.join(ROOT, 'dist');
const VENDOR = path.join(DIST, 'vendor');
const VM_OUT = path.join(VENDOR, 'tessvm');
const PIXI_OUT = path.join(VENDOR, 'pixi.mjs');
const ZIP = path.join(ROOT, 'tessvm-extension.zip');

/** Loaded as modules, by a document that asks for them. */
const MODULE_ENTRIES = ['page/main.ts', 'popup/popup.ts'];
/** Loaded as classic scripts by the browser itself. */
const CLASSIC_ENTRIES = ['content.ts'];
const ICON_SIZES = [16, 32, 48, 128];

/** Relative `.ts` specifiers and the one bare specifier tessvm uses. */
const RELATIVE_IMPORT = /(['"])(\.\.?\/[^'"]*\.ts)\1/g;
const PIXI_IMPORT = /(['"])pixi\.js\1/g;
/** `import … from '…';`, and the side-effect form. */
const IMPORT_STATEMENT = /^import\s[\s\S]*?from\s*['"][^'"]*['"];?[^\S\n]*$/gm;
const BARE_IMPORT = /^import\s*['"][^'"]*['"];?[^\S\n]*$/gm;
const EXPORT_KEYWORD = /^export\s+(?=(?:const|let|var|function|class|async)\b)/gm;
const LEFTOVER_MODULE = /^\s*(?:import|export)\b/m;

const read = (file: string) => stripTypeScriptTypes(fs.readFileSync(file, 'utf-8'), { mode: 'strip' });

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

/** What this file imports, as absolute paths. */
function importsOf(file: string): string[] {
  const found: string[] = [];
  for (const [, , specifier] of read(file).matchAll(RELATIVE_IMPORT)) {
    found.push(path.resolve(path.dirname(file), specifier!));
  }
  return found;
}

/** Strips types and repoints the imports; returns what this file pulls in. */
function emitModule(file: string): string[] {
  const out = outputFor(file);
  const found: string[] = [];
  const code = read(file)
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

function emitModules(roots: string[]): Set<string> {
  const seen = new Set<string>();
  const queue = [...roots];
  while (queue.length) {
    const file = queue.shift()!;
    if (seen.has(file)) {
      continue;
    }
    seen.add(file);
    queue.push(...emitModule(file));
  }
  return seen;
}

/** Dependencies first, so the flattened script declares things before it uses them. */
function inOrder(file: string, seen: Set<string>, out: string[]): void {
  if (seen.has(file)) {
    return;
  }
  seen.add(file);
  for (const dependency of importsOf(file)) {
    inOrder(dependency, seen, out);
  }
  out.push(file);
}

/**
 * Flattens one entry and everything it imports into a single classic script.
 * `new Function` is the check that it really is one — it catches a leftover
 * `import` and a name two of the flattened files both declare.
 */
function emitClassic(entry: string): number {
  const files: string[] = [];
  inOrder(entry, new Set(), files);
  const body = files
    .map((file) =>
      read(file)
        .replace(IMPORT_STATEMENT, '')
        .replace(BARE_IMPORT, '')
        .replace(EXPORT_KEYWORD, ''),
    )
    .join('\n');
  const code = `(() => {\n${body}\n})();\n`;
  const leftover = LEFTOVER_MODULE.exec(code);
  if (leftover) {
    throw new Error(`${path.relative(SRC, entry)}: 모듈 문법이 남았습니다 — ${leftover[0].trim()}`);
  }
  try {
    new Function(code);
  } catch (error) {
    throw new Error(
      `${path.relative(SRC, entry)}: 클래식 스크립트로 읽히지 않습니다 — ${(error as Error).message}`,
    );
  }
  const out = outputFor(entry);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, code);
  return files.length;
}

/** Every specifier an emitted module points at has to be there. */
function checkLinks(): void {
  const walk = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((item) => {
      const full = path.join(dir, item.name);
      return item.isDirectory() ? walk(full) : [full];
    });
  for (const file of walk(DIST)) {
    if (!file.endsWith('.js') && !file.endsWith('.mjs')) {
      continue;
    }
    const source = fs.readFileSync(file, 'utf-8');
    for (const [, , specifier] of source.matchAll(/(['"])(\.\.?\/[^'"]*\.m?js)\1/g)) {
      const target = path.resolve(path.dirname(file), specifier!);
      if (!fs.existsSync(target)) {
        throw new Error(`${path.relative(DIST, file)} 가 없는 파일을 가리킵니다: ${specifier}`);
      }
    }
  }
}

/**
 * Every file the manifest names has to be in the build. A missing one is not a
 * warning at install time — firefox refuses the whole add-on ("Extension is
 * invalid"), and chrome quietly drops the part that named it.
 */
function checkManifest(): void {
  const manifest = JSON.parse(fs.readFileSync(path.join(DIST, 'manifest.json'), 'utf-8'));
  const named: string[] = [
    ...Object.values(manifest.icons ?? {}),
    ...Object.values(manifest.action?.default_icon ?? {}),
    manifest.action?.default_popup,
    ...(manifest.content_scripts ?? []).flatMap((script: { js?: string[] }) => script.js ?? []),
  ].filter((item): item is string => typeof item === 'string');
  for (const file of named) {
    if (!fs.existsSync(path.join(DIST, file))) {
      throw new Error(`manifest.json 이 없는 파일을 가리킵니다: ${file}`);
    }
  }
  if (manifest.default_locale && !fs.existsSync(path.join(DIST, '_locales', manifest.default_locale))) {
    throw new Error(`manifest.json 의 default_locale 에 맞는 _locales 폴더가 없습니다`);
  }
  for (const group of manifest.web_accessible_resources ?? []) {
    for (const pattern of group.resources ?? []) {
      const prefix = pattern.split('*')[0];
      const at = path.join(DIST, prefix);
      const exists = fs.existsSync(at) || fs.existsSync(path.dirname(at));
      if (!exists) {
        throw new Error(`web_accessible_resources 가 없는 경로를 가리킵니다: ${pattern}`);
      }
    }
  }
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
const modules = emitModules(MODULE_ENTRIES.map((entry) => path.join(SRC, entry)));
let flattened = 0;
for (const entry of CLASSIC_ENTRIES) {
  flattened += emitClassic(path.join(SRC, entry));
}
copyPixi();
copy(path.join(ROOT, 'manifest.json'), path.join(DIST, 'manifest.json'));
copy(path.join(SRC, 'player.css'), path.join(DIST, 'player.css'));
copy(path.join(SRC, 'popup', 'popup.html'), path.join(DIST, 'popup', 'popup.html'));
copy(path.join(SRC, 'popup', 'popup.css'), path.join(DIST, 'popup', 'popup.css'));
writeIcons();
checkLinks();
checkManifest();
zipDirectory(DIST, ZIP);

console.log(
  `확장을 만들었습니다: ${path.relative(process.cwd(), DIST)}` +
    ` (모듈 ${modules.size}개 · 내용 스크립트 ${flattened}개)\n` +
    `파이어폭스용 묶음: ${path.relative(process.cwd(), ZIP)}`,
);
