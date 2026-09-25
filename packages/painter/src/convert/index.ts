import type { Rings } from '../core/types.js';
import { ringToSmoothPathData, ringToPathData } from '../core/freehand.js';
import { round } from '../core/geom.js';
import { rasterizeSVG } from './rasterize.js';
import type { TraceOptions } from './trace.js';
import { traceImageData } from './trace.js';

export { rasterizeSVG } from './rasterize.js';
export { traceImageData, traceMask, quantize } from './trace.js';
export { floodRegion, inkMask } from './region.js';
export type { RegionResult } from './region.js';
export type { TraceOptions, TracedLayer, ColorLayer, QuantizeOptions } from './trace.js';

export interface VectorizeOptions extends TraceOptions {
  /** Round the traced corners instead of keeping the staircase. */
  smooth?: boolean;
}

export interface VectorLayer {
  /** CSS colour for the layer. */
  fill: string;
  /** Path data covering every contour of the layer. */
  d: string;
}

/**
 * Traces an ImageData into flat colour paths — the "convert to vector" step.
 * Contours are emitted as one path per colour with `fill-rule: evenodd` so
 * holes render correctly without any winding bookkeeping.
 */
export function imageDataToLayers(image: ImageData, options: VectorizeOptions = {}): VectorLayer[] {
  const { smooth = false } = options;
  return traceImageData(image, options).map((layer) => ({
    fill: layer.css,
    d: ringsToPath(layer.rings, smooth),
  }));
}

function ringsToPath(rings: Rings, smooth: boolean): string {
  return rings
    .filter((r) => r.length > 2)
    .map((r) => (smooth ? ringToSmoothPathData(r) : ringToPathData(r)))
    .join(' ');
}

/** Standalone SVG markup for traced layers. */
export function layersToSVG(layers: VectorLayer[], width: number, height: number): string {
  const body = layers
    .map((l) => `<path d="${l.d}" fill="${l.fill}" fill-rule="evenodd" stroke="none"/>`)
    .join('');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${round(width, 2)}" height="${round(height, 2)}" ` +
    `viewBox="0 0 ${round(width, 2)} ${round(height, 2)}">${body}</svg>`
  );
}

/** Rasterises SVG markup into ImageData at `scale`. */
export async function svgToImageData(
  markup: string,
  width: number,
  height: number,
  scale = 1,
): Promise<ImageData> {
  const canvas = await rasterizeSVG(markup, width, height, scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('[painter] 2D canvas is unavailable');
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}
