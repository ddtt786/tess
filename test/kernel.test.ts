/**
 * wasm 커널이 자바스크립트 경로와 같은 답을 내는지 검증합니다.
 *
 * 커널은 프레임을 넘기지 않는 숫자 함수만 가져가므로, 확인할 것은 두 가지입니다 —
 * 무엇을 가져가고 무엇을 두고 가는가(`planKernel`), 그리고 가져간 것이 두고 간 것과
 * **똑같은 값**을 내는가. 마지막 하나는 같은 작품을 커널 있이·없이 돌린 뒤 변수와
 * 리스트를 통째로 맞춰 봅니다.
 *
 * moonbit 툴체인이 없는 곳에서는 빌드가 필요한 항목만 건너뜁니다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { compileProject } from '@tess/compiler';
import { Vm, buildKernel, fingerprint, moonPath, planKernel } from '@tess/vm';
import type { KernelPlan } from '@tess/vm';

const hasMoon = moonPath() !== null;

/** Compiles Tess source into the shape `Vm.load` takes. */
function project(source: string): never {
  const result = compileProject(source, { path: 'kernel.tess' });
  assert.ok(result.project, result.errors[0]?.message ?? '컴파일 실패');
  return result.project as unknown as never;
}

/** The plan a work would get, without building anything. */
function planOf(source: string): KernelPlan {
  const vm = new Vm({ renderer: null, audio: null, kernel: () => null });
  vm.load(project(source));
  assert.ok(vm.kernelPlan, '계획이 없습니다');
  return vm.kernelPlan;
}

/** Runs a work for `ticks` frames, with the kernel or without it. */
function runWork(source: string, ticks: number, withKernel: boolean): Vm {
  const built = project(source);
  let plan: KernelPlan | null = null;
  const vm = new Vm({
    renderer: null,
    audio: null,
    kernel: withKernel
      ? (found) => {
          plan = found;
          const wasm = buildKernel(found.source, [...found.roots.values()].map((root) => root.name));
          return wasm ? wasm.wasm : null;
        }
      : null,
  });
  vm.load(built);
  if (withKernel) {
    assert.ok(plan, '커널 계획이 세워지지 않았습니다');
    assert.ok(vm.kernel, '커널이 붙지 않았습니다');
  }
  vm.start();
  for (let at = 0; at < ticks; at += 1) {
    vm.tick();
  }
  return vm;
}

/** Every variable and list of a run, as text, for comparing two runs. */
function snapshot(vm: Vm): string {
  return vm.variables
    .map((variable) =>
      variable.isList
        ? `${variable.name}=[${variable.array.map((item) => String(item.data)).join(',')}]`
        : `${variable.name}=${String(variable.getValue())}`,
    )
    .join('\n');
}

/** Both runs of one work agree, value for value. */
function assertSameAsJavascript(source: string, ticks: number): Vm {
  const withKernel = runWork(source, ticks, true);
  const without = runWork(source, ticks, false);
  assert.equal(snapshot(withKernel), snapshot(without));
  return withKernel;
}

// ---------------------------------------------------------------------------
//  무엇을 가져가는가
// ---------------------------------------------------------------------------
const NUMERIC = `
var ret = 0
var total = 0
var i = 0
list data = [1, 2, 3, 4, 5, 6, 7, 8]

function step():
  total += data[i]
  i += 1
  return 0
end

function four():
  ret = step()
  ret = step()
  ret = step()
  ret = step()
  return 0
end

scene "s":
  object "o":
    when start do
      i = 1
      ret = four()
    end
  end
end`;

test('프레임을 넘기지 않는 숫자 함수는 커널이 가져간다', () => {
  const plan = planOf(NUMERIC);
  assert.ok(plan, '계획이 없습니다');
  // `four` 만 바깥에서 부르므로 진입점은 하나다. `step` 은 커널 안에서 불린다.
  assert.equal(plan.roots.size, 1);
  assert.equal(plan.rejected.size, 0);
});

test('그리기 블록이 섞인 함수는 커널이 두고 간다', () => {
  const plan = planOf(`
var ret = 0
var i = 0

function draw_step():
  i += 1
  go i i
  return 0
end

scene "s":
  object "o":
    when start do
      ret = draw_step()
    end
  end
end`);
  assert.equal(plan.roots.size, 0);
});

test('못 가는 함수를 부르는 함수도 못 간다', () => {
  const plan = planOf(`
var ret = 0
var i = 0

function leaf():
  go i i
  return 0
end

function branch():
  i += 1
  ret = leaf()
  return 0
end

function top():
  ret = branch()
  return 0
end

scene "s":
  object "o":
    when start do
      ret = top()
    end
  end
end`);
  assert.equal(plan.roots.size, 0);
});

test('자기를 부르는 함수는 깊이가 정해지지 않아 못 간다', () => {
  const plan = planOf(`
var ret = 0
var i = 0

function loop_forever():
  i += 1
  if i < 10:
    ret = loop_forever()
  end
  return 0
end

scene "s":
  object "o":
    when start do
      ret = loop_forever()
    end
  end
end`);
  assert.equal(plan.roots.size, 0);
});

test('숫자가 아닌 값이 든 리스트를 쓰는 함수는 못 간다', () => {
  const plan = planOf(`
var ret = 0
var i = 0
list names = ["ADAL", "ADAR"]

function pick():
  i += 1
  names[i] = names[1]
  return 0
end

scene "s":
  object "o":
    when start do
      ret = pick()
    end
  end
end`);
  assert.equal(plan.roots.size, 0);
});

test('반복 블록은 프레임을 넘기므로 커널이 두고 간다', () => {
  const plan = planOf(`
var ret = 0
var total = 0

function counted():
  repeat 5:
    total += 1
  end
  return 0
end

scene "s":
  object "o":
    when start do
      ret = counted()
    end
  end
end`);
  assert.equal(plan.roots.size, 0);
});

// ---------------------------------------------------------------------------
//  같은 답을 내는가
// ---------------------------------------------------------------------------
test('지문은 같은 소스에 같은 값을 준다', () => {
  assert.equal(fingerprint('abc'), fingerprint('abc'));
  assert.notEqual(fingerprint('abc'), fingerprint('abd'));
});

test('커널이 낸 값은 자바스크립트가 낸 값과 같다 (10진 산술)', { skip: !hasMoon }, () => {
  assertSameAsJavascript(`
var ret = 0
var sum = 0
var product = 1
var i = 0
list data = [0.1, 0.2, 0.005, 1.5, 2, 0.3333333333333333, 100, 0.0001]

function step():
  sum = sum + data[i]
  product = product * data[i]
  sum += 0.005
  i += 1
  return 0
end

function eight():
  ret = step()
  ret = step()
  ret = step()
  ret = step()
  ret = step()
  ret = step()
  ret = step()
  ret = step()
  return 0
end

scene "s":
  object "o":
    when start do
      i = 1
      ret = eight()
    end
  end
end`, 4);
});

test('커널이 낸 값은 자바스크립트가 낸 값과 같다 (수학 블록)', { skip: !hasMoon }, () => {
  assertSameAsJavascript(`
var ret = 0
var i = 0
list angle = [0, 30, 45, 90, 135, 180, 270, 360, 12.5, -30]
list result = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]

function step():
  result[i] = (((sin(angle[i]) + cos(angle[i])) + sqrt(abs(angle[i]))) + floor((angle[i] / 7)))
  i += 1
  return 0
end

function ten():
  ret = step()
  ret = step()
  ret = step()
  ret = step()
  ret = step()
  ret = step()
  ret = step()
  ret = step()
  ret = step()
  ret = step()
  return 0
end

scene "s":
  object "o":
    when start do
      i = 1
      ret = ten()
    end
  end
end`, 3);
});

test('커널이 낸 값은 자바스크립트가 낸 값과 같다 (리스트 범위 밖·조건)', { skip: !hasMoon }, () => {
  assertSameAsJavascript(`
var ret = 0
var i = 0
var hits = 0
list data = [1, 2, 3]
list out = [0, 0, 0]

function step():
  # 범위 밖 번호는 엔트리에서 0 으로 읽히고, 쓰기는 아무 일도 하지 않는다.
  out[(i - 1)] = data[(i + 1)]
  if ((data[i] > 1) and (data[i] < 3)):
    hits += 1
  end
  i += 1
  return 0
end

function five():
  ret = step()
  ret = step()
  ret = step()
  ret = step()
  ret = step()
  return 0
end

scene "s":
  object "o":
    when start do
      i = 1
      ret = five()
    end
  end
end`, 3);
});

test('커널이 쓴 변수도 엔트리처럼 글자로 담긴다', { skip: !hasMoon }, () => {
  const vm = assertSameAsJavascript(`
var ret = 0
var clock = 0

function tick_once():
  clock += 0.005
  return 0
end

function four():
  ret = tick_once()
  ret = tick_once()
  ret = tick_once()
  ret = tick_once()
  return 0
end

scene "s":
  object "o":
    when start do
      ret = four()
    end
  end
end`, 3);
  // `변수 바꾸기` 는 `toFixed` 가 쓴 글자를 담으므로 0.02 가 아니라 "0.020" 이다.
  const clock = vm.variables.find((variable) => variable.name === 'clock');
  assert.equal(clock?.getValue(), '0.020');
});

test('리스트 길이가 달라지면 커널은 물러나고 작품은 그대로 돈다', { skip: !hasMoon }, () => {
  const source = `
var ret = 0
var i = 0
var total = 0
list data = [1, 2, 3, 4]

function step():
  total += data[i]
  i += 1
  return 0
end

function four():
  ret = step()
  ret = step()
  ret = step()
  ret = step()
  return 0
end

scene "s":
  object "o":
    when start do
      forever:
        i = 1
        ret = four()
      end
    end
  end
end`;
  const vm = runWork(source, 2, true);
  const before = vm.kernel!.stats.runs;
  assert.ok(before > 0, '커널이 한 번도 돌지 않았습니다');
  const data = vm.variables.find((variable) => variable.name === 'data')!;
  data.array.push({ data: 5 });
  data.touch();
  vm.variables.find((variable) => variable.name === 'i')!.setValue(1);
  vm.tick();
  vm.tick();
  assert.equal(vm.kernel!.stats.runs, before, '길이가 달라졌는데도 커널이 돌았습니다');
  assert.ok(vm.kernel!.stats.fallbacks > 0);
  assert.equal(vm.errors.length, 0);
});

// ---------------------------------------------------------------------------
//  판단을 담는 리스트
// ---------------------------------------------------------------------------
const JUDGED = `
var ret = 0
var i = 0
list point = [4, -4, 40, -40]
list inside = ["FALSE", "FALSE", "FALSE", "FALSE"]
var hits = 0

function step():
  inside[i] = ((point[i] > -10) and (point[i] < 10))
  if inside[i]:
    hits += 1
  end
  i += 1
  return 0
end

function four():
  ret = step()
  ret = step()
  ret = step()
  ret = step()
  return 0
end

scene "s":
  object "o":
    when start do
      forever:
        i = 1
        ret = four()
      end
    end
  end
end`;

test('판단을 담는 리스트도 커널이 가져간다', () => {
  const plan = planOf(JUDGED);
  assert.ok(plan.roots.size > 0);
});

test('판단 리스트는 엔트리처럼 TRUE·FALSE 글자로 남는다', { skip: !hasMoon }, () => {
  const vm = assertSameAsJavascript(JUDGED, 6);
  const inside = vm.variables.find((variable) => variable.name === 'inside')!;
  assert.deepEqual(inside.array.map((item) => item.data), ['TRUE', 'TRUE', 'FALSE', 'FALSE']);
});
