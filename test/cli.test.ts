/**
 * CLI 명령어 기능을 검사합니다.
 * 
 * check 명령어가 단순 파싱이 아닌 실제 컴파일 가능 여부를 검증하는지 확인합니다.
 * 
 * @example
 * const result = cli('check', 'main.tess');
 * assert.equal(result.code, 1);
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * CLI 환경에서 `node index.ts ...` 명령어를 실행하고 종료 코드와 출력을 반환합니다.
 *
 * @example
 * const result = cli('check', 'main.tess');
 */
function cli(...args: string[]) {
  try {
    const stdout = execFileSync('node', [path.join(root, 'packages/cli/index.ts'), ...args], { encoding: 'utf-8' });
    return { code: 0, output: stdout };
  } catch (error) {
    const failure = error as { status: number; stdout?: string; stderr?: string };
    return { code: failure.status, output: (failure.stdout ?? '') + (failure.stderr ?? '') };
  }
}

/**
 * 다수의 파일을 포함하는 임시 프로젝트 폴더를 생성합니다.
 *
 * @example
 * const dir = project(t, { 'main.tess': 'scene "s":\nend' });
 */
function project(t: any, files: Record<string, string>) {
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

// --- 느슨한 실행 -------------------------------------------------------------
const LOOSE_PROJECT = `scene "s":
  object "주인공":
    default costume 기본 "a.png" size 10 10
    when start do
      jump "없는장면"
      x += 1
    end
  end
end`;

test('build 는 에러가 있어도 그 문장만 빼고 내보낸다', (t) => {
  const dir = project(t, { 'main.tess': LOOSE_PROJECT });
  const outPath = path.join(dir, 'out.json');

  const result = cli('build', path.join(dir, 'main.tess'), '-o', outPath);
  assert.equal(result.code, 0);
  assert.match(result.output, /--strict 를 붙이면 여기서 멈춥니다/);

  // 에러가 난 jump 만 빠지고 그 뒤의 move_x 는 남는다
  const built = JSON.parse(fs.readFileSync(outPath, 'utf-8'));
  const types = JSON.parse(built.objects[0].script)[0].map((block: any) => block.type);
  assert.deepEqual(types, ['when_run_button_click', 'move_x']);
});

test('--strict 는 에러가 있으면 아무것도 내보내지 않는다', (t) => {
  const dir = project(t, { 'main.tess': LOOSE_PROJECT });
  const outPath = path.join(dir, 'out.json');

  const result = cli('build', path.join(dir, 'main.tess'), '-o', outPath, '--strict');
  assert.equal(result.code, 1);
  assert.match(result.output, /내보낼 수 없습니다/);
  assert.equal(fs.existsSync(outPath), false);
});

const MISSING_COSTUME = `scene "s":
  object "주인공":
    default costume 기본 "a.png" size 10 10
    when start do
      costume = "없는모양"
    end
  end
end`;

test('없는 모양은 주의로 알리고 check 를 통과시킨다', (t) => {
  const dir = project(t, { 'main.tess': MISSING_COSTUME });

  const loose = cli('check', path.join(dir, 'main.tess'));
  assert.equal(loose.code, 0);
  assert.match(loose.output, /주의 1개/);
  assert.doesNotMatch(loose.output, /경고 1개/);

  // --strict 는 같은 것을 경고로 올려 보여 준다 (에러는 아니므로 여전히 통과한다)
  const strict = cli('check', path.join(dir, 'main.tess'), '--strict');
  assert.equal(strict.code, 0);
  assert.match(strict.output, /경고 1개/);
  assert.doesNotMatch(strict.output, /주의 1개/);
});
