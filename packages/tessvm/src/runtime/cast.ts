/**
 * @fileoverview 엔트리 블록이 값을 다루는 방식(형 변환·10진 산술)을 그대로 옮긴 모듈입니다.
 *
 * 엔트리는 값 슬롯에서 읽은 값을 `Entry.Scope.getNumberValue` 등으로 변환하고,
 * 사칙연산은 BigNumber(10진)로 계산합니다. 이 파일은 그 규칙을 재현하되
 * 대부분의 입력에서 배정밀도 연산만으로 같은 결과가 나오는 빠른 경로를 함께 둡니다.
 */

/** `Entry.Scope.getNumberValue` — parseFloat, then 0 for anything unparseable. */
export function num(value: unknown): number {
  // `parseFloat` takes a string, so a number goes out to text and back for
  // nothing. Its shortest form parses to the same double, `NaN` and `-0` fall
  // to 0 either way, and the infinities survive both routes.
  if (typeof value === 'number') {
    return value || 0;
  }
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

const MINUS = 45;
const DOT = 46;
const ZERO = 48;
const NINE = 57;

/**
 * `Entry.Utils.isNumber` — plain decimal literals only, no exponent or leading
 * dot, which is `/^-?\d+\.?\d*$/` read off the characters. Every value a block
 * reads goes through here, and a regex match costs more than the walk does.
 */
export function isNumber(value: unknown): boolean {
  if (typeof value === 'number') {
    return true;
  }
  if (typeof value !== 'string') {
    return false;
  }
  const length = value.length;
  let at = value.charCodeAt(0) === MINUS ? 1 : 0;
  const start = at;
  while (at < length) {
    const code = value.charCodeAt(at);
    if (code < ZERO || code > NINE) {
      break;
    }
    at += 1;
  }
  if (at === start) {
    return false;
  }
  if (at === length) {
    return true;
  }
  if (value.charCodeAt(at) !== DOT) {
    return false;
  }
  for (at += 1; at < length; at += 1) {
    const code = value.charCodeAt(at);
    if (code < ZERO || code > NINE) {
      return false;
    }
  }
  return true;
}

/** Decimals beyond this cannot be recovered by rounding, so plain doubles are used. */
const MAX_DECIMALS = 20;

/** `10 ** -places`, indexed by places. */
const TENTHS: number[] = Array.from({ length: MAX_DECIMALS + 1 }, (_, at) => 10 ** -at);

/** Counted decimals stop here; `snap` treats anything this long as unroundable. */
const DECIMAL_CAP = MAX_DECIMALS + 1;

/** `10 ** places`, indexed by places. */
const TENS: number[] = Array.from({ length: DECIMAL_CAP + 1 }, (_, at) => 10 ** at);

/** Above this an integer no longer fits a double, so the product below is exact. */
const EXACT_LIMIT = 2 ** 53;

/** `2 ** 27 + 1` — Dekker's splitting constant for a double. */
const SPLIT = 134217729;

/**
 * Whether `|x|` written with `places` decimals reads back as the same double,
 * which is the test `Number(x.toFixed(places)) === x` without the string.
 *
 * Past `EXACT_LIMIT` the decimal grid is finer than the gap between neighbouring
 * doubles, so some grid point always reads back as `x`. Below it the rounded
 * grid point is an integer a double holds exactly, and Dekker's product supplies
 * the bits `a * ten` drops so that the rounding picks the same one `toFixed` does.
 */
function readsBack(a: number, places: number): boolean {
  const ten = TENS[places]!;
  const scaled = a * ten;
  if (scaled >= EXACT_LIMIT) {
    return true;
  }
  const splitA = SPLIT * a;
  const highA = splitA - (splitA - a);
  const lowA = a - highA;
  const splitTen = SPLIT * ten;
  const highTen = splitTen - (splitTen - ten);
  const lowTen = ten - highTen;
  const error = ((highA * highTen - scaled) + highA * lowTen + lowA * highTen) + lowA * lowTen;
  let rounded = Math.floor(scaled);
  // `frac - 0.5` is exact wherever the decision is close, so the residual joins
  // that difference rather than `frac`, which would absorb it.
  if (scaled - rounded - 0.5 + error >= 0) {
    rounded += 1;
  }
  return rounded / ten === a;
}

/**
 * Digits after the decimal point in `|a|`, searched only below `limit`, which
 * the caller has already found the tail to fit inside.
 */
export function decimalsBelow(a: number, limit: number): number {
  // A shorter tail reads back at every longer one, so the shortest is a search.
  let low = 1;
  let high = limit;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (readsBack(a, middle)) {
      high = middle;
    } else {
      low = middle + 1;
    }
  }
  return low;
}

/**
 * The shortest tail `snap` could still round `a` onto. At and above it the
 * decimal grid is finer than the gap between neighbouring doubles, so rounding
 * a result onto that grid gives the result back unchanged.
 */
function gridWall(a: number): number {
  let low = 0;
  let high = DECIMAL_CAP;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (a * TENS[middle]! >= EXACT_LIMIT) {
      high = middle;
    } else {
      low = middle + 1;
    }
  }
  return a * TENS[low]! >= EXACT_LIMIT ? low : DECIMAL_CAP + 1;
}

/**
 * The decimals of one operand, or `DECIMAL_CAP` once its tail reaches `wall` —
 * which is all a caller needs to know, since `snap` leaves the result alone
 * from there on. Reading the tail costs more than asking whether it is long
 * enough, and in a work built on trigonometry it nearly always is.
 */
function tailOf(x: number, wall: number): number {
  if (Number.isInteger(x)) {
    return 0;
  }
  const a = x < 0 ? -x : x;
  const below = wall - 1;
  return readsBack(a, below) ? decimalsBelow(a, below) : DECIMAL_CAP;
}

/**
 * Digits after the decimal point in a number's shortest form, counted up to
 * `DECIMAL_CAP`. The kernel asks for these when it takes a table over, so that
 * the wasm side never has to look for them again.
 */
export function decimals(x: number): number {
  if (Number.isInteger(x)) {
    return 0;
  }
  return decimalsBelow(x < 0 ? -x : x, DECIMAL_CAP);
}

/**
 * `max(decimals(a), decimals(b))`, told only as far as `snap` can use it.
 * `ta`·`tb` carry a tail the caller already knows — a literal's, which the
 * kernel's compiler counted once — and -1 where it does not.
 */
function maxTail(result: number, a: number, b: number, ta = -1, tb = -1): number {
  const magnitude = result < 0 ? -result : result;
  const wall = gridWall(magnitude);
  if (wall <= 1) {
    return DECIMAL_CAP;
  }
  const left = ta >= 0 ? ta : tailOf(a, wall);
  if (left >= wall) {
    return DECIMAL_CAP;
  }
  const right = tb >= 0 ? tb : tailOf(b, wall);
  if (right >= wall) {
    return DECIMAL_CAP;
  }
  return left > right ? left : right;
}

/** `decimals(a) + decimals(b)`, told only as far as `snap` can use it. */
function sumTail(result: number, a: number, b: number, ta = -1, tb = -1): number {
  const magnitude = result < 0 ? -result : result;
  const wall = gridWall(magnitude);
  if (wall <= 1) {
    return DECIMAL_CAP;
  }
  const left = ta >= 0 ? ta : tailOf(a, wall);
  if (left >= wall) {
    return DECIMAL_CAP;
  }
  const right = tb >= 0 ? tb : tailOf(b, wall);
  if (right >= wall || left + right >= wall) {
    return DECIMAL_CAP;
  }
  return left + right;
}

/**
 * The same three operations the kernel emits, taking the tails its compiler
 * already counted. `-1` means it did not, which is what the blocks outside the
 * kernel always pass.
 */
export function addNumWith(a: number, b: number, ta: number, tb: number): number {
  const r = a + b;
  if (Number.isInteger(a) && Number.isInteger(b)) {
    return r;
  }
  return snap(r, maxTail(r, a, b, ta, tb));
}

export function subNumWith(a: number, b: number, ta: number, tb: number): number {
  const r = a - b;
  if (Number.isInteger(a) && Number.isInteger(b)) {
    return r;
  }
  return snap(r, maxTail(r, a, b, ta, tb));
}

export function mulNumWith(a: number, b: number, ta: number, tb: number): number {
  const r = a * b;
  if (Number.isInteger(a) && Number.isInteger(b)) {
    return r;
  }
  return snap(r, sumTail(r, a, b, ta, tb));
}

/**
 * A strict lower bound on the gap between a double and its neighbour is
 * `|x| * Number.EPSILON / 2`; half of that again leaves room for the error the
 * `TENTHS` literals carry, so the test below never claims a gap that is not
 * there.
 */
const SPACING = Number.EPSILON / 4;

/**
 * Rounds a double sum/product back onto the decimal grid its operands imply,
 * matching `new BigNumber(a).plus(b).toNumber()` without decimal arithmetic.
 */
function snap(result: number, places: number): number {
  if (places === 0 || places > MAX_DECIMALS || !isFinite(result)) {
    return result;
  }
  // Where neighbouring doubles are further apart than the grid asked for, that
  // grid holds no value the result is not already on: rounding onto it and
  // reading the number back lands on the same double. Trigonometry feeds most
  // of the arithmetic in a 3D work and leaves nearly every operand here, so it
  // is worth not formatting a string to find that out.
  if (Math.abs(result) * SPACING >= TENTHS[places]!) {
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
  return snap(r, maxTail(r, a, b));
}

export function subNum(a: number, b: number): number {
  const r = a - b;
  if (Number.isInteger(a) && Number.isInteger(b)) {
    return r;
  }
  return snap(r, maxTail(r, a, b));
}

export function mulNum(a: number, b: number): number {
  const r = a * b;
  if (Number.isInteger(a) && Number.isInteger(b)) {
    return r;
  }
  return snap(r, sumTail(r, a, b));
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
  return snap(r, maxTail(r, value, divisor));
}

/**
 * `Entry.parseNumber` — a number, or a numeric string, or `false`. Strings that
 * start with `0` come back as strings so `"007"` stays a name, not seven.
 */
export function parseNumber(value: unknown): number | string | false {
  if (typeof value === 'string') {
    if ((isNumber(value) && value[0] === '0') || (value[0] === '0' && value[1]?.toLowerCase() === 'x')) {
      return value;
    }
    if (isNumber(value)) {
      return Number(value);
    }
  } else if (typeof value === 'number' && isNumber(value)) {
    return value;
  }
  return false;
}

/** `Number(value.toFixed(places))` — how entry rounds the size it reports. */
export function fixed(value: number, places: number): number {
  return Number(value.toFixed(places));
}

/**
 * `Entry.hex2rgb` — the colour a work's value really means.
 *
 * Entry puts a `#` on the front, expands `#abc`, and takes **anything else it
 * cannot read as black**. A colour is never a reason to stop: works carry
 * strings like `#검정` or a hex that lost a digit, and entry draws those black
 * and carries on.
 */
export function hexToRgb(value: unknown): { r: number; g: number; b: number } {
  const text = String(value ?? '');
  let hex = text[0] === '#' ? text : `#${text}`;
  if (hex.length === 4) {
    hex = `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
  }
  if (!/^#[0-9a-f]{6}$/i.test(hex)) {
    hex = '#000000';
  }
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

/** `Entry.rgb2hex`. */
export function rgbToHex(r: number, g: number, b: number): string {
  return `#${(((1 << 24) + (r << 16) + (g << 8) + b) >>> 0).toString(16).slice(1)}`;
}

/** The same value as `#rrggbb`, which is the only shape entry ever stores. */
export function hexColor(value: unknown): string {
  const { r, g, b } = hexToRgb(value);
  return rgbToHex(r, g, b);
}
