import assert from "node:assert/strict";
import { rotateMatrixFor, handlePoint, HANDLE_KINDS } from "../dist/index.js";
import { matRotate, matApply } from "../dist/index.js";

console.log("Running rotation tests...");

// Test 1: HitHandle geometry logic
const bounds = { x: 100, y: 100, width: 200, height: 150 };
const k = 1;
const HANDLE_SIZE = 9;
const ROTATE_OFFSET = 26;
const slop = Math.max((HANDLE_SIZE * k) / 2 + 2.5 * k, 7 * k); // 7

const cx = bounds.x + bounds.width / 2; // 200
const rotateOffset = ROTATE_OFFSET * k; // 26
const knobY = bounds.y - rotateOffset; // 74

function testHitHandle(px, py) {
  const p = { x: px, y: py };
  const distToKnob = Math.hypot(p.x - cx, p.y - knobY);
  const onStem =
    Math.abs(p.x - cx) <= slop &&
    p.y >= knobY - slop &&
    p.y < bounds.y - 1.5 * k;

  if (distToKnob <= slop * 1.3 || onStem) {
    return "rotate";
  }

  const candidates = HANDLE_KINDS.map((kind) => [
    kind,
    handlePoint(bounds, kind),
  ]);
  for (const [kind, point] of candidates) {
    if (Math.abs(p.x - point.x) <= slop && Math.abs(p.y - point.y) <= slop) {
      return kind;
    }
  }
  return null;
}

// 1. Knob center
assert.equal(testHitHandle(200, 74), "rotate", "Knob center should hit rotate");
// 2. Knob edge (within slop * 1.3 = 9.1px)
assert.equal(
  testHitHandle(205, 74),
  "rotate",
  "Knob right edge should hit rotate",
);
assert.equal(
  testHitHandle(200, 68),
  "rotate",
  "Knob top edge should hit rotate",
);

// 3. Middle of stem rod
assert.equal(
  testHitHandle(200, 85),
  "rotate",
  "Middle of stem rod should hit rotate",
);
assert.equal(
  testHitHandle(203, 85),
  "rotate",
  "Slightly offset on stem rod should hit rotate",
);
assert.equal(
  testHitHandle(197, 90),
  "rotate",
  "Lower part of stem rod should hit rotate",
);

// 4. Handle 'n' (at bounds.y = 100)
assert.equal(testHitHandle(200, 100), "n", "Handle 'n' should hit n");
assert.equal(testHitHandle(200, 102), "n", "Below handle 'n' should hit n");

// 5. Other handles
assert.equal(testHitHandle(100, 100), "nw", "Handle nw should hit nw");
assert.equal(testHitHandle(300, 100), "ne", "Handle ne should hit ne");
assert.equal(testHitHandle(200, 250), "s", "Handle s should hit s");

// 6. Outside
assert.equal(testHitHandle(180, 85), null, "Outside stem should be null");
assert.equal(testHitHandle(200, 50), null, "Way above knob should be null");

console.log("✓ HitHandle geometry tests passed.");

// Test 2: rotateMatrixFor correctness
const startBounds = { x: 100, y: 100, width: 200, height: 200 }; // center at (200, 200)
const startPoint = { x: 200, y: 74 }; // at stem knob (straight up, -90 deg)
const currentPoint = { x: 326, y: 200 }; // 90 degrees clockwise (at 3 o'clock)

const m = rotateMatrixFor(startBounds, startPoint, currentPoint, false);

// Transforming the top-center point (200, 100) by 90 deg clockwise around (200, 200) should yield (300, 200)
const rotatedPoint = matApply(m, { x: 200, y: 100 });
assert(
  Math.abs(rotatedPoint.x - 300) < 0.01,
  `Expected x ~ 300, got ${rotatedPoint.x}`,
);
assert(
  Math.abs(rotatedPoint.y - 200) < 0.01,
  `Expected y ~ 200, got ${rotatedPoint.y}`,
);

// Transforming the stem knob (200, 74) by 90 deg clockwise around (200, 200) should yield (326, 200)
const rotatedKnob = matApply(m, { x: 200, y: 74 });
assert(
  Math.abs(rotatedKnob.x - 326) < 0.01,
  `Expected knob x ~ 326, got ${rotatedKnob.x}`,
);
assert(
  Math.abs(rotatedKnob.y - 200) < 0.01,
  `Expected knob y ~ 200, got ${rotatedKnob.y}`,
);

console.log("✓ rotateMatrixFor transformation tests passed.");
console.log("All rotation tests passed 100%!");
