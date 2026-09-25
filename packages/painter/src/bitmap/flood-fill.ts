import type { RGBA } from '../core/color.js';
import { colorDistance } from '../core/color.js';

export interface FloodFillOptions {
  /** 0..1; 0 only matches identical pixels. */
  tolerance?: number;
  /** When false every matching pixel in the image is filled. */
  contiguous?: boolean;
}

/**
 * Scanline flood fill. Operates on the ImageData in place and reports whether
 * anything changed, so the caller can skip a useless history entry.
 */
export function floodFill(
  image: ImageData,
  startX: number,
  startY: number,
  color: RGBA,
  options: FloodFillOptions = {},
): boolean {
  const { tolerance = 0.08, contiguous = true } = options;
  const { width, height, data } = image;
  const sx = Math.floor(startX);
  const sy = Math.floor(startY);
  if (sx < 0 || sy < 0 || sx >= width || sy >= height) return false;

  const at = (i: number): RGBA => ({
    r: data[i * 4],
    g: data[i * 4 + 1],
    b: data[i * 4 + 2],
    a: data[i * 4 + 3] / 255,
  });
  const target = at(sy * width + sx);
  const fill = {
    r: Math.round(color.r),
    g: Math.round(color.g),
    b: Math.round(color.b),
    a: Math.round(color.a * 255),
  };
  if (
    target.r === fill.r &&
    target.g === fill.g &&
    target.b === fill.b &&
    Math.round(target.a * 255) === fill.a
  ) {
    return false;
  }

  const matches = (i: number) => colorDistance(at(i), target) <= tolerance;
  const paint = (i: number) => {
    data[i * 4] = fill.r;
    data[i * 4 + 1] = fill.g;
    data[i * 4 + 2] = fill.b;
    data[i * 4 + 3] = fill.a;
  };

  if (!contiguous) {
    let changed = false;
    for (let i = 0; i < width * height; i++) {
      if (matches(i)) {
        paint(i);
        changed = true;
      }
    }
    return changed;
  }

  const visited = new Uint8Array(width * height);
  const stack: number[] = [sy * width + sx];
  let changed = false;

  while (stack.length) {
    const index = stack.pop()!;
    const y = (index / width) | 0;
    const left = y * width;
    let x = index % width;
    // Walk left to the start of the matching run.
    while (x > 0 && !visited[left + x - 1] && matches(left + x - 1)) x--;
    let scanUp = false;
    let scanDown = false;
    for (; x < width; x++) {
      const i = left + x;
      if (visited[i] || !matches(i)) break;
      visited[i] = 1;
      paint(i);
      changed = true;
      if (y > 0) {
        const up = i - width;
        const ok = !visited[up] && matches(up);
        if (ok && !scanUp) stack.push(up);
        scanUp = ok;
      }
      if (y < height - 1) {
        const down = i + width;
        const ok = !visited[down] && matches(down);
        if (ok && !scanDown) stack.push(down);
        scanDown = ok;
      }
    }
  }
  return changed;
}
