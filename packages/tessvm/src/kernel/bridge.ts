/**
 * @fileoverview 빌드된 커널을 실행기에 붙입니다.
 *
 * 커널이 맡은 함수는 `F[i]` 자리를 이 파일이 만든 제너레이터로 바꿔 끼웁니다.
 * 그 제너레이터는 커널이 읽는 변수·리스트를 공유 영역으로 옮기고, wasm 함수를
 * 한 번 부르고, 커널이 쓴 것만 되돌려 놓습니다. 되돌릴 수 없는 자리를 만나면
 * 커널이 표시만 남기고 끝내므로, 여기서 그 판을 버리고 원래 자바스크립트
 * 함수를 대신 돌립니다.
 */
import { BAIL_SLOT, canonical, judged, type KernelPlan, type KernelSlot } from './plan.ts';
import { decimals } from '../runtime/cast.ts';
import { kernelOps, type KernelMarks } from './runtime-js.ts';
import type { Variable } from '../runtime/model.ts';

/** Where the shared data region starts, in bytes. Matches `runtime.mbt`. */
const DATA_BASE = 1024;

/** Entry unwinds a call chain this deep; the kernel needs room for its own. */
const CALL_DEPTH_LIMIT = 1000000;

/** Calls timed before deciding whether an entry point is worth its crossing. */
const TRIAL_CALLS = 24;
/**
 * A trial also runs until this much time was measured. A page's clock is
 * coarse, so most short calls read as no time at all; summed over enough of
 * them the readings still say which side costs more.
 */
const TRIAL_MIN_MS = 2;
const TRIAL_MAX_CALLS = 2048;
/** Calls between looks at how much a kept root copies, against its trial. */
const WATCH_CALLS = 256;
/** Fallbacks in a row before a root rests, and the longest rest, in calls. */
const FAIL_LIMIT = 8;
const REST_FIRST = 16;
const REST_MAX = 4096;
/** Calls a root dropped for its crossing sits out before it is timed again. */
const RETRY_FIRST = 8192;
const RETRY_MAX = 1 << 20;

/** The maths the wasm library rounds differently from the page's `Math`. */
const HOST_MATHS = { ln: Math.log, acos: Math.acos };

type KernelFn = (...args: number[]) => number;

export interface KernelHandle {
  /** Which of the two the run ended up on, for the line the cli prints. */
  where: 'wasm' | 'javascript';
  /** Runs one root, or returns null when the caller should use javascript. */
  run(root: number, args: number[]): number | null;
  /** Roots the kernel can take, by function table index. */
  roots: Map<number, { name: string; arity: number }>;
  depth: number;
  /**
   * How many times a root ran in the kernel, how often it fell back, how many
   * numbers crossed, and how many entry points were given back to the block
   * runner — because the crossing cost more than it saved, or because their
   * data no longer fits the module.
   */
  readonly stats: { runs: number; fallbacks: number; copied: number; dropped: number };
}

/**
 * Instantiates a kernel module against the work's variables. Returns null when
 * the module and the work no longer line up, which leaves the work on the
 * javascript path rather than running it with the wrong data.
 */
export function attachKernel(
  wasm: Uint8Array<ArrayBuffer> | WebAssembly.Module,
  plan: Pick<KernelPlan, 'slots' | 'roots' | 'access' | 'depth' | 'size'>,
  variables: Variable[],
): KernelHandle | null {
  let instance: WebAssembly.Instance;
  try {
    const module = wasm instanceof WebAssembly.Module ? wasm : new WebAssembly.Module(wasm);
    instance = new WebAssembly.Instance(module, { tess: HOST_MATHS });
  } catch {
    return null;
  }
  const exports = instance.exports as Record<string, unknown>;
  const memory = exports.memory as WebAssembly.Memory | undefined;
  if (!memory) {
    return null;
  }
  const entries = new Map<number, KernelFn>();
  for (const [index, root] of plan.roots) {
    const fn = exports[root.name];
    if (typeof fn !== 'function') {
      return null;
    }
    entries.set(index, fn as KernelFn);
  }

  // The buffer moves when the heap grows, so the view is taken again each time.
  let view = new Float64Array(memory.buffer, DATA_BASE, plan.size);
  const data = (): Float64Array => {
    if (view.buffer !== memory.buffer || view.byteLength === 0) {
      view = new Float64Array(memory.buffer, DATA_BASE, plan.size);
    }
    return view;
  };
  return marshal('wasm', plan, variables, entries, data);
}

/**
 * The same functions in javascript, for a page with no wasm to hand. The
 * numbers live in one `Float64Array` instead of linear memory; everything
 * either side of that is the same.
 */
export function attachJsKernel(
  plan: Pick<KernelPlan, 'javascript' | 'slots' | 'roots' | 'access' | 'depth' | 'size'>,
  variables: Variable[],
): KernelHandle | null {
  const cells = new Float64Array(plan.size);
  const marks: KernelMarks = { flags: new Uint8Array(plan.size), span: new Int32Array([plan.size, -1]) };
  let built: Record<string, unknown>;
  try {
    const factory = new Function('R', plan.javascript) as (ops: unknown) => Record<string, unknown>;
    built = factory(kernelOps(cells, marks));
  } catch {
    return null;
  }
  const entries = new Map<number, KernelFn>();
  for (const [index, root] of plan.roots) {
    const fn = built[root.name];
    if (typeof fn !== 'function') {
      return null;
    }
    entries.set(index, fn as KernelFn);
  }
  return marshal('javascript', plan, variables, entries, () => cells, marks);
}

interface Trial {
  calls: number;
  cross: number;
  inside: number;
  cells: number;
  /** The first call copies everything at least once; it says nothing about the rest. */
  cold: boolean;
}

/** What one entry point copies, and how it has been doing. */
interface Root {
  reading: KernelSlot[];
  writing: KernelSlot[];
  trial: Trial | null;
  /** Cells a call moved on average while it was last timed. */
  baseline: number;
  calls: number;
  cells: number;
  fails: number;
  /** Calls left to sit out, and what that ends in. */
  wait: number;
  waitEnds: 'retry' | 'trial';
  rest: number;
  retry: number;
  /** Its data no longer fits the module; it never comes back. */
  stopped: boolean;
}

function newTrial(cold: boolean): Trial {
  return { calls: 0, cross: 0, inside: 0, cells: 0, cold };
}

/**
 * Everything either kernel needs around it: moving the work's numbers across.
 * `marks` comes with the javascript kernel, which records the list items a run
 * stored into; without it every item of a list a root may write goes back.
 */
function marshal(
  where: 'wasm' | 'javascript',
  plan: Pick<KernelPlan, 'slots' | 'roots' | 'access' | 'depth' | 'size'>,
  variables: Variable[],
  entries: Map<number, KernelFn>,
  data: () => Float64Array,
  marks: KernelMarks | null = null,
): KernelHandle {
  // Each root copies only what its own call tree reads and writes.
  const roots = new Map<number, Root>([...plan.access].map(([index, used]) => [index, {
    reading: used.touched.map((at) => plan.slots[at]!),
    writing: used.written.map((at) => plan.slots[at]!),
    trial: newTrial(true),
    baseline: 0,
    calls: 0,
    cells: 0,
    fails: 0,
    wait: 0,
    waitEnds: 'retry',
    rest: REST_FIRST,
    retry: RETRY_FIRST,
    stopped: false,
  }]));
  const stats = { runs: 0, fallbacks: 0, copied: 0, dropped: 0 };
  /** Cells the current call moved, both ways. */
  let moved = 0;
  /**
   * What each slot's variable stood at when the kernel last agreed with it.
   * A table the work only reads — a connectome, a lookup curve — then crosses
   * once instead of every frame.
   *
   * Keyed by the variable, not by where it sits: a list of no length takes no
   * room, so the slot after it starts at the same place, and a key of the place
   * would have one of them answer for the other.
   */
  const stamp = new Map<number, number>();

  const agree = (slot: KernelSlot, variable: Variable): void => {
    stamp.set(slot.variable, variable.revision);
    variable.synced();
  };

  /**
   * Copies one variable or list in.
   *
   * `stop` means the work and the module no longer describe the same data —
   * a list that changed length, or one holding text a run would rewrite — and
   * the roots that touch it step aside for good. `skip` is only this call's
   * business.
   */
  function copyIn(slot: KernelSlot, cells: Float64Array): 'ok' | 'skip' | 'stop' {
    const variable = variables[slot.variable];
    if (!variable) {
      return 'stop';
    }
    const seen = stamp.get(slot.variable);
    if (seen === variable.revision) {
      return 'ok';
    }
    if (slot.list) {
      const array = variable.array;
      if (array.length !== slot.length) {
        return 'stop';
      }
      // Items written one at a time since the last copy are all that changed.
      const span = seen === undefined ? null : variable.changedSince(seen);
      const from = span ? Math.max(0, span[0]) : 0;
      const to = span ? Math.min(slot.length - 1, span[1]) : slot.length - 1;
      const count = Math.max(0, to - from + 1);
      stats.copied += count;
      moved += count;
      if (slot.judgement) {
        for (let at = from; at <= to; at += 1) {
          const item = array[at]!.data;
          if (!judged(item)) {
            // A work that has not filled the list yet still carries whatever it
            // was saved with; javascript writes the words, and the kernel takes
            // the list over from the next call.
            return 'skip';
          }
          cells[slot.base + at] = item === 'TRUE' ? 1 : 0;
        }
        agree(slot, variable);
        return 'ok';
      }
      for (let at = from; at <= to; at += 1) {
        const item = array[at]!.data;
        if (!canonical(item)) {
          return 'stop';
        }
        cells[slot.base + at] = Number(item);
      }
      // A table the kernel only reads carries its tails across with it, counted
      // here once instead of inside every loop that reads it.
      if (slot.tails >= 0) {
        for (let at = from; at <= to; at += 1) {
          cells[slot.tails + at] = decimals(cells[slot.base + at]!);
        }
      }
      agree(slot, variable);
      return 'ok';
    }
    stats.copied += 1;
    moved += 1;
    const raw = variable.value;
    const value = Number(raw);
    if (!Number.isFinite(value) || String(raw).trim() === '') {
      return 'skip';
    }
    cells[slot.base] = value;
    // How the stored text is written decides the next `change_variable`, so the
    // places come across with the value.
    const source = String(raw);
    const dot = source.indexOf('.');
    const places = typeof raw === 'number' || dot === -1 && !/^-?\d+$/.test(source)
      ? -1
      : Math.min(dot === -1 ? 0 : source.length - dot - 1, 20);
    // A branch may leave this variable untouched; copying it out must preserve its text.
    if (typeof raw === 'string' && (places >= 0 ? value.toFixed(places) : String(value)) !== raw) {
      return 'skip';
    }
    cells[slot.places] = places;
    agree(slot, variable);
    return 'ok';
  }

  /** Whether a run stored into this list item; without marks, any it may write. */
  const stored = (cell: number): boolean => !marks || marks.flags[cell] === 1;

  function copyOut(slot: KernelSlot, cells: Float64Array): void {
    const variable = variables[slot.variable]!;
    if (slot.list) {
      const array = variable.array;
      // With marks, only the stored items, inside the span the run touched.
      const from = marks ? Math.max(slot.base, marks.span[0]!) - slot.base : 0;
      const to = marks ? Math.min(slot.base + slot.length - 1, marks.span[1]!) - slot.base : slot.length - 1;
      let wrote = false;
      for (let at = from; at <= to; at += 1) {
        if (!stored(slot.base + at)) continue;
        array[at] = { data: slot.judgement ? (cells[slot.base + at] !== 0 ? 'TRUE' : 'FALSE') : cells[slot.base + at]! };
        moved += 1;
        wrote = true;
      }
      if (wrote) variable.touch();
    } else {
      const places = cells[slot.places]!;
      const value = cells[slot.base]!;
      moved += 1;
      // Entry keeps what `toFixed` wrote, so a counter holds "1", not 1.
      variable.setValue(places >= 0 ? value.toFixed(places) : value);
    }
    // The kernel and the work now hold the same thing, so nothing crosses back
    // until something outside writes it.
    agree(slot, variable);
  }

  const clearMarks = (): void => {
    if (!marks) return;
    const [low, high] = marks.span;
    if (high! >= low!) marks.flags.fill(0, low, high! + 1);
    marks.span[0] = plan.size;
    marks.span[1] = -1;
  };

  /** A call that could not finish in the kernel; a root that keeps failing rests. */
  const fell = (state: Root): null => {
    stats.fallbacks += 1;
    state.fails += 1;
    if (state.fails >= FAIL_LIMIT) {
      state.fails = 0;
      state.wait = state.rest;
      state.waitEnds = 'retry';
      state.rest = Math.min(state.rest * 2, REST_MAX);
    }
    return null;
  };

  return {
    where,
    roots: plan.roots,
    depth: plan.depth,
    stats,
    run(root: number, args: number[]): number | null {
      const fn = entries.get(root);
      const state = roots.get(root);
      if (!fn || !state || state.stopped) {
        return null;
      }
      if (state.wait > 0) {
        state.wait -= 1;
        if (state.wait === 0 && state.waitEnds === 'trial') {
          state.trial = newTrial(false);
        }
        return null;
      }
      const trial = state.trial;
      const started = trial ? performance.now() : 0;
      const cells = data();
      moved = 0;
      for (const slot of state.reading) {
        const result = copyIn(slot, cells);
        if (result !== 'ok') {
          if (result === 'stop') {
            state.stopped = true;
            stats.dropped += 1;
            stats.fallbacks += 1;
            return null;
          }
          return fell(state);
        }
      }
      cells[BAIL_SLOT] = 0;
      const entered = trial ? performance.now() : 0;
      const result = fn(...args);
      const left = trial ? performance.now() : 0;
      if (cells[BAIL_SLOT] !== 0) {
        clearMarks();
        return fell(state);
      }
      const written = data();
      for (const slot of state.writing) {
        copyOut(slot, written);
      }
      clearMarks();
      stats.runs += 1;
      state.fails = 0;
      state.rest = REST_FIRST;
      if (trial) {
        if (trial.cold) {
          trial.cold = false;
        } else {
          trial.calls += 1;
          trial.inside += left - entered;
          trial.cross += entered - started + (performance.now() - left);
          trial.cells += moved;
        }
        const measured = trial.inside + trial.cross;
        if (trial.calls >= TRIAL_CALLS && (measured >= TRIAL_MIN_MS || trial.calls >= TRIAL_MAX_CALLS)) {
          state.trial = null;
          // The blocks this stands in for cost a small multiple of what the
          // kernel does, so a crossing that costs as much as the run itself
          // has already eaten the difference.
          if (trial.cross > trial.inside) {
            stats.dropped += 1;
            state.wait = state.retry;
            state.waitEnds = 'trial';
            state.retry = Math.min(state.retry * 2, RETRY_MAX);
          } else {
            state.baseline = trial.cells / trial.calls;
            state.calls = 0;
            state.cells = 0;
          }
        }
      } else {
        // A root that passed its trial can start copying far more later, when
        // something outside begins rewriting what it reads; it is timed again.
        state.calls += 1;
        state.cells += moved;
        if (state.calls >= WATCH_CALLS) {
          if (state.cells / state.calls > Math.max(state.baseline * 4, state.baseline + 64)) {
            state.trial = newTrial(false);
          }
          state.calls = 0;
          state.cells = 0;
        }
      }
      return result;
    },
  };
}

export { CALL_DEPTH_LIMIT };
