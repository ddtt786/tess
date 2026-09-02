/**
 * 컴파일러가 생성하는 '가로/세로 비율 정하기' 함수가 올바르게 계산되는지 검증합니다.
 * 엔트리 실행기의 객체 크기 계산 규칙을 시뮬레이션하여 실제 동작과 일치하는지 확인합니다.
 *
 * 엔트리 `entity` 크기 계산 규칙 (`entryjs src/class/entity.js`):
 * - `크기` = `(원본가로 × |가로배율| + 원본세로 × |세로배율|) / 2`
 * - `setSize` = 두 배율에 `max(1, 값)/크기`를 곱합니다.
 * - `setXSize` = 가로 배율에만 위 비율을 곱합니다.
 * - `setYSize` = 세로 배율에만 위 비율을 곱합니다.
 * - `resetSize` = 시작 배율로 초기화합니다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { compileProject } from '@tess/compiler';

/**
 * 크기 계산에 사용되는 엔트리 오브젝트의 상태 인터페이스입니다.
 */
interface EntitySpec {
  width: number;
  height: number;
  originX: number;
  originY: number;
  scaleX?: number;
  scaleY?: number;
}

/**
 * 크기 계산 로직을 모방하는 모의(fake) 엔트리 오브젝트를 생성합니다.
 *
 * @param spec - 초기 상태 값
 * @returns 크기 관련 메서드가 구현된 모의 객체
 */
function makeEntity({
  width, height, originX, originY, scaleX = originX, scaleY = originY,
}: EntitySpec) {
  return {
    width, height, originX, originY, scaleX, scaleY,
    size() {
      return (this.width * Math.abs(this.scaleX) + this.height * Math.abs(this.scaleY)) / 2;
    },
    setSize(value: number) {
      const k = Math.max(1, value) / this.size();
      this.scaleX *= k;
      this.scaleY *= k;
    },
    setXSize(value: number) {
      this.scaleX *= Math.max(1, value) / this.size();
    },
    setYSize(value: number) {
      this.scaleY *= Math.max(1, value) / this.size();
    },
    reset() {
      this.scaleX = this.originX;
      this.scaleY = this.originY;
    },
  };
}

/**
 * 최소한의 엔트리 블록을 실행하는 간단한 인터프리터 함수입니다.
 * 크기 계산에 필요한 블록 타입만 지원합니다.
 *
 * @param block - 실행할 블록 객체
 * @param entity - 대상 모의 오브젝트
 * @param params - 매개변수 맵
 * @param locals - 지역 변수 맵
 * @returns 연산 결과 값
 */
function evaluate(
  block: any,
  entity: any,
  params: Record<string, number>,
  locals: Record<string, number>,
): number {
  if (block === null || typeof block !== 'object') return Number(block);
  switch (block.type) {
    case 'number': case 'text':
      return Number(block.params[0]);
    case 'coordinate_object':
      assert.equal(block.params[3], 'size');
      return entity.size();
    case 'get_func_variable':
      return locals[block.params[0]];
    case 'calc_basic': {
      const left = evaluate(block.params[0], entity, params, locals);
      const right = evaluate(block.params[2], entity, params, locals);
      const ops: Record<string, number> = {
        PLUS: left + right, MINUS: left - right, MULTI: left * right, DIVIDE: left / right,
      };
      return ops[block.params[1]]!;
    }
    default:
      if (block.type in params) return params[block.type]!;
      throw new Error(`값 블록 '${block.type}' 은(는) 흉내 낼 수 없습니다.`);
  }
}

function execute(
  blocks: any[],
  entity: any,
  params: Record<string, number>,
  locals: Record<string, number> = {},
) {
  for (const block of blocks) {
    switch (block.type) {
      case 'set_func_variable':
        locals[block.params[0]] = evaluate(block.params[1], entity, params, locals);
        break;
      case 'reset_scale_size':
        entity.reset();
        break;
      case 'set_scale_size':
        entity.setSize(evaluate(block.params[0], entity, params, locals));
        break;
      case 'stretch_scale_size': {
        const amount = evaluate(block.params[1], entity, params, locals);
        if (block.params[0] === 'WIDTH') entity.setXSize(entity.size() + amount);
        else entity.setYSize(entity.size() + amount);
        break;
      }
      default:
        throw new Error(`문장 블록 '${block.type}' 은(는) 흉내 낼 수 없습니다.`);
    }
  }
  return locals;
}

/**
 * 비율 설정 문법(`scale_x = 값` 또는 `scale_y = 값`)이 호출하는 컴파일된 함수와 전달 인자를 추출합니다.
 *
 * @param property - 비율 설정 속성 (`scale_x` 또는 `scale_y`)
 * @param ratio - 설정할 목표 비율 값
 * @returns 함수의 본문, 매개변수, 레이블 정보
 */
function scaleSetter(property: string, ratio: number) {
  const source = `scene "s":
  object "o":
    costume 기본 "a.png" size 200 100
    when start do
      ${property} = ${ratio}
    end
  end
end`;
  const { project, errors } = compileProject(source, { path: 'x.tess' });
  assert.deepEqual(errors, []);

  const call = JSON.parse(project!.objects[0]!.script)[0][1];
  const fn = project!.functions.find((f) => `func_${f.id}` === call.type);
  const create = JSON.parse(fn!.content)[0][0];

  /** 함수의 매개변수 블록 타입과 호출 시 전달된 값을 매핑합니다. */
  const names: string[] = [];
  let field = create.params[0].params[1];
  while (field) {
    names.push(field.params[0].type);
    field = field.params[1];
  }
  const params = Object.fromEntries(names.map((type, i) => [type, Number(call.params[i].params[0])]));
  return { body: create.statements[0], params, label: create.params[0].params[0] };
}

/**
 * 특정 시작 배율을 가진 객체에 지정된 비율 설정 함수를 적용하고 결과를 반환합니다.
 *
 * @param property - 비율 설정 속성 (`scale_x` 또는 `scale_y`)
 * @param ratio - 설정할 목표 비율 값
 * @param entity - 대상 모의 오브젝트
 * @returns 변경이 적용된 객체
 */
function apply(property: string, ratio: number, entity: any) {
  const { body, params } = scaleSetter(property, ratio);
  execute(body, entity, params);
  return entity;
}

const close = (actual: number, expected: number, label: string) => assert.ok(
  Math.abs(actual - expected) < 1e-6,
  `${label}: ${actual} 이(가) ${expected} 와 다릅니다.`,
);

test('가로 비율을 정하면 가로만 목표 값이 되고 세로는 그대로다', () => {
  /** 원본 크기는 200x100, 시작 배율은 100%이며 현재 가로 배율은 50%, 세로 배율은 200%인 상태를 가정합니다. */
  const entity = makeEntity({ width: 200, height: 100, originX: 1, originY: 1, scaleX: 0.5, scaleY: 2 });
  apply('scale_x', 25, entity);
  close(entity.scaleX, 0.25, '가로 배율');
  close(entity.scaleY, 2, '세로 배율(유지)');
});

test('세로 비율을 정하면 세로만 목표 값이 되고 가로는 그대로다', () => {
  const entity = makeEntity({ width: 120, height: 300, originX: 1, originY: 1, scaleX: 1.5, scaleY: 0.4 });
  apply('scale_y', 250, entity);
  close(entity.scaleY, 2.5, '세로 배율');
  close(entity.scaleX, 1.5, '가로 배율(유지)');
});

test('시작 배율이 100%가 아니어도 원본 기준으로 맞춘다', () => {
  /** 객체가 스크립트 상에서 `scale_x = 150`으로 선언된 경우(`entity.scaleX = 1.5`)를 검증합니다. */
  const source = `scene "s":
  object "o":
    costume 기본 "a.png" size 200 100
    scale_x = 150
    scale_y = 80
    when start do
      scale_x = 100
    end
  end
end`;
  const { project } = compileProject(source, { path: 'x.tess' });
  const call = JSON.parse(project!.objects[0]!.script)[0][1];
  /** 원본 배율 값(1.5)이 함수의 두 번째 인자로 정상 전달되어야 합니다. */
  assert.equal(Number(call.params[1].params[0]), 1.5);

  const fn = project!.functions.find((f) => `func_${f.id}` === call.type);
  const create = JSON.parse(fn!.content)[0][0];
  const names: string[] = [];
  let field = create.params[0].params[1];
  while (field) { names.push(field.params[0].type); field = field.params[1]; }
  const params = Object.fromEntries(names.map((type, i) => [type, Number(call.params[i].params[0])]));

  const entity = makeEntity({ width: 200, height: 100, originX: 1.5, originY: 0.8, scaleX: 3, scaleY: 0.2 });
  execute(create.statements[0], entity, params);
  close(entity.scaleX, 1, '가로 배율(원본 100%)');
  close(entity.scaleY, 0.2, '세로 배율(유지)');
});

test('모양이 바뀌어 원본 크기가 달라져도 맞게 계산한다', () => {
  const entity = makeEntity({ width: 64, height: 512, originX: 1, originY: 1, scaleX: 3, scaleY: 0.5 });
  apply('scale_x', 200, entity);
  close(entity.scaleX, 2, '가로 배율');
  close(entity.scaleY, 0.5, '세로 배율(유지)');
});

test('두 번 이어서 정해도 결과가 쌓이지 않는다', () => {
  const entity = makeEntity({ width: 300, height: 200, originX: 1, originY: 1 });
  apply('scale_x', 40, entity);
  apply('scale_x', 90, entity);
  close(entity.scaleX, 0.9, '가로 배율');
  close(entity.scaleY, 1, '세로 배율(유지)');
});

test('가로와 세로를 이어서 정하면 둘 다 목표대로 된다', () => {
  const entity = makeEntity({ width: 150, height: 150, originX: 1, originY: 1 });
  apply('scale_x', 20, entity);
  apply('scale_y', 300, entity);
  close(entity.scaleX, 0.2, '가로 배율');
  close(entity.scaleY, 3, '세로 배율');
});

test('만들어진 함수는 사람이 읽을 수 있는 이름을 가진다', () => {
  assert.equal(scaleSetter('scale_x', 50).label, '[Tess] 가로 비율 정하기');
  assert.equal(scaleSetter('scale_y', 50).label, '[Tess] 세로 비율 정하기');
});

test('쓰지 않으면 함수를 만들지 않는다', () => {
  const { project } = compileProject(`scene "s":
  object "o":
    when start do
      size = 120
    end
  end
end`, { path: 'x.tess' });
  assert.equal(project!.functions.length, 0);
});
