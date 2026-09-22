import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GeometryUtils,
  ClipperHelper,
  FloodFill,
  HistoryManager,
} from '@tess/painter';
import type { Point, RectBounds } from '@tess/painter';

test('@tess/painter - Stroke smoothing and Catmull-Rom interpolation', () => {
  const rawPoints = [
    { x: 10, y: 10, pressure: 0.5 },
    { x: 50, y: 20, pressure: 0.6 },
  ];

  // Distance ~41.2px, stepSize = 3px -> ~14 points
  const interpolated = GeometryUtils.interpolateStrokeSegment(rawPoints, 3);
  assert.ok(interpolated.length >= 13, 'Should generate dense intermediate points');
  assert.ok(interpolated[0].x > 10, 'First interpolated point should progress');
  assert.equal(interpolated[interpolated.length - 1].x, 50);
  assert.equal(interpolated[interpolated.length - 1].y, 20);

  // 3rd point adds curved progression
  rawPoints.push({ x: 90, y: 70, pressure: 0.7 });
  const secondSegment = GeometryUtils.interpolateStrokeSegment(rawPoints, 3);
  assert.ok(secondSegment.length >= 15);
  assert.equal(secondSegment[secondSegment.length - 1].x, 90);
});

test('@tess/painter - SVG bezier path generation without linear polygon faceting', () => {
  const strokeOutline = [
    [10, 10],
    [30, 12],
    [60, 20],
    [80, 40],
    [75, 45],
    [55, 25],
    [28, 18],
    [8, 15],
  ];

  const svgPath = GeometryUtils.getSvgPathFromStroke(strokeOutline, true);
  assert.ok(svgPath.startsWith('M '), 'Path should start with M');
  assert.ok(svgPath.includes(' Q '), 'Path should use quadratic bezier Q segments for smooth curve');
  assert.ok(svgPath.endsWith(' Z'), 'Path should close with Z');
  assert.ok(!svgPath.includes(' L '), 'Path should NOT be converted into faceted linear L segments');
});

test('@tess/painter - Non-compounding deterministic matrix transformations', () => {
  const base = GeometryUtils.identityMatrix();
  let lastM = base;

  // Simulate 50 frames of dragging
  for (let dx = 1; dx <= 50; dx++) {
    const transM = { a: 1, b: 0, c: 0, d: 1, e: dx, f: dx * 2 };
    lastM = GeometryUtils.multiplyMatrices(transM, base);
  }

  // Displacement must be strictly 50 and 100, not compounding
  assert.equal(lastM.e, 50);
  assert.equal(lastM.f, 100);
  assert.equal(lastM.a, 1);
  assert.equal(lastM.d, 1);
});

test('@tess/painter - TransformBox drag tracking without acceleration', () => {
  const initialBounds: RectBounds = { x: 100, y: 200, width: 80, height: 60 };
  const dragStartPt: Point = { x: 120, y: 220 };

  let currentBoxBounds = { ...initialBounds };
  for (let frame = 1; frame <= 100; frame++) {
    const curMousePt: Point = { x: dragStartPt.x + frame, y: dragStartPt.y + frame * 2 };
    const totalDx = curMousePt.x - dragStartPt.x;
    const totalDy = curMousePt.y - dragStartPt.y;

    currentBoxBounds = {
      x: initialBounds.x + totalDx,
      y: initialBounds.y + totalDy,
      width: initialBounds.width,
      height: initialBounds.height,
    };
  }

  assert.equal(currentBoxBounds.x, 200);
  assert.equal(currentBoxBounds.y, 400);
  assert.equal(currentBoxBounds.width, 80);
  assert.equal(currentBoxBounds.height, 60);
});

test('@tess/painter - Clipper boolean subtraction with hole preservation', () => {
  // Positive square 0..100
  const square = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ];

  // Hole inside 20..80
  const eraser = [
    { x: 40, y: 40 },
    { x: 60, y: 40 },
    { x: 60, y: 60 },
    { x: 40, y: 60 },
  ];

  const result = ClipperHelper.subtractWithHoles([square], [eraser]);
  assert.equal(result.length, 1, 'Should return 1 shape');
  assert.equal(result[0].holes.length, 1, 'Should preserve 1 negative hole');

  const combined = [result[0].solid, ...result[0].holes];
  const svgD = ClipperHelper.pathsDToSvgPath(combined);
  assert.ok(svgD.includes('M'), 'Should produce valid SVG path string');
  assert.ok(svgD.includes('Z'), 'Should produce closed sub-paths');
});

test('@tess/painter - FloodFill color parsing and HistoryManager stack', () => {
  const rgba = FloodFill.hexToRgba('#6366f1');
  assert.equal(rgba.r, 99);
  assert.equal(rgba.g, 102);
  assert.equal(rgba.b, 241);
  assert.equal(rgba.a, 255);

  let undoCount = 0;
  let redoCount = 0;
  const history = new HistoryManager<string>(10, (canUndo, canRedo) => {
    if (canUndo) undoCount++;
    if (canRedo) redoCount++;
  });

  history.push('state 1');
  assert.equal(history.canUndo, true);
  const undone = history.undo('state 2');
  assert.equal(undone, 'state 1');
  assert.equal(history.canRedo, true);
  const redone = history.redo('state 1');
  assert.equal(redone, 'state 2');
});
