/**
 * 내용이 변경되지 않은 파일은 다시 파싱하지 않는 증분 컴파일 기능을 검사합니다.
 *
 * 파싱은 컴파일 시간의 대부분을 차지합니다. 캐시를 사용하여 변경된 파일만
 * 파싱하도록 최적화하면서도, 캐시 없이 컴파일한 결과와 동일하게 작동하는지 검증합니다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compileProject, createCompileCache } from '@tess/compiler';

const MAIN = `scene "s":
  useobject "objects/가.tess"
  useobject "objects/나.tess"
end`;

const FRAGMENT = (message: string) => `default costume 기본 "a.png" size 10 10
when start do
  say "${message}"
end`;

/**
 * main.tess와 두 개의 오브젝트 조각을 포함하는 테스트용 프로젝트를 임시 폴더에 생성합니다.
 *
 * @returns 생성된 임시 폴더의 경로
 */
function makeProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tess-incremental-'));
  fs.mkdirSync(path.join(dir, 'objects'));
  fs.writeFileSync(path.join(dir, 'main.tess'), MAIN);
  fs.writeFileSync(path.join(dir, 'objects/가.tess'), FRAGMENT('가'));
  fs.writeFileSync(path.join(dir, 'objects/나.tess'), FRAGMENT('나'));
  return dir;
}

function build(dir: any, cache: any) {
  const mainFile = path.join(dir, 'main.tess');
  return compileProject(fs.readFileSync(mainFile, 'utf-8'), {
    path: mainFile, assetDirs: [dir], cache,
  });
}

test('캐시를 쓴 결과는 캐시 없이 컴파일한 것과 완전히 같다', () => {
  const dir = makeProject();
  const cache = createCompileCache();

  const cold = build(dir, cache);
  const warm = build(dir, cache);
  const plain = build(dir, undefined);

  assert.deepEqual(cold.errors, []);
  assert.deepEqual(JSON.stringify(warm.project), JSON.stringify(plain.project));
  assert.deepEqual(JSON.stringify(cold.project), JSON.stringify(warm.project));
});

test('바뀐 게 없으면 한 파일도 다시 파싱하지 않는다', () => {
  const dir = makeProject();
  const cache = createCompileCache();

  build(dir, cache);
  assert.equal(cache.parsed, 3); // main.tess + 조각 2개
  assert.equal(cache.reused, 0);

  build(dir, cache);
  assert.equal(cache.parsed, 3);
  assert.equal(cache.reused, 3);
});

test('한 파일만 고치면 그 파일만 다시 파싱한다', () => {
  const dir = makeProject();
  const cache = createCompileCache();

  build(dir, cache);
  fs.writeFileSync(path.join(dir, 'objects/가.tess'), FRAGMENT('바뀐 인사'));

  const before = cache.parsed;
  const result = build(dir, cache);
  assert.equal(cache.parsed - before, 1);

  /** 변경된 내용이 실제로 반영되었는지 확인합니다. 이전 AST 캐시가 남아있으면 안 됩니다. */
  const object = result.project!.objects.find((o) => o.name === '가');
  assert.match(object!.script, /바뀐 인사/);
});

test('main.tess 를 고치면 조각 파일은 그대로 다시 쓴다', () => {
  const dir = makeProject();
  const cache = createCompileCache();

  build(dir, cache);
  fs.writeFileSync(path.join(dir, 'main.tess'), `${MAIN}\n`);

  const before = { parsed: cache.parsed, reused: cache.reused };
  build(dir, cache);
  assert.equal(cache.parsed - before.parsed, 1);
  assert.equal(cache.reused - before.reused, 2);
});

test('문법 에러가 난 파일은 캐시에 남지 않고 매번 다시 알려준다', () => {
  const dir = makeProject();
  const cache = createCompileCache();
  const broken = path.join(dir, 'objects/가.tess');

  build(dir, cache);
  fs.writeFileSync(broken, 'when start do\n  say (\nend');

  const first = build(dir, cache);
  assert.ok(first.errors.length > 0);
  /** 에러를 캐시하고 무시하지 않도록, 다시 빌드 시 동일한 에러를 반환해야 합니다. */
  const second = build(dir, cache);
  assert.deepEqual(second.errors, first.errors);

  /** 파일을 올바르게 수정하면 에러 없이 정상적으로 파싱되어야 합니다. */
  fs.writeFileSync(broken, FRAGMENT('고침'));
  const fixed = build(dir, cache);
  assert.deepEqual(fixed.errors, []);
  assert.match(fixed.project!.objects.find((o) => o.name === '가')!.script, /고침/);
});

test('두 오브젝트가 같은 조각을 use 하면 한 번만 파싱한다', () => {
  const dir = makeProject();
  fs.writeFileSync(path.join(dir, 'objects/공통.tess'), 'when start do\n  say "공통"\nend');
  for (const name of ['가', '나']) {
    fs.writeFileSync(
      path.join(dir, `objects/${name}.tess`),
      `default costume 기본 "a.png" size 10 10\nuse "공통.tess"`,
    );
  }

  const cache = createCompileCache();
  const result = build(dir, cache);

  assert.deepEqual(result.errors, []);
  /** main.tess, 가, 나, 공통 파일이 파싱됩니다. 공통 파일은 한 번만 파싱됩니다. */
  assert.equal(cache.parsed, 4);
  /** 나.tess에서 다시 호출된 공통 파일은 재사용(reused) 처리됩니다. */
  assert.equal(cache.reused, 1);
});

/**
 * 누락된 조각 파일이 있을 경우 사용자에게 명시적으로 에러를 반환해야 합니다.
 * 에러를 발생시키지 않으면 누락된 오브젝트가 조용히 제외되어 표시될 수 있습니다.
 */
test('불러올 파일이 없으면 에러로 알려준다', () => {
  const dir = makeProject();
  fs.writeFileSync(path.join(dir, 'main.tess'), 'scene "s":\n  useobject "objects/없는파일.tess"\nend');

  const result = build(dir, createCompileCache());
  assert.equal(result.ok, false);
  assert.match(result.errors[0].message, /불러올 파일이 없습니다/);
});
