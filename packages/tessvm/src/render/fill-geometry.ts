/** @fileoverview Fill path corners for `fill-batch.ts`, kept free of PIXI so it runs headless. */

/**
 * Writes a fill path's corners into `out` (y flipped unless `flip` is false), dropping
 * repeated and closing points as `Graphics.lineTo` does. Answers the corner count.
 */
export function flatPolygon(points: number[], out: number[], flip = true): number {
  out.length = 0;
  let lastX = NaN;
  let lastY = NaN;
  for (let at = 0; at + 1 < points.length; at += 2) {
    const x = points[at]!;
    const y = flip ? -points[at + 1]! : points[at + 1]!;
    if (x === lastX && y === lastY) {
      continue;
    }
    out.push(x, y);
    lastX = x;
    lastY = y;
  }
  let corners = out.length / 2;
  if (corners > 1 && out[0] === out[corners * 2 - 2] && out[1] === out[corners * 2 - 1]) {
    corners -= 1;
    out.length = corners * 2;
  }
  return corners;
}

/** Whether a fan covers what `earcut` would: a triangle, or four corners all turning one way. */
export function isFanSafe(flat: number[], corners: number): boolean {
  if (corners === 3) {
    return true;
  }
  if (corners !== 4) {
    return false;
  }
  let sign = 0;
  for (let at = 0; at < 4; at += 1) {
    const ax = flat[at * 2]!;
    const ay = flat[at * 2 + 1]!;
    const bx = flat[((at + 1) % 4) * 2]!;
    const by = flat[((at + 1) % 4) * 2 + 1]!;
    const cx = flat[((at + 2) % 4) * 2]!;
    const cy = flat[((at + 2) % 4) * 2 + 1]!;
    const cross = (bx - ax) * (cy - by) - (by - ay) * (cx - bx);
    if (cross === 0) {
      continue;
    }
    const turn = cross > 0 ? 1 : -1;
    if (sign !== 0 && turn !== sign) {
      return false;
    }
    sign = turn;
  }
  return true;
}
