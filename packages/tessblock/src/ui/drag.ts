/**
 * @fileoverview Pointer dragging that does not depend on pointer capture.
 *
 * Listeners sit on the window, so a drag keeps working when the pointer leaves
 * the element it started on.
 */
export interface DragHandlers {
  /** Called once the pointer has moved past the slop distance. */
  onMove(event: PointerEvent, start: PointerEvent): void;
  onEnd?(event: PointerEvent, moved: boolean): void;
  /** Pixels to move before a drag starts. */
  slop?: number;
}

/** A click that wobbles this little is still a click, not a drag. */
const CLICK_SLOP = 4;

export function beginDrag(start: PointerEvent, handlers: DragHandlers): void {
  const slop = handlers.slop ?? CLICK_SLOP;
  let moved = slop === 0;

  const move = (event: PointerEvent) => {
    if (!moved) {
      const far = Math.abs(event.clientX - start.clientX) > slop || Math.abs(event.clientY - start.clientY) > slop;
      if (!far) return;
      moved = true;
    }
    handlers.onMove(event, start);
  };

  const end = (event: PointerEvent) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
    handlers.onEnd?.(event, moved);
  };

  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
}

export interface DragGhost {
  /** Moves the copy with the pointer, along the list's own axis. */
  follow(event: PointerEvent): void;
  remove(): void;
}

/**
 * A lifted copy of a row that follows the pointer while it is dragged, so it
 * is plain what is moving. The copy sits in a shallow copy of the row's parent,
 * so styles written against the list (`.item-list li`) still apply.
 */
export function dragGhost(row: HTMLElement, start: PointerEvent, axis: 'x' | 'y' = 'y'): DragGhost {
  const box = row.getBoundingClientRect();
  const holder = (row.parentElement?.cloneNode(false) as HTMLElement | undefined) ?? document.createElement('div');
  holder.removeAttribute('id');
  holder.classList.add('drag-ghost-holder');
  Object.assign(holder.style, {
    position: 'fixed', left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px`,
    margin: '0', padding: '0', overflow: 'visible', pointerEvents: 'none', zIndex: '1000', display: 'block',
  });
  const copy = row.cloneNode(true) as HTMLElement;
  copy.classList.remove('dragging', 'drop-before', 'drop-after', 'lifted', 'sliding');
  copy.classList.add('drag-ghost');
  Object.assign(copy.style, { width: `${box.width}px`, height: `${box.height}px`, margin: '0', translate: '' });
  holder.appendChild(copy);
  document.body.appendChild(holder);
  return {
    follow(event) {
      const dx = axis === 'x' ? event.clientX - start.clientX : 0;
      const dy = axis === 'y' ? event.clientY - start.clientY : 0;
      holder.style.transform = `translate(${dx}px, ${dy}px)`;
    },
    remove() {
      holder.remove();
    },
  };
}

/** Where a reordered item would land: over which item (by index), and on which side of it. */
export interface SlideTarget {
  over: number;
  before: boolean;
}

/**
 * Opens a gap where a dragged item would land, by sliding the items between
 * its old and new place. Positions are measured once when the drag starts, so
 * the moving items never change the answer.
 */
export class SlideReorder {
  private readonly items: HTMLElement[];
  private readonly axis: 'x' | 'y';
  private readonly rects: DOMRect[];
  private readonly from: number;
  private readonly step: number;

  constructor(items: HTMLElement[], dragged: HTMLElement, axis: 'x' | 'y' = 'y') {
    this.items = items;
    this.axis = axis;
    this.rects = items.map((item) => item.getBoundingClientRect());
    this.from = items.indexOf(dragged);
    const own = this.rects[this.from];
    const next = this.rects[this.from + 1] ?? this.rects[this.from - 1];
    const size = (rect: DOMRect | undefined) => (rect ? (axis === 'y' ? rect.height : rect.width) : 0);
    const start = (rect: DOMRect | undefined) => (rect ? (axis === 'y' ? rect.top : rect.left) : 0);
    // One slot: the item plus the gap to its neighbour.
    this.step = next && own ? Math.abs(start(next) - start(own)) || size(own) : size(own);
    for (const item of items) item.classList.add('sliding');
    dragged.classList.add('lifted');
  }

  /** The item under `pointer` (a client coordinate on the axis), measured where it started. */
  targetAt(pointer: number): SlideTarget | null {
    if (!this.rects.length) return null;
    const lo = (rect: DOMRect) => (this.axis === 'y' ? rect.top : rect.left);
    const hi = (rect: DOMRect) => (this.axis === 'y' ? rect.bottom : rect.right);
    let over = this.rects.findIndex((rect) => pointer >= lo(rect) && pointer <= hi(rect));
    if (over < 0) over = pointer < lo(this.rects[0]!) ? 0 : this.rects.length - 1;
    const rect = this.rects[over]!;
    return { over, before: pointer < (lo(rect) + hi(rect)) / 2 };
  }

  /** Slides the items so the gap sits at `target`; null closes it. */
  show(target: SlideTarget | null): void {
    const insertAt = target ? (target.before ? target.over : target.over + 1) : this.from;
    this.items.forEach((item, index) => {
      let shift = 0;
      if (insertAt > this.from + 1 && index > this.from && index < insertAt) shift = -this.step;
      if (insertAt < this.from && index >= insertAt && index < this.from) shift = this.step;
      // `translate`, not `transform`: rows run entrance animations on `transform`.
      item.style.translate = shift ? (this.axis === 'y' ? `0 ${shift}px` : `${shift}px 0`) : '';
    });
  }

  clear(): void {
    for (const item of this.items) {
      item.style.translate = '';
      item.classList.remove('sliding', 'lifted');
    }
  }
}
