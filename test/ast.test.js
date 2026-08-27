// 파스 트리가 어떤 AST 로 바뀌는지 — 특히 연산자 우선순위와 결합 방향을 확인한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { expr, stmt } from './helpers.js';

/** AST 를 비교하기 쉬운 S-식 문자열로 */
function sexp(node) {
  switch (node.type) {
    case 'Binary': return `(${node.operator} ${sexp(node.left)} ${sexp(node.right)})`;
    case 'Unary': return `(${node.operator} ${sexp(node.argument)})`;
    case 'Call': return `(${[node.callee, ...node.arguments.map(sexp)].join(' ')})`;
    case 'Index': return `([] ${sexp(node.target)} ${sexp(node.index)})`;
    case 'ListLiteral': return `[${node.elements.map(sexp).join(' ')}]`;
    case 'Number': return String(node.value);
    case 'String': return JSON.stringify(node.value);
    case 'Boolean': return String(node.value);
    case 'Color': return node.value;
    case 'Transparent': return 'transparent';
    case 'Identifier': return node.name;
    default: return `<${node.type}>`;
  }
}

const shape = (source, expected) =>
  test(`표현식: ${source}`, () => assert.equal(sexp(expr(source)), expected));

// --- 산술 우선순위 ------------------------------------------------------------
shape('1 + 2 * 3', '(+ 1 (* 2 3))');
shape('1 * 2 + 3', '(+ (* 1 2) 3)');
shape('(1 + 2) * 3', '(* (+ 1 2) 3)');
shape('10 - 2 - 3', '(- (- 10 2) 3)');        // 좌결합
shape('100 / 5 / 2', '(/ (/ 100 5) 2)');      // 좌결합
shape('10 // 3 * 2', '(* (// 10 3) 2)');
shape('10 % 3 + 1', '(+ (% 10 3) 1)');
shape('2 ** 3 ** 2', '(** 2 (** 3 2))');      // 우결합
shape('2 * 3 ** 2', '(* 2 (** 3 2))');        // ** 가 * 보다 강함
shape('-2 ** 2', '(** (- 2) 2)');
shape('-x + 1', '(+ (- x) 1)');

// --- 비교 · 논리 우선순위 ------------------------------------------------------
shape('hp > 0 and not dead', '(and (> hp 0) (not dead))');
shape('a or b and c', '(or a (and b c))');
shape('a and b or c', '(or (and a b) c)');
shape('not a and b', '(and (not a) b)');
shape('not mouse_down', '(not mouse_down)');
shape('score >= 100', '(>= score 100)');
shape('score <= 100', '(<= score 100)');
shape('item != "potion"', '(!= item "potion")');
shape('a + 1 == b * 2', '(== (+ a 1) (* b 2))');

// --- 호출 · 인덱스 · 리터럴 ----------------------------------------------------
shape('random(1, 10)', '(random 1 10)');
shape('random_color()', '(random_color)');
shape('join(uppercase("a"), b)', '(join (uppercase "a") b)');
shape('scores[0]', '([] scores 0)');
shape('msg[i + 1]', '([] msg (+ i 1))');
shape('from_hex(#FF0000, red)', '(from_hex #ff0000 red)');
shape('0.5', '0.5');
shape('true', 'true');
shape('false', 'false');

test('문자열 이스케이프를 해석한다', () => {
  assert.equal(expr('"a\\nb\\t\\"c\\""').value, 'a\nb\t"c"');
  assert.equal(expr('"\\u0041"').value, 'A');
});

test('색상 리터럴은 소문자로 정규화한다', () => {
  assert.deepEqual(expr('#AbCdEf'), { type: 'Color', value: '#abcdef' });
});

// --- 문장 AST ------------------------------------------------------------------
test('say ... for ...', () => {
  assert.deepEqual(stmt('say "반갑습니다!" for 2'), {
    type: 'Say',
    message: { type: 'String', value: '반갑습니다!' },
    duration: { type: 'Number', value: 2 },
  });
});

test('음수 좌표를 두 인자로 나눈다', () => {
  const node = stmt('move 50 -30');
  assert.equal(sexp(node.x), '50');
  assert.equal(sexp(node.y), '(- 30)');
  assert.equal(node.duration, null);
});

test('go 는 좌표형과 대상형을 구분한다', () => {
  const point = stmt('go 0 0');
  assert.equal(point.target, null);
  assert.equal(sexp(point.x), '0');

  const target = stmt('go "boss" in 2');
  assert.equal(sexp(target.target), '"boss"');
  assert.equal(sexp(target.duration), '2');
  assert.equal(target.x, null);
});

test('play sound 의 세 가지 형태', () => {
  assert.deepEqual(stmt('play sound "jump"'), {
    type: 'PlaySound',
    name: { type: 'String', value: 'jump' },
    duration: null, from: null, to: null, wait: false,
  });
  assert.equal(stmt('play sound "laser" for 0.5').duration.value, 0.5);
  const range = stmt('play sound "song" from 0 to 3 and wait');
  assert.equal(range.from.value, 0);
  assert.equal(range.to.value, 3);
  assert.equal(range.wait, true);
});

test('kill 과 del clone 은 같은 노드가 된다', () => {
  assert.deepEqual(stmt('kill'), stmt('del clone'));
  assert.equal(stmt('del clones').type, 'DeleteClones');
});

test('send 와 call 은 wait 플래그로 구분된다', () => {
  assert.equal(stmt('send "a"').wait, false);
  assert.equal(stmt('call "a"').wait, true);
});

test('리스트 조작 문장', () => {
  assert.deepEqual(stmt('in scores add 70'), {
    type: 'ListAdd',
    list: { type: 'Identifier', name: 'scores' },
    value: { type: 'Number', value: 70 },
  });
  const insert = stmt('in scores insert 80 at 1');
  assert.equal(insert.value.value, 80);
  assert.equal(insert.index.value, 1);
  assert.equal(stmt('remove scores[2]').index.value, 2);
});

test('복합 대입 연산자를 그대로 보존한다', () => {
  assert.equal(stmt('score += 10').operator, '+=');
  assert.equal(stmt('level **= 2').operator, '**=');
  assert.equal(stmt('count %= 2').operator, '%=');
  assert.equal(stmt('scores[0] = 95').target.type, 'Index');
});

test('show 는 대상 유무를 구분한다', () => {
  assert.equal(stmt('show').target, null);
  assert.equal(stmt('show scores').target.name, 'scores');
});

test('stop 계열은 서로 다른 노드가 된다', () => {
  assert.equal(stmt('stop').type, 'Stop');
  assert.equal(stmt('stop all').target, 'all');
  assert.equal(stmt('stop sound all').type, 'StopSound');
  assert.equal(stmt('stop bgm').type, 'StopBgm');
  assert.equal(stmt('stop timer').type, 'StopTimer');
  assert.equal(stmt('stop draw').type, 'StopDraw');
});

test('노드에 소스 위치(loc)가 붙는다', async () => {
  const { parse } = await import('../src/parse.js');
  const { ast } = parse('var a = 1\n');
  assert.deepEqual(ast.body[0].loc, { start: 0, end: 9 });
});
