/**
 * 툴바 단추 뒤의 설정 창(`packages/extension/src/popup`)을 확인합니다.
 *
 * 실행기는 단추 하나입니다 — 누르면 켜지고 다시 누르면 꺼지며, 그때마다 저장소에
 * 그 값을 씁니다(열려 있는 작품 페이지가 같은 키를 보고 있습니다). 나머지 스위치는
 * 그 실행기의 설정입니다.
 *
 * 브라우저 모듈이라 노드 타입 검사에서 빠져 있어, 다른 확장 테스트와 같은 방식으로
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
const POPUP = path.join(root, 'packages/extension/src/popup');

/** 설정 창을 jsdom 에 올린다. 저장소 대신 받아 적는 자리를 놓아 둔다. */
async function mountPopup(t: any, stored: Record<string, boolean>) {
  const html = fs.readFileSync(path.join(POPUP, 'popup.html'), 'utf-8');
  const dom = new JSDOM(html, { pretendToBeVisual: true });
  t.after(() => dom.window.close());

  const written: Array<[string, boolean]> = [];
  const source = stripTypeScriptTypes(fs.readFileSync(path.join(POPUP, 'popup.ts'), 'utf-8'), {
    mode: 'strip',
  });
  const settings = { enabled: true, svg: true, mask: true, notice: false, ...stored };
  const sandbox: Record<string, unknown> = {
    document: dom.window.document,
    readSettings: () => Promise.resolve(settings),
    write: (key: string, value: boolean) => {
      written.push([key, value]);
      return Promise.resolve();
    },
    ENABLED_KEY: 'enabled',
    SVG_KEY: 'svg',
    MASK_KEY: 'mask',
    NOTICE_KEY: 'notice',
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source.replace(/^import[^;]*;$/gm, ''), sandbox);
  // 저장소를 읽고 화면을 칠하는 일은 프로미스 뒤에 있습니다.
  await new Promise((done) => setTimeout(done, 0));

  const find = (id: string) => dom.window.document.getElementById(id)!;
  return {
    written,
    find,
    power: find('enabled'),
    on: () => find('enabled').getAttribute('aria-checked') === 'true',
    click(id: string) {
      find(id).dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    },
    toggle(id: string) {
      const box = find(id) as HTMLInputElement;
      box.checked = !box.checked;
      box.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    },
  };
}

test('실행기 단추는 한 번 누르면 켜지고 다시 누르면 꺼진다', async (t) => {
  const popup = await mountPopup(t, { enabled: true });
  assert.equal(popup.on(), true, '저장된 값을 그대로 보여 줍니다');

  popup.click('enabled');
  assert.equal(popup.on(), false);
  assert.equal(popup.find('chip').textContent, '꺼짐');
  assert.match(popup.find('note').textContent ?? '', /켭니다/);

  popup.click('enabled');
  assert.equal(popup.on(), true);
  assert.equal(popup.find('chip').textContent, '켜짐');
  assert.deepEqual(popup.written, [
    ['enabled', false],
    ['enabled', true],
  ]);
});

test('꺼진 채로 열면 꺼진 모습으로 시작한다', async (t) => {
  const popup = await mountPopup(t, { enabled: false });
  assert.equal(popup.on(), false);
  assert.equal(popup.find('chip').textContent, '꺼짐');
  assert.deepEqual(popup.written, [], '연 것만으로는 아무것도 쓰지 않습니다');
});

test('나머지 스위치는 저장된 값을 보여 주고, 바꾸면 그대로 쓴다', async (t) => {
  const popup = await mountPopup(t, { svg: true, mask: false, notice: false });
  assert.equal((popup.find('svg') as HTMLInputElement).checked, true);
  assert.equal((popup.find('mask') as HTMLInputElement).checked, false);
  assert.equal((popup.find('notice') as HTMLInputElement).checked, false);

  popup.toggle('svg');
  popup.toggle('mask');
  popup.toggle('notice');
  assert.deepEqual(popup.written, [
    ['svg', false],
    ['mask', true],
    ['notice', true],
  ]);
});
