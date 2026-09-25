import type { Point, Rect } from '../core/types.js';
import type { Matrix } from '../core/geom.js';
import { matApply, matInvert, matRotate, matScale, matTranslate, matMultiply, unionRects } from '../core/geom.js';
import { paintBoundsIn } from './scene.js';

export type HandleKind = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'rotate';

export interface HandleHit {
  kind: HandleKind;
  /** Scene-space point that stays put while dragging this handle. */
  anchor: Point;
}

const CORNERS: HandleKind[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export const HANDLE_CURSORS: Record<HandleKind, string> = {
  nw: 'nwse-resize',
  n: 'ns-resize',
  ne: 'nesw-resize',
  e: 'ew-resize',
  se: 'nwse-resize',
  s: 'ns-resize',
  sw: 'nesw-resize',
  w: 'ew-resize',
  rotate: 'grab',
};

/** Point of `kind` on `rect`, in scene coordinates. */
export function handlePoint(rect: Rect, kind: HandleKind, rotateOffset = 24): Point {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  switch (kind) {
    case 'nw': return { x: rect.x, y: rect.y };
    case 'n': return { x: cx, y: rect.y };
    case 'ne': return { x: rect.x + rect.width, y: rect.y };
    case 'e': return { x: rect.x + rect.width, y: cy };
    case 'se': return { x: rect.x + rect.width, y: rect.y + rect.height };
    case 's': return { x: cx, y: rect.y + rect.height };
    case 'sw': return { x: rect.x, y: rect.y + rect.height };
    case 'w': return { x: rect.x, y: cy };
    case 'rotate': return { x: cx, y: rect.y - rotateOffset };
  }
}

/** The handle diagonally opposite `kind` — the fixed point while scaling. */
export function oppositeHandle(kind: HandleKind): HandleKind {
  const map: Record<string, HandleKind> = {
    nw: 'se', n: 's', ne: 'sw', e: 'w', se: 'nw', s: 'n', sw: 'ne', w: 'e',
  };
  return map[kind] ?? 'nw';
}

/** Union of the painted bounds of `nodes`, in `reference` coordinates. */
export function selectionBounds(nodes: SVGGraphicsElement[], reference: SVGGraphicsElement): Rect | null {
  let rect: Rect | null = null;
  for (const node of nodes) {
    try {
      rect = unionRects(rect, paintBoundsIn(node, reference));
    } catch {
      /* detached nodes have no box */
    }
  }
  return rect;
}

/**
 * Builds the matrix produced by dragging `kind` from `from` to `to`.
 * `square` keeps the aspect ratio, `fromCenter` scales around the middle.
 */
export function scaleMatrixFor(
  rect: Rect,
  kind: HandleKind,
  to: Point,
  square: boolean,
  fromCenter: boolean,
): Matrix {
  const anchor = fromCenter
    ? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
    : handlePoint(rect, oppositeHandle(kind));
  const start = handlePoint(rect, kind);
  const spanX = start.x - anchor.x;
  const spanY = start.y - anchor.y;
  const horizontal = kind !== 'n' && kind !== 's';
  const vertical = kind !== 'e' && kind !== 'w';

  let sx = horizontal && Math.abs(spanX) > 1e-6 ? (to.x - anchor.x) / spanX : 1;
  let sy = vertical && Math.abs(spanY) > 1e-6 ? (to.y - anchor.y) / spanY : 1;
  if (square && horizontal && vertical) {
    const s = Math.max(Math.abs(sx), Math.abs(sy));
    sx = Math.sign(sx || 1) * s;
    sy = Math.sign(sy || 1) * s;
  } else if (square) {
    if (horizontal) sy = Math.sign(sy || 1) * Math.abs(sx);
    else sx = Math.sign(sx || 1) * Math.abs(sy);
  }
  // Never collapse to zero: a degenerate matrix is unrecoverable.
  if (Math.abs(sx) < 1e-4) sx = Math.sign(sx || 1) * 1e-4;
  if (Math.abs(sy) < 1e-4) sy = Math.sign(sy || 1) * 1e-4;
  return matScale(sx, sy, anchor.x, anchor.y);
}

export function rotateMatrixFor(rect: Rect, from: Point, to: Point, snap: boolean): Matrix {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const a0 = Math.atan2(from.y - cy, from.x - cx);
  const a1 = Math.atan2(to.y - cy, to.x - cx);
  let delta = a1 - a0;
  if (snap) delta = Math.round(delta / (Math.PI / 12)) * (Math.PI / 12);
  return matRotate(delta, cx, cy);
}

export function translateMatrix(dx: number, dy: number): Matrix {
  return matTranslate(dx, dy);
}

/** Composes a scene-space matrix onto an item's existing transform. */
export function composeOnto(existing: Matrix, sceneDelta: Matrix): Matrix {
  return matMultiply(sceneDelta, existing);
}

/** Maps a scene-space vector into an item's local space (linear part only). */
export function toLocalVector(itemMatrix: Matrix, v: Point): Point {
  const inv = matInvert(itemMatrix);
  const origin = matApply(inv, { x: 0, y: 0 });
  const moved = matApply(inv, v);
  return { x: moved.x - origin.x, y: moved.y - origin.y };
}

export { CORNERS as HANDLE_KINDS };
