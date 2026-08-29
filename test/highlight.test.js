// ============================================================================
//  VS Code 문법 강조 검사
//
//  editors/vscode 의 TextMate 문법을 실제 토크나이저(vscode-textmate)로 돌려서
//  각 낱말이 의도한 갈래로 칠해지는지 확인한다.
// ============================================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import onigurumaModule from 'vscode-oniguruma';
import textmateModule from 'vscode-textmate';

// 둘 다 CommonJS 로 나와서 default 로 들어온다
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
  assert.ok(grammar, '문법을 불러오지 못했습니다.');
});

/** 한 줄을 토큰으로 쪼개서 [글자, 가장 안쪽 스코프] 목록으로 */
function tokenize(line) {
  const { tokens } = grammar.tokenizeLine(line, textmate.INITIAL);
  return tokens.map((token) => [
    line.slice(token.startIndex, token.endIndex),
    token.scopes[token.scopes.length - 1],
  ]);
}

/** 그 낱말이 받은 스코프 */
function scopeOf(line, word) {
  const found = tokenize(line).find(([text]) => text.trim() === word);
  assert.ok(found, `'${word}' 를 줄에서 찾지 못했습니다: ${line}`);
  return found[1];
}

test('주석과 색상 리터럴을 구분한다', () => {
  assert.match(scopeOf('forward 10  # 앞으로', '# 앞으로'), /^comment\.line/);
  assert.match(scopeOf('draw_color = #ff0000', '#ff0000'), /^constant\.other\.color/);
  assert.match(scopeOf('font_color = #FFEE00', '#FFEE00'), /^constant\.other\.color/);
  // 6자리가 아니면 주석이다
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
  assert.ok(colored > 1000, `칠해진 토큰이 ${colored}개뿐입니다.`);
});

test('문법 파일이 파서의 키워드 목록과 맞춰져 있다', () => {
  // build-grammar.mjs 를 다시 돌려도 결과가 같아야 한다
  const before = fs.readFileSync(grammarPath, 'utf-8');
  const { execFileSync } = require('node:child_process');
  execFileSync(process.execPath, [path.join(root, 'editors', 'vscode', 'build-grammar.mjs')], { cwd: root });
  assert.equal(fs.readFileSync(grammarPath, 'utf-8'), before,
    'editors/vscode/build-grammar.mjs 를 다시 돌리면 결과가 달라집니다. 문법 파일을 다시 만들어 커밋하세요.');
});
