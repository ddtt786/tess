// ============================================================================
//  Tess 표현식 -> 엔트리 값(value) 블록
//
//  주의할 의미 차이
//   - 리스트/문자열 인덱스: Tess 는 0부터, 엔트리는 1부터  -> +1 보정
//   - index_of: 엔트리는 1부터(못 찾으면 0)               -> -1 보정
//   - slice(s, a, b): Tess 는 [a, b), 엔트리 substring 은 1부터 양끝 포함
// ============================================================================
import { keyCodeOf } from './keycodes.js';
import { requirePowerRefiner } from './runtime.js';
import { OPTION_KEYWORDS, STATE_VALUES } from '../builtins.js';

/** 결과가 엔트리 "판단(boolean)" 블록인 타입들 */
const BOOLEAN_TYPES = new Set([
  'boolean_basic_operator', 'boolean_and_or', 'boolean_not',
  'is_clicked', 'is_object_clicked', 'is_press_some_key', 'reach_something',
  'is_type', 'is_boost_mode', 'is_current_device_type', 'is_touch_supported',
  'is_included_in_list',
]);

const COMPARE_OPERATORS = {
  '==': 'EQUAL', '!=': 'NOT_EQUAL',
  '>': 'GREATER', '<': 'LESS',
  '>=': 'GREATER_OR_EQUAL', '<=': 'LESS_OR_EQUAL',
};

const ARITHMETIC_OPERATORS = { '+': 'PLUS', '-': 'MINUS', '*': 'MULTI', '/': 'DIVIDE' };

/** calc_operation 으로 바로 가는 수학 함수 */
const MATH_OPERATIONS = {
  sin: 'sin', cos: 'cos', tan: 'tan',
  asin: 'asin_radian', acos: 'acos_radian', atan: 'atan_radian',
  ln: 'ln', log10: 'log',
  floor: 'floor', ceil: 'ceil', round: 'round', abs: 'abs',
};

/** 오브젝트 정보 조회 함수 -> coordinate_object 의 COORDINATE 값 */
const OBJECT_COORDINATES = { x: 'x', y: 'y', angle: 'rotation', way: 'direction', size: 'size' };

/** 상태 값(괄호 없이 쓰는 읽기 전용 값) */
const STATE_BLOCKS = {
  mouse_down: 'is_clicked',
  clicked: 'is_object_clicked',
  boost_mode: 'is_boost_mode',
  touchable: 'is_touch_supported',
  user_id: 'get_user_name',
  nickname: 'get_nickname',
  timer: 'get_project_timer_value',
  answer: 'get_canvas_input_value',
};

/** 오브젝트 속성을 읽는 coordinate_object 의 COORDINATE 값 */
const PROPERTY_COORDINATES = {
  x: 'x', y: 'y', angle: 'rotation', way: 'direction', size: 'size', costume: 'picture_name',
};

export function isBooleanBlock(node) {
  return Boolean(node) && typeof node === 'object' && BOOLEAN_TYPES.has(node.type);
}

/** 판단 자리에 들어갈 블록. 값 블록이면 `== "true"` 로 감싼다. */
export function compileBoolean(node, ctx) {
  const compiled = compileValue(node, ctx);
  if (compiled === null) return null;
  if (isBooleanBlock(compiled)) return compiled;
  return ctx.block('boolean_basic_operator', [compiled, 'EQUAL', ctx.text('true')]);
}

/** 값 자리에 들어갈 블록 */
export function compileValue(node, ctx) {
  if (!node) return null;
  switch (node.type) {
    case 'Number': return ctx.number(node.value);
    case 'String': return ctx.text(node.value);
    case 'Boolean': return ctx.text(String(node.value));
    case 'Color': return ctx.text(node.value);
    case 'Transparent': return ctx.text('transparent');
    case 'Identifier': return compileIdentifier(node, ctx);
    case 'Binary': return compileBinary(node, ctx);
    case 'Unary': return compileUnary(node, ctx);
    case 'Call': return compileCall(node, ctx);
    case 'Index': return compileIndex(node, ctx);
    case 'ListLiteral':
      return ctx.error(node, '리스트 리터럴은 list 선언에서만 쓸 수 있습니다.');
    default:
      return ctx.error(node, `표현식 '${node.type}' 은(는) 엔트리 블록으로 바꿀 수 없습니다.`);
  }
}

// ---------------------------------------------------------------------------
//  식별자
// ---------------------------------------------------------------------------
function compileIdentifier(node, ctx) {
  const { name } = node;

  const found = ctx.lookupVariable(name);
  if (found) {
    if (found.kind === 'param') return ctx.block(ctx.funcScope.params.get(name), []);
    if (found.kind === 'funcLocal') return ctx.block('get_func_variable', [found.id, null]);
    if (found.entry.variableType === 'list') {
      return ctx.error(node, `리스트 '${name}' 은(는) 값으로 바로 쓸 수 없습니다. ${name}[i] 처럼 항목을 지정하세요.`);
    }
    return ctx.block('get_variable', [found.entry.id, null]);
  }

  if (name === 'block_count') return ctx.block('get_block_count', ['all']);
  if (STATE_BLOCKS[name]) {
    // 블록마다 파라미터 자리 개수가 다르다 (엔트리 블록 스키마 기준)
    const slots = { get_nickname: 0, get_user_name: 0, get_project_timer_value: 2 };
    const count = slots[STATE_BLOCKS[name]] ?? 1;
    return ctx.block(STATE_BLOCKS[name], new Array(count).fill(null));
  }
  if (name === 'device') {
    return ctx.error(node, "device 는 홀로 쓸 수 없습니다. device == \"mobile\" 처럼 비교해서 쓰세요.");
  }
  if (PROPERTY_COORDINATES[name]) {
    return ctx.block('coordinate_object', [null, 'self', null, PROPERTY_COORDINATES[name]]);
  }
  if (name === 'sound_volume') return ctx.block('get_sound_volume', [null]);
  if (OPTION_KEYWORDS.has(name) || STATE_VALUES.has(name)) {
    return ctx.error(node, `'${name}' 은(는) 이 자리에서 값으로 쓸 수 없습니다.`);
  }
  return ctx.error(node, `선언되지 않은 이름 '${name}' 입니다.`);
}

// ---------------------------------------------------------------------------
//  연산자
// ---------------------------------------------------------------------------
function compileBinary(node, ctx) {
  const { operator } = node;

  if (operator === 'and' || operator === 'or') {
    const left = compileBoolean(node.left, ctx);
    const right = compileBoolean(node.right, ctx);
    if (!left || !right) return null;
    return ctx.block('boolean_and_or', [left, operator === 'and' ? 'AND' : 'OR', right]);
  }

  if (COMPARE_OPERATORS[operator]) return compileComparison(node, ctx);

  if (ARITHMETIC_OPERATORS[operator]) {
    const left = compileValue(node.left, ctx);
    const right = compileValue(node.right, ctx);
    if (!left || !right) return null;
    return ctx.block('calc_basic', [left, ARITHMETIC_OPERATORS[operator], right]);
  }

  if (operator === '%' || operator === '//') {
    const left = compileValue(node.left, ctx);
    const right = compileValue(node.right, ctx);
    if (!left || !right) return null;
    const action = operator === '%' ? 'MOD' : 'QUOTIENT';
    return ctx.block('quotient_and_mod', [null, left, null, right, null, action]);
  }

  if (operator === '**') return compilePower(node, ctx);

  return ctx.error(node, `연산자 '${operator}' 를 엔트리 블록으로 바꿀 수 없습니다.`);
}

/**
 * 상수만으로 이루어진 식이면 그 값을, 아니면 null 을 돌려준다.
 * (`x ** (1/3)` 처럼 지수를 계산해서 적을 수 있게 하기 위한 것)
 */
export function foldConstant(node) {
  if (!node) return null;
  switch (node.type) {
    case 'Number': return node.value;
    case 'Unary': {
      if (node.operator !== '-') return null;
      const value = foldConstant(node.argument);
      return value === null ? null : -value;
    }
    case 'Binary': {
      const left = foldConstant(node.left);
      const right = foldConstant(node.right);
      if (left === null || right === null) return null;
      switch (node.operator) {
        case '+': return left + right;
        case '-': return left - right;
        case '*': return left * right;
        case '/': return right === 0 ? null : left / right;
        case '%': return right === 0 ? null : left % right;
        case '//': return right === 0 ? null : Math.floor(left / right);
        case '**': return left ** right;
        default: return null;
      }
    }
    default: return null;
  }
}

/** 소수부를 몇 자리까지 이진 전개할지 (2^-20 ≈ 0.000001) */
const FRACTION_BITS = 20;

/**
 * 엔트리에는 일반 거듭제곱 블록이 없다. 있는 것은 제곱(square)과 제곱근(root)뿐이다.
 * 그런데 이 둘만으로 모든 실수 지수를 만들 수 있다.
 *
 *   정수부  x^13 = ((x^2)^2 · x)^2 · x        (제곱과 곱셈으로, 자릿수만큼만)
 *   소수부  x^0.b1b2b3… = √(x^b1 · √(x^b2 · √(x^b3 · …)))
 *
 * 소수부 전개는 지수를 2배씩 하며 1이 넘는지 보는 이진 전개다.
 * 0.5, 0.25, 0.75 처럼 2의 거듭제곱으로 떨어지는 지수는 **정확히** 맞고,
 * 1/3 같은 무한소수는 20자리에서 끊어 사실상 같은 값(오차 10^-6 수준)이 된다.
 *
 * 반복 블록을 쓰지 않는 이유: 엔트리 반복은 한 번 돌 때마다 프레임을 넘긴다.
 * 값을 구하는 식이 여러 프레임에 걸치면 안 되므로 컴파일할 때 펼쳐 둔다.
 */
function compilePower(node, ctx) {
  const exponent = foldConstant(node.right);
  if (exponent === null) {
    return ctx.error(
      node,
      '거듭제곱의 지수는 숫자로 정해져 있어야 합니다. (엔트리에는 거듭제곱 블록이 없어서 컴파일할 때 펼쳐 넣습니다)',
    );
  }
  return buildPower(node.left, exponent, node, ctx);
}

/**
 * 밑(baseNode)의 exponent 제곱을 블록 트리로 만든다.
 * 지수에 따라 밑이 여러 번 들어가므로, 값이 매번 달라지는 random() 은 막는다.
 */
export function buildPower(baseNode, exponent, node, ctx) {
  if (!Number.isFinite(exponent)) return ctx.error(node, '거듭제곱의 지수가 올바르지 않습니다.');
  if (exponent === 0) return ctx.number(1);

  if (exponent < 0) {
    const positive = buildPower(baseNode, -exponent, node, ctx);
    return positive && ctx.block('calc_basic', [ctx.number(1), 'DIVIDE', positive]);
  }

  let uses = 0;
  let failed = false;
  const base = () => {
    uses += 1;
    const compiled = compileValue(baseNode, ctx);
    if (!compiled) failed = true;
    return compiled;
  };
  const square = (value) => ctx.block('calc_operation', [null, value, null, 'square']);
  const root = (value) => ctx.block('calc_operation', [null, value, null, 'root']);
  const multiply = (left, right) => ctx.block('calc_basic', [left, 'MULTI', right]);

  const whole = Math.floor(exponent);
  const { bits, exact } = fractionBits(exponent - whole);
  const wholePart = integerPower(whole, base, square, multiply);
  const fractionPart = fractionPower(bits, 0, base, root, multiply);

  let result = wholePart && fractionPart ? multiply(wholePart, fractionPart) : wholePart ?? fractionPart;

  // 이진 전개가 딱 떨어지지 않았으면 남은 오차를 뉴턴 보정으로 지운다
  if (result && !exact) {
    const refiner = requirePowerRefiner(ctx);
    result = ctx.block(`func_${refiner.id}`, [result, base(), ctx.number(exponent)]);
  }

  if (failed) return null;
  if (uses > 1 && containsRandom(baseNode)) {
    return ctx.error(
      node,
      '이 지수는 밑을 여러 번 써야 해서 random() 이 들어간 값에는 쓸 수 없습니다. 변수에 먼저 담아 두고 쓰세요.',
    );
  }

  return result ?? ctx.number(1);
}

/** x^n 을 제곱과 곱셈으로. n 이 0이면 null(=1) */
function integerPower(n, base, square, multiply) {
  if (n <= 0) return null;
  if (n === 1) return base();
  const half = integerPower(Math.floor(n / 2), base, square, multiply);
  const squared = square(half);
  return n % 2 === 1 ? multiply(squared, base()) : squared;
}

/** 소수부를 이진 전개해서 √ 중첩으로. 남은 자리가 모두 0이면 null(=1) */
function fractionPower(bits, index, base, root, multiply) {
  if (index >= bits.length) return null;
  const rest = fractionPower(bits, index + 1, base, root, multiply);
  let inner = rest;
  if (bits[index] === 1) inner = rest ? multiply(base(), rest) : base();
  return inner ? root(inner) : null;
}

/**
 * 0 <= fraction < 1 을 이진 소수로. 뒤쪽 0은 버린다.
 * 자릿수 안에서 딱 떨어졌으면 exact 가 true 다 (0.5, 0.25, 0.75 …).
 */
function fractionBits(fraction) {
  const bits = [];
  let rest = fraction;
  while (bits.length < FRACTION_BITS && rest > 0) {
    rest *= 2;
    if (rest >= 1) {
      bits.push(1);
      rest -= 1;
    } else {
      bits.push(0);
    }
  }
  while (bits.length > 0 && bits[bits.length - 1] === 0) bits.pop();
  return { bits, exact: rest === 0 };
}

/** 밑을 두 번 이상 쓰면 값이 달라지는 식인지 */
function containsRandom(node) {
  if (node === null || typeof node !== 'object') return false;
  if (Array.isArray(node)) return node.some(containsRandom);
  if (node.type === 'Call' && (node.callee === 'random' || node.callee === 'random_color')) return true;
  return Object.entries(node).some(([key, value]) => key !== 'loc' && containsRandom(value));
}

function compileComparison(node, ctx) {
  const operator = COMPARE_OPERATORS[node.operator];

  // type(x) == "number" -> 엔트리의 "~이 숫자인가?" 판단 블록
  const typeCheck = matchTypeCheck(node);
  if (typeCheck) {
    const value = compileValue(typeCheck.value, ctx);
    if (!value) return null;
    const kind = { number: 'number', string: 'en', boolean: 'en', list: 'en' }[typeCheck.kind];
    if (!kind) return ctx.error(node, `type() 비교값은 "number" 만 엔트리 블록으로 바꿀 수 있습니다.`);
    const check = ctx.block('is_type', [value, null, kind, null]);
    return node.operator === '==' ? check : ctx.block('boolean_not', [null, check, null]);
  }

  // device == "mobile" -> "~ 기기인가?" 판단 블록
  const deviceCheck = matchDeviceCheck(node);
  if (deviceCheck) {
    if (!['desktop', 'tablet', 'mobile'].includes(deviceCheck)) {
      return ctx.error(node, `device 는 "desktop", "tablet", "mobile" 하고만 비교할 수 있습니다.`);
    }
    const check = ctx.block('is_current_device_type', [deviceCheck]);
    return node.operator === '==' ? check : ctx.block('boolean_not', [null, check, null]);
  }

  const left = compileValue(node.left, ctx);
  const right = compileValue(node.right, ctx);
  if (!left || !right) return null;
  return ctx.block('boolean_basic_operator', [left, operator, right]);
}

function matchTypeCheck(node) {
  if (node.operator !== '==' && node.operator !== '!=') return null;
  for (const [call, other] of [[node.left, node.right], [node.right, node.left]]) {
    if (call.type === 'Call' && call.callee === 'type' && other.type === 'String') {
      return { value: call.arguments[0], kind: other.value };
    }
  }
  return null;
}

function matchDeviceCheck(node) {
  if (node.operator !== '==' && node.operator !== '!=') return null;
  for (const [id, other] of [[node.left, node.right], [node.right, node.left]]) {
    if (id.type === 'Identifier' && id.name === 'device' && other.type === 'String') return other.value;
  }
  return null;
}

function compileUnary(node, ctx) {
  if (node.operator === 'not') {
    const value = compileBoolean(node.argument, ctx);
    return value && ctx.block('boolean_not', [null, value, null]);
  }
  // -x : 숫자 리터럴이면 그대로 접어버리고, 아니면 0 - x
  if (node.argument.type === 'Number') return ctx.number(-node.argument.value);
  const value = compileValue(node.argument, ctx);
  return value && ctx.block('calc_basic', [ctx.number(0), 'MINUS', value]);
}

// ---------------------------------------------------------------------------
//  인덱스 (리스트 · 문자열)
// ---------------------------------------------------------------------------
/** Tess 인덱스(0부터) -> 엔트리 인덱스(1부터) */
export function shiftIndex(node, ctx, delta = 1) {
  if (node.type === 'Number') return ctx.number(node.value + delta);
  const value = compileValue(node, ctx);
  if (!value) return null;
  return ctx.block('calc_basic', [value, delta > 0 ? 'PLUS' : 'MINUS', ctx.number(Math.abs(delta))]);
}

function compileIndex(node, ctx) {
  const list = resolveList(node.target, ctx);
  const index = shiftIndex(node.index, ctx);
  if (!index) return null;

  if (list) return ctx.block('value_of_index_from_list', [null, list.id, null, index, null]);

  const target = compileValue(node.target, ctx);
  return target && ctx.block('char_at', [null, target, null, index, null]);
}

/** 식별자가 리스트를 가리키면 그 엔트리 변수 항목을 돌려준다 */
export function resolveList(node, ctx) {
  if (!node || node.type !== 'Identifier') return null;
  const found = ctx.lookupVariable(node.name);
  if (found?.kind === 'variable' && found.entry.variableType === 'list') return found.entry;
  return null;
}

// ---------------------------------------------------------------------------
//  내장 함수 호출
// ---------------------------------------------------------------------------
function compileCall(node, ctx) {
  const { callee, arguments: args } = node;
  const arity = (count) => {
    if (args.length === count) return true;
    ctx.error(node, `${callee}() 는 인자가 ${count}개여야 합니다. (${args.length}개를 받았습니다)`);
    return false;
  };
  const value = (index) => compileValue(args[index], ctx);

  // 사용자 정의 함수
  const fn = ctx.functionByName.get(callee);
  if (fn) {
    if (!fn.isValue) {
      return ctx.error(node, `함수 '${callee}' 는 값을 돌려주지 않습니다. return 이 있는 함수만 값으로 쓸 수 있습니다.`);
    }
    if (args.length !== fn.params.length) {
      ctx.error(node, `함수 '${callee}' 는 인자가 ${fn.params.length}개여야 합니다.`);
      return null;
    }
    const params = args.map((arg) => compileValue(arg, ctx));
    if (params.some((p) => p === null)) return null;
    return ctx.block(`func_${fn.id}`, params);
  }

  if (MATH_OPERATIONS[callee]) {
    if (!arity(1)) return null;
    const argument = value(0);
    return argument && ctx.block('calc_operation', [null, argument, null, MATH_OPERATIONS[callee]]);
  }

  switch (callee) {
    case 'log2': {
      // 엔트리에는 밑이 2인 로그가 없다 -> ln(x) / ln(2)
      if (!arity(1)) return null;
      const argument = value(0);
      if (!argument) return null;
      return ctx.block('calc_basic', [
        ctx.block('calc_operation', [null, argument, null, 'ln']),
        'DIVIDE',
        ctx.block('calc_operation', [null, ctx.number(2), null, 'ln']),
      ]);
    }

    case 'random': {
      if (!arity(2)) return null;
      const from = value(0);
      const to = value(1);
      return from && to && ctx.block('calc_rand', [null, from, null, to, null]);
    }

    case 'root': {
      // n제곱근 = x ^ (1/n). 지수 규칙은 ** 와 같다.
      if (!arity(2)) return null;
      const degree = foldConstant(args[1]);
      if (degree === null || degree === 0) {
        return ctx.error(node, 'root(값, n) 의 n 은 0이 아닌 숫자로 정해져 있어야 합니다.');
      }
      return buildPower(args[0], 1 / degree, node, ctx);
    }

    case 'key_down': {
      if (!arity(1)) return null;
      const code = literalKeyCode(args[0], ctx, node);
      return code && ctx.block('is_press_some_key', [code, null]);
    }

    case 'touching': {
      if (!arity(1)) return null;
      const target = resolveTarget(args[0], ctx, { wall: true });
      return target && ctx.block('reach_something', [null, target, null]);
    }

    case 'type':
      return ctx.error(node, 'type() 은 == "number" 처럼 비교해서만 쓸 수 있습니다.');

    case 'distance': {
      if (!arity(1)) return null;
      const target = resolveTarget(args[0], ctx, { mouse: true });
      return target && ctx.block('distance_something', [null, target, null]);
    }

    case 'x': case 'y': case 'angle': case 'way': case 'size': {
      if (!arity(1)) return null;
      const coordinate = OBJECT_COORDINATES[callee];
      if (args[0].type === 'String' && args[0].value === 'mouse') {
        if (callee !== 'x' && callee !== 'y') {
          return ctx.error(node, `마우스는 x(), y() 만 조회할 수 있습니다.`);
        }
        return ctx.block('coordinate_mouse', [null, coordinate, null]);
      }
      const target = resolveTarget(args[0], ctx, { self: true });
      return target && ctx.block('coordinate_object', [null, target, null, coordinate]);
    }

    case 'text_content': {
      if (!arity(1)) return null;
      const target = resolveTarget(args[0], ctx, { self: true });
      return target && ctx.block('text_read', [target, null]);
    }

    case 'block_count': {
      if (!arity(1)) return null;
      const target = resolveTarget(args[0], ctx, { self: true, all: true });
      return target && ctx.block('get_block_count', [target]);
    }

    case 'length': {
      if (!arity(1)) return null;
      const list = resolveList(args[0], ctx);
      if (list) return ctx.block('length_of_list', [null, list.id, null]);
      const argument = value(0);
      return argument && ctx.block('length_of_string', [null, argument, null]);
    }

    case 'contains': {
      if (!arity(2)) return null;
      const list = resolveList(args[0], ctx);
      if (!list) return ctx.error(node, 'contains() 의 첫 번째 인자는 리스트여야 합니다.');
      const item = value(1);
      return item && ctx.block('is_included_in_list', [null, list.id, null, item, null]);
    }

    case 'slice': {
      // Tess: [start, end) 0부터 / 엔트리 substring: 1부터 양끝 포함
      if (!arity(3)) return null;
      const string = value(0);
      const start = shiftIndex(args[1], ctx, 1);
      const end = compileValue(args[2], ctx);
      return string && start && end && ctx.block('substring', [null, string, null, start, null, end, null]);
    }

    case 'count': {
      if (!arity(2)) return null;
      const string = value(0);
      const target = value(1);
      return string && target && ctx.block('count_match_string', [string, null, target, null]);
    }

    case 'join': {
      if (!arity(2)) return null;
      const first = value(0);
      const second = value(1);
      return first && second && ctx.block('combine_something', [null, first, null, second, null]);
    }

    case 'index_of': {
      // 엔트리는 1부터, 못 찾으면 0 -> 1을 빼면 Tess 의 0부터/-1 과 맞는다
      if (!arity(2)) return null;
      const string = value(0);
      const target = value(1);
      if (!string || !target) return null;
      return ctx.block('calc_basic', [
        ctx.block('index_of_string', [null, string, null, target, null]),
        'MINUS',
        ctx.number(1),
      ]);
    }

    case 'replace': {
      if (!arity(3)) return null;
      const string = value(0);
      const from = value(1);
      const to = value(2);
      return string && from && to
        && ctx.block('replace_string', [null, string, null, from, null, to, null]);
    }

    case 'reverse': {
      if (!arity(1)) return null;
      const argument = value(0);
      return argument && ctx.block('reverse_of_string', [null, argument, null]);
    }

    case 'uppercase': case 'lowercase': {
      if (!arity(1)) return null;
      const argument = value(0);
      const mode = callee === 'uppercase' ? 'toUpperCase' : 'toLowerCase';
      return argument && ctx.block('change_string_case', [null, argument, null, mode, null]);
    }

    case 'now': {
      if (!arity(1)) return null;
      const units = {
        year: 'YEAR', month: 'MONTH', day: 'DAY', hour: 'HOUR',
        minute: 'MINUTE', second: 'SECOND', weekday: 'DAY_OF_WEEK',
      };
      if (args[0].type !== 'String' || !units[args[0].value]) {
        return ctx.error(node, 'now() 는 "year", "month", "day", "hour", "minute", "second", "weekday" 만 받습니다.');
      }
      return ctx.block('get_date', [null, units[args[0].value], null]);
    }

    case 'to_hex': {
      if (!arity(3)) return null;
      const red = value(0);
      const green = value(1);
      const blue = value(2);
      return red && green && blue && ctx.block('change_rgb_to_hex', [red, green, blue]);
    }

    case 'from_hex': {
      if (!arity(2)) return null;
      const channels = { red: 'r', green: 'g', blue: 'b' };
      const channel = args[1].type === 'Identifier' ? channels[args[1].name] : null;
      if (!channel) return ctx.error(node, 'from_hex() 의 두 번째 인자는 red, green, blue 중 하나여야 합니다.');
      const color = value(0);
      return color && ctx.block('change_hex_to_rgb', [color, channel]);
    }

    case 'random_color':
      return ctx.error(node, 'random_color() 는 draw_color = random_color() 형태로만 쓸 수 있습니다.');

    default:
      return ctx.error(node, `알 수 없는 함수 '${callee}' 입니다.`);
  }
}

function literalKeyCode(node, ctx, at) {
  if (node.type !== 'String') return ctx.error(at, '키 이름은 "space" 처럼 문자열로 직접 적어야 합니다.');
  const code = keyCodeOf(node.value);
  return code ?? ctx.error(at, `알 수 없는 키 이름 "${node.value}" 입니다.`);
}

/**
 * 오브젝트를 가리키는 인자를 엔트리 id 로 바꾼다.
 * "mouse"/"wall" 같은 특수 대상은 옵션으로 허용한다.
 */
export function resolveTarget(node, ctx, options = {}) {
  if (!node || node.type !== 'String') {
    return ctx.error(node ?? { loc: null }, '오브젝트 이름은 "player" 처럼 문자열로 직접 적어야 합니다.');
  }
  const name = node.value;

  if (name === 'mouse') return 'mouse';
  if (options.wall && name.startsWith('wall')) return name;
  if (options.self && (name === 'self' || name === 'this')) return 'self';
  if (options.all && name === 'all') return 'all';

  const id = ctx.objectId(name);
  return id ?? ctx.error(node, `'${name}' 이라는 오브젝트가 없습니다.`);
}
