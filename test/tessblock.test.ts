import test from 'node:test';
import assert from 'node:assert/strict';
import { needsDisplayName, safeIdent, uniqueIdent } from '../packages/tessblock/src/codegen/ident.ts';
import { num, numOrQuote, quote } from '../packages/tessblock/src/codegen/quote.ts';
import { Order } from '../packages/tessblock/src/codegen/order.ts';
import { specsOf } from '../packages/tessblock/src/blocks/spec.ts';
import { EXPANSION_BLOCKS } from '../packages/core/src/expansion.ts';
import { compileProject } from '../packages/compiler/src/index.ts';
import '../packages/tessblock/src/blocks/catalog/expansion.ts';

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

test('tessblock - 확장 블록이 컴파일러 표와 같은 칸을 가진다', () => {
  const specs = specsOf('expansion');
  assert.equal(specs.length, Object.keys(EXPANSION_BLOCKS).length);
  for (const spec of specs) {
    const name = spec.type.replace(/^ext_/, '');
    const definition = EXPANSION_BLOCKS[name as keyof typeof EXPANSION_BLOCKS];
    assert.ok(definition, `${name} 은 확장 표에 없다`);
    // 값 자리는 소켓, 고르는 자리는 필드여야 컴파일러가 받는다.
    const slots = spec.args.map((arg) => (arg.type === 'value' ? 'value' : 'field'));
    assert.deepEqual(slots, definition.slots, name);
    assert.equal(spec.shape, definition.kind, name);
    assert.equal(spec.message.match(/%\d+/g)?.length ?? 0, definition.slots.length, name);
  }
});

test('tessblock - 확장 블록이 쓴 글이 그대로 컴파일된다', () => {
  const lines = specsOf('expansion').map((spec) => {
    const args: Record<string, string> = {};
    for (const arg of spec.args) {
      // 값 자리에는 식이, 고르는 자리에는 고른 글자가 그대로 온다.
      if (arg.type === 'value') args[arg.name] = arg.fallback;
      else if (arg.type === 'dropdown') args[arg.name] = arg.options[0]![1];
      else if (arg.type === 'text') args[arg.name] = arg.value;
    }
    const code = spec.code(args, null as never, null as never);
    const call = Array.isArray(code) ? code[0] : code;
    return spec.shape === 'boolean' ? `      if ${call}:\n        say "y"\n      end` : `      say ${call}`;
  });
  const source = `project:\n  title "확장"\nend\n\nobject "엔트리":\n  when start do\n${lines.join('\n')}\n  end\nend\n`;
  const result = compileProject(source);
  assert.deepEqual(result.errors.map((error) => error.message), []);
  assert.deepEqual(result.project?.expansionBlocks?.slice().sort(), [
    'behaviorConductDisaster', 'behaviorConductLifeSafety', 'disasterAlert',
    'emergencyActionGuidelines', 'festival', 'weather',
  ]);
  assert.deepEqual(result.project?.aiUtilizeBlocks, ['translate']);
});
