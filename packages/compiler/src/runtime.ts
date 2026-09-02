/**
 * 컴파일러가 엔트리 실행 환경(런타임)에 주입하는 특수 함수들입니다.
 *
 * 엔트리에는 크기를 특정 비율로 지정하는 블록이 없고, "크기를 ~만큼 늘리기" 블록만 존재합니다.
 * 크기를 목표 비율로 맞추려면 현재의 가로 및 세로 길이를 알아야 하지만, 엔트리는 가로와 세로가 섞인 단일 "크기" 값만 제공합니다.
 * 
 * 이 모듈의 함수들은 한쪽 축을 크게 늘렸을 때 전체 크기가 얼마나 변하는지 측정하여 각 축의 길이를 역산해냅니다.
 * 이 값을 통해 현재 비율을 파악하고, 원래 크기로 되돌린 후 목표하는 가로/세로 비율에 맞게 정확히 크기를 조절합니다.
 */

import type { Context } from './context.ts';
import type { CompiledFunction, EntryBlock, EntryParam, FuncLocalVariable } from './types.ts';

const MEASURE = 100000;
const AXES: Record<string, { setter: string; probe: string; label: string }> = {
  scale_x: { setter: 'WIDTH', probe: 'HEIGHT', label: '[Tess] 가로 비율 정하기' },
  scale_y: { setter: 'HEIGHT', probe: 'WIDTH', label: '[Tess] 세로 비율 정하기' },
};

/**
 * 오브젝트의 가로 또는 세로 크기를 특정 비율로 설정하는 엔트리 함수를 생성하여 등록합니다.
 * 이미 동일한 함수가 생성되어 있다면 기존 함수를 반환합니다.
 *
 * 생성되는 엔트리 함수의 형태: `[Tess] 가로 비율 정하기 (비율) (원래 배율)`
 * - `비율`: 목표로 하는 비율(%)입니다. 100이면 원본 크기를 의미합니다.
 * - `원래 배율`: 해당 오브젝트의 초기 배율입니다. 오브젝트마다 초기값이 다르므로 인자로 받아서 계산합니다.
 *
 * @param property 설정할 속성 이름 (`scale_x` 또는 `scale_y`)
 * @param ctx 컴파일 컨텍스트
 * @returns 생성되거나 캐시된 런타임 함수 객체
 *
 * @example
 * const setterFunc = requireScaleSetter("scale_x", ctx);
 */
export function requireScaleSetter(property: string, ctx: Context): CompiledFunction {
  const existing = ctx.runtimeFunctions.get(property);
  if (existing) return existing;

  const axis = AXES[property];
  const id = ctx.newId();
  const params = ['비율', '원래 배율'];
  const paramTypes = new Map(params.map((name) => [name, `stringParam_${ctx.newId()}`]));

  // 지역 변수: 잰 값들을 담아 둔다 (호출마다 따로 생기므로 복제본에서도 안전하다)
  const locals: Record<string, string> = {};
  const localVariables: FuncLocalVariable[] = ['현재 크기', '지금 축', '원래 크기', '원래 축'].map((name) => {
    const variable = { id: `${id}_${ctx.newId()}`, name, value: 0 };
    locals[name] = variable.id;
    return variable;
  });

  const size = () => ctx.block('coordinate_object', [null, 'self', null, 'size']);
  const local = (name: string) => ctx.block('get_func_variable', [locals[name]!, null]);
  const setLocal = (name: string, value: EntryParam) => ctx.block('set_func_variable', [locals[name]!, value, null]);
  const param = (name: string) => ctx.block(paramTypes.get(name)!, []);
  const number = (value: number) => ctx.number(value);
  const calc = (left: EntryParam, operator: string, right: EntryParam) => ctx.block('calc_basic', [left, operator, right]);
  const stretch = (dimension: string, value: EntryParam) => ctx.block('stretch_scale_size', [dimension, value, null]);

  //  잰 축 = 2 × 기준크기 × (지금크기 − 기준크기) × 0.00001
  const measured = (baseline: string) => calc(
    calc(calc(number(2), 'MULTI', local(baseline)), 'MULTI', calc(size(), 'MINUS', local(baseline))),
    'MULTI',
    number(1 / MEASURE),
  );

  const body = [
    // 1. 지금 상태에서 "건드리지 않을 축" 의 길이를 잰다
    setLocal('현재 크기', size()),
    stretch(axis.probe, number(MEASURE)),
    setLocal('지금 축', measured('현재 크기')),

    // 2. 원래 크기로 되돌린 뒤 같은 축을 잰다 (이때 배율은 인자로 받은 값)
    ctx.block('reset_scale_size', [null]),
    setLocal('원래 크기', size()),
    stretch(axis.probe, number(MEASURE)),
    setLocal('원래 축', measured('원래 크기')),
    ctx.block('reset_scale_size', [null]),

    // 3. 건드리지 않을 축을 원래대로 되돌린다 (크기를 정하면 두 축이 같은 비율로 움직인다)
    ctx.block('set_scale_size', [
      calc(calc(size(), 'MULTI', local('지금 축')), 'DIVIDE', local('원래 축')),
      null,
    ]),

    // 4. 목표 축을 비율에 맞춘다
    //    늘릴 값 = 지금크기 × (비율 × 원래축 / (100 × 원래배율 × 지금축) − 1)
    stretch(axis.setter, calc(
      size(),
      'MULTI',
      calc(
        calc(
          calc(param('비율'), 'MULTI', local('원래 축')),
          'DIVIDE',
          calc(calc(number(100), 'MULTI', param('원래 배율')), 'MULTI', local('지금 축')),
        ),
        'MINUS',
        number(1),
      ),
    )),
  ];

  const field = ctx.block('function_field_label', [
    axis.label,
    params.reduceRight<EntryParam>(
      (next, name) => ctx.block('function_field_string', [ctx.block(paramTypes.get(name)!, []), next]),
      null,
    ),
  ]);

  const create = ctx.block('function_create', [field, null], [body]);
  create.x = 50;
  create.y = 30;

  const fn = {
    id,
    name: axis.label,
    generated: true,
    type: 'normal',
    params,
    paramTypes,
    isValue: false,
    localVariables,
    content: [[create]],
  };
  ctx.functions.push(fn);
  ctx.runtimeFunctions.set(property, fn);
  return fn;
}


// ---------------------------------------------------------------------------
//  거듭제곱 다듬기
// ---------------------------------------------------------------------------

/**
 * 거듭제곱 연산 시 발생하는 부동소수점 오차를 보정하는 함수를 생성합니다.
 *
 * 무한소수 지수(예: 1/3)를 계산할 때 발생하는 미세한 오차를 엔트리의 자연로그(ln)와 뉴턴-랩슨 법을 활용해 보정합니다.
 * 
 * 계산 공식: `y ≈ x^p` 일 때 `y ← y × (1 + p·ln x − ln y)`
 * 
 * 보정을 거치면 10^-6 수준이던 오차가 10^-13 수준으로 줄어들어 사실상 정확한 값이 됩니다.
 * 엔트리 블록이 불필요하게 두 배로 늘어나는 것을 방지하기 위해, 매개변수로 어림값을 전달받는 별도 함수로 구성됩니다.
 *
 * @param ctx 컴파일 컨텍스트
 * @returns 생성된 거듭제곱 보정 함수 객체
 *
 * @example
 * const powerRefiner = requirePowerRefiner(ctx);
 */
export function requirePowerRefiner(ctx: Context): CompiledFunction {
  const existing = ctx.runtimeFunctions.get('power');
  if (existing) return existing;

  const id = ctx.newId();
  const params = ['어림값', '밑', '지수'];
  const paramTypes = new Map(params.map((name) => [name, `stringParam_${ctx.newId()}`]));
  const param = (name: string) => ctx.block(paramTypes.get(name)!, []);
  const calc = (left: EntryParam, operator: string, right: EntryParam) => ctx.block('calc_basic', [left, operator, right]);
  const ln = (value: EntryParam) => ctx.block('calc_operation', [null, value, null, 'ln']);

  //  어림값 × (1 + 지수 × ln(밑) − ln(어림값))
  const refined = calc(
    param('어림값'),
    'MULTI',
    calc(
      calc(ctx.number(1), 'PLUS', calc(param('지수'), 'MULTI', ln(param('밑')))),
      'MINUS',
      ln(param('어림값')),
    ),
  );

  const field = ctx.block('function_field_label', [
    '[Tess] 거듭제곱 다듬기',
    params.reduceRight<EntryParam>(
      (next, name) => ctx.block('function_field_string', [ctx.block(paramTypes.get(name)!, []), next]),
      null,
    ),
  ]);

  const create = ctx.block('function_create_value', [field, null, null, refined], [[]]);
  create.x = 50;
  create.y = 30;

  const fn = {
    id,
    name: '[Tess] 거듭제곱 다듬기',
    generated: true,
    type: 'value',
    params,
    paramTypes,
    isValue: true,
    localVariables: [],
    content: [[create]],
  };
  ctx.functions.push(fn);
  ctx.runtimeFunctions.set('power', fn);
  return fn;
}
