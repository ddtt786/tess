export interface RegionResult {
  /** 1 for every cell that belongs to the flooded region. */
  mask: Uint8Array;
  /** True when the region runs off the edge of the raster (i.e. it is open). */
  touchedBorder: boolean;
  /** Number of cells in the region. */
  area: number;
}

/**
 * Scanline flood fill over a barrier mask.
 *
 * `wall[i] !== 0` marks ink; the flood spreads through everything else from
 * the seed. This is how the vector bucket finds "the area you clicked in"
 * without building a planar arrangement of every curve in the document.
 */
export function floodRegion(
  wall: Uint8Array,
  width: number,
  height: number,
  seedX: number,
  seedY: number,
): RegionResult | null {
  const sx = Math.floor(seedX);
  const sy = Math.floor(seedY);
  if (sx < 0 || sy < 0 || sx >= width || sy >= height) return null;
  if (wall[sy * width + sx]) return null;

  const mask = new Uint8Array(width * height);
  const stack: number[] = [sy * width + sx];
  let touchedBorder = false;
  let area = 0;

  while (stack.length) {
    const index = stack.pop()!;
    const y = (index / width) | 0;
    const rowStart = y * width;
    let x = index - rowStart;
    if (mask[index] || wall[index]) continue;

    while (x > 0 && !wall[rowStart + x - 1] && !mask[rowStart + x - 1]) x--;
    let spanUp = false;
    let spanDown = false;

    for (; x < width; x++) {
      const i = rowStart + x;
      if (wall[i] || mask[i]) break;
      mask[i] = 1;
      area++;
      if (x === 0 || x === width - 1 || y === 0 || y === height - 1) touchedBorder = true;

      if (y > 0) {
        const up = i - width;
        const open = !wall[up] && !mask[up];
        if (open && !spanUp) stack.push(up);
        spanUp = open;
      }
      if (y < height - 1) {
        const down = i + width;
        const open = !wall[down] && !mask[down];
        if (open && !spanDown) stack.push(down);
        spanDown = open;
      }
    }
  }

  return { mask, touchedBorder, area };
}

/** Builds a barrier mask from rendered pixels: anything opaque enough is ink. */
export function inkMask(image: ImageData, alphaThreshold = 24): Uint8Array {
  const { data } = image;
  const mask = new Uint8Array(image.width * image.height);
  for (let i = 0; i < mask.length; i++) mask[i] = data[i * 4 + 3] >= alphaThreshold ? 1 : 0;
  return mask;
}
