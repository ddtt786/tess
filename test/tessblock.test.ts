import test from 'node:test';
import assert from 'node:assert/strict';
import { needsDisplayName, safeIdent, uniqueIdent } from '../packages/tessblock/src/codegen/ident.ts';
import { num, numOrQuote, quote } from '../packages/tessblock/src/codegen/quote.ts';
import { Order } from '../packages/tessblock/src/codegen/order.ts';

test('tessblock - 이름을 Tess 식별자로 옮긴다', () => {
  assert.equal(safeIdent('점수'), '점수');
  assert.equal(safeIdent('내 점수'), '내_점수');
  assert.equal(safeIdent('2단계'), '_2단계');
  assert.equal(safeIdent(''), '이름');
  // 키워드와 내장 이름은 가려지지 않게 꼬리를 단다.
  assert.equal(safeIdent('repeat'), 'repeat_');
  assert.equal(safeIdent('answer'), 'answer_');
  assert.equal(needsDisplayName('내 점수'), true);
  assert.equal(needsDisplayName('점수'), false);
});

test('tessblock - 같은 이름끼리 겹치지 않게 번호를 붙인다', () => {
  const taken = new Set<string>();
  assert.equal(uniqueIdent('내 점수', taken), '내_점수');
  assert.equal(uniqueIdent('내-점수', taken), '내_점수_2');
  assert.equal(uniqueIdent('내 점수', taken), '내_점수_3');
});

test('tessblock - 리터럴을 Tess 표기로 쓴다', () => {
  assert.equal(quote('안녕 "엔트리"'), '"안녕 \\"엔트리\\""');
  assert.equal(quote('줄\n바꿈'), '"줄\\n바꿈"');
  assert.equal(num(10), '10');
  assert.equal(num(1.5), '1.5');
  assert.equal(num(Number.NaN), '0');
  assert.equal(numOrQuote('12'), '12');
  assert.equal(numOrQuote('열둘'), '"열둘"');
});

test('tessblock - 우선순위 사다리가 Tess 문법 순서와 같다', () => {
  assert.ok(Order.ATOMIC < Order.UNARY);
  assert.ok(Order.POW < Order.MUL);
  assert.ok(Order.MUL < Order.ADD);
  assert.ok(Order.ADD < Order.COMPARE);
  assert.ok(Order.COMPARE < Order.NOT);
  assert.ok(Order.NOT < Order.AND);
  assert.ok(Order.AND < Order.OR);
  assert.ok(Order.OR < Order.NONE);
});
