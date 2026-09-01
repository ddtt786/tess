// ============================================================================
//  거듭제곱 · n제곱근이 실제로 맞는 값을 내는지 확인한다.
//
//  엔트리에 있는 블록은 제곱(square) · 제곱근(root) · 자연로그(ln) · 사칙연산뿐이다.
//  컴파일러가 만든 블록 트리를 그대로 계산해서 Math.pow 와 비교한다.
// ============================================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import { compileProject } from '@tess/compiler';
import { verifyEntryProject } from '@tess/compiler';

/** 식 하나를 컴파일해서 블록 트리와 프로젝트를 돌려준다 */
function build(expression) {
  const source = `scene "s":
  object "o":
    when start do
      var 값 = ${expression}
    end
  end
end`;
  const result = compileProject(source, { path: 'x.tess' });
  assert.deepEqual(result.errors, [], result.errors.map((e) => e.message).join('\n'));
  return { block: JSON.parse(result.project.objects[0].script)[0][1].params[1], project: result.project };
}

/** 엔트리 값 블록을 그대로 계산한다 (이 식이 쓰는 블록만) */
function makeRunner(project) {
  const definitions = new Map(project.functions.map((fn) => [fn.id, JSON.parse(fn.content)[0][0]]));

  return function run(block, args = {}) {
    if (block === null || typeof block !== 'object') return Number(block);
    switch (block.type) {
      case 'number': case 'text':
        return Number(block.params[0]);
      case 'calc_operation': {
        const value = run(block.params[1], args);
        return { square: value * value, root: Math.sqrt(value), ln: Math.log(value) }[block.params[3]];
      }
      case 'calc_basic': {
        const left = run(block.params[0], args);
        const right = run(block.params[2], args);
        return { PLUS: left + right, MINUS: left - right, MULTI: left * right, DIVIDE: left / right }[block.params[1]];
      }
      default: {
        if (block.type.startsWith('func_')) {
          const create = definitions.get(block.type.slice(5));
          const names = [];
          let field = create.params[0].params[1];
          while (field) { names.push(field.params[0].type); field = field.params[1]; }
          const inner = Object.fromEntries(names.map((type, i) => [type, run(block.params[i], args)]));
          return run(create.params[3], inner);
        }
        if (block.type in args) return args[block.type];
        throw new Error(`계산할 수 없는 블록: ${block.type}`);
      }
    }
  };
}

function countBlocks(block) {
  if (!block || typeof block !== 'object') return 0;
  return 1 + (block.params ?? []).reduce((sum, param) => sum + countBlocks(param), 0);
}

function value(expression) {
  const { block, project } = build(expression);
  assert.deepEqual(verifyEntryProject(project), []);
  return { result: makeRunner(project)(block), blocks: countBlocks(block) };
}

const exact = (expression, expected) => test(`정확: ${expression}`, () => {
  const { result } = value(expression);
  assert.equal(result, expected);
});

const close = (expression, expected, tolerance = 1e-9) => test(`근사: ${expression}`, () => {
  const { result } = value(expression);
  const error = Math.abs(result - expected) / Math.abs(expected);
  assert.ok(error < tolerance, `${result} 의 상대오차가 ${error.toExponential(1)} 입니다.`);
});

// --- 2의 거듭제곱꼴 지수는 오차 없이 딱 떨어진다 --------------------------------
exact('9 ** 0', 1);
exact('7 ** 1', 7);
exact('3 ** 2', 9);
exact('2 ** 10', 1024);
exact('2 ** 16', 65536);
exact('16 ** 0.5', 4);
exact('16 ** 0.25', 2);
exact('7 ** 2.5', 7 ** 2.5);
exact('5 ** -2', 0.04);
exact('root(16, 2)', 4);
exact('root(16, 4)', 2);
exact('root(2, 2)', Math.SQRT2);

// --- 무한소수 지수도 뉴턴 보정으로 사실상 정확해진다 -----------------------------
close('27 ** (1/3)', 3);
close('1000 ** 0.3', 1000 ** 0.3);
close('2 ** 0.1', 2 ** 0.1);
close('root(27, 3)', 3);
close('root(10, 7)', 10 ** (1 / 7));
close('root(1000000, 3)', 100);
close('5 ** 3.3', 5 ** 3.3);
close('2 ** -0.7', 2 ** -0.7);

test('식이 너무 커지지 않는다', () => {
  // 자릿수만큼만 펼치므로 지수가 커져도 블록은 천천히 는다
  assert.ok(value('2 ** 10').blocks <= 10, '정수 지수는 이진 전개로 짧아야 합니다.');
  assert.ok(value('27 ** (1/3)').blocks <= 60, '무한소수 지수도 60블록을 넘지 않아야 합니다.');
});

test('다듬기 함수는 작품에 한 번만 생긴다', () => {
  const source = `scene "s":
  object "o":
    when start do
      var a = 27 ** (1/3)
      var b = 10 ** 0.7
      var c = root(5, 3)
    end
  end
end`;
  const { project } = compileProject(source, { path: 'x.tess' });
  assert.equal(project.functions.length, 1);
  assert.deepEqual(verifyEntryProject(project), []);
});

test('변수를 밑으로 써도 된다', () => {
  const source = `var 밑 = 0
scene "s":
  object "o":
    when start do
      밑 = 27
      var 답 = 밑 ** (1/3)
    end
  end
end`;
  const result = compileProject(source, { path: 'x.tess' });
  assert.deepEqual(result.errors, []);

  const thread = JSON.parse(result.project.objects[0].script)[0];
  const run = makeRunner(result.project);
  // get_variable 은 27 을 돌려준다고 치고 계산해 본다
  const patched = JSON.parse(JSON.stringify(thread[2].params[1])
    .replaceAll('"get_variable"', '"number"')
    .replace(/"params":\["[a-z0-9]{4}",null\]/g, '"params":["27"]'));
  assert.ok(Math.abs(run(patched) - 3) < 1e-9);
});
