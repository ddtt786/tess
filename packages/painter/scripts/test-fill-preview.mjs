import assert from "node:assert/strict";
import {
  floodRegion,
  traceMask,
  inflateRings,
  ringToSmoothPathData,
} from "../dist/index.js";

console.log("Running fill preview & region detection tests...");

// Test: Verify region detection pipeline (simulating barrier mask & floodfill without DOM)
const rw = 100;
const rh = 100;
const wall = new Uint8Array(rw * rh);

// Draw a closed square barrier between x in [20, 80] and y in [20, 80]
for (let x = 20; x <= 80; x++) {
  wall[20 * rw + x] = 1;
  wall[80 * rw + x] = 1;
}
for (let y = 20; y <= 80; y++) {
  wall[y * rw + 20] = 1;
  wall[y * rw + 80] = 1;
}

// 1. Inside the enclosed region (seed: 50, 50)
const inside = floodRegion(wall, rw, rh, 50, 50);
assert(inside !== null, "Inside flood should return a region");
assert.equal(
  inside.touchedBorder,
  false,
  "Inside region must not touch border",
);
assert(inside.area > 3000, `Inside area should be ~3481, got ${inside.area}`);

// Trace rings
const rings = traceMask(inside.mask, rw, rh, 0.8);
assert(rings.length > 0, "Should trace at least 1 ring");

// Inflate rings
const finalRings = inflateRings(rings, 1.2);
assert(finalRings.length > 0, "Should have inflated rings");

// Generate SVG path d
const d = finalRings
  .filter((r) => r.length > 2)
  .map((r) => ringToSmoothPathData(r))
  .join(" ");

assert(
  d.startsWith("M "),
  `Path data should start with 'M ', got: ${d.slice(0, 20)}`,
);
assert(d.length > 50, "Path data should be substantial");
console.log(
  "✓ Enclosed region path generated successfully:",
  d.slice(0, 40) + "...",
);

// 2. Outside the enclosed region (seed: 5, 5) -> touches border, so returns null (no region preview)
const outside = floodRegion(wall, rw, rh, 5, 5);
assert(outside !== null, "Outside flood should return a region");
assert.equal(outside.touchedBorder, true, "Outside region must touch border");

console.log("✓ Open canvas correctly rejected (touchedBorder = true)");
console.log("✓ All fill preview & region detection tests PASSED!");
