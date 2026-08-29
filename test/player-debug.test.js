// 디버그 패널 UI(src/player/debug-ui.js)를 jsdom 에 올리고 가짜 엔트리 실행기로 눌러 본다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { playerPage } from '../src/player/template.js';
import { compileProject } from '../src/compiler/index.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const arrowDist = () => path.dirname(fileURLToPath(import.meta.resolve('@arrow-js/core')));

/** 디버그 UI 모듈을 jsdom 에 올린다. import 는 떼고 arrow-js 를 직접 넣어 준다. */
async function mountDebugPanel(t) {
  const html = playerPage({
    name: '치로', base: '/lib', summary: { scenes: 1, objects: 1, blocks: 1 }, entName: 'a.ent', reload: false,
  });
  const shell = html.slice(0, html.indexOf('<script')) + '</body></html>';
  const dom = new JSDOM(shell, { runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  t.after(() => window.close()); // 상태를 확인하는 setInterval 이 돌고 있다

  const engine = {
    state: 'stop',
    fired: [],
    isState(state) { return state === this.state; },
    toggleRun() { this.state = 'run'; },
    togglePause() { this.state = this.state === 'pause' ? 'run' : 'pause'; },
    toggleStop() { this.state = 'stop'; },
    fireEvent(type, id) { this.fired.push([type, id]); },
  };
  const blocks = {
    is_boost_mode: { func: () => '실제부스트' },
    is_touch_supported: { func: () => '실제터치' },
    is_current_device_type: { func: (sprite, script) => '실제' + script.getField('DEVICE', script) },
  };
  // 실행기가 들고 있는 값. 디버거가 고쳐 쓰면 여기가 바뀌어야 한다.
  const live = {
    variables: { v1: 42 },
    lists: { l1: [{ data: 'ㄱ' }, { data: 'ㄴ' }] },
    visible: { v1: false, l1: false },
  };
  const seen = (id) => ({
    isVisible: () => live.visible[id],
    setVisible: (value) => { live.visible[id] = value; },
  });
  const fakeVariable = (id) => (id in live.variables ? {
    ...seen(id),
    getValue: () => live.variables[id],
    setValue: (value) => { live.variables[id] = value; },
  } : null);
  const fakeList = (id) => (id in live.lists ? {
    ...seen(id),
    getArray: () => live.lists[id],
    replaceValue: (index, data) => { live.lists[id][index - 1].data = data; },
    appendValue: (data) => { live.lists[id].push({ data }); },
    deleteValue: (index) => { live.lists[id].splice(index - 1, 1); },
  } : null);

  // 무대 위 오브젝트. entity 는 엔트리가 주는 게터들만 흉내낸다.
  const entity = {
    x: 12.345, y: -7, size: 100, rotation: 0, direction: 90, visible: true,
    picture: { id: 'p2', name: '점프' },
    getX() { return this.x; }, setX(v) { this.x = v; },
    getY() { return this.y; }, setY(v) { this.y = v; },
    getSize() { return this.size; }, setSize(v) { this.size = v; },
    getRotation() { return this.rotation; }, setRotation(v) { this.rotation = v; },
    getDirection() { return this.direction; }, setDirection(v) { this.direction = v; },
    getScaleX() { return 1; }, getScaleY() { return 1; },
    getVisible() { return this.visible; },
    setVisible(v) { this.visible = v; },
    setImage(picture) { this.picture = picture; },
  };
  const stageObject = {
    id: 'o1',
    name: '치로',
    rotateMethod: 'free',
    pictures: [{ id: 'p1', name: '기본' }, { id: 'p2', name: '점프' }],
    entity,
    getPicture(id) { return this.pictures.find((p) => p.id === id) || null; },
    setRotateMethod(method) { this.rotateMethod = method; },
  };
  entity.parent = stageObject;

  const scenes = [{ id: 's1', name: '장면 1' }, { id: 's2', name: '장면 2' }];
  const scene = {
    selected: scenes[0],
    getSceneById: (sceneId) => scenes.find((s) => s.id === sceneId) || null,
    selectScene(target) { this.selected = target; },
  };

  const listeners = {};
  window.Entry = {
    engine,
    block: blocks,
    requestUpdate: false,
    scene,
    variableContainer: { getVariable: fakeVariable, getList: fakeList },
    container: { getObject: (id) => (id === 'o1' ? stageObject : null) },
    addEventListener: (name, fn) => { (listeners[name] = listeners[name] || []).push(fn); },
    dispatchEvent: (name, ...args) => (listeners[name] || []).forEach((fn) => fn(...args)),
  };
  window.tessDebugSink = (fn) => { window.__sink = fn; };
  window.tessReportError = (kind, error) => window.__sink({
    kind: String(kind), message: String(error && error.message), stack: '', time: Date.now(),
  });
  window.fetch = () => Promise.resolve({ json: () => Promise.resolve({}) });

  // arrow-js 는 Node 쪽에서 import 되므로 전역 document 가 jsdom 것을 가리켜야 한다
  const globals = ['document', 'Node', 'Element', 'HTMLElement', 'DocumentFragment',
    'Text', 'Comment', 'NodeFilter', 'MutationObserver', 'requestAnimationFrame'];
  const saved = globals.map((key) => [key, globalThis[key]]);
  for (const key of globals) globalThis[key] = window[key];
  t.after(() => { for (const [key, value] of saved) globalThis[key] = value; });

  // 브라우저가 실제로 받는 arrow-js 파일을 그대로 쓴다. 패키지 기본 진입점을 쓰면
  // 서버가 내보내는 파일과 달라져서, 그 파일만 깨져 있어도 테스트가 통과해 버린다.
  const source = fs.readFileSync(path.join(root, 'src/player/debug-ui.js'), 'utf-8');
  const arrowFile = source.match(/from '\/arrow\/([^']+)'/)[1];
  const arrow = await import(path.join(arrowDist(), arrowFile));
  window.reactive = arrow.reactive;
  window.html = arrow.html;
  window.eval(source.replace(/^import[^;]+;$/m, 'const { reactive, html } = window;'));

  const byId = (id) => window.document.getElementById(id);
  return {
    window,
    engine,
    blocks,
    live,
    entity,
    stageObject,
    scene,
    byId,
    click: (id) => byId(id).dispatchEvent(new window.MouseEvent('click')),
    choose: (id, value) => {
      byId(id).value = value;
      byId(id).dispatchEvent(new window.Event('change'));
    },
    tab: (name) => window.document.querySelector('.debug-tab[data-tab="' + name + '"]')
      .dispatchEvent(new window.MouseEvent('click')),
    settle: () => new Promise((resolve) => setTimeout(resolve, 20)),
    /** 값 칸을 눌러서 입력칸으로 바꾸고, 새 값을 넣고 Enter 를 친다 */
    async edit(node, value) {
      node.dispatchEvent(new window.MouseEvent('click'));
      await new Promise((resolve) => setTimeout(resolve, 20));
      const input = window.document.querySelector('.debug-edit-input');
      assert.ok(input, '입력칸이 열려야 한다');
      input.value = value;
      input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter' }));
      await new Promise((resolve) => setTimeout(resolve, 20));
    },
  };
}

test('디버그 패널은 탭으로 나뉘고, 한 번에 하나만 보인다', async (t) => {
  const ui = await mountDebugPanel(t);
  await ui.settle();
  const tabs = [...ui.window.document.querySelectorAll('.debug-tab')];
  assert.deepEqual(tabs.map((button) => button.dataset.tab), ['run', 'data', 'objects', 'errors']);

  // 처음엔 실행 탭
  assert.equal(ui.byId('tab-run').hidden, false);
  assert.equal(ui.byId('tab-data').hidden, true);

  ui.tab('objects');
  await ui.settle();
  assert.equal(ui.byId('tab-objects').hidden, false);
  assert.equal(ui.byId('tab-run').hidden, true);
  assert.equal(tabs.find((b) => b.dataset.tab === 'objects').getAttribute('aria-selected'), 'true');
  assert.equal(tabs.find((b) => b.dataset.tab === 'run').getAttribute('aria-selected'), 'false');
});

test('정지한 뒤에도 시작하기로 다시 실행할 수 있다', async (t) => {
  const ui = await mountDebugPanel(t);
  await ui.settle();

  ui.click('run-btn');
  assert.equal(ui.engine.state, 'run');
  ui.click('pause-btn');
  assert.equal(ui.engine.state, 'pause');
  // 일시정지 중의 시작하기는 처음부터 다시가 아니라 "이어서 하기" 다
  ui.click('run-btn');
  assert.equal(ui.engine.state, 'run');

  ui.click('stop-btn');
  assert.equal(ui.engine.state, 'stop');
  ui.click('run-btn'); // 이게 안 되던 게 원래 문제였다
  assert.equal(ui.engine.state, 'run');
});

test('실행 상태에 따라 버튼과 안내 글이 바뀐다', async (t) => {
  const ui = await mountDebugPanel(t);
  await ui.settle();

  const stateText = () => ui.window.document.querySelector('.debug-run-state').textContent;

  ui.click('stop-btn');
  await ui.settle();
  assert.match(stateText(), /멈춰/);
  assert.equal(ui.byId('pause-btn').disabled, true); // 멈춰 있으면 일시정지할 게 없다
  assert.equal(ui.byId('run-btn').disabled, false);

  ui.click('run-btn');
  await ui.settle();
  assert.match(stateText(), /실행 중/);
  assert.equal(ui.byId('run-btn').disabled, true);

  ui.click('pause-btn');
  await ui.settle();
  assert.equal(ui.byId('pause-btn').textContent, '이어서 하기');
});

test('부스트 모드 · 기기 · 터치를 디버그 창에서 정한 값으로 바꿔치기한다', async (t) => {
  const ui = await mountDebugPanel(t);
  await ui.settle();
  ui.window.tessPatchEnvironmentBlocks();
  const askMobile = { getField: () => 'mobile' };

  // 기본값은 브라우저의 진짜 값을 그대로 통과시킨다
  assert.equal(ui.blocks.is_boost_mode.func(), '실제부스트');
  assert.equal(ui.blocks.is_touch_supported.func(), '실제터치');
  assert.equal(ui.blocks.is_current_device_type.func(null, askMobile), '실제mobile');

  ui.choose('env-boost', 'true');
  assert.equal(ui.blocks.is_boost_mode.func(), true);
  ui.choose('env-boost', 'false');
  assert.equal(ui.blocks.is_boost_mode.func(), false);
  ui.choose('env-boost', ''); // 다시 실제 값으로
  assert.equal(ui.blocks.is_boost_mode.func(), '실제부스트');

  ui.choose('env-touch', 'false');
  assert.equal(ui.blocks.is_touch_supported.func(), false);

  // 기기는 "지금 기기가 X 인가?" 를 묻는 블록이라 고른 값과 같은지로 답한다
  ui.choose('env-device', 'mobile');
  assert.equal(ui.blocks.is_current_device_type.func(null, askMobile), true);
  ui.choose('env-device', 'desktop');
  assert.equal(ui.blocks.is_current_device_type.func(null, askMobile), false);
});

/** 변수·신호·함수가 담긴 작은 프로젝트 */
const dataProject = {
  scenes: [{ id: 's1', name: '장면 1' }],
  objects: [{ id: 'o1', name: '치로', scene: 's1', script: '[]' }],
  variables: [
    { id: 'v1', name: '점수', value: 0 },
    { id: 'l1', name: '기록', variableType: 'list', array: [] },
    { id: 't1', name: '초시계', variableType: 'timer' },
  ],
  messages: [{ id: 'm1', name: '게임 시작' }],
  functions: [{
    id: 'f1',
    content: JSON.stringify([[{
      type: 'function_create',
      params: [{
        type: 'function_field_label',
        params: ['스폰', { type: 'function_field_string', params: [{ type: 'stringParam_a' }, null] }],
      }],
    }]]),
  }],
};

/** 본문이 든 함수 하나짜리 작품 — 함수 코드 펼치기 검사용 */
const functionProject = {
  ...dataProject,
  functions: [{
    id: 'f1',
    content: JSON.stringify([[{
      type: 'function_create',
      params: [{
        type: 'function_field_label',
        params: ['스폰', { type: 'function_field_string', params: [{ type: 'stringParam_a' }, null] }],
      }],
      statements: [[{ id: 'b1', type: 'move_direction', params: [{ id: 'b2', type: 'number', params: ['10'] }] }]],
    }]]),
  }],
};

test('자료 탭에서 변수의 지금 값 · 신호 · 함수를 볼 수 있다', async (t) => {
  const ui = await mountDebugPanel(t);
  await ui.settle();
  ui.window.tessRenderProjectDebug(dataProject);
  ui.tab('data');
  await ui.settle();

  const variables = ui.byId('var-list').textContent;
  assert.match(variables, /점수/);
  assert.match(variables, /42/);          // 실행 중인 값을 읽어 온다
  assert.match(variables, /기록/);
  assert.match(variables, /\[2개\]/);
  assert.doesNotMatch(variables, /초시계/); // 초시계·대답은 Tess 내장이라 목록에서 뺀다

  assert.match(ui.byId('signal-list').textContent, /게임 시작/);
  const functions = ui.byId('function-list').textContent;
  assert.match(functions, /스폰/);
  assert.match(functions, /1개 인자/);
});

/** 자료 탭을 열고 변수 목록을 돌려준다 */
async function openData(ui, project = dataProject) {
  ui.window.tessRenderProjectDebug(project);
  ui.tab('data');
  await ui.settle();
  return ui.byId('var-list');
}

test('변수 값을 눌러서 바로 고칠 수 있다', async (t) => {
  const ui = await mountDebugPanel(t);
  await ui.settle();
  const list = await openData(ui);

  const cell = [...list.querySelectorAll('.debug-edit')].find((node) => node.textContent === '42');
  assert.ok(cell, '지금 값이 눌러서 고칠 수 있는 칸이어야 한다');
  await ui.edit(cell, '77');

  // 숫자로 읽히는 값은 숫자로 넣어야 계산 블록이 제대로 돈다
  assert.equal(ui.live.variables.v1, 77);
  assert.match(ui.byId('var-list').textContent, /77/);
});

test('숫자가 아닌 값은 글자 그대로 넣는다', async (t) => {
  const ui = await mountDebugPanel(t);
  await ui.settle();
  const list = await openData(ui);

  await ui.edit([...list.querySelectorAll('.debug-edit')].find((n) => n.textContent === '42'), '가나다');
  assert.equal(ui.live.variables.v1, '가나다');
});

test('리스트는 이름을 눌러 펼치고 다시 눌러 접는다', async (t) => {
  const ui = await mountDebugPanel(t);
  await ui.settle();
  const list = await openData(ui);

  const name = [...list.querySelectorAll('.debug-expand')].find((node) => node.textContent === '기록');
  assert.ok(name);
  assert.equal(list.querySelectorAll('.debug-list-items').length, 0);

  name.dispatchEvent(new ui.window.MouseEvent('click'));
  await ui.settle();
  const items = ui.byId('var-list').querySelectorAll('.debug-list-ol li');
  assert.equal(items.length, 2);
  assert.match(items[0].textContent, /ㄱ/);

  ui.byId('var-list').querySelector('.debug-expand.open').dispatchEvent(new ui.window.MouseEvent('click'));
  await ui.settle();
  assert.equal(ui.byId('var-list').querySelectorAll('.debug-list-items').length, 0);
});

test('펼친 리스트에서 항목을 고치고 넣고 지울 수 있다', async (t) => {
  const ui = await mountDebugPanel(t);
  await ui.settle();
  const list = await openData(ui);
  [...list.querySelectorAll('.debug-expand')].find((n) => n.textContent === '기록')
    .dispatchEvent(new ui.window.MouseEvent('click'));
  await ui.settle();

  // 고치기
  await ui.edit(ui.byId('var-list').querySelectorAll('.debug-list-ol .debug-edit')[1], 'ㄷ');
  assert.deepEqual(ui.live.lists.l1.map((item) => item.data), ['ㄱ', 'ㄷ']);

  // 넣기
  ui.byId('var-list').querySelector('.debug-add-btn').dispatchEvent(new ui.window.MouseEvent('click'));
  await ui.settle();
  assert.equal(ui.live.lists.l1.length, 3);

  // 지우기 (첫 항목)
  ui.byId('var-list').querySelectorAll('.debug-list-ol .debug-mini-btn')[0]
    .dispatchEvent(new ui.window.MouseEvent('click'));
  await ui.settle();
  assert.deepEqual(ui.live.lists.l1.map((item) => item.data), ['ㄷ', '']);
});

// 빈 항목은 글자가 없어서 칸의 폭이 0 이 돼 누를 수가 없었다.
test('값이 빈 리스트 항목도 눌러서 고칠 수 있다', async (t) => {
  const ui = await mountDebugPanel(t);
  await ui.settle();
  ui.live.lists.l1 = [{ data: '' }];
  const list = await openData(ui);
  [...list.querySelectorAll('.debug-expand')].find((n) => n.textContent === '기록')
    .dispatchEvent(new ui.window.MouseEvent('click'));
  await ui.settle();

  const cell = ui.byId('var-list').querySelector('.debug-list-ol .debug-edit');
  assert.ok(cell.textContent.trim().length > 0, '빈 값이어도 누를 자리가 있어야 한다');
  assert.match(cell.className, /empty/);

  await ui.edit(cell, '채움');
  assert.deepEqual(ui.live.lists.l1.map((item) => item.data), ['채움']);
});

// 펼친 항목·블록이 이름 오른쪽으로 눕지 않도록 flex 는 바로 아래 줄에만 건다.
test('펼친 리스트 항목과 함수 블록은 세로로 쌓인다', () => {
  const css = playerPage({
    name: 'a', base: '/lib', summary: { scenes: 1, objects: 1, blocks: 1 }, entName: 'a.ent', reload: false,
  });
  assert.match(css, /\.debug-rows > li \{[^}]*display: flex/);
  assert.doesNotMatch(css, /\.debug-rows li \{/);
  assert.match(css, /\.debug-rows > li\.debug-items-row \{[^}]*display: block/);
});

// 넣고 지운 결과가 화면에 바로 보여야 한다. arrow 는 처음 평가에서 읽은 것만
// 따라가므로, 접혀 있을 때 일찍 돌아가면 state.tick 을 놓쳐서 다시 안 그렸다.
test('항목을 넣고 지우면 목록이 바로 다시 그려진다', async (t) => {
  const ui = await mountDebugPanel(t);
  await ui.settle();
  const list = await openData(ui);
  [...list.querySelectorAll('.debug-expand')].find((n) => n.textContent === '기록')
    .dispatchEvent(new ui.window.MouseEvent('click'));
  await ui.settle();
  const rows = () => ui.byId('var-list').querySelectorAll('.debug-list-ol > li').length;
  assert.equal(rows(), 2);

  ui.byId('var-list').querySelector('.debug-add-btn').dispatchEvent(new ui.window.MouseEvent('click'));
  await ui.settle();
  assert.equal(rows(), 3, '넣은 항목이 바로 보여야 한다');

  ui.byId('var-list').querySelectorAll('.debug-list-ol .debug-mini-btn')[0]
    .dispatchEvent(new ui.window.MouseEvent('click'));
  await ui.settle();
  assert.equal(rows(), 2, '지운 항목이 바로 사라져야 한다');
});

// 고친 <input> 이 다음 칸에 재사용되면, value 속성을 다시 써도 화면 값이 안 따라온다.
test('한 항목을 고친 뒤 다른 항목을 열면 그 항목의 값이 뜬다', async (t) => {
  const ui = await mountDebugPanel(t);
  await ui.settle();
  const list = await openData(ui);
  [...list.querySelectorAll('.debug-expand')].find((n) => n.textContent === '기록')
    .dispatchEvent(new ui.window.MouseEvent('click'));
  await ui.settle();

  const cells = () => ui.byId('var-list').querySelectorAll('.debug-list-ol .debug-edit');
  await ui.edit(cells()[0], '바뀐값');
  assert.deepEqual(ui.live.lists.l1.map((i) => i.data), ['바뀐값', 'ㄴ']);

  // 두 번째 항목을 열면 'ㄴ' 이 떠야 한다 (앞서 고친 '바뀐값' 이 아니라)
  cells()[1].dispatchEvent(new ui.window.MouseEvent('click'));
  await ui.settle();
  assert.equal(ui.window.document.querySelector('.debug-edit-input').value, 'ㄴ');
});

test('변수와 리스트를 무대에서 보이거나 숨길 수 있다', async (t) => {
  const ui = await mountDebugPanel(t);
  await ui.settle();
  const list = await openData(ui);

  const toggles = list.querySelectorAll('.debug-toggle');
  assert.equal(toggles.length, 2); // 변수 하나, 리스트 하나
  assert.equal(toggles[0].textContent, '숨김'); // 처음엔 안 보이는 상태

  toggles[0].dispatchEvent(new ui.window.MouseEvent('click'));
  await ui.settle();
  assert.equal(ui.live.visible.v1, true);
  assert.equal(ui.byId('var-list').querySelectorAll('.debug-toggle')[0].textContent, '보임');

  ui.byId('var-list').querySelectorAll('.debug-toggle')[1]
    .dispatchEvent(new ui.window.MouseEvent('click'));
  assert.equal(ui.live.visible.l1, true);
});

test('리스트가 길어도 펼친 높이에는 한계가 있다', () => {
  const css = playerPage({
    name: 'a', base: '/lib', summary: { scenes: 1, objects: 1, blocks: 1 }, entName: 'a.ent', reload: false,
  });
  assert.match(css, /\.debug-list-items\s*\{[^}]*max-height:\s*\d+px/);
  assert.match(css, /\.debug-list-items\s*\{[^}]*overflow:\s*auto/);
});

test('함수 이름을 누르면 그 함수의 블록이 펼쳐진다', async (t) => {
  const ui = await mountDebugPanel(t);
  await ui.settle();
  ui.window.tessRenderProjectDebug(functionProject);
  ui.tab('data');
  await ui.settle();

  const name = ui.byId('function-list').querySelector('.debug-expand');
  assert.match(name.textContent, /스폰/);
  assert.equal(ui.byId('function-list').querySelectorAll('.debug-func-code').length, 0);

  name.dispatchEvent(new ui.window.MouseEvent('click'));
  await ui.settle();
  const code = ui.byId('function-list').querySelector('.debug-func-code');
  assert.ok(code, '함수 코드가 열려야 한다');
  assert.match(code.textContent, /move_direction/);

  name.dispatchEvent(new ui.window.MouseEvent('click'));
  await ui.settle();
  assert.equal(ui.byId('function-list').querySelectorAll('.debug-func-code').length, 0);
});

test('자료 탭의 신호를 눌러서 바로 보낼 수 있다', async (t) => {
  const ui = await mountDebugPanel(t);
  await ui.settle();
  ui.window.tessRenderProjectDebug(dataProject);
  ui.tab('data');
  await ui.settle();

  ui.byId('signal-list').querySelector('.debug-send-btn')
    .dispatchEvent(new ui.window.MouseEvent('click'));
  assert.deepEqual(ui.engine.fired, [['when_message_cast', 'm1']]);
});

// --- 오브젝트 탭 --------------------------------------------------------------
test('오브젝트 정보에 좌표 · 크기 · 방향 · 모양이 나온다', async (t) => {
  const ui = await mountDebugPanel(t);
  await ui.settle();
  ui.window.tessRenderProjectDebug(dataProject);
  ui.tab('objects');
  await ui.settle();

  const info = ui.byId('object-info').textContent.replace(/\s+/g, ' ');
  assert.match(info, /x 좌표12.35/);   // 소수점 둘째 자리까지만
  assert.match(info, /y 좌표-7/);
  assert.match(info, /크기100/);
  assert.match(info, /이동 방향90/);
  assert.match(info, /모양 번호2 \/ 2/);

  // 모양·회전 방식은 드롭다운, 보이기는 토글이다
  const [costume, rotate] = ui.byId('object-info').querySelectorAll('select');
  assert.deepEqual([...costume.options].map((o) => o.textContent), ['기본', '점프']);
  assert.equal(costume.value, 'p2'); // 지금 모양이 골라져 있다
  assert.deepEqual([...rotate.options].map((o) => o.value), ['free', 'vertical', 'none']);
  assert.equal(rotate.value, 'free');
  assert.equal(ui.byId('object-info').querySelector('.debug-toggle').textContent, '보임');
});

test('모양·회전 방식을 드롭다운으로 바꾸고 보이기를 토글한다', async (t) => {
  const ui = await mountDebugPanel(t);
  await ui.settle();
  ui.window.tessRenderProjectDebug(dataProject);
  ui.tab('objects');
  await ui.settle();

  const [costume, rotate] = ui.byId('object-info').querySelectorAll('select');
  costume.value = 'p1';
  costume.dispatchEvent(new ui.window.Event('change'));
  assert.equal(ui.entity.picture.id, 'p1');

  rotate.value = 'vertical';
  rotate.dispatchEvent(new ui.window.Event('change'));
  assert.equal(ui.stageObject.rotateMethod, 'vertical');

  const toggle = ui.byId('object-info').querySelector('.debug-toggle');
  toggle.dispatchEvent(new ui.window.MouseEvent('click'));
  assert.equal(ui.entity.visible, false);
  await ui.settle();
  assert.equal(ui.byId('object-info').querySelector('.debug-toggle').textContent, '숨김');
});

test('오브젝트 좌표를 눌러서 바로 옮길 수 있다', async (t) => {
  const ui = await mountDebugPanel(t);
  await ui.settle();
  ui.window.tessRenderProjectDebug(dataProject);
  ui.tab('objects');
  await ui.settle();

  const cell = [...ui.byId('object-info').querySelectorAll('.debug-edit')]
    .find((node) => node.textContent === '12.35');
  await ui.edit(cell, '-100');
  assert.equal(ui.entity.x, -100);
});

test('실행기가 아직 없으면 오브젝트 정보는 안내만 보여 준다', async (t) => {
  const ui = await mountDebugPanel(t);
  await ui.settle();
  ui.window.Entry.container = { getObject: () => null };
  ui.window.tessRenderProjectDebug(dataProject);
  ui.tab('objects');
  await ui.settle();
  assert.match(ui.byId('object-info').textContent, /한 번 실행해 보세요/);
});

// arrow 1.0.6 은 조각을 떼어낼 때 큐에 남은 갱신을 걷어내지 않아서, 오브젝트를 바꿀 때
// 줄이 생기거나 없어지면 `expressionPool[effect] is not a function` 으로 터진다.
// 그래서 줄 구성은 언제나 같아야 하고, 안 쓰는 줄은 hidden 으로만 감춰야 한다.
test('오브젝트 정보의 줄 구성은 상황이 달라져도 그대로다', async (t) => {
  const ui = await mountDebugPanel(t);
  await ui.settle();
  const labels = () => [...ui.byId('object-info').querySelectorAll('li')]
    .map((li) => li.querySelector('.key')?.textContent ?? '');

  ui.window.tessRenderProjectDebug(dataProject);
  ui.tab('objects');
  await ui.settle();
  const withObject = labels();
  assert.ok(withObject.length > 5);

  // 실행기가 이 오브젝트를 모를 때도 줄 수는 같고, 값 줄만 숨는다
  ui.window.Entry.container = { getObject: () => null };
  ui.click('debug-toggle'); // 패널을 열면 값 새로고침이 돌기 시작한다
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.deepEqual(labels(), withObject);
  const hidden = [...ui.byId('object-info').querySelectorAll('li')].filter((li) => li.hasAttribute('hidden'));
  assert.equal(hidden.length, withObject.length - 1); // 안내 줄 하나만 남는다
  assert.match(ui.byId('object-info').textContent, /한 번 실행해 보세요/);
});

test('글상자는 글 내용을 고칠 수 있고, 모양 줄은 감춘다', async (t) => {
  const ui = await mountDebugPanel(t);
  await ui.settle();
  ui.entity.text = '점수: 0';
  ui.entity.setText = (value) => { ui.entity.text = value; };
  ui.window.tessRenderProjectDebug(dataProject);
  ui.tab('objects');
  await ui.settle();

  const row = (label) => [...ui.byId('object-info').querySelectorAll('li')]
    .find((li) => li.querySelector('.key')?.textContent === label);
  assert.equal(row('글 내용').hasAttribute('hidden'), false);
  assert.equal(row('모양').hasAttribute('hidden'), true); // 글상자에는 모양이 없다

  await ui.edit(row('글 내용').querySelector('.debug-edit'), '점수: 99');
  assert.equal(ui.entity.text, '점수: 99');
});

test('장면 바로가기로 그 장면으로 넘어간다', async (t) => {
  const ui = await mountDebugPanel(t);
  await ui.settle();
  ui.window.tessRenderProjectDebug({
    ...dataProject,
    scenes: [{ id: 's1', name: '장면 1' }, { id: 's2', name: '장면 2' }],
  });
  ui.tab('objects');
  await ui.settle();

  const buttons = ui.byId('scene-tree').querySelectorAll('.debug-scene-go');
  assert.equal(buttons.length, 2);
  assert.equal(ui.scene.selected.id, 's1');

  buttons[1].dispatchEvent(new ui.window.MouseEvent('click'));
  assert.equal(ui.scene.selected.id, 's2');
});

test('항목 추가 단추는 목록 맨 위에 있다', async (t) => {
  const ui = await mountDebugPanel(t);
  await ui.settle();
  const list = await openData(ui);
  [...list.querySelectorAll('.debug-expand')].find((n) => n.textContent === '기록')
    .dispatchEvent(new ui.window.MouseEvent('click'));
  await ui.settle();

  const box = ui.byId('var-list').querySelector('.debug-list-items');
  const kids = [...box.children];
  assert.ok(kids[0].classList.contains('debug-add-btn'), '추가 단추가 첫 자식이어야 한다');
  assert.ok(kids.indexOf(box.querySelector('.debug-list-ol')) > 0);
});

// --- Ctrl+Shift 로 무대에서 오브젝트 고르기 --------------------------------------
test('Ctrl+Shift 로 무대를 누르면 그 오브젝트가 디버거에서 열린다', async (t) => {
  const ui = await mountDebugPanel(t);
  await ui.settle();
  ui.window.tessRenderProjectDebug({
    ...dataProject,
    objects: [
      { id: 'o0', name: '다른', scene: 's1', script: '[]' },
      { id: 'o1', name: '치로', scene: 's1', script: '[]' },
    ],
  });
  await ui.settle();
  ui.window.tessWatchStagePicks();

  // 처음엔 첫 오브젝트가 골라져 있다
  assert.equal(ui.byId('object-info-name').textContent, '— 다른');

  const stage = ui.byId('workspace');
  stage.dispatchEvent(new ui.window.MouseEvent('pointerdown', {
    bubbles: true, button: 0, ctrlKey: true, shiftKey: true,
  }));
  ui.window.Entry.dispatchEvent('entityClick', ui.entity);
  await ui.settle();

  assert.equal(ui.byId('object-info-name').textContent, '— 치로');
  assert.equal(ui.byId('tab-objects').hidden, false); // 오브젝트 탭이 열린다
});

test('그냥 누른 것은 디버거가 가로채지 않는다', async (t) => {
  const ui = await mountDebugPanel(t);
  await ui.settle();
  ui.window.tessRenderProjectDebug({
    ...dataProject,
    objects: [
      { id: 'o0', name: '다른', scene: 's1', script: '[]' },
      { id: 'o1', name: '치로', scene: 's1', script: '[]' },
    ],
  });
  await ui.settle();
  ui.window.tessWatchStagePicks();

  const stage = ui.byId('workspace');
  stage.dispatchEvent(new ui.window.MouseEvent('pointerdown', { bubbles: true, button: 0 }));
  ui.window.Entry.dispatchEvent('entityClick', ui.entity);
  await ui.settle();

  assert.equal(ui.byId('object-info-name').textContent, '— 다른'); // 그대로다
});

test('오브젝트를 고르는 동안에는 작품의 클릭 이벤트가 돌지 않는다', async (t) => {
  const ui = await mountDebugPanel(t);
  await ui.settle();
  ui.window.tessRenderProjectDebug(dataProject);
  await ui.settle();
  ui.window.tessWatchStagePicks();

  const fired = [];
  ui.window.Entry.engine.fireEventOnEntity = (type) => fired.push(type);

  const stage = ui.byId('workspace');
  stage.dispatchEvent(new ui.window.MouseEvent('pointerdown', {
    bubbles: true, button: 0, ctrlKey: true, shiftKey: true,
  }));
  ui.window.Entry.engine.fireEventOnEntity('when_object_click', ui.entity);
  assert.deepEqual(fired, [], '고르는 동안에는 작품 이벤트를 막는다');

  // 고르기가 끝나면 원래대로 돌아온다
  await ui.settle();
  ui.window.Entry.engine.fireEventOnEntity('when_object_click', ui.entity);
  assert.deepEqual(fired, ['when_object_click']);
});

// --- 딱 붙이기 (sticky) --------------------------------------------------------
test('섹션을 끝까지 줄이면 딱 붙어서 높이가 0 이 된다', async (t) => {
  const ui = await mountDebugPanel(t);
  await ui.settle();
  const section = ui.byId('tab-run').querySelector('.debug-section');
  const drag = (from, to) => {
    section.querySelector('.debug-vresize')
      .dispatchEvent(new ui.window.MouseEvent('mousedown', { clientY: from, bubbles: true }));
    ui.window.dispatchEvent(new ui.window.MouseEvent('mousemove', { clientY: to }));
    ui.window.dispatchEvent(new ui.window.MouseEvent('mouseup'));
  };

  // jsdom 은 실제 높이를 0 으로 재므로 끌어당긴 만큼이 그대로 높이가 된다
  drag(100, 130); // 30px — 딱 붙는 크기보다 작다
  await ui.settle();
  assert.match(section.getAttribute('style'), /height:0px/);
  assert.match(section.getAttribute('class'), /collapsed/);
  // 손잡이는 접힌 자리에 그대로 남아 있어야 다시 끌 수 있다
  assert.equal(section.querySelectorAll('.debug-vresize').length, 1);

  drag(100, 200); // 다시 끌어내면 딱 하고 펴진다
  await ui.settle();
  assert.match(section.getAttribute('style'), /height:100px/);
  assert.doesNotMatch(section.getAttribute('class'), /collapsed/);
});

test('패널도 끝까지 줄이면 딱 붙어서 폭이 0 이 된다', async (t) => {
  const ui = await mountDebugPanel(t);
  await ui.settle();
  ui.window.innerWidth = 1200;
  const panel = ui.byId('debug-panel');
  const drag = (to) => {
    ui.byId('debug-resize-handle')
      .dispatchEvent(new ui.window.MouseEvent('mousedown', { clientX: 800, bubbles: true }));
    ui.window.dispatchEvent(new ui.window.MouseEvent('mousemove', { clientX: to }));
    ui.window.dispatchEvent(new ui.window.MouseEvent('mouseup'));
  };

  drag(1180); // 폭 20px — 딱 붙는 크기보다 작다
  assert.equal(panel.style.width, '0px');
  assert.match(panel.className, /collapsed/);

  drag(1000); // 200px — 다시 보인다
  assert.equal(panel.style.width, '200px');
  assert.doesNotMatch(panel.className, /collapsed/);
});

test('접어 둔 패널을 다시 열면 폭이 되살아난다', async (t) => {
  const ui = await mountDebugPanel(t);
  await ui.settle();
  ui.window.innerWidth = 1200;
  ui.byId('debug-resize-handle')
    .dispatchEvent(new ui.window.MouseEvent('mousedown', { clientX: 800, bubbles: true }));
  ui.window.dispatchEvent(new ui.window.MouseEvent('mousemove', { clientX: 1190 }));
  ui.window.dispatchEvent(new ui.window.MouseEvent('mouseup'));
  assert.equal(ui.byId('debug-panel').style.width, '0px');

  ui.click('debug-toggle');
  await ui.settle();
  assert.equal(ui.byId('debug-panel').style.width, '');
});

test('작품 안의 이름은 어떤 것도 태그가 되지 않는다 (XSS)', async (t) => {
  const ui = await mountDebugPanel(t);
  await ui.settle();
  ui.window.tessRenderProjectDebug({
    scenes: [{ id: 's1', name: '<img src=x onerror=window.PWNED=1>' }],
    objects: [{ id: 'o1', name: '<script>window.PWNED=1</script>', scene: 's1', script: '[]' }],
    variables: [{ id: 'v9', name: '<svg onload=window.PWNED=1>', value: '<b>굵게</b>' }],
    messages: [{ id: 'm9', name: '<iframe src=javascript:1>' }],
    functions: [],
  });
  ui.tab('data');
  await ui.settle();

  // 작품 이름이 들어가는 영역만 본다 (실행 탭의 안내 글에는 우리가 쓴 <b> 가 있다)
  const areas = ['#tab-data', '#tab-objects'];
  const selector = areas.flatMap((area) => ['img', 'svg', 'iframe', 'script', 'b'].map((tag) => area + ' ' + tag)).join(', ');
  const injected = ui.window.document.querySelectorAll(selector);
  assert.equal(injected.length, 0, [...injected].map((node) => node.outerHTML).join('\n'));
  assert.equal(ui.window.PWNED, undefined);
  // 그래도 사람이 읽을 수 있게 글자로는 그대로 보여야 한다
  assert.match(ui.byId('scene-tree').textContent, /<img src=x/);
});

test('페이지에 넣는 값은 HTML 로도 스크립트로도 새어 나가지 않는다', () => {
  const evil = '</script><img src=x onerror=alert(1)><svg/onload=alert(2)>"\'`&<>';
  const html = playerPage({
    name: evil, base: evil, summary: { scenes: 1, objects: 1, blocks: 1 }, entName: evil, reload: true,
  });

  // 태그를 만들 수 있는 형태가 하나도 없어야 한다 (전부 &lt; 로 막혔거나 < 로 들어갔다)
  const withoutComments = html.replace(/\/\/[^\n]*/g, '');
  assert.doesNotMatch(withoutComments, /<img/);
  assert.doesNotMatch(withoutComments, /<svg/);

  // 인라인 스크립트 안에 날 </script 가 없어야 하고, 전부 파싱돼야 한다
  const bodies = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.equal(bodies.length, 4);
  for (const body of bodies) {
    assert.doesNotMatch(body, /<\/script/i);
    assert.doesNotThrow(() => new Function(body)); // eslint-disable-line no-new-func
  }
});

test('탭 안의 섹션들은 마지막을 빼고 위아래로 크기를 조절할 수 있다', async (t) => {
  const ui = await mountDebugPanel(t);
  await ui.settle();

  const sections = [...ui.byId('tab-run').querySelectorAll('.debug-section')];
  assert.equal(sections.length, 2);
  // 마지막 섹션은 남은 높이를 채우므로 손잡이가 없다
  assert.equal(sections[0].querySelectorAll('.debug-vresize').length, 1);
  assert.equal(sections[1].querySelectorAll('.debug-vresize').length, 0);
  assert.match(sections[0].getAttribute('style'), /height:200px/);

  const handle = sections[0].querySelector('.debug-vresize');
  handle.dispatchEvent(new ui.window.MouseEvent('mousedown', { clientY: 100, bubbles: true }));
  ui.window.dispatchEvent(new ui.window.MouseEvent('mousemove', { clientY: 160 }));
  ui.window.dispatchEvent(new ui.window.MouseEvent('mouseup'));
  await ui.settle();

  // jsdom 은 실제 높이를 0 으로 재므로 끌어당긴 만큼(60px)이 그대로 높이가 된다
  assert.match(sections[0].getAttribute('style'), /height:60px/);
});

test('패널 폭은 좌우로 조절할 수 있다', async (t) => {
  const ui = await mountDebugPanel(t);
  await ui.settle();
  ui.window.innerWidth = 1200;

  const handle = ui.byId('debug-resize-handle');
  handle.dispatchEvent(new ui.window.MouseEvent('mousedown', { clientX: 800, bubbles: true }));
  ui.window.dispatchEvent(new ui.window.MouseEvent('mousemove', { clientX: 700 }));
  ui.window.dispatchEvent(new ui.window.MouseEvent('mouseup'));

  assert.equal(ui.byId('debug-panel').style.width, '500px');
});

test('패널이 실제로 그려진다 (arrow-js 목록 렌더 회귀)', async (t) => {
  // arrow-js 1.0.6 의 index.min.mjs 는 목록을 그리지 못하고 내부 함수를 글자로 찍는다.
  // 브라우저가 받는 파일이 바뀌었을 때 이 테스트가 걸린다.
  const ui = await mountDebugPanel(t);
  await ui.settle();
  const panel = ui.byId('debug-panel');

  assert.equal(panel.querySelectorAll('.debug-tab').length, 4);
  assert.equal(panel.querySelectorAll('.debug-section').length, 9);
  assert.deepEqual(
    [...panel.querySelectorAll('.debug-section h3')].map((h) => h.textContent.trim()),
    ['실행 제어', '실행 환경 흉내내기', '변수 · 리스트', '신호', '함수',
      '장면 · 오브젝트', '오브젝트 정보', '컴파일된 블록', '오류 로그'],
  );

  // 자바스크립트 소스가 화면에 글자로 새어 나오면 안 된다
  const text = panel.textContent;
  assert.doesNotMatch(text, /appendChild|=>\s*\{|function\s*\(/);
  assert.match(text, /시작하기/);
});

test('실제 작품을 넣으면 네 탭이 모두 내용을 채운다', async (t) => {
  const ui = await mountDebugPanel(t);
  await ui.settle();

  const file = path.join(root, 'examples/all_blocks.tess');
  const { project } = compileProject(fs.readFileSync(file, 'utf-8'), { path: file });
  ui.window.tessRenderProjectDebug(project);
  await ui.settle();

  const textOf = (id) => ui.byId(id).textContent.replace(/\s+/g, ' ');

  ui.click('run-btn');
  await ui.settle();
  assert.match(textOf('tab-run'), /실행 중/);

  ui.tab('data');
  await ui.settle();
  const data = textOf('tab-data');
  assert.match(data, /점수/);            // 변수
  assert.match(data, /전역 · 변수/);
  assert.match(data, /기록 전역 · 리스트 \[3개\] \[1,2,3\]/); // 실행 전이라 초기값을 보여 준다
  assert.match(data, /체력 주인공 · 변수 100/);
  assert.match(data, /신호1/);
  assert.match(data, /두배 … 값/);        // 라벨이 중간에 낀 함수 이름
  assert.match(data, /값 함수/);

  ui.tab('objects');
  await ui.settle();
  const objects = textOf('tab-objects');
  assert.match(objects, /주인공/);
  assert.match(objects, /when_run_button_click/);
  assert.match(objects, /스크립트 1/);
  assert.ok(ui.byId('block-tree').querySelectorAll('li').length > 20, '블록 트리가 펼쳐져야 한다');

  ui.window.tessReportError('실행 오류', new Error('일부러 낸 오류'));
  await ui.settle();
  assert.match(textOf('tab-errors'), /일부러 낸 오류/);
  // 오류가 나면 오류 탭으로 넘어간다
  assert.equal(ui.window.document.querySelector('.debug-tab[aria-selected="true"]').dataset.tab, 'errors');
});
