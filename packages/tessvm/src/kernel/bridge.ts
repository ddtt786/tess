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
import { kernelOps } from './runtime-js.ts';
import type { Variable } from '../runtime/model.ts';

/** Where the shared data region starts, in bytes. Matches `runtime.mbt`. */
const DATA_BASE = 1024;

/** Entry unwinds a call chain this deep; the kernel needs room for its own. */
const CALL_DEPTH_LIMIT = 1000;

/** Calls timed before deciding whether an entry point is worth its crossing. */
const TRIAL_CALLS = 24;

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
   * runner because the crossing cost more than it saved.
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
  plan: Pick<KernelPlan, 'slots' | 'roots' | 'depth' | 'size'>,
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
  plan: Pick<KernelPlan, 'javascript' | 'slots' | 'roots' | 'depth' | 'size'>,
  variables: Variable[],
): KernelHandle | null {
  const cells = new Float64Array(plan.size);
  let built: Record<string, unknown>;
  try {
    const factory = new Function('R', plan.javascript) as (ops: unknown) => Record<string, unknown>;
    built = factory(kernelOps(cells));
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
  return marshal('javascript', plan, variables, entries, () => cells);
}

/** Everything either kernel needs around it: moving the work's numbers across. */
function marshal(
  where: 'wasm' | 'javascript',
  plan: Pick<KernelPlan, 'slots' | 'roots' | 'depth' | 'size'>,
  variables: Variable[],
  entries: Map<number, KernelFn>,
  data: () => Float64Array,
): KernelHandle {

  const reading = plan.slots.filter((slot) => slot.read || slot.written);
  const writing = plan.slots.filter((slot) => slot.written);
  /**
   * The first calls of each entry point are timed, because moving the numbers
   * across is not always worth what it buys. A function the work calls once a
   * frame around a few thousand turns of a loop pays nothing for the crossing;
   * one it calls a hundred times a frame pays it a hundred times, and the
   * kernel then costs more than the blocks it stands in for.
   */
  const trial = new Map<number, { calls: number; cross: number; inside: number }>(
    [...plan.roots.keys()].map((index) => [index, { calls: 0, cross: 0, inside: 0 }]),
  );
  /** Entry points the crossing was not worth; the block runner keeps those. */
  const dropped = new Set<number>();
  const stats = { runs: 0, fallbacks: 0, copied: 0, dropped: 0 };
  let live = true;
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

  /**
   * Copies one variable or list in.
   *
   * `stop` means the work and the module no longer describe the same data —
   * a list that changed length, or one holding text a run would rewrite — and
   * the kernel steps aside for good. `skip` is only this call's business.
   */
  function copyIn(slot: KernelSlot, cells: Float64Array): 'ok' | 'skip' | 'stop' {
    const variable = variables[slot.variable];
    if (!variable) {
      return 'stop';
    }
    if (stamp.get(slot.variable) === variable.revision) {
      return 'ok';
    }
    stats.copied += slot.length;
    if (slot.list) {
      const array = variable.array;
      if (array.length !== slot.length) {
        return 'stop';
      }
      if (slot.judgement) {
        for (let at = 0; at < slot.length; at += 1) {
          const item = array[at]!.data;
          if (!judged(item)) {
            // A work that has not filled the list yet still carries whatever it
            // was saved with; javascript writes the words, and the kernel takes
            // the list over from the next call.
            return 'skip';
          }
          cells[slot.base + at] = item === 'TRUE' ? 1 : 0;
        }
        stamp.set(slot.variable, variable.revision);
        return 'ok';
      }
      for (let at = 0; at < slot.length; at += 1) {
        const item = array[at]!.data;
        if (!canonical(item)) {
          return 'stop';
        }
        cells[slot.base + at] = Number(item);
      }
      // A table the kernel only reads carries its tails across with it, counted
      // here once instead of inside every loop that reads it.
      if (slot.tails >= 0) {
        for (let at = 0; at < slot.length; at += 1) {
          cells[slot.tails + at] = decimals(cells[slot.base + at]!);
        }
      }
      stamp.set(slot.variable, variable.revision);
      return 'ok';
    }
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
    cells[slot.places] = typeof raw === 'number' || dot === -1 && !/^-?\d+$/.test(source)
      ? -1
      : Math.min(dot === -1 ? 0 : source.length - dot - 1, 20);
    stamp.set(slot.variable, variable.revision);
    return 'ok';
  }

  function copyOut(slot: KernelSlot, cells: Float64Array): void {
    const variable = variables[slot.variable]!;
    if (slot.list) {
      const array = variable.array;
      if (slot.judgement) {
        for (let at = 0; at < slot.length; at += 1) {
          array[at] = { data: cells[slot.base + at] !== 0 ? 'TRUE' : 'FALSE' };
        }
      } else {
        for (let at = 0; at < slot.length; at += 1) {
          array[at] = { data: cells[slot.base + at]! };
        }
      }
      variable.touch();
    } else {
      const places = cells[slot.places]!;
      const value = cells[slot.base]!;
      // Entry keeps what `toFixed` wrote, so a counter holds "1", not 1.
      variable.setValue(places >= 0 ? value.toFixed(places) : value);
    }
    // The kernel and the work now hold the same thing, so nothing crosses back
    // until something outside writes it.
    stamp.set(slot.variable, variable.revision);
  }

  return {
    where,
    roots: plan.roots,
    depth: plan.depth,
    stats,
    run(root: number, args: number[]): number | null {
      const fn = live && !dropped.has(root) ? entries.get(root) : undefined;
      if (!fn) {
        return null;
      }
      const watch = trial.get(root);
      const started = watch ? performance.now() : 0;
      const cells = data();
      for (const slot of reading) {
        const state = copyIn(slot, cells);
        if (state !== 'ok') {
          live = state !== 'stop';
          stats.fallbacks += 1;
          return null;
        }
      }
      cells[BAIL_SLOT] = 0;
      const entered = watch ? performance.now() : 0;
      const result = fn(...args);
      const left = watch ? performance.now() : 0;
      if (cells[BAIL_SLOT] !== 0) {
        stats.fallbacks += 1;
        return null;
      }
      const written = data();
      for (const slot of writing) {
        copyOut(slot, written);
      }
      stats.runs += 1;
      if (watch) {
        watch.calls += 1;
        watch.inside += left - entered;
        watch.cross += entered - started + (performance.now() - left);
        if (watch.calls >= TRIAL_CALLS) {
          trial.delete(root);
          // The blocks this stands in for cost a small multiple of what the
          // kernel does, so a crossing that costs as much as the run itself
          // has already eaten the difference.
          if (watch.cross > watch.inside) {
            dropped.add(root);
            stats.dropped += 1;
          }
        }
      }
      return result;
    },
  };
}

export { CALL_DEPTH_LIMIT };
