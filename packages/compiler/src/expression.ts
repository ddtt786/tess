/**
 * @fileoverview Tess 표현식을 엔트리 값(value) 블록으로 변환하는 모듈입니다.
 * 
 * 주요 차이점 주의:
 * - 리스트/문자열 인덱스, slice, index_of: Tess와 엔트리 모두 1부터 시작합니다.
 *   따라서 위치값을 변경 없이 그대로 변환합니다. (검색 실패 시 0, slice는 양끝 포함)
 */
import { KEY_CODES, keyCodeOf } from '@tess/core';
import { didYouMean, orHint } from '@tess/core';
import { requirePowerRefiner } from './runtime.ts';
import { BUILTIN_FUNCTIONS, OPTION_KEYWORDS, STATE_VALUES } from '@tess/core';
import { expansionBlock } from '@tess/core';
import type {
  BinaryNode, CallNode, Expr, IndexNode, Node, UnaryNode,
} from '@tess/parser';
import type { Context } from './context.ts';
import type {
  CompiledFunction, EntryBlock, EntryParam, EntryVariable,
} from './types.ts';

/** 
 * `resolveTarget` 함수가 오브젝트의 고유 이름 외에 추가로 허용하는 대상 옵션들입니다. 
 * @example
 * const options: TargetOptions = { mouse: true, wall: true };
 */
interface TargetOptions {
  wall?: boolean;
  self?: boolean;
  all?: boolean;
  mouse?: boolean;
}

/** 변환 결과가 엔트리의 "판단(boolean)" 블록 형태가 되는 블록 타입들의 집합입니다. */
const BOOLEAN_TYPES = new Set([
  'True', 'False',
  'boolean_basic_operator', 'boolean_and_or', 'boolean_not',
  'is_clicked', 'is_object_clicked', 'is_press_some_key', 'reach_something',
  'is_type', 'is_boost_mode', 'is_current_device_type', 'is_touch_supported',
  'is_included_in_list',
]);

// 계산할 필요 없이 값이 정해지는 리터럴들이다. 판단 자리에 오면 참으로 본다.
const LITERAL_TYPES = new Set(['Number', 'String', 'Color', 'Transparent']);

/**
 * Tess의 참/거짓(true/false) 값을 엔트리 블록 시스템에서 사용하는 문자열("TRUE"/"FALSE")로 매핑합니다.
 * 
 * 엔트리의 `(<판단>의 값)`(get_boolean_value) 블록은 판단 결과를 이 문자열로 반환하기 때문에,
 * 리터럴이든 비교 연산의 결과든 일관성 있게 같은 문자열이 나오도록 맞추는 데 사용됩니다.
 * 
 * @example
 * const trueString = BOOLEAN_TEXT.true; // "TRUE"
 */
export const BOOLEAN_TEXT: Record<string, string> = { true: 'TRUE', false: 'FALSE' };

const COMPARE_OPERATORS: Record<string, string> = {
  '==': 'EQUAL', '!=': 'NOT_EQUAL',
  '>': 'GREATER', '<': 'LESS',
  '>=': 'GREATER_OR_EQUAL', '<=': 'LESS_OR_EQUAL',
};

const ARITHMETIC_OPERATORS: Record<string, string> = { '+': 'PLUS', '-': 'MINUS', '*': 'MULTI', '/': 'DIVIDE' };

/** 엔트리의 `calc_operation` 블록으로 일대일 변환이 가능한 단항 수학 함수들의 매핑입니다. */
const MATH_OPERATIONS: Record<string, string> = {
  sin: 'sin', cos: 'cos', tan: 'tan',
  asin: 'asin_radian', acos: 'acos_radian', atan: 'atan_radian',
  ln: 'ln', log10: 'log',
  floor: 'floor', ceil: 'ceil', round: 'round', abs: 'abs',
};

/**
 * 특정 오브젝트의 정보를 조회할 때 `coordinate_object` 블록의 조회 속성(COORDINATE)으로 사용할 값들의 매핑입니다.
 * 
 * X, Y, 방향, 이동방향, 크기 외에도 모양 번호(picture_index)와 모양 이름(picture_name)을 
 * 지원하여 다른 오브젝트의 모양 정보도 쉽게 읽어올 수 있도록 매핑합니다.
 */
const OBJECT_COORDINATES: Record<string, string> = {
  x: 'x', y: 'y', angle: 'rotation', way: 'direction', size: 'size',
  costume: 'picture_name', costume_number: 'picture_index',
};

/** 괄호 없이 식별자만으로 조회할 수 있는 읽기 전용 전역 상태 값들의 매핑입니다. */
const STATE_BLOCKS: Record<string, string> = {
  mouse_down: 'is_clicked',
  clicked: 'is_object_clicked',
  boost_mode: 'is_boost_mode',
  touchable: 'is_touch_supported',
  user_id: 'get_user_name',
  nickname: 'get_nickname',
  timer: 'get_project_timer_value',
  answer: 'get_canvas_input_value',
};

/** 자신(self)의 속성을 괄호 없이 조회할 때 사용되는 `coordinate_object`의 속성 매핑입니다. */
const PROPERTY_COORDINATES: Record<string, string> = {
  x: 'x', y: 'y', angle: 'rotation', way: 'direction', size: 'size',
  costume: 'picture_name', costume_number: 'picture_index',
};

export function isBooleanBlock(node: EntryParam): boolean {
  if (!node || typeof node !== 'object') return false;
  const { type } = node as EntryBlock;
  if (expansionBlock(type)?.kind === 'boolean') return true;
  // 판단 매개변수(`이름?`)를 가리키는 블록은 함수마다 타입 이름이 다르므로 접두사로 가린다
  return BOOLEAN_TYPES.has(type) || String(type).startsWith('booleanParam_');
}

/**
 * 주어진 표현식을 엔트리의 판단(boolean) 자리에 들어갈 수 있는 블록으로 컴파일합니다.
 * 
 * true/false 리터럴은 참/거짓 블록으로, 그 외의 리터럴은 참으로 처리합니다.
 * 실행 전까지 결과를 알 수 없는 일반 값 표현식은 `== "TRUE"` 형태의 비교 블록으로 감싸 판단 블록으로 만듭니다.
 *
 * @param node - 컴파일할 AST 노드
 * @param ctx - 현재 컴파일 컨텍스트
 * @returns 판단 타입의 엔트리 블록 객체
 * @example
 * const block = compileBoolean(exprNode, ctx);
 */
export function compileBoolean(node: Expr | null | undefined, ctx: Context): EntryBlock | null {
  if (node?.type === 'Boolean') return ctx.block(node.value ? 'True' : 'False', [null]);
  if (node && LITERAL_TYPES.has(node.type)) return ctx.block('True', [null]);

  const compiled = compileAnyValue(node, ctx);
  if (compiled === null) return null;
  if (isBooleanBlock(compiled)) return compiled;
  return ctx.block('boolean_basic_operator', [compiled, 'EQUAL', ctx.text(BOOLEAN_TEXT.true)]);
}

/**
 * 주어진 표현식을 일반 값(value) 자리에 들어갈 수 있는 엔트리 블록으로 컴파일합니다.
 * 
 * 컴파일 결과가 판단(boolean) 블록인 경우, 이를 엔트리의 `(<판단>의 값)` 블록으로
 * 감싸서 최종적으로 "TRUE" 또는 "FALSE" 문자열 값이 반환되도록 변환합니다.
 *
 * @param node - 컴파일할 AST 노드
 * @param ctx - 현재 컴파일 컨텍스트
 * @returns 값 타입의 엔트리 블록 객체
 * @example
 * const valueBlock = compileValue(exprNode, ctx);
 */
export function compileValue(node: Expr | null | undefined, ctx: Context): EntryBlock | null {
  const compiled = compileAnyValue(node, ctx);
  if (compiled === null) return null;
  return isBooleanBlock(compiled) ? ctx.block('get_boolean_value', [compiled]) : compiled;
}

/**
 * 표현식을 가장 원형에 가까운 엔트리 블록으로 컴파일하여 반환합니다.
 * 
 * 결과가 값 블록일지 판단(boolean) 블록일지 확정되지 않은 상태로 반환합니다.
 * 값이나 판단이 모두 올 수 있는 위치(예: `wait` 블록 등)에서 내부적으로 직접 호출됩니다.
 *
 * @param node - 컴파일할 AST 노드
 * @param ctx - 현재 컴파일 컨텍스트
 * @returns 변환된 엔트리 블록 객체
 * @example
 * const rawBlock = compileAnyValue(exprNode, ctx);
 */
export function compileAnyValue(node: Expr | null | undefined, ctx: Context): EntryBlock | null {
  if (!node) return null;
  switch (node.type) {
    case 'Number': return ctx.number(node.value);
    case 'String': return ctx.text(node.value);
    case 'Boolean': return ctx.block(node.value ? 'True' : 'False', [null]);
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
function compileIdentifier(node: Node & { name: string }, ctx: Context): EntryBlock | null {
  const { name } = node;

  const found = ctx.lookupVariable(name);
  if (found) {
    if (found.kind === 'ambiguousLocal') return ambiguousLocalError(node, found, ctx);
    if (found.kind === 'param') {
      const type = ctx.funcScope!.params.get(name)!;
      // 판단 칸 매개변수 블록은 엔트리가 만든 원본에서도 빈 자리를 하나 갖는다
      return ctx.block(type, type.startsWith('booleanParam_') ? [null] : []);
    }
    if (found.kind === 'funcLocal') return ctx.block('get_func_variable', [found.id, null]);
    // Entry keeps variables and lists in separate containers, so a variable
    // block holding a list id finds nothing at run time. Works that renamed a
    // variable into a list still carry such blocks; they compile back as they
    // were, under a warning, rather than failing the whole build.
    if (found.entry.variableType === 'list') {
      ctx.warn(node, `리스트 '${name}' 을(를) 값으로 바로 썼습니다. 실행할 때 값을 찾지 못합니다 — ${name}[i] 처럼 항목을 지정하세요.`);
    }
    return ctx.block('get_variable', [found.entry.id, null]);
  }

  if (name === 'block_count') return ctx.block('get_block_count', ['all']);
  if (STATE_BLOCKS[name]) {
    // 블록마다 파라미터 자리 개수가 다르다 (엔트리 블록 스키마 기준)
    const slots: Record<string, number> = { get_nickname: 0, get_user_name: 0, get_project_timer_value: 2 };
    const count = slots[STATE_BLOCKS[name]!] ?? 1;
    return ctx.block(STATE_BLOCKS[name]!, new Array(count).fill(null));
  }
  if (name === 'device') {
    return ctx.error(node, "device 는 홀로 쓸 수 없습니다. device == \"mobile\" 처럼 비교해서 쓰세요.");
  }
  if (PROPERTY_COORDINATES[name]) {
    return ctx.block('coordinate_object', [null, 'self', null, PROPERTY_COORDINATES[name]!]);
  }
  if (name === 'sound_volume') return ctx.block('get_sound_volume', [null]);
  if (name === 'sound_speed') return ctx.block('get_sound_speed', [null]);
  if (OPTION_KEYWORDS.has(name) || STATE_VALUES.has(name)) {
    return ctx.error(node, `'${name}' 은(는) 이 자리에서 값으로 쓸 수 없습니다.`);
  }
  return ctx.error(node, `선언되지 않은 이름 '${name}' 입니다.${didYouMean(name, ctx.knownNames())}`);
}

/**
 * 여러 오브젝트에서 동일한 이름으로 선언된 지역 변수를 모호한 위치에서 사용할 때 발생하는 오류를 보고합니다.
 * 
 * @param node - 오류가 발생한 AST 노드
 * @param found - 찾은 변수명과 해당 변수를 소유한 오브젝트 이름 목록
 * @param ctx - 현재 컴파일 컨텍스트
 * @returns 항상 null을 반환하며 컨텍스트에 오류를 기록합니다.
 */
export function ambiguousLocalError(node: Node, found: { name: string; owners: string[] }, ctx: Context): null {
  return ctx.error(
    node,
    `'${found.name}' 은(는) ${found.owners.join(', ')} 가 저마다 가진 지역 변수라 어느 것인지 알 수 없습니다. `
    + '이 함수를 그 오브젝트 안에 선언하거나, 값을 매개변수로 전달하세요.',
  );
}

// ---------------------------------------------------------------------------
//  연산자
// ---------------------------------------------------------------------------
function compileBinary(node: BinaryNode, ctx: Context): EntryBlock | null {
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
    return ctx.block('calc_basic', [left, ARITHMETIC_OPERATORS[operator]!, right]);
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
 * 표현식이 상수들로만 이루어져 있는 경우 미리 계산(Fold)하여 그 값을 반환합니다.
 * 변수나 런타임에 결정되는 값이 포함되어 있으면 null을 반환합니다.
 * 
 * (예: `x ** (1/3)` 같은 수식에서 지수 부분을 미리 계산해 두기 위한 용도로 사용됩니다.)
 *
 * @param node - 평가할 표현식 AST 노드
 * @returns 상수 값, 미리 계산할 수 없으면 null
 * @example
 * const result = foldConstant(exprNode); // 1.5 또는 null
 */
export function foldConstant(node: Expr | null | undefined): number | null {
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

/** 
 * 소수부 계산 시 이진 전개할 최대 비트 수입니다. (20비트는 약 0.000001의 정밀도입니다.) 
 */
const FRACTION_BITS = 20;

/**
 * 거듭제곱 연산을 제곱(square)과 제곱근(root) 연산의 조합으로 변환합니다.
 * 
 * 엔트리에는 임의의 거듭제곱을 수행하는 내장 블록이 없으므로, 모든 실수 지수를
 * 제곱과 제곱근 블록을 중첩하여 계산하는 구조로 펼쳐서 컴파일합니다.
 * 
 * - 정수부: 자릿수만큼 제곱과 곱셈을 반복하여 전개합니다.
 * - 소수부: 이진 소수로 전개한 뒤, 제곱근을 겹쳐서 전개합니다. 
 *   (예: 0.5, 0.25 등은 정확히 떨어지며 무한소수는 20자리에서 절사하여 오차를 줄입니다.)
 *
 * 컴파일 시점에 블록 트리로 모두 펼치는 이유는, 엔트리의 반복 블록이 프레임을 소모하기 때문에
 * 하나의 표현식이 여러 프레임에 걸쳐 계산되는 것을 방지하기 위함입니다.
 *
 * @param node - 거듭제곱 이항 연산 노드
 * @param ctx - 현재 컴파일 컨텍스트
 * @returns 전개된 거듭제곱 엔트리 블록
 */
function compilePower(node: BinaryNode, ctx: Context): EntryBlock | null {
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
 * 밑(base)과 지수(exponent)를 바탕으로 거듭제곱을 수행하는 블록 트리를 생성합니다.
 * 
 * 지수 계산 과정에서 밑에 해당하는 블록이 여러 번 복제되어 사용되므로,
 * `random()`과 같이 호출할 때마다 값이 달라지는 표현식은 사용할 수 없도록 검증합니다.
 *
 * @param baseNode - 밑에 해당하는 AST 노드
 * @param exponent - 지수 값 (숫자)
 * @param node - 오류 보고용 원본 AST 노드
 * @param ctx - 현재 컴파일 컨텍스트
 * @returns 거듭제곱 처리가 완료된 엔트리 블록
 */
export function buildPower(
  baseNode: Expr,
  exponent: number,
  node: Node,
  ctx: Context,
): EntryBlock | null {
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
    // `failed` is what the caller checks; a placeholder keeps the tree building.
    return compiled ?? ctx.number(1);
  };
  const square = (value: EntryBlock) => ctx.block('calc_operation', [null, value, null, 'square']);
  const root = (value: EntryBlock) => ctx.block('calc_operation', [null, value, null, 'root']);
  const multiply = (left: EntryBlock, right: EntryBlock) => ctx.block('calc_basic', [left, 'MULTI', right]);

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

/** 정수부를 제곱과 곱셈으로 전개합니다. 지수가 0이면 null(결과적으로 1)을 반환합니다. */
function integerPower(
  n: number,
  base: () => EntryBlock,
  square: (value: EntryBlock) => EntryBlock,
  multiply: (left: EntryBlock, right: EntryBlock) => EntryBlock,
): EntryBlock | null {
  if (n <= 0) return null;
  if (n === 1) return base();
  const half = integerPower(Math.floor(n / 2), base, square, multiply)!;
  const squared = square(half);
  return n % 2 === 1 ? multiply(squared, base()) : squared;
}

/** 소수부를 이진 전개하여 제곱근(√) 중첩으로 전개합니다. 남은 자리가 모두 0이면 null(=1)을 반환합니다. */
function fractionPower(
  bits: number[],
  index: number,
  base: () => EntryBlock,
  root: (value: EntryBlock) => EntryBlock,
  multiply: (left: EntryBlock, right: EntryBlock) => EntryBlock,
): EntryBlock | null {
  if (index >= bits.length) return null;
  const rest = fractionPower(bits, index + 1, base, root, multiply);
  let inner = rest;
  if (bits[index] === 1) inner = rest ? multiply(base(), rest) : base();
  return inner ? root(inner) : null;
}

/**
 * 0 이상 1 미만의 소수값을 이진 소수 배열로 변환합니다. 끝에 남는 0은 제거합니다.
 * 계산 범위 내에서 정확하게 떨어지는 경우(예: 0.5, 0.25) `exact` 플래그가 true가 됩니다.
 * 
 * @param fraction - 변환할 0 이상 1 미만의 실수
 * @returns 이진 전개된 비트 배열과 정확도 여부를 포함하는 객체
 * @example
 * const { bits, exact } = fractionBits(0.625); // bits: [1, 0, 1], exact: true
 */
function fractionBits(fraction: number): { bits: number[]; exact: boolean } {
  const bits: number[] = [];
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

/** 표현식 내부에 평가할 때마다 값이 달라지는 요소(예: random)가 포함되어 있는지 확인합니다. */
function containsRandom(node: unknown): boolean {
  if (node === null || typeof node !== 'object') return false;
  if (Array.isArray(node)) return node.some(containsRandom);
  const call = node as { type?: string; callee?: string };
  if (call.type === 'Call' && (call.callee === 'random' || call.callee === 'random_color')) return true;
  return Object.entries(node).some(([key, value]) => key !== 'loc' && containsRandom(value));
}

function compileComparison(node: BinaryNode, ctx: Context): EntryBlock | null {
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

function matchTypeCheck(node: BinaryNode): { value: Expr; kind: string } | null {
  if (node.operator !== '==' && node.operator !== '!=') return null;
  for (const [call, other] of [[node.left, node.right], [node.right, node.left]]) {
    if (call.type === 'Call' && call.callee === 'type' && other.type === 'String') {
      return { value: call.arguments[0], kind: other.value };
    }
  }
  return null;
}

function matchDeviceCheck(node: BinaryNode): string | null {
  if (node.operator !== '==' && node.operator !== '!=') return null;
  for (const [id, other] of [[node.left, node.right], [node.right, node.left]]) {
    if (id.type === 'Identifier' && id.name === 'device' && other.type === 'String') return other.value;
  }
  return null;
}

function compileUnary(node: UnaryNode, ctx: Context): EntryBlock | null {
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
function compileIndex(node: IndexNode, ctx: Context): EntryBlock | null {
  // On a table, `표[2, "점수"]` reads one cell by row and column, and
  // `표["B2"]` reads it by the spreadsheet-style name Entry shows in its editor.
  const table = node.target.type === 'Identifier' && ctx.tableByName.get(node.target.name);
  if (table) {
    const first = compileValue(node.index, ctx);
    if (!first) return null;
    if (!node.column) return ctx.block('get_value_from_cell', [table.id, first, null]);
    const column = compileValue(node.column, ctx);
    return column === null ? null : ctx.block('get_value_from_table', [table.id, first, column, null]);
  }
  if (node.column) {
    const label = node.target.type === 'Identifier' ? node.target.name : '';
    return ctx.error(node, `'${label}' 은(는) 테이블이 아니라서 [행, 열] 로 읽을 수 없습니다.`);
  }

  const list = resolveList(node.target, ctx);
  const index = compileValue(node.index, ctx);
  if (!index) return null;

  if (list) return ctx.block('value_of_index_from_list', [null, list.id, null, index, null]);

  const target = compileValue(node.target, ctx);
  return target === null ? null : ctx.block('char_at', [null, target, null, index, null]);
}

/**
 * 사용자 정의 함수 호출 시 전달할 매개변수 블록들을 컴파일합니다.
 * 
 * `이름?`과 같이 판단 칸으로 선언된 자리는 판단(boolean) 블록만 들어갈 수 있으므로
 * `compileBoolean`을 사용하고, 나머지 자리는 일반 값으로 변환하여 채웁니다.
 *
 * @param fn - 대상 사용자 정의 함수의 메타데이터
 * @param args - 전달할 인자 표현식 목록
 * @param ctx - 현재 컴파일 컨텍스트
 * @returns 컴파일된 매개변수 엔트리 블록들의 배열
 */
export function compileCallArguments(
  fn: CompiledFunction,
  args: Expr[],
  ctx: Context,
): Array<EntryBlock | null> {
  return args.map((arg, index) => (fn.booleanParams?.has(fn.params[index]!)
    ? compileBoolean(arg, ctx)
    : compileValue(arg, ctx)));
}

/**
 * 소리 이름을 엔트리의 고유 리소스 ID로 변환합니다. (블록이 아니라 드롭다운 필드 값으로 사용됨)
 * `play sound` 블록과 달리 `get_sound_duration` 블록의 값은 필드 형태이므로 ID를 직접 주입합니다.
 * 
 * @param node - 소리 이름이 담긴 문자열 노드
 * @param ctx - 현재 컴파일 컨텍스트
 * @returns 소리의 엔트리 ID, 없으면 원본 이름 또는 null
 */
function resolveSoundValue(node: Expr, ctx: Context): string | null {
  if (node.type !== 'String') {
    return ctx.error(node, 'sound_duration() 은 소리 이름을 문자열로 적어야 합니다.');
  }
  const sound = ctx.object?.sounds.get(node.value);
  if (sound) return sound.id;
  // force id 로 고정해 둔 진짜 엔트리 id 면 그대로 흘려보낸다 (resolveSound 와 같은 이유)
  if (ctx.forcedResourceIds.has(node.value)) return node.value;
  // 전역 함수는 기준 오브젝트가 없다 — 이 이름을 가진 오브젝트가 하나뿐이면 그대로 가리킨다.
  // A global function has no one object to resolve against. Entry reads this
  // field as id, then name, then index, so leaving the name is what works when
  // several objects — or none yet — carry a sound by that name.
  if (!ctx.object) {
    const found = ctx.lookupObjectResource('sounds', node.value);
    if (found?.kind === 'found') return found.asset.id;
    if (!found) ctx.warn(node, `'${node.value}' 소리가 어느 오브젝트에도 없습니다. 실행할 때 이름으로 찾습니다.`);
    return node.value;
  }
  return ctx.error(node, `'${node.value}' 소리가 이 오브젝트에 없습니다.`
    + orHint(node.value, ctx.object?.sounds.keys() ?? [],
      `sound ${node.value} "파일명" 으로 먼저 등록하세요.`));
}

/** 식별자가 리스트를 가리키고 있을 경우 해당 리스트의 엔트리 변수 항목을 반환합니다. */
export function resolveList(node: Expr | null | undefined, ctx: Context): EntryVariable | null {
  if (!node || node.type !== 'Identifier') return null;
  const found = ctx.lookupVariable(node.name);
  if (found?.kind === 'variable' && found.entry.variableType === 'list') return found.entry;
  return null;
}

// ---------------------------------------------------------------------------
//  내장 함수 호출
// ---------------------------------------------------------------------------
/** 엔트리의 "테이블의 () 값" 블록이 계산할 수 있는 테이블 열 요약 연산들의 매핑입니다. */
const TABLE_CALCULATIONS: Record<string, string> = {
  sum: 'SUM', average: 'AVG', maximum: 'MAX', minimum: 'MIN',
  stdev: 'STDEV', median: 'MEDIAN',
};

/** 연산 함수가 호출된 대상 테이블을 반환하거나, 테이블이 아닐 경우 오류를 보고합니다. */
function tableArgument(node: Expr, callee: string, ctx: Context) {
  const table = node.type === 'Identifier' && ctx.tableByName.get(node.name);
  return table || ctx.error(node, `${callee}() 의 첫 번째 인자는 테이블이어야 합니다.`
    + didYouMean(node.type === 'Identifier' ? node.name : '', ctx.tableByName.keys()));
}

/**
 * 확장 블록 호출을 컴파일합니다.
 * 
 * 드롭다운 슬롯은 고정된 값이 들어가야 하므로 문자열 리터럴로 직접 작성해야 하며,
 * 값 슬롯만 일반 표현식을 받습니다. 사용된 확장 모듈은 `project.expansionBlocks`에
 * 기록되어 런타임에 엔트리가 해당 모듈을 불러오도록 합니다.
 * 
 * @param node - 컴파일할 확장 블록 호출 노드
 * @param ctx - 현재 컴파일 컨텍스트
 * @returns 컴파일된 확장 엔트리 블록
 */
function compileExpansion(node: CallNode, ctx: Context): EntryBlock | null {
  const { callee, arguments: args } = node;
  const { module, slots } = expansionBlock(callee)!;
  if (args.length !== slots.length) {
    return ctx.error(node, `${callee}() 는 인자가 ${slots.length}개여야 합니다. (${args.length}개를 받았습니다)`);
  }

  const params = slots.map((slot, index): EntryParam => {
    const argument = args[index]!;
    if (slot === 'value') return compileValue(argument, ctx);
    if (argument.type === 'String') return argument.value;
    if (argument.type === 'Number') return String(argument.value);
    return ctx.error(argument, `${callee}() 의 ${index + 1}번째 칸은 목록에서 고르는 자리라 "..." 로 직접 적어야 합니다.`);
  });
  if (params.some((param) => param === null)) return null;

  ctx.expansionBlocks.add(module);
  return ctx.block(callee, params);
}

function compileCall(node: CallNode, ctx: Context): EntryBlock | null {
  const { callee, arguments: args } = node;
  const arity = (count: number) => {
    if (args.length === count) return true;
    ctx.error(node, `${callee}() 는 인자가 ${count}개여야 합니다. (${args.length}개를 받았습니다)`);
    return false;
  };
  const value = (index: number) => compileValue(args[index], ctx);

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
    const params = compileCallArguments(fn, args, ctx);
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
      return code === null ? null : ctx.block('is_press_some_key', [code, null]);
    }

    case 'touching': {
      if (!arity(1)) return null;
      const target = resolveTarget(args[0], ctx, { wall: true });
      return target === null ? null : ctx.block('reach_something', [null, target, null]);
    }

    case 'type':
      return ctx.error(node, 'type() 은 == "number" 처럼 비교해서만 쓸 수 있습니다.');

    case 'distance': {
      if (!arity(1)) return null;
      const target = resolveTarget(args[0], ctx, { mouse: true });
      return target === null ? null : ctx.block('distance_something', [null, target, null]);
    }

    case 'x': case 'y': case 'angle': case 'way': case 'size':
    case 'costume': case 'costume_number': {
      if (!arity(1)) return null;
      const coordinate = OBJECT_COORDINATES[callee];
      if (args[0].type === 'String' && args[0].value === 'mouse') {
        if (callee !== 'x' && callee !== 'y') {
          return ctx.error(node, `마우스는 x(), y() 만 조회할 수 있습니다.`);
        }
        return ctx.block('coordinate_mouse', [null, coordinate, null]);
      }
      const target = resolveTarget(args[0], ctx, { self: true });
      return target === null ? null : ctx.block('coordinate_object', [null, target, null, coordinate]);
    }

    case 'text_content': {
      if (!arity(1)) return null;
      const target = resolveTarget(args[0], ctx, { self: true });
      return target === null ? null : ctx.block('text_read', [target, null]);
    }

    case 'block_count': {
      if (!arity(1)) return null;
      const target = resolveTarget(args[0], ctx, { self: true, all: true });
      return target === null ? null : ctx.block('get_block_count', [target]);
    }

    // 이 오브젝트가 가진 소리의 재생 길이(초). 모양·소리 이름을 받는 다른 자리와
    // 똑같이 이름을 그 소리로 풀어 준다.
    case 'sound_duration': {
      if (!arity(1)) return null;
      const sound = resolveSoundValue(args[0], ctx);
      return sound === null ? null : ctx.block('get_sound_duration', [null, sound, null]);
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
      // 1부터, 양끝 포함 — 엔트리 substring 그대로다.
      if (!arity(3)) return null;
      const string = value(0);
      const start = compileValue(args[1], ctx);
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
      // 1부터, 못 찾으면 0 — 엔트리 index_of_string 그대로다.
      if (!arity(2)) return null;
      const string = value(0);
      const target = value(1);
      return string && target && ctx.block('index_of_string', [null, string, null, target, null]);
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
      const units: Record<string, string> = {
        year: 'YEAR', month: 'MONTH', day: 'DAY', hour: 'HOUR',
        minute: 'MINUTE', second: 'SECOND', weekday: 'DAY_OF_WEEK',
      };
      const unit = args[0].type === 'String' ? units[args[0].value] : undefined;
      if (!unit) {
        return ctx.error(node, 'now() 는 "year", "month", "day", "hour", "minute", "second", "weekday" 만 받습니다.');
      }
      return ctx.block('get_date', [null, unit, null]);
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
      const channels: Record<string, string> = { red: 'r', green: 'g', blue: 'b' };
      const channel = args[1].type === 'Identifier' ? channels[args[1].name] : null;
      if (!channel) return ctx.error(node, 'from_hex() 의 두 번째 인자는 red, green, blue 중 하나여야 합니다.');
      const color = value(0);
      return color && ctx.block('change_hex_to_rgb', [color, channel]);
    }

    case 'random_color':
      return ctx.error(node, 'random_color() 는 draw_color = random_color() 형태로만 쓸 수 있습니다.');

    // --- 테이블 -----------------------------------------------------------
    case 'row_count':
    case 'column_count': {
      if (!arity(1)) return null;
      const table = tableArgument(args[0], callee, ctx);
      return table && ctx.block('get_table_count', [table.id, callee === 'row_count' ? 'ROW' : 'COL', null]);
    }

    case 'last_row': {
      if (!arity(2)) return null;
      const table = tableArgument(args[0], callee, ctx);
      const column = value(1);
      return table && column && ctx.block('get_value_from_last_row', [table.id, column, null]);
    }

    case 'correlation': {
      if (!arity(3)) return null;
      const table = tableArgument(args[0], callee, ctx);
      const [x, y] = [value(1), value(2)];
      return table && x && y && ctx.block('get_coefficient', [table.id, x, y, null]);
    }

    case 'lookup': {
      if (!arity(4)) return null;
      const table = tableArgument(args[0], callee, ctx);
      const [field, wanted, back] = [value(1), value(2), value(3)];
      return table && field && wanted && back
        && ctx.block('get_value_v_lookup', [table.id, field, wanted, back, null]);
    }

    default:
      if (expansionBlock(callee)) return compileExpansion(node, ctx);
      if (TABLE_CALCULATIONS[callee]) {
        if (!arity(2)) return null;
        const table = tableArgument(args[0], callee, ctx);
        const column = value(1);
        return table && column
          && ctx.block('calc_values_from_table', [table.id, column, TABLE_CALCULATIONS[callee], null]);
      }
      return ctx.error(node, `알 수 없는 함수 '${callee}' 입니다.`
        + didYouMean(callee, [...BUILTIN_FUNCTIONS, ...ctx.functionByName.keys()]));
  }
}

function literalKeyCode(node: Expr, ctx: Context, at: Node): string | null {
  if (node.type !== 'String') return ctx.error(at, '키 이름은 "space" 처럼 문자열로 직접 적어야 합니다.');
  const code = keyCodeOf(node.value);
  return code ?? ctx.error(at, `알 수 없는 키 이름 "${node.value}" 입니다.`
    + didYouMean(node.value, Object.keys(KEY_CODES)));
}

/**
 * 오브젝트를 가리키는 인자를 엔트리 id 로 바꾼다.
 * "mouse"/"wall" 같은 특수 대상은 옵션으로 허용한다.
 */
export function resolveTarget(
  node: Expr | null | undefined,
  ctx: Context,
  options: TargetOptions = {},
): string | null {
  if (!node || node.type !== 'String') {
    return ctx.error(node ?? null, '오브젝트 이름은 "player" 처럼 문자열로 직접 적어야 합니다.');
  }
  const name = node.value;

  if (name === 'mouse') return 'mouse';
  if (options.wall && name.startsWith('wall')) return name;
  if (options.self && (name === 'self' || name === 'this')) return 'self';
  if (options.all && name === 'all') return 'all';

  const id = ctx.objectId(name);
  return id ?? ctx.error(node, `'${name}' 이라는 오브젝트가 없습니다.${didYouMean(name, ctx.objectByName.keys())}`);
}
