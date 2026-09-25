import {
  floodRegion,
  traceMask,
  inflateRings,
  ringToSmoothPathData,
} from "../dist/index.js";

console.log("--- Testing Vector Region Engine Components ---");

// Test 1: Flood region inside a closed rectangular boundary
const w = 100;
const h = 100;
const wall = new Uint8Array(w * h);

// Draw a boundary box: x: 20..80, y: 20..80
for (let x = 20; x <= 80; x++) {
  wall[20 * w + x] = 1;
  wall[80 * w + x] = 1;
}
for (let y = 20; y <= 80; y++) {
  wall[y * w + 20] = 1;
  wall[y * w + 80] = 1;
}

// 1a. Flood from inside (50, 50)
const inside = floodRegion(wall, w, h, 50, 50);
if (!inside) throw new Error("Inside flood failed");
console.log(
  "Inside flood: area =",
  inside.area,
  ", touchedBorder =",
  inside.touchedBorder,
);
if (inside.touchedBorder)
  throw new Error("Inside flood touched border unexpectedly");
if (inside.area !== 59 * 59)
  throw new Error(`Unexpected inside area: ${inside.area}`);

// 1b. Flood from outside (5, 5)
const outside = floodRegion(wall, w, h, 5, 5);
if (!outside) throw new Error("Outside flood failed");
console.log(
  "Outside flood: area =",
  outside.area,
  ", touchedBorder =",
  outside.touchedBorder,
);
if (!outside.touchedBorder)
  throw new Error("Outside flood should have touched border");

// Test 2: Contour tracing
const rings = traceMask(inside.mask, w, h, 0.8);
console.log(
  "Traced rings count:",
  rings.length,
  "points in ring[0]:",
  rings[0]?.length,
);
if (!rings.length || rings[0].length < 4)
  throw new Error("Traced contour has insufficient points");

// Test 3: Ring inflation (bleed to prevent white seams)
const inflated = inflateRings(rings, 1.2);
console.log(
  "Inflated rings count:",
  inflated.length,
  "points:",
  inflated[0]?.length,
);
if (!inflated.length) throw new Error("Inflation failed");

// Test 4: Smooth SVG path generation
const pathData = inflated.map((r) => ringToSmoothPathData(r)).join(" ");
console.log(
  "Generated path data length:",
  pathData.length,
  "preview:",
  pathData.slice(0, 60) + "...",
);
if (!pathData.startsWith("M"))
  throw new Error("Path data must start with M command");

console.log(">>> All Vector Region Fill Engine tests PASSED successfully! <<<");
