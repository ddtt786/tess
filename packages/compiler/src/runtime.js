// ============================================================================
//  컴파일러가 만들어 넣는 엔트리 런타임 함수
//
//  엔트리에는 "가로 크기를 ~%로 정하기" 블록이 없다. 늘리는 블록만 있다.
//    stretch_scale_size(WIDTH, v) -> setXSize(size + v) -> scaleX *= (size + v) / size
//  즉 "지금 크기 기준 비율" 로만 바꿀 수 있어서, 목표 비율로 맞추려면
//  지금 가로·세로가 각각 얼마인지 알아야 한다. 그런데 엔트리가 알려 주는 값은
//  가로와 세로가 섞인 "크기" 하나뿐이다.
//
//    크기 = (원본가로 × |가로배율| + 원본세로 × |세로배율|) / 2
//
//  그래서 한쪽만 크게 늘려 보고 크기가 얼마나 변했는지로 그 항을 뽑아낸다.
//    세로를 v 만큼 늘리면  크기' = (W·sx + H·sy·(S+v)/S) / 2
//    => 2·S·(크기' − S) / v = H·sy
//  v = 100000 을 쓰면 2·S·(크기' − S)·0.00001 이 곧 H·sy 다.
//
//  이 값을 알면 원래 크기로 되돌린 뒤(배율이 컴파일 시점에 아는 값이 된다)
//  "크기를 정하기" 로 한 축을 복원하고 "늘리기" 로 다른 축을 목표에 맞춘다.
// ============================================================================

const MEASURE = 100000;
const AXES = {
  scale_x: { setter: 'WIDTH', probe: 'HEIGHT', label: '[Tess] 가로 비율 정하기' },
  scale_y: { setter: 'HEIGHT', probe: 'WIDTH', label: '[Tess] 세로 비율 정하기' },
};

/**
 * `scale_x = N` / `scale_y = N` 을 처리하는 엔트리 함수를 만들어 등록한다.
 * 이미 만들었으면 그대로 돌려준다.
 *
 * 만들어지는 함수:  [Tess] 가로 비율 정하기 (비율) (원래 배율)
 *   비율      – 목표 비율(%). 100 이면 원본 크기
 *   원래 배율 – 그 오브젝트의 시작 배율(entity.scaleX/scaleY). 오브젝트마다 다르므로 인자로 받는다
 */
export function requireScaleSetter(property, ctx) {
  const existing = ctx.runtimeFunctions.get(property);
  if (existing) return existing;

  const axis = AXES[property];
  const id = ctx.newId();
  const params = ['비율', '원래 배율'];
  const paramTypes = new Map(params.map((name) => [name, `stringParam_${ctx.newId()}`]));

  // 지역 변수: 잰 값들을 담아 둔다 (호출마다 따로 생기므로 복제본에서도 안전하다)
  const locals = {};
  const localVariables = ['현재 크기', '지금 축', '원래 크기', '원래 축'].map((name) => {
    const variable = { id: `${id}_${ctx.newId()}`, name, value: 0 };
    locals[name] = variable.id;
    return variable;
  });

  const size = () => ctx.block('coordinate_object', [null, 'self', null, 'size']);
  const local = (name) => ctx.block('get_func_variable', [locals[name], null]);
  const setLocal = (name, value) => ctx.block('set_func_variable', [locals[name], value, null]);
  const param = (name) => ctx.block(paramTypes.get(name), []);
  const number = (value) => ctx.number(value);
  const calc = (left, operator, right) => ctx.block('calc_basic', [left, operator, right]);
  const stretch = (dimension, value) => ctx.block('stretch_scale_size', [dimension, value, null]);

  //  잰 축 = 2 × 기준크기 × (지금크기 − 기준크기) × 0.00001
  const measured = (baseline) => calc(
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
    params.reduceRight(
      (next, name) => ctx.block('function_field_string', [ctx.block(paramTypes.get(name), []), next]),
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
 * 무한소수 지수(예: 1/3)는 이진 전개를 어디선가 끊어야 해서 아주 작은 오차가 남는다.
 * 엔트리에 있는 자연로그(ln)로 뉴턴 보정을 한 번 하면 그 오차가 제곱으로 줄어
 * 사실상 정확한 값이 된다.
 *
 *   y ≈ x^p 일 때   y ← y × (1 + p·ln x − ln y)
 *
 *   y = x^p(1+ε) 이면 ln y = p·ln x + ln(1+ε) ≈ p·ln x + ε − ε²/2 이므로
 *   보정 뒤 오차는 ε²/2 가 된다. 10^-6 이던 오차가 10^-13 수준이 된다.
 *
 * 어림값을 두 번 써야 하는데, 식을 그대로 복사하면 블록이 두 배가 된다.
 * 그래서 매개변수로 받는 함수로 만들어 어림값 블록 하나만 넘긴다.
 */
export function requirePowerRefiner(ctx) {
  const existing = ctx.runtimeFunctions.get('power');
  if (existing) return existing;

  const id = ctx.newId();
  const params = ['어림값', '밑', '지수'];
  const paramTypes = new Map(params.map((name) => [name, `stringParam_${ctx.newId()}`]));
  const param = (name) => ctx.block(paramTypes.get(name), []);
  const calc = (left, operator, right) => ctx.block('calc_basic', [left, operator, right]);
  const ln = (value) => ctx.block('calc_operation', [null, value, null, 'ln']);

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
    params.reduceRight(
      (next, name) => ctx.block('function_field_string', [ctx.block(paramTypes.get(name), []), next]),
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
