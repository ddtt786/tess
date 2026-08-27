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
  const file = path.join(root, 'examples/gift_delivery/main.tess');
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
    assert.match(page, /선물 배달 대작전/);
    assert.match(page, /장면 3 · 오브젝트 10 · 블록 \d+/);
    assert.match(page, /Entry\.loadProject/);

    const project = await (await fetch(`${server.url}project.json`)).json();
    assert.equal(project.scenes.length, result.project.scenes.length);
    assert.equal(project.objects.length, result.project.objects.length);
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
