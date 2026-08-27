// examples/ 아래의 .tess 파일 검사
//  - use / useobject 로 불러와지는 조각 파일: 문법만 맞으면 된다
//    (혼자 두면 다른 파일에 있는 전역 변수·함수를 모르고, object 로 감싸여 있지도 않다)
//  - 그 밖의 파일(진입점): 에러도 경고도 없어야 한다
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '../src/parse.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'examples');
const FRAGMENT_RULES = [undefined, 'SceneFragment', 'ObjectFragment'];

function tessFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return tessFiles(full);
    return entry.name.endsWith('.tess') ? [full] : [];
  });
}

/** AST 안의 use / useobject 경로를 절대 경로로 모은다 */
function usedFiles(node, base, found = new Set()) {
  if (node === null || typeof node !== 'object') return found;
  if (Array.isArray(node)) {
    node.forEach((child) => usedFiles(child, base, found));
    return found;
  }
  if (node.type === 'Use' || node.type === 'UseObject') {
    found.add(path.resolve(path.dirname(base), node.path));
  }
  for (const [key, value] of Object.entries(node)) {
    if (key !== 'loc') usedFiles(value, base, found);
  }
  return found;
}

const files = tessFiles(root);
const fragments = new Set();
for (const file of files) {
  const result = parse(fs.readFileSync(file, 'utf-8'));
  if (result.ast) usedFiles(result.ast, file, fragments);
}

test('예제 파일이 있다', () => {
  assert.ok(files.length > 0);
});

const show = (list) => list.map((d) => `${d.line}:${d.column} ${d.message}`).join('\n');

for (const file of files) {
  const label = path.relative(root, file);
  const source = fs.readFileSync(file, 'utf-8');

  if (fragments.has(file)) {
    test(`예제(조각): ${label}`, () => {
      // 조각은 놓이는 자리에 따라 시작 규칙이 다르므로 하나라도 맞으면 된다
      const ok = FRAGMENT_RULES.some((startRule) => parse(source, { startRule, validate: false }).ok);
      assert.ok(ok, `${label} 을(를) 어떤 자리의 조각으로도 읽을 수 없습니다.`);
    });
    continue;
  }

  test(`예제: ${label}`, () => {
    const result = parse(source);
    assert.deepEqual(result.errors, [], `\n${show(result.errors)}`);
    assert.deepEqual(result.warnings, [], `\n${show(result.warnings)}`);
  });
}
