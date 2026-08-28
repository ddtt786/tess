// Tests the .tess files under examples/
//  - fragments loaded via use / useobject: only need valid grammar
//    (in isolation they don't know globals/functions from other files and aren't wrapped in object)
//  - all other files (entry points): must have no errors or warnings
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

/** Collects use / useobject paths from the AST as absolute paths. */
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
      // a fragment's valid start rule depends on where it's placed; any one match is enough
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
