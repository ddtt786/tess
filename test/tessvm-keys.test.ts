/**
 * 교체된 화면(확장이 엔트리 실행기 자리에 놓는 플레이어) 안에서 누른 키가 페이지로
 * 새어 나가지 않는지 확인합니다 — 작품 안에서 space 를 누르면 탭이 스크롤되던 문제.
 *
 * 기준은 엔트리의 `Entry.Utils.captureKeyEvent` 입니다: 작품이 도는 동안에는 키의
 * 기본 동작을 모두 막고, 입력칸에 들어간 키와 단축키 조합은 그대로 둡니다.
 *
 * 브라우저 모듈이라 노드 타입 검사에서 빠져 있으므로, 확장 테스트와 같은 방식으로
 * 타입만 지운 원본을 jsdom 위에 올립니다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 무대를 그리지 않는 렌더러. 키를 다루는 데는 이 자리만 있으면 된다. */
const stubRenderer = () => ({
  canvasRect: () => ({ left: 0, top: 0, width: 640, height: 360 }),
  overlayView: null,
  flush() {},
});

/**
 * `bindInput` 을 jsdom 에 올리고, 확장이 만드는 것과 같은 화면을 꾸민다 —
 * 무대 · 대답 입력칸 · 아래 조작줄의 단추가 모두 한 뿌리(`root`) 안에 있다.
 */
function mountInput(t: any) {
  const dom = new JSDOM(
    '<!doctype html><body><div id="root" tabindex="0">'
      + '<div id="view"></div><input id="ask" type="text"><button id="stop"></button>'
      + '</div></body>',
    { pretendToBeVisual: true },
  );
  t.after(() => dom.window.close());

  const source = stripTypeScriptTypes(
    fs.readFileSync(path.join(root, 'packages/tessvm/src/web/boot.ts'), 'utf-8'),
    { mode: 'strip' },
  );
  const sandbox: Record<string, unknown> = { window: dom.window, document: dom.window.document };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(
    `${source.replace(/^import[^;]*;$/gm, '').replace(/^export /gm, '')}\nthis.bind = bindInput;`,
    sandbox,
  );

  const fired: Array<[string, string | undefined]> = [];
  const stage = {
    state: 'run',
    pressedKeys: new Set<number>(),
    targets: [],
    mouseX: 0,
    mouseY: 0,
    mouseDown: false,
    clickedEntityId: null,
    fireEvent: (event: string, filter?: string) => {
      fired.push([event, filter]);
      return [];
    },
    fireEventOn: () => [],
  };
  const document_ = dom.window.document;
  const view = document_.getElementById('view')!;
  const player = document_.getElementById('root')!;
  (sandbox.bind as any)(stage, stubRenderer(), view, player, []);

  /** 키를 눌러 보고, 페이지가 그 키를 그대로 쓸 수 있었는지 돌려준다. */
  const press = (on: string, init: Record<string, unknown>, type = 'keydown') => {
    let sawIt = false;
    const watch = () => { sawIt = true; };
    document_.addEventListener(type, watch);
    const event = new dom.window.KeyboardEvent(type, { bubbles: true, cancelable: true, ...init });
    document_.getElementById(on)!.dispatchEvent(event);
    document_.removeEventListener(type, watch);
    return { prevented: event.defaultPrevented, reachedPage: sawIt };
  };
  return { press, stage, fired };
}

test('작품 안에서 누른 키는 페이지로 가지 않는다', (t) => {
  const { press } = mountInput(t);

  // space 를 눌러도 탭이 내려가지 않는다
  assert.deepEqual(press('root', { code: 'Space' }), { prevented: true, reachedPage: false });
  assert.deepEqual(press('root', { code: 'ArrowDown' }), { prevented: true, reachedPage: false });
  assert.deepEqual(press('root', { code: 'KeyA' }), { prevented: true, reachedPage: false });
  // 뗄 때도 마찬가지다
  assert.deepEqual(
    press('root', { code: 'Space' }, 'keyup'),
    { prevented: true, reachedPage: false },
  );
});

test('대답 입력칸과 조작줄 단추의 키는 그대로 둔다', (t) => {
  const { press } = mountInput(t);

  for (const on of ['ask', 'stop']) {
    assert.deepEqual(press(on, { code: 'Space' }), { prevented: false, reachedPage: true }, on);
    assert.deepEqual(press(on, { code: 'ArrowLeft' }), { prevented: false, reachedPage: true }, on);
  }
});

test('브라우저 단축키 조합은 그대로 둔다', (t) => {
  const { press } = mountInput(t);

  assert.equal(press('root', { code: 'KeyR', ctrlKey: true }).prevented, false);
  assert.equal(press('root', { code: 'KeyC', metaKey: true }).prevented, false);
  assert.equal(press('root', { code: 'ArrowLeft', altKey: true }).prevented, false);
  // ctrl 자체를 읽는 작품이 있으므로, 조합이 아니라 그 키 하나는 작품의 것이다
  assert.equal(press('root', { code: 'ControlLeft', ctrlKey: true }).prevented, true);
});

test('작품이 돌지 않는 동안에는 페이지가 키를 그대로 쓴다', (t) => {
  const { press, stage } = mountInput(t);

  for (const state of ['stop', 'pause']) {
    stage.state = state;
    assert.deepEqual(press('root', { code: 'Space' }), { prevented: false, reachedPage: true }, state);
  }
});

/**
 * 키를 꾹 누르고 있으면 브라우저가 keydown 을 되풀이해 보내고, 엔트리는 그것을 하나하나
 * 이벤트로 올립니다(`Entry.Utils.captureKeyEvent` 는 눌린 키를 따로 세지 않습니다).
 * 첫 번째만 올리면 `키를 눌렀을 때 -> 이동하기` 가 한 칸만 움직이고 멈춥니다.
 */
test('키를 누르고 있으면 되풀이되는 keydown 도 그대로 올라간다', (t) => {
  const { press, fired, stage } = mountInput(t);

  press('root', { code: 'ArrowRight' });
  press('root', { code: 'ArrowRight', repeat: true });
  press('root', { code: 'ArrowRight', repeat: true });
  assert.deepEqual(fired, [
    ['keyPress', '39'],
    ['keyPress', '39'],
    ['keyPress', '39'],
  ]);
  assert.deepEqual([...stage.pressedKeys], [39], '눌린 키는 한 번만 담깁니다');

  // 떼면 그 자리는 비고, 다시 누르면 또 올라갑니다.
  press('root', { code: 'ArrowRight' }, 'keyup');
  assert.deepEqual([...stage.pressedKeys], []);
  press('root', { code: 'ArrowRight' });
  assert.equal(fired.length, 4);
});
