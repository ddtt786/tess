// examples/ 아래의 .tess 파일 검사
//  - use 로 불러와지는 조각 파일: 문법 에러만 없으면 된다
//    (혼자 두면 다른 파일에 있는 전역 변수·함수를 모른다)
//  - 그 밖의 파일: 에러도 경고도 없어야 한다
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '../src/parse.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'examples');

function tessFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return tessFiles(full);
    return entry.name.endsWith('.tess') ? [full] : [];
  });
}

/** AST 안의 모든 Use 경로를 절대 경로로 모은다 */
function usedFiles(node, base, found = new Set()) {
  if (node === null || typeof node !== 'object') return found;
  if (Array.isArray(node)) {
    node.forEach((child) => usedFiles(child, base, found));
    return found;
  }
  if (node.type === 'Use') found.add(path.resolve(path.dirname(base), node.path));
  for (const [key, value] of Object.entries(node)) {
    if (key !== 'loc') usedFiles(value, base, found);
  }
  return found;
}

const files = tessFiles(root);
const parsed = new Map(files.map((file) => [file, parse(fs.readFileSync(file, 'utf-8'))]));
const fragments = new Set();
for (const [file, result] of parsed) {
  if (result.ast) usedFiles(result.ast, file, fragments);
}

test('예제 파일이 있다', () => {
  assert.ok(files.length > 0);
});

const show = (list) => list.map((d) => `${d.line}:${d.column} ${d.message}`).join('\n');

for (const [file, result] of parsed) {
  const label = path.relative(root, file);
  const isFragment = fragments.has(file);

  test(`예제${isFragment ? '(조각)' : ''}: ${label}`, () => {
    assert.deepEqual(result.errors, [], `\n${show(result.errors)}`);
    if (!isFragment) assert.deepEqual(result.warnings, [], `\n${show(result.warnings)}`);
  });
}
