/**
 * @fileoverview 작품 하나를 혼자 도는 한 덩어리로 내보냅니다.
 *
 * 두 가지 모양이 있습니다.
 *
 * - **zip** — 실행 서버가 내주던 것을 그대로 파일로 펼쳐 담습니다. 풀어서 아무 정적
 *   서버에나 올리면 돕니다.
 * - **단일 html** — 모듈·작품·모양·소리·커널을 전부 글 안에 넣고, 페이지가 열릴 때
 *   `Blob` 으로 되살려 붙입니다. 파일 하나로 끝나므로 주고받기 좋습니다.
 *
 * 두 모양 모두 실행기는 같은 `src/web/boot.ts` 이고, 서버가 하던 일(모듈 내주기·작품
 * 내주기·커널 내주기)을 링크만 바꿔 대신합니다. 디버그 패널은 개발 도구이므로 빠집니다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';
import { ENTRY_FONT_STYLES, withServedAssets } from '@tess/player';
import type { AssetFile, EntryProject } from '@tess/compiler';
import { ASK_FIELD_STYLE } from '../web/ask-style.ts';
import { CHART_WINDOW_STYLE } from '../web/chart-view.ts';
import { EXTRAS_DIALOG_STYLE } from '../web/extras.ts';
import { zipFiles, type ZipFile } from './zip.ts';
import { prepareKernel } from '../kernel/prepare.ts';
import { DEFAULT_STAGE_HEIGHT, DEFAULT_STAGE_WIDTH } from '../runtime/model.ts';

const SRC_DIR = fileURLToPath(new URL('../', import.meta.url));
const PIXI_FILE = fileURLToPath(new URL('../../node_modules/pixi.js/dist/pixi.mjs', import.meta.url));
const DEXIE_FILE = fileURLToPath(new URL('../../node_modules/dexie/dist/modern/dexie.mjs', import.meta.url));

/** Where the runner's own modules sit inside the archive. */
const VM_PREFIX = 'vm/';

/** The bare name the single file maps each module to, through an import map. */
const BARE_PREFIX = 'tessvm/';

/** Where the kernel is asked for; the single file answers this from memory. */
const KERNEL_NAME = 'kernel.wasm';

/** Media types the work's files come as. */
const MEDIA: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.bmp': 'image/bmp', '.webp': 'image/webp',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4',
};

export interface ExportOptions {
  project: EntryProject;
  assets: AssetFile[];
  name: string;
  quality?: number;
  fps?: number;
  stageWidth?: number;
  stageHeight?: number;
  autoStart?: boolean;
  boost?: boolean;
  svg?: boolean;
  /** Off leaves every function on the block runner's own path. */
  kernel?: boolean;
}

export interface ExportResult {
  /** The bytes to write out. */
  data: Buffer;
  /** What went in, for the line the cli prints. */
  modules: number;
  assets: number;
  /** Where the page will run its numeric functions; `none` is `--no-kernel`. */
  kernel: 'wasm' | 'javascript' | 'none';
}

// ---------------------------------------------------------------------------
//  The runner's modules
// ---------------------------------------------------------------------------
/** `import … from '…'` and `export … from '…'`, plus `import('…')`. */
const SPECIFIER = /(\bfrom\s*|\bimport\s*\(\s*)(['"])([^'"]+)\2/g;

/**
 * Every module the page needs, keyed by its path under `src/`. Types are
 * stripped the way the run server strips them, so the lines still line up with
 * the repository when the page is opened in a debugger.
 */
function collectModules(entries: string[]): Map<string, string> {
  const found = new Map<string, string>();
  const queue = [...entries];
  while (queue.length) {
    const relative = queue.pop()!;
    if (found.has(relative)) {
      continue;
    }
    const file = path.join(SRC_DIR, relative);
    if (!file.startsWith(SRC_DIR) || !fs.existsSync(file)) {
      throw new Error(`실행기 모듈을 찾지 못했습니다: ${relative}`);
    }
    const source = fs.readFileSync(file, 'utf-8');
    const code = relative.endsWith('.ts')
      ? stripTypeScriptTypes(source, { mode: 'strip' })
      : source;
    found.set(relative, code);
    for (const specifier of relativeSpecifiers(code)) {
      queue.push(resolveFrom(relative, specifier));
    }
  }
  return found;
}

function* relativeSpecifiers(code: string): Generator<string> {
  for (const match of code.matchAll(SPECIFIER)) {
    if (match[3]!.startsWith('.')) {
      yield match[3]!;
    }
  }
}

function resolveFrom(relative: string, specifier: string): string {
  return path.posix.normalize(path.posix.join(path.posix.dirname(relative), specifier));
}

/**
 * Rewrites one module's relative specifiers through `name`, which is handed the
 * path under `src/` it points at and the specifier as it was written.
 */
function rewriteSpecifiers(
  relative: string,
  code: string,
  name: (target: string, specifier: string) => string,
): string {
  return code.replace(SPECIFIER, (whole, head: string, quote: string, specifier: string) =>
    specifier.startsWith('.')
      ? `${head}${quote}${name(resolveFrom(relative, specifier), specifier)}${quote}`
      : whole);
}

/** A browser serves `.ts` as a type it refuses to run, so the archive says `.js`. */
const asJs = (name: string) => name.replace(/\.ts$/, '.js');

// ---------------------------------------------------------------------------
//  The page
// ---------------------------------------------------------------------------
const STYLE = `
:root { color-scheme: dark; }
* { box-sizing: border-box; }
[hidden] { display: none !important; }
html, body { height: 100%; margin: 0; }
body {
  background: #000; color: #e8eaed;
  font: 13px/1.5 system-ui, -apple-system, 'Segoe UI', 'Noto Sans KR', sans-serif;
}
#stage { position: relative; width: 100%; height: 100%; }
.tessvm-stage { position: relative; width: 100%; height: 100%; display: grid; place-items: center; }
.tessvm-stage canvas { display: block; }
.tessvm-frame { position: relative; }
#tessvm-cover {
  position: absolute; inset: 0; z-index: 2; display: grid; place-items: center;
  background: #00000059;
}
#tessvm-start {
  width: 88px; height: 88px; padding: 0; border: 0; border-radius: 50%;
  background: #fff; color: #4f80ff; cursor: pointer; display: grid; place-items: center;
  box-shadow: 0 6px 24px #0007; transition: transform .12s ease-out;
}
#tessvm-start:hover { transform: scale(1.06); }
#tessvm-start svg { width: 40px; height: 40px; margin-left: 5px; fill: currentColor; }
#tessvm-error {
  position: absolute; inset: auto 12px 12px 12px; z-index: 3; padding: 10px 12px;
  border-radius: 8px; background: #46161a; border: 1px solid #7d2b31; display: none;
  white-space: pre-wrap; max-height: 40vh; overflow: auto; font-family: ui-monospace, monospace;
}
${ASK_FIELD_STYLE}
${CHART_WINDOW_STYLE}
${EXTRAS_DIALOG_STYLE}
`;

const BODY = `<div id="stage">
  <div id="tessvm-cover">
    <button id="tessvm-start" type="button" title="시작하기" aria-label="시작하기">
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.6 3.1 12.9 8l-8.3 4.9Z"/></svg>
    </button>
  </div>
</div>
<div id="tessvm-error"></div>`;

/**
 * The module the page ends up running. `boot` names where the runner is imported
 * from and `project` how the work is read; `prelude` is what only one shape needs.
 */
function bootModule(
  links: { boot: string; project: string; prelude?: string },
  config: unknown,
): string {
  return `
import { boot } from ${links.boot};
${links.prelude ?? ''}

const config = ${literal(config)};
const errorBox = document.getElementById('tessvm-error');
function showError(message) {
  errorBox.style.display = 'block';
  errorBox.textContent = message;
}
window.addEventListener('error', (event) => {
  if (/^ResizeObserver loop/.test(String(event.message))) return;
  showError(String(event.message));
});
window.addEventListener('unhandledrejection', (event) => showError(String(event.reason)));

try {
  const project = ${links.project};
  const cover = document.getElementById('tessvm-cover');
  const handle = await boot({
    project,
    container: document.getElementById('stage'),
    quality: config.quality,
    fps: config.fps ?? undefined,
    showStats: false,
    autoStart: config.autoStart,
    boost: config.boost,
    svg: config.svg,
    stageWidth: config.stageWidth,
    stageHeight: config.stageHeight,
    kernelUrl: config.kernelUrl,
    kernelFingerprint: config.kernelFingerprint,
  });
  // The page has no controls of its own; this is where a console reaches the run.
  window.tessvm = handle;
  // 엔트리처럼, 시작 단추를 누르기 전에는 돌지 않습니다.
  document.getElementById('tessvm-start').onclick = () => handle.start();
  setInterval(() => { cover.hidden = handle.vm.state !== 'stop'; }, 100);
  cover.hidden = config.autoStart;
} catch (error) {
  showError(String(error && error.stack ? error.stack : error));
}
`;
}

function page(title: string, head: string, tail: string): string {
  const fonts = ENTRY_FONT_STYLES.map((url) => `<link rel="stylesheet" href="${url}">`).join('\n');
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
${fonts}
<style>${STYLE}</style>
${head}
</head>
<body>
${BODY}
${tail}
</body>
</html>
`;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);
}

/** A value inside a `<script>`; `</script` in a string would end the block. */
function literal(value: unknown): string {
  return JSON.stringify(value ?? null)
    .replaceAll('<', '\\u003c')
    .replaceAll(' ', '\\u2028')
    .replaceAll(' ', '\\u2029');
}

// ---------------------------------------------------------------------------
//  Putting it together
// ---------------------------------------------------------------------------
interface Asset {
  /** The address the work itself uses. */
  target: string;
  data: Buffer;
  type: string;
}

interface Built {
  modules: Map<string, string>;
  assets: Asset[];
  kernel: { wasm: Uint8Array; fingerprint: string } | null;
  config: Record<string, unknown>;
}

function build(options: ExportOptions): Built {
  const assets: Asset[] = [];
  const seen = new Set<string>();
  for (const asset of options.assets) {
    if (seen.has(asset.target) || !fs.existsSync(asset.source)) {
      continue;
    }
    seen.add(asset.target);
    assets.push({
      target: asset.target,
      data: fs.readFileSync(asset.source),
      type: MEDIA[path.extname(asset.target).toLowerCase()] ?? 'application/octet-stream',
    });
  }
  const prepared = options.kernel === false ? null : prepareKernel(options.project);
  return {
    modules: collectModules(['web/boot.ts']),
    assets,
    kernel: prepared?.kernel
      ? { wasm: prepared.kernel.wasm, fingerprint: prepared.kernel.fingerprint }
      : null,
    config: {
      quality: options.quality ?? 1,
      fps: options.fps ?? null,
      autoStart: options.autoStart ?? false,
      boost: options.boost ?? true,
      svg: options.svg ?? true,
      stageWidth: options.stageWidth ?? DEFAULT_STAGE_WIDTH,
      stageHeight: options.stageHeight ?? DEFAULT_STAGE_HEIGHT,
    },
  };
}

/**
 * Where the page looks for its kernel. A built one is pointed at; without one
 * the address is left out, which is what puts the kernel on its javascript path
 * — `null` there would mean no kernel at all, and that is what `--no-kernel`
 * asks for.
 */
const kernelKind = (options: ExportOptions, built: Built): ExportResult['kernel'] =>
  built.kernel ? 'wasm' : options.kernel === false ? 'none' : 'javascript';

function kernelLinks(
  options: ExportOptions,
  built: Built,
  url: string,
): { kernelUrl?: string | null; kernelFingerprint: string | null } {
  if (built.kernel) {
    return { kernelUrl: url, kernelFingerprint: built.kernel.fingerprint };
  }
  return options.kernel === false
    ? { kernelUrl: null, kernelFingerprint: null }
    : { kernelFingerprint: null };
}

/**
 * Everything as files under one archive, laid out the way the run server serves
 * them. The work's own file addresses are pointed at `assets/`, and the modules
 * are written as `.js` because a static server hands a `.ts` to the browser
 * under a type it will not run.
 */
export function exportZip(options: ExportOptions): ExportResult {
  const built = build(options);
  const rewrites = new Map(built.assets.map((asset) => [asset.target, `assets/${asset.target}`]));
  const project = withServedAssets(options.project, rewrites);
  const config = { ...built.config, ...kernelLinks(options, built, `./${KERNEL_NAME}`) };
  const files: ZipFile[] = [
    {
      name: 'index.html',
      data: page(
        options.name,
        `<script type="importmap">${literal({
          imports: { 'pixi.js': './vm/pixi.mjs', dexie: './vm/dexie.mjs' },
        })}</script>`,
        `<script type="module">${bootModule(
          {
            boot: literal(`./${VM_PREFIX}web/boot.js`),
            project: `await (await fetch('./project.json')).json()`,
          },
          config,
        )}</script>`,
      ),
    },
    { name: 'project.json', data: JSON.stringify(project) },
    { name: `${VM_PREFIX}pixi.mjs`, data: fs.readFileSync(PIXI_FILE) },
    { name: `${VM_PREFIX}dexie.mjs`, data: fs.readFileSync(DEXIE_FILE) },
  ];
  for (const [relative, code] of built.modules) {
    files.push({
      name: `${VM_PREFIX}${asJs(relative)}`,
      data: rewriteSpecifiers(relative, code, (_target, specifier) => asJs(specifier)),
    });
  }
  for (const asset of built.assets) {
    files.push({ name: `assets/${asset.target}`, data: asset.data });
  }
  if (built.kernel) {
    files.push({ name: KERNEL_NAME, data: Buffer.from(built.kernel.wasm) });
  }
  return {
    data: zipFiles(files),
    modules: built.modules.size + 2,
    assets: built.assets.length,
    kernel: kernelKind(options, built),
  };
}

/**
 * One file that carries everything.
 *
 * A plain script makes a `Blob` for each module, hands the import map their
 * addresses and only then writes the module script — a blob url has no folder
 * for `../` to point at, so every specifier is rewritten to a bare name on the
 * way in, and that also lets modules that import each other all exist before
 * any of them runs.
 *
 * The work's own file addresses are left exactly as they were: the runner picks
 * a costume by what its address ends with, so the files answer from memory
 * through `fetch` instead of being swapped for blob or data addresses.
 */
export function exportHtml(options: ExportOptions): ExportResult {
  const built = build(options);
  const sources: Record<string, string> = {};
  for (const [relative, code] of built.modules) {
    sources[`${BARE_PREFIX}${relative}`] = rewriteSpecifiers(
      relative,
      code,
      (target) => `${BARE_PREFIX}${target}`,
    );
  }
  sources['pixi.js'] = fs.readFileSync(PIXI_FILE, 'utf-8');
  sources.dexie = fs.readFileSync(DEXIE_FILE, 'utf-8');

  const files: Record<string, [string, string]> = {};
  for (const asset of built.assets) {
    files[asset.target] = [asset.type, asset.data.toString('base64')];
  }
  if (built.kernel) {
    files[KERNEL_NAME] = ['application/wasm', Buffer.from(built.kernel.wasm).toString('base64')];
  }
  const config = { ...built.config, ...kernelLinks(options, built, KERNEL_NAME) };
  const runner = bootModule(
    {
      boot: literal(`${BARE_PREFIX}web/boot.ts`),
      project: 'window.__tessProject',
      // The costumes are answered from this page's memory, and a worker of its own
      // cannot be reached from here, so the textures are read on this thread.
      prelude: `import { loadTextures } from 'pixi.js';\nloadTextures.config.preferWorkers = false;`,
    },
    config,
  );

  const bootstrap = `
const SOURCES = ${literal(sources)};
const FILES = ${literal(files)};
const PROJECT = ${literal(JSON.stringify(options.project))};
const RUNNER = ${literal(runner)};

// 담아 둔 파일을 주소 대신 fetch 가 바로 내줍니다. 마지막 조각으로 찾으므로,
// 브라우저가 상대 주소를 절대 주소로 바꾼 뒤에도 같은 파일에 닿습니다.
const bytesOf = (base64) => {
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let at = 0; at < raw.length; at += 1) out[at] = raw.charCodeAt(at);
  return out;
};
const byTail = new Map();
for (const name of Object.keys(FILES)) {
  const tail = name.split('/').pop();
  if (!byTail.has(tail)) byTail.set(tail, []);
  byTail.get(tail).push(name);
}
const lookup = (url) => {
  const clean = String(url).split(/[?#]/)[0];
  if (FILES[clean]) return clean;
  const names = byTail.get(clean.split('/').pop()) || [];
  return names.find((name) => clean.endsWith(name)) || null;
};
const served = fetch;
window.fetch = function (input, init) {
  const url = typeof input === 'string' ? input : input && input.url;
  const name = url && lookup(url);
  if (!name) return served.call(this, input, init);
  const [type, base64] = FILES[name];
  return Promise.resolve(new Response(bytesOf(base64), { headers: { 'content-type': type } }));
};

const blobUrl = (text, type) => URL.createObjectURL(new Blob([text], { type }));
const imports = {};
for (const name of Object.keys(SOURCES)) imports[name] = blobUrl(SOURCES[name], 'text/javascript');
const map = document.createElement('script');
map.type = 'importmap';
map.textContent = JSON.stringify({ imports: imports });
document.head.appendChild(map);

window.__tessProject = JSON.parse(PROJECT);
const script = document.createElement('script');
script.type = 'module';
script.src = blobUrl(RUNNER, 'text/javascript');
document.body.appendChild(script);
`;
  const html = page(options.name, '', `<script>${bootstrap}</script>`);
  return {
    data: Buffer.from(html, 'utf-8'),
    modules: Object.keys(sources).length,
    assets: built.assets.length,
    kernel: kernelKind(options, built),
  };
}
