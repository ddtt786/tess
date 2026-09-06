/**
 * @fileoverview Hooks entry's own runner so tessvm can stand in for it.
 *
 * This is for the pages where a work is played — `playentry.org/project/<id>`
 * and the full-screen and embedded views of it — not the block editor.
 *
 * Entry keeps its page, its buttons and its state machine; only the part that
 * actually executes blocks is taken away. Every script start in entry — the
 * start button, keys, mouse, messages, clones — goes through
 * `Entry.container.mapEntityIncludeCloneOnScene`, so holding that one call shut
 * is enough to leave entry running nothing while tessvm runs the work.
 */

type AnyFunction = (...args: unknown[]) => unknown;

interface EntryEngine {
  state?: string;
  toggleRun?: AnyFunction;
  toggleStop?: AnyFunction;
  togglePause?: AnyFunction;
}

interface EntryContainer {
  mapEntityIncludeCloneOnScene?: AnyFunction;
}

export interface EntryLike {
  engine?: EntryEngine;
  container?: EntryContainer;
  loadProject?: AnyFunction;
  exportProject?: (project?: unknown) => unknown;
  defaultPath?: string;
  soundPath?: string;
  mediaFilePath?: string;
  type?: string;
}

export interface EntryHooks {
  /** Whether tessvm should take this run. Read at the moment 시작하기 is pressed. */
  wantsControl(): boolean;
  /** The work entry just loaded, kept as the fallback for `exportProject`. */
  onProjectLoaded(project: Record<string, unknown>): void;
  /** Entry is about to enter the run state; the work is what tessvm should run. */
  onRun(project: Record<string, unknown> | null): void;
  onStop(): void;
  onPause(paused: boolean): void;
}

const PATCH_MARK = '__tessvmPatched';

/** Replaces `target[key]` once, keeping the original reachable for the wrapper. */
function patch(
  target: Record<string, unknown>,
  key: string,
  wrap: (original: AnyFunction) => AnyFunction,
): boolean {
  const current = target[key];
  if (typeof current !== 'function') return false;
  if ((current as unknown as Record<string, unknown>)[PATCH_MARK]) return false;
  const wrapped = wrap(current as AnyFunction) as AnyFunction & Record<string, unknown>;
  wrapped[PATCH_MARK] = true;
  target[key] = wrapped;
  return true;
}

export class EntryBridge {
  private readonly hooks: EntryHooks;
  private loaded: Record<string, unknown> | null = null;
  /** True while tessvm holds the run and entry must not start any script. */
  private owned = false;
  private timer = 0;

  constructor(hooks: EntryHooks) {
    this.hooks = hooks;
  }

  get entry(): EntryLike | null {
    const value = (window as unknown as { Entry?: EntryLike }).Entry;
    return value && typeof value === 'object' ? value : null;
  }

  /**
   * Attaches to entry as early as the page allows, and stays attached.
   *
   * The property hook catches the moment entryjs publishes `Entry`, which is
   * usually before it loads the work; the poll behind it covers a page that
   * declared `Entry` some other way, and re-patches an engine entry replaces
   * later (a reloaded work, a second workspace).
   */
  install(): void {
    if (this.timer) return;
    const tick = () => this.patchAll();
    this.watchGlobal();
    tick();
    this.timer = window.setInterval(tick, 100);
  }

  /** Runs `patchAll` the instant entryjs assigns `window.Entry`. */
  private watchGlobal(): void {
    const host = window as unknown as Record<string, unknown>;
    if (host.Entry !== undefined) return;
    let value: unknown;
    try {
      Object.defineProperty(host, 'Entry', {
        configurable: true,
        get: () => value,
        set: (next: unknown) => {
          value = next;
          this.patchAll();
        },
      });
    } catch {
      // A page that declared `Entry` as a global variable leaves no property to
      // redefine; the poll picks it up a tick later.
    }
  }

  /** Stops watching. The patches already in place stay, and stay harmless. */
  uninstall(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = 0;
  }

  private patchAll(): void {
    const entry = this.entry;
    if (!entry) return;
    this.patchLoadProject(entry);
    this.patchEngine(entry);
    this.patchContainer(entry);
  }

  private patchLoadProject(entry: EntryLike): void {
    patch(entry as unknown as Record<string, unknown>, 'loadProject', (original) => {
      const bridge = this;
      return function patched(this: unknown, ...args: unknown[]) {
        const project = args[0];
        if (project && typeof project === 'object') {
          bridge.loaded = project as Record<string, unknown>;
          bridge.hooks.onProjectLoaded(bridge.loaded);
        }
        return original.apply(this, args);
      };
    });
  }

  private patchEngine(entry: EntryLike): void {
    const engine = entry.engine as unknown as Record<string, unknown> | undefined;
    if (!engine) return;
    const bridge = this;

    patch(engine, 'toggleRun', (original) =>
      function patched(this: EntryEngine, ...args: unknown[]) {
        // Resuming from a pause runs through togglePause, which is patched too.
        if (this.state === 'pause' || !bridge.hooks.wantsControl()) {
          return original.apply(this, args);
        }
        const project = bridge.snapshot();
        bridge.owned = true;
        const result = original.apply(this, args);
        bridge.hooks.onRun(project);
        return result;
      });

    patch(engine, 'toggleStop', (original) =>
      function patched(this: EntryEngine, ...args: unknown[]) {
        if (!bridge.owned) return original.apply(this, args);
        bridge.owned = false;
        bridge.hooks.onStop();
        return original.apply(this, args);
      });

    patch(engine, 'togglePause', (original) =>
      function patched(this: EntryEngine, ...args: unknown[]) {
        if (!bridge.owned) return original.apply(this, args);
        const result = original.apply(this, args);
        bridge.hooks.onPause(this.state === 'pause');
        return result;
      });
  }

  private patchContainer(entry: EntryLike): void {
    const container = entry.container as unknown as Record<string, unknown> | undefined;
    if (!container) return;
    const bridge = this;
    patch(container, 'mapEntityIncludeCloneOnScene', (original) =>
      function patched(this: unknown, ...args: unknown[]) {
        // Entry raises every script event through here. While tessvm owns the
        // run, no script of entry's may start; callers read an array back.
        if (bridge.owned) return [];
        return original.apply(this, args);
      });
  }

  /**
   * The work to run. On a play page it is exactly what entry was handed, so
   * that copy is used as it is — `exportProject` re-serialises the whole
   * runtime, needs the editor's interface state, and stops the engine on its
   * way through. It is kept only as the fallback for a page whose load we
   * arrived too late to see.
   */
  snapshot(): Record<string, unknown> | null {
    if (this.loaded) return this.loaded;
    try {
      const exported = this.entry?.exportProject?.({});
      if (exported && typeof exported === 'object') {
        return exported as Record<string, unknown>;
      }
    } catch {
      // A page without the editor cannot capture its interface state.
    }
    return null;
  }

  /**
   * True on the block editor. Entry names the play views `minimize`,
   * `invisible`, `phone` and `mobile`, and the editor `workspace`; the path is
   * read as well for the moment before entry has settled its own type.
   */
  isEditor(): boolean {
    if (this.entry?.type === 'workspace') return true;
    return /^\/ws(\/|$)/.test(window.location.pathname);
  }

  /** Gives entry its runner back, whatever state the page is in. */
  release(): void {
    this.owned = false;
  }

  get controlled(): boolean {
    return this.owned;
  }

  /** Entry's own stage canvas — what the tessvm stage is laid over. */
  canvas(): HTMLElement | null {
    return document.getElementById('entryCanvas');
  }

  engineState(): string {
    return this.entry?.engine?.state ?? 'stop';
  }
}
