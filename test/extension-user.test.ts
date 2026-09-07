/**
 * 확장이 playentry.org 페이지에서 로그인한 사람을 읽어 오는 부분을 확인합니다.
 *
 * 엔트리 실행기는 `window.user` 를 읽지만 확장의 실행기는 그 스크립트 밖에 있으므로,
 * 페이지가 렌더될 때 심어 둔 `__NEXT_DATA__` 에서 같은 기록을 꺼냅니다. 사이트가
 * 언제든 바꿀 수 있는 모양이라 중간에 하나만 없어도 로그인하지 않은 것으로 봅니다.
 *
 * 브라우저 모듈이라 노드 타입 검사에서 빠져 있으므로, 디버그 패널 테스트와 같은
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

/** Loads the reader against a page whose `__NEXT_DATA__` holds `payload`. */
function readerFor(payload: string | null) {
  const dom = new JSDOM(
    payload === null
      ? '<!doctype html><body></body>'
      : `<!doctype html><body><script id="__NEXT_DATA__" type="application/json">${payload}</script></body>`,
  );
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
  // 문자열이 아닌 값은 없는 것으로 칩니다.
  assert.equal(readerFor(wrap({ username: 7, nickname: null }))(), null);
});

// ---------------------------------------------------------------------------
//  확장이 작품을 실행하기 전에 지나는 길
// ---------------------------------------------------------------------------
/**
 * 확장은 엔트리 작품을 그대로 돌리지 않고 `tessvm run` 이 `.ent` 를 다룰 때와 같이
 * Tess 로 되돌린 뒤 다시 컴파일해서 돌립니다. 그대로 넘어가는 것은 파일 주소뿐입니다.
 */
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
  // 조각 파일이 없으니 useobject 도 없다 — 브라우저에는 파일을 둘 곳이 없다.
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
  // 주소는 그대로, 크기와 길이는 소스에 적힌 값을 그대로 쓴다.
  assert.equal(picture.fileurl, '/uploads/ab/cd/image/abcd0001.svg');
  assert.equal(picture.pngurl, '/uploads/ab/cd/image/abcd0001.png');
  assert.deepEqual(picture.dimension, { width: 320, height: 180 });
  assert.equal(sound.fileurl, '/uploads/ab/cd/abcd0002.mp3');
  assert.equal(sound.duration, 2.5);
  // 그리고 블록은 Tess 컴파일러가 만든 것이다.
  assert.match(JSON.stringify(compiled.project!.objects[0]!.script), /move_x/);
});
