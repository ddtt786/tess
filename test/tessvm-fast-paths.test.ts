/** Fast paths: on only for works declaring `$TESSVM`, with the same results as the old path. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { compileProject } from '@tess/compiler';
import { Vm } from '@tess/vm';
import { flatPolygon, isFanSafe } from '../packages/tessvm/src/render/fill-geometry.ts';

function projectOf(source: string): never {
  const result = compileProject(source, { path: 'test.tess' });
  assert.ok(result.project, result.errors[0]?.message ?? '컴파일 실패');
  return result.project as unknown as never;
}

function runVm(source: string, fastPaths: boolean | 'auto', kernel = false): Vm {
  const vm = new Vm({ renderer: null, audio: null, fastPaths, kernel: kernel ? () => null : undefined });
  vm.load(projectOf(source));
  vm.start();
  return vm;
}

function snapshot(vm: Vm): string {
  return JSON.stringify(vm.variables.map((variable) => [
    variable.name,
    variable.getValue(),
    variable.isList ? variable.array.map((item) => item.data) : null,
  ]));
}

const wrap = (body: string, extra = '') => `${extra}
scene "s":
  object "o":
    when start do
${body
  .split('\n')
  .map((line) => `      ${line}`)
  .join('\n')}
    end
  end
end`;

const FUNCTIONS = `
function 더하기(a, b):
  var t = 0
  t = a + b
  return t
end

function 피보(n):
  var t = 0
  if (n < 2):
    t = n
  else:
    t = 피보(n - 1) + 피보(n - 2)
  end
  return t
end

function 합(n):
  var i = 0
  var s = 0
  while (i < n):
    i += 1
    s = 더하기(s, i)
    skip
  end
  return s
end

function 채우기(n):
  var i = 0
  while (i < n):
    i += 1
    in L add 합(i)
    skip
  end
end

function 천천히(n):
  repeat n:
    느림 += 1
  end
end

function 앞(a, b):
  var t = 0
  t = a
  if (b == 1):
    stop
  end
  t = 99
  return t
end
`;

const PROGRAM = FUNCTIONS + wrap(
  'a = 더하기(0.1, 0.2)\nb = 피보(12)\nc = 합(100)\n채우기(30)\nd = 앞(7, 1)\ne = 앞(7, 0)\n천천히(5)\nf = 1',
  'var a = 0\nvar b = 0\nvar c = 0\nvar d = 0\nvar e = 0\nvar f = 0\nvar 느림 = 0\nlist L = []',
);

test('$TESSVM 을 선언한 작품에만 빠른 경로가 켜진다', () => {
  const plain = runVm(wrap('a = 1', 'var a = 0'), 'auto');
  assert.equal(plain.fastPaths, false);
  const tess = runVm(wrap('a = 1', 'var TESSVM as "$TESSVM" = 0\nvar a = 0'), 'auto');
  assert.equal(tess.fastPaths, true);
});

test('프레임을 넘기지 않고 되부르지 않는 함수만 일반 함수가 된다', () => {
  const vm = new Vm({ renderer: null, audio: null, fastPaths: true });
  const project = projectOf(PROGRAM);
  vm.load(project);
  const source = vm.compiledSource(project as never);
  const names = (project as unknown as { functions: Array<{ id: string; content: string }> }).functions;
  const direct = new Set([...source.matchAll(/^FP\[(\d+)\] = function \(/gm)].map((match) => Number(match[1])));
  const label = (index: number) => {
    const content = String(names[index]!.content);
    return ['더하기', '피보', '합', '채우기', '천천히', '앞'].find((name) => content.includes(name)) ?? String(index);
  };
  const picked = new Set([...direct].map(label));
  assert.ok(picked.has('더하기'));
  assert.ok(picked.has('합'));
  assert.ok(picked.has('채우기'));
  assert.ok(picked.has('앞'));
  assert.ok(!picked.has('피보'));
  assert.ok(!picked.has('천천히'));
});

test('빠른 경로도 예전 경로와 같은 값과 같은 프레임 흐름을 낸다', () => {
  const slow = runVm(PROGRAM, false);
  const fast = runVm(PROGRAM, true);
  for (let frame = 0; frame < 12; frame += 1) {
    assert.equal(snapshot(fast), snapshot(slow), `${frame} 번째 프레임`);
    slow.tick();
    fast.tick();
  }
  const value = (vm: Vm, name: string) => Number(vm.variables.find((item) => item.name === name)!.getValue());
  assert.equal(value(fast, 'a'), 0.3);
  assert.equal(value(fast, 'b'), 144);
  assert.equal(value(fast, 'c'), 5050);
  assert.equal(value(fast, 'd'), 7);
  assert.equal(value(fast, 'e'), 99);
  assert.equal(value(fast, '느림'), 5);
  assert.equal(value(fast, 'f'), 1);
});

test('빠른 경로에서도 커널이 붙고 같은 값을 낸다', () => {
  const source = FUNCTIONS + wrap(
    'forever:\n  a = 더하기(a, 1.5)\nend',
    'var TESSVM as "$TESSVM" = 0\nvar a = 0',
  );
  const plain = runVm(source, false);
  const kernel = runVm(source, 'auto', true);
  assert.equal(kernel.fastPaths, true);
  for (let frame = 0; frame < 40; frame += 1) {
    plain.tick();
    kernel.tick();
  }
  assert.equal(snapshot(kernel), snapshot(plain));
  assert.ok(kernel.kernel, '커널이 붙지 않았습니다');
  assert.ok(kernel.kernel!.stats.runs > 0, '직접 부른 함수가 커널을 거치지 않았습니다');
});

test('채우기 꼭짓점은 Graphics 가 받는 것처럼 겹친 점과 닫는 점을 뺀다', () => {
  const out: number[] = [];
  assert.equal(flatPolygon([0, 0, 0, 0, 10, 0, 10, 10, 0, 0], out), 3);
  assert.deepEqual(out, [0, -0, 10, -0, 10, -10]);
  assert.equal(flatPolygon([1, 2], out), 1);
});

test('부채꼴로 자르는 것은 삼각형과 볼록한 사각형뿐이다', () => {
  const corners = (points: number[]) => {
    const out: number[] = [];
    return { out, count: flatPolygon(points, out) };
  };
  const square = corners([0, 0, 10, 0, 10, 10, 0, 10]);
  assert.ok(isFanSafe(square.out, square.count));
  const triangle = corners([0, 0, 10, 0, 5, 5]);
  assert.ok(isFanSafe(triangle.out, triangle.count));
  const dart = corners([0, 0, 10, 5, 0, 10, 3, 5]);
  assert.ok(!isFanSafe(dart.out, dart.count));
  const bowtie = corners([0, 0, 10, 10, 10, 0, 0, 10]);
  assert.ok(!isFanSafe(bowtie.out, bowtie.count));
  const pentagon = corners([0, 0, 10, 0, 12, 6, 5, 10, -2, 6]);
  assert.ok(!isFanSafe(pentagon.out, pentagon.count));
});

test('부스트를 끄면 채우기 꼭짓점은 뒤집지 않은 조각 그대로 받는다', () => {
  const out: number[] = [];
  assert.equal(flatPolygon([0, 0, 10, 0, 10, 10, 10, 10], out, false), 3);
  assert.deepEqual(out, [0, 0, 10, 0, 10, 10]);
});
