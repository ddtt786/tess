import type { Point, Rect, Ring, Rings } from './types.js';

export const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

export const dist = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const EMPTY_RECT: Rect = { x: 0, y: 0, width: 0, height: 0 };

/** Axis aligned rectangle spanned by two corners. */
export function rectFromCorners(a: Point, b: Point): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

/**
 * Rectangle for a drag gesture honouring the usual modifiers:
 * `square` (shift) locks the aspect ratio, `fromCenter` (alt) grows around
 * the anchor instead of away from it.
 */
export function dragRect(anchor: Point, cursor: Point, square: boolean, fromCenter: boolean): Rect {
  let dx = cursor.x - anchor.x;
  let dy = cursor.y - anchor.y;
  if (square) {
    const m = Math.max(Math.abs(dx), Math.abs(dy));
    dx = Math.sign(dx || 1) * m;
    dy = Math.sign(dy || 1) * m;
  }
  if (fromCenter) {
    return { x: anchor.x - Math.abs(dx), y: anchor.y - Math.abs(dy), width: Math.abs(dx) * 2, height: Math.abs(dy) * 2 };
  }
  return rectFromCorners(anchor, { x: anchor.x + dx, y: anchor.y + dy });
}

/** Snaps an angle (radians) to 15 degree steps. */
export function snapAngle(angle: number, step = Math.PI / 12): number {
  return Math.round(angle / step) * step;
}

/** Constrains `cursor` so the segment from `anchor` lies on a 15 degree ray. */
export function constrainToAngle(anchor: Point, cursor: Point): Point {
  const a = snapAngle(Math.atan2(cursor.y - anchor.y, cursor.x - anchor.x));
  const r = dist(anchor, cursor);
  return { x: anchor.x + Math.cos(a) * r, y: anchor.y + Math.sin(a) * r };
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return !(
    a.x + a.width < b.x ||
    b.x + b.width < a.x ||
    a.y + a.height < b.y ||
    b.y + b.height < a.y
  );
}

export function rectContains(a: Rect, b: Rect): boolean {
  return a.x <= b.x && a.y <= b.y && a.x + a.width >= b.x + b.width && a.y + a.height >= b.y + b.height;
}

export function pointInRect(p: Point, r: Rect, slop = 0): boolean {
  return p.x >= r.x - slop && p.x <= r.x + r.width + slop && p.y >= r.y - slop && p.y <= r.y + r.height + slop;
}

export function unionRects(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b;
  if (!b) return a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

export function inflateRect(r: Rect, by: number): Rect {
  return { x: r.x - by, y: r.y - by, width: r.width + by * 2, height: r.height + by * 2 };
}

export function ringsBounds(rings: Rings): Rect | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const ring of rings) {
    for (const p of ring) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function rectToRing(r: Rect): Ring {
  return [
    { x: r.x, y: r.y },
    { x: r.x + r.width, y: r.y },
    { x: r.x + r.width, y: r.y + r.height },
    { x: r.x, y: r.y + r.height },
  ];
}

/**
 * Affine matrix `[a b c d e f]` matching the SVG / canvas convention:
 * `x' = a·x + c·y + e`, `y' = b·x + d·y + f`.
 */
export type Matrix = [number, number, number, number, number, number];

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

export function matMultiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function matApply(m: Matrix, p: Point): Point {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

export function matInvert(m: Matrix): Matrix {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!det) return [...IDENTITY] as Matrix;
  return [
    m[3] / det,
    -m[1] / det,
    -m[2] / det,
    m[0] / det,
    (m[2] * m[5] - m[3] * m[4]) / det,
    (m[1] * m[4] - m[0] * m[5]) / det,
  ];
}

export function matTranslate(tx: number, ty: number): Matrix {
  return [1, 0, 0, 1, tx, ty];
}

export function matScale(sx: number, sy: number, ox = 0, oy = 0): Matrix {
  return [sx, 0, 0, sy, ox - sx * ox, oy - sy * oy];
}

export function matRotate(angle: number, ox = 0, oy = 0): Matrix {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [c, s, -s, c, ox - c * ox + s * oy, oy - s * ox - c * oy];
}

export function matToString(m: Matrix): string {
  return `matrix(${m.map((v) => round(v, 4)).join(' ')})`;
}

export function round(v: number, digits = 3): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

/** Ring signed area; positive means counter-clockwise in SVG's y-down space. */
export function ringArea(ring: Ring): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += (ring[j].x + ring[i].x) * (ring[j].y - ring[i].y);
  }
  return a / 2;
}

/** Even-odd point containment across a set of rings. */
export function pointInRings(p: Point, rings: Rings): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i];
      const b = ring[j];
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
        inside = !inside;
      }
    }
  }
  return inside;
}

/** Ramer-Douglas-Peucker for open polylines (clipper handles the closed case). */
export function simplifyPolyline(points: Point[], epsilon: number): Point[] {
  if (points.length < 3) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop()!;
    let maxDist = 0;
    let idx = -1;
    const a = points[first];
    const b = points[last];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    for (let i = first + 1; i < last; i++) {
      const d = Math.abs((points[i].x - a.x) * dy - (points[i].y - a.y) * dx) / len;
      if (d > maxDist) {
        maxDist = d;
        idx = i;
      }
    }
    if (idx > 0 && maxDist > epsilon) {
      keep[idx] = 1;
      stack.push([first, idx], [idx, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}
