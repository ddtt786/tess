import {
  FillRule,
  JoinType,
  EndType,
  unionD,
  differenceD,
  intersectD,
  xorD,
  inflatePathsD,
  simplifyPathsD,
  areaPathsD,
} from 'clipper2-ts';
import type { PathsD } from 'clipper2-ts';
import type { Ring, Rings } from './types.js';

export { FillRule, JoinType, EndType };

/** Geometry precision handed to clipper (decimal places). */
const PRECISION = 3;

const toPaths = (rings: Rings): PathsD => rings.filter((r) => r.length > 2).map((r) => r.map((p) => ({ x: p.x, y: p.y })));
const fromPaths = (paths: PathsD): Rings => paths.map((p) => p.map((pt) => ({ x: pt.x, y: pt.y })));

/** A ∪ B (or a self-union when `b` is omitted, which also fixes self-intersections). */
export function unionRings(a: Rings, b?: Rings, fillRule: FillRule = FillRule.NonZero): Rings {
  const subject = toPaths(a);
  if (!subject.length && !(b && b.length)) return [];
  if (!b || !b.length) return fromPaths(unionD(subject, fillRule));
  return fromPaths(unionD(subject, toPaths(b), fillRule, PRECISION));
}

/** A \ B — the workhorse behind the vector eraser. */
export function differenceRings(a: Rings, b: Rings, fillRule: FillRule = FillRule.NonZero): Rings {
  const subject = toPaths(a);
  if (!subject.length) return [];
  const clip = toPaths(b);
  if (!clip.length) return fromPaths(subject);
  return fromPaths(differenceD(subject, clip, fillRule, PRECISION));
}

/** A ∩ B — used by the bitmap-style rectangular crop of vector selections. */
export function intersectRings(a: Rings, b: Rings, fillRule: FillRule = FillRule.NonZero): Rings {
  const subject = toPaths(a);
  const clip = toPaths(b);
  if (!subject.length || !clip.length) return [];
  return fromPaths(intersectD(subject, clip, fillRule, PRECISION));
}

/** A ⊻ B. */
export function xorRings(a: Rings, b: Rings, fillRule: FillRule = FillRule.NonZero): Rings {
  return fromPaths(xorD(toPaths(a), toPaths(b), fillRule, PRECISION));
}

/**
 * Converts an *open* polyline into the closed region covered by stroking it.
 * This is what lets the eraser (and boolean ops in general) work on outlines,
 * dashed lines and hairline shapes.
 */
export function outlinePolyline(line: Ring, width: number, cap: EndType = EndType.Round): Rings {
  if (line.length < 2) {
    if (line.length === 1) return [circleRing(line[0].x, line[0].y, width / 2)];
    return [];
  }
  const paths: PathsD = [line.map((p) => ({ x: p.x, y: p.y }))];
  return fromPaths(inflatePathsD(paths, width / 2, JoinType.Round, cap, 2, PRECISION));
}

/** Region covered by stroking a *closed* ring set with the given width. */
export function outlineRings(rings: Rings, width: number): Rings {
  if (!rings.length || width <= 0) return [];
  const paths = toPaths(rings);
  if (!paths.length) return [];
  const outer = inflatePathsD(paths, width / 2, JoinType.Round, EndType.Polygon, 2, PRECISION);
  const inner = inflatePathsD(paths, -width / 2, JoinType.Round, EndType.Polygon, 2, PRECISION);
  if (!inner.length) return fromPaths(outer);
  return fromPaths(differenceD(outer, inner, FillRule.NonZero, PRECISION));
}

/** Grows (delta > 0) or shrinks (delta < 0) closed regions. */
export function inflateRings(rings: Rings, delta: number, join: JoinType = JoinType.Round): Rings {
  if (!rings.length || !delta) return rings;
  return fromPaths(inflatePathsD(toPaths(rings), delta, join, EndType.Polygon, 2, PRECISION));
}

/** Ramer-Douglas-Peucker style vertex reduction for closed rings. */
export function simplifyRings(rings: Rings, epsilon: number, closed = true): Rings {
  if (!rings.length || epsilon <= 0) return rings;
  return fromPaths(simplifyPathsD(toPaths(rings), epsilon, closed));
}

/** Total signed area; the sign follows the winding of the rings. */
export function ringsArea(rings: Rings): number {
  if (!rings.length) return 0;
  return areaPathsD(toPaths(rings));
}

export function circleRing(cx: number, cy: number, r: number, steps = 32): Ring {
  const out: Ring = [];
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    out.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return out;
}

/** True when the two ring sets share any area (cheap intersection probe). */
export function ringsOverlap(a: Rings, b: Rings): boolean {
  if (!a.length || !b.length) return false;
  return intersectRings(a, b).length > 0;
}
