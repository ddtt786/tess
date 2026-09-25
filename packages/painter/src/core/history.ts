export interface HistoryOptions {
  /** Maximum number of *undoable* states kept around. */
  limit?: number;
  onChange?: (state: { canUndo: boolean; canRedo: boolean }) => void;
  /** Called when a state is dropped off the end of the stack (frees ImageData, ...). */
  onDrop?: (snapshot: unknown) => void;
}

/**
 * Snapshot based undo stack.
 *
 * The stack always holds the *current* document at `index`; `push` appends the
 * state produced by an edit and discards any redo branch.
 */
export class History<T> {
  private stack: T[] = [];
  private index = -1;
  private readonly limit: number;
  private readonly onChange?: HistoryOptions['onChange'];
  private readonly onDrop?: HistoryOptions['onDrop'];
  /** While > 0, `push` is ignored (used while restoring). */
  private muted = 0;

  constructor(options: HistoryOptions = {}) {
    this.limit = options.limit ?? 60;
    this.onChange = options.onChange;
    this.onDrop = options.onDrop;
  }

  get canUndo(): boolean {
    return this.index > 0;
  }

  get canRedo(): boolean {
    return this.index >= 0 && this.index < this.stack.length - 1;
  }

  get current(): T | null {
    return this.index >= 0 ? this.stack[this.index] : null;
  }

  get size(): number {
    return this.stack.length;
  }

  /** Replaces the whole stack with a single baseline state. */
  reset(initial: T): void {
    for (const s of this.stack) this.onDrop?.(s);
    this.stack = [initial];
    this.index = 0;
    this.notify();
  }

  push(snapshot: T): void {
    if (this.muted > 0) return;
    // Drop the redo branch.
    for (let i = this.index + 1; i < this.stack.length; i++) this.onDrop?.(this.stack[i]);
    this.stack.length = this.index + 1;
    this.stack.push(snapshot);
    if (this.stack.length > this.limit + 1) {
      this.onDrop?.(this.stack[0]);
      this.stack.shift();
    }
    this.index = this.stack.length - 1;
    this.notify();
  }

  undo(): T | null {
    if (!this.canUndo) return null;
    this.index--;
    this.notify();
    return this.stack[this.index];
  }

  redo(): T | null {
    if (!this.canRedo) return null;
    this.index++;
    this.notify();
    return this.stack[this.index];
  }

  /** Runs `fn` without recording anything (used while applying a restore). */
  silently<R>(fn: () => R): R {
    this.muted++;
    try {
      return fn();
    } finally {
      this.muted--;
    }
  }

  private notify(): void {
    this.onChange?.({ canUndo: this.canUndo, canRedo: this.canRedo });
  }
}
