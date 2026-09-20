/**
 * @fileoverview 선분 하나를 사각형 네 점으로 펴는 계산입니다.
 *
 * PIXI 를 쓰지 않으므로 화면 없이도 확인할 수 있습니다. `segments.ts` 가 이 결과를
 * 그대로 메시 버퍼에 담습니다.
 */
import type { Stroke } from '../runtime/model.ts';

/** Whether one stroke is a plain line from one point to one other. */
export function isSegment(piece: Stroke): boolean {
  return !piece.fill && piece.points.length === 4;
}

/**
 * Writes `pieces[from…to)` into `positions` as four corners each, and answers
 * how many were written. The stage counts y upwards and PIXI downwards, so the
 * corners come out flipped, the way the path the mesh replaces is drawn.
 *
 * Ends are square and there are no corners to join, which is what a two-point
 * stroke with entry's own pen settings draws.
 */
export function writeQuads(
  pieces: Stroke[],
  from: number,
  to: number,
  thickness: number,
  positions: Float32Array,
): number {
  const half = thickness / 2;
  let count = 0;
  for (let at = from; at < to; at += 1) {
    const points = pieces[at]!.points;
    if (points.length < 4) {
      continue;
    }
    const x0 = points[0]!;
    const y0 = -points[1]!;
    const x1 = points[2]!;
    const y1 = -points[3]!;
    const dx = x1 - x0;
    const dy = y1 - y0;
    // A segment of no length has no direction to stand across; it draws nothing.
    const length = Math.sqrt(dx * dx + dy * dy) || 1;
    const nx = (-dy / length) * half;
    const ny = (dx / length) * half;
    const out = count * 8;
    positions[out] = x0 + nx;
    positions[out + 1] = y0 + ny;
    positions[out + 2] = x1 + nx;
    positions[out + 3] = y1 + ny;
    positions[out + 4] = x1 - nx;
    positions[out + 5] = y1 - ny;
    positions[out + 6] = x0 - nx;
    positions[out + 7] = y0 - ny;
    count += 1;
  }
  return count;
}

/** Two triangles per segment, in the order `writeQuads` lays the corners down. */
export function quadIndices(room: number): Uint32Array {
  const indices = new Uint32Array(room * 6);
  for (let at = 0; at < room; at += 1) {
    const corner = at * 4;
    const out = at * 6;
    indices[out] = corner;
    indices[out + 1] = corner + 1;
    indices[out + 2] = corner + 2;
    indices[out + 3] = corner;
    indices[out + 4] = corner + 2;
    indices[out + 5] = corner + 3;
  }
  return indices;
}
