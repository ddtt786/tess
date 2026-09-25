import { whenDecoded } from './decode.js';

/**
 * Renders SVG markup into a canvas via a blob URL. Kept in its own module
 * because both "convert to bitmap" and cross-surface pasting need it.
 */
export async function rasterizeSVG(
  markup: string,
  width: number,
  height: number,
  scale = 1,
): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  const blob = new Blob([markup], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    const ready = whenDecoded(image);
    image.src = url;
    await ready;
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  } finally {
    URL.revokeObjectURL(url);
  }
  return canvas;
}
