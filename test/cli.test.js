// Tests CLI commands.
//
// Verifies that `check` actually compiles the project rather than only
// parsing it, since a parse-only check would pass files that decompile
// reports dozens of compile errors for.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Runs `node index.js ...` and returns its exit code and output. */
function cli(...args) {
  try {
    const stdout = execFileSync('node', [path.join(root, 'index.js'), ...args], { encoding: 'utf-8' });
    return { code: 0, output: stdout };
  } catch (error) {
    return { code: error.status, output: (error.stdout ?? '') + (error.stderr ?? '') };
  }
}

/** Creates a temp directory containing the given files. */
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
  // grammar is valid, but this object has no costume named "없는모양"
  const dir = project(t, {
    'main.tess': `scene "s":
  object "주인공":
    default costume 기본 "a.png" size 10 10
    when start do
      costume = "없는모양"
    end
  end
end`,
  });

  const result = cli('check', path.join(dir, 'main.tess'));
  assert.equal(result.code, 1);
  assert.match(result.output, /없는모양/);
  assert.doesNotMatch(result.output, /OK/);
});

test('check 는 useobject 로 불러오는 조각 파일 안까지 검사한다', (t) => {
  // fragment files can only be checked by expanding them; parse alone never opens them
  const dir = project(t, {
    'main.tess': 'scene "s":\n  useobject "objects/주인공.tess"\nend',
    'objects/주인공.tess': `default costume 기본 "a.png" size 10 10

when start do
  costume = "없는모양"
end`,
  });

  const result = cli('check', path.join(dir, 'main.tess'));
  assert.equal(result.code, 1);
  // error location must point to the fragment file where the code actually lives, not main.tess
  assert.match(result.output, /주인공\.tess:\d+:\d+/);
  assert.match(result.output, /없는모양/);
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
