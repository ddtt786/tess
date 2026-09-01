// 증분 컴파일 — 내용이 그대로인 파일은 다시 파싱하지 않는지 검사한다.
//
// 파싱이 컴파일 시간의 대부분이고(오브젝트 조각이 150개쯤 되는 작품에서 ~90%),
// `run` 의 자동 새로고침은 한 파일만 고쳐도 매번 전부 다시 파싱했다. 캐시를 넘기면
// 바뀐 파일만 다시 파싱하되, 결과 작품은 캐시 없이 컴파일한 것과 완전히 같아야 한다.
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

/** main.tess 와 오브젝트 조각 두 개짜리 작품을 임시 폴더에 만든다 */
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

  // 바뀐 내용이 실제로 반영됐는지 — 캐시가 옛 AST 를 붙들고 있으면 안 된다
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
  // 두 번째에도 똑같이 알려줘야 한다 (에러를 캐시해 두고 조용히 넘어가면 안 된다)
  const second = build(dir, cache);
  assert.deepEqual(second.errors, first.errors);

  // 고치면 다시 정상으로 돌아온다
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
  assert.equal(cache.parsed, 4); // main.tess + 가 + 나 + 공통 — 공통.tess 는 한 번만
  assert.equal(cache.reused, 1); // 나.tess 가 부른 두 번째 공통.tess
});

// 조각이 깨졌는데 조용히 빠져 버리면, 자동 새로고침이 "반영했습니다" 라고만 하고
// 오브젝트 하나가 통째로 사라진 작품을 보여 준다.
test('불러올 파일이 없으면 에러로 알려준다', () => {
  const dir = makeProject();
  fs.writeFileSync(path.join(dir, 'main.tess'), 'scene "s":\n  useobject "objects/없는파일.tess"\nend');

  const result = build(dir, createCompileCache());
  assert.equal(result.ok, false);
  assert.match(result.errors[0].message, /불러올 파일이 없습니다/);
});
