/**
 * 디버그 패널 UI(`packages/player/src/debug-ui.ts`)를 jsdom 환경에 마운트하고 모의(fake) 엔트리 실행기를 통해 상호작용을 테스트합니다.
 * 
 * @example
 * ```typescript
 * const ui = await mountDebugPanel(t);
 * ui.click('run-btn');
 * ```
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { playerPage, findPreactDir } from '@tess/player';
import { compileProject } from '@tess/compiler';
import { stripTypeScriptTypes } from 'node:module';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
/**
 * preact 라이브러리는 @tess/player의 의존성 패키지입니다. 
 * 테스트 환경과 실제 실행 서버가 클라이언트에 제공하는 파일이 동일하도록 경로를 동적으로 탐색합니다.
 */
const preactDist = () => findPreactDir();

/**
 * 디버그 UI 모듈을 jsdom에 마운트합니다.
 * import 구문을 제거하고 preact를 직접 주입하여 브라우저 환경을 시뮬레이션합니다.
 *
 * @param t - 테스트 컨텍스트
 * @returns 마운트된 UI 객체 및 제어 유틸리티
 */
async function mountDebugPanel(t: any) {
  const html = playerPage({
    name: '치로', base: '/lib', summary: { scenes: 1, objects: 1, blocks: 1 }, entName: 'a.ent', reload: false,
  });
  const shell = html.slice(0, html.indexOf('<script')) + '</body></html>';
  const dom = new JSDOM(shell, { runScripts: 'outside-only', pretendToBeVisual: true });
  /**
   * 브라우저 환경을 모방하는 테스트 하네스입니다.
   * jsdom에 존재하지 않는 모의 엔트리 런타임과 tess 브리지를 window 객체에 추가합니다.
   */
  const window: any = dom.window;
  t.after(() => window.close()); /** 상태 확인용 setInterval 정리를 위해 창을 닫습니다. */

  const engine = {
    state: 'stop',
    fired: [] as Array<[string, string]>,
    isState(state: any) { return state === this.state; },
    toggleRun() { this.state = 'run'; },
    togglePause() { this.state = this.state === 'pause' ? 'run' : 'pause'; },
    toggleStop() { this.state = 'stop'; },
    fireEvent(type: string, id: string) { this.fired.push([type, id]); },
  };
  const blocks = {
    is_boost_mode: { func: () => '실제부스트' },
    is_touch_supported: { func: () => '실제터치' },
    is_current_device_type: { func: (sprite: any, script: any) => '실제' + script.getField('DEVICE', script) },
  };
  /** 
   * 실행기가 유지하는 상태 값입니다. 
   * 디버거에서 값을 수정하면 이 객체의 상태가 변경됩니다. 
   */
  const live: {
    variables: Record<string, number>;
    lists: Record<string, Array<{ data: unknown }>>;
    visible: Record<string, boolean>;
  } = {
    variables: { v1: 42 },
    lists: { l1: [{ data: 'ㄱ' }, { data: 'ㄴ' }] },
    visible: { v1: false, l1: false },
  };
  const seen = (id: string) => ({
    isVisible: () => live.visible[id],
    setVisible: (value: any) => { live.visible[id] = value; },
  });
  const fakeVariable = (id: string) => (id in live.variables ? {
    ...seen(id),
    getValue: () => live.variables[id],
    setValue: (value: any) => { live.variables[id] = value; },
  } : null);
  const fakeList = (id: string) => (id in live.lists ? {
    ...seen(id),
    getArray: () => live.lists[id]!,
    replaceValue: (index: number, data: any) => { live.lists[id]![index - 1]!.data = data; },
    appendValue: (data: any) => { live.lists[id]!.push({ data }); },
    deleteValue: (index: number) => { live.lists[id]!.splice(index - 1, 1); },
  } : null);

  /** 
   * 무대 위의 객체입니다. 
   * entity 객체는 엔트리 실행기가 제공하는 게터(getter) 메서드들을 모방합니다. 
   */
  const entity: any = {
    x: 12.345, y: -7, size: 100, rotation: 0, direction: 90, visible: true,
    picture: { id: 'p2', name: '점프' },
    getX() { return this.x; }, setX(v: any) { this.x = v; },
    getY() { return this.y; }, setY(v: any) { this.y = v; },
    getSize() { return this.size; }, setSize(v: any) { this.size = v; },
    getRotation() { return this.rotation; }, setRotation(v: any) { this.rotation = v; },
    getDirection() { return this.direction; }, setDirection(v: any) { this.direction = v; },
    getScaleX() { return 1; }, getScaleY() { return 1; },
    getWidth() { return 100; }, getHeight() { return 100; },
    getVisible() { return this.visible; },
    setVisible(v: any) { this.visible = v; },
    setImage(picture: any) { this.picture = picture; },
  };
  const stageObject = {
    id: 'o1',
    name: '치로',
    rotateMethod: 'free',
    pictures: [{ id: 'p1', name: '기본' }, { id: 'p2', name: '점프' }],
    entity,
    getPicture(id: string) { return this.pictures.find((p) => p.id === id) || null; },
    setRotateMethod(method: any) { this.rotateMethod = method; },
  };
  entity.parent = stageObject;

  const scenes = [{ id: 's1', name: '장면 1' }, { id: 's2', name: '장면 2' }];
  const scene = {
    selected: scenes[0],
    getSceneById: (sceneId: any) => scenes.find((s) => s.id === sceneId) || null,
    selectScene(target: any) { this.selected = target; },
  };

  const listeners: Record<string, Array<(...args: any[]) => void>> = {};
  window.Entry = {
    engine,
    block: blocks,
    requestUpdate: false,
    scene,
    variableContainer: { getVariable: fakeVariable, getList: fakeList },
    container: { getObject: (id: string) => (id === 'o1' ? stageObject : null) },
    addEventListener: (name: string, fn: any) => { (listeners[name] = listeners[name] || []).push(fn); },
    dispatchEvent: (name: string, ...args: any[]) => (listeners[name] || []).forEach((fn) => fn(...args)),
  };
  window.tessDebugSink = (fn: any) => { window.__sink = fn; };
  window.tessReportError = (kind: string, error: any) => window.__sink({
    kind: String(kind), message: String(error && error.message), stack: '', time: Date.now(),
  });
  window.fetch = () => Promise.resolve({ json: () => Promise.resolve({}) });

  /**
   * preact가 Node 환경에서 import되므로, 전역 변수들이 jsdom의 객체를 가리키도록 설정합니다.
   */
  const globals = ['document', 'Node', 'Element', 'HTMLElement', 'DocumentFragment',
    'Text', 'Comment', 'NodeFilter', 'MutationObserver', 'requestAnimationFrame'];
  const scope = globalThis as Record<string, unknown>;
  const saved = globals.map((key) => [key, scope[key]] as const);
  for (const key of globals) scope[key] = window[key];
  t.after(() => { for (const [key, value] of saved) scope[key] = value; });

  /**
   * 브라우저에서 실제로 사용하는 preact 파일을 로드합니다.
   * 패키지 기본 진입점을 사용하면 서버가 제공하는 파일과 달라질 수 있으므로 정확한 파일을 사용합니다.
   * 패널 코드는 TypeScript로 작성되었으며 타입이 제거된 상태로 제공되므로, 테스트에서도 동일하게 타입을 제거하여 브라우저가 수신하는 코드와 일치시킵니다.
   */
  const source = stripTypeScriptTypes(
    fs.readFileSync(path.join(root, 'packages/player/src/debug-ui.ts'), 'utf-8'),
    { mode: 'strip' },
  );
  const preactFile = source.match(/from ["']\/preact\/([^"']+)["']/)![1];
  const preact = await import(path.join(preactDist()!, preactFile));
  window.h = preact.h;
  window.render = preact.render;
  window.eval(source.replace(/^import[^;]+;$/m, 'const { h, render } = window;'));

  const byId = (id: string) => window.document.getElementById(id);
  return {
    window,
    engine,
    blocks,
    live,
    entity,
    stageObject,
    scene,
    byId,
    click: (id: string) => byId(id)!.dispatchEvent(new window.MouseEvent('click')),
    choose: (id: string, value: any) => {
      byId(id)!.value = value;
      byId(id)!.dispatchEvent(new window.Event('change'));
    },
    tab: (name: string) => window.document.querySelector('.debug-tab[data-tab="' + name + '"]')!
      .dispatchEvent(new window.MouseEvent('click')),
    settle: () => new Promise((resolve) => setTimeout(resolve, 20)),
    /**
     * 특정 요소의 값을 수정합니다. 
     * 요소를 클릭하여 입력란을 활성화한 후, 새 값을 입력하고 Enter 키 이벤트를 발생시킵니다.
     *
     * @param node - 클릭할 대상 DOM 요소
     * @param value - 입력할 새로운 값
     */
    async edit(node: any, value: any) {
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

  /** 초기 상태에서는 실행 탭이 활성화됩니다. */
  assert.equal(ui.byId('tab-run')!.hidden, false);
  assert.equal(ui.byId('tab-data')!.hidden, true);

  ui.tab('objects');
  await ui.settle();
  assert.equal(ui.byId('tab-objects')!.hidden, false);
  assert.equal(ui.byId('tab-run')!.hidden, true);
  assert.equal(tabs.find((b) => b.dataset.tab === 'objects')!.getAttribute('aria-selected'), 'true');
  assert.equal(tabs.find((b) => b.dataset.tab === 'run')!.getAttribute('aria-selected'), 'false');
});

test('정지한 뒤에도 시작하기로 다시 실행할 수 있다', async (t) => {
  const ui = await mountDebugPanel(t);
  await ui.settle();

  ui.click('run-btn');
  assert.equal(ui.engine.state, 'run');
  /** 같은 단추가 실행 중에는 일시정지로 바뀝니다. */
  ui.click('run-btn');
  assert.equal(ui.engine.state, 'pause');
  /** 일시정지 상태에서 누르면 처음부터 다시 시작하지 않고 실행을 재개합니다. */
  ui.click('run-btn');
  assert.equal(ui.engine.state, 'run');

  ui.click('stop-btn');
  assert.equal(ui.engine.state, 'stop');
  ui.click('run-btn');
  assert.equal(ui.engine.state, 'run');
});

test('실행 상태에 따라 버튼과 안내 글이 바뀐다', async (t) => {
  const ui = await mountDebugPanel(t);
  await ui.settle();

  const stateText = () => ui.window.document.querySelector('.debug-run-state')!.textContent;

  ui.click('stop-btn');
  await ui.settle();
  assert.match(stateText(), /멈춰/);
  assert.equal(ui.byId('stop-btn')!.disabled, true); /** 정지 상태에서는 정지 단추가 비활성화됩니다. */
  assert.equal(ui.byId('run-btn')!.textContent, '시작하기');
  assert.equal(ui.byId('run-btn')!.disabled, false);

  ui.click('run-btn');
  await ui.settle();
  assert.match(stateText(), /실행 중/);
  assert.equal(ui.byId('run-btn')!.textContent, '일시정지');

  ui.click('run-btn');
  await ui.settle();
  assert.equal(ui.byId('run-btn')!.textContent, '이어서 하기');
  assert.equal(ui.byId('pause-btn'), null);
});

test('부스트 모드 · 기기 · 터치를 디버그 창에서 정한 값으로 바꿔치기한다', async (t) => {
  const ui = await mountDebugPanel(t);
  await ui.settle();
  ui.window.tessPatchEnvironmentBlocks();
  const askMobile = { getField: () => 'mobile' };

  /** 기본 상태에서는 브라우저의 실제 환경 값을 그대로 사용합니다. */
  assert.equal(ui.blocks.is_boost_mode.func(), '실제부스트');
  assert.equal(ui.blocks.is_touch_supported.func(), '실제터치');
  assert.equal(ui.blocks.is_current_device_type.func(null, askMobile), '실제mobile');

  ui.choose('env-boost', 'true');
  assert.equal(ui.blocks.is_boost_mode.func(), true);
  ui.choose('env-boost', 'false');
  assert.equal(ui.blocks.is_boost_mode.func(), false);
  ui.choose('env-boost', ''); /** 실제 값으로 복원합니다. */
  assert.equal(ui.blocks.is_boost_mode.func(), '실제부스트');

  ui.choose('env-touch', 'false');
  assert.equal(ui.blocks.is_touch_supported.func(), false);

  /**
   * 기기 환경 변수는 선택된 값과 스크립트에서 확인하려는 기기 타입이 일치하는지 여부를 반환합니다.
   */
  ui.choose('env-device', 'mobile');
  assert.equal(ui.blocks.is_current_device_type.func(null, askMobile), true);
  ui.choose('env-device', 'desktop');
  assert.equal(ui.blocks.is_current_device_type.func(null, askMobile), false);
});

/** 
 * 테스트용 소규모 프로젝트 객체입니다. 
 * 변수, 신호, 함수 데이터를 포함하고 있습니다.
 */
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

/**
 * 단일 함수를 포함하는 테스트용 프로젝트 객체입니다.
 * 함수 코드 확장 UI 기능을 테스트하는 데 사용됩니다.
 */
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

  const variables = ui.byId('var-list')!.textContent;
  assert.match(variables, /점수/);
  assert.match(variables, /42/); /** 실행 중인 변수의 현재 값을 읽어옵니다. */
  assert.match(variables, /기록/);
  assert.match(variables, /\[2개\]/);
  assert.doesNotMatch(variables, /초시계/); /** 초시계와 대답은 Tess 내장 기능이므로 목록에서 제외됩니다. */

  assert.match(ui.byId('signal-list')!.textContent, /게임 시작/);
  const functions = ui.byId('function-list')!.textContent;
  assert.match(functions, /스폰/);
  assert.match(functions, /1개 인자/);
});

/**
 * 자료 탭을 열고 변수 목록 DOM 요소를 반환합니다.
 *
 * @param ui - 테스트 UI 객체
 * @param project - 렌더링할 프로젝트 데이터 (기본값: dataProject)
 * @returns 변수 목록을 나타내는 DOM 요소
 */
async function openData(ui: any, project = dataProject) {
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

  /** 입력값이 숫자 형식인 경우 숫자 타입으로 저장되어야 계산 블록이 정상 동작합니다. */
  assert.equal(ui.live.variables.v1, 77);
  assert.match(ui.byId('var-list')!.textContent, /77/);
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
  const items = ui.byId('var-list')!.querySelectorAll('.debug-list-ol li');
  assert.equal(items.length, 2);
  assert.match(items[0].textContent, /ㄱ/);

  ui.byId('var-list')!.querySelector('.debug-expand.open')!.dispatchEvent(new ui.window.MouseEvent('click'));
  await ui.settle();
  assert.equal(ui.byId('var-list')!.querySelectorAll('.debug-list-items').length, 0);
});

test('펼친 리스트에서 항목을 고치고 넣고 지울 수 있다', async (t) => {
  const ui = await mountDebugPanel(t);
  await ui.settle();
  const list = await openData(ui);
  [...list.querySelectorAll('.debug-expand')].find((n) => n.textContent === '기록')
    .dispatchEvent(new ui.window.MouseEvent('click'));
  await ui.settle();

  /** 리스트의 항목 값을 수정하는 동작을 검증합니다. */
  await ui.edit(ui.byId('var-list')!.querySelectorAll('.debug-list-ol .debug-edit')[1], 'ㄷ');
  assert.deepEqual(ui.live.lists.l1.map((item) => item.data), ['ㄱ', 'ㄷ']);

  /** 리스트에 새로운 항목을 추가하는 동작을 검증합니다. */
  ui.byId('var-list')!.querySelector('.debug-add-btn')!.dispatchEvent(new ui.window.MouseEvent('click'));
  await ui.settle();
  assert.equal(ui.live.lists.l1.length, 3);

  /** 리스트의 첫 번째 항목을 삭제합니다. */
  ui.byId('var-list')!.querySelectorAll('.debug-list-ol .debug-mini-btn')[0]
    .dispatchEvent(new ui.window.MouseEvent('click'));
  await ui.settle();
  assert.deepEqual(ui.live.lists.l1.map((item) => item.data), ['ㄷ', '']);
});

/**
 * 리스트의 항목이 빈 문자열인 경우에도 사용자가 클릭하여 값을 수정할 수 있어야 합니다.
 */
test('값이 빈 리스트 항목도 눌러서 고칠 수 있다', async (t) => {
  const ui = await mountDebugPanel(t);
  await ui.settle();
  ui.live.lists.l1 = [{ data: '' }];
  const list = await openData(ui);
  [...list.querySelectorAll('.debug-expand')].find((n) => n.textContent === '기록')
    .dispatchEvent(new ui.window.MouseEvent('click'));
  await ui.settle();

  const cell = ui.byId('var-list')!.querySelector('.debug-list-ol .debug-edit');
  assert.ok(cell!.textContent.trim().length > 0, '빈 값이어도 누를 자리가 있어야 한다');
  assert.match(cell!.className, /empty/);

  await ui.edit(cell, '채움');
  assert.deepEqual(ui.live.lists.l1.map((item) => item.data), ['채움']);
});

/**
 * UI 레이아웃 테스트: 확장된 리스트 항목과 함수 블록이 가로로 배치되지 않고 세로로 올바르게 쌓이는지 확인합니다.
 */
test('펼친 리스트 항목과 함수 블록은 세로로 쌓인다', () => {
  const css = playerPage({
    name: 'a', base: '/lib', summary: { scenes: 1, objects: 1, blocks: 1 }, entName: 'a.ent', reload: false,
  });
  assert.match(css, /\.debug-rows > li \{[^}]*display: flex/);
  assert.doesNotMatch(css, /\.debug-rows li \{/);
  assert.match(css, /\.debug-rows > li\.debug-items-row \{[^}]*display: block/);
});

/**
 * 리스트 항목을 추가하거나 삭제할 때 UI가 즉각적으로 업데이트되는지 확인합니다.
 */
test('항목을 넣고 지우면 목록이 바로 다시 그려진다', async (t) => {
  const ui = await mountDebugPanel(t);
  await ui.settle();
  const list = await openData(ui);
  [...list.querySelectorAll('.debug-expand')].find((n) => n.textContent === '기록')
    .dispatchEvent(new ui.window.MouseEvent('click'));
  await ui.settle();
  const rows = () => ui.byId('var-list')!.querySelectorAll('.debug-list-ol > li').length;
  assert.equal(rows(), 2);

  ui.byId('var-list')!.querySelector('.debug-add-btn')!.dispatchEvent(new ui.window.MouseEvent('click'));
  await ui.settle();
  assert.equal(rows(), 3, '넣은 항목이 바로 보여야 한다');

  ui.byId('var-list')!.querySelectorAll('.debug-list-ol .debug-mini-btn')[0]
    .dispatchEvent(new ui.window.MouseEvent('click'));
  await ui.settle();
  assert.equal(rows(), 2, '지운 항목이 바로 사라져야 한다');
});

/**
 * 한 리스트 항목을 수정한 후 다른 항목을 클릭했을 때, 이전 수정 값이 반영되지 않고 해당 항목의 올바른 값이 표시되는지 확인합니다.
 */
test('한 항목을 고친 뒤 다른 항목을 열면 그 항목의 값이 뜬다', async (t) => {
  const ui = await mountDebugPanel(t);
  await ui.settle();
  const list = await openData(ui);
  [...list.querySelectorAll('.debug-expand')].find((n) => n.textContent === '기록')
    .dispatchEvent(new ui.window.MouseEvent('click'));
  await ui.settle();

  const cells = () => ui.byId('var-list')!.querySelectorAll('.debug-list-ol .debug-edit');
  await ui.edit(cells()[0], '바뀐값');
  assert.deepEqual(ui.live.lists.l1.map((i) => i.data), ['바뀐값', 'ㄴ']);

  /** 두 번째 항목을 클릭하면 이전 항목의 수정된 값이 아닌, 해당 항목의 원본 값('ㄴ')이 표시되어야 합니다. */
  cells()[1].dispatchEvent(new ui.window.MouseEvent('click'));
  await ui.settle();
  assert.equal(ui.window.document.querySelector('.debug-edit-input')!.value, 'ㄴ');
});

test('변수와 리스트를 무대에서 보이거나 숨길 수 있다', async (t) => {
  const ui = await mountDebugPanel(t);
  await ui.settle();
  const list = await openData(ui);

  const toggles = list.querySelectorAll('.debug-toggle');
  assert.equal(toggles.length, 2); /** 변수 1개, 리스트 1개가 존재합니다. */
  assert.equal(toggles[0].textContent, '숨김'); /** 초기 상태는 숨김(hidden)으로 설정됩니다. */

  toggles[0].dispatchEvent(new ui.window.MouseEvent('click'));
  await ui.settle();
  assert.equal(ui.live.visible.v1, true);
  assert.equal(ui.byId('var-list')!.querySelectorAll('.debug-toggle')[0].textContent, '보임');

  ui.byId('var-list')!.querySelectorAll('.debug-toggle')[1]
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

  const name = ui.byId('function-list')!.querySelector('.debug-expand');
  assert.match(name!.textContent, /스폰/);
  assert.equal(ui.byId('function-list')!.querySelectorAll('.debug-func-code').length, 0);

  name!.dispatchEvent(new ui.window.MouseEvent('click'));
  await ui.settle();
  const code = ui.byId('function-list')!.querySelector('.debug-func-code');
  assert.ok(code, '함수 코드가 열려야 한다');
  assert.match(code.textContent, /move_direction/);

  name!.dispatchEvent(new ui.window.MouseEvent('click'));
  await ui.settle();
  assert.equal(ui.byId('function-list')!.querySelectorAll('.debug-func-code').length, 0);
});

test('자료 탭의 신호를 눌러서 바로 보낼 수 있다', async (t) => {
  const ui = await mountDebugPanel(t);
  await ui.settle();
  ui.window.tessRenderProjectDebug(dataProject);
  ui.tab('data');
  await ui.settle();

  ui.byId('signal-list')!.querySelector('.debug-send-btn')!
    .dispatchEvent(new ui.window.MouseEvent('click'));
  assert.deepEqual(ui.engine.fired, [['when_message_cast', 'm1']]);
});

/** 오브젝트 탭 UI 동작 테스트 */
test('오브젝트 정보에 좌표 · 크기 · 방향 · 모양이 나온다', async (t) => {
  const ui = await mountDebugPanel(t);
  await ui.settle();
  ui.window.tessRenderProjectDebug(dataProject);
  ui.tab('objects');
  await ui.settle();

  const info = ui.byId('object-info')!.textContent.replace(/\s+/g, ' ');
  assert.match(info, /x 좌표 12.35/); /** 좌표값은 소수점 둘째 자리까지만 표시됩니다. */
  assert.match(info, /y 좌표 -7/);
  assert.match(info, /크기 100/);
  assert.match(info, /이동 방향 90/);
  assert.match(info, /모양 번호 2 \/ 2/);

  /** 모양과 회전 방식 설정은 드롭다운 UI로 제공되며, 보이기 설정은 토글 버튼으로 제공됩니다. */
  const [costume, rotate] = ui.byId('object-info')!.querySelectorAll('select');
  assert.deepEqual([...costume.options].map((o) => o.textContent), ['기본', '점프']);
  assert.equal(costume.value, 'p2'); /** 현재 설정된 모양이 선택된 상태여야 합니다. */
  assert.deepEqual([...rotate.options].map((o) => o.value), ['free', 'vertical', 'none']);
  assert.equal(rotate.value, 'free');
  assert.equal(ui.byId('object-info')!.querySelector('.debug-toggle')!.textContent, '보임');
});

test('모양·회전 방식을 드롭다운으로 바꾸고 보이기를 토글한다', async (t) => {
  const ui = await mountDebugPanel(t);
  await ui.settle();
  ui.window.tessRenderProjectDebug(dataProject);
  ui.tab('objects');
  await ui.settle();

  const [costume, rotate] = ui.byId('object-info')!.querySelectorAll('select');
  costume.value = 'p1';
  costume.dispatchEvent(new ui.window.Event('change'));
  assert.equal(ui.entity.picture.id, 'p1');

  rotate.value = 'vertical';
  rotate.dispatchEvent(new ui.window.Event('change'));
  assert.equal(ui.stageObject.rotateMethod, 'vertical');

  const toggle = ui.byId('object-info')!.querySelector('.debug-toggle');
  toggle!.dispatchEvent(new ui.window.MouseEvent('click'));
  assert.equal(ui.entity.visible, false);
  await ui.settle();
  assert.equal(ui.byId('object-info')!.querySelector('.debug-toggle')!.textContent, '숨김');
});

test('오브젝트 좌표를 눌러서 바로 옮길 수 있다', async (t) => {
  const ui = await mountDebugPanel(t);
  await ui.settle();
  ui.window.tessRenderProjectDebug(dataProject);
  ui.tab('objects');
  await ui.settle();

  const cell = [...ui.byId('object-info')!.querySelectorAll('.debug-edit')]
    .find((node) => node.textContent === '12.35');
  await ui.edit(cell, '-100');
  assert.equal(ui.entity.x, -100);
});

test('실행기가 아직 없으면 오브젝트 정보는 안내만 보여 준다', async (t) => {
  const ui = await mountDebugPanel(t);
  await ui.settle();
  ui.window.Entry!.container = { getObject: () => null };
  ui.window.tessRenderProjectDebug(dataProject);
  ui.tab('objects');
  await ui.settle();
  assert.match(ui.byId('object-info')!.textContent, /한 번 실행해 보세요/);
});

/**
 * 실행기에서 오브젝트 정보가 아직 로드되지 않은 경우, 속성 목록 대신 적절한 안내 메시지가 표시되어야 합니다.
 * UI 안정성을 위해 DOM 구조는 유지되며, 불필요한 요소는 숨김(hidden) 처리됩니다.
 */
test('실행기가 오브젝트를 아직 모르면 안내만 보여 준다', async (t) => {
  const ui = await mountDebugPanel(t);
  await ui.settle();
  const labels = () => [...ui.byId('object-info')!.querySelectorAll('li')]
    .map((li) => li.querySelector('.key')?.textContent ?? '');

  ui.window.tessRenderProjectDebug(dataProject);
  ui.tab('objects');
  await ui.settle();
  assert.ok(labels().length > 5, '실행기가 아는 오브젝트는 값 줄이 나온다');

  /** 실행기에서 해당 오브젝트 데이터를 확인할 수 없는 경우, 안내 메시지 하나만 표시됩니다. */
  ui.window.Entry!.container = { getObject: () => null };
  ui.click('debug-toggle'); /** 디버그 패널을 열어 상태 값 갱신을 시작합니다. */
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.deepEqual(labels(), ['']);
  assert.match(ui.byId('object-info')!.textContent, /한 번 실행해 보세요/);
});

test('글상자는 글 내용을 고칠 수 있고, 모양 줄은 내지 않는다', async (t) => {
  const ui = await mountDebugPanel(t);
  await ui.settle();
  ui.entity.text = '점수: 0';
  ui.entity.setText = (value: any) => { ui.entity.text = value; };
  ui.window.tessRenderProjectDebug(dataProject);
  ui.tab('objects');
  await ui.settle();

  const row = (label: string) => [...ui.byId('object-info')!.querySelectorAll('li')]
    .find((li) => li.querySelector('.key')?.textContent === label);
  assert.ok(row('글 내용'), '글상자는 글 내용을 고칠 수 있다');
  assert.equal(row('모양'), undefined); /** 글상자 오브젝트에는 모양 속성이 존재하지 않습니다. */
  assert.equal(row('회전 방식'), undefined);

  await ui.edit(row('글 내용')!.querySelector('.debug-edit'), '점수: 99');
  assert.equal(ui.entity.text, '점수: 99');
});

/**
 * 두 개의 장면(Scene)을 포함하는 프로젝트를 마운트하고 장면 바로가기 버튼 요소를 반환합니다.
 *
 * @param ui - 테스트 UI 객체
 * @returns 장면 바로가기 버튼들의 NodeList
 */
async function openScenes(ui: any) {
  ui.window.tessRenderProjectDebug({
    ...dataProject,
    scenes: [{ id: 's1', name: '장면 1' }, { id: 's2', name: '장면 2' }],
  });
  ui.tab('objects');
  await ui.settle();
  return ui.byId('scene-tree').querySelectorAll('.debug-scene-go');
}

const firedTypes = (ui: any) => ui.engine.fired.map(([type]: [string, string]) => type);

test('장면 바로가기로 그 장면으로 넘어가고 장면 시작 이벤트가 돈다', async (t) => {
  const ui = await mountDebugPanel(t);
  await ui.settle();
  const buttons = await openScenes(ui);
  assert.equal(buttons.length, 2);
  assert.equal(ui.scene.selected.id, 's1');

  buttons[1].dispatchEvent(new ui.window.MouseEvent('click'));
  assert.equal(ui.scene.selected.id, 's2');
  /** 단순히 장면만 교체하는 경우에는 '장면이 시작될 때' 이벤트 스크립트가 실행되지 않아야 합니다. */
  assert.deepEqual(firedTypes(ui), ['when_scene_start']);
});

test('장면 바로가기는 멈춰 있거나 일시정지여도 그 장면을 돌린다', async (t) => {
  const ui = await mountDebugPanel(t);
  await ui.settle();
  let buttons = await openScenes(ui);

  /** 엔진이 정지된 상태에서는 이벤트가 무시되므로, 장면을 변경하면 실행이 함께 시작됩니다. */
  assert.equal(ui.engine.state, 'stop');
  buttons[1].dispatchEvent(new ui.window.MouseEvent('click'));
  assert.equal(ui.engine.state, 'run');
  assert.deepEqual(firedTypes(ui), ['when_scene_start']);

  ui.tab('run');
  await ui.settle();
  ui.click('run-btn'); /** 실행 중에는 같은 단추가 일시정지다. */
  assert.equal(ui.engine.state, 'pause');
  buttons = await openScenes(ui);

  buttons[0].dispatchEvent(new ui.window.MouseEvent('click'));
  assert.equal(ui.engine.state, 'run'); /** 실행이 처음부터 재시작되지 않고 이어서 재개되어야 합니다. */
  assert.equal(ui.scene.selected.id, 's1');
  assert.deepEqual(firedTypes(ui), ['when_scene_start', 'when_scene_start']);

  /** 이미 선택된 현재 장면에서 다시 이벤트를 발생시키면 해당 장면이 재시작됩니다. */
  buttons[0].dispatchEvent(new ui.window.MouseEvent('click'));
  assert.equal(ui.engine.fired.length, 3);
});

test('장면 바로가기 뒤에는 실행 탭이 실행 중으로 보인다', async (t) => {
  const ui = await mountDebugPanel(t);
  await ui.settle();
  const buttons = await openScenes(ui);

  buttons[1].dispatchEvent(new ui.window.MouseEvent('click'));
  ui.tab('run');
  await ui.settle();
  assert.match(ui.window.document.querySelector('.debug-run-state')!.textContent, /실행 중/);
});

test('항목 추가 단추는 목록 맨 위에 있다', async (t) => {
  const ui = await mountDebugPanel(t);
  await ui.settle();
  const list = await openData(ui);
  [...list.querySelectorAll('.debug-expand')].find((n) => n.textContent === '기록')
    .dispatchEvent(new ui.window.MouseEvent('click'));
  await ui.settle();

  const box = ui.byId('var-list')!.querySelector('.debug-list-items');
  const kids = [...box!.children];
  assert.ok(kids[0].classList.contains('debug-add-btn'), '추가 단추가 첫 자식이어야 한다');
  assert.ok(kids.indexOf(box!.querySelector('.debug-list-ol')) > 0);
});

/** 
 * 단축키(Ctrl+Shift)를 이용한 무대 위 오브젝트 선택 상호작용 테스트
 */
/**
 * 테스트 환경에 무대 캔버스를 추가하고 지정된 오브젝트 목록을 설정합니다.
 *
 * @param ui - 테스트 UI 객체
 * @param objects - 설정할 오브젝트 목록
 * @param current - 현재 선택된 오브젝트 목록 (기본값: objects)
 * @returns 캔버스 요소와 중앙 좌표 정보를 포함하는 객체
 */
function withStage(ui: any, objects: any, current = objects) {
  const doc = ui.window.document;
  const canvas = doc.createElement('canvas');
  canvas.id = 'entryCanvas';
  canvas.getBoundingClientRect = () => ({
    left: 100, top: 50, width: 480, height: 270, right: 580, bottom: 320, x: 100, y: 50,
  });
  ui.byId('workspace').append(canvas);
  ui.window.Entry.container.objects_ = objects;
  ui.window.Entry.container.getCurrentObjects = () => current;
  ui.window.tessWatchStagePicks();
  /** 무대의 (0, 0) 좌표는 캔버스의 정중앙에 위치합니다. */
  return { canvas, center: { clientX: 340, clientY: 185 } };
}

/**
 * 무대 좌표에 배치된 100x100 크기의 단일 오브젝트 데이터를 생성합니다.
 *
 * @param id - 오브젝트 식별자
 * @param name - 오브젝트 이름
 * @param x - X 좌표 (기본값: 0)
 * @param y - Y 좌표 (기본값: 0)
 * @returns 모의 오브젝트 데이터
 */
function stageActor(id: string, name: string, x = 0, y = 0) {
  return {
    id,
    name,
    entity: {
      getX: () => x, getY: () => y,
      getWidth: () => 100, getHeight: () => 100,
      getScaleX: () => 1, getScaleY: () => 1,
      getVisible: () => true,
    },
  };
}

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
  ui.tab('objects');
  await ui.settle();
  assert.equal(ui.byId('object-info-name')!.textContent, '— 다른'); /** 초기 상태에서는 목록의 첫 번째 오브젝트가 표시됩니다. */

  const { canvas, center } = withStage(ui, [stageActor('o1', '치로')]);
  canvas.dispatchEvent(new ui.window.MouseEvent('pointerdown', {
    bubbles: true, cancelable: true, button: 0, ctrlKey: true, shiftKey: true, ...center,
  }));
  await ui.settle();

  assert.equal(ui.byId('object-info-name')!.textContent, '— 치로');
  assert.equal(ui.byId('tab-objects')!.hidden, false); /** 해당 오브젝트를 표시하기 위해 오브젝트 탭이 활성화됩니다. */
});

/**
 * 오브젝트 선택 기능이 반복적인 클릭 상호작용에서도 일관되게 동작하는지 확인합니다.
 * 매 클릭 이벤트마다 독립적으로 판단하여 선택 상태가 갱신되어야 합니다.
 */
test('몇 번을 눌러도 계속 골라진다', async (t) => {
  const ui = await mountDebugPanel(t);
  await ui.settle();
  ui.window.tessRenderProjectDebug({
    ...dataProject,
    objects: [
      { id: 'o1', name: '치로', scene: 's1', script: '[]' },
      { id: 'o2', name: '엔트리봇', scene: 's1', script: '[]' },
    ],
  });
  ui.tab('objects');
  await ui.settle();

  /** 상단(y=100) 위치에는 엔트리봇 객체를, 중앙에는 치로 객체를 배치합니다. */
  const { canvas } = withStage(ui, [stageActor('o2', '엔트리봇', 0, 100), stageActor('o1', '치로')]);
  const click = (clientX: any, clientY: any) => canvas.dispatchEvent(new ui.window.MouseEvent('pointerdown', {
    bubbles: true, cancelable: true, button: 0, ctrlKey: true, shiftKey: true, clientX, clientY,
  }));

  const picked = [];
  for (let i = 0; i < 4; i += 1) {
    click(340, i % 2 === 0 ? 85 : 185); /** 엔트리봇과 치로 위치를 번갈아가며 클릭합니다. */
    await ui.settle();
    picked.push(ui.byId('object-info-name')!.textContent);
  }
  assert.deepEqual(picked, ['— 엔트리봇', '— 치로', '— 엔트리봇', '— 치로']);
});

test('모양이 비어 있는 큰 판은 그 밑의 오브젝트를 가리지 않는다', async (t) => {
  const ui = await mountDebugPanel(t);
  await ui.settle();
  ui.window.tessRenderProjectDebug({
    ...dataProject,
    objects: [
      { id: 'o2', name: '덮개', scene: 's1', script: '[]' },
      { id: 'o1', name: '치로', scene: 's1', script: '[]' },
    ],
  });
  ui.tab('objects');
  await ui.settle();

  // 무대를 통째로 덮는 960x540 짜리 판이 맨 앞에 있고, 그 모양에는 아무것도 없다.
  const cover = stageActor('o2', '덮개');
  cover.entity.getWidth = () => 960;
  cover.entity.getHeight = () => 540;
  const objects = [cover, stageActor('o1', '치로')];
  const { canvas } = withStage(ui, objects);

  // 모양의 픽셀까지 보는 실행기를 세운다 — 빈 판은 어느 자리에서도 아니라고 한다.
  // 고르기가 실행기에게 묻는 것은 이 셋뿐이다.
  const idle = () => undefined;
  ui.window.tessRuntime = {
    stageCanvas: () => canvas,
    stageSize: () => ({ width: 480, height: 270 }),
    currentObjects: () => objects,
    hitTest: (entity: any) => entity.getWidth() !== 960,
    // 패널이 실행기에 묻는 나머지는 이 시험과 상관이 없다.
    state: () => 'stop',
    run: idle, pause: idle, stop: idle, goToScene: idle, sendSignal: idle,
    variable: () => null, list: () => null, object: () => null,
    realBoost: () => false, patchEnvironment: idle, requestUpdate: idle,
    layoutCanvas: idle, refreshRect: idle,
  };

  canvas.dispatchEvent(new ui.window.MouseEvent('pointerdown', {
    bubbles: true, cancelable: true, button: 0, ctrlKey: true, shiftKey: true,
    clientX: 340, clientY: 185,
  }));
  await ui.settle();
  assert.equal(ui.byId('object-info-name')!.textContent, '— 치로');
});

test('픽셀로 답하지 못하는 실행기에서는 상자로 고른다', async (t) => {
  const ui = await mountDebugPanel(t);
  await ui.settle();
  ui.window.tessRenderProjectDebug({
    ...dataProject,
    objects: [{ id: 'o1', name: '치로', scene: 's1', script: '[]' }],
  });
  ui.tab('objects');
  await ui.settle();

  const { canvas } = withStage(ui, [stageActor('o1', '치로')]);
  canvas.dispatchEvent(new ui.window.MouseEvent('pointerdown', {
    bubbles: true, cancelable: true, button: 0, ctrlKey: true, shiftKey: true,
    clientX: 340, clientY: 185,
  }));
  await ui.settle();
  assert.equal(ui.byId('object-info-name')!.textContent, '— 치로');
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
  ui.tab('objects');
  await ui.settle();

  const { canvas, center } = withStage(ui, [stageActor('o1', '치로')]);
  const event = new ui.window.MouseEvent('pointerdown', {
    bubbles: true, cancelable: true, button: 0, ...center,
  });
  canvas.dispatchEvent(event);
  await ui.settle();

  assert.equal(ui.byId('object-info-name')!.textContent, '— 다른'); // 그대로다
  assert.equal(event.defaultPrevented, false);                     // 작품이 그대로 받는다
});

test('고르는 클릭은 무대까지 내려가지 않는다', async (t) => {
  /** Ctrl+Shift 클릭 이벤트는 디버깅을 위한 객체 선택 용도이므로, 작품의 스크립트 실행(마우스 클릭 이벤트 등)을 트리거하지 않아야 합니다. */
  const ui = await mountDebugPanel(t);
  await ui.settle();
  ui.window.tessRenderProjectDebug(dataProject);
  ui.tab('objects');
  await ui.settle();

  const { canvas, center } = withStage(ui, [stageActor('o1', '치로')]);
  const reached: string[] = [];
  canvas.addEventListener('pointerdown', () => reached.push('stage'));
  canvas.addEventListener('click', () => reached.push('stage'));

  for (const type of ['pointerdown', 'click']) {
    canvas.dispatchEvent(new ui.window.MouseEvent(type, {
      bubbles: true, cancelable: true, button: 0, ctrlKey: true, shiftKey: true, ...center,
    }));
  }
  await ui.settle();
  assert.deepEqual(reached, [], '무대는 이 클릭을 보지 못한다');
});

test('다른 장면의 오브젝트는 고르지 않는다', async (t) => {
  /**
   * 객체 선택 시 현재 활성화된 장면(Scene)의 객체들만 스캔해야 합니다.
   * 모든 장면의 객체가 메모리에 유지되므로, 전체 객체를 스캔하면 현재 화면에 보이지 않는 이전 장면의 객체가 잘못 선택될 수 있습니다.
   */
  const ui = await mountDebugPanel(t);
  await ui.settle();
  ui.window.tessRenderProjectDebug({
    ...dataProject,
    scenes: [{ id: 's1', name: '인트로' }, { id: 's2', name: '전투' }],
    objects: [
      { id: 'old', name: '인트로배경', scene: 's1', script: '[]' },
      { id: 'now', name: '전투배경', scene: 's2', script: '[]' },
    ],
  });
  ui.tab('objects');
  await ui.settle();

  const intro = stageActor('old', '인트로배경');   // 앞 장면 것. 아직 보이는 상태로 남아 있다.
  const battle = stageActor('now', '전투배경');
  /** 객체 목록은 장면 순서대로 저장되어 있습니다. 두 번째 장면에 속하는 객체만 선택되는지 검증합니다. */
  const { canvas, center } = withStage(ui, [intro, battle], [battle]);

  canvas.dispatchEvent(new ui.window.MouseEvent('pointerdown', {
    bubbles: true, cancelable: true, button: 0, ctrlKey: true, shiftKey: true, ...center,
  }));
  await ui.settle();

  assert.equal(ui.byId('object-info-name')!.textContent, '— 전투배경');
});

test('부스트 모드처럼 캔버스가 여럿이어도 무대에서 오브젝트를 고른다', async (t) => {
  /**
   * 부스트 모드(WebGL) 환경에서는 텍스트 렌더링 등을 위해 다수의 보조 캔버스가 생성될 수 있습니다.
   * 무대 선택 이벤트 바인딩 시 정확히 실제 화면 캔버스를 타겟팅하는지 검증합니다.
   */
  const ui = await mountDebugPanel(t);
  await ui.settle();
  ui.window.tessRenderProjectDebug(dataProject);
  await ui.settle();

  const doc = ui.window.document;
  const rect = (left: any, top: any, width: number, height: number) => () => ({
    left, top, width, height, right: left + width, bottom: top + height, x: left, y: top,
  });

  const workspace = ui.byId('workspace');
  const decoy = doc.createElement('canvas');          // PIXI 가 만든 도우미
  decoy.getBoundingClientRect = rect(0, 0, 0, 0);
  const stage = doc.createElement('canvas');          // 진짜 무대
  stage.id = 'entryCanvas';
  stage.getBoundingClientRect = rect(100, 50, 480, 270);
  workspace!.append(decoy, stage);

  ui.window.Entry!.container.objects_ = [ui.stageObject];
  ui.window.tessWatchStagePicks();

  /** 무대의 (0,0) 좌표는 캔버스의 중심입니다. 객체가 중심에 100x100 크기로 위치한 상태에서 이벤트 좌표 매핑을 검증합니다. */
  ui.entity.x = 0;
  ui.entity.y = 0;
  stage.dispatchEvent(new ui.window.MouseEvent('pointerdown', {
    bubbles: true, button: 0, ctrlKey: true, shiftKey: true, clientX: 340, clientY: 185,
  }));
  await ui.settle();

  assert.equal(ui.byId('object-info-name')!.textContent, '— 치로');
  assert.equal(ui.byId('tab-objects')!.hidden, false);
});

/** 창 크기 변경 및 스크롤에 따른 탭, 핸들의 위치 고정(Sticky) 동작 테스트 */
test('섹션을 끝까지 줄이면 딱 붙어서 높이가 0 이 된다', async (t) => {
  const ui = await mountDebugPanel(t);
  await ui.settle();
  const section = ui.byId('tab-run')!.querySelector('.debug-section');
  const drag = (from: any, to: any) => {
    section!.querySelector('.debug-vresize')!
      .dispatchEvent(new ui.window.MouseEvent('mousedown', { clientY: from, bubbles: true }));
    ui.window.dispatchEvent(new ui.window.MouseEvent('mousemove', { clientY: to }));
    ui.window.dispatchEvent(new ui.window.MouseEvent('mouseup'));
  };

  /** jsdom 환경에서는 요소의 렌더링 높이를 0으로 간주하므로, 마우스 드래그로 끌어당긴 픽셀 값이 그대로 요소의 높이가 되어야 합니다. */
  drag(100, 130); // 30px — 딱 붙는 크기보다 작다
  await ui.settle();
  assert.match(section!.getAttribute('style'), /height:\s*0px/);
  assert.match(section!.getAttribute('class'), /collapsed/);
  /** 크기가 최소로 줄어들어 패널이 접힌 상태에서도, 크기 조절 손잡이는 사용자가 다시 끌어당길 수 있도록 화면상 제자리에 유지되어야 합니다. */
  assert.equal(section!.querySelectorAll('.debug-vresize').length, 1);

  drag(100, 200); // 다시 끌어내면 딱 하고 펴진다
  await ui.settle();
  assert.match(section!.getAttribute('style'), /height:\s*100px/);
  assert.doesNotMatch(section!.getAttribute('class'), /collapsed/);
});

test('패널도 끝까지 줄이면 딱 붙어서 폭이 0 이 된다', async (t) => {
  const ui = await mountDebugPanel(t);
  await ui.settle();
  ui.window.innerWidth = 1200;
  const panel = ui.byId('debug-panel');
  const drag = (to: any) => {
    ui.byId('debug-resize-handle')!
      .dispatchEvent(new ui.window.MouseEvent('mousedown', { clientX: 800, bubbles: true }));
    ui.window.dispatchEvent(new ui.window.MouseEvent('mousemove', { clientX: to }));
    ui.window.dispatchEvent(new ui.window.MouseEvent('mouseup'));
  };

  drag(1180); // 폭 20px — 딱 붙는 크기보다 작다
  assert.equal(panel!.style.width, '0px');
  assert.match(panel!.className, /collapsed/);

  drag(1000); // 200px — 다시 보인다
  assert.equal(panel!.style.width, '200px');
  assert.doesNotMatch(panel!.className, /collapsed/);
});

test('접어 둔 패널을 다시 열면 폭이 되살아난다', async (t) => {
  const ui = await mountDebugPanel(t);
  await ui.settle();
  ui.window.innerWidth = 1200;
  ui.byId('debug-resize-handle')!
    .dispatchEvent(new ui.window.MouseEvent('mousedown', { clientX: 800, bubbles: true }));
  ui.window.dispatchEvent(new ui.window.MouseEvent('mousemove', { clientX: 1190 }));
  ui.window.dispatchEvent(new ui.window.MouseEvent('mouseup'));
  assert.equal(ui.byId('debug-panel')!.style.width, '0px');

  ui.click('debug-toggle');
  await ui.settle();
  assert.equal(ui.byId('debug-panel')!.style.width, '');
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
  /** 작품 이름이 렌더링되는 영역에 대해서만 XSS 방어 처리 여부를 검사합니다. 실행 탭 본문에는 의도된 HTML 태그가 포함될 수 있습니다. */
  const areas = ['#tab-data', '#tab-objects'];
  const selector = areas.flatMap((area) => ['img', 'svg', 'iframe', 'script', 'b'].map((tag) => area + ' ' + tag)).join(', ');
  for (const name of ['data', 'objects']) {
    ui.tab(name);
    await ui.settle();
    const injected = ui.window.document.querySelectorAll(selector);
    assert.equal(injected.length, 0, [...injected].map((node) => node.outerHTML).join('\n'));
  }
  assert.equal(ui.window.PWNED, undefined);
  /** 악의적인 스크립트가 실행되지 않도록 차단하더라도, 원본 문자열은 사용자가 시각적으로 읽을 수 있도록 그대로 표시되어야 합니다. */
  assert.match(ui.byId('scene-tree')!.textContent, /<img src=x/);
});

test('페이지에 넣는 값은 HTML 로도 스크립트로도 새어 나가지 않는다', () => {
  const evil = '</script><img src=x onerror=alert(1)><svg/onload=alert(2)>"\'`&<>';
  const html = playerPage({
    name: evil, base: evil, summary: { scenes: 1, objects: 1, blocks: 1 }, entName: evil, reload: true,
  });

  /** 렌더링된 결과물 내에 새로운 HTML 태그를 형성할 수 있는 문자가 이스케이프 처리되었는지 확인합니다. */
  const withoutComments = html.replace(/\/\/[^\n]*/g, '');
  assert.doesNotMatch(withoutComments, /<img/);
  assert.doesNotMatch(withoutComments, /<svg/);

  /** 주입된 데이터 내부에 닫는 스크립트 태그가 존재하지 않아, 인라인 스크립트 블록 전체가 브라우저에서 온전히 파싱되는지 확인합니다. */
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

  const sections = [...ui.byId('tab-run')!.querySelectorAll('.debug-section')];
  assert.equal(sections.length, 2);
  /** 패널의 마지막 섹션은 남은 가용 높이를 모두 차지하도록 설계되었으므로 크기 조절 손잡이가 노출되지 않아야 합니다. */
  assert.equal(sections[0].querySelectorAll('.debug-vresize').length, 1);
  assert.equal(sections[1].querySelectorAll('.debug-vresize').length, 0);
  assert.match(sections[0].getAttribute('style'), /height:\s*200px/);

  const handle = sections[0].querySelector('.debug-vresize');
  handle!.dispatchEvent(new ui.window.MouseEvent('mousedown', { clientY: 100, bubbles: true }));
  ui.window.dispatchEvent(new ui.window.MouseEvent('mousemove', { clientY: 160 }));
  ui.window.dispatchEvent(new ui.window.MouseEvent('mouseup'));
  await ui.settle();

  /** jsdom에서는 기본 요소 높이가 0으로 처리되므로 드래그한 거리(60px)가 해당 영역의 최종 높이가 되어야 합니다. */
  assert.match(sections[0].getAttribute('style'), /height:\s*60px/);
});

test('패널 폭은 좌우로 조절할 수 있다', async (t) => {
  const ui = await mountDebugPanel(t);
  await ui.settle();
  ui.window.innerWidth = 1200;

  const handle = ui.byId('debug-resize-handle');
  handle!.dispatchEvent(new ui.window.MouseEvent('mousedown', { clientX: 800, bubbles: true }));
  ui.window.dispatchEvent(new ui.window.MouseEvent('mousemove', { clientX: 700 }));
  ui.window.dispatchEvent(new ui.window.MouseEvent('mouseup'));

  assert.equal(ui.byId('debug-panel')!.style.width, '500px');
});

test('패널이 실제로 그려진다', async (t) => {
  /** 서버에서 제공하는 preact 의존성 파일의 내용이 변경되었을 때, 테스트 환경이 이를 정상적으로 반영하는지 검증합니다. */
  const ui = await mountDebugPanel(t);
  await ui.settle();
  const panel = ui.byId('debug-panel');

  assert.equal(panel!.querySelectorAll('.debug-tab').length, 4);

  /** 대규모 프로젝트의 성능 저하를 방지하기 위해 현재 화면에 보이지 않는 비활성 탭의 내용은 DOM에 렌더링하지 않아야 합니다. */
  const titles = [];
  for (const name of ['run', 'data', 'objects', 'errors']) {
    ui.tab(name);
    await ui.settle();
    titles.push(...[...panel!.querySelectorAll('.debug-section h3')].map((h) => h.textContent.trim()));
  }
  assert.deepEqual(titles, ['실행 제어', '실행 환경 흉내내기', '변수 · 리스트', '신호', '함수',
    '장면 · 오브젝트', '오브젝트 정보', '컴파일된 블록', '오류 로그']);

  ui.tab('run');
  await ui.settle();
  /** 렌더링 과정에서 디버그 UI의 자바스크립트 소스 코드가 일반 텍스트 형태로 화면에 노출되지 않아야 합니다. */
  const text = panel!.textContent;
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

  const textOf = (id: string) => ui.byId(id)!.textContent.replace(/\s+/g, ' ');

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
  assert.ok(ui.byId('block-tree')!.querySelectorAll('li').length > 20, '블록 트리가 펼쳐져야 한다');

  ui.window.tessReportError('실행 오류', new Error('일부러 낸 오류'));
  await ui.settle();
  assert.match(textOf('tab-errors'), /일부러 낸 오류/);
  /** 프로젝트 실행 중 오류가 발생하면 사용자에게 원인을 알리기 위해 오류 탭으로 자동 전환되어야 합니다. */
  assert.equal(ui.window.document.querySelector('.debug-tab[aria-selected="true"]')!.dataset.tab, 'errors');
});
