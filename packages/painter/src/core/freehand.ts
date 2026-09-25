import { getStroke, getStrokePoints, getStrokeOutlinePoints } from 'perfect-freehand';
import type { StrokePoint } from 'perfect-freehand';
import type { BrushOptions, InputPoint, Point, Ring } from './types.js';
import { round } from './geom.js';

function toFreehandOptions(options: BrushOptions, done: boolean) {
  return {
    size: options.size,
    thinning: options.thinning,
    smoothing: options.smoothing,
    streamline: options.streamline,
    simulatePressure: options.simulatePressure,
    last: done,
    start: { taper: options.taperStart, cap: options.taperStart === 0 },
    end: { taper: options.taperEnd, cap: options.taperEnd === 0 },
  };
}

/**
 * Runs perfect-freehand over the raw samples and returns the closed outline of
 * the stroke. `done` should be `true` for the final (committed) stroke so the
 * end cap is drawn.
 */
export function strokeOutline(points: InputPoint[], options: BrushOptions, done = true): Ring {
  if (points.length === 0) return [];
  const input = points.map((p) => [p.x, p.y, p.pressure]);
  const outline = getStroke(input, toFreehandOptions(options, done));
  return outline.map(([x, y]) => ({ x, y }));
}

/**
 * Same as {@link strokeOutline} but stops at the smoothed centreline, which the
 * bitmap dab renderer and the "stroke to path" helper both reuse.
 */
export function strokeCenterline(points: InputPoint[], options: BrushOptions, done = true): StrokePoint[] {
  if (points.length === 0) return [];
  const input = points.map((p) => [p.x, p.y, p.pressure]);
  return getStrokePoints(input, toFreehandOptions(options, done));
}

/** Outline for an already-smoothed centreline (skips re-running the smoother). */
export function outlineFromCenterline(points: StrokePoint[], options: BrushOptions, done = true): Ring {
  if (!points.length) return [];
  const outline = getStrokeOutlinePoints(points, toFreehandOptions(options, done));
  return outline.map(([x, y]) => ({ x, y }));
}

/**
 * Turns a polygon into smooth SVG path data by running a quadratic through the
 * midpoints of consecutive vertices — the technique from the perfect-freehand
 * docs, which keeps stroke outlines from looking faceted.
 */
export function ringToSmoothPathData(ring: Ring, close = true): string {
  const len = ring.length;
  if (len === 0) return '';
  if (len < 4) {
    return `M ${fmt(ring[0])} ${ring.slice(1).map((p) => `L ${fmt(p)}`).join(' ')}${close ? ' Z' : ''}`;
  }
  const mid = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  let d = `M ${fmt(ring[0])} Q`;
  for (let i = 0; i < len; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % len];
    d += ` ${fmt(a)} ${fmt(mid(a, b))}`;
  }
  return close ? `${d} Z` : d;
}

/** Straight-segment path data (used where exactness beats smoothness). */
export function ringToPathData(ring: Ring, close = true): string {
  if (!ring.length) return '';
  let d = `M ${fmt(ring[0])}`;
  for (let i = 1; i < ring.length; i++) d += ` L ${fmt(ring[i])}`;
  return close ? `${d} Z` : d;
}

export function ringsToPathData(rings: Ring[], close = true): string {
  return rings
    .filter((r) => r.length > 1)
    .map((r) => ringToPathData(r, close))
    .join(' ');
}

const fmt = (p: Point) => `${round(p.x, 2)} ${round(p.y, 2)}`;

/**
 * Draws a freehand outline into a canvas path. Used by the bitmap brush so the
 * vector and the raster brush produce the exact same silhouette.
 */
export function ringToCanvasPath(ring: Ring, path: Path2D = new Path2D()): Path2D {
  if (ring.length < 2) return path;
  const mid = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const start = mid(ring[ring.length - 1], ring[0]);
  path.moveTo(start.x, start.y);
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const m = mid(a, b);
    path.quadraticCurveTo(a.x, a.y, m.x, m.y);
  }
  path.closePath();
  return path;
}
