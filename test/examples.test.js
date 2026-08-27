// examples/ 아래의 모든 .tess 파일이 에러·경고 없이 통과하는지 확인한다.
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

const files = tessFiles(root);

test('예제 파일이 하나 이상 있다', () => {
  assert.ok(files.length > 0);
});

for (const file of files) {
  test(`예제: ${path.relative(root, file)}`, () => {
    const source = fs.readFileSync(file, 'utf-8');
    const result = parse(source);
    const show = (list) => list.map((d) => `${d.line}:${d.column} ${d.message}`).join('\n');
    assert.deepEqual(result.errors, [], `\n${show(result.errors)}`);
    assert.deepEqual(result.warnings, [], `\n${show(result.warnings)}`);
  });
}
