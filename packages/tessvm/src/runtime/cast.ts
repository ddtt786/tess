/**
 * @fileoverview 엔트리 블록이 값을 다루는 방식(형 변환·10진 산술)을 그대로 옮긴 모듈입니다.
 *
 * 엔트리는 값 슬롯에서 읽은 값을 `Entry.Scope.getNumberValue` 등으로 변환하고,
 * 사칙연산은 BigNumber(10진)로 계산합니다. 이 파일은 그 규칙을 재현하되
 * 대부분의 입력에서 배정밀도 연산만으로 같은 결과가 나오는 빠른 경로를 함께 둡니다.
 */

/** `Entry.Scope.getNumberValue` — parseFloat, then 0 for anything unparseable. */
export function num(value: unknown): number {
  const n = parseFloat(value as string);
  return n || 0;
}

/** `Entry.Scope.getStringValue`. */
export function str(value: unknown): string {
  return String(value);
}

/**
 * `Entry.Scope.getBooleanValue` — returns a number when the value parses as one,
 * so `"0"` and `"0.00"` stay falsy while any other text is true.
 */
export function bool(value: unknown): boolean {
  if (value === undefined) {
    return false;
  }
  const n = Number(value);
  return isNaN(n) ? true : Boolean(n);
}

/** `Entry.Scope.getNumberField` — dropdown/field text read as a number. */
export function field(value: unknown): number {
  return Number(value);
}

/** `Entry.Utils.isNumber` — plain decimal literals only, no exponent or leading dot. */
const NUMERIC = /^-?\d+\.?\d*$/;

export function isNumber(value: unknown): boolean {
  if (typeof value === 'number') {
    return true;
  }
  return typeof value === 'string' && NUMERIC.test(value);
}

/** Digits after the decimal point in a number's shortest representation. */
function decimals(x: number): number {
  const s = String(x);
  const exp = s.indexOf('e');
  if (exp < 0) {
    const dot = s.indexOf('.');
    return dot < 0 ? 0 : s.length - dot - 1;
  }
  const mantissa = s.slice(0, exp);
  const dot = mantissa.indexOf('.');
  const fraction = dot < 0 ? 0 : mantissa.length - dot - 1;
  return Math.max(0, fraction - Number(s.slice(exp + 1)));
}

/** Decimals beyond this cannot be recovered by rounding, so plain doubles are used. */
const MAX_DECIMALS = 20;

/**
 * Rounds a double sum/product back onto the decimal grid its operands imply,
 * matching `new BigNumber(a).plus(b).toNumber()` without decimal arithmetic.
 */
function snap(result: number, places: number): number {
  if (places === 0 || places > MAX_DECIMALS || !isFinite(result)) {
    return result;
  }
  return Number(result.toFixed(places));
}

/** `+` on numbers. Entry adds with BigNumber, so `0.1 + 0.2` is `0.3`. */
export function addNum(a: number, b: number): number {
  const r = a + b;
  if (Number.isInteger(a) && Number.isInteger(b)) {
    return r;
  }
  return snap(r, Math.max(decimals(a), decimals(b)));
}

export function subNum(a: number, b: number): number {
  const r = a - b;
  if (Number.isInteger(a) && Number.isInteger(b)) {
    return r;
  }
  return snap(r, Math.max(decimals(a), decimals(b)));
}

export function mulNum(a: number, b: number): number {
  const r = a * b;
  if (Number.isInteger(a) && Number.isInteger(b)) {
    return r;
  }
  return snap(r, decimals(a) + decimals(b));
}

/**
 * BigNumber divides to 20 decimal places (ROUND_HALF_UP) before `toNumber()`,
 * so quotients smaller than that grid lose their tail. Larger ones match the
 * double quotient exactly.
 */
export function divNum(a: number, b: number): number {
  const r = a / b;
  if (r === 0 || !isFinite(r) || Math.abs(r) >= 1e-3) {
    return r;
  }
  return Number(r.toFixed(MAX_DECIMALS));
}

/**
 * `calc_basic` PLUS — concatenates when either side is not a plain number,
 * adds in decimal when both are.
 */
export function calcPlus(left: unknown, right: unknown): number | string {
  const leftValue: unknown = isNumber(left) ? num(left) : left;
  const rightValue: unknown = isNumber(right) ? num(right) : right;
  if (typeof leftValue === 'number' && typeof rightValue === 'number') {
    return addNum(leftValue, rightValue);
  }
  return (leftValue as string) + (rightValue as string);
}

/** `boolean_basic_operator` reads both sides as numbers when the text parses. */
function comparable(value: unknown): unknown {
  if (typeof value === 'string' && value.length) {
    const n = Number(value);
    if (!isNaN(n)) {
      return n;
    }
  }
  return value;
}

export function cmpEqual(a: unknown, b: unknown): boolean {
  return comparable(a) === comparable(b);
}

/** Entry uses loose `!=` here while `EQUAL` is strict — kept as is. */
export function cmpNotEqual(a: unknown, b: unknown): boolean {
  // eslint-disable-next-line eqeqeq
  return comparable(a) != comparable(b);
}

export function cmpGreater(a: unknown, b: unknown): boolean {
  return (comparable(a) as number) > (comparable(b) as number);
}

export function cmpLess(a: unknown, b: unknown): boolean {
  return (comparable(a) as number) < (comparable(b) as number);
}

export function cmpGreaterEqual(a: unknown, b: unknown): boolean {
  return (comparable(a) as number) >= (comparable(b) as number);
}

export function cmpLessEqual(a: unknown, b: unknown): boolean {
  return (comparable(a) as number) <= (comparable(b) as number);
}

/** `boolean_and_or` — both sides are read before they are combined. */
export function andOf(a: unknown, b: unknown): boolean {
  return Boolean(a) && Boolean(b);
}

export function orOf(a: unknown, b: unknown): boolean {
  return Boolean(a) || Boolean(b);
}

/** `Entry.adjustValueWithMaxMin`. */
export function clamp(value: number, min: number, max: number): number {
  if (value > max) {
    return max;
  }
  if (value < min) {
    return min;
  }
  return value;
}

/**
 * `Number.prototype.mod` that entryjs installs — decimal modulo whose result
 * carries the divisor's sign.
 */
export function mod(value: number, divisor: number): number {
  const r = ((value % divisor) + divisor) % divisor;
  if (Number.isInteger(value) && Number.isInteger(divisor)) {
    return r;
  }
  return snap(r, Math.max(decimals(value), decimals(divisor)));
}

/** `Number(value.toFixed(places))` — how entry rounds the size it reports. */
export function fixed(value: number, places: number): number {
  return Number(value.toFixed(places));
}
