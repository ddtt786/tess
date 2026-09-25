import assert from "node:assert/strict";
import { matRotate, matApply, matToString } from "../dist/index.js";

console.log("Running rotated text editor transformation tests...");

// Test: Verify rotated text anchor mapping and CSS transform calculations
function computeEditorTransform(textX, textY, fontSize, matrix) {
  const sceneAnchor = matApply(matrix, { x: textX, y: textY });
  const rotation = (Math.atan2(matrix[1], matrix[0]) * 180) / Math.PI;

  const baselineY = -fontSize * 0.82;
  const alignX = "0%"; // 'left'

  const transform = `rotate(${Math.round(rotation * 100) / 100}deg) translate(${alignX}, ${Math.round(baselineY * 100) / 100}px)`;
  return { sceneAnchor, rotation, transform };
}

// 1. Unrotated text at (100, 100)
{
  const m = [1, 0, 0, 1, 0, 0];
  const res = computeEditorTransform(100, 100, 20, m);
  assert.equal(res.sceneAnchor.x, 100);
  assert.equal(res.sceneAnchor.y, 100);
  assert.equal(res.rotation, 0);
  assert.equal(res.transform, "rotate(0deg) translate(0%, -16.4px)");
}

// 2. Rotated 90 degrees around origin: (x, y) = (100, 50) -> (-50, 100)
{
  const m = matRotate(Math.PI / 2, 0, 0); // 90 deg clockwise
  const res = computeEditorTransform(100, 50, 20, m);
  assert(
    Math.abs(res.sceneAnchor.x - -50) < 0.01,
    `Expected x ~ -50, got ${res.sceneAnchor.x}`,
  );
  assert(
    Math.abs(res.sceneAnchor.y - 100) < 0.01,
    `Expected y ~ 100, got ${res.sceneAnchor.y}`,
  );
  assert(
    Math.abs(res.rotation - 90) < 0.01,
    `Expected rotation ~ 90, got ${res.rotation}`,
  );
  assert(res.transform.startsWith("rotate(90deg)"));
}

// 3. Rotated 45 degrees around center (100, 100)
{
  const m = matRotate(Math.PI / 4, 100, 100); // 45 deg
  const res = computeEditorTransform(100, 100, 20, m);
  // Center itself should not move:
  assert(Math.abs(res.sceneAnchor.x - 100) < 0.01);
  assert(Math.abs(res.sceneAnchor.y - 100) < 0.01);
  assert(
    Math.abs(res.rotation - 45) < 0.01,
    `Expected rotation ~ 45, got ${res.rotation}`,
  );
  assert(res.transform.startsWith("rotate(45deg)"));
}

// 4. Rotated -30 degrees (counterclockwise)
{
  const m = matRotate(-Math.PI / 6, 200, 150);
  const res = computeEditorTransform(200, 150, 24, m);
  assert(
    Math.abs(res.rotation - -30) < 0.01,
    `Expected rotation ~ -30, got ${res.rotation}`,
  );
}

console.log("✓ All rotated text editor transformation tests PASSED!");
