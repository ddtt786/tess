/**
 * 디버그 패널(`packages/player/src/debug-ui.ts`)을 tessvm 어댑터 위에 올려서,
 * 엔트리 실행기 없이도 패널이 작품을 그대로 몰 수 있는지 확인합니다.
 *
 * 브라우저에서 도는 그 파일 그대로(타입만 지운 것)를 jsdom 에 올리고, 실행기 자리에는
 * `makeVmRuntime` 이 만든 어댑터를 놓습니다 — 실제 실행 페이지와 같은 구성입니다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { compileProject } from '@tess/compiler';
import { findPreactDir } from '@tess/player';
import { Vm, makeVmRuntime, serveVm, stage } from '@tess/vm';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const SOURCE = `
var score = 0
list items = ["ㄱ", "ㄴ"]

scene "첫 장면":
  object "고양이":
    when start do
      score += 1
    end
    when signal "다시" do
      score = 100
    end
  end
end

scene "둘째 장면":
  object "표지":
    when scene start do
      score = 7
    end
  end
end
`;

/** 화면이 없는 렌더러. 어댑터가 무대를 다시 그릴 때 부르는 것만 받아 센다. */
function stubRenderer() {
  return {
    flushed: 0,
    app: { canvas: null as unknown as HTMLCanvasElement },
    addEntity() {},
    removeEntity() {},
    flush(this: { flushed: number }) {
      this.flushed += 1;
    },
  };
}

/**
 * 실행 페이지가 만드는 것과 같은 핸들을 화면 없이 꾸민다.
 * 어댑터가 쓰는 것은 vm · renderer · 실행 제어 · 처음 환경값뿐이다.
 */
function makeHandle(vm: Vm, renderer: ReturnType<typeof stubRenderer>) {
  return {
    vm,
    renderer: renderer as never,
    audio: null as never,
    stage,
    defaultBoost: false,
    defaultTouch: false,
    defaultDeviceType: 'desktop' as const,
    start: () => vm.start(),
    stop: () => {
      vm.stop();
      vm.reset();
    },
    pause: () => vm.pause(),
    relayout: () => {},
    setStageSize: () => {},
  };
}

/** 패널을 jsdom 에 올리고, 실행기 자리에 tessvm 어댑터를 놓는다. */
async function mountPanelOnVm(t: any) {
  const compiled = compileProject(SOURCE, { path: 'test.tess' });
  assert.ok(compiled.project, compiled.errors[0]?.message ?? '컴파일 실패');
  const project = compiled.project as any;

  const vm = new Vm({ renderer: null, audio: null });
  vm.load(project);
  const renderer = stubRenderer();
  const handle = makeHandle(vm, renderer);

  const dom = new JSDOM(
    '<!doctype html><html><body>'
      + '<button id="debug-toggle"><span id="debug-badge" hidden>0</span></button>'
      + '<aside id="debug-panel"></aside>'
      + '</body></html>',
    { runScripts: 'outside-only', pretendToBeVisual: true },
  );
  const window: any = dom.window;
  t.after(() => window.close());

  window.tessRuntime = makeVmRuntime(handle as never);
  window.tessDebugSink = (receive: any) => {
    window.__sink = receive;
  };
  window.__errors = [];
  window.tessReportError = (kind: string, error: any) => {
    window.__errors.push({ kind, message: String(error && error.message) });
    window.__sink?.({ kind, message: String(error && error.message), stack: '', time: Date.now() });
  };

  const globals = ['document', 'Node', 'Element', 'HTMLElement', 'DocumentFragment',
    'Text', 'Comment', 'NodeFilter', 'MutationObserver', 'requestAnimationFrame'];
  const scope = globalThis as Record<string, unknown>;
  const saved = globals.map((key) => [key, scope[key]] as const);
  for (const key of globals) scope[key] = window[key];
  t.after(() => { for (const [key, value] of saved) scope[key] = value; });

  const source = stripTypeScriptTypes(
    fs.readFileSync(path.join(root, 'packages/player/src/debug-ui.ts'), 'utf-8'),
    { mode: 'strip' },
  );
  const preactFile = source.match(/from ["']\/preact\/([^"']+)["']/)![1];
  const preact = await import(path.join(findPreactDir()!, preactFile));
  window.h = preact.h;
  window.render = preact.render;
  window.eval(source.replace(/^import[^;]+;$/m, 'const { h, render } = window;'));
  window.tessRenderProjectDebug(project);

  const byId = (id: string) => window.document.getElementById(id);
  return {
    window, vm, renderer, project, byId,
    click: (id: string) => byId(id)!.dispatchEvent(new window.MouseEvent('click')),
    choose: (id: string, value: any) => {
      byId(id)!.value = value;
      byId(id)!.dispatchEvent(new window.Event('change'));
    },
    tab: (name: string) => window.document
      .querySelector('.debug-tab[data-tab="' + name + '"]')!
      .dispatchEvent(new window.MouseEvent('click')),
    settle: () => new Promise((resolve) => setTimeout(resolve, 20)),
    /** 패널은 열려 있는 동안 0.4초마다 실행기에서 값을 다시 읽는다. */
    refresh: () => new Promise((resolve) => setTimeout(resolve, 500)),
    async edit(node: any, value: any) {
      node.dispatchEvent(new window.MouseEvent('click'));
      await new Promise((resolve) => setTimeout(resolve, 20));
      const input = window.document.querySelector('.debug-edit-input');
      assert.ok(input, '입력칸이 열려야 한다');
      input.value = value;
      input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter' }));
      await new Promise((resolve) => setTimeout(resolve, 20));
    },
    variable: (name: string) => vm.variables.find((item) => item.name === name)!,
  };
}

test('실행 탭의 단추가 VM 을 시작·일시정지·정지시킨다', async (t) => {
  const ui = await mountPanelOnVm(t);
  await ui.settle();

  ui.click('run-btn');
  assert.equal(ui.vm.state, 'run');
  ui.click('pause-btn');
  assert.equal(ui.vm.state, 'pause');
  /** 일시정지에서 시작하기는 처음부터가 아니라 이어서 실행한다. */
  ui.click('run-btn');
  assert.equal(ui.vm.state, 'run');

  ui.click('stop-btn');
  assert.equal(ui.vm.state, 'stop');
  ui.click('run-btn');
  assert.equal(ui.vm.state, 'run');
});

test('실행 환경 흉내내기는 VM 이 들고 있는 값을 바꾼다', async (t) => {
  const ui = await mountPanelOnVm(t);
  await ui.settle();
  ui.window.tessPatchEnvironmentBlocks();

  /** 아무것도 안 고르면 실행기가 들고 시작한 값 그대로다. */
  assert.equal(ui.vm.boost, false);
  assert.equal(ui.vm.deviceType, 'desktop');

  ui.choose('env-boost', 'true');
  assert.equal(ui.vm.boost, true);
  ui.choose('env-boost', '');
  assert.equal(ui.vm.boost, false);

  ui.choose('env-device', 'mobile');
  assert.equal(ui.vm.deviceType, 'mobile');
  ui.choose('env-touch', 'true');
  assert.equal(ui.vm.touch, true);
});

test('자료 탭이 VM 의 변수와 리스트를 지금 값으로 보여 주고 고쳐 쓴다', async (t) => {
  const ui = await mountPanelOnVm(t);
  await ui.settle();
  ui.click('debug-toggle');
  ui.tab('data');
  await ui.settle();

  ui.vm.start();
  ui.vm.tick(); // when start 가 score 를 1 로 만든다
  await ui.refresh();

  const rows = [...ui.window.document.querySelectorAll('#var-list li')];
  const text = rows.map((row: any) => row.textContent).join('\n');
  assert.match(text, /score/);
  assert.match(text, /items/);
  assert.match(text, /\[2개\]/, '리스트 길이가 보여야 한다');

  const cell = [...ui.window.document.querySelectorAll('#var-list .debug-edit')]
    .find((node: any) => node.textContent === '1');
  assert.ok(cell, 'score 값 칸을 찾지 못했다');
  await ui.edit(cell, '42');
  assert.equal(Number(ui.variable('score').getValue()), 42);
});

test('리스트를 펼쳐서 항목을 고치고 넣고 지운다', async (t) => {
  const ui = await mountPanelOnVm(t);
  await ui.settle();
  ui.tab('data');
  await ui.settle();

  const expand = [...ui.window.document.querySelectorAll('.debug-expand')]
    .find((node: any) => node.textContent === 'items') as any;
  assert.ok(expand, '리스트 펼치기 단추를 찾지 못했다');
  expand.dispatchEvent(new ui.window.MouseEvent('click'));
  await ui.settle();

  const items = () => ui.variable('items').getArray().map((item: any) => item.data);
  const first = ui.window.document.querySelector('.debug-list-ol .debug-edit');
  await ui.edit(first, 'ㄷ');
  assert.deepEqual(items(), ['ㄷ', 'ㄴ']);

  const add = [...ui.window.document.querySelectorAll('.debug-add-btn')][0] as any;
  add.dispatchEvent(new ui.window.MouseEvent('click'));
  assert.equal(items().length, 3);

  const remove = [...ui.window.document.querySelectorAll('.debug-list-ol .debug-mini-btn')][0] as any;
  remove.dispatchEvent(new ui.window.MouseEvent('click'));
  assert.deepEqual(items(), ['ㄴ', '']);
});

test('신호를 보내면 그 신호를 받는 스크립트가 돈다', async (t) => {
  const ui = await mountPanelOnVm(t);
  await ui.settle();
  ui.tab('data');
  await ui.settle();
  ui.vm.start();

  const send = ui.window.document.querySelector('.debug-send-btn') as any;
  assert.ok(send, '신호 보내기 단추를 찾지 못했다');
  send.dispatchEvent(new ui.window.MouseEvent('click'));
  ui.vm.tick();
  assert.equal(Number(ui.variable('score').getValue()), 100);
});

test('오브젝트 탭이 VM 의 오브젝트를 보여 주고 좌표를 옮긴다', async (t) => {
  const ui = await mountPanelOnVm(t);
  await ui.settle();
  ui.click('debug-toggle');
  ui.tab('objects');
  await ui.settle();

  assert.match(ui.byId('object-info')!.textContent, /x 좌표/);
  /** 글상자가 아닌 오브젝트에는 글 내용 칸이 없어야 한다. */
  assert.doesNotMatch(ui.byId('object-info')!.textContent, /글 내용/);

  const entity = ui.vm.targets[0]!.entity;
  entity.setX(12.345);
  await ui.refresh();

  const cell = [...ui.byId('object-info')!.querySelectorAll('.debug-edit')]
    .find((node: any) => node.textContent === '12.35');
  assert.ok(cell, '좌표 칸을 찾지 못했다');
  await ui.edit(cell, '-100');
  assert.equal(entity.getX(), -100);
});

test('장면 바로가기는 그 장면으로 넘어가서 그 장면을 실행한다', async (t) => {
  const ui = await mountPanelOnVm(t);
  await ui.settle();
  ui.tab('objects');
  await ui.settle();

  const second = ui.project.scenes[1];
  const go = [...ui.window.document.querySelectorAll('.debug-scene-go')]
    .find((node: any) => node.dataset.sceneId === second.id) as any;
  assert.ok(go, '장면 바로가기 단추를 찾지 못했다');
  go.dispatchEvent(new ui.window.MouseEvent('click'));

  assert.equal(ui.vm.currentSceneId, second.id);
  assert.equal(ui.vm.state, 'run');
  ui.vm.tick(); // 그 장면의 '장면이 시작되었을 때' 가 score 를 7 로 만든다
  assert.equal(Number(ui.variable('score').getValue()), 7);
});

test('스크립트가 터지면 오류 탭에 그 블록과 함께 쌓인다', async (t) => {
  const ui = await mountPanelOnVm(t);
  await ui.settle();

  /** 실행 페이지가 하는 것과 같은 연결 — VM 의 오류를 패널로 넘긴다. */
  ui.vm.onError = (error: any) => {
    ui.window.tessReportError('실행 오류', new Error(error.message));
    if (error.blockId) ui.window.tessHighlightBlock(error.blockId);
  };
  const target = ui.vm.targets[0]!;
  target.scripts[0]!.body = function* boom() {
    throw new Error('일부러 낸 오류');
  } as never;

  ui.vm.start();
  ui.vm.tick();
  await ui.settle();

  assert.equal(ui.window.__errors.length, 1);
  assert.match(ui.window.__errors[0].message, /일부러 낸 오류/);
  /** 오류가 난 블록을 가진 오브젝트가 열리고, 오류는 오류 탭에 쌓인다. */
  assert.equal(ui.byId('debug-badge')!.textContent, '1');
  ui.tab('errors');
  await ui.settle();
  assert.match(ui.byId('error-log')!.textContent, /일부러 낸 오류/);
});

test('실행 서버가 패널과 소스맵을 함께 내보낸다', async () => {
  const compiled = compileProject(SOURCE, { path: 'test.tess' });
  assert.ok(compiled.project, '컴파일 실패');
  const server = await serveVm({
    project: compiled.project as never,
    assets: compiled.assets,
    assetDirs: [],
    sourceMap: compiled.sourceMap,
    name: '테스트',
    port: 0,
  });
  try {
    const get = async (path: string) => {
      const response = await fetch(server.url.replace(/\/$/, '') + path);
      return { status: response.status, text: await response.text() };
    };

    const page = await get('/');
    assert.match(page.text, /<aside id="debug-panel"/);
    assert.match(page.text, /src="\/debug-ui\.js"/);
    assert.match(page.text, /makeVmRuntime/);
    /** 패널 스타일도 같은 페이지에 실려 나간다. */
    assert.match(page.text, /#debug-panel \{/);

    const ui = await get('/debug-ui.js');
    assert.equal(ui.status, 200);
    const preactFile = ui.text.match(/from ["']\/preact\/([^"']+)["']/)![1];
    assert.equal((await get('/preact/' + preactFile)).status, 200);
    /** preact 폴더 밖으로는 나갈 수 없다. */
    assert.equal((await get('/preact/' + encodeURIComponent('../../../package.json'))).status, 404);

    const sourceMap = JSON.parse((await get('/sourcemap.json')).text);
    assert.ok(Object.keys(sourceMap).length > 0, '블록마다 원본 위치가 있어야 한다');
  } finally {
    await server.close();
  }
});

test('무대 상자는 캔버스를 따라 크기가 정해지지 않는다', async () => {
  /**
   * 무대 상자 크기가 그 안의 캔버스에서 나오면, 캔버스를 맞추는 ResizeObserver 가
   * 자기가 쓴 값을 다시 읽어 `ResizeObserver loop completed with undelivered
   * notifications.` 가 납니다. 그래서 `main` 은 `#stage` 를 늘려서 채우고, 가운데
   * 정렬은 그 안쪽(`.tessvm-stage`)에서 합니다.
   */
  const compiled = compileProject(SOURCE, { path: 'test.tess' });
  const server = await serveVm({
    project: compiled.project as never,
    assets: compiled.assets,
    assetDirs: [],
    name: '테스트',
    port: 0,
  });
  try {
    const page = await (await fetch(server.url)).text();
    const css = page.slice(page.indexOf('<style>'), page.indexOf('</style>'));
    const mainRule = css.slice(css.indexOf('\nmain {'), css.indexOf('#stage {'));
    assert.doesNotMatch(mainRule, /place-items/, 'main 이 무대 상자를 내용 크기로 만들면 안 된다');
    assert.match(css, /\.tessvm-stage \{[^}]*width: 100%/);

    /** 그래도 남는 이 알림은 예외가 아니므로 빨간 오류 상자에 띄우지 않는다. */
    assert.match(page, /\/\^ResizeObserver loop\//);
  } finally {
    await server.close();
  }
});
