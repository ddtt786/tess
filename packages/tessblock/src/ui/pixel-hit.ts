/**
 * @fileoverview Whether a point of a costume is painted: the stage picks an
 * object only where its picture is, so a big picture's see-through parts leave
 * the objects under it reachable, as the runner does.
 */

interface Mask {
  width: number;
  height: number;
  alpha: Uint8ClampedArray;
}

/** Read alpha by picture address and size; `null` while it is still loading or could not be read. */
const masks = new Map<string, Mask | null>();

/** Alpha below this counts as see-through. */
const SOLID = 8;

/**
 * Whether the costume is painted at `local` (costume pixels). A picture not
 * read yet counts as painted everywhere, so a click is never lost to loading.
 */
export function paintedAt(
  url: string,
  width: number,
  height: number,
  local: { x: number; y: number },
  shown?: HTMLImageElement | null,
): boolean {
  if (local.x < 0 || local.y < 0 || local.x >= width || local.y >= height) return false;
  const key = `${Math.round(width)}x${Math.round(height)}|${url}`;
  let mask = masks.get(key);
  // The picture already on screen is read on the spot.
  if (!mask && shown?.complete && shown.naturalWidth) {
    try {
      mask = maskOf(shown, width, height);
      masks.set(key, mask);
    } catch {
      // A picture from another site cannot be read; its whole box counts.
      return true;
    }
  }
  if (!mask) {
    preloadMask(url, width, height);
    return true;
  }
  const x = Math.min(mask.width - 1, Math.floor((local.x / width) * mask.width));
  const y = Math.min(mask.height - 1, Math.floor((local.y / height) * mask.height));
  return mask.alpha[y * mask.width + x]! >= SOLID;
}

/** Starts reading a costume's alpha ahead of the first press on it. */
export function preloadMask(url: string, width: number, height: number): void {
  const key = `${Math.round(width)}x${Math.round(height)}|${url}`;
  if (masks.has(key) || !url) return;
  masks.set(key, null);
  readMask(url, width, height).then((mask) => masks.set(key, mask), () => masks.delete(key));
}

async function readMask(url: string, width: number, height: number): Promise<Mask> {
  const image = new Image();
  image.decoding = 'async';
  image.src = url;
  await image.decode();
  return maskOf(image, width, height);
}

function maskOf(image: HTMLImageElement, width: number, height: number): Mask {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  context.drawImage(image, 0, 0, w, h);
  const pixels = context.getImageData(0, 0, w, h).data;
  const alpha = new Uint8ClampedArray(w * h);
  for (let at = 0; at < alpha.length; at += 1) alpha[at] = pixels[at * 4 + 3]!;
  return { width: w, height: h, alpha };
}
