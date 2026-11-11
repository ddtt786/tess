/** Verifies extension-owned saves through the page, content script, and worker. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { JSDOM } from 'jsdom';
import { Vm } from '@tess/vm';
import { decompileProject } from '@tess/decompiler';
import { compileProject } from '@tess/compiler';
import type { SaveHost, StoredValue } from '../packages/tessvm/src/runtime/save.ts';
import type { EntryWork } from '../packages/extension/src/page/entry-project.ts';

type Values = Record<string, StoredValue>;
const sample = JSON.parse(fs.readFileSync(new URL('./fixtures/save-project.json', import.meta.url), 'utf8')) as EntryWork;
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const lists: Values = { '@마우스좌표x': [{ data: 12 }, { data: 34 }], '@마우스좌표y': [{ data: 56 }, { data: 78 }] };

function source(file: string): string {
  return stripTypeScriptTypes(fs.readFileSync(new URL(`../packages/extension/src/${file}`, import.meta.url), 'utf8'))
    .replace(/^import[^;]*;/gm, '').replace(/^export /gm, '');
}

function setup(saved = new Map<string, Values>()) {
  const dom = new JSDOM('', { url: `https://playentry.org/project/${sample.id}`, runScripts: 'outside-only' });
  const page = dom.window;
  const requests: Array<{ __tessvm: string; work: string }> = [];
  let receive: (message: unknown, sender: unknown, reply: (response: unknown) => void) => boolean;
  let unavailable = false;
  const worker = {
    api: { runtime: { onMessage: { addListener(listener: typeof receive) { receive = listener; } } } },
    async readWork(work: string) {
      if (unavailable) throw new Error('Storage unavailable');
      return copy(saved.get(work) ?? {});
    },
    async writeWork(work: string, _title: string, values: Values) {
      if (unavailable) throw new Error('Storage unavailable');
      saved.set(work, copy(values));
    },
  };
  vm.createContext(worker);
  vm.runInContext(source('background.ts'), worker);
  const api = {
    storage: { onChanged: { addListener() {} } },
    runtime: {
      sendMessage(message: { __tessvm: string; work: string }) {
        requests.push(message);
        return new Promise((resolve) => {
          if (!receive(message, {}, resolve)) resolve(undefined);
        });
      },
    },
  };
  Object.assign(page, {
    api,
    readSettings: async () => ({ enabled: true, svg: true, mask: true, notice: false }),
    ENABLED_KEY: 'enabled', SVG_KEY: 'svg', MASK_KEY: 'mask', NOTICE_KEY: 'notice',
  });
  let posts = 0;
  let pending = 0;
  let overflow = false;
  // Dispatch messages with the source identity supplied by real browsers.
  page.postMessage = (data: unknown) => {
    if (++posts > 30) {
      overflow = true;
      return;
    }
    pending++;
    setTimeout(() => {
      page.dispatchEvent(new page.MessageEvent('message', {
        data, source: page as unknown as Window, origin: page.location.origin,
      }));
      pending--;
    }, 0);
  };
  const context = dom.getInternalVMContext();
  vm.runInContext(source('content.ts'), context);
  vm.runInContext(`${source('page/save-bridge.ts')}\nwindow.makeStore = bridgeSaveStore;`, context);
  const make = (page as unknown as { makeStore: (id: string, title: string) => SaveHost }).makeStore;
  const host = make(sample.id, sample.name);
  return {
    page, host, make, saved, requests,
    unavailable() { unavailable = true; },
    async drain() {
      while (pending) await new Promise((done) => setTimeout(done, 0));
      assert.equal(overflow, false, 'Responses must not create another storage request');
    },
    posts: () => posts,
    close() { dom.window.close(); },
  };
}

test('저장소 왕복 요청은 한 번만 전달하고 응답은 다시 전송하지 않는다', async () => {
  const s = setup();
  try {
    assert.deepEqual(copy(await s.host.read()), {});
    await s.host.write(lists);
    await s.drain();
    assert.deepEqual(s.requests.map((message) => message.__tessvm), ['store-read', 'store-write']);
    assert.equal(s.posts(), 4);
    assert.deepEqual(s.saved.get(sample.id), lists);
  } finally { s.close(); }
});

test('응답 메시지와 알 수 없는 저장 메시지는 작업자로 보내지 않는다', async () => {
  const s = setup();
  try {
    s.page.postMessage({ __tessvm: 'store-answer', id: 1, answer: { values: {} } });
    s.page.postMessage({ __tessvm: 'store-unknown', id: 2 });
    await s.drain();
    assert.deepEqual(s.requests, []);
    assert.equal(s.posts(), 2);
  } finally { s.close(); }
});

test('다른 창에서 전달한 저장 요청은 무시한다', async () => {
  const s = setup();
  try {
    s.page.dispatchEvent(new s.page.MessageEvent('message', {
      data: { __tessvm: 'store-write', id: 1, work: sample.id, values: lists }, source: null,
    }));
    await s.drain();
    assert.deepEqual(s.requests, []);
    assert.equal(s.saved.size, 0);
  } finally { s.close(); }
});

test('저장소 오류를 호출자에게 알리고 오류 응답도 다시 전송하지 않는다', async () => {
  const s = setup();
  try {
    s.unavailable();
    await assert.rejects(s.host.read(), /Save storage is unavailable/);
    await assert.rejects(s.host.write(lists), /Save storage is unavailable/);
    await s.drain();
    assert.equal(s.requests.length, 2);
    assert.equal(s.posts(), 4);
  } finally { s.close(); }
});

test('저장된 값은 작품 ID별로 분리한다', async () => {
  const s = setup();
  try {
    await s.host.write(lists);
    const other = s.make('another-work', '다른 작품');
    assert.deepEqual(copy(await other.read()), {});
    await other.write({ '@점수': 7 });
    assert.deepEqual(copy(await s.host.read()), lists);
    assert.deepEqual(s.saved.get('another-work'), { '@점수': 7 });
    await s.drain();
  } finally { s.close(); }
});

function compiledSample() {
  const back = decompileProject(copy(sample) as never, [], { inline: true, sizes: true, positions: true });
  assert.deepEqual(back.warnings, []);
  const built = compileProject(back.source, { path: 'sample.tess', assetUrls: true, comments: new Map() });
  assert.deepEqual(built.errors, []);
  return { ...built.project!, id: sample.id };
}

async function loadSample(host: SaveHost) {
  const runner = new Vm({ renderer: null, audio: null, kernel: () => null });
  runner.load(compiledSample() as never);
  runner.save.host = host;
  await runner.save.load();
  runner.start();
  return runner;
}

const sceneName = (runner: Vm) => runner.scenes.find((scene) => scene.id === runner.currentSceneId)?.name;
const tick = (runner: Vm, count: number) => { for (let i = 0; i < count; i++) runner.tick(); };

test('작품에서 기록하고 @저장을 누르면 저장 화면과 다음 실행의 복원을 확인할 수 있다', async () => {
  const saved = new Map<string, Values>();
  const firstPage = setup(saved);
  try {
    const runner = await loadSample(firstPage.host);
    tick(runner, 45);
    assert.equal(sceneName(runner), '그리기');
    assert.equal(runner.variables.find((v) => v.name === '@확장프로그램')!.getValue(), 1);
    runner.mouseDown = true;
    runner.mouseX = 40;
    runner.mouseY = 50;
    tick(runner, 5);
    runner.mouseDown = false;
    const save = runner.targets.find((target) => target.name === '저장 아이콘')!;
    runner.fireEventOn('when_object_click', save.entity);
    runner.tick();
    await firstPage.drain();
    tick(runner, 130);
    assert.equal(sceneName(runner), '저장');
    const values = saved.get(sample.id);
    assert.ok(values, 'The save call must create a stored project');
    assert.deepEqual(Object.keys(values).sort(), ['@마우스좌표x', '@마우스좌표y']);
    assert.ok(Object.values(values).every((list) => Array.isArray(list) && list.length > 1));
    assert.equal(firstPage.requests.filter((message) => message.__tessvm === 'store-write').length, 1);
    runner.stop();
  } finally { firstPage.close(); }
  const nextPage = setup(saved);
  try {
    const next = await loadSample(nextPage.host);
    tick(next, 45);
    assert.equal(sceneName(next), '선택');
    assert.deepEqual(copy(next.variables.find((v) => v.name === '@마우스좌표x')!.getArray()), saved.get(sample.id)!['@마우스좌표x']);
    next.stop();
    await nextPage.drain();
  } finally { nextPage.close(); }
});

test('저장 관리에서 초기화한 뒤 작품을 다시 열면 초기 상태로 실행한다', async () => {
  const saved = new Map([[sample.id, copy(lists)]]);
  const s = setup(saved);
  try {
    const runner = await loadSample(s.host);
    tick(runner, 45);
    assert.equal(sceneName(runner), '선택');
    runner.stop();
    saved.delete(sample.id);
    const next = await loadSample(s.host);
    tick(next, 45);
    assert.equal(sceneName(next), '그리기');
    assert.deepEqual(next.variables.find((v) => v.name === '@마우스좌표x')!.getArray(), []);
    next.stop();
    await s.drain();
  } finally { s.close(); }
});

test('실행 버튼은 저장소를 다시 기다리지 않고 즉시 시작하고 재시작한다', async () => {
  const dom = new JSDOM('<div id="host"></div>', {
    url: `https://playentry.org/project/${sample.id}`, runScripts: 'outside-only',
  });
  let reads = 0;
  let starts = 0;
  let ready!: () => void;
  const booted = new Promise<void>((resolve) => { ready = resolve; });
  const state = {
    state: 'stop', mouseX: 0, mouseY: 0, boost: true,
    unknownBlocks: new Map(), scenes: [{ id: 's' }], currentSceneId: 's',
    readStore() { ready(); },
    save: { load() { reads++; return new Promise<void>(() => {}); } },
  };
  const handle = {
    vm: state,
    start() { starts++; state.state = 'run'; },
    stop() { state.state = 'stop'; },
    pause() { state.state = 'pause'; },
    dispose() {},
  };
  Object.assign(dom.window, {
    ASK_FIELD_STYLE: '', CHART_WINDOW_STYLE: '', EXTRAS_DIALOG_STYLE: '',
    fetchWork: async () => ({ id: sample.id, name: '작품', variables: [] }),
    thumbUrl: () => null,
    toTessProject: () => ({ project: { variables: [] }, dropped: [] }),
    signedInUser: () => null,
    bridgeSaveStore: () => ({}),
    CloudClient: class {
      setChangeListener() {}
      async connect() {}
      dispose() {}
    },
    requestAnimationFrame: (callback: () => void) => { callback(); return 0; },
    boot: async () => handle,
  });
  vm.runInContext(`${source('page/player.ts')}\nwindow.makePlayer = mountPlayer;`, dom.getInternalVMContext());
  const makePlayer = (dom.window as unknown as {
    makePlayer: (host: HTMLElement, id: string) => { dispose(): void };
  }).makePlayer;
  const player = makePlayer(dom.window.document.getElementById('host')!, sample.id);
  try {
    await booted;
    const start = dom.window.document.querySelector<HTMLButtonElement>('.tessvm-start')!;
    const stop = dom.window.document.querySelector<HTMLButtonElement>('.tessvm-stop')!;
    assert.equal(start.hidden, false);
    start.click();
    assert.equal(state.state, 'run');
    assert.equal(starts, 1);
    stop.click();
    assert.equal(state.state, 'stop');
    start.click();
    assert.equal(state.state, 'run');
    assert.equal(starts, 2);
    assert.equal(reads, 0);
  } finally {
    player.dispose();
    dom.window.close();
  }
});

test('공백이 포함된 @저장 함수나 변수가 없는 저장 시도도 정상 전달되어 작업자에 기록된다', async () => {
  const saved = new Map<string, Values>();
  const s = setup(saved);
  try {
    const rawWork = {
      id: 'work-whitespace',
      name: '여백 함수 작품',
      objects: [{
        id: 'o',
        name: 'o',
        scene: 's',
        script: JSON.stringify([[{ id: 'b1', type: 'when_run_button_click', params: [] }, { id: 'b2', type: 'func_f', params: [null] }]]),
      }],
      scenes: [{ id: 's', name: 's' }],
      variables: [
        { id: 'v', name: ' @골드 ', variableType: 'variable', value: 500, object: null },
      ],
      messages: [],
      functions: [{
        id: 'f',
        content: JSON.stringify([[{
          id: 'c', type: 'function_create', params: [{ type: 'function_field_label', params: ['@저장 ', null] }, null], statements: [[]],
        }]]),
      }],
    };
    const decomp = decompileProject(rawWork as never, [], { inline: true });
    const built = compileProject(decomp.source, { path: 'w.tess' });
    const runner = new Vm({ renderer: null, audio: null, kernel: () => null });
    runner.load({ ...built.project!, id: 'work-whitespace' } as never);
    runner.save.host = s.make('work-whitespace', '여백 함수 작품');
    await runner.save.load();
    runner.start();
    runner.tick();
    await s.drain();
    assert.deepEqual(saved.get('work-whitespace'), { '@골드': 500 });
    runner.stop();
  } finally {
    s.close();
  }
});

