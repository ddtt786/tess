import type { Matrix } from '../core/geom.js';
import { IDENTITY, matApply, round } from '../core/geom.js';
import type { PaintStyle, Rect, Ring, Rings } from '../core/types.js';
import { flattenPathData, pathDataToCubics, shapeToPathData } from '../core/path-data.js';
import { outlinePolyline, outlineRings, unionRings } from '../core/clipper.js';
import { traceMask } from '../convert/trace.js';

export const PID_ATTR = 'data-pid';

let pidCounter = 0;

/** Tags the painter treats as selectable, transformable items. */
const ITEM_TAGS = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'image', 'g']);

export function isItemNode(node: Node | null): node is SVGGraphicsElement {
  return !!node && node.nodeType === 1 && ITEM_TAGS.has((node as Element).tagName.toLowerCase());
}

export function ensurePid(node: SVGElement): string {
  let pid = node.getAttribute(PID_ATTR);
  if (!pid) {
    pid = `i${(++pidCounter).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    node.setAttribute(PID_ATTR, pid);
  }
  return pid;
}

export function pidOf(node: SVGElement): string | null {
  return node.getAttribute(PID_ATTR);
}

/* ------------------------------------------------------------------ *
 * Style
 * ------------------------------------------------------------------ */

const NONE = new Set(['none', '', 'transparent']);

export function readStyle(node: SVGElement): PaintStyle {
  const fill = node.getAttribute('fill');
  const stroke = node.getAttribute('stroke');
  const width = parseFloat(node.getAttribute('stroke-width') ?? '');
  return {
    fill: fill && !NONE.has(fill) ? fill : null,
    stroke: stroke && !NONE.has(stroke) ? stroke : null,
    strokeWidth: Number.isFinite(width) ? width : 0,
  };
}

export function applyStyle(node: SVGElement, style: Partial<PaintStyle>): void {
  if (node.tagName.toLowerCase() === 'g') {
    for (const child of Array.from(node.children)) applyStyle(child as SVGElement, style);
    return;
  }
  if ('fill' in style) node.setAttribute('fill', style.fill ?? 'none');
  if ('stroke' in style) node.setAttribute('stroke', style.stroke ?? 'none');
  if ('strokeWidth' in style && style.strokeWidth !== undefined) {
    node.setAttribute('stroke-width', String(round(style.strokeWidth, 3)));
    if (!node.getAttribute('stroke-linecap')) node.setAttribute('stroke-linecap', 'round');
    if (!node.getAttribute('stroke-linejoin')) node.setAttribute('stroke-linejoin', 'round');
  }
}

/* ------------------------------------------------------------------ *
 * Matrices & bounds
 * ------------------------------------------------------------------ */

export function elementMatrixTo(el: SVGGraphicsElement, reference: SVGGraphicsElement): Matrix {
  const refCtm = reference.getScreenCTM();
  const elCtm = el.getScreenCTM();
  if (!refCtm || !elCtm) return [...IDENTITY] as Matrix;
  const m = refCtm.inverse().multiply(elCtm);
  return [m.a, m.b, m.c, m.d, m.e, m.f];
}

/** Uniform scale factor of a matrix — used to scale stroke widths. */
export function matrixScale(m: Matrix): number {
  return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
}

/** Axis-aligned bounds of `el` expressed in `reference` coordinates. */
export function boundsIn(el: SVGGraphicsElement, reference: SVGGraphicsElement): Rect {
  const box = el.getBBox();
  const m = elementMatrixTo(el, reference);
  const pts = [
    matApply(m, { x: box.x, y: box.y }),
    matApply(m, { x: box.x + box.width, y: box.y }),
    matApply(m, { x: box.x + box.width, y: box.y + box.height }),
    matApply(m, { x: box.x, y: box.y + box.height }),
  ];
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** Bounds including the painted stroke, in `reference` coordinates. */
export function paintBoundsIn(el: SVGGraphicsElement, reference: SVGGraphicsElement): Rect {
  const rect = boundsIn(el, reference);
  const widths: number[] = [];
  const collect = (node: SVGElement) => {
    if (node.tagName.toLowerCase() === 'g') {
      for (const c of Array.from(node.children)) collect(c as SVGElement);
      return;
    }
    const s = readStyle(node);
    if (s.stroke) widths.push(s.strokeWidth);
  };
  collect(el);
  const grow = (widths.length ? Math.max(...widths) : 0) * matrixScale(elementMatrixTo(el, reference)) / 2;
  return { x: rect.x - grow, y: rect.y - grow, width: rect.width + grow * 2, height: rect.height + grow * 2 };
}

/* ------------------------------------------------------------------ *
 * Geometry extraction
 * ------------------------------------------------------------------ */

export interface ItemGeometry {
  /** Region painted by `fill`. */
  fill: Rings;
  /** Region painted by the outline. */
  stroke: Rings;
  /** Raw flattened contours (closed and open alike). */
  contours: Rings;
  /** True when at least one sub-path is open. */
  hasOpen: boolean;
}

const EMPTY_GEOMETRY: ItemGeometry = { fill: [], stroke: [], contours: [], hasOpen: false };

function transformRings(rings: Rings, m: Matrix): Rings {
  return rings.map((ring) => ring.map((p) => matApply(m, p)));
}

/**
 * Flattens an item into the polygons it actually paints, expressed in
 * `reference` coordinates. This is the bridge between SVG and clipper2 and it
 * powers the eraser, the bucket fill hit-test and boolean operations.
 */
export function itemGeometry(el: SVGGraphicsElement, reference: SVGGraphicsElement): ItemGeometry {
  const tag = el.tagName.toLowerCase();
  if (tag === 'g') {
    const parts = Array.from(el.children)
      .filter((c) => isItemNode(c as Node))
      .map((c) => itemGeometry(c as SVGGraphicsElement, reference));
    return {
      fill: parts.flatMap((p) => p.fill),
      stroke: parts.flatMap((p) => p.stroke),
      contours: parts.flatMap((p) => p.contours),
      hasOpen: parts.some((p) => p.hasOpen),
    };
  }
  if (tag === 'text') return textGeometry(el, reference);
  if (tag === 'image') {
    const m = elementMatrixTo(el, reference);
    const box = el.getBBox();
    const ring: Ring = [
      { x: box.x, y: box.y },
      { x: box.x + box.width, y: box.y },
      { x: box.x + box.width, y: box.y + box.height },
      { x: box.x, y: box.y + box.height },
    ].map((p) => matApply(m, p));
    return { fill: [ring], stroke: [], contours: [ring], hasOpen: false };
  }

  const d = shapeToPathData(el);
  if (!d) return EMPTY_GEOMETRY;
  const m = elementMatrixTo(el, reference);
  const scale = matrixScale(m);
  const style = readStyle(el);

  const subs = pathDataToCubics(d);
  const contours: Rings = [];
  const closedFlags: boolean[] = [];
  for (const sub of subs) {
    const rings = flattenPathData(cubicSubToData(sub));
    for (const ring of rings) {
      contours.push(ring);
      closedFlags.push(sub.closed);
    }
  }
  const sceneContours = transformRings(contours, m);

  const fill = style.fill ? sceneContours.filter((r) => r.length > 2) : [];
  let stroke: Rings = [];
  if (style.stroke && style.strokeWidth > 0) {
    const w = style.strokeWidth * scale;
    const pieces: Rings[] = [];
    sceneContours.forEach((ring, i) => {
      pieces.push(closedFlags[i] ? outlineRings([ring], w) : outlinePolyline(ring, w));
    });
    stroke = pieces.length ? unionRings(pieces.flat()) : [];
  }
  return { fill, stroke, contours: sceneContours, hasOpen: closedFlags.some((c) => !c) };
}

function cubicSubToData(sub: { nodes: Array<{ x: number; y: number; inDX: number; inDY: number; outDX: number; outDY: number }>; closed: boolean }): string {
  const n = sub.nodes;
  if (!n.length) return '';
  const parts = [`M ${n[0].x} ${n[0].y}`];
  const limit = sub.closed ? n.length : n.length - 1;
  for (let i = 0; i < limit; i++) {
    const a = n[i];
    const b = n[(i + 1) % n.length];
    parts.push(`C ${a.x + a.outDX} ${a.y + a.outDY} ${b.x + b.inDX} ${b.y + b.inDY} ${b.x} ${b.y}`);
  }
  if (sub.closed) parts.push('Z');
  return parts.join(' ');
}

/* ------------------------------------------------------------------ *
 * Text outlines
 * ------------------------------------------------------------------ */

export interface TextLine {
  text: string;
  x: number;
  y: number;
}

export function readTextLines(el: SVGGraphicsElement): TextLine[] {
  const spans = Array.from(el.querySelectorAll('tspan'));
  const baseX = parseFloat(el.getAttribute('x') ?? '0') || 0;
  const baseY = parseFloat(el.getAttribute('y') ?? '0') || 0;
  if (!spans.length) return [{ text: el.textContent ?? '', x: baseX, y: baseY }];
  let y = baseY;
  return spans.map((span, i) => {
    const sx = parseFloat(span.getAttribute('x') ?? '') ;
    const dy = parseFloat(span.getAttribute('dy') ?? '') || 0;
    if (i > 0 || span.hasAttribute('dy')) y += dy;
    return { text: span.textContent ?? '', x: Number.isFinite(sx) ? sx : baseX, y };
  });
}

export function readFont(el: SVGElement): {
  family: string;
  size: number;
  weight: string;
  style: string;
  anchor: CanvasTextAlign;
} {
  const size = parseFloat(el.getAttribute('font-size') ?? '') || 16;
  const anchorAttr = el.getAttribute('text-anchor') ?? 'start';
  return {
    family: el.getAttribute('font-family') || 'sans-serif',
    size,
    weight: el.getAttribute('font-weight') || 'normal',
    style: el.getAttribute('font-style') || 'normal',
    anchor: anchorAttr === 'middle' ? 'center' : anchorAttr === 'end' ? 'right' : 'left',
  };
}

/**
 * Rasterises a `<text>` item and traces the result, giving glyph outlines
 * without shipping a font parser. Used by "text to outlines" and by the eraser.
 */
export function textGeometry(el: SVGGraphicsElement, reference: SVGGraphicsElement, supersample = 2): ItemGeometry {
  if (typeof document === 'undefined') return EMPTY_GEOMETRY;
  const rings = textRings(el, reference, supersample);
  return { fill: rings, stroke: [], contours: rings, hasOpen: false };
}

export function textRings(el: SVGGraphicsElement, reference: SVGGraphicsElement, supersample = 2): Rings {
  const bounds = boundsIn(el, reference);
  const pad = 4;
  const w = Math.ceil((bounds.width + pad * 2) * supersample);
  const h = Math.ceil((bounds.height + pad * 2) * supersample);
  if (w <= 0 || h <= 0 || w * h > 16e6) return [];
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return [];

  const m = elementMatrixTo(el, reference);
  const font = readFont(el);
  ctx.setTransform(supersample, 0, 0, supersample, -(bounds.x - pad) * supersample, -(bounds.y - pad) * supersample);
  ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
  ctx.font = `${font.style} ${font.weight} ${font.size}px ${font.family}`;
  ctx.textAlign = font.anchor;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#000';
  for (const line of readTextLines(el)) ctx.fillText(line.text, line.x, line.y);

  const data = ctx.getImageData(0, 0, w, h);
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i++) mask[i] = data.data[i * 4 + 3] > 96 ? 1 : 0;
  const traced = traceMask(mask, w, h, 0.6);
  return traced.map((ring) =>
    ring.map((p) => ({ x: p.x / supersample + bounds.x - pad, y: p.y / supersample + bounds.y - pad })),
  );
}
