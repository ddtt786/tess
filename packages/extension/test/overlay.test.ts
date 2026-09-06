/**
 * 무대 위에 얹는 판의 실행 조작(시작·일시정지·정지)을 봅니다. tessvm 이 그것들을
 * 전부 지원하므로, 엔트리 단추가 어떻게 배선되어 있든 여기서 바로 조작할 수 있어야
 * 합니다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><body><canvas id="entryCanvas"></canvas></body>', {
  url: 'https://playentry.org/project/6a9b8f8dc769f2b3c8b13d20',
  pretendToBeVisual: true,
});
const scope = globalThis as unknown as { window?: unknown; document?: unknown };
scope.window = dom.window;
scope.document = dom.window.document;

const { StageOverlay } = await import('../src/page/overlay.ts');

function open(t: { after(fn: () => void): void }) {
  const overlay = new StageOverlay();
  t.after(() => overlay.dispose());
  const pressed: string[] = [];
  overlay.onTransport({
    start: () => pressed.push('start'),
    pause: () => pressed.push('pause'),
    stop: () => pressed.push('stop'),
  });
  const buttons = [...overlay.host.querySelectorAll('.tessvm-ext-controls button')] as HTMLButtonElement[];
  return { overlay, pressed, buttons };
}

test('판에서 바로 시작·일시정지·정지를 누를 수 있다', (t) => {
  const { pressed, buttons } = open(t);
  assert.deepEqual(buttons.map((button) => button.textContent), ['시작하기', '일시정지', '정지하기']);
  for (const button of buttons) button.click();
  assert.deepEqual(pressed, ['start', 'pause', 'stop']);
});

test('지금 할 수 없는 조작은 눌리지 않는다', (t) => {
  const { overlay, buttons } = open(t);
  const [start, pause, stop] = buttons as [HTMLButtonElement, HTMLButtonElement, HTMLButtonElement];

  overlay.setTransport('stopped');
  assert.deepEqual([start.disabled, pause.disabled, stop.disabled], [false, true, true]);

  overlay.setTransport('running');
  assert.deepEqual([start.disabled, pause.disabled, stop.disabled], [true, false, false]);

  overlay.setTransport('paused');
  assert.deepEqual([start.disabled, pause.disabled, stop.disabled], [false, true, false]);
  assert.equal(start.textContent, '이어하기');
});

test('엔트리 실행기로 되돌리는 단추가 있다', (t) => {
  const { overlay } = open(t);
  let asked = 0;
  overlay.onDisable(() => {
    asked += 1;
  });
  const button = [...overlay.host.querySelectorAll('.tessvm-ext-panel > button')].pop() as HTMLButtonElement;
  assert.equal(button.textContent, '엔트리 실행기로 되돌리기');
  button.click();
  assert.equal(asked, 1);
});

test('알림은 무대를 가리지도 클릭을 막지도 않는다', (t) => {
  const { overlay } = open(t);
  const canvas = dom.window.document.getElementById('entryCanvas')!;
  overlay.notice(canvas, '실패', ['그대로 엔트리가 돌립니다']);
  assert.ok(overlay.host.classList.contains('tessvm-ext-notice'));
  overlay.show();
  assert.equal(overlay.host.classList.contains('tessvm-ext-notice'), false);
});

test.after(() => dom.window.close());
