/**
 * @fileoverview Names a work can use to reach what the browser has and entry
 * does not.
 *
 * Each one is an ordinary entry variable or signal, so a work carrying them
 * runs on entry all the same: nothing there sets `$TESSVM`, writing
 * `$CLIPBOARD` copies nothing, and `$SCROLL` is a signal no one sends. A work
 * asks `$TESSVM == 1` to find out which runner it is on and leaves the rest of
 * itself alone when it is not this one.
 *
 * | name          | direction | what it is                                  |
 * | ------------- | --------- | ------------------------------------------- |
 * | `$TESSVM`     | read      | `1` on this runner, untouched on entry      |
 * | `$CLIPBOARD`  | both      | what the viewer pasted · what to copy       |
 * | `$CURSOR`     | write     | a css cursor keyword for the stage          |
 * | `$MOUSE_LOCK` | both      | `1` holds the pointer, `0` gives it back    |
 * | `$M_LOCK`     | both      | the same name, inside entry's ten letters   |
 * | `$DELTA_X/Y`  | read      | pointer movement of the frame, stage units  |
 * | `$SCROLL_X/Y` | read      | wheel movement of the frame                 |
 * | `$SCROLL`     | signal    | raised in a frame the viewer scrolled in    |
 *
 * Only global variables are taken: an object's own variable is copied per clone,
 * which is not something one name on the page can stand for.
 *
 * Reaching the browser itself is the host's part (`ExtrasHost`). A runner
 * without one — the headless vm — still answers `$TESSVM`.
 */
import { bool } from './cast.ts';
import type { Variable } from './model.ts';
import type { Vm } from './engine.ts';

/**
 * Variable names this runner knows, by the part each one plays. Entry's own
 * name box takes ten characters, so a name over that carries a short one beside
 * it — either may be used, and a work holding both is read by the first.
 */
export const EXTRA_VARIABLES = {
  tessvm: ['$TESSVM'],
  clipboard: ['$CLIPBOARD'],
  cursor: ['$CURSOR'],
  mouseLock: ['$MOUSE_LOCK', '$M_LOCK'],
  deltaX: ['$DELTA_X'],
  deltaY: ['$DELTA_Y'],
  scrollX: ['$SCROLL_X'],
  scrollY: ['$SCROLL_Y'],
} as const;

/** Name of the signal raised for the wheel. */
export const SCROLL_MESSAGE = '$SCROLL';

type Slot = keyof typeof EXTRA_VARIABLES;

/** Slots the work writes to and the host acts on. */
const WATCHED = ['clipboard', 'cursor', 'mouseLock'] as const;

/**
 * Every css `cursor` keyword. The work names one of these or nothing happens —
 * what a work writes never reaches the style as it was typed, so `url(…)` and
 * the rest of the property's syntax are out of its reach.
 */
export const CURSORS = new Set([
  'auto', 'default', 'none', 'context-menu', 'help', 'pointer', 'progress',
  'wait', 'cell', 'crosshair', 'text', 'vertical-text', 'alias', 'copy', 'move',
  'no-drop', 'not-allowed', 'grab', 'grabbing', 'all-scroll', 'col-resize',
  'row-resize', 'n-resize', 'e-resize', 's-resize', 'w-resize', 'ne-resize',
  'nw-resize', 'se-resize', 'sw-resize', 'ew-resize', 'ns-resize',
  'nesw-resize', 'nwse-resize', 'zoom-in', 'zoom-out',
]);

/** What the page lends the runner. Every call may be answered with nothing. */
export interface ExtrasHost {
  /** Asks the viewer, then puts the text on the clipboard. */
  copy(text: string): void;
  /** A css cursor keyword, or `''` to leave the cursor to the runner. */
  cursor(value: string): void;
  /** Asks the viewer, then holds the pointer or gives it back. */
  lock(on: boolean): void;
  /** The work stopped — whatever was taken from the page goes back. */
  release(): void;
}

/** Which of the names the work actually carries. */
export interface ExtrasUse {
  clipboard: boolean;
  cursor: boolean;
  mouseLock: boolean;
  scroll: boolean;
}

export class Extras {
  host: ExtrasHost | null = null;
  /** What the loaded work carries, for the host to know what to listen for. */
  readonly uses: ExtrasUse = {
    clipboard: false,
    cursor: false,
    mouseLock: false,
    scroll: false,
  };

  private readonly vm: Vm;
  private readonly slots = new Map<Slot, Variable>();
  private scrollId: string | null = null;
  /** Watched names the work has written to since the last frame was read. */
  private readonly dirty = new Set<Slot>();
  private moveX = 0;
  private moveY = 0;
  private wheelX = 0;
  private wheelY = 0;
  private wheeled = false;
  private locked = false;

  constructor(vm: Vm) {
    this.vm = vm;
  }

  /** Picks the names out of a work that has just been loaded. */
  bind(): void {
    this.slots.clear();
    for (const [slot, names] of Object.entries(EXTRA_VARIABLES) as Array<
      [Slot, readonly string[]]
    >) {
      const found = this.vm.variables.find(
        (variable) =>
          !variable.isList && variable.objectId === null && names.includes(variable.name),
      );
      if (found) {
        this.slots.set(slot, found);
      }
    }
    this.scrollId =
      this.vm.messages.find((message) => message.name === SCROLL_MESSAGE)?.id ?? null;
    this.uses.clipboard = this.slots.has('clipboard');
    this.uses.cursor = this.slots.has('cursor');
    this.uses.mouseLock = this.slots.has('mouseLock');
    this.uses.scroll = this.scrollId !== null || this.slots.has('scrollX') || this.slots.has('scrollY');
    // A write is what acts, not a change: the same text written to `$CLIPBOARD`
    // twice is a work asking to copy it twice.
    for (const slot of WATCHED) {
      const variable = this.slots.get(slot);
      if (variable) {
        variable.onWrite = () => this.dirty.add(slot);
      }
    }
    // The one name that answers before the work has run a block. Set before the
    // snapshot is taken, so stopping the work leaves it answering.
    this.slots.get('tessvm')?.setValue(1);
    this.dirty.clear();
  }

  /** The work started: what it holds now is the baseline, not a write. */
  started(): void {
    this.locked = false;
    this.moveX = 0;
    this.moveY = 0;
    this.wheelX = 0;
    this.wheelY = 0;
    this.wheeled = false;
    this.dirty.clear();
  }

  /** The work stopped — nothing of it is left on the page. */
  stopped(): void {
    this.locked = false;
    this.host?.release();
  }

  /** End of a tick: what came in from the page goes in, what the work wrote goes out. */
  frame(): void {
    this.pushWheel();
    this.pushMove();
    for (const slot of WATCHED) {
      this.read(slot);
    }
  }

  // -------------------------------------------------------------------------
  //  From the page
  // -------------------------------------------------------------------------
  /** The viewer pasted. Writing it back is not a write the work made. */
  pasted(text: string): void {
    const slot = this.slots.get('clipboard');
    if (!slot || this.vm.state !== 'run') {
      return;
    }
    slot.setValue(text);
    // What the page put there is not the work asking for it to be copied back.
    this.dirty.delete('clipboard');
  }

  /** Pointer movement while the pointer is held, in stage units. */
  moved(x: number, y: number): void {
    this.moveX += x;
    this.moveY += y;
  }

  /** Wheel movement over the stage. One frame's worth raises one signal. */
  scrolled(x: number, y: number): void {
    if (this.vm.state !== 'run') {
      return;
    }
    this.wheelX += x;
    this.wheelY += y;
    this.wheeled = true;
  }

  /** The browser took the pointer or handed it back (`Esc` does the latter). */
  lockChanged(on: boolean): void {
    this.locked = on;
    const slot = this.slots.get('mouseLock');
    if (slot) {
      slot.setValue(on ? 1 : 0);
      this.dirty.delete('mouseLock');
    }
    if (!on) {
      this.moveX = 0;
      this.moveY = 0;
      this.writeMove();
    }
  }

  // -------------------------------------------------------------------------
  //  To the page
  // -------------------------------------------------------------------------
  private read(slot: (typeof WATCHED)[number]): void {
    const variable = this.slots.get(slot);
    if (!variable || !this.dirty.delete(slot)) {
      return;
    }
    const value = String(variable.getValue());
    if (slot === 'clipboard') {
      this.host?.copy(value);
    } else if (slot === 'cursor') {
      const keyword = value.trim().toLowerCase();
      this.host?.cursor(CURSORS.has(keyword) ? keyword : '');
    } else {
      this.host?.lock(bool(value));
    }
  }

  private pushMove(): void {
    if (this.locked) {
      this.writeMove();
    }
  }

  private writeMove(): void {
    this.slots.get('deltaX')?.setValue(this.moveX);
    this.slots.get('deltaY')?.setValue(this.moveY);
    this.moveX = 0;
    this.moveY = 0;
  }

  private pushWheel(): void {
    if (!this.wheeled) {
      return;
    }
    this.wheeled = false;
    this.slots.get('scrollX')?.setValue(this.wheelX);
    this.slots.get('scrollY')?.setValue(this.wheelY);
    this.wheelX = 0;
    this.wheelY = 0;
    if (this.scrollId) {
      this.vm.queueMessage(this.scrollId);
    }
  }
}
