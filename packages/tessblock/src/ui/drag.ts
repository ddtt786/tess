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

export function beginDrag(start: PointerEvent, handlers: DragHandlers): void {
  const slop = handlers.slop ?? 0;
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
