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
async function mountPopup(t: any, stored: Record<string, boolean>, saved: unknown[] = []) {
  const html = fs.readFileSync(path.join(POPUP, 'popup.html'), 'utf-8');
  const dom = new JSDOM(html, { pretendToBeVisual: true });
  t.after(() => dom.window.close());

  const written: Array<[string, boolean]> = [];
  const dropped: string[] = [];
  let rows: any[] = saved.slice();
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
    Intl: globalThis.Intl,
    // 저장된 데이터는 확장 자신의 IndexedDB 에 있다 (`src/store-db.ts`).
    listWorks: () => Promise.resolve(rows.slice()),
    exportName: () => 'tessvm-save-2026-09-14.json',
    exportAll: () => Promise.resolve({ size: 884 }),
    importAll: (picked: { name?: string }) =>
      picked?.name === '남의것.json'
        ? Promise.reject(new Error('tessvm 이 내보낸 파일이 아닙니다.'))
        : Promise.resolve(2),
    removeWork: (work: string) => {
      dropped.push(work);
      rows = rows.filter((row: any) => row.work !== work);
      return Promise.resolve();
    },
    clearWorks: () => {
      dropped.push('*');
      rows = [];
      return Promise.resolve();
    },
  };
  // jsdom 에는 blob 주소가 없다 — 내보내기가 만든 것을 여기서 받아 적는다.
  const downloads: string[] = [];
  sandbox.URL = { createObjectURL: () => 'blob:tessvm', revokeObjectURL: () => undefined };
  sandbox.setTimeout = (run: () => void, delay: number) =>
    dom.window.setTimeout(run, delay);
  dom.window.HTMLAnchorElement.prototype.click = function click(this: HTMLAnchorElement) {
    downloads.push(this.download);
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  // `import` 으로 시작하는 이름(importButton)까지 지우지 않도록 뒤에 공백을 요구한다.
  vm.runInContext(source.replace(/^import\s[\s\S]*?;$/gm, ''), sandbox);
  // 저장소를 읽고 화면을 칠하는 일은 프로미스 뒤에 있습니다.
  await new Promise((done) => setTimeout(done, 0));

  const find = (id: string) => dom.window.document.getElementById(id)!;
  return {
    written,
    dropped,
    downloads,
    find,
    /** 파일 칸에 하나 고른 것처럼 만들고 알린다. */
    pick(name: string) {
      const input = find('file') as HTMLInputElement;
      Object.defineProperty(input, 'files', { value: [{ name }], configurable: true });
      input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    },
    note: () => {
      const line = find('saves-note');
      return { text: line.textContent ?? '', hidden: line.hidden, bad: line.classList.contains('is-bad') };
    },
    /** 목록의 줄들 — 제목과 그 아래 한 줄. */
    saves: () =>
      [...dom.window.document.querySelectorAll('.save')].map((row) => ({
        title: row.querySelector('.save-title')?.textContent ?? '',
        meta: row.querySelector('.save-meta')?.textContent ?? '',
        drop: row.querySelector('.save-drop') as HTMLButtonElement,
      })),
    press(button: HTMLElement) {
      button.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    },
    settle: () => new Promise((done) => setTimeout(done, 0)),
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
  // 문구는 문장마다 줄을 나눕니다 — 창이 좁아 붙어 보이던 자리입니다.
  assert.equal(popup.find('note').querySelectorAll('br').length, 1);

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

// ---------------------------------------------------------------------------
//  저장된 데이터
// ---------------------------------------------------------------------------
const WORKS = [
  { work: '60a1', title: '마법사 키우기', names: 3, bytes: 2048, updated: Date.UTC(2026, 8, 1, 3) },
  { work: '77b2', title: '농장', names: 1, bytes: 120, updated: 0 },
];

test('저장한 작품이 있으면 목록으로 보여 준다', async (t) => {
  const popup = await mountPopup(t, {}, WORKS);
  const rows = popup.saves();
  assert.deepEqual(rows.map((row) => row.title), ['마법사 키우기', '농장']);
  assert.match(rows[0]!.meta, /3개 · 2\.0 KB/);
  assert.match(rows[1]!.meta, /1개 · 120 B/);
  assert.equal(popup.find('saves-empty').hidden, true);
  assert.equal(popup.find('clear').hidden, false);
});

test('저장한 것이 없으면 그렇다고 알리고 전체 삭제도 감춘다', async (t) => {
  const popup = await mountPopup(t, {}, []);
  assert.equal(popup.saves().length, 0);
  assert.equal(popup.find('saves-empty').hidden, false);
  assert.equal(popup.find('clear').hidden, true);
});

test('삭제는 한 번 더 눌러야 지워지고, 지우면 목록에서 사라진다', async (t) => {
  const popup = await mountPopup(t, {}, WORKS);
  const [first] = popup.saves();

  popup.press(first!.drop);
  assert.deepEqual(popup.dropped, [], '한 번 누른 것만으로는 지우지 않습니다');
  assert.match(first!.drop.textContent ?? '', /정말/);

  popup.press(first!.drop);
  await popup.settle();
  assert.deepEqual(popup.dropped, ['60a1']);
  assert.deepEqual(popup.saves().map((row) => row.title), ['농장']);
});

test('전체 삭제도 한 번 더 눌러야 지운다', async (t) => {
  const popup = await mountPopup(t, {}, WORKS);
  popup.press(popup.find('clear'));
  popup.press(popup.find('clear'));
  await popup.settle();
  assert.deepEqual(popup.dropped, ['*']);
  assert.equal(popup.saves().length, 0);
  assert.equal(popup.find('saves-empty').hidden, false);
});

test('내보내기는 파일 하나를 받아 내리고 그렇게 알린다', async (t) => {
  const popup = await mountPopup(t, {}, WORKS);
  popup.press(popup.find('export'));
  await popup.settle();
  assert.deepEqual(popup.downloads, ['tessvm-save-2026-09-14.json']);
  assert.match(popup.note().text, /내보냈습니다/);
  assert.equal(popup.note().bad, false);
});

test('가져오기는 파일 칸을 열고, 읽어 들이면 목록을 다시 그린다', async (t) => {
  const popup = await mountPopup(t, {}, []);
  assert.equal(popup.saves().length, 0);

  popup.press(popup.find('import'));
  popup.pick('tessvm-save-2026-09-14.json');
  await popup.settle();
  assert.match(popup.note().text, /작품 2개를 가져왔습니다/);
  assert.equal(popup.note().bad, false);
});

test('tessvm 이 내보낸 파일이 아니면 그렇다고 알린다', async (t) => {
  const popup = await mountPopup(t, {}, WORKS);
  popup.pick('남의것.json');
  await popup.settle();
  assert.match(popup.note().text, /tessvm 이 내보낸 파일이 아닙니다/);
  assert.equal(popup.note().bad, true, '빨간 줄로 알립니다');
  assert.equal(popup.saves().length, 2, '목록은 그대로입니다');
});
