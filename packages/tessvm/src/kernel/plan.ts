/**
 * @fileoverview 프레임을 넘기지 않는 숫자 함수를 골라 MoonBit 소스로 옮깁니다.
 *
 * 엔트리의 `빠른 반복` 관용구 — 반복 블록 대신 함수를 두 배씩 불러 한 프레임 안에서
 * 수천 번을 도는 모양 — 은 프레임 경계가 없는 순수 숫자 코드입니다. 그런 함수는
 * 제너레이터로 둘 이유가 없으므로, 여기서 호출 그래프를 훑어 조건에 맞는 함수만
 * 뽑아 하나의 wasm 모듈로 내립니다.
 *
 * 고를 수 있는 조건은 네 가지입니다.
 *
 * 1. 쓰는 블록이 아래 `statement`·`value` 가 아는 것뿐일 것.
 * 2. 읽고 쓰는 변수·리스트가 전역이고, 슬라이드·공유·실시간이 아니며, 담긴 값이
 *    전부 숫자일 것.
 * 3. 부르는 함수도 모두 같은 조건을 만족할 것 (고정점으로 접는다).
 * 4. 호출 그래프에 순환이 없을 것 — 깊이가 컴파일 때 정해져야 한다.
 */
import {
  collectParams,
  findFunctionDefine,
  functionBody,
  parseScript,
  type FunctionEntry,
  type RawBlock,
} from '../compile/codegen.ts';
import type { Variable } from '../runtime/model.ts';

/** Slot 0 carries the flag that makes the bridge throw the run away. */
export const BAIL_SLOT = 0;

/** Where variable data starts, in f64 slots. */
const FIRST_SLOT = 1;

/**
 * The handful of places the two targets are written differently. Everything
 * else — calls, operators, number literals — reads the same in both, so one
 * walk writes both.
 */
interface Dialect {
  /** `cond ? left : right`. */
  pick(cond: string, left: string, right: string): string;
  not(value: string): string;
  floor(value: string): string;
  ifOpen(cond: string): string;
  /** What closes a statement, where one target wants a mark and the other not. */
  end: string;
  let(name: string, value: string): string;
  local(name: string, value: string): string;
  discard(call: string): string;
  open(name: string, arity: number, id: string): string;
  close: string;
  entry(name: string, arity: number, inner: string, id: string): string;
  /** Wraps the finished module, where the javascript one needs a factory. */
  module(bodies: string[], roots: string[]): string;
}

const MOONBIT: Dialect = {
  pick: (cond, left, right) => `(if ${cond} { ${left} } else { ${right} })`,
  not: (value) => `(not(${value}))`,
  floor: (value) => `(${value}).floor()`,
  ifOpen: (cond) => `if ${cond} {`,
  end: '',
  let: (name, value) => `let ${name} = ${value}`,
  local: (name, value) => `let mut ${name} : Double = ${value}`,
  discard: (call) => `${call} |> ignore`,
  open: (name, arity, id) => `///| ${id}\nfn ${name}(${
    Array.from({ length: arity }, (_, at) => `a${at} : Double`).join(', ')
  }) -> Double {`,
  close: '}',
  entry: (name, arity, inner, id) => {
    const args = Array.from({ length: arity }, (_, at) => `a${at}`);
    return `///| Entry point for ${id}.\npub fn ${name}(${
      args.map((arg) => `${arg} : Double`).join(', ')
    }) -> Double {\n  st(${BAIL_SLOT}, 0.0)\n  ${inner}(${args.join(', ')})\n}\n`;
  },
  module: (bodies) => bodies.join('\n'),
};

const JAVASCRIPT: Dialect = {
  pick: (cond, left, right) => `(${cond} ? ${left} : ${right})`,
  not: (value) => `(!(${value}))`,
  floor: (value) => `Math.floor(${value})`,
  ifOpen: (cond) => `if (${cond}) {`,
  end: ';',
  let: (name, value) => `const ${name} = ${value};`,
  local: (name, value) => `let ${name} = ${value};`,
  discard: (call) => `${call};`,
  open: (name, arity, id) => `// ${id}\nfunction ${name}(${
    Array.from({ length: arity }, (_, at) => `a${at}`).join(', ')
  }) {`,
  close: '}',
  entry: (name, arity, inner, id) => {
    const args = Array.from({ length: arity }, (_, at) => `a${at}`);
    return `// Entry point for ${id}.\nfunction ${name}(${args.join(', ')}) {\n` +
      `  st(${BAIL_SLOT}, 0);\n  return ${inner}(${args.join(', ')});\n}\n`;
  },
  module: (bodies, roots) =>
    `"use strict";\nconst { ld, st, ld_item, st_item, ld_tail, add_num, sub_num, mul_num,\n` +
    `  div_num, math_op, quotient, truthy, js_bool, both, bail, float_point } = R;\n` +
    `${bodies.join('\n')}\nreturn { ${roots.join(', ')} };\n`,
};

/** A call to another kernel function, which may not be made twice. */
const CALLS = /\bk\d+\(/;

/** `calc_operation` names whose answer is always a whole number. */
const WHOLE_OPS = new Set(['floor', 'ceil', 'round', 'factorial']);

/** Counted tails stop here, as they do in `runtime.mbt`. */
const DECIMAL_CAP = 21;

/** `calc_operation` operator names in the order `math_op` numbers them. */
const MATH_OPS = [
  'square', 'factorial', 'root', 'log', 'ln', 'asin', 'acos', 'atan',
  'sin', 'cos', 'tan', 'unnatural', 'abs', 'floor', 'ceil', 'round',
];

/** How a variable or list is laid out in the shared region. */
export interface KernelSlot {
  /** Index into the project's variable table. */
  variable: number;
  base: number;
  length: number;
  list: boolean;
  /**
   * A list the work fills with judgements rather than numbers. Entry stores the
   * `true`/`false` a judgement block hands over, and `String(true)` is not
   * `String(1)`, so those cross back as booleans.
   */
  judgement: boolean;
  /** Slot holding how many decimals the stored text carries, or -1 for none. */
  places: number;
  /**
   * Where the tails of a table the kernel only reads are kept, or -1. Counting
   * them again on every pass through a loop is what the decimal rules cost
   * most, and a table that is only read can be counted once on the way in.
   */
  tails: number;
  read: boolean;
  written: boolean;
}

export interface KernelPlan {
  /** Moonbit source, for the toolchain to build into wasm. */
  source: string;
  /**
   * The same functions in javascript, over the same shared numbers. A page with
   * no wasm to hand — the extension on playentry, or a machine without the
   * moonbit toolchain — runs these instead, and they are still free of the
   * boxing and the name lookups the block runner pays for.
   */
  javascript: string;
  slots: KernelSlot[];
  /** Function table index → the wasm export that takes it, and its arity. */
  roots: Map<number, { name: string; arity: number }>;
  /** Deepest chain of kernel calls, for the caller's stack budget. */
  depth: number;
  /** f64 slots the shared region needs. */
  size: number;
  /** Why each rejected function stayed behind, for `tessvm check`. */
  rejected: Map<string, string>;
}

type Kind = 'num' | 'bool';

interface KValue {
  code: string;
  kind: Kind;
  /** Moonbit expression giving the value's tail, when one is at hand. */
  tailCode?: string;
  /**
   * Digits after the point in the value's shortest form, when the compiler
   * already knows them — a literal's. The kernel would otherwise search for
   * them again on every pass through the loop.
   */
  tail?: number;
}

/** Everything one pass over a function body learns about it. */
interface Scan {
  ok: boolean;
  reason: string;
  calls: Set<number>;
  /** Whether the function ends with a value the caller can read. */
  valued: boolean;
}

function isBlock(value: unknown): value is RawBlock {
  return typeof value === 'object' && value !== null && typeof (value as RawBlock).type === 'string';
}

function text(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value === null || value === undefined) {
    return '';
  }
  try {
    return String(value);
  } catch {
    return '';
  }
}

/** A MoonBit double literal. Only finite values reach this. */
function double(value: number): string {
  const source = String(value);
  const at = source.indexOf('e');
  // Moonbit wants a point in the mantissa, which `1e-9` does not have.
  const mantissa = at === -1 ? source : source.slice(0, at);
  const body = mantissa.includes('.') ? mantissa : `${mantissa}.0`;
  return at === -1 ? body : `${body}e${source.slice(at + 1)}`;
}

/** The text a literal slot holds, or null when the slot is a block. */
function literalText(param: unknown): string | null {
  if (isBlock(param)) {
    return param.type === 'number' || param.type === 'text' ? text(param.params[0] ?? '') : null;
  }
  if (param === null || param === undefined) {
    return null;
  }
  return text(param);
}

/** `Entry.Utils.isNumber` — plain decimal literals only, no exponent. */
function numeric(value: unknown): boolean {
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  if (typeof value !== 'string') {
    return false;
  }
  return /^-?\d+\.?\d*$/.test(value);
}

/**
 * Which rule the slot a literal sits in reads it by. Entry converts a slot's
 * text differently depending on the block that holds it, and a literal is the
 * only place the kernel can tell the difference — every other value it carries
 * is already a number.
 *
 * - `num`   `Entry.Scope.getNumberValue` — `parseFloat`, and 0 for the rest.
 * - `raw`   kept as it is, so its text has to be what the number prints as.
 * - `cmp`   `comparable` — read as a number when the text parses as one.
 * - `bool`  `getBooleanValue` — text that is not a number reads as true.
 * - `plus`  `calc_basic` PLUS, which joins unless both sides are numbers.
 * - `index` `Entry.getListRealIndex`, where the three keywords are not numbers.
 * - `word`  the judgement itself, for measuring it against `TRUE` or `FALSE`.
 */
type Slot = 'num' | 'raw' | 'cmp' | 'bool' | 'plus' | 'index' | 'word';

const LIST_KEYWORDS = new Set(['FIRST', 'LAST', 'RANDOM']);

/**
 * A short name for one kernel module's source, so the page can tell that the
 * module the server built is the one it planned for itself. FNV-1a, which both
 * sides can work out the same way without waiting on anything.
 */
export function fingerprint(source: string): string {
  let hash = 0x811c9dc5;
  for (let at = 0; at < source.length; at += 1) {
    hash ^= source.charCodeAt(at);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${hash.toString(16)}-${source.length.toString(16)}`;
}

/**
 * Whether a value is the text `(<판단>의 값)` writes. Entry's `get_boolean_value`
 * hands a judgement over as `"TRUE"` or `"FALSE"`, and **both of those read back
 * as true** — `Number("FALSE")` is `NaN`, which `getBooleanValue` takes for true,
 * and `Boolean("FALSE")` is true as well. A list of them is carried as 1 and 0
 * and written back as the same two words.
 */
export function judged(value: unknown): boolean {
  return value === 'TRUE' || value === 'FALSE';
}

/** Whether a value prints back as the text it is stored as. */
export function canonical(value: unknown): boolean {
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  return numeric(value) && String(Number(value)) === value;
}

/**
 * Digits after the decimal point in a number's shortest form, the way
 * `cast.decimals` counts them. Only literals reach this, once, at compile time.
 */
function tailOf(value: number): number {
  if (Number.isInteger(value)) {
    return 0;
  }
  const source = String(value);
  const exponent = source.indexOf('e');
  if (exponent < 0) {
    const dot = source.indexOf('.');
    return dot < 0 ? 0 : Math.min(source.length - dot - 1, DECIMAL_CAP);
  }
  const mantissa = source.slice(0, exponent);
  const dot = mantissa.indexOf('.');
  const fraction = dot < 0 ? 0 : mantissa.length - dot - 1;
  return Math.min(Math.max(0, fraction - Number(source.slice(exponent + 1))), DECIMAL_CAP);
}

/** `maxFloatPoint` for one value — digits after the dot of its text, capped. */
function floatPoint(value: string | number): number {
  const source = String(value);
  const dot = source.indexOf('.');
  return dot === -1 ? 0 : Math.min(source.length - dot - 1, 20);
}

/**
 * Walks the work's functions and writes the MoonBit module for the ones that
 * can run in wasm. A plan with no roots means nothing qualified; `rejected`
 * still says why, which is what `tessvm check` reports.
 */
export function planKernel(
  objects: Array<{ script: string | RawBlock[][] }>,
  functions: FunctionEntry[],
  variables: Variable[],
): KernelPlan {
  const varIndex = new Map<string, number>();
  variables.forEach((variable, index) => {
    varIndex.set(variable.id, index);
  });
  const funcIndex = new Map<string, number>();
  functions.forEach((fn, index) => {
    funcIndex.set(fn.id, index);
  });

  const rejected = new Map<string, string>();
  const scans: Scan[] = [];
  const bodies: Array<string | null> = [];
  const reads = new Set<number>();
  const writes = new Set<number>();
  const changed = new Set<number>();
  /** Lists the kernel fills with judgements, learned before anything is judged. */
  const judgements = new Set<number>();
  /** True while the first walk is only there to learn what each list holds. */
  let learning = false;
  /** Which of the two targets the current walk is writing. */
  let dialect: Dialect = MOONBIT;
  /** Filled after the layout is known; the first pass only collects names. */
  let slotOf: (index: number) => KernelSlot | undefined = () => undefined;

  // -------------------------------------------------------------------------
  //  Variable eligibility
  // -------------------------------------------------------------------------
  function usable(index: number): boolean {
    const variable = variables[index];
    if (!variable || variable.objectId || variable.isSlide || variable.isStored) {
      return false;
    }
    if (variable.isList) {
      // A list comes back as numbers, so its text has to be what those print
      // as — otherwise a run would rewrite "0.50" as 0.5 on its way out. A list
      // of judgements is the other shape a work fills one with; what it holds
      // right now is checked again on the way in, since a work that has not run
      // yet still carries the `"FALSE"` its file was saved with.
      return variable.array.every((item) => canonical(item.data)) ||
        variable.array.every((item) => judged(item.data));
    }
    // A variable keeps its own text: the places it was written with cross over
    // with the value and `toFixed` writes the same thing again.
    return numeric(variable.value);
  }

  function refer(param: unknown): number | null {
    const index = varIndex.get(text(param));
    if (index === undefined || !usable(index)) {
      return null;
    }
    return index;
  }

  // -------------------------------------------------------------------------
  //  Emitting
  // -------------------------------------------------------------------------
  class Fail extends Error {}

  function fail(why: string): never {
    throw new Fail(why);
  }

  /** The state one function's emission carries. */
  let params = new Map<string, number>();
  let locals = new Map<string, string>();
  let calls = new Set<number>();

  /** What a value can tell the arithmetic about its own tail. */
  function tailArgument(value: KValue): string {
    if (value.tail !== undefined) {
      return String(value.tail);
    }
    return value.tailCode ?? '-1';
  }

  function asNum(value: KValue): string {
    return value.kind === 'bool' ? dialect.pick(value.code, '1.0', '0.0') : value.code;
  }

  function asBool(value: KValue): string {
    return value.kind === 'bool' ? value.code : `truthy(${value.code})`;
  }

  /** `C.andOf`/`C.orOf` read their sides with `Boolean`, where `NaN` is false. */
  function asPlainBool(value: KValue): string {
    return value.kind === 'bool' ? value.code : `js_bool(${value.code})`;
  }

  /** A literal slot, read the way the block holding it would read it. */
  function constant(raw: string, slot: Slot): KValue {
    switch (slot) {
      case 'num': {
        const parsed = parseFloat(raw) || 0;
        return { code: double(parsed), kind: 'num', tail: tailOf(parsed) };
      }
      case 'bool': {
        const n = Number(raw);
        return { code: Number.isNaN(n) ? 'true' : String(Boolean(n)), kind: 'bool' };
      }
      case 'word':
      case 'cmp':
      case 'index': {
        if (slot === 'index' && LIST_KEYWORDS.has(raw)) {
          fail(`list index ${raw}`);
        }
        const n = Number(raw);
        if (!Number.isFinite(n)) {
          fail(`literal ${JSON.stringify(raw)}`);
        }
        return { code: double(n), kind: 'num', tail: tailOf(n) };
      }
      case 'plus': {
        // A side that is not a number makes PLUS join the two as text.
        if (!numeric(raw)) {
          fail(`literal ${JSON.stringify(raw)}`);
        }
        return { code: double(Number(raw)), kind: 'num', tail: tailOf(Number(raw)) };
      }
      default: {
        // Kept as it is, so the number has to print back as the same text.
        if (!numeric(raw) || String(Number(raw)) !== raw) {
          fail(`literal ${JSON.stringify(raw)}`);
        }
        return { code: double(Number(raw)), kind: 'num', tail: tailOf(Number(raw)) };
      }
    }
  }

  function value(param: unknown, slot: Slot = 'num'): KValue {
    if (!isBlock(param)) {
      return constant(text(param), slot);
    }
    const block = param;
    const p = block.params;
    switch (block.type) {
      case 'number':
      case 'text':
        return constant(text(p[0] ?? ''), slot);
      case 'angle': {
        const angle = Number(p[0] ?? 0) || 0;
        return { code: double(angle), kind: 'num', tail: tailOf(angle) };
      }
      case 'True':
        return { code: 'true', kind: 'bool' };
      case 'False':
        return { code: 'false', kind: 'bool' };
      case 'calc_basic':
        return calcBasic(block);
      case 'calc_plus':
        return binary('PLUS', p[0], p[2]);
      case 'calc_minus':
        return binary('MINUS', p[0], p[2]);
      case 'calc_times':
        return binary('MULTI', p[0], p[2]);
      case 'calc_divide':
        return binary('DIVIDE', p[0], p[2]);
      case 'calc_operation': {
        const name = text(p[3] ?? '').split('_')[0] ?? '';
        const op = MATH_OPS.indexOf(name);
        return {
          code: `math_op(${asNum(value(p[1], 'num'))}, ${op === -1 ? MATH_OPS.length - 1 : op})`,
          kind: 'num',
          // These four always land on a whole number, however long the tail
          // they were handed was.
          tail: WHOLE_OPS.has(name) || op === -1 ? 0 : undefined,
        };
      }
      case 'calc_mod':
        return { code: `(${asNum(value(p[0], 'num'))} % ${asNum(value(p[2], 'num'))})`, kind: 'num' };
      case 'calc_share':
        return {
          code: dialect.floor(`${asNum(value(p[0], 'num'))} / ${asNum(value(p[2], 'num'))}`),
          kind: 'num',
          tail: 0,
        };
      case 'quotient_and_mod':
        return {
          code: `quotient(${asNum(value(p[1], 'num'))}, ${asNum(value(p[3], 'num'))}, ${
            text(p[5] ?? 'QUOTIENT') === 'QUOTIENT' ? 'false' : 'true'
          })`,
          kind: 'num',
          tail: text(p[5] ?? 'QUOTIENT') === 'QUOTIENT' ? 0 : undefined,
        };
      case 'boolean_basic_operator':
        return compare(text(p[1] ?? 'EQUAL'), p[0], p[2]);
      case 'boolean_equal':
        return compare('EQUAL', p[0], p[2]);
      case 'boolean_bigger':
        return compare('GREATER', p[0], p[2]);
      case 'boolean_smaller':
        return compare('LESS', p[0], p[2]);
      case 'boolean_and_or':
        return combine(text(p[1] ?? 'AND'), p[0], p[2]);
      case 'boolean_and':
        return combine('AND', p[0], p[2]);
      case 'boolean_or':
        return combine('OR', p[0], p[2]);
      case 'boolean_not':
        return { code: dialect.not(asBool(value(p[1], 'bool'))), kind: 'bool' };
      case 'get_boolean_value':
        // `(<판단>의 값)` — the judgement, on its way into a value slot.
        return { code: asBool(value(p[0], 'bool')), kind: 'bool' };
      case 'get_variable': {
        const index = refer(p[0]);
        if (index === null || variables[index]!.isList) {
          fail(`variable ${text(p[0])}`);
        }
        reads.add(index);
        return { code: `ld(${slotOf(index)?.base ?? 0})`, kind: 'num' };
      }
      case 'value_of_index_from_list': {
        const index = refer(p[1]);
        if (index === null || !variables[index]!.isList) {
          fail(`list ${text(p[1])}`);
        }
        reads.add(index);
        const at = slotOf(index);
        const where = asNum(value(p[3], 'index'));
        const item = `ld_item(${at?.base ?? 0}, ${at?.length ?? 0}, ${where})`;
        if (!judgements.has(index)) {
          // The index is read twice, so it may not be something that does
          // anything — every kernel expression but a call to another kernel
          // function is safe that way.
          const tailCode = at && at.tails >= 0 && !CALLS.test(where)
            ? `ld_tail(${at.tails}, ${at.length}, ${where})`
            : undefined;
          return { code: item, kind: 'num', tailCode };
        }
        // A judgement only reads back as one. Anywhere else entry would have
        // `parseFloat(true)`, which is not 1, so the list stays behind instead.
        if (slot === 'word') {
          // Measured against one of the two words, where they do tell apart.
          return { code: item, kind: 'num' };
        }
        if (slot !== 'bool') {
          fail(`list ${text(p[1])} holds judgements`);
        }
        // Read on its own, both words come back as true (see `judged`); the
        // item is still read so the list stays among the ones that cross over.
        return { code: `(${item} == ${item})`, kind: 'bool' };
      }
      case 'length_of_list': {
        const index = refer(p[1]);
        if (index === null || !variables[index]!.isList) {
          fail(`list ${text(p[1])}`);
        }
        reads.add(index);
        return {
          code: double(slotOf(index)?.length ?? variables[index]!.array.length),
          kind: 'num',
          tail: 0,
        };
      }
      case 'get_func_variable': {
        const name = locals.get(text(p[0]));
        if (!name) {
          fail('function local');
        }
        return { code: name, kind: 'num' };
      }
      default: {
        if (block.type.startsWith('func_')) {
          return { code: call(block, true), kind: 'num' };
        }
        const slot = params.get(block.type);
        if (slot !== undefined) {
          return { code: `a${slot}`, kind: 'num' };
        }
        return fail(block.type);
      }
    }
  }

  function calcBasic(block: RawBlock): KValue {
    return binary(text(block.params[1] ?? 'PLUS'), block.params[0], block.params[2]);
  }

  /**
   * `calc_basic` PLUS joins when a side is not a number; the kernel only ever
   * holds numbers, so it is always the decimal addition.
   */
  function binary(operator: string, left: unknown, right: unknown): KValue {
    const slot: Slot = operator === 'PLUS' ? 'plus' : 'num';
    const leftValue = value(left, slot);
    const rightValue = value(right, slot);
    const a = asNum(leftValue);
    const b = asNum(rightValue);
    const tails = `${tailArgument(leftValue)}, ${tailArgument(rightValue)}`;
    switch (operator) {
      case 'PLUS':
        return { code: `add_num(${a}, ${b}, ${tails})`, kind: 'num' };
      case 'MINUS':
        return { code: `sub_num(${a}, ${b}, ${tails})`, kind: 'num' };
      case 'MULTI':
        return { code: `mul_num(${a}, ${b}, ${tails})`, kind: 'num' };
      default:
        return { code: `div_num(${a}, ${b})`, kind: 'num' };
    }
  }

  /** 1 or 0 when the slot holds one of the two words a judgement is written as. */
  function judgementWord(param: unknown): number | null {
    const raw = literalText(param);
    return raw === 'TRUE' ? 1 : raw === 'FALSE' ? 0 : null;
  }

  /** Whether the slot reads an item of a list the kernel fills with judgements. */
  function readsJudgement(param: unknown): boolean {
    if (!isBlock(param) || param.type !== 'value_of_index_from_list') {
      return false;
    }
    const index = varIndex.get(text(param.params[1]));
    return index !== undefined && judgements.has(index);
  }

  function compare(operator: string, left: unknown, right: unknown): KValue {
    // `만일 <리스트의 항목>` compiles to the item measured against the word it
    // would have been written as, which is a comparison of two texts.
    const word = judgementWord(right) ?? judgementWord(left);
    if (word !== null && (operator === 'EQUAL' || operator === 'NOT_EQUAL')) {
      const other = judgementWord(right) !== null ? left : right;
      if (readsJudgement(other)) {
        const item = value(other, 'word').code;
        return {
          code: `((${item} != 0.0) ${operator === 'EQUAL' ? '==' : '!='} ${word === 1})`,
          kind: 'bool',
        };
      }
    }
    const a = asNum(value(left, 'cmp'));
    const b = asNum(value(right, 'cmp'));
    const table: Record<string, string> = {
      EQUAL: '==', NOT_EQUAL: '!=', GREATER: '>', LESS: '<',
      GREATER_OR_EQUAL: '>=', LESS_OR_EQUAL: '<=',
    };
    return { code: `(${a} ${table[operator] ?? '=='} ${b})`, kind: 'bool' };
  }

  /** Entry reads both sides before combining them, so neither is skipped. */
  function combine(operator: string, left: unknown, right: unknown): KValue {
    for (const side of [left, right]) {
      // `Boolean("0")` is true while `Boolean(0)` is false, so a literal here
      // cannot be folded into a number.
      if (!isBlock(side) || side.type === 'number' || side.type === 'text') {
        fail('literal in and/or');
      }
    }
    const a = asPlainBool(value(left, 'bool'));
    const b = asPlainBool(value(right, 'bool'));
    return { code: `both(${a}, ${b}, ${operator === 'AND' ? 'true' : 'false'})`, kind: 'bool' };
  }

  function call(block: RawBlock, asValue: boolean): string {
    const target = funcIndex.get(block.type.slice('func_'.length));
    if (target === undefined) {
      fail(block.type);
    }
    const define = findFunctionDefine(parseScript(functions[target]!.content))?.[0];
    if (asValue && define?.type !== 'function_create_value') {
      fail(`${block.type} has no value`);
    }
    calls.add(target);
    // Entry hands the body every slot of the call block in order, and the body
    // reads them by declaration index, so the two line up position by position.
    const args = collectParams(define?.params[0]).map((_, at) =>
      asNum(value(block.params[at], 'raw')));
    return `k${target}(${args.join(', ')})`;
  }

  function statement(block: RawBlock, indent: string): string {
    const p = block.params;
    switch (block.type) {
      case 'set_variable': {
        const index = refer(p[0]);
        if (index === null || variables[index]!.isList) {
          fail(`variable ${text(p[0])}`);
        }
        writes.add(index);
        const slot = slotOf(index);
        return `${indent}st(${slot?.base ?? 0}, ${asNum(value(p[1], 'raw'))})${dialect.end}\n` +
          `${indent}st(${slot?.places ?? 0}, -1.0)${dialect.end}\n`;
      }
      case 'change_variable': {
        const index = refer(p[0]);
        if (index === null || variables[index]!.isList) {
          fail(`variable ${text(p[0])}`);
        }
        reads.add(index);
        writes.add(index);
        changed.add(index);
        const slot = slotOf(index);
        // Entry stores what `toFixed` wrote, so the decimals it used decide the
        // next change as well; the kernel carries them in their own slot.
        const raw = literalText(p[1]);
        const increment = value(p[1], 'raw');
        const added = raw !== null && numeric(raw)
          ? `${double(floatPoint(raw))}`
          : `float_point(__v)`;
        return `${indent}{\n` +
          `${indent}  ${dialect.let('__v', asNum(increment))}\n` +
          `${indent}  ${dialect.let('__c', `ld(${slot?.base ?? 0})`)}\n` +
          `${indent}  ${dialect.let('__p', `ld(${slot?.places ?? 0})`)}\n` +
          `${indent}  ${dialect.let('__was', dialect.pick('__p < 0.0', 'float_point(__c)', '__p'))}\n` +
          `${indent}  ${dialect.let('__now', added)}\n` +
          `${indent}  ${dialect.ifOpen('__v != __v || __c != __c')} bail()${dialect.end} }\n` +
          `${indent}  st(${slot?.base ?? 0}, add_num(__v, __c, ${increment.tail ?? -1}, -1))${dialect.end}\n` +
          `${indent}  st(${slot?.places ?? 0}, ${dialect.pick('__was > __now', '__was', '__now')})${dialect.end}\n` +
          `${indent}}\n`;
      }
      case 'change_value_list_index': {
        const index = refer(p[0]);
        if (index === null || !variables[index]!.isList) {
          fail(`list ${text(p[0])}`);
        }
        writes.add(index);
        const at = slotOf(index);
        const stored = value(p[2], 'raw');
        if (learning) {
          if (stored.kind === 'bool') {
            judgements.add(index);
          }
        } else if ((stored.kind === 'bool') !== judgements.has(index)) {
          // Numbers and judgements in the same list have no one shape to cross
          // back as, so the kernel leaves that list alone.
          fail(`list ${text(p[0])} holds both`);
        }
        return `${indent}st_item(${at?.base ?? 0}, ${at?.length ?? 0}, ` +
          `${asNum(value(p[1], 'index'))}, ${asNum(stored)})${dialect.end}\n`;
      }
      case 'set_func_variable': {
        const name = locals.get(text(p[0]));
        if (!name) {
          fail('function local');
        }
        return `${indent}${name} = ${asNum(value(p[1], 'raw'))}${dialect.end}\n`;
      }
      case '_if':
        return `${indent}${dialect.ifOpen(asBool(value(p[0], 'bool')))}\n` +
          stack(block.statements?.[0] ?? [], `${indent}  `) +
          `${indent}${dialect.close}\n`;
      case 'if_else':
        return `${indent}${dialect.ifOpen(asBool(value(p[0], 'bool')))}\n` +
          stack(block.statements?.[0] ?? [], `${indent}  `) +
          `${indent}${dialect.close} else {\n` +
          stack(block.statements?.[1] ?? [], `${indent}  `) +
          `${indent}${dialect.close}\n`;
      default:
        if (block.type.startsWith('func_')) {
          return `${indent}${dialect.discard(call(block, false))}\n`;
        }
        return fail(block.type);
    }
  }

  function stack(blocks: RawBlock[], indent: string): string {
    let out = '';
    for (const block of blocks) {
      out += statement(block, indent);
    }
    return out || `${indent}${dialect.end === ';' ? '' : '()'}\n`;
  }

  /** Emits one function, or records why it stayed behind. */
  function emit(fn: FunctionEntry, index: number): { scan: Scan; body: string | null } {
    const content = parseScript(fn.content);
    const stackBlocks = findFunctionDefine(content);
    const define = stackBlocks?.[0];
    const scan: Scan = { ok: false, reason: '', calls: new Set(), valued: false };
    if (!define) {
      scan.reason = 'no definition';
      return { scan, body: null };
    }
    params = new Map(collectParams(define.params[0]).map((name, at) => [name, at]));
    locals = new Map();
    calls = new Set();
    const declarations: string[] = [];
    for (const local of fn.localVariables ?? []) {
      if (!numeric(local.value ?? 0)) {
        scan.reason = `function local ${local.name}`;
        return { scan, body: null };
      }
      const name = `l${locals.size}`;
      locals.set(local.id, name);
      declarations.push(`  ${dialect.local(name, double(Number(local.value ?? 0)))}\n`);
    }
    try {
      const body = stack(functionBody(stackBlocks!), '  ');
      const answer = define.type === 'function_create_value'
        ? asNum(value(define.params[3], 'raw'))
        : '0.0';
      const tail = `  ${dialect.end === ';' ? `return ${answer};` : answer}\n`;
      scan.ok = true;
      scan.calls = calls;
      scan.valued = define.type === 'function_create_value';
      return {
        scan,
        body: `${dialect.open(`k${index}`, params.size, fn.id)}\n` +
          `${declarations.join('')}${body}${tail}${dialect.close}\n`,
      };
    } catch (error) {
      scan.reason = error instanceof Fail ? error.message : String(error);
      return { scan, body: null };
    }
  }

  // -------------------------------------------------------------------------
  //  Pass zero — what each list is filled with
  // -------------------------------------------------------------------------
  // A list read can come before the write that says what the list holds, so the
  // shapes are learned on a walk of their own and only then relied on.
  learning = true;
  functions.forEach((fn, index) => {
    emit(fn, index);
  });
  learning = false;
  reads.clear();
  writes.clear();
  changed.clear();

  // -------------------------------------------------------------------------
  //  Pass one — who qualifies, and what they touch
  // -------------------------------------------------------------------------
  functions.forEach((fn, index) => {
    const result = emit(fn, index);
    scans[index] = result.scan;
    bodies[index] = result.body;
    if (!result.scan.ok) {
      rejected.set(fn.id, result.scan.reason);
    }
  });

  // A function is only as good as what it calls, and a cycle has no fixed depth.
  let settled = false;
  while (!settled) {
    settled = true;
    scans.forEach((scan, index) => {
      if (!scan.ok) {
        return;
      }
      for (const target of scan.calls) {
        if (!scans[target]?.ok) {
          scan.ok = false;
          rejected.set(functions[index]!.id, `calls ${functions[target]?.id ?? target}`);
          settled = false;
          return;
        }
      }
    });
  }

  const depths = new Map<number, number>();
  function depthOf(index: number, seen: Set<number>): number {
    if (seen.has(index)) {
      return Infinity;
    }
    const known = depths.get(index);
    if (known !== undefined) {
      return known;
    }
    seen.add(index);
    let deepest = 0;
    for (const target of scans[index]!.calls) {
      deepest = Math.max(deepest, depthOf(target, seen));
    }
    seen.delete(index);
    const total = deepest + 1;
    depths.set(index, total);
    return total;
  }
  scans.forEach((scan, index) => {
    if (scan.ok && !Number.isFinite(depthOf(index, new Set()))) {
      scan.ok = false;
      rejected.set(functions[index]!.id, 'calls itself');
    }
  });

  if (!scans.some((scan) => scan.ok)) {
    return { source: '', javascript: '', slots: [], roots: new Map(), depth: 0, size: FIRST_SLOT, rejected };
  }

  // -------------------------------------------------------------------------
  //  Pass two — lay the data out, then emit for real
  // -------------------------------------------------------------------------
  // The first pass walked every function, including the ones that fell out, so
  // it knows about variables no kernel code ever touches. Walking only the ones
  // that stayed keeps those out of the data the run copies back and forth —
  // and out of the numbers-only rule, which they need not keep.
  const settledKeep = scans.map((scan) => scan.ok);
  reads.clear();
  writes.clear();
  changed.clear();
  functions.forEach((fn, index) => {
    if (settledKeep[index]) {
      emit(fn, index);
    }
  });

  const touched = new Set([...reads, ...writes]);
  const slots: KernelSlot[] = [];
  const byVariable = new Map<number, KernelSlot>();
  let next = FIRST_SLOT;
  for (const index of [...touched].sort((a, b) => a - b)) {
    const variable = variables[index]!;
    const length = variable.isList ? variable.array.length : 1;
    const tabled = variable.isList && reads.has(index) && !writes.has(index) &&
      !judgements.has(index);
    const slot: KernelSlot = {
      variable: index,
      base: next,
      length,
      list: variable.isList,
      judgement: judgements.has(index),
      places: variable.isList ? -1 : next + 1,
      tails: tabled ? next + length : -1,
      read: reads.has(index),
      written: writes.has(index),
    };
    next += variable.isList ? length * (tabled ? 2 : 1) : 2;
    slots.push(slot);
    byVariable.set(index, slot);
  }
  slotOf = (index) => byVariable.get(index);

  reads.clear();
  writes.clear();
  changed.clear();
  const keep = [...settledKeep];
  const written = new Map<Dialect, string[]>([[MOONBIT, []], [JAVASCRIPT, []]]);
  for (const target of written.keys()) {
    dialect = target;
    functions.forEach((fn, index) => {
      if (!keep[index]) {
        return;
      }
      const result = emit(fn, index);
      if (!result.scan.ok || !result.body) {
        // The layout pass cannot turn a good function bad; if it did, drop it.
        keep[index] = false;
        rejected.set(fn.id, result.scan.reason || 'layout');
        return;
      }
      written.get(target)!.push(result.body);
    });
  }
  const sources = written.get(MOONBIT)!;

  // -------------------------------------------------------------------------
  //  Roots — the ones something outside the kernel calls
  // -------------------------------------------------------------------------
  // A call the kernel makes itself is a plain wasm call; only a call from
  // outside has to copy the data across, so only those become entry points.
  const outside = new Set<number>();
  function noteCalls(node: unknown): void {
    if (Array.isArray(node)) {
      node.forEach(noteCalls);
      return;
    }
    if (!isBlock(node)) {
      return;
    }
    if (node.type.startsWith('func_')) {
      const target = funcIndex.get(node.type.slice('func_'.length));
      if (target !== undefined) {
        outside.add(target);
      }
    }
    node.params?.forEach(noteCalls);
    node.statements?.forEach(noteCalls);
  }
  for (const object of objects) {
    noteCalls(parseScript(object.script));
  }
  functions.forEach((fn, index) => {
    if (!keep[index]) {
      noteCalls(parseScript(fn.content));
    }
  });

  const roots = new Map<number, { name: string; arity: number }>();
  keep.forEach((ok, index) => {
    if (!ok || !outside.has(index)) {
      return;
    }
    const define = findFunctionDefine(parseScript(functions[index]!.content))![0]!;
    roots.set(index, { name: `run${index}`, arity: collectParams(define.params[0]).length });
  });

  const names = [...roots.values()].map((root) => root.name);
  const write = (target: Dialect): string => {
    dialect = target;
    const entries = [...roots.entries()].map(([index, root]) =>
      target.entry(root.name, root.arity, `k${index}`, functions[index]!.id));
    return target.module([...written.get(target)!, ...entries], names);
  };

  const depth = Math.max(...[...roots.keys()].map((index) => depths.get(index) ?? 1));
  return {
    source: write(MOONBIT),
    javascript: write(JAVASCRIPT),
    slots,
    roots,
    depth,
    size: next,
    rejected,
  };
}
