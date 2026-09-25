import assert from "node:assert/strict";

/** Separable 1D sliding-window dilation: O(W * H) independent of radius */
function dilateMask(src, w, h, radius) {
  if (radius <= 0) return src;
  const temp = new Uint8Array(src.length);
  const dst = new Uint8Array(src.length);

  for (let y = 0; y < h; y++) {
    const row = y * w;
    let count = 0;
    for (let x = -radius; x <= radius; x++) {
      if (x >= 0 && x < w && src[row + x]) count++;
    }
    for (let x = 0; x < w; x++) {
      temp[row + x] = count > 0 ? 1 : 0;
      const outX = x - radius;
      if (outX >= 0 && outX < w && src[row + outX]) count--;
      const inX = x + radius + 1;
      if (inX >= 0 && inX < w && src[row + inX]) count++;
    }
  }

  for (let x = 0; x < w; x++) {
    let count = 0;
    for (let y = -radius; y <= radius; y++) {
      if (y >= 0 && y < h && temp[y * w + x]) count++;
    }
    for (let y = 0; y < h; y++) {
      dst[y * w + x] = count > 0 ? 1 : 0;
      const outY = y - radius;
      if (outY >= 0 && outY < h && temp[outY * w + x]) count--;
      const inY = y + radius + 1;
      if (inY >= 0 && inY < h && temp[inY * w + x]) count++;
    }
  }

  return dst;
}

/** Flood outside open canvas starting from all canvas borders */
function floodBorders(wall, width, height) {
  const mask = new Uint8Array(width * height);
  const queue = [];

  for (let x = 0; x < width; x++) {
    if (!wall[x]) {
      mask[x] = 1;
      queue.push(x);
    }
    const b = (height - 1) * width + x;
    if (!wall[b] && !mask[b]) {
      mask[b] = 1;
      queue.push(b);
    }
  }
  for (let y = 0; y < height; y++) {
    const l = y * width;
    if (!wall[l] && !mask[l]) {
      mask[l] = 1;
      queue.push(l);
    }
    const r = l + width - 1;
    if (!wall[r] && !mask[r]) {
      mask[r] = 1;
      queue.push(r);
    }
  }

  let head = 0;
  while (head < queue.length) {
    const idx = queue[head++];
    const y = (idx / width) | 0;
    const x = idx % width;
    if (x > 0) {
      const n = idx - 1;
      if (!wall[n] && !mask[n]) {
        mask[n] = 1;
        queue.push(n);
      }
    }
    if (x < width - 1) {
      const n = idx + 1;
      if (!wall[n] && !mask[n]) {
        mask[n] = 1;
        queue.push(n);
      }
    }
    if (y > 0) {
      const n = idx - width;
      if (!wall[n] && !mask[n]) {
        mask[n] = 1;
        queue.push(n);
      }
    }
    if (y < height - 1) {
      const n = idx + width;
      if (!wall[n] && !mask[n]) {
        mask[n] = 1;
        queue.push(n);
      }
    }
  }
  return mask;
}

/** Standard fast scanline flood fill */
function floodRegion(wall, width, height, seedX, seedY) {
  const sx = Math.floor(seedX);
  const sy = Math.floor(seedY);
  if (sx < 0 || sy < 0 || sx >= width || sy >= height) return null;
  if (wall[sy * width + sx]) return null;

  const mask = new Uint8Array(width * height);
  const stack = [sy * width + sx];
  let touchedBorder = false;
  let area = 0;

  while (stack.length) {
    const index = stack.pop();
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
      if (x === 0 || x === width - 1 || y === 0 || y === height - 1)
        touchedBorder = true;

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

/**
 * Smart Dual-Pass Enclosed Region Detector:
 * 1. Checks direct flood on raw wall.
 * 2. If unclosed, tests progressive closing radii with outside-in leak prevention,
 *    preserving 100% of interior crevices without cutting corners.
 */
function smartDetectRegion(wall, rw, rh, clickX, clickY, gapTolerance = 8) {
  let seedX = Math.round(clickX);
  let seedY = Math.round(clickY);
  seedX = Math.max(0, Math.min(rw - 1, seedX));
  seedY = Math.max(0, Math.min(rh - 1, seedY));

  // Step 1: If seed is not on wall, check direct flood
  if (!wall[seedY * rw + seedX]) {
    const direct = floodRegion(wall, rw, rh, seedX, seedY);
    if (direct && !direct.touchedBorder && direct.area >= 8) {
      return direct;
    }
  }

  // Step 2: If seed is on a wall stroke, search nearby for enclosed region
  if (wall[seedY * rw + seedX]) {
    for (let r = 1; r <= 12; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          const nx = seedX + dx;
          const ny = seedY + dy;
          if (nx >= 0 && nx < rw && ny >= 0 && ny < rh && !wall[ny * rw + nx]) {
            const candidate = floodRegion(wall, rw, rh, nx, ny);
            if (candidate && !candidate.touchedBorder && candidate.area >= 8) {
              return candidate;
            }
          }
        }
      }
    }
  }

  // Step 3: If direct flood leaked or seed was in unclosed shape, use smart gap closer
  if (gapTolerance <= 0) return null;

  const targetR = Math.max(4, Math.round(gapTolerance));
  const maxR = Math.min(28, Math.max(8, Math.floor(Math.min(rw, rh) * 0.15)));
  const candidateRadii = [
    targetR,
    Math.round(targetR * 1.5),
    Math.round(targetR * 2.2),
    Math.round(targetR * 3.0),
  ];
  const radii = Array.from(new Set(candidateRadii.filter((r) => r <= maxR)));
  if (!radii.length) radii.push(Math.min(targetR, maxR));

  // Pad by 1 pixel so the outside flood can circulate around all 4 edges
  const pw = rw + 2;
  const ph = rh + 2;
  const pWall = new Uint8Array(pw * ph);
  for (let y = 0; y < rh; y++) {
    const srcRow = y * rw;
    const dstRow = (y + 1) * pw + 1;
    for (let x = 0; x < rw; x++) {
      pWall[dstRow + x] = wall[srcRow + x];
    }
  }

  const pSeedX = seedX + 1;
  const pSeedY = seedY + 1;

  for (const r of radii) {
    const pDilated = dilateMask(pWall, pw, ph, r);
    // Keep outer 1-pixel frame open for border circulation
    for (let x = 0; x < pw; x++) {
      pDilated[x] = 0;
      pDilated[(ph - 1) * pw + x] = 0;
    }
    for (let y = 0; y < ph; y++) {
      pDilated[y * pw] = 0;
      pDilated[y * pw + pw - 1] = 0;
    }

    const pOutsideMask = floodBorders(pDilated, pw, ph);
    const pOutsideExpanded = dilateMask(pOutsideMask, pw, ph, r);

    // Find candidate interior seed (not on raw wall, and not in outsideExpanded)
    let curSeedX = -1;
    let curSeedY = -1;

    if (!pWall[pSeedY * pw + pSeedX]) {
      if (!pOutsideExpanded[pSeedY * pw + pSeedX]) {
        curSeedX = pSeedX;
        curSeedY = pSeedY;
      }
    } else {
      // User clicked on a stroke/wall, search nearby within radius 1..12 for interior
      searchNearby: for (let d = 1; d <= 12; d++) {
        for (let dy = -d; dy <= d; dy++) {
          for (let dx = -d; dx <= d; dx++) {
            if (Math.abs(dx) !== d && Math.abs(dy) !== d) continue;
            const nx = pSeedX + dx;
            const ny = pSeedY + dy;
            if (
              nx >= 1 &&
              nx <= rw &&
              ny >= 1 &&
              ny <= rh &&
              !pWall[ny * pw + nx] &&
              !pOutsideExpanded[ny * pw + nx]
            ) {
              curSeedX = nx;
              curSeedY = ny;
              break searchNearby;
            }
          }
        }
      }
    }

    if (curSeedX < 0) continue;

    // Construct smart barrier: original wall + outside barrier
    const pSmartWall = new Uint8Array(pw * ph);
    for (let i = 0; i < pw * ph; i++) {
      pSmartWall[i] = pWall[i] || pOutsideExpanded[i] ? 1 : 0;
    }

    const pRegion = floodRegion(pSmartWall, pw, ph, curSeedX, curSeedY);
    if (pRegion && !pRegion.touchedBorder && pRegion.area >= 12) {
      // Unpad the mask back to rw * rh
      const mask = new Uint8Array(rw * rh);
      let area = 0;
      for (let y = 0; y < rh; y++) {
        const srcRow = (y + 1) * pw + 1;
        const dstRow = y * rw;
        for (let x = 0; x < rw; x++) {
          if (pRegion.mask[srcRow + x]) {
            mask[dstRow + x] = 1;
            area++;
          }
        }
      }
      return { mask, touchedBorder: false, area };
    }
  }

  return null;
}

console.log("=== Running Smart Gap Closing & Crevice Suite ===");

// Scenario 1: Box with 12px gap in right wall and sharp acute crevice inside
const w = 100;
const h = 100;
const wall = new Uint8Array(w * h);

// Box x: 10..90, y: 10..90
for (let x = 10; x <= 90; x++) {
  wall[10 * w + x] = 1;
  wall[90 * w + x] = 1;
}
for (let y = 10; y <= 90; y++) wall[y * w + 10] = 1;
// 12px gap in right wall (y: 44..56)
for (let y = 10; y < 44; y++) wall[y * w + 90] = 1;
for (let y = 57; y <= 90; y++) wall[y * w + 90] = 1;

// Acute crevice wedge from (10, 10) to (40, 20)
for (let i = 0; i <= 30; i++) {
  wall[(10 + Math.round((i * 10) / 30)) * w + (10 + i)] = 1;
}

// Test 1a: Click in center (50, 50) of unclosed box
const resCenter = smartDetectRegion(wall, w, h, 50, 50, 8);
assert(resCenter !== null, "Center region should be detected");
assert.equal(resCenter.touchedBorder, false, "Must not touch border");
assert.equal(resCenter.mask[11 * w + 15], 1, "Must fill into narrow crevice");
assert.equal(resCenter.mask[0], 0, "Must not leak to canvas border");
console.log("✓ Test 1a Passed: Center click enclosed & filled into crevice");

// Test 1b: Click directly inside the 1px-wide crevice (15, 11)
const resCrevice = smartDetectRegion(wall, w, h, 15, 11, 8);
assert(resCrevice !== null, "Crevice region should be detected");
assert.equal(resCrevice.touchedBorder, false, "Must not touch border");
assert.equal(resCrevice.mask[11 * w + 15], 1, "Crevice itself filled");
assert.equal(resCrevice.mask[50 * w + 50], 1, "Connected main interior filled");
assert.equal(resCrevice.mask[0], 0, "Must not leak to canvas border");
console.log("✓ Test 1b Passed: Direct crevice click filled cleanly");

// Test 1c: Click directly on the stroke bounding the crevice (20, 13)
const resStroke = smartDetectRegion(wall, w, h, 20, 13, 8);
assert(resStroke !== null, "Stroke click near crevice should find interior");
assert.equal(resStroke.touchedBorder, false, "Must not touch border");
assert.equal(resStroke.mask[11 * w + 15], 1, "Crevice filled");
console.log(
  "✓ Test 1c Passed: Stroke click near crevice automatically resolved to interior",
);

// Test 2: Click on open canvas (5, 5) outside the box
const resOpenCanvas = smartDetectRegion(wall, w, h, 5, 5, 8);
assert.equal(resOpenCanvas, null, "Open canvas click MUST return null");
console.log(
  "✓ Test 2 Passed: Open canvas click correctly rejected (returns null)",
);

// Test 3: Completely closed shape (no gap)
const wallClosed = new Uint8Array(w * h);
for (let x = 20; x <= 80; x++) {
  wallClosed[20 * w + x] = 1;
  wallClosed[80 * w + x] = 1;
}
for (let y = 20; y <= 80; y++) {
  wallClosed[y * w + 20] = 1;
  wallClosed[y * w + 80] = 1;
}
const resClosed = smartDetectRegion(wallClosed, w, h, 50, 50, 8);
assert(resClosed !== null, "Closed box detected");
assert.equal(resClosed.touchedBorder, false);
assert.equal(resClosed.area, 59 * 59);
console.log(
  "✓ Test 3 Passed: Fully closed shape detects immediately with 0 leak",
);

// Test 4: Large gap (16px gap) with gapTolerance = 10
const wallLargeGap = new Uint8Array(w * h);
for (let x = 10; x <= 90; x++) {
  wallLargeGap[10 * w + x] = 1;
  wallLargeGap[90 * w + x] = 1;
}
for (let y = 10; y <= 90; y++) wallLargeGap[y * w + 10] = 1;
// 16px gap in right wall (y: 42..58)
for (let y = 10; y < 42; y++) wallLargeGap[y * w + 90] = 1;
for (let y = 59; y <= 90; y++) wallLargeGap[y * w + 90] = 1;

const resLargeGap = smartDetectRegion(wallLargeGap, w, h, 50, 50, 10);
assert(resLargeGap !== null, "16px gap should be closed with gapTolerance=10");
assert.equal(resLargeGap.touchedBorder, false);
assert.equal(resLargeGap.mask[0], 0, "No leak to border");
console.log("✓ Test 4 Passed: 16px gap successfully closed and contained");

// Test 5: Performance on 1000x1000 canvas with gap
const bigW = 1000;
const bigH = 1000;
const bigWall = new Uint8Array(bigW * bigH);
for (let x = 200; x <= 800; x++) {
  bigWall[200 * bigW + x] = 1;
  bigWall[800 * bigW + x] = 1;
}
for (let y = 200; y <= 800; y++) bigWall[y * bigW + 200] = 1;
// 14px gap
for (let y = 200; y < 493; y++) bigWall[y * bigW + 800] = 1;
for (let y = 508; y <= 800; y++) bigWall[y * bigW + 800] = 1;

const t0 = performance.now();
const resBig = smartDetectRegion(bigWall, bigW, bigH, 500, 500, 8);
const dt = performance.now() - t0;
assert(resBig !== null, "Big canvas region detected");
assert.equal(resBig.touchedBorder, false);
console.log(
  `✓ Test 5 Passed: 1000x1000 canvas gap closed in ${dt.toFixed(1)}ms`,
);

// Test 6: Hand-drawn 28px gap on 500x500 canvas with click near the gap
const w6 = 500;
const h6 = 500;
const wall28 = new Uint8Array(w6 * h6);
for (let x = 50; x <= 450; x++) {
  wall28[50 * w6 + x] = 1;
  wall28[450 * w6 + x] = 1;
}
for (let y = 50; y <= 450; y++) wall28[y * w6 + 50] = 1;
// 28px gap in right wall: y from 236 to 264
for (let y = 50; y < 236; y++) wall28[y * w6 + 450] = 1;
for (let y = 265; y <= 450; y++) wall28[y * w6 + 450] = 1;

const resNearGap = smartDetectRegion(wall28, w6, h6, 440, 250, 8);
assert(resNearGap !== null, "28px gap should be closed with default tolerance");
assert.equal(resNearGap.touchedBorder, false);
assert.equal(resNearGap.mask[0], 0, "No leak to border");
console.log(
  "✓ Test 6 Passed: 28px gap closed even when clicked near gap (440, 250)",
);

// Test 7: Large 36px gap closed by progressive radii
const wall36 = new Uint8Array(w6 * h6);
for (let x = 50; x <= 450; x++) {
  wall36[50 * w6 + x] = 1;
  wall36[450 * w6 + x] = 1;
}
for (let y = 50; y <= 450; y++) wall36[y * w6 + 50] = 1;
// 36px gap in right wall: y from 232 to 268
for (let y = 50; y < 232; y++) wall36[y * w6 + 450] = 1;
for (let y = 269; y <= 450; y++) wall36[y * w6 + 450] = 1;

const res36 = smartDetectRegion(wall36, w6, h6, 250, 250, 8);
assert(res36 !== null, "36px gap should be closed by progressive radii");
assert.equal(res36.touchedBorder, false);
assert.equal(res36.mask[0], 0, "No leak to border");
console.log(
  "✓ Test 7 Passed: 36px hand-drawn gap successfully closed and contained",
);

// Test 8: Click outside the 36px gap on open canvas MUST be rejected
const resOutside36 = smartDetectRegion(wall36, w6, h6, 465, 250, 8);
assert.equal(
  resOutside36,
  null,
  "Click outside 36px gap must return null (not enclosed)",
);
console.log(
  "✓ Test 8 Passed: Click outside gap correctly rejected (returns null)",
);

console.log("\n>>> ALL TESTS PASSED SUCCESSFULLY (100%) <<<");
