export interface RGBA {
  r: number;
  g: number;
  b: number;
  /** 0..1 */
  a: number;
}

let probeCtx: CanvasRenderingContext2D | null = null;
const parseCache = new Map<string, RGBA>();

function getProbe(): CanvasRenderingContext2D | null {
  if (probeCtx) return probeCtx;
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  probeCtx = canvas.getContext('2d', { willReadFrequently: true });
  return probeCtx;
}

/**
 * Parses any CSS colour the browser understands (hex, rgb(), hsl(), names)
 * into premultiplication-free RGBA. Unknown colours resolve to transparent.
 */
export function parseColor(css: string | null | undefined): RGBA {
  if (!css || css === 'none' || css === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  const cached = parseCache.get(css);
  if (cached) return { ...cached };

  const direct = parseHex(css);
  if (direct) {
    parseCache.set(css, direct);
    return { ...direct };
  }

  const ctx = getProbe();
  if (!ctx) return { r: 0, g: 0, b: 0, a: 1 };
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = '#000';
  ctx.fillStyle = css;
  const resolved = ctx.fillStyle as string;
  const hex = parseHex(resolved);
  if (hex) {
    parseCache.set(css, hex);
    return { ...hex };
  }
  const m = /^rgba?\(([^)]+)\)$/.exec(resolved);
  if (m) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    const rgba: RGBA = { r: parts[0] | 0, g: parts[1] | 0, b: parts[2] | 0, a: parts.length > 3 ? parts[3] : 1 };
    parseCache.set(css, rgba);
    return { ...rgba };
  }
  return { r: 0, g: 0, b: 0, a: 1 };
}

function parseHex(css: string): RGBA | null {
  const s = css.trim();
  if (s[0] !== '#') return null;
  const hex = s.slice(1);
  const expand = (c: string) => parseInt(c + c, 16);
  if (hex.length === 3 || hex.length === 4) {
    return {
      r: expand(hex[0]),
      g: expand(hex[1]),
      b: expand(hex[2]),
      a: hex.length === 4 ? expand(hex[3]) / 255 : 1,
    };
  }
  if (hex.length === 6 || hex.length === 8) {
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
      a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
    };
  }
  return null;
}

export function rgbaToCss({ r, g, b, a }: RGBA): string {
  return a >= 1 ? rgbToHex(r, g, b) : `rgba(${r | 0}, ${g | 0}, ${b | 0}, ${Number(a.toFixed(3))})`;
}

export function rgbToHex(r: number, g: number, b: number): string {
  const h = (v: number) => clamp255(v).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

const clamp255 = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

/**
 * Perceptual-ish distance in 0..1 used by the bitmap bucket fill tolerance.
 * Alpha differences count fully so filling into transparency behaves.
 */
export function colorDistance(a: RGBA, b: RGBA): number {
  const dr = (a.r - b.r) / 255;
  const dg = (a.g - b.g) / 255;
  const db = (a.b - b.b) / 255;
  const da = a.a - b.a;
  return Math.sqrt((dr * dr * 0.299 + dg * dg * 0.587 + db * db * 0.114) * 0.75 + da * da * 0.25);
}

export function hsvToRgb(h: number, s: number, v: number): RGBA {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  const [r, g, b] = [
    [v, t, p],
    [q, v, p],
    [p, v, t],
    [p, q, v],
    [t, p, v],
    [v, p, q],
  ][i % 6];
  return { r: r * 255, g: g * 255, b: b * 255, a: 1 };
}

export function rgbToHsv({ r, g, b }: RGBA): { h: number; s: number; v: number } {
  const rd = r / 255;
  const gd = g / 255;
  const bd = b / 255;
  const max = Math.max(rd, gd, bd);
  const min = Math.min(rd, gd, bd);
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === rd) h = ((gd - bd) / d + (gd < bd ? 6 : 0)) / 6;
    else if (max === gd) h = ((bd - rd) / d + 2) / 6;
    else h = ((rd - gd) / d + 4) / 6;
  }
  return { h, s: max ? d / max : 0, v: max };
}
