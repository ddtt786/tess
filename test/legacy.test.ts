/**
 * 10여 년 전 블록을 확인합니다.
 *
 * 엔트리는 옛 작품이 열리도록 예전 이름의 블록을 아직 들고 있습니다(`entry.js` 의
 * 레거시 묶음). 이름만 다르고 하는 일은 지금 블록과 같은 것이 대부분이고, 몇 개는
 * 값의 방향이 반대입니다. 되돌리기가 이것들을 옮기지 못하면 그 블록만 사라지는 것이
 * 아니라 **그 블록을 담은 스크립트가 통째로 주석**이 됩니다.
 *
 * | 옛 이름                                   | Tess                        |
 * | ----------------------------------------- | --------------------------- |
 * | `get_x_coordinate` · `get_y_coordinate`   | `x` · `y`                   |
 * | `calc_mod` · `calc_share`                 | `%` · `//`                  |
 * | `set_scale_percent`                       | `scale_x` · `scale_y`       |
 * | `change_scale_percent`                    | `size = size * …`           |
 * | `set_effect` · `set_entity_effect`        | `effect_* = …`              |
 * | `set_effect_amount`                       | `effect_* += …`             |
 * | `reset_project_timer`                     | `reset timer`               |
 * | `options_for_list`                        | `리스트["FIRST"]`           |
 * | `stop_object` 의 `thisObject`             | `stop object`               |
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { compileProject } from '@tess/compiler';
import { decompileProject } from '@tess/decompiler';
import { Vm } from '@tess/vm';
import { Codegen } from '../packages/tessvm/src/compile/codegen.ts';
import type { RawEntity } from '@tess/decompiler';

const number = (value: string) => ({ type: 'number', params: [value] });

/** 옛 블록들을 한 줄씩 담은 작품. */
function legacyProject(): RawEntity {
  return {
    name: 'legacy', speed: 60,
    scenes: [{ id: 'scene1', name: '장면 1' }],
    variables: [
      { id: 'v1', name: '값', variableType: 'variable', value: 0, visible: false, object: null, x: 0, y: 0 },
      { id: 'l1', name: '기록', variableType: 'list', array: [{ data: 'a' }, { data: 'b' }], visible: false, object: null, x: 0, y: 0 },
    ],
    messages: [], functions: [], aiUtilizeBlocks: [],
    objects: [{
      id: 'obj1', name: '주인공', objectType: 'sprite', scene: 'scene1', rotateMethod: 'free',
      script: JSON.stringify([[
        { type: 'when_run_button_click', params: [null], statements: [] },
        { type: 'set_scale_percent', params: [number('50'), null], statements: [] },
        { type: 'change_scale_percent', params: [number('-20'), null], statements: [] },
        { type: 'set_entity_effect', params: ['transparency', number('30'), null], statements: [] },
        { type: 'set_effect', params: ['opacity', number('70'), null], statements: [] },
        { type: 'set_effect_amount', params: ['transparency', number('-2'), null], statements: [] },
        { type: 'reset_project_timer', params: [null], statements: [] },
        { type: 'remove_value_from_list', params: [{ type: 'options_for_list', params: ['FIRST'] }, 'l1', null], statements: [] },
        {
          type: 'set_variable',
          params: ['v1', {
            type: 'calc_mod',
            params: [{ type: 'calc_share', params: [number('17'), null, number('5'), null] }, null, number('2'), null],
          }, null],
          statements: [],
        },
      ]]),
      entity: { x: 12, y: -8, scaleX: 1, scaleY: 1, visible: true },
      sprite: { pictures: [], sounds: [] }, selectedPictureId: null,
    }],
  } as unknown as RawEntity;
}

test('옛 블록도 tessvm 이 그대로 돈다', () => {
  const project = legacyProject();
  const program = new Codegen(project as never).compile();
  assert.deepEqual([...program.unknown.keys()], [], '모르는 블록이 없습니다');

  const vm = new Vm({ renderer: null, audio: null });
  vm.load(project as never);
  vm.start();
  vm.tick();

  const entity = vm.targets[0]!.entity;
  // 50% 로 정한 뒤 -20% 만큼 바꾼다 → 원래의 0.4 배
  assert.ok(Math.abs(entity.getScaleX() - 0.4) < 1e-9, String(entity.getScaleX()));
  assert.ok(Math.abs(entity.getScaleY() - 0.4) < 1e-9);
  // 투명도 30 → 알파 0.7, 불투명도 70 → 알파 0.7, 그리고 -2 만큼 더 → 0.72
  assert.ok(Math.abs(entity.effect.alpha - 0.72) < 1e-9, String(entity.effect.alpha));
  const list = vm.variables.find((variable) => variable.name === '기록')!;
  assert.deepEqual(list.getArray(), [{ data: 'b' }], '첫 항목이 지워집니다');
  // (17 // 5) % 2 = 3 % 2 = 1
  assert.equal(Number(vm.variables.find((variable) => variable.name === '값')!.getValue()), 1);
});

test('옛 좌표 블록은 지금 좌표와 같은 값을 읽는다', () => {
  const project = legacyProject();
  const object = (project.objects as RawEntity[])[0]!;
  object.script = JSON.stringify([[
    { type: 'when_run_button_click', params: [null], statements: [] },
    {
      type: 'set_variable',
      params: ['v1', {
        type: 'calc_basic',
        params: [{ type: 'get_x_coordinate', params: [null] }, 'PLUS', { type: 'get_y_coordinate', params: [null] }],
      }, null],
      statements: [],
    },
  ]]);
  const vm = new Vm({ renderer: null, audio: null });
  vm.load(project as never);
  vm.start();
  vm.tick();
  assert.equal(Number(vm.variables.find((variable) => variable.name === '값')!.getValue()), 4, 'x(12) + y(-8)');
});

test('옛 블록은 되돌릴 때 지금 문법으로 옮겨지고 다시 컴파일된다', () => {
  const back = decompileProject(legacyProject(), [], { inline: true });
  assert.deepEqual(back.warnings, [], back.warnings.join('\n'));
  for (const line of [
    // 저장된 배율(100%)을 곱한 자리 — Tess 의 `scale_x` 는 모양 원본 대비 % 다.
    /scale_x = 50 \* 100 \/ 100/, /scale_y = 50 \* 100 \/ 100/,
    /size = size \* \(-20 \+ 100\) \/ 100/,
    /effect_alpha = 30/,
    /effect_alpha = 100 - 70/,
    /effect_alpha \+= -2/,
    /reset timer/,
    /remove 기록\["FIRST"\]/,
    /값 = \(\(17 \/\/ 5\) % 2\)/,
  ]) {
    assert.match(back.source, line, String(line));
  }
  const again = compileProject(back.source, { path: 'main.tess' });
  assert.deepEqual(again.errors.map((error) => error.message), []);
});

/**
 * 옛 크기 블록은 **저장된 배율**에서 재고(`sprite.snapshot_`), Tess 의 `scale_x` 는
 * 모양 원본에서 잽니다. 그 차이를 곱해 두지 않으면 0.54 로 저장된 꽃이 원본 크기의
 * 10% 가 아니라 그대로 10% 로 커집니다 — ladybug 에서 꽃이 커 보이던 자리입니다.
 */
test('옛 크기 블록은 저장된 배율에서 잰다', () => {
  const project = legacyProject();
  const object = (project.objects as RawEntity[])[0]!;
  (object.entity as RawEntity).scaleX = 0.54;
  (object.entity as RawEntity).scaleY = 0.54;
  object.script = JSON.stringify([[
    { type: 'when_run_button_click', params: [null], statements: [] },
    { type: 'set_scale_percent', params: [number('10'), null], statements: [] },
  ]]);

  const direct = new Vm({ renderer: null, audio: null });
  direct.load(project as never);
  direct.start();
  direct.tick();
  assert.ok(Math.abs(direct.targets[0]!.entity.getScaleX() - 0.054) < 1e-9, '저장된 배율의 10%');

  const back = decompileProject(project, [], { inline: true });
  assert.match(back.source, /scale_x = 10 \* 54 \/ 100/);
  const again = compileProject(back.source, { path: 'main.tess' });
  assert.deepEqual(again.errors.map((error) => error.message), []);
  const rebuilt = again.project as unknown as RawEntity;
  const entity = ((rebuilt.objects as RawEntity[])[0]!.entity as RawEntity);
  entity.width = 100;
  entity.height = 100;
  const round = new Vm({ renderer: null, audio: null });
  round.load(rebuilt as never);
  round.start();
  for (let i = 0; i < 3; i += 1) round.tick();
  // `scale_x` 는 지금 크기를 재서 비율을 되맞추므로(AI_SPEC-ADDENDUM 4.1) 소수점
  // 아래로 아주 작은 오차가 남습니다. 엔트리에서도 같은 함수가 같은 자리를 잽니다.
  const scaled = round.targets[0]!.entity.getScaleX();
  assert.ok(Math.abs(scaled - 0.054) / 0.054 < 1e-5, `되돌린 뒤에도 같아야 합니다 (${scaled})`);
});

test('`stop object` 는 복제본까지 이 오브젝트의 코드를 멈춘다', () => {
  const source = 'scene "s":\n  object "o":\n    when start do\n      stop object\n    end\n  end\nend';
  const result = compileProject(source, { path: 'main.tess' });
  assert.deepEqual(result.errors.map((error) => error.message), []);
  const block = JSON.parse(
    String(((result.project as unknown as RawEntity).objects as RawEntity[])[0]!.script),
  )[0][1];
  assert.equal(block.type, 'stop_object');
  assert.equal(block.params[0], 'thisObject', '엔트리의 옛 값 그대로 나갑니다');

  const back = decompileProject(result.project as unknown as RawEntity, [], { inline: true });
  assert.match(back.source, /stop object/);
});

/**
 * `calc_basic` · `boolean_basic_operator` 이전의 연산 블록들입니다. 연산자가 블록
 * 이름 자체에 들어 있고, 피연산자는 지금과 같은 0 · 2 번 칸입니다.
 *
 * | 옛 이름                                                  | Tess          |
 * | -------------------------------------------------------- | ------------- |
 * | `calc_plus` · `calc_minus` · `calc_times` · `calc_divide` | `+ - * /`     |
 * | `boolean_equal` · `boolean_bigger` · `boolean_smaller`    | `== > <`      |
 */
test('옛 연산 블록은 지금 연산자와 같은 값을 낸다', () => {
  const project = legacyProject();
  const object = (project.objects as RawEntity[])[0]!;
  object.script = JSON.stringify([[
    { type: 'when_run_button_click', params: [null], statements: [] },
    {
      type: 'set_variable',
      params: ['v1', {
        type: 'calc_plus',
        params: [
          { type: 'calc_times', params: [number('3'), null, number('4')] },
          null,
          {
            type: 'calc_divide',
            params: [{ type: 'calc_minus', params: [number('10'), null, number('4')] }, null, number('2')],
          },
        ],
      }, null],
      statements: [],
    },
    {
      type: '_if',
      params: [{ type: 'boolean_bigger', params: [number('5'), null, number('3')] }],
      statements: [[
        { type: 'add_value_to_list', params: [number('1'), 'l1', null], statements: [] },
      ]],
    },
    {
      type: '_if',
      params: [{ type: 'boolean_smaller', params: [number('5'), null, number('3')] }],
      statements: [[
        { type: 'add_value_to_list', params: [number('2'), 'l1', null], statements: [] },
      ]],
    },
    {
      type: '_if',
      params: [{ type: 'boolean_equal', params: [number('3'), null, number('3')] }],
      statements: [[
        { type: 'add_value_to_list', params: [number('3'), 'l1', null], statements: [] },
      ]],
    },
  ]]);

  const program = new Codegen(project as never).compile();
  assert.deepEqual([...program.unknown.keys()], [], '모르는 블록이 없습니다');

  const vm = new Vm({ renderer: null, audio: null });
  vm.load(project as never);
  vm.start();
  vm.tick();
  // 3 * 4 + (10 - 4) / 2 = 15
  assert.equal(Number(vm.variables.find((variable) => variable.name === '값')!.getValue()), 15);
  const list = vm.variables.find((variable) => variable.name === '기록')!;
  assert.deepEqual(
    list.getArray().map((item: { data: unknown }) => String(item.data)),
    ['a', 'b', '1', '3'],
    '5 > 3 과 3 == 3 만 참입니다',
  );

  const back = decompileProject(project, [], { inline: true });
  assert.deepEqual(back.warnings, [], back.warnings.join('\n'));
  for (const line of [
    /값 = \(\(3 \* 4\) \+ \(\(10 - 4\) \/ 2\)\)/,
    /if \(5 > 3\):/, /if \(5 < 3\):/, /if \(3 == 3\):/,
  ]) {
    assert.match(back.source, line, String(line));
  }
  const again = compileProject(back.source, { path: 'main.tess' });
  assert.deepEqual(again.errors.map((error) => error.message), []);
});
