/** Verifies mouse button variables and the extension's context menu shortcut. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { JSDOM } from 'jsdom';
import { compileProject } from '@tess/compiler';
import { Vm, Variable, type EntryProjectLike } from '@tess/vm';

function runner(names = ['$MOUSE_BUTTONS', '$M_BUTTONS']) {
  const source = names.map((name, i) => `var buttons${i} as "${name}" = 99`).join('\n');
  const compiled = compileProject(`${source}
scene "s":
  object "o":
    when start do
      wait 10
    end
  end
end`, { path: 'mouse.tess' });
  assert.deepEqual(compiled.errors, []);
  const result = new Vm({ renderer: null, audio: null });
  result.load(compiled.project! as unknown as EntryProjectLike);
  return result;
}

const values = (runner: Vm) => runner.variables
  .filter(variable => ['$MOUSE_BUTTONS', '$M_BUTTONS'].includes(variable.name))
  .map(variable => variable.getValue());
const source = (path: string) => stripTypeScriptTypes(fs.readFileSync(
  new URL(`../packages/${path}`, import.meta.url), 'utf8',
)).replace(/^import[^;]*;/gm, '').replace(/^export /gm, '');

function page(t: { after(fn: () => void): void }, runner: Vm) {
  const dom = new JSDOM('<div id="root"><div id="view"></div></div>', {
    url: 'https://playentry.org/project/test', runScripts: 'outside-only',
  });
  const context = dom.getInternalVMContext();
  vm.runInContext(`${source('tessvm/src/web/extras.ts')}\nwindow.bind = bindExtras;`, context);
  vm.runInContext(`${source('extension/src/page/player.ts')}\nwindow.makeMenu = mountMenu;`, context);
  const root = dom.window.document.getElementById('root')!;
  const view = dom.window.document.getElementById('view')!;
  const api = dom.window as unknown as {
    bind(vm: Vm, renderer: object, root: HTMLElement, view: HTMLElement, cleanups: Array<() => void>): {
      dispose(): void;
    };
    makeMenu(root: HTMLElement, lines: () => Array<object>, requiresControl: () => boolean): {
      dispose(): void;
    };
  };
  const cleanups: Array<() => void> = [];
  const input = api.bind(runner, {}, root, view, cleanups);
  const menu = api.makeMenu(root, () => [{ label: '정지', run() {} }], () => runner.extras.uses.mouseButtons);
  const dispose = () => {
    for (const cleanup of cleanups.splice(0)) cleanup();
    input.dispose();
    menu.dispose();
  };
  t.after(() => { dispose(); dom.window.close(); });
  const mouse = (type: string, buttons: number, options: {
    outside?: boolean; shiftKey?: boolean; ctrlKey?: boolean; altKey?: boolean; button?: number;
  } = {}) => {
    const event = new dom.window.MouseEvent(type, {
      buttons, button: options.button ?? 0, shiftKey: options.shiftKey,
      ctrlKey: options.ctrlKey, altKey: options.altKey,
      bubbles: true, cancelable: true,
    });
    (options.outside ? dom.window : view).dispatchEvent(event);
    return event;
  };
  return {
    mouse, dispose, view, root,
    blur: () => dom.window.dispatchEvent(new dom.window.Event('blur')),
    cancel: () => view.dispatchEvent(new dom.window.Event('pointercancel')),
    menu: root.querySelector<HTMLElement>('.tessvm-menu')!,
  };
}

test('버튼 변수는 0으로 시작하며 두 별칭에 같은 비트마스크를 반환한다', () => {
  const vm = runner();
  assert.equal(vm.extras.uses.mouseButtons, true);
  assert.deepEqual(values(vm), [0, 0]);
  vm.start();
  for (const buttons of [1, 3, 2, 4, 8, 16, 31, 0]) {
    vm.extras.buttonsChanged(buttons);
    assert.deepEqual(values(vm), [buttons, buttons]);
  }
  vm.extras.buttonsChanged(5);
  vm.variables[0]!.setValue(99);
  vm.tick();
  assert.deepEqual(values(vm), [5, 5]);
  vm.stop();
  assert.deepEqual(values(vm), [0, 0]);
  vm.start();
  assert.deepEqual(values(vm), [0, 0]);
});

test('별칭 하나만 선언해도 동작하고 시작 전 눌림 상태를 첫 실행에서 읽는다', () => {
  for (const name of ['$MOUSE_BUTTONS', '$M_BUTTONS']) {
    const vm = runner([name]);
    vm.extras.buttonsChanged(2);
    vm.start();
    assert.deepEqual(values(vm), [2]);
  }
});

test('지역 변수와 리스트는 버튼 변수로 등록하지 않는다', () => {
  const vm = runner([]);
  vm.variables.push(new Variable('local', '$MOUSE_BUTTONS', vm.targets[0]!.id, 'variable'));
  vm.variables.push(new Variable('list', '$M_BUTTONS', null, 'list'));
  vm.extras.bind();
  assert.equal(vm.extras.uses.mouseButtons, false);
  vm.extras.buttonsChanged(3);
  assert.deepEqual(values(vm), [0, 0]);
});

test('마우스 버튼을 조합하거나 무대 밖에서 하나씩 놓으면 즉시 갱신한다', t => {
  const vm = runner();
  vm.start();
  const p = page(t, vm);
  for (const [type, buttons, button, outside] of [
    ['mousedown', 1, 0, false], ['mousedown', 3, 2, false],
    ['mouseup', 2, 0, true], ['mouseup', 0, 2, true],
    ['mousedown', 4, 1, false], ['mouseup', 0, 1, true],
    ['mousedown', 8, 3, false], ['mouseup', 0, 3, true],
    ['mousedown', 16, 4, false], ['mouseup', 0, 4, true],
  ] as const) {
    p.mouse(type, buttons, { button, outside });
    assert.deepEqual(values(vm), [buttons, buttons]);
  }
  p.mouse('mouseup', 1, { outside: true });
  assert.deepEqual(values(vm), [0, 0]);
});

test('이동·포커스 상실·포인터 취소·해제 후 눌림 상태가 남지 않는다', t => {
  const vm = runner();
  vm.start();
  const p = page(t, vm);
  p.mouse('mousedown', 3);
  p.mouse('mousemove', 0);
  assert.deepEqual(values(vm), [0, 0]);
  p.mouse('mousedown', 2);
  p.blur();
  assert.deepEqual(values(vm), [0, 0]);
  p.mouse('mousedown', 1);
  p.cancel();
  assert.deepEqual(values(vm), [0, 0]);
  p.mouse('mousedown', 1);
  p.dispose();
  p.mouse('mousedown', 2);
  assert.deepEqual(values(vm), [0, 0]);
});

test('버튼 변수가 있는 작품은 Ctrl+우클릭으로만 메뉴를 연다', t => {
  for (const name of ['$MOUSE_BUTTONS', '$M_BUTTONS']) {
    const vm = runner([name]);
    vm.start();
    const p = page(t, vm);
    p.mouse('mousedown', 2, { button: 2 });
    assert.equal(p.mouse('contextmenu', 2, { button: 2 }).defaultPrevented, true);
    assert.equal(p.menu.hidden, true);
    assert.deepEqual(values(vm), [2]);
    p.mouse('contextmenu', 2, { button: 2, shiftKey: true });
    assert.equal(p.menu.hidden, true);
    p.mouse('contextmenu', 2, { button: 2, altKey: true });
    assert.equal(p.menu.hidden, true);
    assert.equal(p.mouse('contextmenu', 2, { button: 2, ctrlKey: true }).defaultPrevented, true);
    assert.equal(p.menu.hidden, false);
    p.mouse('contextmenu', 2, { button: 2 });
    assert.equal(p.menu.hidden, true);
  }
});

test('버튼 변수가 없는 작품의 메뉴는 기존 우클릭으로 열린다', t => {
  const p = page(t, runner([]));
  assert.equal(p.mouse('contextmenu', 2, { button: 2 }).defaultPrevented, true);
  assert.equal(p.menu.hidden, false);
});
