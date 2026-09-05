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
  CollisionSystem,
  MaskStore,
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
