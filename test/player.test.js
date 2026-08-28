// `tess run` 이 띄우는 미리보기 서버 검사
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
  // 커스텀 폰트(나눔고딕 · DungGeunMo ...)는 @font-face 로 "선언"만 돼 있고 실제 파일은
  // 처음 쓰일 때 늦게 도착한다. 캔버스는 폰트가 늦게 와도 알아서 다시 그려주지 않으므로,
  // 시작하자마자 보이는 글상자가 대체 글꼴로 굳어 버리지 않으려면 Entry.loadProject/
  // toggleRun 으로 블록을 실행하기 '전에' 그 프로젝트가 쓰는 폰트를 전부 미리 내려받아
  // 둬야 한다 — 이 순서가 페이지 스크립트에 실제로 지켜지는지를 검사한다.
  await withServer({}, async (server) => {
    const page = await (await fetch(server.url)).text();

    const preloadCall = page.indexOf('preloadTextFonts(project)');
    const loadProjectCall = page.indexOf('Entry.loadProject(project)');
    assert.notEqual(preloadCall, -1, '폰트를 미리 불러오는 코드가 있어야 한다');
    assert.notEqual(loadProjectCall, -1);
    assert.ok(
      preloadCall < loadProjectCall,
      '폰트를 먼저 불러온 다음에 Entry.loadProject 를 불러야 한다',
    );

    // preloadTextFonts 자체는 document.fonts.load 로 실제 다운로드를 트리거해야 한다
    // (그냥 CSS 를 <link> 로 붙이기만 해서는 폰트가 실제로 쓰이기 전까진 안 받아진다).
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
    // @entrylabs/entry 본체는 unpkg 에서 받는다 — jsDelivr 는 이 패키지 전체 크기가
    // 150MB 한도를 넘어 entry.min.js 조차 403 으로 막는다(server.js CDN 상수 주석 참고).
    assert.match(page, /unpkg\.com\/@entrylabs\/entry/);
    // 나머지 서드파티 라이브러리(jquery, createjs, @entrylabs/tool ...)는 jsDelivr 에서 받는다
    assert.match(page, /cdn\.jsdelivr\.net/);
    // 못 불러왔을 때 안내가 페이지에 들어 있다
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
