import type { Point, Rings, Ring } from './types.js';
import { round } from './geom.js';

/* ------------------------------------------------------------------ *
 * Path data tokenizer
 * ------------------------------------------------------------------ */

export interface PathCommand {
  /** Command letter, preserving case (upper = absolute). */
  cmd: string;
  values: number[];
}

const ARG_COUNT: Record<string, number> = {
  m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0,
};

/** Splits path data into commands, expanding implicit repeats (`M x y x y`). */
export function parsePathData(d: string): PathCommand[] {
  const out: PathCommand[] = [];
  let i = 0;
  const len = d.length;
  let cmd = '';

  const skipSep = () => {
    while (i < len && (d[i] === ' ' || d[i] === ',' || d[i] === '\n' || d[i] === '\r' || d[i] === '\t')) i++;
  };
  const readNumber = (): number => {
    skipSep();
    const start = i;
    if (d[i] === '+' || d[i] === '-') i++;
    while (i < len && d[i] >= '0' && d[i] <= '9') i++;
    if (d[i] === '.') {
      i++;
      while (i < len && d[i] >= '0' && d[i] <= '9') i++;
    }
    if (d[i] === 'e' || d[i] === 'E') {
      i++;
      if (d[i] === '+' || d[i] === '-') i++;
      while (i < len && d[i] >= '0' && d[i] <= '9') i++;
    }
    return start === i ? NaN : parseFloat(d.slice(start, i));
  };
  // Arc flags may be written without separators: `a1 1 0 011 1`.
  const readFlag = (): number => {
    skipSep();
    const c = d[i];
    if (c === '0' || c === '1') {
      i++;
      return c === '0' ? 0 : 1;
    }
    return readNumber();
  };

  while (i < len) {
    skipSep();
    if (i >= len) break;
    const c = d[i];
    if (/[a-zA-Z]/.test(c)) {
      cmd = c;
      i++;
    } else if (!cmd) {
      break;
    } else if (cmd === 'M') {
      cmd = 'L';
    } else if (cmd === 'm') {
      cmd = 'l';
    }
    const key = cmd.toLowerCase();
    const argc = ARG_COUNT[key];
    if (argc === undefined) break;
    if (argc === 0) {
      out.push({ cmd, values: [] });
      continue;
    }
    const values: number[] = [];
    for (let k = 0; k < argc; k++) {
      const v = key === 'a' && (k === 3 || k === 4) ? readFlag() : readNumber();
      if (Number.isNaN(v)) return out;
      values.push(v);
    }
    out.push({ cmd, values });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Absolute cubic representation (what the reshape tool edits)
 * ------------------------------------------------------------------ */

/** A path anchor with its two bezier handles, stored relative to the anchor. */
export interface CubicNode {
  x: number;
  y: number;
  /** Incoming handle offset (control point of the segment that ends here). */
  inDX: number;
  inDY: number;
  /** Outgoing handle offset (control point of the segment that starts here). */
  outDX: number;
  outDY: number;
}

export interface CubicSubPath {
  nodes: CubicNode[];
  closed: boolean;
}

export const newNode = (x: number, y: number): CubicNode => ({ x, y, inDX: 0, inDY: 0, outDX: 0, outDY: 0 });

/** Converts arbitrary path data into absolute cubic sub-paths. */
export function pathDataToCubics(d: string): CubicSubPath[] {
  const cmds = parsePathData(d);
  const subs: CubicSubPath[] = [];
  let cur: CubicSubPath | null = null;
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  let prevCubicCtrl: Point | null = null;
  let prevQuadCtrl: Point | null = null;

  const push = (node: CubicNode) => {
    if (!cur) {
      cur = { nodes: [], closed: false };
      subs.push(cur);
    }
    cur.nodes.push(node);
  };
  const last = (): CubicNode | null => (cur && cur.nodes.length ? cur.nodes[cur.nodes.length - 1] : null);
  const curveTo = (c1x: number, c1y: number, c2x: number, c2y: number, ex: number, ey: number) => {
    const from = last();
    if (from) {
      from.outDX = c1x - from.x;
      from.outDY = c1y - from.y;
    }
    const node = newNode(ex, ey);
    node.inDX = c2x - ex;
    node.inDY = c2y - ey;
    push(node);
  };

  for (const { cmd, values: v } of cmds) {
    const abs = cmd === cmd.toUpperCase();
    const key = cmd.toLowerCase();
    const rx = abs ? 0 : x;
    const ry = abs ? 0 : y;
    switch (key) {
      case 'm': {
        x = rx + v[0];
        y = ry + v[1];
        startX = x;
        startY = y;
        cur = { nodes: [], closed: false };
        subs.push(cur);
        push(newNode(x, y));
        prevCubicCtrl = prevQuadCtrl = null;
        break;
      }
      case 'l': {
        x = rx + v[0];
        y = ry + v[1];
        push(newNode(x, y));
        prevCubicCtrl = prevQuadCtrl = null;
        break;
      }
      case 'h': {
        x = rx + v[0];
        push(newNode(x, y));
        prevCubicCtrl = prevQuadCtrl = null;
        break;
      }
      case 'v': {
        y = ry + v[0];
        push(newNode(x, y));
        prevCubicCtrl = prevQuadCtrl = null;
        break;
      }
      case 'c': {
        const c1 = { x: rx + v[0], y: ry + v[1] };
        const c2 = { x: rx + v[2], y: ry + v[3] };
        x = rx + v[4];
        y = ry + v[5];
        curveTo(c1.x, c1.y, c2.x, c2.y, x, y);
        prevCubicCtrl = c2;
        prevQuadCtrl = null;
        break;
      }
      case 's': {
        const c1: Point = prevCubicCtrl ? { x: 2 * x - prevCubicCtrl.x, y: 2 * y - prevCubicCtrl.y } : { x, y };
        const c2 = { x: rx + v[0], y: ry + v[1] };
        x = rx + v[2];
        y = ry + v[3];
        curveTo(c1.x, c1.y, c2.x, c2.y, x, y);
        prevCubicCtrl = c2;
        prevQuadCtrl = null;
        break;
      }
      case 'q': {
        const q = { x: rx + v[0], y: ry + v[1] };
        const ex = rx + v[2];
        const ey = ry + v[3];
        curveTo(x + (2 / 3) * (q.x - x), y + (2 / 3) * (q.y - y), ex + (2 / 3) * (q.x - ex), ey + (2 / 3) * (q.y - ey), ex, ey);
        prevQuadCtrl = q;
        prevCubicCtrl = null;
        x = ex;
        y = ey;
        break;
      }
      case 't': {
        const q: Point = prevQuadCtrl ? { x: 2 * x - prevQuadCtrl.x, y: 2 * y - prevQuadCtrl.y } : { x, y };
        const ex = rx + v[0];
        const ey = ry + v[1];
        curveTo(x + (2 / 3) * (q.x - x), y + (2 / 3) * (q.y - y), ex + (2 / 3) * (q.x - ex), ey + (2 / 3) * (q.y - ey), ex, ey);
        prevQuadCtrl = q;
        prevCubicCtrl = null;
        x = ex;
        y = ey;
        break;
      }
      case 'a': {
        const ex = rx + v[5];
        const ey = ry + v[6];
        for (const seg of arcToCubics(x, y, v[0], v[1], v[2], v[3], v[4], ex, ey)) {
          curveTo(seg[0], seg[1], seg[2], seg[3], seg[4], seg[5]);
        }
        x = ex;
        y = ey;
        prevCubicCtrl = prevQuadCtrl = null;
        break;
      }
      case 'z': {
        if (cur) {
          const c = cur as CubicSubPath;
          c.closed = true;
          // A `Z` that lands on the start point should not leave a duplicate node.
          const n = c.nodes;
          if (n.length > 1) {
            const first = n[0];
            const tail = n[n.length - 1];
            if (Math.abs(first.x - tail.x) < 1e-6 && Math.abs(first.y - tail.y) < 1e-6) {
              first.inDX = tail.inDX;
              first.inDY = tail.inDY;
              n.pop();
            }
          }
        }
        x = startX;
        y = startY;
        cur = null;
        prevCubicCtrl = prevQuadCtrl = null;
        break;
      }
    }
  }
  return subs.filter((s) => s.nodes.length > 0);
}

/** Serialises cubic sub-paths back into path data. */
export function cubicsToPathData(subs: CubicSubPath[], digits = 3): string {
  const n = (v: number) => round(v, digits);
  const out: string[] = [];
  for (const sub of subs) {
    const nodes = sub.nodes;
    if (!nodes.length) continue;
    out.push(`M ${n(nodes[0].x)} ${n(nodes[0].y)}`);
    const limit = sub.closed ? nodes.length : nodes.length - 1;
    for (let i = 0; i < limit; i++) {
      const a = nodes[i];
      const b = nodes[(i + 1) % nodes.length];
      const straight =
        a.outDX === 0 && a.outDY === 0 && b.inDX === 0 && b.inDY === 0;
      if (straight) {
        out.push(`L ${n(b.x)} ${n(b.y)}`);
      } else {
        out.push(
          `C ${n(a.x + a.outDX)} ${n(a.y + a.outDY)} ${n(b.x + b.inDX)} ${n(b.y + b.inDY)} ${n(b.x)} ${n(b.y)}`,
        );
      }
    }
    if (sub.closed) out.push('Z');
  }
  return out.join(' ');
}

/** Endpoint-parameterised arc to a list of cubic segments `[c1x,c1y,c2x,c2y,x,y]`. */
export function arcToCubics(
  x1: number, y1: number, rx: number, ry: number,
  rotationDeg: number, largeArc: number, sweep: number,
  x2: number, y2: number,
): number[][] {
  if (!rx || !ry) return [[x1, y1, x2, y2, x2, y2]];
  const phi = (rotationDeg * Math.PI) / 180;
  const cosP = Math.cos(phi);
  const sinP = Math.sin(phi);
  const dx2 = (x1 - x2) / 2;
  const dy2 = (y1 - y2) / 2;
  const x1p = cosP * dx2 + sinP * dy2;
  const y1p = -sinP * dx2 + cosP * dy2;
  let rxa = Math.abs(rx);
  let rya = Math.abs(ry);
  const lambda = (x1p * x1p) / (rxa * rxa) + (y1p * y1p) / (rya * rya);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rxa *= s;
    rya *= s;
  }
  const sign = largeArc === sweep ? -1 : 1;
  const num = rxa * rxa * rya * rya - rxa * rxa * y1p * y1p - rya * rya * x1p * x1p;
  const den = rxa * rxa * y1p * y1p + rya * rya * x1p * x1p;
  const co = sign * Math.sqrt(Math.max(0, num / den));
  const cxp = (co * rxa * y1p) / rya;
  const cyp = (-co * rya * x1p) / rxa;
  const cx = cosP * cxp - sinP * cyp + (x1 + x2) / 2;
  const cy = sinP * cxp + cosP * cyp + (y1 + y2) / 2;

  const angle = (ux: number, uy: number, vx: number, vy: number) => {
    const dot = ux * vx + uy * vy;
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    let a = Math.acos(Math.max(-1, Math.min(1, dot / (len || 1))));
    if (ux * vy - uy * vx < 0) a = -a;
    return a;
  };
  const theta1 = angle(1, 0, (x1p - cxp) / rxa, (y1p - cyp) / rya);
  let delta = angle((x1p - cxp) / rxa, (y1p - cyp) / rya, (-x1p - cxp) / rxa, (-y1p - cyp) / rya);
  if (!sweep && delta > 0) delta -= Math.PI * 2;
  else if (sweep && delta < 0) delta += Math.PI * 2;

  const segs = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2)));
  const step = delta / segs;
  const k = (4 / 3) * Math.tan(step / 4);
  const out: number[][] = [];
  let th = theta1;
  let px = x1;
  let py = y1;
  for (let i = 0; i < segs; i++) {
    const th2 = th + step;
    const p2x = cx + rxa * Math.cos(th2) * cosP - rya * Math.sin(th2) * sinP;
    const p2y = cy + rxa * Math.cos(th2) * sinP + rya * Math.sin(th2) * cosP;
    const d1x = -rxa * Math.sin(th) * cosP - rya * Math.cos(th) * sinP;
    const d1y = -rxa * Math.sin(th) * sinP + rya * Math.cos(th) * cosP;
    const d2x = -rxa * Math.sin(th2) * cosP - rya * Math.cos(th2) * sinP;
    const d2y = -rxa * Math.sin(th2) * sinP + rya * Math.cos(th2) * cosP;
    out.push([px + k * d1x, py + k * d1y, p2x - k * d2x, p2y - k * d2y, p2x, p2y]);
    th = th2;
    px = p2x;
    py = p2y;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Flattening
 * ------------------------------------------------------------------ */

function flattenCubicSub(sub: CubicSubPath, tolerance: number): Ring {
  const pts: Ring = [];
  const nodes = sub.nodes;
  if (!nodes.length) return pts;
  pts.push({ x: nodes[0].x, y: nodes[0].y });
  const limit = sub.closed ? nodes.length : nodes.length - 1;
  for (let i = 0; i < limit; i++) {
    const a = nodes[i];
    const b = nodes[(i + 1) % nodes.length];
    if (a.outDX === 0 && a.outDY === 0 && b.inDX === 0 && b.inDY === 0) {
      pts.push({ x: b.x, y: b.y });
      continue;
    }
    const c1 = { x: a.x + a.outDX, y: a.y + a.outDY };
    const c2 = { x: b.x + b.inDX, y: b.y + b.inDY };
    // Segment count from the control polygon length; cheap and stable.
    const poly =
      Math.hypot(c1.x - a.x, c1.y - a.y) + Math.hypot(c2.x - c1.x, c2.y - c1.y) + Math.hypot(b.x - c2.x, b.y - c2.y);
    const steps = Math.max(2, Math.min(96, Math.ceil(poly / Math.max(0.05, tolerance))));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const mt = 1 - t;
      pts.push({
        x: mt * mt * mt * a.x + 3 * mt * mt * t * c1.x + 3 * mt * t * t * c2.x + t * t * t * b.x,
        y: mt * mt * mt * a.y + 3 * mt * mt * t * c1.y + 3 * mt * t * t * c2.y + t * t * t * b.y,
      });
    }
  }
  return pts;
}

/**
 * Flattens path data into polygons. Every sub-path becomes one ring, so holes
 * survive and clipper can apply the right fill rule.
 */
export function flattenPathData(d: string, tolerance = 0.6): Rings {
  return pathDataToCubics(d)
    .map((sub) => dedupe(flattenCubicSub(sub, tolerance)))
    .filter((r) => r.length > 1);
}

function dedupe(ring: Ring): Ring {
  const out: Ring = [];
  for (const p of ring) {
    const prev = out[out.length - 1];
    if (!prev || Math.abs(prev.x - p.x) > 1e-4 || Math.abs(prev.y - p.y) > 1e-4) out.push(p);
  }
  if (out.length > 2) {
    const a = out[0];
    const b = out[out.length - 1];
    if (Math.abs(a.x - b.x) < 1e-4 && Math.abs(a.y - b.y) < 1e-4) out.pop();
  }
  return out;
}

/** Path data for a rectangle, with optional (uniform) corner radius. */
export function rectPathData(x: number, y: number, w: number, h: number, r = 0): string {
  const rad = Math.min(r, w / 2, h / 2);
  if (rad <= 0) return `M ${x} ${y} L ${x + w} ${y} L ${x + w} ${y + h} L ${x} ${y + h} Z`;
  const k = rad * 0.5522847498307936;
  return [
    `M ${x + rad} ${y}`,
    `L ${x + w - rad} ${y}`,
    `C ${x + w - rad + k} ${y} ${x + w} ${y + rad - k} ${x + w} ${y + rad}`,
    `L ${x + w} ${y + h - rad}`,
    `C ${x + w} ${y + h - rad + k} ${x + w - rad + k} ${y + h} ${x + w - rad} ${y + h}`,
    `L ${x + rad} ${y + h}`,
    `C ${x + rad - k} ${y + h} ${x} ${y + h - rad + k} ${x} ${y + h - rad}`,
    `L ${x} ${y + rad}`,
    `C ${x} ${y + rad - k} ${x + rad - k} ${y} ${x + rad} ${y}`,
    'Z',
  ].join(' ');
}

/** Path data for an ellipse built from four cubic quadrants. */
export function ellipsePathData(cx: number, cy: number, rx: number, ry: number): string {
  const kx = rx * 0.5522847498307936;
  const ky = ry * 0.5522847498307936;
  return [
    `M ${cx - rx} ${cy}`,
    `C ${cx - rx} ${cy - ky} ${cx - kx} ${cy - ry} ${cx} ${cy - ry}`,
    `C ${cx + kx} ${cy - ry} ${cx + rx} ${cy - ky} ${cx + rx} ${cy}`,
    `C ${cx + rx} ${cy + ky} ${cx + kx} ${cy + ry} ${cx} ${cy + ry}`,
    `C ${cx - kx} ${cy + ry} ${cx - rx} ${cy + ky} ${cx - rx} ${cy}`,
    'Z',
  ].join(' ');
}

/** Converts any basic SVG shape element into equivalent path data. */
export function shapeToPathData(el: SVGElement): string | null {
  const num = (name: string, fallback = 0) => {
    const v = parseFloat(el.getAttribute(name) ?? '');
    return Number.isFinite(v) ? v : fallback;
  };
  switch (el.tagName.toLowerCase()) {
    case 'path':
      return el.getAttribute('d') ?? '';
    case 'rect': {
      const rx = el.hasAttribute('rx') ? num('rx') : num('ry');
      return rectPathData(num('x'), num('y'), num('width'), num('height'), rx);
    }
    case 'circle':
      return ellipsePathData(num('cx'), num('cy'), num('r'), num('r'));
    case 'ellipse':
      return ellipsePathData(num('cx'), num('cy'), num('rx'), num('ry'));
    case 'line':
      return `M ${num('x1')} ${num('y1')} L ${num('x2')} ${num('y2')}`;
    case 'polyline':
    case 'polygon': {
      const pts = (el.getAttribute('points') ?? '').trim().split(/[\s,]+/).map(Number);
      if (pts.length < 4) return null;
      let d = `M ${pts[0]} ${pts[1]}`;
      for (let i = 2; i + 1 < pts.length; i += 2) d += ` L ${pts[i]} ${pts[i + 1]}`;
      return el.tagName.toLowerCase() === 'polygon' ? `${d} Z` : d;
    }
    default:
      return null;
  }
}

/** True when the path data has no `Z` and therefore renders as an open line. */
export function isOpenPathData(d: string): boolean {
  return !/[zZ]/.test(d);
}
