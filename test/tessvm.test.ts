/**
 * tessvm(Tess 실행기)의 실행 규칙이 엔트리와 같은지 검증합니다.
 *
 * 화면 없이 VM 만 돌리므로 스케줄링·값 변환·충돌 판정을 프레임 단위로 확인할 수
 * 있습니다. 각 항목의 기준은 entryjs 의 `src/playground/blocks/block_*.js` 와
 * `class/executor.js` 입니다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileProject } from '@tess/compiler';
import type { EntryProject } from '@tess/compiler';
import {
  SVG_PIXEL_BUDGET,
  svgBudgetScale,
  svgSharpness,
  textSharpness,
} from '../packages/tessvm/src/render/sharpness.ts';
import {
  CollisionSystem,
  MaskStore,
  Table,
  Vm,
  cast,
  entityBounds,
  maskFromPixels,
  parseFont,
  setStageSize,
  stage,
} from '@tess/vm';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Compiles Tess source and hands back a started VM. */
function runVm(source: string): Vm {
  const result = compileProject(source, { path: 'test.tess' });
  assert.ok(result.project, result.errors[0]?.message ?? '컴파일 실패');
  const vm = new Vm({ renderer: null, audio: null });
  vm.load(result.project as unknown as never);
  vm.start();
  return vm;
}

/**
 * 변수 값을 숫자로 읽습니다. 엔트리의 `변수 바꾸기`·`정하기` 는 값을 문자열로
 * 담아 두므로(`toFixed` 의 결과), 비교는 숫자로 맞춰서 합니다.
 */
function valueOf(vm: Vm, name: string): number {
  const variable = vm.variables.find((item) => item.name === name);
  assert.ok(variable, `변수 ${name} 을 찾지 못했습니다`);
  return Number(variable.getValue());
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

// ---------------------------------------------------------------------------
//  값 변환과 10진 산술
// ---------------------------------------------------------------------------
test('숫자 변환은 parseFloat 뒤 0 으로 떨어진다', () => {
  assert.equal(cast.num('12abc'), 12);
  assert.equal(cast.num('abc'), 0);
  assert.equal(cast.num(''), 0);
  assert.equal(cast.num('  3.5 '), 3.5);
});

test('판단 값은 숫자로 읽히면 그 진리값, 아니면 참이다', () => {
  assert.equal(cast.bool('0'), false);
  assert.equal(cast.bool('0.00'), false);
  assert.equal(cast.bool('hello'), true);
  assert.equal(cast.bool(undefined), false);
});

test('사칙연산은 엔트리처럼 10진으로 계산한다', () => {
  assert.equal(cast.addNum(0.1, 0.2), 0.3);
  assert.equal(cast.subNum(0.3, 0.1), 0.2);
  assert.equal(cast.mulNum(1.1, 1.1), 1.21);
  assert.equal(cast.addNum(1, 2), 3);
  assert.equal(cast.divNum(1, 4), 0.25);
});

/**
 * 자리를 세어 반올림하는 자리와 그럴 필요가 없는 자리를 함께 봅니다. 배정밀도의
 * 이웃 간격보다 촘촘한 눈금은 결과를 바꾸지 못하므로 값이 그대로 나와야 합니다.
 */
test('10진 반올림은 배정밀도가 담아내는 자리까지만 움직인다', () => {
  const sin30 = Math.sin(Math.PI / 6);
  assert.equal(cast.mulNum(sin30, 30), sin30 * 30);
  assert.equal(cast.mulNum(0.1, 0.2), 0.02);
  assert.equal(cast.addNum(100.1, 0.02), 100.12);
  assert.equal(cast.subNum(1e21, 0.5), 1e21 - 0.5);
  assert.equal(cast.mulNum(1 / 3, 1 / 3), (1 / 3) * (1 / 3));
  assert.ok(Number.isNaN(cast.addNum(NaN, 0.1)));
  assert.equal(cast.mulNum(Infinity, 0.1), Infinity);
});

test('숫자 판별은 지수도 앞의 점도 숫자로 보지 않는다', () => {
  for (const yes of ['0', '-0', '12', '-12', '12.', '12.5', '-0.75']) {
    assert.equal(cast.isNumber(yes), true, yes);
  }
  for (const no of ['', '-', '.', '.5', '-.5', '1e5', '+1', ' 1', '1 ', '1.2.3', 'abc', '1a']) {
    assert.equal(cast.isNumber(no), false, no);
  }
  assert.equal(cast.isNumber(12), true);
  assert.equal(cast.isNumber(null), false);
});

/**
 * 값 칸은 `parseFloat(v) || 0` 이므로, 앞 블록이 내놓은 `NaN` 은 그 값을 읽는 다음
 * 블록에서 0 이 됩니다. 변수에 그대로 담으면 `NaN` 이 남는 것과 다릅니다.
 */
test('NaN 은 값 칸을 지날 때 0 이 된다', () => {
  const vm = runVm(
    wrap('a = (z / z)\nb = ((z / z) * 1000)\nc = ((z / z) + 5)', 'var z = 0\nvar a = 0\nvar b = 0\nvar c = 0'),
  );
  vm.tick();
  assert.equal(String(vm.variables.find((v) => v.name === 'a')!.getValue()), 'NaN');
  assert.equal(valueOf(vm, 'b'), 0);
  assert.equal(valueOf(vm, 'c'), 5);
});

test('더하기는 숫자가 아닌 쪽이 있으면 이어 붙인다', () => {
  assert.equal(cast.calcPlus('가', '나'), '가나');
  assert.equal(cast.calcPlus('2', '3'), 5);
  assert.equal(cast.calcPlus('2', '가'), '2가');
});

test('같다 는 엄격 비교, 같지 않다 는 느슨한 비교다', () => {
  assert.equal(cast.cmpEqual('10', 10), true);
  assert.equal(cast.cmpEqual('가', '가'), true);
  assert.equal(cast.cmpNotEqual('10', 10), false);
  assert.equal(cast.cmpGreater('10', '9'), true);
});

test('나머지는 나누는 수의 부호를 따른다', () => {
  assert.equal(cast.mod(-1, 360), 359);
  assert.equal(cast.mod(370, 360), 10);
});

// ---------------------------------------------------------------------------
//  스케줄링 — 엔트리의 프레임 경계
// ---------------------------------------------------------------------------
test('반복은 한 바퀴마다 프레임을 넘긴다', () => {
  const vm = runVm(wrap('repeat 3:\n  count += 1\nend\ndone = 1', 'var count = 0\nvar done = 0'));
  vm.tick();
  assert.equal(valueOf(vm, 'count'), 1);
  assert.equal(valueOf(vm, 'done'), 0);
  vm.tick();
  assert.equal(valueOf(vm, 'count'), 2);
  vm.tick();
  assert.equal(valueOf(vm, 'count'), 3);
  // 마지막 바퀴 다음 프레임에 반복을 빠져나오고 그 프레임에서 뒤를 잇는다.
  vm.tick();
  assert.equal(valueOf(vm, 'count'), 3);
  assert.equal(valueOf(vm, 'done'), 1);
});

test('조건문은 프레임을 넘기지 않는다', () => {
  const vm = runVm(wrap('if 1 > 0:\n  a += 1\nend\na += 1', 'var a = 0'));
  vm.tick();
  assert.equal(valueOf(vm, 'a'), 2);
});

test('무한 반복은 프레임마다 한 바퀴씩 돈다', () => {
  const vm = runVm(wrap('forever:\n  a += 1\nend', 'var a = 0'));
  for (let i = 1; i <= 5; i += 1) {
    vm.tick();
    assert.equal(valueOf(vm, 'a'), i);
  }
});

test('continue 는 한 바퀴를 접고 다음 프레임으로 넘긴다', () => {
  const vm = runVm(wrap('repeat 3:\n  n += 1\n  continue\n  m += 1\nend\ndone = 1', 'var n = 0\nvar m = 0\nvar done = 0'));
  vm.tick();
  assert.equal(valueOf(vm, 'n'), 1);
  assert.equal(valueOf(vm, 'm'), 0);
  vm.tick();
  vm.tick();
  assert.equal(valueOf(vm, 'n'), 3);
  assert.equal(valueOf(vm, 'done'), 0);
  vm.tick();
  assert.equal(valueOf(vm, 'done'), 1);
});

test('skip 은 프레임을 넘기지 않고 바로 다음 바퀴로 간다', () => {
  const vm = runVm(wrap('repeat 3:\n  n += 1\n  skip\n  m += 1\nend\ndone = 1', 'var n = 0\nvar m = 0\nvar done = 0'));
  // 세 바퀴와 그 뒤 문장까지 한 프레임에 끝난다.
  vm.tick();
  assert.equal(valueOf(vm, 'n'), 3);
  assert.equal(valueOf(vm, 'm'), 0);
  assert.equal(valueOf(vm, 'done'), 1);
});

test('기다리기는 시간이 찰 때까지 붙잡는다', () => {
  const vm = runVm(wrap('wait 0.1\na = 1', 'var a = 0'));
  for (let i = 0; i < 5; i += 1) {
    vm.tick();
  }
  assert.equal(valueOf(vm, 'a'), 0);
  for (let i = 0; i < 3; i += 1) {
    vm.tick();
  }
  assert.equal(valueOf(vm, 'a'), 1);
});

test('반복 중단은 그 프레임 안에서 반복을 빠져나온다', () => {
  const vm = runVm(wrap('repeat 10:\n  a += 1\n  break\nend\nb = 1', 'var a = 0\nvar b = 0'));
  vm.tick();
  assert.equal(valueOf(vm, 'a'), 1);
  assert.equal(valueOf(vm, 'b'), 1);
});

test('함수 호출은 값을 돌려주고 지역 변수는 호출마다 새로 만든다', () => {
  const vm = runVm(
    'function 두배(n):\n  var t = 0\n  t = n + n\n  return t\nend\n\n' +
      wrap('a = 두배(21)\nb = 두배(1)', 'var a = 0\nvar b = 0'),
  );
  vm.tick();
  assert.equal(valueOf(vm, 'a'), 42);
  assert.equal(valueOf(vm, 'b'), 2);
});

test('함수 안에서 멈춰도 값 함수는 반환식을 계산한다', () => {
  const vm = runVm(
    'function 앞(a, b):\n  var t = 0\n  t = a\n  if (b == 1):\n    stop\n  end\n  t = 99\n  return t\nend\n\n' +
      wrap('a = 앞(7, 1)\nb = 앞(7, 0)', 'var a = 0\nvar b = 0'),
  );
  vm.tick();
  assert.equal(valueOf(vm, 'a'), 7);
  assert.equal(valueOf(vm, 'b'), 99);
});

test('값 함수가 멈춰도 호출한 쪽은 이어서 실행된다', () => {
  const vm = runVm(
    'function 앞():\n  stop\n  return 5\nend\n\n' +
      wrap('a = 앞()\nb = 1', 'var a = 0\nvar b = 0'),
  );
  vm.tick();
  assert.equal(valueOf(vm, 'a'), 5);
  assert.equal(valueOf(vm, 'b'), 1);
});

test('신호 보내기는 그 프레임이 끝난 뒤에 받는 쪽을 깨운다', () => {
  // `message_cast` 는 `setTimeout` 으로 신호를 올립니다. 보낸 블록 다음 블록이
  // 같은 프레임 안에서 도는 동안에는 받는 스크립트가 아직 없습니다.
  const vm = runVm(`
var a = 0
scene "sc":
  object "sender":
    when start do
      send "s"
      a += 1
    end
  end
  object "receiver":
    when signal "s" do
      a += 10
    end
  end
end`);
  vm.tick();
  assert.equal(valueOf(vm, 'a'), 1);
  vm.tick();
  assert.equal(valueOf(vm, 'a'), 11);
});

test('신호를 보낸 뒤 같은 장면을 다시 시작해도 받는 쪽은 살아남는다', () => {
  // 장면 시작하기는 그 장면의 스크립트를 모두 멈추지만, 아직 올라가지 않은
  // 신호까지 되돌리지는 못합니다 — 엔트리에서 3D 작품이 시작할 때 모델을
  // 쌓아 두는 방식이 이것입니다.
  const vm = runVm(`
var a = 0
scene "sc":
  object "sender":
    when start do
      send "s"
      jump "sc"
    end
  end
  object "receiver":
    when signal "s" do
      a += 1
      wait 0
      a += 10
    end
  end
end`);
  for (let i = 0; i < 6; i += 1) {
    vm.tick();
  }
  assert.equal(valueOf(vm, 'a'), 11);
});

test('신호 보내고 기다리기는 그 자리에서 받는 쪽을 깨운다', () => {
  // `message_cast_wait` 는 `raiseMessage` 를 바로 부르므로, 보낸 프레임 안에서
  // 이미 받는 스크립트가 서 있습니다.
  const vm = runVm(`
var a = 0
scene "sc":
  object "sender":
    when start do
      call "s"
      a += 100
    end
  end
  object "receiver":
    when signal "s" do
      a += 1
    end
  end
end`);
  vm.tick();
  assert.equal(valueOf(vm, 'a'), 1);
});

test('복제본은 자기 몫의 오브젝트 지역 변수를 가진다', () => {
  const vm = runVm(`
scene "s":
  object "o":
    var 목숨 = 3
    when start do
      clone
      목숨 = 1
    end
    when cloned do
      목숨 = 9
    end
  end
end`);
  vm.tick();
  vm.tick();
  const target = vm.targets[0]!;
  assert.equal(target.clones.length, 1);
  const shared = vm.variables.find((item) => item.name === '목숨')!;
  assert.equal(Number(shared.getValue()), 1);
  assert.equal(Number(target.clones[0]!.localVars?.[vm.variables.indexOf(shared)]?.getValue()), 9);
});

test('스스로 지우는 복제본들은 한 프레임에 모두 사라진다', () => {
  const vm = runVm(`var 지워 = 0

scene "s":
  object "o":
    when start do
      repeat 6:
        clone
      end
    end
    when cloned do
      forever:
        if (지워 == 1):
          del clone
        end
      end
    end
  end
end`);
  const target = vm.targets[0]!;
  for (let i = 0; i < 10; i += 1) {
    vm.tick();
  }
  assert.equal(target.clones.length, 6);

  // 지우는 복제본의 스레드를 그 자리에서 빼내면, 뒤에 있던 스레드가 앞으로
  // 당겨지면서 그 프레임을 건너뛴다 — 그러면 한 프레임에 절반씩만 사라진다.
  vm.variables.find((item) => item.name === '지워')!.setValue(1);
  vm.tick();
  assert.equal(target.clones.length, 0);
});

test("'stop other' 로 앞선 스크립트가 멈춰도 뒤의 복제본은 그 프레임을 돈다", () => {
  // 스레드 차례는 [본체1, 본체2, 복제본] 이다. 본체2 가 본체1 을 그 자리에서
  // 빼내면 복제본이 한 칸 앞으로 당겨져 그 프레임을 통째로 건너뛴다.
  const vm = runVm(`var 돎 = 0

scene "s":
  object "o":
    when start do
      forever:
        wait 0.001
      end
    end
    when start do
      clone
      forever:
        stop other
      end
    end
    when cloned do
      forever:
        돎 += 1
      end
    end
  end
end`);
  // 복제본은 'stop other' 와 같은 프레임에 생겨나 그 프레임부터 돈다.
  vm.tick();
  assert.equal(valueOf(vm, '돎'), 1);
  vm.tick();
  assert.equal(valueOf(vm, '돎'), 2);
});

// ---------------------------------------------------------------------------
//  글상자
// ---------------------------------------------------------------------------
test('글자 효과 블록은 엔트리가 쓰는 이름 그대로 걸린다', () => {
  const vm = runVm(`scene "s":
  text "t":
    text_content = "가나다"
    when start do
      text_bold = true
      text_italic = true
      text_underline = true
      text_strikethrough = true
    end
  end
end`);
  vm.tick();
  const entity = vm.targets[0]!.entity;
  assert.equal(entity.fontBold, true);
  assert.equal(entity.fontItalic, true);
  assert.equal(entity.underLine, true);
  assert.equal(entity.strike, true);
});

test('글자 효과 끄기도 걸린다', () => {
  const vm = runVm(`scene "s":
  text "t":
    text_content = "가나다"
    text_bold = true
    when start do
      text_bold = false
    end
  end
end`);
  vm.tick();
  assert.equal(vm.targets[0]!.entity.fontBold, false);
});

/**
 * `var x = 2 from 0 to 4` 는 엔트리의 슬라이드 변수입니다. 상자에 슬라이더가 붙고,
 * 값은 두 끝 사이로 붙잡힙니다.
 */
test('범위를 준 변수는 슬라이드 변수가 되고 값이 그 사이에 머문다', () => {
  const vm = runVm(wrap('a = depth', 'var depth = 2 from 0 to 4\nvar a = 0'));
  const depth = vm.variables.find((item) => item.name === 'depth')!;
  assert.equal(depth.kind, 'slide');
  assert.equal(depth.minValue, 0);
  assert.equal(depth.maxValue, 4);
  depth.setValue(9);
  assert.equal(depth.getValue(), 4);
  depth.setValue(-3);
  assert.equal(depth.getValue(), 0);
  depth.setValue(3);
  vm.tick();
  assert.equal(valueOf(vm, 'a'), 3);
});

test('범위가 없는 변수는 그대로 보통 변수다', () => {
  const vm = runVm(wrap('a = 0', 'var depth = 2\nvar a = 0'));
  const depth = vm.variables.find((item) => item.name === 'depth')!;
  assert.equal(depth.kind, 'variable');
  depth.setValue(9);
  assert.equal(depth.getValue(), 9);
});

test('붓과 채우기 층은 작품이 먼저 집어 든 순서대로 쌓인다', () => {
  // 엔트리는 붓·채우기를 처음 쓰는 순간에 그 도형을 만들어 오브젝트 바로 아래에
  // 끼우므로, 나중에 집어 든 쪽이 앞에 옵니다. 판을 먼저 긋고 돌을 채우는 작품은
  // 이 순서가 뒤집히면 돌이 판 밑으로 들어가 사라집니다.
  const first = runVm(wrap('start draw\nstart fill'));
  first.tick();
  const one = first.targets[0]!.entity;
  assert.ok(one.brush && one.paint, '두 펜이 모두 생겼다');
  assert.ok(one.brush!.started < one.paint!.started, '붓이 먼저, 채우기가 나중이다');

  const second = runVm(wrap('start fill\nstart draw'));
  second.tick();
  const two = second.targets[0]!.entity;
  assert.ok(two.paint!.started < two.brush!.started, '반대로 쓰면 반대로 쌓인다');
});

test('붓은 점마다가 아니라 프레임마다 한 번만 다시 그린다', () => {
  // 붓이 점 하나마다 자기 획을 통째로 다시 그리면 한 프레임이 점 개수의 제곱만큼
  // 든다 — 한 프레임에 점 수천 개를 찍는 작품이 몇 초마다 끊기던 자리다. PixiRenderer
  // 는 화면 없이 만들 수 없으므로 그 약속을 소스에서 지킨다.
  const source = fs.readFileSync(
    path.join(root, 'packages/tessvm/src/render/renderer.ts'),
    'utf-8',
  );
  const penChanged = source.slice(source.indexOf('  penChanged(entity: Entity): void {'));
  const body = penChanged.slice(0, penChanged.indexOf('\n  }'));
  assert.match(body, /this\.penDirty\.add\(entity\);/, 'penChanged 는 표시만 한다');
  assert.doesNotMatch(body, /drawPenGroup|penGroup\(/, 'penChanged 에서 다시 그리지 않는다');

  const flush = source.slice(source.indexOf('  flush(): void {'));
  assert.match(
    flush.slice(0, flush.indexOf('\n  }')),
    /for \(const entity of this\.penDirty\)[\s\S]*this\.redrawPen\(entity\)/,
    'flush 가 프레임마다 한 번 몰아서 그린다',
  );

  // 층을 만드는 순서가 곧 쌓이는 순서다 — 고정된 차례로 돌면 안 된다.
  const redraw = source.slice(source.indexOf('  private redrawPen(entity: Entity): void {'));
  assert.match(
    redraw.slice(0, redraw.indexOf('\n  }')),
    /for \(const which of penOrderOf\(entity\)\)/,
    'redrawPen 은 먼저 집어 든 펜부터 돈다',
  );
});

test('도장은 모양의 제 크기로 찍힌다 — 텍스처가 구워진 크기가 아니라', () => {
  // 벡터 모양은 자기 크기보다 촘촘하게 구워지므로, 텍스처 한 픽셀이 무대에서
  // 얼마인지를 곱해야 작품이 그리는 크기가 나온다. 오브젝트 배율로 덮어써 버리면
  // 구운 배율만큼 어긋난다. PixiRenderer 는 화면 없이 만들 수 없으므로 소스에서 본다.
  const source = fs.readFileSync(
    path.join(root, 'packages/tessvm/src/render/renderer.ts'),
    'utf-8',
  );
  const stamp = source.slice(source.indexOf('  stamp(entity: Entity): void {'));
  const body = stamp.slice(0, stamp.indexOf('\n  }'));
  assert.match(body, /perPixelX \* mark\.scaleX/, '도장은 두 배율을 곱한다');
  assert.doesNotMatch(body, /scale\.set\(mark\.scaleX/, '오브젝트 배율만으로 덮어쓰지 않는다');
});

test('변수 상자는 자리를 정하지 않았어도 무대 안에 놓인다', () => {
  // `generateView` 는 값 상자와 리스트 상자를 따로 세어 한 줄에 11개씩 쌓는다.
  // 전체 개수로 세면 뒤쪽 상자가 무대 아래로 밀려나 보이지 않는다.
  const source = fs.readFileSync(
    path.join(root, 'packages/tessvm/src/render/overlay.ts'),
    'utf-8',
  );
  const home = source.slice(source.indexOf('  private homeOf(variable: Variable)'));
  const body = home.slice(0, home.indexOf('\n  }'));
  assert.match(body, /family\.indexOf\(variable\)/, '자기 종류 안에서의 자리로 센다');
  assert.match(body, /index \* 24 \+ 20 - 135/, '엔트리와 같은 간격으로 쌓는다');
});

// ---------------------------------------------------------------------------
//  JIT 컴파일 결과
// ---------------------------------------------------------------------------
test('리터럴 연산은 컴파일할 때 접어 둔다', () => {
  const result = compileProject(wrap('forward 10'), { path: 'test.tess' });
  const vm = new Vm({ renderer: null, audio: null });
  vm.load(result.project as unknown as never);
  const source = vm.compiledSource(result.project as unknown as never);
  assert.match(source, /O\.moveDirection\(e, 10\)/);
});

test('모르는 블록은 실행을 멈추지 않고 보고만 한다', () => {
  const project = {
    objects: [
      {
        id: 'obj1',
        name: 'o',
        objectType: 'sprite',
        scene: 'sc1',
        rotateMethod: 'free',
        sprite: { pictures: [], sounds: [] },
        entity: { x: 0, y: 0, scaleX: 1, scaleY: 1, width: 10, height: 10, visible: true },
        script: JSON.stringify([
          [
            { id: 'h', type: 'when_run_button_click', params: [null], statements: [] },
            { id: 'x', type: 'get_cur_weather', params: [], statements: [] },
          ],
        ]),
      },
    ],
    scenes: [{ id: 'sc1', name: 's' }],
    variables: [],
    messages: [],
    functions: [],
  };
  const vm = new Vm({ renderer: null, audio: null });
  vm.load(project as unknown as never);
  vm.start();
  vm.tick();
  assert.equal(vm.errors.length, 0);
  assert.ok(vm.unknownBlocks.has('get_cur_weather'));
});

/** A one-object project made straight from entry blocks, with no Tess in between. */
function rawProject(blocks: unknown[], variables: unknown[] = []) {
  return {
    objects: [
      {
        id: 'obj1',
        name: 'o',
        objectType: 'sprite',
        scene: 'sc1',
        rotateMethod: 'free',
        sprite: { pictures: [], sounds: [] },
        entity: { x: 0, y: 0, scaleX: 1, scaleY: 1, width: 10, height: 10, visible: true },
        script: JSON.stringify([
          [{ id: 'h', type: 'when_run_button_click', params: [null], statements: [] }, ...blocks],
        ]),
      },
    ],
    scenes: [{ id: 'sc1', name: 's' }],
    variables,
    messages: [],
    functions: [],
  };
}

const setVar = (id: string, value: unknown) => ({
  id: 's' + id,
  type: 'set_variable',
  params: [id, value, null],
  statements: [],
});
const bool = (value: boolean) => ({ type: value ? 'True' : 'False', params: [], statements: [] });

test('팔레트에서 내려간 boolean_and · boolean_or 도 엔트리처럼 읽는다', () => {
  const variables = [
    { id: 'v1', name: 'and', variableType: 'variable', value: 0, array: [] },
    { id: 'v2', name: 'or', variableType: 'variable', value: 0, array: [] },
  ];
  const project = rawProject(
    [
      setVar('v1', { type: 'boolean_and', params: [bool(true), null, bool(false)], statements: [] }),
      setVar('v2', { type: 'boolean_or', params: [bool(true), null, bool(false)], statements: [] }),
    ],
    variables,
  );
  const vm = new Vm({ renderer: null, audio: null });
  vm.load(project as unknown as never);
  vm.start();
  vm.tick();
  assert.equal(vm.unknownBlocks.size, 0);
  assert.equal(String(vm.variables.find((v) => v.name === 'and')!.value), 'false');
  assert.equal(String(vm.variables.find((v) => v.name === 'or')!.value), 'true');
});

test('색 고르개 블록은 고른 색을 값으로 돌려준다', () => {
  const project = rawProject([
    { id: 'c', type: 'text_change_font_color', params: [{ type: 'text_color', params: ['#ffaa00'], statements: [] }, null], statements: [] },
    { id: 'p', type: 'set_color', params: [{ type: 'color', params: ['#dede00'], statements: [] }, null], statements: [] },
  ]);
  const vm = new Vm({ renderer: null, audio: null });
  vm.load(project as unknown as never);
  const source = vm.compiledSource(project as unknown as never);
  assert.equal(vm.unknownBlocks.size, 0);
  assert.match(source, /O\.textColor\(e, "#ffaa00"\)/);
  assert.match(source, /O\.setPenColor\(e, "#dede00"\)/);
});

test('프레임 안에서 난 예외는 실행을 멈추고 알린다 — 화면만 멈추지 않는다', () => {
  const result = compileProject(wrap('forward 10'), { path: 'test.tess' });
  assert.ok(result.project);
  const reported: string[] = [];
  const renderer = {
    attach() {}, addEntity() {}, removeEntity() {}, setScene() {}, syncDialog() {}, eraseAll() {},
    flush() { throw new Error('webgl 컨텍스트를 잃었습니다'); },
  };
  const vm = new Vm({ renderer: renderer as never, audio: null });
  vm.load(result.project as unknown as never);
  vm.onError = (error) => reported.push(error.message);
  vm.start();
  vm.advance(16);
  vm.advance(32);
  assert.equal(vm.state, 'stop');
  // Reported once: the run ends rather than throwing again every frame.
  assert.deepEqual(reported, ['webgl 컨텍스트를 잃었습니다']);
  assert.equal(vm.errors.length, 1);
});

test('글상자·벡터 모양의 텍스처는 webgl 상한(4096px)을 넘지 않는다', () => {
  // Full screen on a retina display asks for far more than a texture can hold.
  const full = 8;
  const wide = textSharpness(full, 4, 900);
  assert.ok(wide * 900 <= 4096, `글상자 텍스처가 ${wide * 900}px 입니다`);

  const big = svgSharpness(full, 1600, 1200);
  assert.ok(big * 1600 <= 4096, `벡터 텍스처가 ${big * 1600}px 입니다`);
  assert.ok(big * 1600 * (big * 1200) <= 2048 * 2048 + 1, '벡터 텍스처의 넓이 상한');
});

// ---------------------------------------------------------------------------
//  색
// ---------------------------------------------------------------------------
test('읽을 수 없는 색은 엔트리와 같이 검정으로 떨어진다 (오류가 아니다)', () => {
  // `Entry.hex2rgb` — # 을 붙이고, 세 자리는 늘리고, 그 밖은 전부 #000000.
  assert.equal(cast.hexColor('#ff8000'), '#ff8000');
  assert.equal(cast.hexColor('ff8000'), '#ff8000');
  assert.equal(cast.hexColor('#f80'), '#ff8800');
  assert.equal(cast.hexColor('#검정'), '#000000');
  assert.equal(cast.hexColor('#dfdfe'), '#000000');
  assert.equal(cast.hexColor('#ffffff100'), '#000000');
  assert.equal(cast.hexColor(''), '#000000');
  assert.equal(cast.hexColor(undefined), '#000000');
  assert.deepEqual(cast.hexToRgb('#ff8000'), { r: 255, g: 128, b: 0 });
  assert.deepEqual(cast.hexToRgb('#검정'), { r: 0, g: 0, b: 0 });
});

test('읽을 수 없는 색을 붓·글상자에 넣어도 작품이 멈추지 않는다', () => {
  const vm = runVm(`scene "s":
  text "판":
    text_content = "x"
    when start do
      font_color = join("#", "검정")
      bg_color = join("#", "dfdfe")
    end
  end
  object "붓":
    when start do
      draw_color = join("#", "검정")
      fill_color = join("#", "dfdfe")
    end
  end
end`);
  for (let i = 0; i < 5; i += 1) vm.tick();
  assert.deepEqual(vm.errors, []);
  assert.equal(vm.state, 'run');

  const brush = vm.targets.find((target) => target.name === '붓')!.entity;
  // 붓은 엔트리와 같이 hex2rgb 를 거친 값을 들고 있다.
  assert.equal(brush.brush?.color, '#000000');
  assert.equal(brush.paint?.color, '#000000');
  // 글상자는 엔트리와 같이 적힌 그대로 들고 있고, 거르는 것은 그리는 쪽이다.
  const board = vm.targets.find((target) => target.name === '판')!.entity;
  assert.equal(board.colour, '#검정');
});

// ---------------------------------------------------------------------------
//  공유 · 실시간 변수
// ---------------------------------------------------------------------------
const SHARED_SOURCE = `shared list 명예 = []
realtime list 실시간 = []
list 보통 = []
shared var 최고 = 0
realtime var 접속 = 0

scene "s":
  object "o":
    when start do
      in 명예 add 1
      in 실시간 add 2
      in 보통 add 3
      최고 = 7
      접속 = 8
    end
  end
end`;

/** 저장소를 흉내 낸다 — 실제 실행기는 브라우저의 localStorage 를 쓴다. */
function fakeStore() {
  const box = new Map<string, unknown>();
  return {
    box,
    read: (key: string) => box.get(key) as never,
    write: (key: string, value: unknown) => box.set(key, JSON.parse(JSON.stringify(value))),
  };
}

function loadShared(store: ReturnType<typeof fakeStore>): Vm {
  const result = compileProject(SHARED_SOURCE, { path: 'shared.tess' });
  assert.ok(result.project, result.errors[0]?.message ?? '컴파일 실패');
  const vm = new Vm({ renderer: null, audio: null, store });
  vm.load(result.project as unknown as never);
  return vm;
}

const listOf = (vm: Vm, name: string) =>
  vm.variables.find((item) => item.name === name)!.array.map((item) => item.data);

test('공유 · 실시간 리스트와 변수는 다시 시작해도 값을 잃지 않는다', () => {
  const store = fakeStore();
  const vm = loadShared(store);
  vm.start();
  for (let i = 0; i < 10; i += 1) vm.tick(16);
  vm.stop();

  assert.deepEqual(listOf(vm, '명예'), ['1']);
  assert.deepEqual(listOf(vm, '보통'), ['3']);

  // 두 번째 실행: 공유·실시간은 그대로 이어지고, 보통 리스트만 선언값으로 돌아간다.
  vm.start();
  for (let i = 0; i < 10; i += 1) vm.tick(16);
  vm.stop();
  assert.deepEqual(listOf(vm, '명예'), ['1', '1']);
  assert.deepEqual(listOf(vm, '실시간'), ['2', '2']);
  assert.deepEqual(listOf(vm, '보통'), ['3']);
  assert.equal(valueOf(vm, '최고'), 7);
});

test('공유 · 실시간 변수만 저장소에 남고, 다시 불러오면 그 값으로 시작한다', () => {
  const store = fakeStore();
  const first = loadShared(store);
  first.start();
  for (let i = 0; i < 10; i += 1) first.tick(16);
  first.stop();

  const stored = new Set(store.box.keys());
  const idOf = (name: string) => first.variables.find((item) => item.name === name)!.id;
  assert.ok(stored.has(idOf('명예')), '공유 리스트는 저장된다');
  assert.ok(stored.has(idOf('실시간')), '실시간 리스트는 저장된다');
  assert.ok(stored.has(idOf('최고')), '공유 변수는 저장된다');
  assert.ok(!stored.has(idOf('보통')), '보통 리스트는 저장하지 않는다');

  // 새 실행기가 같은 저장소를 읽으면 지난 실행이 남긴 값에서 이어진다.
  const second = loadShared(store);
  assert.deepEqual(listOf(second, '명예'), ['1']);
  assert.deepEqual(listOf(second, '보통'), []);
  assert.equal(valueOf(second, '최고'), 7);
});

test('저장소가 없어도 공유 · 실시간 값은 실행기가 살아 있는 동안 이어진다', () => {
  const result = compileProject(SHARED_SOURCE, { path: 'shared.tess' });
  const vm = new Vm({ renderer: null, audio: null });
  vm.load(result.project as unknown as never);
  vm.start();
  for (let i = 0; i < 10; i += 1) vm.tick(16);
  vm.stop();
  vm.start();
  for (let i = 0; i < 10; i += 1) vm.tick(16);
  assert.deepEqual(listOf(vm, '명예'), ['1', '1']);
  assert.deepEqual(listOf(vm, '보통'), ['3']);
});

test('벡터가 많은 작품은 텍스처 예산에 맞춰 함께 낮춰 굽는다', () => {
  // 한두 장은 예산에 닿지 않으니 화면이 요구하는 그대로 굽는다.
  const one = svgSharpness(3, 960, 540);
  assert.equal(svgBudgetScale(960 * 540 * one * one), 1);
  assert.equal(svgSharpness(3, 960, 540, 1), one);

  // 무대 전체 크기의 벡터 백 장은 예산을 훌쩍 넘으므로 배율을 함께 내린다.
  const many = 100 * 960 * 540 * one * one;
  const budget = svgBudgetScale(many);
  assert.ok(budget < 1, `예산 배율이 ${budget} 입니다`);
  assert.ok(svgSharpness(3, 960, 540, budget) < one);

  // 예산을 몇 번 조여도 1배 아래로는 내려가지 않는다 — 그 아래는 옆의 래스터와 같다.
  assert.equal(svgSharpness(3, 960, 540, 0.001), 1);

  // 예산 안에서 실제로 차지하는 크기가 예산 언저리로 내려온다.
  let scale = 1;
  for (let pass = 0; pass < 8; pass += 1) {
    const sharp = svgSharpness(3, 960, 540, scale);
    const pixels = 100 * 960 * 540 * sharp * sharp;
    const tighter = svgBudgetScale(pixels);
    if (tighter === 1) break;
    scale *= tighter;
  }
  const settled = svgSharpness(3, 960, 540, scale);
  assert.ok(
    100 * 960 * 540 * settled * settled <= SVG_PIXEL_BUDGET * 1.2,
    '예산을 크게 넘지 않는다',
  );
});

test('화질은 화면이 요구하는 만큼 따라 올라가고, 하한 아래로는 내려가지 않는다', () => {
  // 4/3 (stage) × 1 (resolution): a plain window at the default size.
  assert.equal(textSharpness(4 / 3, 1, 100), 2, '작게 그려도 하한 2배');
  assert.equal(svgSharpness(4 / 3, 100, 100), 2);
  // A retina window, then the same text box scaled to twice its size.
  assert.equal(textSharpness(3, 1, 100), 3);
  assert.equal(textSharpness(3, 2, 100), 6);
  // The vector cap is lower: a work holds far more costumes than text boxes.
  assert.equal(svgSharpness(6, 100, 100), 4);
  assert.equal(textSharpness(6, 1, 100), 6);
});

/**
 * `함수 정의하기` is a hat block: playentry's own project data (and entry's
 * runner) keep the body as the rest of the define block's stack, while saving a
 * work to `.ent` nests that same body in the block's statement slot. Both have
 * to run, or every function on a work loaded from playentry is an empty shell.
 */
function functionProject(content: unknown[][]) {
  return {
    objects: [
      {
        id: 'obj1', name: 'o', objectType: 'sprite', scene: 'sc1', rotateMethod: 'free',
        sprite: { pictures: [], sounds: [] },
        entity: { x: 0, y: 0, scaleX: 1, scaleY: 1, width: 10, height: 10, visible: true },
        script: JSON.stringify([[
          { id: 'h', type: 'when_run_button_click', params: [null], statements: [] },
          { id: 'c', type: 'func_fn1', params: [null], statements: [] },
        ]]),
      },
    ],
    scenes: [{ id: 'sc1', name: 's' }],
    variables: [{ id: 'v1', name: '지은것', variableType: 'variable', value: 0, array: [] }],
    messages: [],
    functions: [{ id: 'fn1', content: JSON.stringify(content) }],
  };
}

const defineHat = {
  id: 'd', type: 'function_create',
  params: [{ id: 'l', type: 'function_field_label', params: ['짓기', null] }, null],
};
const bodyBlock = {
  id: 'b', type: 'set_variable',
  params: ['v1', { id: 'n', type: 'text', params: ['42'] }, null],
};

test('함수 본문은 정의 블록 다음에 이어 붙은 것도 읽는다 (playentry 작품 형태)', () => {
  // The shape playentry hands over: the body is the rest of the define's stack.
  const vm = new Vm({ renderer: null, audio: null });
  vm.load(functionProject([[defineHat, bodyBlock]]) as unknown as never);
  vm.start();
  vm.tick();
  assert.equal(vm.unknownBlocks.size, 0);
  assert.equal(String(vm.variables.find((v) => v.name === '지은것')!.value), '42');
});

test('함수 본문은 정의 블록 안에 든 것도 읽는다 (.ent 로 저장한 형태)', () => {
  const nested = { ...defineHat, statements: [[bodyBlock]] };
  const vm = new Vm({ renderer: null, audio: null });
  vm.load(functionProject([[nested]]) as unknown as never);
  vm.start();
  vm.tick();
  assert.equal(String(vm.variables.find((v) => v.name === '지은것')!.value), '42');
});

// ---------------------------------------------------------------------------
//  충돌 판정
// ---------------------------------------------------------------------------
/** A square of solid pixels, as one costume's alpha mask. */
function squareMask(size: number) {
  const pixels = new Uint8Array(size * size * 4);
  for (let i = 3; i < pixels.length; i += 4) {
    pixels[i] = 255;
  }
  return maskFromPixels(pixels, size, size);
}

/** A mask whose left half is opaque and right half fully transparent. */
function halfMask(size: number) {
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      pixels[(y * size + x) * 4 + 3] = x < size / 2 ? 255 : 0;
    }
  }
  return maskFromPixels(pixels, size, size);
}

function collisionVm(maskFor: (id: string) => ReturnType<typeof squareMask>) {
  const source = `
scene "s":
  object "a":
    costume 기본 "a.png" size 20 20
    x = 0
    y = 0
  end
  object "b":
    costume 기본 "b.png" size 20 20
    x = 0
    y = 0
  end
end`;
  const result = compileProject(source, { path: 'test.tess' });
  assert.ok(result.project, result.errors[0]?.message ?? '컴파일 실패');
  const vm = new Vm({ renderer: null, audio: null });
  vm.load(result.project as unknown as never);
  const masks = new MaskStore(() => null);
  for (const target of vm.targets) {
    for (const picture of target.pictures) {
      masks.put(picture.id, maskFor(picture.id));
    }
  }
  return { vm, collision: new CollisionSystem(masks) };
}

test('겹치는 사각형은 닿은 것으로, 떨어지면 아닌 것으로 본다', () => {
  const { vm, collision } = collisionVm(() => squareMask(20));
  const [a, b] = vm.targets.map((target) => target.entity);
  collision.beginFrame();
  assert.equal(collision.touchingEntity(a!, b!, 0.2), true);
  b!.setX(100);
  collision.beginFrame();
  assert.equal(collision.touchingEntity(a!, b!, 0.2), false);
});

test('투명한 부분만 겹치면 닿지 않은 것이다', () => {
  const { vm, collision } = collisionVm(() => halfMask(20));
  const [a, b] = vm.targets.map((target) => target.entity);
  // a 의 불투명한 왼쪽 절반과 b 의 투명한 오른쪽 절반이 겹치도록 민다.
  a!.setX(0);
  b!.setX(-10);
  collision.beginFrame();
  assert.equal(collision.touchingEntity(a!, b!, 0.2), false);
  // 반대로 밀면 불투명한 부분끼리 겹친다.
  b!.setX(2);
  collision.beginFrame();
  assert.equal(collision.touchingEntity(a!, b!, 0.2), true);
});

test('무대 밖으로 나가면 벽에 닿는다', () => {
  const { vm, collision } = collisionVm(() => squareMask(20));
  const a = vm.targets[0]!.entity;
  collision.beginFrame();
  assert.equal(collision.touchingWall(a, 'wall', 0.2), false);
  a.setX(238);
  collision.beginFrame();
  assert.equal(collision.touchingWall(a, 'wall_right', 0.2), true);
  assert.equal(collision.touchingWall(a, 'wall_left', 0.2), false);
});

test('경계 상자는 무대 픽셀 좌표로 나온다', () => {
  const { vm } = collisionVm(() => squareMask(20));
  const a = vm.targets[0]!.entity;
  const box = { x: 0, y: 0, width: 0, height: 0 };
  entityBounds(a, box);
  // 20×20 그림이 4/3 배로 그려지므로 무대 좌표에서 가운데 26.67px 사각형이다.
  assert.ok(Math.abs(box.width - (20 * 4) / 3) < 1e-6);
  assert.ok(Math.abs(box.x - (stage.worldWidth / 2 - (20 * 4) / 3 / 2)) < 1e-6);
});

test('무대 크기를 바꾸면 벽과 좌표계가 같이 움직인다', () => {
  const { vm, collision } = collisionVm(() => squareMask(20));
  const a = vm.targets[0]!.entity;
  a.setX(238);
  collision.beginFrame();
  assert.equal(collision.touchingWall(a, 'wall_right', 0.2), true);
  try {
    setStageSize(960, 540);
    collision.beginFrame();
    // 무대가 넓어졌으니 같은 자리는 이제 벽에서 멀다.
    assert.equal(collision.touchingWall(a, 'wall_right', 0.2), false);
    a.setX(478);
    collision.beginFrame();
    assert.equal(collision.touchingWall(a, 'wall_right', 0.2), true);
  } finally {
    setStageSize(480, 270);
  }
});

test('작품이 정한 speed 가 곧 프레임 속도다', () => {
  const result = compileProject('project:\n  fps 29\nend\n\n' + wrap('a = 1', 'var a = 0'), {
    path: 'test.tess',
  });
  assert.ok(result.project);
  const vm = new Vm({ renderer: null, audio: null });
  vm.load(result.project as unknown as never);
  assert.equal(vm.frameRate, 29);

  const override = new Vm({ renderer: null, audio: null, fps: 120 });
  override.load(result.project as unknown as never);
  assert.equal(override.frameRate, 120);
});

test('초시계는 시작하기 전까지 0 이고, 멈춘 채 초기화하면 꺼진다', () => {
  const vm = runVm(wrap('wait 0.1'));
  // 엔트리의 `resetTimer` 는 한 번도 시작하지 않은 초시계에는 아무 일도 안 한다.
  vm.resetTimer();
  for (let i = 0; i < 10; i += 1) {
    vm.tick();
  }
  assert.equal(vm.timerValue(), 0);

  vm.startTimer();
  for (let i = 0; i < 30; i += 1) {
    vm.tick();
  }
  assert.ok(Math.abs(vm.timerValue() - 30 / vm.frameRate) < 1e-6);

  // 멈춘 뒤에는 시간이 흐르지 않는다.
  vm.pauseTimer();
  const held = vm.timerValue();
  for (let i = 0; i < 30; i += 1) {
    vm.tick();
  }
  assert.equal(vm.timerValue(), held);

  // 멈춘 채로 초기화하면 '한 번도 시작하지 않은' 상태로 돌아간다.
  vm.resetTimer();
  vm.tick();
  assert.equal(vm.timerValue(), 0);
  vm.resetTimer();
  for (let i = 0; i < 10; i += 1) {
    vm.tick();
  }
  assert.equal(vm.timerValue(), 0);
});

test('돌고 있는 초시계를 초기화하면 0 부터 다시 센다', () => {
  const vm = runVm(wrap('wait 10'));
  vm.startTimer();
  for (let i = 0; i < 30; i += 1) {
    vm.tick();
  }
  vm.resetTimer();
  for (let i = 0; i < 15; i += 1) {
    vm.tick();
  }
  assert.ok(Math.abs(vm.timerValue() - 15 / vm.frameRate) < 1e-6);
});

// ---------------------------------------------------------------------------
//  붓
// ---------------------------------------------------------------------------
test('붓의 투명도는 선과 채우기에 함께 걸린다', () => {
  const vm = runVm(wrap([
    'draw_alpha = 70',
    'go -50 0',
    'start draw',
    'go 50 0',
    'stop draw',
    'start fill',
    'go 50 30',
    'go -50 30',
    'stop fill',
  ].join('\n')));
  vm.tick();

  const entity = vm.targets[0]!.entity;
  assert.equal(entity.brush!.opacity, 70);
  assert.equal(entity.paint!.opacity, 70);
  assert.ok(entity.brush!.strokes.some((stroke) => stroke.opacity === 70 && !stroke.fill));
  assert.ok(entity.paint!.strokes.some((stroke) => stroke.opacity === 70 && stroke.fill));
});

test('붓의 투명도 바꾸기도 선과 채우기를 함께 옮긴다', () => {
  const vm = runVm(wrap('draw_alpha = 20\ndraw_alpha += 30'));
  vm.tick();

  const entity = vm.targets[0]!.entity;
  assert.equal(entity.brush!.opacity, 50);
  assert.equal(entity.paint!.opacity, 50);
});

test('글상자 크기는 글을 쓰는 그 순간 다시 재어진다', () => {
  const result = compileProject(
    `scene "s":
  text "t":
    text_content = "짧게"
    when start do
      write "아주 아주 긴 글자입니다"
    end
  end
end`,
    { path: 'test.tess' },
  );
  assert.ok(result.project, result.errors[0]?.message ?? '컴파일 실패');
  const vm = new Vm({ renderer: null, audio: null });
  // 재는 일은 렌더러가 하지만, VM 은 프레임을 넘기지 않고 그 자리에서 물어본다.
  const measured: string[] = [];
  vm.renderer = {
    addEntity() {},
    removeEntity() {},
    flush() {},
    measureTextBox(entity) {
      measured.push(entity.text);
      return { width: entity.text.length * 10, height: 22 };
    },
  };
  vm.load(result.project as unknown as never);
  vm.start();
  vm.tick();
  const entity = vm.targets[0]!.entity;
  assert.equal(entity.text, '아주 아주 긴 글자입니다');
  assert.equal(entity.width, '아주 아주 긴 글자입니다'.length * 10);
  assert.ok(measured.includes('아주 아주 긴 글자입니다'));
});

test('글꼴 문자열은 굵기·기울임·소수점 크기를 모두 읽는다', () => {
  assert.deepEqual(parseFont('20px DungGeunMo'), {
    size: 20,
    family: 'DungGeunMo',
    bold: false,
    italic: false,
  });
  assert.deepEqual(parseFont('bold 16.5441px Nanum Gothic'), {
    size: 16.5441,
    family: 'Nanum Gothic',
    bold: true,
    italic: false,
  });
  assert.deepEqual(parseFont('bold italic 12px Nanum Pen Script'), {
    size: 12,
    family: 'Nanum Pen Script',
    bold: true,
    italic: true,
  });
});

/**
 * 글꼴 크기가 비어 저장된 글상자에는 `"NaNpx …"` 가 남는다. 엔트리는 그 크기를
 * NaN 그대로 들고 있고, 캔버스는 그런 선언을 통째로 거절한 뒤 자기 기본 글꼴로
 * 그린다(그래서 엔트리가 재어 둔 높이가 10 이다). 20px 로 읽으면 글자가 두 배가 된다.
 */
test('읽을 수 없는 글꼴 크기는 캔버스 기본 글꼴이 된다', () => {
  assert.deepEqual(parseFont('NaNpx Nanum Gothic'), {
    size: 10,
    family: 'sans-serif',
    bold: false,
    italic: false,
  });
  // 굵기·기울임도 같은 선언 안에 있으므로 함께 버려진다.
  assert.deepEqual(parseFont('bold italic NaNpx D2 Coding'), {
    size: 10,
    family: 'sans-serif',
    bold: false,
    italic: false,
  });
  // 글꼴이 아예 없는 것은 다른 이야기다 — 엔트리의 기본값을 그대로 쓴다.
  assert.deepEqual(parseFont(''), {
    size: 20,
    family: 'Nanum Gothic',
    bold: false,
    italic: false,
  });
});

// ---------------------------------------------------------------------------
//  예제 작품
// ---------------------------------------------------------------------------
/**
 * deltarune 의 초상화 애니메이션이 이 값에 걸려 있었다 — 소수 자릿수를 글자로
 * 읽어 쓰는 작품에서 0.1 과 0.09999999999999787 은 완전히 다른 결과가 된다.
 * 엔트리의 빼기는 BigNumber 라 정확히 0.1 이고, 나머지 블록은 그렇지 않다.
 */
test('소수 부분은 빼기로 구하면 10진으로 딱 떨어진다', () => {
  const vm = runVm(
    wrap(`
      정확한 = (abs(49.1) - floor(abs(49.1)))
      나머지로 = (abs(49.1) % 1)
    `, 'var 정확한 = 0\nvar 나머지로 = 0'),
  );
  vm.tick();
  const value = (name: string) => String(vm.variables.find((item) => item.name === name)!.getValue());
  assert.equal(value('정확한'), '0.1');
  /** 나머지 블록은 엔트리와 똑같이 2진 부동소수 그대로다 (`l - r * floor(l / r)`). */
  assert.equal(value('나머지로'), String(49.1 - 1 * Math.floor(49.1 / 1)));
});

test('예제 작품이 오류 없이 돌아간다', () => {
  for (const file of ['examples/tour.tess', 'examples/all_blocks.tess', 'examples/cat_run.tess']) {
    const source = readIfExists(file);
    if (!source) {
      continue;
    }
    const result = compileProject(source, { path: file, assetDirs: ['examples'] });
    assert.ok(result.project, `${file} 컴파일 실패`);
    const vm = new Vm({ renderer: null, audio: null });
    vm.load(result.project as unknown as EntryProject as never);
    vm.start();
    for (let i = 0; i < 300; i += 1) {
      vm.tick();
    }
    assert.equal(vm.errors.length, 0, `${file}: ${vm.errors[0]?.message ?? ''}`);
  }
});

function readIfExists(file: string): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('node:fs').readFileSync(file, 'utf-8') as string;
  } catch {
    return null;
  }
}

test('모양은 아이디·이름 다음에 1부터 세는 번호로 찾는다', () => {
  const source = `
scene "s":
  object "o":
    costume 첫번째 "a.png" size 10 10
    costume 두번째 "b.png" size 10 10
    costume 세번째 "c.png" size 10 10
  end
end`;
  const result = compileProject(source, { path: 'test.tess' });
  assert.ok(result.project, result.errors[0]?.message ?? '컴파일 실패');
  const vm = new Vm({ renderer: null, audio: null });
  vm.load(result.project as unknown as never);
  const target = vm.targets[0]!;

  assert.equal(target.getPicture('두번째')?.name, '두번째');
  assert.equal(target.getPicture(target.pictures[2]!.id)?.name, '세번째');
  // 번호는 1부터. 엔트리의 `모양을 2로 바꾸기` 가 이 길로 온다.
  assert.equal(target.getPicture('2')?.name, '두번째');
  assert.equal(target.getPicture(3)?.name, '세번째');
  // 없는 것은 첫 모양이 아니라 아무것도 아니어야 한다.
  assert.equal(target.getPicture('없는이름'), null);
  assert.equal(target.getPicture('9'), null);
  assert.equal(target.getPicture('0'), null);

  // 다음/이전 모양은 번호로 준 값에서도 이어진다.
  assert.equal(target.getNextPicture('2')?.name, '세번째');
  assert.equal(target.getNextPicture('3')?.name, '첫번째');
  assert.equal(target.getPrevPicture('1')?.name, '세번째');
});

test('아이디·닉네임은 로그인한 사람을 따르고, 아이디는 앞 두 글자만 남긴다', () => {
  /**
   * 엔트리는 `window.user` 를 읽고, 로그인하지 않았으면 빈 값을 돌려줍니다. 여기서는
   * 사이트 밖에서도 도는 실행기이므로 로그인하지 않은 자리를 `guest` 로 두고,
   * 아이디는 `maskUserId` 가 꺼져 있을 때만 그대로 보여 줍니다.
   */
  const source = `
var 아이디_값 as "아이디 값" = 0
var 닉_값 as "닉 값" = 0

scene "s":
  object "o":
    when start do
      아이디_값 = user_id
      닉_값 = nickname
    end
  end
end`;
  const result = compileProject(source, { path: 'test.tess' });
  assert.ok(result.project, result.errors[0]?.message ?? '컴파일 실패');

  const read = (options: Record<string, unknown>) => {
    const vm = new Vm({ renderer: null, audio: null, ...options });
    vm.load(result.project as unknown as never);
    vm.start();
    vm.tick();
    const value = (name: string) =>
      String(vm.variables.find((item) => item.name === name)?.getValue());
    return { id: value('아이디 값'), nickname: value('닉 값') };
  };

  assert.deepEqual(read({}), { id: 'guest', nickname: 'guest' }, '로그인하지 않은 자리');
  assert.deepEqual(
    read({ user: { id: 'ddtt786', nickname: '치로' } }),
    { id: 'dd*****', nickname: '치로' },
    '아이디만 가려집니다',
  );
  assert.deepEqual(
    read({ user: { id: 'ddtt786', nickname: '치로' }, maskUserId: false }),
    { id: 'ddtt786', nickname: '치로' },
    '가리기를 끄면 그대로입니다',
  );
  // 두 글자 이하는 가릴 것이 없습니다.
  assert.deepEqual(read({ user: { id: 'ab', nickname: 'ab' } }).id, 'ab');
});

// ---------------------------------------------------------------------------
//  번역 (파파고)
// ---------------------------------------------------------------------------
/** 번역 서비스를 흉내 냅니다 — 무엇을 물어봤는지도 들고 있습니다. */
function fakeTranslator(answer: string | null = null) {
  const asked: Array<{ text: string; source: string; target: string }> = [];
  return {
    asked,
    translate(text: string, source: string, target: string) {
      asked.push({ text, source, target });
      return Promise.resolve(answer ?? `${text}(${source}->${target})`);
    },
    detect(_text: string) {
      return Promise.resolve('en');
    },
  };
}

/** 번역은 답을 기다리는 동안 프레임을 넘기므로, 약속이 풀릴 틈을 주고 돌립니다. */
async function runTranslating(source: string, translator: unknown): Promise<Vm> {
  const result = compileProject(source, { path: 'test.tess' });
  assert.ok(result.project, result.errors[0]?.message ?? '컴파일 실패');
  const machine = new Vm({ renderer: null, audio: null, translator: translator as never });
  machine.load(result.project as unknown as never);
  machine.start();
  for (let i = 0; i < 6; i += 1) {
    machine.tick();
    await Promise.resolve();
    await Promise.resolve();
  }
  return machine;
}

const translated = (machine: Vm) => String(machine.variables.find((v) => v.name === '결과')!.getValue());

test('번역 블록은 엔트리 서비스가 준 글을 그대로 쓴다', async () => {
  const translator = fakeTranslator();
  const machine = await runTranslating(
    wrap('결과 = get_translated_string("ko", "안녕", "en")', 'var 결과 = ""'),
    translator,
  );
  assert.equal(translated(machine), '안녕(ko->en)');
  assert.deepEqual(translator.asked, [{ text: '안녕', source: 'ko', target: 'en' }]);
});

/** 엔트리는 두 쪽이 같은 언어면 서비스를 부르지 않고 받은 글을 그대로 돌려줍니다. */
test('출발어와 도착어가 같으면 부르지 않는다', async () => {
  const translator = fakeTranslator();
  const machine = await runTranslating(
    wrap('결과 = get_translated_string("ko", "안녕", "ko")', 'var 결과 = ""'),
    translator,
  );
  assert.equal(translated(machine), '안녕');
  assert.deepEqual(translator.asked, []);
});

test('빈 문장과 3000 자를 넘는 문장은 엔트리처럼 이유를 돌려준다', async () => {
  const empty = await runTranslating(
    wrap('결과 = get_translated_string("ko", "", "en")', 'var 결과 = ""'),
    fakeTranslator(),
  );
  assert.equal(translated(empty), '문장이 없습니다');

  const tooLong = '가'.repeat(3001);
  const long = await runTranslating(
    wrap(`결과 = get_translated_string("ko", "${tooLong}", "en")`, 'var 결과 = ""'),
    fakeTranslator(),
  );
  assert.equal(translated(long), '3000자까지만 입력할 수 있습니다.');
});

test('번역할 곳이 없으면 엔트리의 기본 답을 돌려준다', async () => {
  const machine = await runTranslating(
    wrap('결과 = get_translated_string("ko", "안녕", "en")', 'var 결과 = ""'),
    null,
  );
  assert.equal(translated(machine), '알 수 없는 문장입니다.');
});

test('언어 감지는 엔트리가 쓰는 이름으로 답한다', async () => {
  const machine = await runTranslating(
    wrap('결과 = check_language("hello")', 'var 결과 = ""'),
    fakeTranslator(),
  );
  assert.equal(translated(machine), '영어');
});

test('번역을 기다리는 동안에도 다른 스크립트는 돈다', async () => {
  let release: (value: string) => void = () => {};
  const held = new Promise<string>((resolve) => { release = resolve; });
  const machine = await runTranslating(
    `var 결과 = ""
var 센횟수 = 0
scene "s":
  object "o":
    when start do
      결과 = get_translated_string("ko", "안녕", "en")
    end
    when start do
      forever:
        센횟수 = (센횟수 + 1)
      end
    end
  end
end`,
    { translate: () => held, detect: () => Promise.resolve('en') },
  );
  const counted = Number(machine.variables.find((v) => v.name === '센횟수')!.getValue());
  assert.ok(counted > 1, `다른 스크립트가 멈춰 섰습니다: ${counted}`);
  assert.equal(translated(machine), '', '아직 답이 오지 않았습니다');
  release('안녕하세요');
  for (let i = 0; i < 3; i += 1) {
    machine.tick();
    await Promise.resolve();
    await Promise.resolve();
  }
  assert.equal(translated(machine), '안녕하세요');
});

// ---------------------------------------------------------------------------
//  클릭은 그려진 순서를 따른다
// ---------------------------------------------------------------------------
/**
 * 화면 없이 쌓는 순서만 흉내 냅니다 — 앞에 있는 것이 먼저 오는 목록 하나입니다.
 * 복제본은 엔트리처럼 원본 바로 뒤에 들어갑니다.
 */
function fakeStage() {
  const order: Array<{ id: string }> = [];
  return {
    order,
    addEntity(entity: never, source?: never) {
      const at = source ? order.indexOf(source) + 1 : order.length;
      order.splice(at, 0, entity);
    },
    removeEntity(entity: never) {
      const at = order.indexOf(entity);
      if (at >= 0) order.splice(at, 1);
    },
    moveEntity(entity: never, location: string) {
      const at = order.indexOf(entity);
      if (at < 0) return;
      order.splice(at, 1);
      if (location === 'FRONT') order.unshift(entity);
      else if (location === 'BACK') order.push(entity);
      else order.splice(location === 'FORWARD' ? Math.max(0, at - 1) : at + 1, 0, entity);
    },
    drawOrder: () => [...order],
    flush() {},
    measureTextBox: () => ({ width: 100, height: 40 }),
  };
}

/** 겹쳐 놓은 글상자 둘 — 앞의 것이 클릭을 가져간다. */
const COVERED = `scene "s":
  text "가림막":
    text_content = "가림막"
    when start do
      say "가림막이 받았다"
    end
  end
  text "복제될것":
    text_content = "복제될것"
    when start do
      clone
    end
    when cloned do
      order first
      wait clicked
      say "안녕!"
    end
  end
end`;

/**
 * `오브젝트 순서 바꾸기` 는 그리기 순서만 바꾸고 작품이 선언한 순서는 그대로입니다.
 * 클릭을 선언 순서로 찾으면, 맨 앞으로 올라온 복제본이 여전히 가림막에 가려집니다.
 */
test('맨 앞으로 보낸 복제본이 클릭을 가져간다', () => {
  const result = compileProject(COVERED, { path: 'test.tess' });
  assert.ok(result.project, result.errors[0]?.message ?? '컴파일 실패');
  const view = fakeStage();
  const machine = new Vm({ renderer: view as never, audio: null });
  machine.load(result.project as unknown as never);
  machine.start();
  machine.tick();

  const target = machine.targets.find((item) => item.name === '복제될것')!;
  const clone = target.clones[0];
  assert.ok(clone, '복제본이 만들어져야 합니다');
  assert.equal(view.order[0], clone as never, '복제본이 맨 앞으로 옵니다');

  // 무대 한가운데는 둘 다 덮고 있는 자리다.
  const hit = machine.entityAtPoint(stage.worldWidth / 2, stage.worldHeight / 2);
  assert.equal(hit, clone, '클릭은 맨 앞의 복제본에게 갑니다');

  machine.clickedEntityId = hit!.id;
  machine.tick();
  assert.equal(clone.dialog?.message, '안녕!');
});

test('순서를 바꾸지 않으면 먼저 선언한 오브젝트가 클릭을 가져간다', () => {
  const result = compileProject(COVERED.replace('      order first\n', ''), { path: 'test.tess' });
  assert.ok(result.project, result.errors[0]?.message ?? '컴파일 실패');
  const view = fakeStage();
  const machine = new Vm({ renderer: view as never, audio: null });
  machine.load(result.project as unknown as never);
  machine.start();
  machine.tick();

  const cover = machine.targets.find((item) => item.name === '가림막')!;
  const hit = machine.entityAtPoint(stage.worldWidth / 2, stage.worldHeight / 2);
  assert.equal(hit, cover.entity, '앞에 선 것은 여전히 가림막입니다');
});

/** 그릴 것이 없는 실행기(headless)에서는 작품이 선언한 순서가 그대로 선다. */
test('렌더러가 없으면 선언한 순서로 찾는다', () => {
  const machine = runVm(COVERED.replace('      order first\n', ''));
  machine.tick();
  const cover = machine.targets.find((item) => item.name === '가림막')!;
  assert.equal(
    machine.entityAtPoint(stage.worldWidth / 2, stage.worldHeight / 2),
    cover.entity,
  );
});

/**
 * 말풍선은 오버레이가 엔티티별로 들고 있습니다. 복제본이 사라질 때 오버레이에
 * 말하지 않으면 주인 없는 말풍선이 남아, 작품을 껐다 켜도 화면에 그대로 섭니다.
 * 복제본을 지우는 길(정지·복제본 삭제·장면 바꾸기)은 모두 `removeEntity` 로 모이므로
 * 거기서 한 번 치웁니다. PixiRenderer 는 화면 없이 만들 수 없으므로 소스에서 봅니다.
 */
test('복제본을 지우면 그 말풍선도 함께 지운다', () => {
  const renderer = fs.readFileSync(
    path.join(root, 'packages/tessvm/src/render/renderer.ts'),
    'utf-8',
  );
  const remove = renderer.slice(renderer.indexOf('  removeEntity(entity: Entity): void {'));
  const body = remove.slice(0, remove.indexOf('\n  }'));
  assert.match(body, /this\.overlay\?\.forget\(entity\)/, 'removeEntity 가 오버레이에 알린다');
  assert.ok(
    body.indexOf('this.overlay?.forget(entity)') < body.indexOf('if (!view)'),
    '그릴 것이 이미 없는 복제본도 말풍선은 지워야 하므로 먼저 알린다',
  );

  const overlay = fs.readFileSync(
    path.join(root, 'packages/tessvm/src/render/overlay.ts'),
    'utf-8',
  );
  const forget = overlay.slice(overlay.indexOf('  forget(entity: Entity): void {'));
  const forgetBody = forget.slice(0, forget.indexOf('\n  }'));
  assert.match(forgetBody, /view\.root\.destroy\(/, '말풍선을 실제로 없앤다');
  assert.match(forgetBody, /this\.dialogs\.delete\(entity\)/, '들고 있던 자리도 비운다');
});

/**
 * `new Entry.Dialog` 는 그 오브젝트의 기존 말풍선을 버리고 새 말풍선을 무대에 얹습니다.
 * 그래서 말하기를 한 번 더 하면 — 같은 말이라도 — 그 말풍선이 다른 말풍선들 앞에 섭니다.
 * 글이 바뀔 때만 손대면 계속 말하는 쪽이 먼저 만들어진 순서에 눌려 뒤에 깔립니다.
 * Overlay 는 화면 없이 만들 수 없으므로 그 약속을 소스에서 지킵니다.
 */
test('다시 말하면 그 말풍선이 맨 앞으로 온다', () => {
  const overlay = fs.readFileSync(
    path.join(root, 'packages/tessvm/src/render/overlay.ts'),
    'utf-8',
  );
  const set = overlay.slice(overlay.indexOf('  setDialog(entity: Entity): void {'));
  const body = set.slice(0, set.indexOf('\n  }'));
  const existing = body.slice(body.indexOf('    if (existing) {'));
  assert.match(
    existing,
    /^ {6}this\.raise\(existing\.root\);$/m,
    '글이 그대로여도 올려야 하므로 바뀐 경우 안이 아니라 밖에서 올린다',
  );

  const raise = overlay.slice(overlay.indexOf('  private raise(root: Container): void {'));
  assert.match(
    raise.slice(0, raise.indexOf('\n  }')),
    /setChildIndex\(root, last\)/,
    'raise 는 말풍선을 마지막(맨 앞) 자리로 옮긴다',
  );
});

/**
 * 누르면 무언가 도는 자리라는 것은 커서로 알려 줍니다. 무엇이 눌리는지는 클릭과
 * 같은 규칙(그려진 순서 · 제 픽셀)으로 고르고, 돌고 있지 않은 작품은 눌러도 아무
 * 일이 없으므로 알려 줄 것도 없습니다.
 */
const CLICKABLE = `scene "s":
  text "버튼":
    text_content = "버튼"
    when click do
      say "눌렸다"
    end
  end
end`;

const middle = (): [number, number] => [stage.worldWidth / 2, stage.worldHeight / 2];

test('클릭을 받는 오브젝트 위에서는 손가락 커서를 알린다', () => {
  const machine = runVm(CLICKABLE);
  machine.tick();
  assert.equal(machine.clickableAt(...middle()), true);
});

/** 누르고 떼는 것도 그 오브젝트를 누르는 일이므로 같이 알립니다. */
test('클릭을 뗐을 때만 받는 오브젝트 위에서도 알린다', () => {
  const machine = runVm(CLICKABLE.replace('when click do', 'when click up do'));
  machine.tick();
  assert.equal(machine.clickableAt(...middle()), true);
});

test('클릭을 받지 않는 오브젝트 위에서는 알리지 않는다', () => {
  const machine = runVm(CLICKABLE.replace(/when click do\n      say "눌렸다"\n    end/, ''));
  machine.tick();
  assert.equal(machine.clickableAt(...middle()), false);
});

test('멈춘 작품에서는 알리지 않는다', () => {
  const machine = runVm(CLICKABLE);
  machine.tick();
  machine.stop();
  assert.equal(machine.clickableAt(...middle()), false);
});

test('빈 자리에서는 알리지 않는다', () => {
  const machine = runVm(CLICKABLE);
  machine.tick();
  assert.equal(machine.clickableAt(0, 0), false, '무대 왼쪽 위 구석에는 아무것도 없습니다');
});

/** 앞에 있는 것이 클릭을 가져가므로, 커서도 앞에 있는 것을 따라야 합니다. */
test('클릭을 받지 않는 오브젝트가 가리고 있으면 알리지 않는다', () => {
  const source = `scene "s":
  text "가림막":
    text_content = "가림막"
  end
  text "버튼":
    text_content = "버튼"
    when click do
      say "눌렸다"
    end
  end
end`;
  const result = compileProject(source, { path: 'test.tess' });
  assert.ok(result.project, result.errors[0]?.message ?? '컴파일 실패');
  const view = fakeStage();
  const machine = new Vm({ renderer: view as never, audio: null });
  machine.load(result.project as unknown as never);
  machine.start();
  machine.tick();
  assert.equal(machine.clickableAt(...middle()), false, '앞에 선 가림막이 클릭을 가져갑니다');

  // 버튼을 맨 앞으로 올리면 그때부터는 버튼이 받는다.
  const button = machine.targets.find((item) => item.name === '버튼')!;
  view.moveEntity(button.entity as never, 'FRONT');
  assert.equal(machine.clickableAt(...middle()), true);
});

// ---------------------------------------------------------------------------
//  표 창과 변수 상자
// ---------------------------------------------------------------------------
const TABLE_WORK = `table 점수표 as "점수 표":
  columns "이름", "점수"
  row "철수", 90
  row "영희", 85
end

scene "s":
  object "o":
    when start do
      BODY
    end
  end
end`;

/** 표 창이 열리고 닫힌 자국을 남기는 무대. */
function tableStage() {
  const shown: Array<string | null> = [];
  return {
    shown,
    addEntity() {},
    removeEntity() {},
    flush() {},
    showTable(table: { name: string } | null) { shown.push(table ? table.name : null); },
  };
}

function runWithTable(body: string) {
  const result = compileProject(TABLE_WORK.replace('BODY', body), { path: 'test.tess' });
  assert.ok(result.project, result.errors[0]?.message ?? '컴파일 실패');
  const view = tableStage();
  const machine = new Vm({ renderer: view as never, audio: null });
  machine.load(result.project as unknown as never);
  machine.start();
  return { machine, view };
}

test('테이블 창 열기는 그 표를 띄운다', () => {
  const { machine, view } = runWithTable('show 점수표');
  machine.tick();
  assert.deepEqual(view.shown.slice(-1), ['점수 표']);
});

/**
 * `Entry.engine.setTimeout` — 엔트리는 창을 띄우고 시간을 걸어 둘 뿐, 스크립트를
 * 붙잡지 않습니다. 아래 블록은 곧바로 이어집니다.
 */
test('초를 준 표 창은 스크립트를 붙잡지 않고 그 시간 뒤에 닫힌다', () => {
  const { machine, view } = runWithTable('show 점수표 for 1\n      결과 = 1');
  machine.tick();
  assert.deepEqual(view.shown.slice(-1), ['점수 표'], '창이 열렸습니다');

  // 1초가 차기 전까지는 열려 있다.
  for (let i = 0; i < 50; i += 1) machine.tick();
  assert.equal(view.shown.filter((name) => name === null).length, 1, '아직 닫히지 않았습니다');
  for (let i = 0; i < 20; i += 1) machine.tick();
  assert.deepEqual(view.shown.slice(-1), [null], '시간이 차면 닫힙니다');
});

test('작품을 처음부터 시작하면 열려 있던 표 창은 닫힌다', () => {
  const { machine, view } = runWithTable('show 점수표');
  machine.tick();
  assert.deepEqual(view.shown.slice(-1), ['점수 표']);
  machine.stop();
  machine.start();
  assert.deepEqual(view.shown.slice(-1), [null]);
});

/**
 * 엔트리는 표를 두 벌로 듭니다 — `data` 는 지금 값, `origin` 은 처음 값 — 그리고
 * 정지할 때마다 `data` 를 `origin` 으로 되돌립니다. 그래서 실행이 보는 것은
 * `origin` 이고, `data` 만 보면 저장될 때 비워져 있던 표가 통째로 사라집니다.
 */
test('표는 처음 값(origin)을 읽는다', () => {
  const table = Table.from({
    id: 't', name: '표', fields: ['A', 'B'],
    data: [],
    origin: [[0, 1], [2, 3]],
  } as never);
  assert.deepEqual(table.fields, ['A', 'B']);
  assert.equal(table.getValue(1, 1), 0, 'A1');
  assert.equal(table.getValue(2, 2), 3, 'B2');

  // 사이트가 붙인 줄 번호가 함께 담겨 와도 칸만 읽는다.
  const keyed = Table.from({
    id: 't', name: '표', fields: ['A'],
    data: [{ key: 'r1', value: [7] }],
  } as never);
  assert.equal(keyed.getValue(1, 1), 7);
});

/**
 * 슬라이더 손잡이는 단색이 아닙니다 — 엔트리의 9x20 그림은 파란 바탕 가운데에
 * 짙은 파랑 세로 두 줄을 쥠자리로 둡니다. Overlay 는 화면 없이 만들 수 없으므로
 * 그 약속을 소스에서 지킵니다.
 */
test('슬라이더 손잡이는 바탕과 쥠자리 두 색으로 그린다', () => {
  const overlay = fs.readFileSync(
    path.join(root, 'packages/tessvm/src/render/overlay.ts'),
    'utf-8',
  );
  assert.match(overlay, /const SLIDE_KNOB_COLOR = '#4f80ff';/, '엔트리 그림의 바탕색');
  assert.match(overlay, /const SLIDE_GRIP_COLOR = '#3759b2';/, '엔트리 그림의 쥠자리색');
  const knob = overlay.slice(overlay.indexOf('const knobLeft ='));
  const body = knob.slice(0, knob.indexOf('view.slider.knob.position'));
  assert.match(body, /fill\(\{ color: SLIDE_KNOB_COLOR \}\)/);
  assert.match(body, /for \(const gripX of SLIDE_GRIP_X\)/, '쥠자리 두 줄을 그린다');
  assert.match(body, /fill\(\{ color: SLIDE_GRIP_COLOR \}\)/);
});
