// Entry runtime functions synthesized by the compiler.
//
// Entry has no "set width to N%" block, only a stretch block:
//   stretch_scale_size(WIDTH, v) -> setXSize(size + v) -> scaleX *= (size + v) / size
// It only changes scale relative to the current size, so hitting a target
// ratio requires knowing the current width and height separately. But Entry
// only exposes a single "size" value that mixes width and height:
//
//   size = (baseWidth * |scaleX| + baseHeight * |scaleY|) / 2
//
// This isolates one axis by stretching only that axis and reading how much
// the mixed size changed:
//   stretching height by v gives  size' = (W*sx + H*sy*(S+v)/S) / 2
//   => 2*S*(size' - S) / v = H*sy
// Using v = 100000 makes 2*S*(size' - S)*0.00001 equal H*sy directly.
//
// With that value known, resetting to the original size (scale becomes a
// compile-time-known value again) lets "set size" restore one axis while
// "stretch" hits the target on the other.

const MEASURE = 100000;
const AXES = {
  scale_x: { setter: 'WIDTH', probe: 'HEIGHT', label: '[Tess] 가로 비율 정하기' },
  scale_y: { setter: 'HEIGHT', probe: 'WIDTH', label: '[Tess] 세로 비율 정하기' },
};

/**
 * Builds and registers the Entry function that implements `scale_x = N` /
 * `scale_y = N`; returns the existing one if already built.
 *
 * Generated function signature: [Tess] set width ratio (ratio) (baseScale)
 *   ratio     – target ratio (%); 100 means original size
 *   baseScale – the object's starting scale (entity.scaleX/scaleY), passed
 *               in as an argument since it varies per object
 */
export function requireScaleSetter(property, ctx) {
  const existing = ctx.runtimeFunctions.get(property);
  if (existing) return existing;

  const axis = AXES[property];
  const id = ctx.newId();
  const params = ['비율', '원래 배율'];
  const paramTypes = new Map(params.map((name) => [name, `stringParam_${ctx.newId()}`]));

  // local variables holding measured values (fresh per call, so safe on clones too)
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

  //  measured axis = 2 * baseline * (currentSize - baseline) * 0.00001
  const measured = (baseline) => calc(
    calc(calc(number(2), 'MULTI', local(baseline)), 'MULTI', calc(size(), 'MINUS', local(baseline))),
    'MULTI',
    number(1 / MEASURE),
  );

  const body = [
    // 1. measure the untouched axis at the current state
    setLocal('현재 크기', size()),
    stretch(axis.probe, number(MEASURE)),
    setLocal('지금 축', measured('현재 크기')),

    // 2. reset to original size and measure the same axis (scale is now the passed-in arg)
    ctx.block('reset_scale_size', [null]),
    setLocal('원래 크기', size()),
    stretch(axis.probe, number(MEASURE)),
    setLocal('원래 축', measured('원래 크기')),
    ctx.block('reset_scale_size', [null]),

    // 3. restore the untouched axis (setting size moves both axes by the same ratio)
    ctx.block('set_scale_size', [
      calc(calc(size(), 'MULTI', local('지금 축')), 'DIVIDE', local('원래 축')),
      null,
    ]),

    // 4. hit the target ratio on the target axis
    //    stretch amount = currentSize * (ratio * baselineAxis / (100 * baseScale * currentAxis) - 1)
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
//  power refinement
// ---------------------------------------------------------------------------

/**
 * A non-terminating exponent (e.g. 1/3) truncates its binary expansion
 * somewhere, leaving a small error. One Newton correction using Entry's
 * natural log (ln) squares that error down to effectively exact.
 *
 *   for y ≈ x^p:   y ← y * (1 + p*ln(x) - ln(y))
 *
 *   if y = x^p(1+ε), then ln(y) = p*ln(x) + ln(1+ε) ≈ p*ln(x) + ε - ε²/2,
 *   so the post-correction error is ε²/2 — an initial 10^-6 error becomes ~10^-13.
 *
 * The approximation is used twice; duplicating the expression would double
 * the block count, so it's wrapped in a function taking the approximate
 * value as a single parameter.
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

  //  approx * (1 + exponent * ln(base) - ln(approx))
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
