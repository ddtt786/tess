/** Verifies live Entry account reads and extension project conversion. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Loads the reader against a page whose `__NEXT_DATA__` holds `payload`. */
function readerFor(payload: string | null, live?: { getState(): unknown; legacy?: boolean }) {
  const dom = new JSDOM(
    payload === null
      ? '<!doctype html><body></body>'
      : `<!doctype html><body><script id="__NEXT_DATA__" type="application/json">${payload}</script></body>`,
  );
  if (live) {
    const root = dom.window.document.createElement('div');
    root.id = '__next';
    dom.window.document.body.append(root);
    const current = { child: { memoizedProps: { store: live } } };
    Object.assign(root, live.legacy
      ? { _reactRootContainer: { _internalRoot: { current } } }
      : { '__reactContainer$entry': { stateNode: { current } } });
  }
  const source = stripTypeScriptTypes(
    fs.readFileSync(path.join(root, 'packages/extension/src/page/signed-in.ts'), 'utf-8'),
    { mode: 'strip' },
  );
  const sandbox: Record<string, unknown> = { document: dom.window.document };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(
    `${source.replace(/^import[^;]*;$/gm, '').replace(/^export /gm, '')}\nthis.read = signedInUser;`,
    sandbox,
  );
  const read = sandbox.read as () => { id: string; nickname: string } | null;
  // The module runs in its own realm, so what it returns carries that realm's
  // prototype; copying the fields makes it comparable here.
  return () => {
    const user = read();
    return user && { id: user.id, nickname: user.nickname };
  };
}

const wrap = (user: unknown) =>
  JSON.stringify({ props: { pageProps: { initialState: { common: { user } } } } });

test('로그인한 사람의 아이디와 닉네임을 읽는다', () => {
  const read = readerFor(wrap({ username: 'ddtt786', nickname: '치로', role: 'member' }));
  assert.deepEqual(read(), { id: 'ddtt786', nickname: '치로' });
});

test('로그인하지 않았으면 아무도 아니다', () => {
  for (const payload of [wrap(null), wrap(undefined), wrap({})]) {
    assert.equal(readerFor(payload)(), null, payload);
  }
});

test('페이지가 넘겨준 것이 없거나 읽을 수 없으면 아무도 아니다', () => {
  assert.equal(readerFor(null)(), null, '스크립트 자체가 없는 페이지');
  assert.equal(readerFor('')(), null, '빈 내용');
  assert.equal(readerFor('{ 이건 JSON 이 아니다')(), null, '깨진 내용');
  assert.equal(readerFor('{"props":{}}')(), null, '자리는 있지만 사람이 없다');
});

test('아이디나 닉네임 한쪽만 있어도 로그인한 것으로 본다', () => {
  assert.deepEqual(readerFor(wrap({ username: 'ddtt786' }))(), { id: 'ddtt786', nickname: '' });
  assert.deepEqual(readerFor(wrap({ nickname: '치로' }))(), { id: '', nickname: '치로' });
  // Non-string names are treated as absent.
  assert.equal(readerFor(wrap({ username: 7, nickname: null }))(), null);
});

test('로그인 전 페이지에서 로그인·닉네임 변경·계정 전환·로그아웃을 현재 상태로 읽는다', () => {
  for (const legacy of [false, true]) {
    let user: unknown = null;
    const read = readerFor(wrap(null), { legacy, getState: () => ({ common: { user } }) });
    assert.equal(read(), null);
    user = { username: 'first', nickname: '첫 계정' };
    assert.deepEqual(read(), { id: 'first', nickname: '첫 계정' });
    user = { username: 'first', nickname: '새 닉네임' };
    assert.deepEqual(read(), { id: 'first', nickname: '새 닉네임' });
    user = { username: 'second', nickname: '다른 계정' };
    assert.deepEqual(read(), { id: 'second', nickname: '다른 계정' });
    user = null;
    assert.equal(read(), null);
  }
});

test('현재 계정이 비어 있으면 이전 로그인 계정으로 돌아가지 않는다', () => {
  for (const user of [null, undefined, {}]) {
    const read = readerFor(wrap({ username: 'old', nickname: '이전 계정' }), {
      getState: () => ({ common: { user } }),
    });
    assert.equal(read(), null);
  }
});

test('페이지 저장소를 읽을 수 없으면 서버 계정 정보를 사용한다', () => {
  for (const getState of [() => ({}), () => { throw new Error('unavailable'); }]) {
    assert.deepEqual(readerFor(wrap({ username: 'first', nickname: '첫 계정' }), { getState })(), {
      id: 'first', nickname: '첫 계정',
    });
  }
  assert.equal(readerFor('null')(), null);
});

test('열린 실행기는 로그인 변경을 반영하고 갱신 주기 전 실행에도 최신 닉네임을 사용한다', async () => {
  const dom = new JSDOM(`<div id="__next"><div id="host"></div></div>
    <script id="__NEXT_DATA__" type="application/json">${wrap(null)}</script>`, {
    url: 'https://playentry.org/project/test', runScripts: 'outside-only',
  });
  type User = { id: string; nickname: string } | null;
  let account: { username: string; nickname: string } | null = null;
  let tick = () => {};
  let cleared = false;
  const started: User[] = [];
  const state = {
    user: null as User, state: 'stop', mouseX: 0, mouseY: 0, boost: true,
    unknownBlocks: new Map(), scenes: [{ id: 's' }], currentSceneId: 's', readStore() {},
  };
  const handle = {
    vm: state,
    start() { started.push(state.user && { ...state.user }); state.state = 'run'; },
    stop() { state.state = 'stop'; },
    pause() { state.state = 'pause'; },
    dispose() {},
  };
  Object.assign(dom.window.document.getElementById('__next')!, {
    '__reactContainer$entry': { stateNode: { current: { child: {
      memoizedProps: { store: { getState: () => ({ common: { user: account } }) } },
    } } } },
  });
  Object.assign(dom.window, {
    ASK_FIELD_STYLE: '', CHART_WINDOW_STYLE: '', EXTRAS_DIALOG_STYLE: '',
    fetchWork: async () => ({ name: '작품', variables: [] }), thumbUrl: () => null,
    toTessProject: () => ({ project: { variables: [] }, dropped: [] }),
    bridgeSaveStore: () => ({}),
    CloudClient: class { setChangeListener() {} async connect() {} dispose() {} },
    requestAnimationFrame: (callback: () => void) => { callback(); return 0; },
    setInterval(callback: () => void) { tick = callback; return 1; },
    clearInterval() { cleared = true; },
    boot: async (options: { user: User }) => {
      state.user = options.user;
      account = { username: 'first', nickname: '준비 중 로그인' };
      return handle;
    },
  });
  const source = (file: string) => stripTypeScriptTypes(fs.readFileSync(
    path.join(root, 'packages/extension/src/page', file), 'utf8',
  )).replace(/^import[^;]*;/gm, '').replace(/^export /gm, '');
  vm.runInContext(`${source('signed-in.ts')}\n${source('player.ts')}\nwindow.makePlayer = mountPlayer;`, dom.getInternalVMContext());
  const makePlayer = (dom.window as unknown as {
    makePlayer(host: HTMLElement, id: string): { dispose(): void };
  }).makePlayer;
  const player = makePlayer(dom.window.document.getElementById('host')!, 'test');
  try {
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual({ ...state.user }, { id: 'first', nickname: '준비 중 로그인' });
    account = { username: 'first', nickname: '로그인 후 닉네임' };
    tick();
    assert.deepEqual({ ...state.user }, { id: 'first', nickname: '로그인 후 닉네임' });
    const start = dom.window.document.querySelector<HTMLButtonElement>('.tessvm-start')!;
    account = { username: 'second', nickname: '계정 전환' };
    start.click();
    assert.deepEqual(started.at(-1), { id: 'second', nickname: '계정 전환' });
    account = null;
    tick();
    assert.equal(state.user, null);
    start.click();
    assert.equal(started.at(-1), null);
  } finally {
    player.dispose();
    dom.window.close();
  }
  assert.equal(cleared, true);
});

/** Decompiles and recompiles Entry projects while preserving asset URLs. */
test('확장이 쓰는 길: 엔트리 작품 -> Tess -> 다시 엔트리 작품', async () => {
  const { decompileProject } = await import('../packages/decompiler/src/index.ts');
  const { compileProject } = await import('../packages/compiler/src/index.ts');
  const work = {
    name: '주소만 남기기',
    speed: 60,
    scenes: [{ id: 'sc1', name: '장면 1' }],
    variables: [],
    messages: [],
    functions: [],
    objects: [{
      id: 'obj1',
      name: '주인공',
      objectType: 'sprite',
      scene: 'sc1',
      rotateMethod: 'free',
      selectedPictureId: 'pic1',
      entity: { x: 0, y: 0, scaleX: 1, scaleY: 1, visible: true },
      sprite: {
        pictures: [{
          id: 'pic1',
          name: '그림',
          imageType: 'svg',
          fileurl: '/uploads/ab/cd/image/abcd0001.svg',
          dimension: { width: 320, height: 180 },
        }],
        sounds: [{
          id: 'snd1',
          name: '소리',
          ext: '.mp3',
          duration: 2.5,
          fileurl: '/uploads/ab/cd/abcd0002.mp3',
        }],
      },
      script: JSON.stringify([[
        { type: 'when_run_button_click', params: [null], statements: [] },
        { type: 'move_x', params: [{ type: 'number', params: ['10'] }, null], statements: [] },
      ]]),
    }],
  };

  const decompiled = decompileProject(work as never, [], {
    inline: true, sizes: true, keepSvg: true,
  });
  // Browser conversion keeps all objects inline.
  assert.equal(decompiled.assets.length, 0);
  assert.doesNotMatch(decompiled.source, /useobject|usetext/);
  assert.match(decompiled.source, /object "주인공":/);
  assert.match(decompiled.source, /"\/uploads\/ab\/cd\/image\/abcd0001\.svg" size 320 180/);

  const compiled = compileProject(decompiled.source, {
    path: 'w.tess', name: work.name, assetUrls: true, comments: new Map(),
  });
  assert.deepEqual(compiled.errors, []);
  const picture = compiled.project!.objects[0]!.sprite.pictures[0]!;
  const sound = compiled.project!.objects[0]!.sprite.sounds[0]!;
  // Preserve asset URLs, dimensions, and duration.
  assert.equal(picture.fileurl, '/uploads/ab/cd/image/abcd0001.svg');
  assert.equal(picture.pngurl, '/uploads/ab/cd/image/abcd0001.png');
  assert.deepEqual(picture.dimension, { width: 320, height: 180 });
  assert.equal(sound.fileurl, '/uploads/ab/cd/abcd0002.mp3');
  assert.equal(sound.duration, 2.5);
  // Recompile the original movement block.
  assert.match(JSON.stringify(compiled.project!.objects[0]!.script), /move_x/);
});
