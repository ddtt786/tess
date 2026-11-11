import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { JSDOM } from 'jsdom';

const source = (file: string) => stripTypeScriptTypes(fs.readFileSync(
  new URL(`../packages/extension/src/${file}`, import.meta.url), 'utf8',
)).replace(/^import[^;]*;/gm, '').replace(/^export /gm, '');
const A = '69b3ef8e0075070c7c1d0aca';
const B = '6a8eaeb776461c96f3387684';

async function setup() {
  const dom = new JSDOM(`<div id="a"><iframe src="/iframe/${A}"></iframe></div><div id="b"></div>`, {
    url: `https://playentry.org/project/${A}`, runScripts: 'outside-only',
  });
  const page = dom.window;
  const mounted: string[] = [];
  const disposed: string[] = [];
  let change: (values: object, area: string) => void = () => {};
  Object.assign(page, {
    api: {
      runtime: { getURL: (path: string) => `https://extension.invalid/${path}` },
      storage: { onChanged: { addListener(fn: typeof change) { change = fn; } } },
    },
    readSettings: async () => ({ enabled: true, svg: true, mask: true, notice: false }),
    ENABLED_KEY: 'enabled', SVG_KEY: 'svg', MASK_KEY: 'mask', NOTICE_KEY: 'notice',
    mountPlayer(host: HTMLElement, id: string) {
      mounted.push(id);
      const root = page.document.createElement('section');
      root.className = 'test-player';
      host.append(root);
      return { dispose() { disposed.push(id); root.remove(); }, setMaskUserId() {}, setShowNotice() {} };
    },
  });
  const context = dom.getInternalVMContext();
  const flush = async () => { for (let i = 0; i < 4; i++) await new Promise(r => setTimeout(r, 0)); };
  vm.runInContext(source('content.ts'), context);
  await flush();
  vm.runInContext(`(() => { ${source('page/main.ts')}; window.stopPageScan = () => observer.disconnect(); })();`, context);
  await flush();
  return {
    page, mounted, disposed, flush,
    frame: page.document.querySelector('iframe')!,
    hosts: () => [...page.document.querySelectorAll<HTMLElement>('[data-tess-project]')],
    setting(key: string, value: boolean) { change({ [key]: { newValue: value } }, 'local'); },
    close() {
      vm.runInContext('observer.disconnect(); window.stopPageScan();', context);
      page.close();
    },
  };
}

test('사이트가 같은 iframe 주소를 다시 지정해도 원래 실행기는 다시 표시되지 않는다', async () => {
  const s = await setup();
  try {
    s.frame.src = `/iframe/${A}`;
    await s.flush();
    assert.equal(s.frame.getAttribute('src'), 'about:blank');
    assert.equal(s.frame.style.visibility, 'hidden');
    assert.equal(s.hosts().length, 1);
    assert.deepEqual(s.mounted, [A]);
  } finally { s.close(); }
});

test('같은 iframe에서 다른 작품으로 이동하면 이전 실행기를 해제하고 새 작품 하나만 연다', async () => {
  const s = await setup();
  try {
    s.frame.src = `/iframe/${B}`;
    await s.flush();
    assert.equal(s.frame.getAttribute('src'), 'about:blank');
    assert.deepEqual(s.hosts().map(h => h.dataset.tessProject), [B]);
    assert.deepEqual(s.mounted, [A, B]);
    assert.deepEqual(s.disposed, [A]);
  } finally { s.close(); }
});

test('사이트가 iframe을 새 노드로 교체하면 남아 있는 이전 실행기도 정리한다', async () => {
  const s = await setup();
  try {
    const next = s.page.document.createElement('iframe');
    next.src = `/iframe/${B}`;
    s.frame.replaceWith(next);
    await s.flush();
    assert.deepEqual(s.hosts().map(h => h.dataset.tessProject), [B]);
    assert.deepEqual(s.mounted, [A, B]);
    assert.deepEqual(s.disposed, [A]);
    next.remove();
    await s.flush();
    assert.equal(s.hosts().length, 0);
    assert.deepEqual(s.disposed, [A, B]);
  } finally { s.close(); }
});

test('iframe을 다른 부모로 이동하거나 호스트만 지워도 실행기 한 개를 복구한다', async () => {
  const s = await setup();
  try {
    s.page.document.getElementById('b')!.append(s.frame);
    await s.flush();
    assert.equal(s.hosts().length, 1);
    assert.equal(s.hosts()[0].parentElement!.id, 'b');
    s.hosts()[0].remove();
    await s.flush();
    assert.equal(s.hosts().length, 1);
    assert.equal(s.page.document.querySelectorAll('.test-player').length, 1);
  } finally { s.close(); }
});

test('설정 변경과 끄기·켜기를 반복해도 실행기나 앵커가 중복되지 않는다', async () => {
  const s = await setup();
  try {
    for (let i = 0; i < 3; i++) {
      s.setting('svg', i % 2 === 0);
      await s.flush();
      s.setting('enabled', false);
      await s.flush();
      assert.equal(s.hosts().length, 0);
      assert.equal(s.frame.getAttribute('src'), `/iframe/${A}`);
      s.setting('enabled', true);
      await s.flush();
      assert.equal(s.hosts().length, 1);
      assert.equal(s.page.document.querySelectorAll('.tess-frame-anchor').length, 1);
      assert.equal(s.page.document.querySelectorAll('.test-player').length, 1);
    }
  } finally { s.close(); }
});

test('분리했던 iframe을 다시 삽입하면 원래 작품 ID로 실행기를 복구한다', async () => {
  const s = await setup();
  try {
    s.frame.remove();
    await s.flush();
    assert.equal(s.hosts().length, 0);
    s.page.document.getElementById('a')!.append(s.frame);
    await s.flush();
    assert.deepEqual(s.hosts().map(h => h.dataset.tessProject), [A]);
    assert.equal(s.frame.getAttribute('src'), 'about:blank');
    assert.equal(s.page.document.querySelectorAll('.test-player').length, 1);
  } finally { s.close(); }
});

test('확장 매니페스트는 content_scripts의 모든 대상을 host_permissions에 포함한다', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../packages/extension/manifest.json', import.meta.url), 'utf8'));
  const contentMatches = (manifest.content_scripts ?? []).flatMap(
    (script: { matches?: string[] }) => script.matches ?? [],
  );
  assert.ok(Array.isArray(manifest.host_permissions), 'host_permissions must be an array');
  for (const match of contentMatches) {
    assert.ok(manifest.host_permissions.includes(match), `host_permissions must include ${match}`);
  }
});
