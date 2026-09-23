/**
 * tree-sitter 파서가 Chevrotain 파서와 똑같은 AST 를 만드는지 확인합니다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { initTreeSitter, parse } from '../packages/parser/index.ts';
import { parseProgramWithTree } from '../packages/parser/src/tree/index.ts';
import { KEYWORDS, RESERVED, STANDALONE_STATEMENTS, STATEMENT_KEYWORDS } from '../packages/parser/src/parser/tokens.ts';

const inObject = (body: string) => `object "a":\n  when start do\n${body.split('\n').map((line) => `    ${line}`).join('\n')}\n  end\nend\n`;

const SNIPPETS = [
  inObject('save = b\nsave += 1\nsave'),
  inObject('go a (b)\ngo 1 (2)\ngo random(1, 2) random(3, 4)\ngo a[1] b[2]\ngo a b in 2'),
  inObject('hide chart\na = 1\nshow 표 chart 1\nshow 표 for 3'),
  inObject('play sound "x" and wait\nplay sound "y" from 1 to 2'),
  inObject('if (a == 1):\n  say (1)\nelse:\nend\nname(1)\nmove(1) 2'),
  inObject('x = "\u0000\\"\\n"\ny = #fff\nz = #red # comment'),
  'function f():\nend\nfunction g(a, b?):\n  return a\nend\n',
  'var a = 1 from 0 to 10 visible at -10 20\nshared list b = []\n',
];

function corpus(): Array<[string, string]> {
  const out: Array<[string, string]> = SNIPPETS.map((source, at) => [`snippet ${at}`, source]);
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (file.endsWith('.tess')) out.push([file, fs.readFileSync(file, 'utf8')]);
    }
  };
  walk('examples');
  return out;
}

/** The array literal bound to `name` in grammar.js. */
function grammarList(grammar: string, name: string): string[] {
  const match = new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`).exec(grammar);
  assert.ok(match, name);
  return [...match[1]!.matchAll(/'([^']+)'/g)].map((each) => each[1]!);
}

test('tree-sitter 키워드 목록이 tokens.ts 와 같다', () => {
  const grammar = fs.readFileSync('packages/parser/tree-sitter/grammar.js', 'utf8');
  assert.deepEqual(grammarList(grammar, 'KEYWORDS'), KEYWORDS);
  assert.deepEqual(grammarList(grammar, 'RESERVED'), [...RESERVED]);
  assert.deepEqual(grammarList(grammar, 'STANDALONE'), [...STANDALONE_STATEMENTS]);
  // `store` opens a statement only before `var`/`list`; alone it is a callable name.
  assert.deepEqual(new Set(grammarList(grammar, 'STATEMENT_LEADERS')), new Set([...STATEMENT_KEYWORDS].filter((word) => word !== 'store')));
});

test('tree-sitter 와 Chevrotain 의 AST 가 같다', async () => {
  const sources = corpus();
  // Chevrotain results first: once tree-sitter is loaded, parse() goes through it.
  const expected = sources.map(([, source]) => parse(source, { validate: false }));
  assert.ok(await initTreeSitter());
  let compared = 0;
  sources.forEach(([name, source], at) => {
    const chevrotain = expected[at]!;
    const tree = parseProgramWithTree(source);
    if (!chevrotain.ok) {
      assert.equal(tree, null, `${name}: tree-sitter accepts what Chevrotain rejects`);
      return;
    }
    assert.ok(tree, `${name}: tree-sitter rejects it`);
    assert.equal(JSON.stringify(tree), JSON.stringify(chevrotain.ast), name);
    compared += 1;
  });
  assert.ok(compared >= SNIPPETS.length + 20, `compared ${compared}`);
});
