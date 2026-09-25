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

/** Every open area of a wall mask, labelled once, so looking one up is a table read. */
export interface Regions {
  /** Area label per pixel; 0 on wall. */
  labels: Int32Array;
  /** Per label: whether the area reaches the image border. */
  touched: Uint8Array;
  /** Per label: pixel count. */
  area: Int32Array;
}

/** Labels the 4-connected open areas of `wall`, as `floodRegion` would find them one at a time. */
export function labelRegions(wall: Uint8Array, width: number, height: number): Regions {
  const labels = new Int32Array(width * height);
  const touched: number[] = [0];
  const areas: number[] = [0];
  const stack: number[] = [];
  let next = 0;
  for (let start = 0; start < labels.length; start++) {
    if (wall[start] || labels[start]) continue;
    next += 1;
    let touch = 0;
    let area = 0;
    stack.push(start);
    while (stack.length) {
      const index = stack.pop()!;
      if (labels[index] || wall[index]) continue;
      const y = (index / width) | 0;
      const rowStart = y * width;
      let x = index - rowStart;
      while (x > 0 && !wall[rowStart + x - 1] && !labels[rowStart + x - 1]) x--;
      let spanUp = false;
      let spanDown = false;
      for (; x < width; x++) {
        const i = rowStart + x;
        if (wall[i] || labels[i]) break;
        labels[i] = next;
        area++;
        if (x === 0 || x === width - 1 || y === 0 || y === height - 1) touch = 1;
        if (y > 0) {
          const up = i - width;
          const open = !wall[up] && !labels[up];
          if (open && !spanUp) stack.push(up);
          spanUp = open;
        }
        if (y < height - 1) {
          const down = i + width;
          const open = !wall[down] && !labels[down];
          if (open && !spanDown) stack.push(down);
          spanDown = open;
        }
      }
    }
    touched.push(touch);
    areas.push(area);
  }
  return { labels, touched: Uint8Array.from(touched), area: Int32Array.from(areas) };
}

/** The pixels of one labelled area. */
export function regionMask(regions: Regions, label: number): Uint8Array {
  const { labels } = regions;
  const mask = new Uint8Array(labels.length);
  for (let i = 0; i < labels.length; i++) if (labels[i] === label) mask[i] = 1;
  return mask;
}

/**
 * Grows `mask` up to `steps` pixels (8-connected), into wall pixels only: the
 * area reaches under the lines around it and never past them.
 */
export function growIntoWall(mask: Uint8Array, wall: Uint8Array, width: number, height: number, steps: number): Uint8Array {
  const grown = mask.slice();
  let frontier: number[] = [];
  for (let i = 0; i < grown.length; i++) if (grown[i]) frontier.push(i);
  for (let step = 0; step < steps && frontier.length; step++) {
    const next: number[] = [];
    for (const index of frontier) {
      const y = (index / width) | 0;
      const x = index - y * width;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const n = ny * width + nx;
          if (!grown[n] && wall[n]) {
            grown[n] = 1;
            next.push(n);
          }
        }
      }
    }
    frontier = next;
  }
  return grown;
}

/**
 * Takes back the grown wall pixels that touch open space outside the area: the
 * fill then ends inside its lines, not on their soft outer rim.
 */
export function keepOffRim(grown: Uint8Array, original: Uint8Array, wall: Uint8Array, width: number, height: number): void {
  const rim: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!grown[i] || original[i] || !wall[i]) continue;
      outer: for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const n = ny * width + nx;
          if (!wall[n] && !original[n]) {
            rim.push(i);
            break outer;
          }
        }
      }
    }
  }
  for (const i of rim) grown[i] = 0;
}

/** Fills the holes of `mask` smaller than `maxArea` pixels (specks and slivers between lines). */
export function fillPockets(mask: Uint8Array, width: number, height: number, maxArea: number): void {
  const holes = labelRegions(mask, width, height);
  for (let i = 0; i < mask.length; i++) {
    const label = holes.labels[i];
    if (label && !holes.touched[label] && holes.area[label] <= maxArea) mask[i] = 1;
  }
}
