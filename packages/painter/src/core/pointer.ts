import type { Point, PointerInfo } from './types.js';

export interface PointerHost {
  /** Element that receives the raw events. */
  element: SVGElement | HTMLElement;
  /** Maps client coordinates into scene coordinates. */
  toScene(clientX: number, clientY: number): Point;
  onDown(info: PointerInfo): void;
  onMove(info: PointerInfo): void;
  onUp(info: PointerInfo): void;
  onHover?(info: PointerInfo): void;
  onDoubleClick?(info: PointerInfo): void;
  onWheel?(event: WheelEvent): void;
  /** Return true to swallow the gesture (e.g. space-drag panning). */
  shouldIgnore?(event: PointerEvent): boolean;
}

/**
 * Normalises pointer events into scene space, adds pointer capture and keeps
 * the gesture origin around so tools can work with drags without bookkeeping.
 */
export function bindPointer(host: PointerHost): () => void {
  const el = host.element;
  let activeId: number | null = null;
  let start: Point = { x: 0, y: 0 };

  const build = (e: PointerEvent): PointerInfo => {
    const p = host.toScene(e.clientX, e.clientY);
    return {
      x: p.x,
      y: p.y,
      startX: start.x,
      startY: start.y,
      clientX: e.clientX,
      clientY: e.clientY,
      pressure: e.pressure > 0 && e.pressure !== 0.5 ? e.pressure : e.pointerType === 'mouse' ? 0.5 : 0.5,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
      secondary: e.button === 2 || e.buttons === 2,
      pointerId: e.pointerId,
      native: e,
    };
  };

  const onPointerDown = (e: PointerEvent) => {
    if (activeId !== null) return;
    if (host.shouldIgnore?.(e)) return;
    if (e.button !== 0 && e.button !== 2) return;
    activeId = e.pointerId;
    start = host.toScene(e.clientX, e.clientY);
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* capture is best-effort */
    }
    e.preventDefault();
    host.onDown(build(e));
  };

  const onPointerMove = (e: PointerEvent) => {
    if (activeId === null) {
      host.onHover?.(build(e));
      return;
    }
    if (e.pointerId !== activeId) return;
    e.preventDefault();
    // Coalesced events keep freehand strokes smooth on high-rate devices.
    const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    if (events.length > 1) {
      for (const ce of events) host.onMove(build(ce));
    } else {
      host.onMove(build(e));
    }
  };

  const finish = (e: PointerEvent) => {
    if (activeId === null || e.pointerId !== activeId) return;
    activeId = null;
    try {
      el.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    host.onUp(build(e));
  };

  const onDblClick = (e: MouseEvent) => {
    if (!host.onDoubleClick) return;
    const p = host.toScene(e.clientX, e.clientY);
    host.onDoubleClick({
      x: p.x, y: p.y, startX: p.x, startY: p.y,
      clientX: e.clientX, clientY: e.clientY,
      pressure: 0.5,
      shiftKey: e.shiftKey, altKey: e.altKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey,
      secondary: false,
      pointerId: -1,
      native: e as unknown as PointerEvent,
    });
  };

  const onWheel = (e: WheelEvent) => host.onWheel?.(e);
  const onContextMenu = (e: MouseEvent) => e.preventDefault();

  el.addEventListener('pointerdown', onPointerDown as EventListener);
  el.addEventListener('pointermove', onPointerMove as EventListener);
  el.addEventListener('pointerup', finish as EventListener);
  el.addEventListener('pointercancel', finish as EventListener);
  el.addEventListener('dblclick', onDblClick as EventListener);
  el.addEventListener('wheel', onWheel as EventListener, { passive: false });
  el.addEventListener('contextmenu', onContextMenu as EventListener);

  return () => {
    el.removeEventListener('pointerdown', onPointerDown as EventListener);
    el.removeEventListener('pointermove', onPointerMove as EventListener);
    el.removeEventListener('pointerup', finish as EventListener);
    el.removeEventListener('pointercancel', finish as EventListener);
    el.removeEventListener('dblclick', onDblClick as EventListener);
    el.removeEventListener('wheel', onWheel as EventListener);
    el.removeEventListener('contextmenu', onContextMenu as EventListener);
  };
}
