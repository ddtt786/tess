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
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { Codegen } from '@tess/vm';
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
