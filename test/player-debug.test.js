// Mounts the debug panel UI (src/player/debug-ui.js) in jsdom and drives it against a fake Entry engine.
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

/** Mounts the debug UI module in jsdom, stripping its import and injecting arrow-js directly. */
async function mountDebugPanel(t) {
  const html = playerPage({
    name: '치로', base: '/lib', summary: { scenes: 1, objects: 1, blocks: 1 }, entName: 'a.ent', reload: false,
  });
  const shell = html.slice(0, html.indexOf('<script')) + '</body></html>';
  const dom = new JSDOM(shell, { runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  t.after(() => window.close()); // a status-polling setInterval keeps running otherwise

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
  window.Entry = {
    engine,
    block: blocks,
    variableContainer: {
      getVariable: (id) => (id === 'v1' ? { getValue: () => 42 } : null),
      getList: (id) => (id === 'l1' ? { getArray: () => [{ data: 'ㄱ' }, { data: 'ㄴ' }] } : null),
    },
  };
  window.tessDebugSink = (fn) => { window.__sink = fn; };
  window.tessReportError = (kind, error) => window.__sink({
    kind: String(kind), message: String(error && error.message), stack: '', time: Date.now(),
  });
  window.fetch = () => Promise.resolve({ json: () => Promise.resolve({}) });

  // arrow-js is imported on the Node side, so the global document must point at jsdom's.
  const globals = ['document', 'Node', 'Element', 'HTMLElement', 'DocumentFragment',
    'Text', 'Comment', 'NodeFilter', 'MutationObserver', 'requestAnimationFrame'];
  const saved = globals.map((key) => [key, globalThis[key]]);
  for (const key of globals) globalThis[key] = window[key];
  t.after(() => { for (const [key, value] of saved) globalThis[key] = value; });

  // Uses the exact arrow-js file the browser is served, not the package's default
  // entry point, so a break in that specific file is actually caught here.
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
    byId,
    click: (id) => byId(id).dispatchEvent(new window.MouseEvent('click')),
    choose: (id, value) => {
      byId(id).value = value;
      byId(id).dispatchEvent(new window.Event('change'));
    },
    tab: (name) => window.document.querySelector('.debug-tab[data-tab="' + name + '"]')
      .dispatchEvent(new window.MouseEvent('click')),
    settle: () => new Promise((resolve) => setTimeout(resolve, 20)),
  };
}

test('디버그 패널은 탭으로 나뉘고, 한 번에 하나만 보인다', async (t) => {
  const ui = await mountDebugPanel(t);
  await ui.settle();
  const tabs = [...ui.window.document.querySelectorAll('.debug-tab')];
  assert.deepEqual(tabs.map((button) => button.dataset.tab), ['run', 'data', 'objects', 'errors']);

  // The run tab is shown initially.
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
  // Run while paused resumes rather than restarting.
  ui.click('run-btn');
  assert.equal(ui.engine.state, 'run');

  ui.click('stop-btn');
  assert.equal(ui.engine.state, 'stop');
  ui.click('run-btn'); // must be able to run again after a full stop
  assert.equal(ui.engine.state, 'run');
});

test('실행 상태에 따라 버튼과 안내 글이 바뀐다', async (t) => {
  const ui = await mountDebugPanel(t);
  await ui.settle();

  const stateText = () => ui.window.document.querySelector('.debug-run-state').textContent;

  ui.click('stop-btn');
  await ui.settle();
  assert.match(stateText(), /멈춰/);
  assert.equal(ui.byId('pause-btn').disabled, true); // nothing to pause while stopped
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

  // The default passes through the browser's real value unchanged.
  assert.equal(ui.blocks.is_boost_mode.func(), '실제부스트');
  assert.equal(ui.blocks.is_touch_supported.func(), '실제터치');
  assert.equal(ui.blocks.is_current_device_type.func(null, askMobile), '실제mobile');

  ui.choose('env-boost', 'true');
  assert.equal(ui.blocks.is_boost_mode.func(), true);
  ui.choose('env-boost', 'false');
  assert.equal(ui.blocks.is_boost_mode.func(), false);
  ui.choose('env-boost', ''); // back to the real value
  assert.equal(ui.blocks.is_boost_mode.func(), '실제부스트');

  ui.choose('env-touch', 'false');
  assert.equal(ui.blocks.is_touch_supported.func(), false);

  // The device block asks "is the current device X?", so it answers by equality with the chosen value.
  ui.choose('env-device', 'mobile');
  assert.equal(ui.blocks.is_current_device_type.func(null, askMobile), true);
  ui.choose('env-device', 'desktop');
  assert.equal(ui.blocks.is_current_device_type.func(null, askMobile), false);
});

/** A small project with variables, a message, and a function. */
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

test('자료 탭에서 변수의 지금 값 · 신호 · 함수를 볼 수 있다', async (t) => {
  const ui = await mountDebugPanel(t);
  await ui.settle();
  ui.window.tessRenderProjectDebug(dataProject);
  ui.tab('data');
  await ui.settle();

  const variables = ui.byId('var-list').textContent;
  assert.match(variables, /점수/);
  assert.match(variables, /42/);          // reads the live running value
  assert.match(variables, /기록/);
  assert.match(variables, /\[2개\]/);
  assert.doesNotMatch(variables, /초시계/); // timer/answer are Tess built-ins, excluded from the list

  assert.match(ui.byId('signal-list').textContent, /게임 시작/);
  const functions = ui.byId('function-list').textContent;
  assert.match(functions, /스폰/);
  assert.match(functions, /1개 인자/);
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

  // Only checks the areas where project names are rendered (the run tab's own copy has a literal <b>).
  const areas = ['#tab-data', '#tab-objects'];
  const selector = areas.flatMap((area) => ['img', 'svg', 'iframe', 'script', 'b'].map((tag) => area + ' ' + tag)).join(', ');
  const injected = ui.window.document.querySelectorAll(selector);
  assert.equal(injected.length, 0, [...injected].map((node) => node.outerHTML).join('\n'));
  assert.equal(ui.window.PWNED, undefined);
  // The name must still render as plain readable text.
  assert.match(ui.byId('scene-tree').textContent, /<img src=x/);
});

test('페이지에 넣는 값은 HTML 로도 스크립트로도 새어 나가지 않는다', () => {
  const evil = '</script><img src=x onerror=alert(1)><svg/onload=alert(2)>"\'`&<>';
  const html = playerPage({
    name: evil, base: evil, summary: { scenes: 1, objects: 1, blocks: 1 }, entName: evil, reload: true,
  });

  // No sequence should form a tag (each must be escaped to &lt; or safely literal).
  const withoutComments = html.replace(/\/\/[^\n]*/g, '');
  assert.doesNotMatch(withoutComments, /<img/);
  assert.doesNotMatch(withoutComments, /<svg/);

  // No inline script may contain a raw </script, and each must parse.
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
  // The last section fills the remaining height, so it has no resize handle.
  assert.equal(sections[0].querySelectorAll('.debug-vresize').length, 1);
  assert.equal(sections[1].querySelectorAll('.debug-vresize').length, 0);
  assert.match(sections[0].getAttribute('style'), /height:200px/);

  const handle = sections[0].querySelector('.debug-vresize');
  handle.dispatchEvent(new ui.window.MouseEvent('mousedown', { clientY: 100, bubbles: true }));
  ui.window.dispatchEvent(new ui.window.MouseEvent('mousemove', { clientY: 160 }));
  ui.window.dispatchEvent(new ui.window.MouseEvent('mouseup'));
  await ui.settle();

  // jsdom measures actual height as 0, so the height becomes exactly the drag delta (60px).
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
  // arrow-js 1.0.6's index.min.mjs fails to render lists and prints internal
  // function source as text instead; this catches that regression.
  const ui = await mountDebugPanel(t);
  await ui.settle();
  const panel = ui.byId('debug-panel');

  assert.equal(panel.querySelectorAll('.debug-tab').length, 4);
  assert.equal(panel.querySelectorAll('.debug-section').length, 8);
  assert.deepEqual(
    [...panel.querySelectorAll('.debug-section h3')].map((h) => h.textContent.trim()),
    ['실행 제어', '실행 환경 흉내내기', '변수 · 리스트', '신호', '함수', '장면 · 오브젝트', '컴파일된 블록', '오류 로그'],
  );

  // JavaScript source must not leak into the rendered text.
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
  assert.match(data, /점수/);            // variable
  assert.match(data, /전역 · 변수/);
  assert.match(data, /기록 전역 · 리스트 \[3개\] \[1,2,3\]/); // shows the initial value before running
  assert.match(data, /체력 주인공 · 변수 100/);
  assert.match(data, /신호1/);
  assert.match(data, /두배 … 값/);        // function name with a mid-chain label
  assert.match(data, /값 함수/);

  ui.tab('objects');
  await ui.settle();
  const objects = textOf('tab-objects');
  assert.match(objects, /주인공/);
  assert.match(objects, /when_run_button_click/);
  assert.match(objects, /스크립트 1/);
  assert.ok(ui.byId('block-tree').querySelectorAll('li').length > 20, 'block tree must be expanded');

  ui.window.tessReportError('실행 오류', new Error('일부러 낸 오류'));
  await ui.settle();
  assert.match(textOf('tab-errors'), /일부러 낸 오류/);
  // An error switches the panel to the errors tab.
  assert.equal(ui.window.document.querySelector('.debug-tab[aria-selected="true"]').dataset.tab, 'errors');
});
