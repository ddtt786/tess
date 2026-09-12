/**
 * 남의 작품을 열었을 때 그 작품이 실행기를 넘어 무엇을 하지 못하게 막는지 확인합니다.
 *
 * `.ent` 는 인터넷에서 받아 오는 남의 파일이고, 그 안의 글자는 전부 작성자가 정합니다.
 * 그 글자가 닿는 곳이 세 군데 있습니다.
 *
 * - **JIT** — 블록 트리는 자바스크립트 소스로 만들어져 `new Function` 을 지납니다.
 * - **되돌린 소스** — `.ent` → `.tess` 는 다시 컴파일되어 같은 JIT 로 들어갑니다.
 * - **디스크** — 되돌리기가 모양·소리를 파일로 씁니다.
 *
 * 셋 다 작품이 스스로 코드가 되거나 폴더 밖을 짚지 못해야 합니다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import vmModule from 'node:vm';
import zlib from 'node:zlib';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';
import { compileProject } from '@tess/compiler';
import { Codegen, serveVm } from '@tess/vm';
import { decompileEnt } from '@tess/decompiler';
import { parse } from '@tess/parser';
import { tessComment, tessCommentLines, tessString } from '../packages/decompiler/src/ident.ts';

/** 되돌린 조각 파일의 내용 — 에셋은 바이트로 담긴다. */
const utf8 = (data: Uint8Array) => new TextDecoder('utf-8').decode(data);


/** A one-object work whose script is `blocks`. */
function work(blocks: unknown[], object: Record<string, unknown> = {}) {
  return {
    scenes: [{ id: 's', name: 's' }],
    variables: [],
    messages: [],
    functions: [],
    tables: [],
    objects: [
      {
        id: 'o',
        name: 'o',
        scene: 's',
        objectType: 'sprite',
        entity: { x: 0, y: 0 },
        sprite: { pictures: [], sounds: [] },
        script: JSON.stringify([blocks]),
        ...object,
      },
    ],
  };
}

const HAT = { id: 'a', type: 'when_run_button_click', params: [null], statements: [] };

/** Builds and runs the emitted program, and says whether the work got to run its own code. */
function runsOwnCode(blocks: unknown[]): boolean {
  const source = new Codegen(work(blocks) as never).compile().source;
  const flag = '__tessSecurityProbe';
  delete (globalThis as Record<string, unknown>)[flag];
  try {
    const made = new Function('R', source)({ ops: {}, cast: {} }) as {
      scripts?: Array<(entity: unknown, thread: unknown) => Iterator<unknown>>;
    };
    for (const script of made.scripts ?? []) {
      const step = script({ target: {} }, {});
      for (let i = 0; i < 4; i += 1) {
        if (step.next().done) break;
      }
    }
  } catch {
    // A generated program that will not build cannot run the work's code either.
  }
  return flag in globalThis;
}

test('블록 이름은 만들어진 자바스크립트를 빠져나가지 못한다', () => {
  /**
   * 알 수 없는 블록은 `/* 이름 *​/` 주석으로 남습니다. 이름은 작품이 정하므로 주석을
   * 닫고 나오는 글자가 그대로 들어가면 그 자리가 남의 코드가 됩니다.
   */
  const escapes = [
    "*/;globalThis.__tessSecurityProbe=1;/*",
    "func_*/;globalThis.__tessSecurityProbe=1;/*",
    "x*/\n;globalThis.__tessSecurityProbe=1;/*",
    "x\u2028;globalThis.__tessSecurityProbe=1;//",
    "open_table\n;globalThis.__tessSecurityProbe=1;//",
  ];
  for (const type of escapes) {
    assert.equal(
      runsOwnCode([HAT, { id: 'b', type, params: [], statements: [] }]),
      false,
      JSON.stringify(type),
    );
  }
});

test('빠져나가려는 이름이 있어도 나머지 블록은 그대로 돈다', () => {
  const source = new Codegen(
    work([HAT, { id: 'b', type: '*/;evil();/*', params: [], statements: [] }]) as never,
  ).compile().source;
  assert.doesNotThrow(() => new Function('R', source));
  assert.match(source, /\/\*[^*]*\*\//, '알 수 없는 블록은 여전히 주석으로 남습니다');
  assert.doesNotMatch(source, /evil\(\)/, '실행될 수 있는 형태로는 남지 않습니다');
});

/**
 * `table[키]` 는 `constructor` · `toString` 같은 `Object.prototype` 의 이름에도
 * 답한다. 그렇게 돌아온 함수가 `C.<여기>(…)` 로 들어가면 작품 하나가 자기 프로그램을
 * 통째로 못 만들게 만들 수 있고, 값이 글자였다면 그 자리가 남의 코드가 된다.
 */
test('연산자 이름이 Object.prototype 의 것이어도 프로그램은 만들어진다', () => {
  for (const operator of ['constructor', '__proto__', 'toString', 'valueOf', 'hasOwnProperty']) {
    const compare = { id: 'c', type: 'boolean_basic_operator', params: [1, operator, 2] };
    const source = new Codegen(
      work([HAT, { id: 'b', type: '_if', params: [compare], statements: [[]] }]) as never,
    ).compile().source;
    assert.doesNotThrow(() => new Function('R', source), operator);
    assert.match(source, /C\.cmpEqual\(/, operator);
  }
});

test('햇 블록 이름이 Object.prototype 의 것이면 아무 스크립트도 되지 않는다', () => {
  for (const type of ['constructor', 'toString', '__proto__', 'valueOf']) {
    const program = new Codegen(
      work([{ id: 'a', type, params: [null, 'x'], statements: [] }]) as never,
    ).compile();
    assert.deepEqual(program.plans, [], type);
    assert.doesNotThrow(() => new Function('R', program.source), type);
  }
});

/**
 * `{"toString": "x"}` 는 원시 값으로 바꿀 수 없어 `String()` 이 그 자리에서 던진다.
 * .ent 안의 json 이 그대로 만들 수 있는 모양이므로, 컴파일이 예외로 끝나면 안 된다.
 */
test('원시 값이 없는 값이 슬롯에 있어도 컴파일은 끝난다', () => {
  const hostile = { toString: 'x' };
  const blocks = [
    HAT,
    { id: 'b', type: 'set_variable', params: [hostile, hostile], statements: [] },
    { id: 'c', type: 'stop_object', params: [hostile], statements: [] },
    { id: 'd', type: 'text_write', params: [hostile], statements: [] },
    { id: 'e', type: 'wait_second', params: [hostile], statements: [] },
    { id: 'f', type: 'repeat_while_true', params: [null, hostile], statements: [[]] },
    { id: 'g', type: 'calc_basic', params: [1, hostile, 2], statements: [] },
  ];
  const source = new Codegen(work(blocks) as never).compile().source;
  assert.doesNotThrow(() => new Function('R', source));
});

/**
 * 함수의 지역 변수 이름은 `const L = {<여기>: …}` 의 이름 자리에 들어간다 — 작품의
 * 글자가 문자열 리터럴 밖에 놓이는 유일한 자리다.
 */
test('함수 지역 변수의 이름이 글자가 아니어도 프로그램은 만들어진다', () => {
  const define = { id: 'd', type: 'function_create', params: [null], statements: [[]] };
  for (const id of [['a', 'b'], { a: 1 }, 12, null]) {
    const project = {
      ...work([HAT, { id: 'c', type: 'func_fid', params: [], statements: [] }]),
      functions: [{
        id: 'fid',
        type: 'normal',
        localVariables: [{ id, name: 'L', value: 1 }],
        content: JSON.stringify([[define]]),
      }],
    };
    const source = new Codegen(project as never).compile().source;
    assert.doesNotThrow(() => new Function('R', source), JSON.stringify(id));
  }
});

test('되돌린 소스에서 주석과 문자열은 한 줄을 벗어나지 못한다', () => {
  // 렉서가 줄의 끝으로 치는 네 글자 — 주석은 여기서 끊기고 문자열은 이것을 담지 못한다.
  for (const brk of ['\n', '\r', '\u2028', '\u2029']) {
    assert.equal(
      tessComment(`note${brk}say "INJECTED"`).includes(brk),
      false,
      `tessComment ${JSON.stringify(brk)}`,
    );
    assert.equal(
      tessString(`a${brk}b`).includes(brk),
      false,
      `tessString ${JSON.stringify(brk)}`,
    );
    // 여러 줄짜리 메모는 줄마다 `#` 을 다시 붙여서 남긴다.
    for (const line of tessCommentLines(`note${brk}say "INJECTED"`)) {
      assert.match(line, /^# /, line);
    }
  }
});

test('작품의 글자가 되돌린 소스의 문법을 바꾸지 못한다', async () => {
  const script = [
    {
      ...HAT,
      comment: { value: 'note\rsay "INJECTED"\u2028say "INJECTED"' },
    },
    { id: 'b', type: 'unknown_block\nsay "INJECTED"', params: [], statements: [] },
  ];
  const bytes = entFile(work(script, { name: 'o\u2028INJECTED' }));
  const out = await decompileEnt(bytes, {});
  const fragment = out.assets.find((asset) => asset.path.endsWith('.tess'));
  assert.ok(fragment, '오브젝트 조각이 나와야 합니다');
  const text = utf8(fragment.data);

  // 주석과 문자열 안을 지운 뒤에도 남는 `INJECTED` 가 있으면 문장이 된 것입니다.
  const bare = text.replace(/^\s*#.*$/gm, '').replace(/"(?:\\.|[^"\\])*"/g, '""');
  assert.doesNotMatch(bare, /INJECTED/, `문장으로 새어 나왔습니다:\n${text}`);
  assert.ok(
    parse(text, { startRule: 'ObjectFragment', validate: false }).ok,
    `되돌린 조각이 읽히지 않습니다:\n${text}`,
  );
});

test('모양·소리 파일은 내보낼 폴더 밖으로 나가지 못한다', async () => {
  const picture = {
    id: 'p',
    name: 'pic',
    filename: 'aaaaaaaa',
    imageType: 'png/../../../../ESCAPED',
    fileurl: 'temp/aa/11/image/aaaaaaaa.png',
    dimension: { width: 1, height: 1 },
  };
  const sound = {
    id: 'q',
    name: 'snd',
    filename: 'bbbbbbbb',
    ext: '.mp3/../../../../ESCAPED',
    fileurl: 'temp/bb/11/bbbbbbbb.mp3',
    duration: 1,
  };
  const project = work([], {
    selectedPictureId: 'p',
    sprite: { pictures: [picture], sounds: [sound] },
  });
  const out = await decompileEnt(entFile(project, { [picture.fileurl]: PNG, [sound.fileurl]: PNG }), {});

  const root = path.join(os.tmpdir(), 'tess-security');
  for (const asset of out.assets) {
    assert.doesNotMatch(asset.path, /(^|\/)\.\.($|\/)/, asset.path);
    const target = path.resolve(root, asset.path);
    assert.ok(target.startsWith(root + path.sep), `폴더를 벗어납니다: ${asset.path}`);
  }
});

// ---------------------------------------------------------------------------
//  .ent 만들기 — gzip 으로 감싼 tar 하나
// ---------------------------------------------------------------------------

const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489' +
    '0000000a49444154789c6300010000050001' +
    '0d0a2db40000000049454e44ae426082',
  'hex',
);

function tarHeader(name: string, size: number): Buffer {
  const head = Buffer.alloc(512);
  head.write(name, 0, 100, 'utf-8');
  head.write('000644 \0', 100, 8, 'utf-8');
  head.write('000000 \0', 108, 8, 'utf-8');
  head.write('000000 \0', 116, 8, 'utf-8');
  head.write(`${size.toString(8).padStart(11, '0')} `, 124, 12, 'utf-8');
  head.write('00000000000 ', 136, 12, 'utf-8');
  head.write('        ', 148, 8, 'utf-8'); // checksum placeholder
  head.write('0', 156, 1, 'utf-8');
  let sum = 0;
  for (const byte of head) sum += byte;
  head.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'utf-8');
  return head;
}

/** The `.ent` container: a gzipped tar with `temp/project.json` and its assets. */
function entFile(project: unknown, extra: Record<string, Buffer> = {}): Buffer {
  const parts: Buffer[] = [];
  const add = (name: string, data: Buffer) => {
    parts.push(tarHeader(name, data.length), data, Buffer.alloc((512 - (data.length % 512)) % 512));
  };
  add('temp/project.json', Buffer.from(JSON.stringify(project), 'utf-8'));
  for (const [name, data] of Object.entries(extra)) add(name, data);
  parts.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(parts));
}

test('만든 .ent 를 되돌리기가 실제로 읽는다', async () => {
  // 위 검사들이 빈 작품을 보고 통과해 버리지 않도록, 그릇 자체를 한 번 확인합니다.
  const out = await decompileEnt(entFile(work([HAT])), {});
  assert.match(out.source, /scene/);
  assert.ok(out.assets.some((asset) => asset.path.endsWith('.tess')));
});

test('파일을 쓰는 자리가 폴더 밖 경로를 거부한다', () => {
  const load = fs.readFileSync(
    path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'packages/tessvm/src/node/load.ts'),
    'utf-8',
  );
  // 되돌리기가 막더라도 쓰는 쪽에 한 겹 더 둔다 — 둘 중 하나만 남아도 막히도록.
  assert.match(load, /path\.resolve\(root, asset\.path\)/);
  assert.match(load, /startsWith\(root \+ path\.sep\)/);
});

// ---------------------------------------------------------------------------
//  확장 — 작품이 들고 오는 주소
// ---------------------------------------------------------------------------
const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** `thumbUrl` 을 playentry 페이지인 척하는 사본 위에 올려 돌려준다. */
function thumbReader(): (thumb: unknown) => string | null {
  const source = stripTypeScriptTypes(
    fs.readFileSync(path.join(repoRoot, 'packages/extension/src/page/entry-project.ts'), 'utf-8'),
    { mode: 'strip' },
  );
  const sandbox: Record<string, unknown> = {
    location: { origin: 'https://playentry.org' },
    URL,
  };
  sandbox.globalThis = sandbox;
  vmModule.createContext(sandbox);
  vmModule.runInContext(
    `${source.replace(/^import[^;]*;$/gm, '').replace(/^export /gm, '')}\nthis.read = thumbUrl;`,
    sandbox,
  );
  return sandbox.read as (thumb: unknown) => string | null;
}

/**
 * 미리보기 그림 주소는 작품의 제 데이터이고, 그것이 `url("…")` 안에 적힌다.
 * 따옴표 하나면 그 자리에서 다른 주소를 한 겹 더 그리게 할 수 있다 — 읽는 사람의
 * 브라우저가 남의 서버를 부르게 되는 길이다.
 */
test('미리보기 그림 주소는 playentry 를 벗어나지도, 따옴표를 남기지도 않는다', () => {
  const thumbUrl = thumbReader();
  assert.equal(thumbUrl('/uploads/aa/bb/thumb/cc.png'), 'https://playentry.org/uploads/aa/bb/thumb/cc.png');
  assert.equal(thumbUrl('https://evil.example/x.png'), null);
  assert.equal(thumbUrl('//evil.example/x.png'), null);
  assert.equal(thumbUrl('javascript:alert(1)'), null);
  assert.equal(thumbUrl(''), null);
  assert.equal(thumbUrl(null), null);
  for (const thumb of ['/a"),url("https://evil.example/x.png', '/a?q=")']) {
    const url = thumbUrl(thumb);
    assert.ok(url && !url.includes('"'), `따옴표가 남았습니다: ${url}`);
    assert.ok(url.startsWith('https://playentry.org/'), url);
  }
});

// ---------------------------------------------------------------------------
//  run 서버 — 이 컴퓨터에서만, 이 페이지에서만
// ---------------------------------------------------------------------------
async function withVmServer(body: (server: { port: number }) => Promise<void>) {
  const result = compileProject('scene "s":\n  text "t":\n    text_content = "x"\n  end\nend', {
    path: 'main.tess',
  });
  assert.deepEqual(result.errors, [], result.errors.map((e) => e.message).join('\n'));
  const server = await serveVm({
    project: result.project!,
    assets: result.assets,
    assetDirs: [],
    name: 'security',
    port: 0,
  });
  try {
    await body(server);
  } finally {
    await server.close();
  }
}

/** 한 번의 요청 — 헤더를 직접 정해야 해서 fetch 가 아니라 http 로 보낸다. */
function request(
  port: number,
  options: { path: string; method?: string; headers?: Record<string, string>; body?: string },
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const call = http.request(
      { host: '127.0.0.1', port, path: options.path, method: options.method ?? 'GET', headers: options.headers },
      (response) => {
        let text = '';
        response.on('data', (chunk) => { text += chunk; });
        response.on('end', () => resolve({ status: response.statusCode ?? 0, body: text }));
      },
    );
    call.on('error', reject);
    call.end(options.body);
  });
}

/**
 * 서버는 127.0.0.1 에만 붙지만, 남의 페이지가 자기 이름을 127.0.0.1 로 가리키게 하면
 * 그 페이지의 오리진으로 여기 있는 것을 읽을 수 있다. 어떤 이름으로 왔는지가 둘을 가른다.
 */
test('run 서버는 자기 이름으로 오지 않은 요청을 거절한다', async () => {
  await withVmServer(async ({ port }) => {
    assert.equal((await request(port, { path: '/project.json' })).status, 200);
    assert.equal(
      (await request(port, { path: '/project.json', headers: { host: 'work.example' } })).status,
      403,
    );
    assert.equal(
      (await request(port, { path: '/vm/web/boot.ts', headers: { host: 'work.example' } })).status,
      403,
    );
  });
});

/**
 * `/__log` 는 받은 글을 터미널에 적는다. 프리플라이트 없이 보낼 수 있는 요청이라
 * 아무 사이트나 이 자리를 빌려 쓸 수 있었다.
 */
test('오류 기록 자리는 이 페이지가 보낸 것만 받는다', async () => {
  await withVmServer(async ({ port }) => {
    const log = JSON.stringify({ kind: 'k', message: 'm' });
    const sent = await request(port, {
      path: '/__log',
      method: 'POST',
      headers: { 'content-type': 'text/plain', origin: 'https://work.example' },
      body: log,
    });
    assert.equal(sent.status, 403);
    const own = await request(port, {
      path: '/__log',
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${port}` },
      body: log,
    });
    assert.equal(own.status, 204);
  });
});

test('터미널에 적히는 글에서는 제어 문자가 빠진다', async () => {
  const printed: string[] = [];
  const wasError = console.error;
  console.error = (...parts: unknown[]) => { printed.push(parts.join(' ')); };
  try {
    await withVmServer(async ({ port }) => {
      const response = await request(port, {
        path: '/__log',
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${port}` },
        body: JSON.stringify({
          kind: '오류',
          message: `\u001b[2J\u001b]0;bell\u0007`,
          stack: `줄1\n\u001b[31m줄2`,
        }),
      });
      assert.equal(response.status, 204);
    });
  } finally {
    console.error = wasError;
  }
  const all = printed.join('\n');
  assert.ok(all.includes('오류'), all);
  assert.doesNotMatch(all, /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/);
  // 줄 바꿈은 남는다 — 스택은 줄로 읽는다.
  assert.match(all, /줄1\n/);
  assert.ok(all.includes('줄2'), all);
});

/**
 * 번역 블록은 엔트리의 파파고 주소를 부르는데, 실행기는 그 사이트가 아니라 브라우저가
 * 직접 부르지 못합니다. 서버가 그 자리만 넘겨 주므로, 넘기는 자리가 좁은지 봅니다.
 */
test('번역 호출은 정해진 자리와 방법으로만 넘어간다', async () => {
  await withVmServer(async ({ port }) => {
    // 넘기지 않는 것들은 서버 안에서 끝난다 — 밖으로 나가지 않는다.
    assert.equal(
      (await request(port, { path: '/api/expansionBlock/papago/translate/n2mt', method: 'POST' })).status,
      404,
    );
    assert.equal(
      (await request(port, { path: '/api/expansionBlock/papago/../../../etc/passwd' })).status,
      404,
    );
    assert.equal((await request(port, { path: '/api/expansionBlock/tts/read.mp3' })).status, 404);
    assert.equal(
      (await request(port, {
        path: '/api/expansionBlock/papago/translate/n2mt',
        headers: { host: 'work.example' },
      })).status,
      403,
    );
  });
});
