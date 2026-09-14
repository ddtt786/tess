/**
 * 클립보드를 읽은 것을 보는 사람에게 알리는 자리를 확인합니다
 * (`packages/tessvm/src/web/extras.ts`).
 *
 * 복사는 허용 창으로 묻지만 붙여넣기는 묻지 않으므로, 그 대신 읽었다는 알림이 떴다가
 * 스스로 사라집니다. 대답 입력칸은 붙여넣은 글이 칸에 그대로 보이므로 뺍니다.
 *
 * 브라우저 모듈이라 노드 타입 검사에서 빠져 있어, 다른 브라우저 모듈 테스트와 같은
 * 방식으로 타입만 지운 원본을 jsdom 위에 올립니다.
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

/** 무대를 그리지 않는 렌더러. 붙여넣기에는 이 자리만 있으면 된다. */
const stubRenderer = () => ({ canvasRect: () => ({ left: 0, top: 0, width: 640, height: 360 }) });

/**
 * `bindExtras` 를 jsdom 에 올린다 — 무대 상자 안에 캔버스와 대답 입력칸이 있는,
 * 실행 페이지가 꾸미는 것과 같은 자리다.
 */
function mountExtras(t: any) {
  const dom = new JSDOM(
    '<!doctype html><body><div id="view"><div id="frame"><canvas id="canvas"></canvas>'
      + '<form class="tessvm-ask"><input id="answer" type="text"></form>'
      + '</div></div><textarea id="comment"></textarea></body>',
    { pretendToBeVisual: true },
  );
  t.after(() => dom.window.close());

  // 사라지는 시간을 실제로 기다리지 않도록 타이머를 붙잡아 둔다.
  const timers = new Map<number, () => void>();
  let nextTimer = 1;
  dom.window.setTimeout = ((run: () => void) => {
    timers.set(nextTimer, run);
    return nextTimer++;
  }) as never;

  const source = stripTypeScriptTypes(
    fs.readFileSync(path.join(root, 'packages/tessvm/src/web/extras.ts'), 'utf-8'),
    { mode: 'strip' },
  );
  const sandbox: Record<string, unknown> = {
    window: dom.window,
    document: dom.window.document,
    clearTimeout: (id: number) => timers.delete(id),
    performance: dom.window.performance,
    navigator: dom.window.navigator,
    Node: dom.window.Node,
    Element: dom.window.Element,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(
    `${source.replace(/^import[^;]*;$/gm, '').replace(/^export /gm, '')}\nthis.bind = bindExtras;`,
    sandbox,
  );

  const pasted: string[] = [];
  const machine = {
    state: 'run',
    extras: {
      host: null as unknown,
      uses: { clipboard: true, cursor: false, mouseLock: false, scroll: false },
      pasted: (text: string) => pasted.push(text),
      lockChanged: () => undefined,
      moved: () => undefined,
      scrolled: () => undefined,
    },
  };
  const document_ = dom.window.document;
  const view = document_.getElementById('view')!;
  const frame = document_.getElementById('frame')!;
  const cleanups: Array<() => void> = [];
  const binding = (sandbox.bind as any)(machine, stubRenderer(), frame, view, cleanups);

  return {
    machine,
    pasted,
    binding,
    cleanups,
    notice: () => frame.querySelector('.tessvm-notice') as HTMLElement | null,
    focus(on: string) {
      (document_.getElementById(on) as HTMLElement).focus();
    },
    /** 붙여넣기 한 번. 이벤트는 창에서 듣고 있으므로 어디서 올라오는지가 전부다. */
    paste(on: string, text: string) {
      const event = new dom.window.Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', {
        value: { getData: () => text },
      });
      document_.getElementById(on)!.dispatchEvent(event);
    },
    /** 알림이 스스로 사라지는 자리 — 걸어 둔 타이머를 그 자리에서 돌린다. */
    runTimers() {
      const waiting = [...timers.values()];
      timers.clear();
      waiting.forEach((run) => run());
    },
  };
}

test('무대에 붙여넣으면 클립보드를 읽었다는 알림이 떴다가 사라진다', (t) => {
  const page = mountExtras(t);
  page.paste('canvas', '붙여넣기');

  assert.deepEqual(page.pasted, ['붙여넣기'], '값은 작품으로 들어갑니다');
  const notice = page.notice()!;
  assert.ok(notice, '알림 자리가 있습니다');
  assert.equal(notice.hidden, false);
  assert.match(notice.textContent ?? '', /클립보드/);

  page.runTimers();
  assert.equal(notice.hidden, true, '스스로 사라집니다');
});

test('대답 입력칸에 붙여넣으면 알림은 뜨지 않는다', (t) => {
  const page = mountExtras(t);
  page.paste('answer', '대답');

  assert.deepEqual(page.pasted, ['대답'], '값은 그대로 작품으로 들어갑니다');
  assert.equal(page.notice()?.hidden, true, '칸에 글이 보이므로 알릴 것이 없습니다');
});

test('작품이 도는 중이 아니거나 페이지의 다른 칸에 붙여넣으면 아무 일도 없다', (t) => {
  const page = mountExtras(t);
  // 무대 밖 — 확장이 얹히는 playentry.org 의 댓글칸 같은 자리.
  page.focus('comment');
  page.paste('comment', '댓글');
  assert.deepEqual(page.pasted, []);
  assert.equal(page.notice()?.hidden, true);

  page.machine.state = 'stop';
  page.paste('canvas', '멈춘 사이');
  assert.deepEqual(page.pasted, [], '멈춘 작품은 클립보드를 읽지 않습니다');
  assert.equal(page.notice()?.hidden, true);
});
