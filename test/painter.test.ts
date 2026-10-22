import test from 'node:test';
import assert from 'node:assert/strict';
import {
  History,
  IDENTITY,
  defaultBrushOptions,
  differenceRings,
  floodFill,
  matApply,
  matMultiply,
  matTranslate,
  parseColor,
  pointInRings,
  ringToSmoothPathData,
  ringsArea,
  ringsToPathData,
  strokeCenterline,
  strokeOutline,
} from '@tess/painter';
import type { InputPoint, Matrix, Ring } from '@tess/painter';

test('painter strokes produce finite smoothed geometry without mutating samples', () => {
  const points: InputPoint[] = [
    { x: 10, y: 10, pressure: 0.5 },
    { x: 50, y: 20, pressure: 0.6 },
    { x: 90, y: 70, pressure: 0.7 },
  ];
  const before = structuredClone(points);
  const options = defaultBrushOptions(8);
  const centerline = strokeCenterline(points, options);
  const outline = strokeOutline(points, options);
  assert.ok(centerline.length >= 3);
  assert.ok(outline.length > points.length);
  assert.ok(outline.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y)));
  assert.ok(Math.abs(ringsArea([outline])) > 0);
  assert.deepEqual(points, before);
  assert.deepEqual(strokeOutline([], options), []);
});

test('painter stroke outlines retain quadratic SVG curves', () => {
  const outline: Ring = [
    { x: 10, y: 10 }, { x: 30, y: 12 }, { x: 60, y: 20 }, { x: 80, y: 40 },
    { x: 75, y: 45 }, { x: 55, y: 25 }, { x: 28, y: 18 }, { x: 8, y: 15 },
  ];
  const path = ringToSmoothPathData(outline);
  assert.ok(path.startsWith('M '));
  assert.ok(path.includes(' Q'));
  assert.ok(path.endsWith(' Z'));
  assert.ok(!path.includes(' L '));
});

test('painter transforms use the drag baseline without compounding displacement', () => {
  let matrix: Matrix = IDENTITY;
  for (let dx = 1; dx <= 50; dx++) matrix = matMultiply(matTranslate(dx, dx * 2), IDENTITY);
  assert.deepEqual(matApply(matrix, { x: 100, y: 200 }), { x: 150, y: 300 });
  assert.deepEqual(IDENTITY, [1, 0, 0, 1, 0, 0]);
});

test('painter boolean subtraction keeps holes in the result and SVG path', () => {
  const square: Ring = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
  const eraser: Ring = [{ x: 40, y: 40 }, { x: 60, y: 40 }, { x: 60, y: 60 }, { x: 40, y: 60 }];
  const result = differenceRings([square], [eraser]);
  assert.equal(result.length, 2);
  assert.equal(Math.abs(ringsArea(result)), 9600);
  assert.equal(pointInRings({ x: 20, y: 20 }, result), true);
  assert.equal(pointInRings({ x: 50, y: 50 }, result), false);
  assert.equal((ringsToPathData(result).match(/M /g) ?? []).length, 2);
});

test('painter flood fill respects disconnected regions and makes repeated fills a no-op', () => {
  const image = { width: 3, height: 1, data: new Uint8ClampedArray([
    0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255,
  ]) } as ImageData;
  const color = parseColor('#6366f1');
  assert.deepEqual(color, { r: 99, g: 102, b: 241, a: 1 });
  assert.equal(floodFill(image, 0, 0, color, { tolerance: 0 }), true);
  assert.deepEqual([...image.data.slice(0, 4)], [99, 102, 241, 255]);
  assert.deepEqual([...image.data.slice(8)], [0, 0, 0, 255]);
  assert.equal(floodFill(image, 0, 0, color, { tolerance: 0 }), false);
});

test('painter history restores snapshots and discards redo after a new edit', () => {
  const changes: Array<{ canUndo: boolean; canRedo: boolean }> = [];
  const history = new History<string>({ limit: 10, onChange: (state) => changes.push(state) });
  history.reset('baseline');
  assert.equal(history.canUndo, false);
  history.push('first');
  history.push('second');
  assert.equal(history.undo(), 'first');
  assert.equal(history.canRedo, true);
  assert.equal(history.redo(), 'second');
  history.undo();
  history.push('replacement');
  assert.equal(history.redo(), null);
  assert.equal(history.current, 'replacement');
  assert.deepEqual(changes.at(-1), { canUndo: true, canRedo: false });
});
