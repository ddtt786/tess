// ============================================================================
//  Tests VS Code syntax highlighting
//
//  Runs editors/vscode's TextMate grammar through the real tokenizer
//  (vscode-textmate) and checks each token gets the intended scope.
// ============================================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import onigurumaModule from 'vscode-oniguruma';
import textmateModule from 'vscode-textmate';

// both are CommonJS modules, so they arrive as default exports
const oniguruma = onigurumaModule;
const textmate = textmateModule;

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const grammarPath = path.join(root, 'editors', 'vscode', 'syntaxes', 'tess.tmLanguage.json');

let grammar;

test.before(async () => {
  const wasm = fs.readFileSync(require.resolve('vscode-oniguruma/release/onig.wasm'));
  await oniguruma.loadWASM(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength));

  const registry = new textmate.Registry({
    onigLib: Promise.resolve({
      createOnigScanner: (patterns) => new oniguruma.OnigScanner(patterns),
      createOnigString: (text) => new oniguruma.OnigString(text),
    }),
    loadGrammar: async (scope) => (scope === 'source.tess'
      ? textmate.parseRawGrammar(fs.readFileSync(grammarPath, 'utf-8'), grammarPath)
      : null),
  });
  grammar = await registry.loadGrammar('source.tess');
  assert.ok(grammar, 'failed to load grammar');
});

/** Splits a line into tokens as [text, innermost scope] pairs. */
function tokenize(line) {
  const { tokens } = grammar.tokenizeLine(line, textmate.INITIAL);
  return tokens.map((token) => [
    line.slice(token.startIndex, token.endIndex),
    token.scopes[token.scopes.length - 1],
  ]);
}

/** The scope assigned to a given word. */
function scopeOf(line, word) {
  const found = tokenize(line).find(([text]) => text.trim() === word);
  assert.ok(found, `could not find '${word}' in line: ${line}`);
  return found[1];
}

test('주석과 색상 리터럴을 구분한다', () => {
  assert.match(scopeOf('forward 10  # 앞으로', '# 앞으로'), /^comment\.line/);
  assert.match(scopeOf('draw_color = #ff0000', '#ff0000'), /^constant\.other\.color/);
  assert.match(scopeOf('font_color = #FFEE00', '#FFEE00'), /^constant\.other\.color/);
  // anything other than 6 hex digits is treated as a comment
  assert.match(scopeOf('say "x"  #ff00', '#ff00'), /^comment\.line/);
});

test('문자열 안의 # 은 주석이 아니다', () => {
  const tokens = tokenize('say "# 우물정 기호"');
  assert.ok(tokens.every(([, scope]) => !scope.startsWith('comment')));
  assert.ok(tokens.some(([text, scope]) => scope.startsWith('string') && text.includes('우물정')));
});

test('선언 키워드와 이름을 나눠 칠한다', () => {
  assert.match(scopeOf('function 점수_더하기(값):', 'function'), /^keyword\.declaration/);
  assert.match(scopeOf('function 점수_더하기(값):', '점수_더하기'), /^entity\.name\.function/);
  assert.match(scopeOf('var 점수 = 0', 'var'), /^keyword\.declaration/);
  assert.match(scopeOf('var 점수 = 0', '점수'), /^variable\.other/);
  assert.match(scopeOf('useobject "objects/치로.tess"', 'useobject'), /^keyword\.declaration/);
  assert.match(scopeOf('usetext "objects/판.tess"', 'usetext'), /^keyword\.declaration/);
});

test('흐름·이벤트·명령 키워드를 갈래별로 칠한다', () => {
  assert.match(scopeOf('  if 점수 > 10:', 'if'), /^keyword\.control/);
  assert.match(scopeOf('  end', 'end'), /^keyword\.control/);
  assert.match(scopeOf('when start do', 'when'), /^keyword\.control\.event/);
  assert.match(scopeOf('  forward 10', 'forward'), /^keyword\.other\.command/);
  assert.match(scopeOf('  say "안녕" for 2', 'say'), /^keyword\.other\.command/);
});

test('내장 함수와 사용자 함수를 구분한다', () => {
  assert.match(scopeOf('var a = random(1, 10)', 'random'), /^support\.function\.builtin/);
  assert.match(scopeOf('var a = root(27, 3)', 'root'), /^support\.function\.builtin/);
  assert.match(scopeOf('  점수_더하기(10)', '점수_더하기'), /^entity\.name\.function/);
});

test('상태 값과 오브젝트 속성을 칠한다', () => {
  assert.match(scopeOf('  if mouse_down:', 'mouse_down'), /^variable\.language/);
  assert.match(scopeOf('  say nickname', 'nickname'), /^variable\.language/);
  assert.match(scopeOf('  scale_x = 50', 'scale_x'), /^support\.variable\.property/);
});

test('리터럴과 연산자를 칠한다', () => {
  assert.match(scopeOf('  var a = 0.5', '0.5'), /^constant\.numeric/);
  assert.match(scopeOf('  visible true', 'true'), /^constant\.language/);
  assert.match(scopeOf('  bg_color = transparent', 'transparent'), /^constant\.language/);
  assert.match(scopeOf('  order front', 'front'), /^constant\.language/);
  assert.match(scopeOf('  var a = 2 ** 3', '**'), /^keyword\.operator\.arithmetic/);
  assert.match(scopeOf('  점수 += 1', '+='), /^keyword\.operator\.assignment/);
  assert.match(scopeOf('  if a >= b:', '>='), /^keyword\.operator\.comparison/);
  assert.match(scopeOf('  if a and b:', 'and'), /^keyword\.operator\.word/);
});

test('예제 파일 전체를 토큰으로 쪼갤 수 있다', () => {
  const source = fs.readFileSync(path.join(root, 'examples', 'all_blocks.tess'), 'utf-8');
  let state = textmate.INITIAL;
  let colored = 0;
  for (const line of source.split('\n')) {
    const result = grammar.tokenizeLine(line, state);
    state = result.ruleStack;
    colored += result.tokens.filter((token) => token.scopes.length > 1).length;
  }
  assert.ok(colored > 1000, `only ${colored} tokens were colored`);
});

test('문법 파일이 tess.ohm 과 맞춰져 있다', () => {
  // re-running build-grammar.mjs must produce an identical result
  const before = fs.readFileSync(grammarPath, 'utf-8');
  const { execFileSync } = require('node:child_process');
  execFileSync(process.execPath, [path.join(root, 'editors', 'vscode', 'build-grammar.mjs')], { cwd: root });
  assert.equal(fs.readFileSync(grammarPath, 'utf-8'), before,
    'editors/vscode/build-grammar.mjs produces a different result; regenerate and commit the grammar file.');
});
