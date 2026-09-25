import type { Rings, Ring } from '../core/types.js';
import { simplifyRings } from '../core/clipper.js';
import type { RGBA } from '../core/color.js';
import { rgbaToCss } from '../core/color.js';

/**
 * Crack-following contour tracer.
 *
 * Walks the boundary between set and unset cells of a bitmask keeping the
 * filled side on the left, so outer contours and holes both come out as closed
 * rings (in pixel-corner coordinates). Rings are meant to be rendered with
 * `fill-rule: evenodd`, which makes holes work without orientation bookkeeping.
 */
export function traceMask(mask: Uint8Array | Uint8ClampedArray, w: number, h: number, epsilon = 0.8): Rings {
  const at = (x: number, y: number): number => (x < 0 || y < 0 || x >= w || y >= h ? 0 : mask[y * w + x]);
  // One visited flag per horizontal crack, which is all we need to avoid
  // re-tracing a contour we already emitted.
  const seen = new Uint8Array((w + 1) * (h + 1));
  const hKey = (x: number, y: number) => y * (w + 1) + x;
  const rings: Rings = [];
  const maxSteps = (w + 1) * (h + 1) * 4 + 16;

  for (let y = 0; y <= h; y++) {
    for (let x = 0; x < w; x++) {
      const above = at(x, y - 1);
      const below = at(x, y);
      if (above === below) continue;
      if (seen[hKey(x, y)]) continue;

      // Start on this crack, oriented so the filled pixel sits on side A.
      let px = below ? x : x + 1;
      let py = y;
      let dx = below ? 1 : -1;
      let dy = 0;
      const startX = px;
      const startY = py;
      const startDX = dx;
      const ring: Ring = [];
      let steps = 0;

      do {
        if (dy === 0) seen[hKey(dx > 0 ? px : px - 1, py)] = 1;
        ring.push({ x: px, y: py });
        px += dx;
        py += dy;

        // Side A is the 90 degree rotation of the heading; side B its mirror.
        const rx = -dy;
        const ry = dx;
        const quad = (qx: number, qy: number) => at(px + (qx > 0 ? 0 : -1), py + (qy > 0 ? 0 : -1));
        const aheadA = quad(dx + rx, dy + ry);
        const aheadB = quad(dx - rx, dy - ry);
        if (!aheadA) {
          // Outer corner: swing towards the filled side.
          dx = rx;
          dy = ry;
        } else if (aheadB) {
          // Inner corner: swing away so the filled side stays on the left.
          dx = -rx;
          dy = -ry;
        }
        if (++steps > maxSteps) break;
      } while (!(px === startX && py === startY && dx === startDX && dy === 0));

      if (ring.length > 2) rings.push(ring);
    }
  }

  const collapsed = rings.map(collapseCollinear).filter((r) => r.length > 2);
  return epsilon > 0 ? simplifyRings(collapsed, epsilon, true).filter((r) => r.length > 2) : collapsed;
}

function collapseCollinear(ring: Ring): Ring {
  const out: Ring = [];
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const prev = ring[(i - 1 + n) % n];
    const cur = ring[i];
    const next = ring[(i + 1) % n];
    const cross = (cur.x - prev.x) * (next.y - cur.y) - (cur.y - prev.y) * (next.x - cur.x);
    if (cross !== 0) out.push(cur);
  }
  return out.length > 2 ? out : ring;
}

export interface ColorLayer {
  color: RGBA;
  css: string;
  mask: Uint8Array;
  count: number;
}

export interface QuantizeOptions {
  /** Maximum number of colour layers produced (default 24). */
  maxColors?: number;
  /** Bits kept per channel while bucketing, 1..8 (default 4). Lower merges more. */
  bits?: number;
  /** Pixels with alpha below this are treated as empty. */
  alphaThreshold?: number;
  /** Layers smaller than this many pixels merge into the closest colour (default 32). */
  minArea?: number;
}

/** Groups an ImageData into a handful of flat colour layers. */
export function quantize(image: ImageData, options: QuantizeOptions = {}): ColorLayer[] {
  const { maxColors = 24, bits = 4, alphaThreshold = 128, minArea = 32 } = options;
  const shift = Math.max(0, 8 - Math.max(1, Math.min(8, bits)));
  const data = image.data;
  const total = image.width * image.height;

  interface Bucket { r: number; g: number; b: number; a: number; n: number }
  const buckets = new Map<number, Bucket>();
  const keyOf = new Int32Array(total).fill(-1);

  for (let i = 0; i < total; i++) {
    const a = data[i * 4 + 3];
    if (a < alphaThreshold) continue;
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    const key = ((r >> shift) << 16) | ((g >> shift) << 8) | (b >> shift);
    keyOf[i] = key;
    let bucket = buckets.get(key);
    if (!bucket) buckets.set(key, (bucket = { r: 0, g: 0, b: 0, a: 0, n: 0 }));
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    bucket.a += a;
    bucket.n++;
  }

  const ranked = [...buckets.entries()]
    .filter(([, b]) => b.n >= minArea)
    .sort((a, b) => b[1].n - a[1].n)
    .slice(0, maxColors);
  if (!ranked.length) return [];

  const palette = ranked.map(([key, b]) => ({
    key,
    color: { r: b.r / b.n, g: b.g / b.n, b: b.b / b.n, a: Math.min(1, b.a / b.n / 255) } as RGBA,
  }));
  const index = new Map<number, number>();
  palette.forEach((p, i) => index.set(p.key, i));

  // Anything that did not make the cut joins its nearest surviving colour.
  const nearest = (r: number, g: number, b: number): number => {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < palette.length; i++) {
      const c = palette[i].color;
      const d = (c.r - r) ** 2 + (c.g - g) ** 2 + (c.b - b) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  };
  const fallback = new Map<number, number>();

  const layers: ColorLayer[] = palette.map((p) => ({
    color: p.color,
    css: rgbaToCss({ r: Math.round(p.color.r), g: Math.round(p.color.g), b: Math.round(p.color.b), a: p.color.a }),
    mask: new Uint8Array(total),
    count: 0,
  }));

  for (let i = 0; i < total; i++) {
    const key = keyOf[i];
    if (key < 0) continue;
    let li = index.get(key);
    if (li === undefined) {
      li = fallback.get(key);
      if (li === undefined) {
        li = nearest(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
        fallback.set(key, li);
      }
    }
    layers[li].mask[i] = 1;
    layers[li].count++;
  }

  return layers.filter((l) => l.count > 0);
}

export interface TraceOptions extends QuantizeOptions {
  /** Contour simplification tolerance in pixels. */
  epsilon?: number;
}

export interface TracedLayer {
  css: string;
  color: RGBA;
  rings: Rings;
}

/** Quantises then traces an ImageData into flat colour outlines. */
export function traceImageData(image: ImageData, options: TraceOptions = {}): TracedLayer[] {
  const { epsilon = 0.8 } = options;
  const out: TracedLayer[] = [];
  for (const layer of quantize(image, options)) {
    const rings = traceMask(layer.mask, image.width, image.height, epsilon);
    if (rings.length) out.push({ css: layer.css, color: layer.color, rings });
  }
  return out;
}
