/**
 * @fileoverview `store` — the names a work keeps between runs.
 *
 * The convention is the Entry Save Manager extension's, so a work built by Tess
 * saves the same way on playentry as it does here: every global variable and
 * list whose entry name begins with `@` is kept, calling the function named
 * `@저장` writes them out (`@비동기저장` does not wait for the write), and
 * `@확장프로그램` stands at 1 while saving is available at all.
 *
 * | entry              | Tess         |
 * | ------------------ | ------------ |
 * | `@이름` (전역)     | `store var`  |
 * | `@저장()`          | `save`       |
 * | `@비동기저장()`    | `save async` |
 * | `@확장프로그램 == 1` | `can_save`   |
 *
 * What the page keeps them in is the page's own part (`SaveHost`). A runner
 * without one saves nothing and answers `can_save` with no.
 */
import type { Variable } from './model.ts';
import type { Vm } from './engine.ts';

/** What marks a global variable or list as one to keep. */
export const STORE_PREFIX = '@';
/** Set to 1 while the values can be kept, so a work can ask before it saves. */
export const STORE_FLAG = '@확장프로그램';
export const STORE_FLAG_ON = 1;
export const STORE_SAVE_FUNCTION = '@저장';
export const STORE_SAVE_ASYNC_FUNCTION = '@비동기저장';

/** Function names the work calls to save, and whether the call waits. */
export const SAVE_FUNCTIONS: Record<string, 'wait' | 'async'> = {
  '@저장': 'wait',
  '@비동기저장': 'async',
};

/** Whether an entry variable or list name is one the save manager keeps. */
export function isStoreName(name: unknown): boolean {
  if (typeof name !== 'string') return false;
  const trimmed = name.trim();
  return trimmed.startsWith(STORE_PREFIX) && !isStoreFlag(trimmed);
}

/** Whether a variable name is the save manager's availability flag. */
export function isStoreFlag(name: unknown): boolean {
  if (typeof name !== 'string') return false;
  return name.replace(/\s+/g, '') === STORE_FLAG;
}

/**
 * Normalizes save function names, handling whitespace and call syntax.
 * Maps variations of `@저장` to `wait` and `@비동기저장` to `async`.
 */
export function saveFunctionKind(name: unknown): 'wait' | 'async' | undefined {
  if (typeof name !== 'string') return undefined;
  const clean = name.trim().replace(/\s*\([^)]*\)\s*$/, '').replace(/^@\s+/, '@');
  if (clean === STORE_SAVE_FUNCTION) return 'wait';
  if (clean === STORE_SAVE_ASYNC_FUNCTION) return 'async';
  return undefined;
}

/** One name's value: a variable's own, or a list's items. */
export type StoredValue = string | number | Array<{ data: string | number }>;

/** Where the values are kept. Every call may be answered with nothing. */
export interface SaveHost {
  /** Everything kept for this work, by entry name. */
  read(): Promise<Record<string, StoredValue>>;
  /** Writes the lot. Resolves when it is in. */
  write(values: Record<string, StoredValue>): Promise<void>;
}

/**
 * The `@` names of a loaded work, and what is kept for them.
 *
 * The values are read once and held, so a run can start on them without
 * waiting: what storage answered is put back at the top of **every** run, the
 * way the extension puts it back every time the work is played.
 */
export class SaveStore {
  host: SaveHost | null = null;
  /** Whether the work carries any name of the save manager's at all. */
  used = false;

  private readonly vm: Vm;
  private kept: Variable[] = [];
  private flag: Variable | null = null;
  /** What storage last held, by entry name. */
  private values: Record<string, StoredValue> = {};

  constructor(vm: Vm) {
    this.vm = vm;
  }

  /** Picks the names out of a work that has just been loaded. */
  bind(functions: Array<{ content?: unknown }> = []): void {
    const hasSaveFunction = functions.some((fn) =>
      saveFunctionKind(functionLabel(fn.content)) !== undefined,
    );
    this.kept = this.vm.variables.filter(
      (variable) =>
        variable.objectId === null &&
        isStoreName(variable.name),
    );
    this.flag =
      this.vm.variables.find(
        (variable) => variable.objectId === null && isStoreFlag(variable.name),
      ) ?? null;
    this.used = this.kept.length > 0 || this.flag !== null || hasSaveFunction;
    this.values = {};
  }

  /**
   * Reads what storage holds and puts it in. Called once the work is loaded and
   * before it is started, so the opening frame already shows the kept values.
   */
  async load(): Promise<void> {
    if (!this.host || !this.used) {
      return;
    }
    this.values = await this.host.read().catch(() => ({}));
    this.apply();
  }

  /** The work started: what was kept goes back in, and the flag says it is there. */
  started(): void {
    this.apply();
  }

  /**
   * Writes every kept name out. The promise is what `save` waits on; a write
   * the page refuses is not an error the work is told about.
   */
  async write(): Promise<void> {
    if (!this.host) {
      return;
    }
    this.used = true;
    const values: Record<string, StoredValue> = {};
    for (const variable of this.kept) {
      values[variable.name] = variable.isList
        ? variable.getArray().map((item) => ({ data: item.data }))
        : variable.getValue();
    }
    this.values = values;
    await this.host.write(values).catch(() => undefined);
  }

  /** Puts the held values into the work's own names. */
  private apply(): void {
    if (!this.host) {
      return;
    }
    for (const variable of this.kept) {
      const saved = this.values[variable.name] ?? this.values[variable.name.trim()];
      if (saved === undefined) {
        continue;
      }
      if (variable.isList && Array.isArray(saved)) {
        variable.array = saved.map((item) => ({ data: item.data }));
        variable.touch();
      } else if (!variable.isList && !Array.isArray(saved)) {
        variable.value = saved;
        variable.touch();
      }
    }
    // The work reads this before it writes anything of its own, so it is set
    // whether or not anything was kept yet.
    this.flag?.setValue(STORE_FLAG_ON);
  }
}

/**
 * The label an entry function carries, which is its name — `function_create`
 * holds it in the first slot of its field chain.
 */
export function functionLabel(content: unknown): string {
  const stacks = typeof content === 'string' ? safeParse(content) : content;
  const create = (Array.isArray(stacks) ? stacks.flat() : []).find(
    (block) => (block as { type?: string })?.type?.startsWith('function_create'),
  ) as { params?: unknown[] } | undefined;
  const field = create?.params?.[0] as { type?: string; params?: unknown[] } | undefined;
  if (field?.type !== 'function_field_label') {
    return '';
  }
  const raw = String(field.params?.[0] ?? '').trim();
  const kind = saveFunctionKind(raw);
  if (kind === 'wait') return STORE_SAVE_FUNCTION;
  if (kind === 'async') return STORE_SAVE_ASYNC_FUNCTION;
  return raw;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return [];
  }
}
