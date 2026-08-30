// CLI 명령 검사.
//
// check 가 실제로 "컴파일되는지" 를 검사하는지 확인한다. 예전에는 parse 만 해서,
// decompile 이 컴파일 에러 24개를 알려 준 파일을 check 는 OK 라고 답했다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** `node index.js ...` 를 돌리고 종료 코드와 출력을 돌려준다 */
function cli(...args) {
  try {
    const stdout = execFileSync('node', [path.join(root, 'index.js'), ...args], { encoding: 'utf-8' });
    return { code: 0, output: stdout };
  } catch (error) {
    return { code: error.status, output: (error.stdout ?? '') + (error.stderr ?? '') };
  }
}

/** 파일 여러 개를 담은 임시 폴더를 만든다 */
function project(t, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tess-cli-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(dir, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  return dir;
}

test('check 는 문법만 맞으면 통과하는 코드도 컴파일 단계까지 검사한다', (t) => {
  // 문법은 완벽하다. 하지만 이 작품에는 "없는장면" 이라는 장면이 없다.
  const dir = project(t, {
    'main.tess': `scene "s":
  object "주인공":
    default costume 기본 "a.png" size 10 10
    when start do
      jump "없는장면"
    end
  end
end`,
  });

  const result = cli('check', path.join(dir, 'main.tess'));
  assert.equal(result.code, 1);
  assert.match(result.output, /없는장면/);
  assert.doesNotMatch(result.output, /OK/);
});

test('check 는 useobject 로 불러오는 조각 파일 안까지 검사한다', (t) => {
  // 조각 파일은 펼쳐 봐야 검사할 수 있다. parse 만 해서는 아예 열어 보지도 않는다.
  const dir = project(t, {
    'main.tess': 'scene "s":\n  useobject "objects/주인공.tess"\nend',
    'objects/주인공.tess': `default costume 기본 "a.png" size 10 10

when start do
  jump "없는장면"
end`,
  });

  const result = cli('check', path.join(dir, 'main.tess'));
  assert.equal(result.code, 1);
  // 에러 위치는 main.tess 가 아니라 진짜 그 코드가 있는 조각 파일로 알려 준다
  assert.match(result.output, /주인공\.tess:\d+:\d+/);
  assert.match(result.output, /없는장면/);
});

test('멀쩡한 작품은 check 가 OK 로 통과시킨다', () => {
  const result = cli('check', path.join(root, 'examples/all_blocks.tess'));
  assert.equal(result.code, 0);
  assert.match(result.output, /OK/);
});

test('문법 에러는 그대로 위치와 함께 알려 준다', (t) => {
  const dir = project(t, { 'main.tess': 'object "o":\n  when start do\n    x +=\n' });
  const result = cli('check', path.join(dir, 'main.tess'));
  assert.equal(result.code, 1);
  assert.match(result.output, /main\.tess:\d+:\d+/);
});
