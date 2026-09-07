/**
 * @fileoverview How sharp the things that go through a texture are drawn.
 *
 * A png costume goes to the screen as it is, but a text box and a vector costume
 * are baked into a texture first, and a texture is only as sharp as it was baked.
 * The size the canvas draws them at is what decides that — see AI_TESSVM.md 12.
 */

/**
 * Ceiling on how many texture pixels go on one stage pixel. The stage already
 * asks for about 1.3 at the default size on a plain screen, around 3 in a retina
 * window, and reaches this full screen on a large display.
 */
export const MAX_SHARPNESS = 8;
/** Least sharpness a text box is drawn with, whatever the canvas is doing. */
export const MIN_TEXT_SHARPNESS = 2;
/**
 * Least sharpness a vector costume is rasterised with. That extra detail is the
 * only reason to keep the vector at all; at 1× it carries the same as the raster
 * beside it and the canvas round trip only loses.
 */
export const MIN_SVG_SHARPNESS = 2;
/**
 * And no sharper than this. A work carries far more costumes than text boxes and
 * every one of them is a texture the card holds; this covers a stage drawn up to
 * about 1920 css pixels wide on a retina screen.
 */
export const MAX_SVG_SHARPNESS = 4;
/**
 * No texture may go past this on a side. It is the size every webgl
 * implementation is required to allow; asking for more fails the upload, and a
 * failed upload takes the whole renderer down rather than one costume.
 */
export const MAX_TEXTURE_SIDE = 4096;
/** And no vector costume past this many pixels — 16MB of texture. */
export const MAX_SVG_PIXELS = 2048 * 2048;

/** Stepping in halves keeps a texture from being baked again for every pixel. */
const stepped = (value: number) => Math.ceil(value * 2) / 2;

/**
 * Sharpness for a text box. `longest` is the text's own longest side in stage
 * units, which does not move with the resolution, so it is what says how sharp
 * the texture can be before it stops fitting.
 */
export function textSharpness(displayScale: number, scale: number, longest: number): number {
  const wanted = Math.min(MAX_SHARPNESS, stepped(displayScale * Math.abs(scale)));
  const bySide = MAX_TEXTURE_SIDE / Math.max(longest, 1);
  return Math.min(Math.max(MIN_TEXT_SHARPNESS, wanted), bySide);
}

/** Sharpness a vector costume of this nominal size is rasterised with. */
export function svgSharpness(displayScale: number, width: number, height: number): number {
  const w = Math.max(width, 1);
  const h = Math.max(height, 1);
  const wanted = Math.min(MAX_SVG_SHARPNESS, Math.max(MIN_SVG_SHARPNESS, stepped(displayScale)));
  const bySide = MAX_TEXTURE_SIDE / Math.max(w, h);
  const byArea = Math.sqrt(MAX_SVG_PIXELS / (w * h));
  // The caps come last: a drawing already past the texture limit is rasterised
  // smaller than its own size rather than not at all.
  return Math.min(Math.max(1, wanted), bySide, byArea);
}
