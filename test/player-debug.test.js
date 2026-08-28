// 실행 페이지의 디버그 패널 검사.
//
// 이 패널은 브라우저에서만 살아 움직이는 코드라 그동안 자동 검사가 전혀 없었다.
// 페이지에서 디버그 IIFE 만 떼어 내 jsdom 에 올리고, 엔트리 실행기 자리에는 가짜를
// 세워서 탭 전환 · 실행 제어 · 실행 환경 흉내내기 · 자료 보기를 실제로 눌러 본다.
// 특히 XSS: 이 패널이 보여 주는 이름은 전부 작품에서 온 값이고 작품은 남이 만든
// .ent 를 되돌린 것일 수도 있으므로, 어떤 이름도 태그가 되어서는 안 된다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { playerPage } from '../src/player/template.js';

/** 페이지의 첫 번째 인라인 스크립트(디버그 패널)만 jsdom 에 올린다 */
function mountDebugPanel(t) {
  const html = playerPage({
    name: '치로', base: '/lib', summary: { scenes: 1, objects: 1, blocks: 1 }, entName: 'a.ent', reload: false,
  });
  const debugScript = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)][0][1];
  const shell = html.slice(0, html.indexOf('<script')) + '</body></html>';

  const dom = new JSDOM(shell, { runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  // 디버그 패널이 상태를 계속 확인하려고 setInterval 을 걸어 두므로 꼭 닫아야 한다
  t.after(() => window.close());

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

  window.eval(debugScript);

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
  };
}

test('디버그 패널은 탭으로 나뉘고, 한 번에 하나만 보인다', (t) => {
  const ui = mountDebugPanel(t);
  const tabs = [...ui.window.document.querySelectorAll('.debug-tab')];
  assert.deepEqual(tabs.map((button) => button.dataset.tab), ['run', 'data', 'objects', 'errors']);

  // 처음엔 실행 탭
  assert.equal(ui.byId('tab-run').hidden, false);
  assert.equal(ui.byId('tab-data').hidden, true);

  ui.tab('objects');
  assert.equal(ui.byId('tab-objects').hidden, false);
  assert.equal(ui.byId('tab-run').hidden, true);
  assert.equal(tabs.find((b) => b.dataset.tab === 'objects').getAttribute('aria-selected'), 'true');
  assert.equal(tabs.find((b) => b.dataset.tab === 'run').getAttribute('aria-selected'), 'false');
});

test('정지한 뒤에도 시작하기로 다시 실행할 수 있다', (t) => {
  const ui = mountDebugPanel(t);

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

test('실행 상태에 따라 버튼과 안내 글이 바뀐다', (t) => {
  const ui = mountDebugPanel(t);

  ui.click('stop-btn');
  assert.match(ui.byId('run-state-text').textContent, /멈춰/);
  assert.equal(ui.byId('pause-btn').disabled, true); // 멈춰 있으면 일시정지할 게 없다
  assert.equal(ui.byId('run-btn').disabled, false);

  ui.click('run-btn');
  assert.match(ui.byId('run-state-text').textContent, /실행 중/);
  assert.equal(ui.byId('run-btn').disabled, true);

  ui.click('pause-btn');
  assert.equal(ui.byId('pause-btn').textContent, '이어서 하기');
});

test('부스트 모드 · 기기 · 터치를 디버그 창에서 정한 값으로 바꿔치기한다', (t) => {
  const ui = mountDebugPanel(t);
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

test('자료 탭에서 변수의 지금 값 · 신호 · 함수를 볼 수 있다', (t) => {
  const ui = mountDebugPanel(t);
  ui.window.tessRenderProjectDebug(dataProject);
  ui.tab('data');

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

test('자료 탭의 신호를 눌러서 바로 보낼 수 있다', (t) => {
  const ui = mountDebugPanel(t);
  ui.window.tessRenderProjectDebug(dataProject);
  ui.tab('data');

  ui.byId('signal-list').querySelector('.debug-send-btn')
    .dispatchEvent(new ui.window.MouseEvent('click'));
  assert.deepEqual(ui.engine.fired, [['when_message_cast', 'm1']]);
});

test('작품 안의 이름은 어떤 것도 태그가 되지 않는다 (XSS)', (t) => {
  const ui = mountDebugPanel(t);
  ui.window.tessRenderProjectDebug({
    scenes: [{ id: 's1', name: '<img src=x onerror=window.PWNED=1>' }],
    objects: [{ id: 'o1', name: '<script>window.PWNED=1</script>', scene: 's1', script: '[]' }],
    variables: [{ id: 'v9', name: '<svg onload=window.PWNED=1>', value: '<b>굵게</b>' }],
    messages: [{ id: 'm9', name: '<iframe src=javascript:1>' }],
    functions: [],
  });
  ui.tab('data');

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
