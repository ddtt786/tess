// Tests the preview server started by `tess run`
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileProject } from '../src/compiler/index.js';
import { makeEntryBundle } from '../src/compiler/bundle.js';
import { serveProject, findLocalRuntime } from '../src/player/server.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function compileExample() {
  const file = path.join(root, 'examples/all_blocks.tess');
  const result = compileProject(fs.readFileSync(file, 'utf-8'), { path: file });
  assert.deepEqual(result.errors, []);
  return result;
}

async function withServer(options, body) {
  const result = compileExample();
  const server = await serveProject({
    project: result.project,
    bundle: makeEntryBundle(result.project, result.assets),
    assets: result.assets,
    name: result.project.name,
    port: 0,
    ...options,
  });
  try {
    await body(server, result);
  } finally {
    await server.close();
  }
}

test('작품과 실행 페이지를 내보낸다', async () => {
  await withServer({}, async (server, result) => {
    const page = await (await fetch(server.url)).text();
    assert.match(page, /블록 검증/);
    assert.match(page, /장면 2 · 오브젝트 4 · 블록 \d+/);
    assert.match(page, /Entry\.loadProject/);

    const project = await (await fetch(`${server.url}project.json`)).json();
    assert.equal(project.scenes.length, result.project.scenes.length);
    assert.equal(project.objects.length, result.project.objects.length);
  });
});

test('실행하기 전에 글상자 폰트를 먼저 내려받는다', async () => {
  // Custom fonts (Nanum Gothic, DungGeunMo, ...) are only declared via @font-face;
  // the actual file arrives late, on first use. Canvas text does not repaint
  // automatically once a font arrives late, so any text box visible at startup
  // would stay stuck on a fallback font. Fonts used by the project must be
  // preloaded before Entry.loadProject/toggleRun executes any blocks — this
  // test verifies the page script actually preserves that order.
  await withServer({}, async (server) => {
    const page = await (await fetch(server.url)).text();

    const preloadCall = page.indexOf('preloadTextFonts(project)');
    const loadProjectCall = page.indexOf('Entry.loadProject(project)');
    assert.notEqual(preloadCall, -1, 'must preload fonts');
    assert.notEqual(loadProjectCall, -1);
    assert.ok(
      preloadCall < loadProjectCall,
      'must preload fonts before calling Entry.loadProject',
    );

    // preloadTextFonts itself must trigger an actual download via document.fonts.load
    // (just attaching a <link> CSS tag doesn't fetch the font until it's actually used).
    assert.match(page, /document\.fonts\.load/);
    assert.match(page, /document\.fonts\.ready/);
  });
});

test('작품 파일(.ent)을 내려받을 수 있다', async () => {
  await withServer({}, async (server) => {
    const page = await (await fetch(server.url)).text();
    const href = page.match(/href="\/([^"]+\.ent)"/)[1];
    const response = await fetch(server.url + encodeURIComponent(href));
    assert.equal(response.status, 200);

    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.length % 512, 0);
    assert.equal(bytes.subarray(0, 100).toString('utf-8').replace(/\0+$/, ''), 'temp/project.json');
  });
});

test('없는 주소는 404 를 준다', async () => {
  await withServer({}, async (server) => {
    assert.equal((await fetch(`${server.url}없는것`)).status, 404);
  });
});

test('설치된 entryjs 가 없으면 CDN 을 가리킨다', async () => {
  await withServer({ cwd: os.tmpdir() }, async (server) => {
    assert.match(server.runtime, /^CDN/);
    const page = await (await fetch(server.url)).text();
    // @entrylabs/entry itself is fetched from unpkg — jsDelivr blocks even
    // entry.min.js with 403 because this package exceeds its 150MB limit
    // (see the CDN constant comment in server.js).
    assert.match(page, /unpkg\.com\/@entrylabs\/entry/);
    // remaining third-party libraries (jquery, createjs, @entrylabs/tool, ...) come from jsDelivr
    assert.match(page, /cdn\.jsdelivr\.net/);
    // page includes a fallback message for when loading fails
    assert.match(page, /엔트리 실행기를 불러오지 못했습니다/);
    assert.match(page, /playentry\.org/);
  });
});

test('설치된 entryjs 가 있으면 그것을 내보낸다', async (t) => {
  const fake = fs.mkdtempSync(path.join(os.tmpdir(), 'tess-runtime-'));
  const dist = path.join(fake, 'node_modules', '@entrylabs', 'entry', 'dist');
  fs.mkdirSync(dist, { recursive: true });
  fs.writeFileSync(path.join(dist, 'entry.min.js'), 'window.Entry = {};');
  t.after(() => fs.rmSync(fake, { recursive: true, force: true }));

  assert.ok(findLocalRuntime(fake));

  await withServer({ cwd: fake }, async (server) => {
    assert.match(server.runtime, /^설치된/);
    const page = await (await fetch(server.url)).text();
    assert.match(page, /src="\/lib\/dist\/entry\.min\.js"/);

    const runtime = await fetch(`${server.url}lib/dist/entry.min.js`);
    assert.equal(runtime.status, 200);
    assert.equal(await runtime.text(), 'window.Entry = {};');
  });
});

test('lib 바깥 파일은 주지 않는다', async (t) => {
  const fake = fs.mkdtempSync(path.join(os.tmpdir(), 'tess-runtime-'));
  const dist = path.join(fake, 'node_modules', '@entrylabs', 'entry', 'dist');
  fs.mkdirSync(dist, { recursive: true });
  fs.writeFileSync(path.join(dist, 'entry.min.js'), 'x');
  fs.writeFileSync(path.join(fake, 'secret.txt'), '비밀');
  t.after(() => fs.rmSync(fake, { recursive: true, force: true }));

  await withServer({ cwd: fake }, async (server) => {
    const escaped = await fetch(`${server.url}lib/${encodeURIComponent('../../../secret.txt')}`);
    assert.equal(escaped.status, 404);
  });
});

test('엔트리 글꼴 CSS 를 하나씩 <link> 로 직접 붙인다', async () => {
  // The bundled fonts_2023_10.css file is 22 lines of @import, not @font-face.
  // @import blocks the next request until that CSS is fetched and parsed, so
  // fonts arrive late — and preloadTextFonts finds nothing to preload in the meantime.
  await withServer({}, async (server) => {
    const page = await (await fetch(server.url)).text();
    const hrefs = [...page.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map((m) => m[1]);
    const fontHrefs = hrefs.filter((href) => href.includes('/uploads/fonts/'));

    assert.equal(fontHrefs.length, 22, fontHrefs.join('\n'));
    for (const href of fontHrefs) {
      assert.match(href, /^https:\/\/entry-cdn\.pstatic\.net\/uploads\/fonts\/[\w.]+\.css$/);
    }
    // the bundled file (a list of @import statements, not an actual font) must not be used
    assert.ok(!fontHrefs.some((href) => href.includes('fonts_2023_10')), 'fonts_2023_10.css must be excluded');
    for (const name of ['nanum_gothic', 'dunggeunmo_2023', 'd2coding_2023', 'SDShabang_2023']) {
      assert.ok(fontHrefs.some((href) => href.endsWith('/' + name + '.css')), name + ' is missing');
    }
  });
});

test('캔버스 그리기 해상도는 처음 한 번만 정하고, 그 뒤에는 CSS 크기만 바꾼다', async () => {
  // Changing the width/height attributes clears the drawing surface and desyncs
  // the stage transform, so a window resize must only touch the CSS size.
  await withServer({}, async (server) => {
    const ui = await (await fetch(`${server.url}debug-ui.js`)).text();

    assert.match(ui, /const setCanvasResolution = \(\) => \{/);
    assert.match(ui, /if \(resolutionFixed\) return;/);
    assert.match(ui, /resolutionFixed = true;/);

    const layout = ui.slice(ui.indexOf('function layoutCanvas()'), ui.indexOf('window.addEventListener(\'resize\''));
    assert.match(layout, /canvas\.style\.width/);
    assert.match(layout, /canvas\.style\.height/);
    assert.doesNotMatch(layout, /canvasEl\.width\s*=/);
    assert.doesNotMatch(layout, /canvasEl\.height\s*=/);
  });
});

test('디버그 UI 와 arrow-js 를 모듈로 내보낸다', async () => {
  await withServer({}, async (server) => {
    const page = await (await fetch(server.url)).text();
    assert.match(page, /<script type="module" src="\/debug-ui\.js"><\/script>/);

    const ui = await fetch(`${server.url}debug-ui.js`);
    assert.equal(ui.status, 200);
    const uiSource = await ui.text();
    const arrowFile = uiSource.match(/from '\/arrow\/([^']+)'/)[1];
    assert.equal((await fetch(`${server.url}arrow/${arrowFile}`)).status, 200);
    // must not serve files outside the arrow folder
    const escaped = await fetch(`${server.url}arrow/${encodeURIComponent('../../../package.json')}`);
    assert.equal(escaped.status, 404);
  });
});
