/**
 * 붓 선분을 사각형으로 펴는 계산을 확인합니다.
 *
 * 그리기 자체는 PIXI 가 하므로 여기서는 꼭짓점만 봅니다 — 화면에서 `Graphics` 의
 * 획과 같은 그림이 나오는지는 브라우저에서 픽셀로 맞춰 본 것이고, 여기서는 그
 * 꼭짓점이 다시 어긋나지 않는지를 지킵니다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { isSegment, quadIndices, writeQuads } from '../packages/tessvm/src/render/segment-geometry.ts';
import type { Stroke } from '../packages/tessvm/src/runtime/model.ts';

const line = (points: number[], extra: Partial<Stroke> = {}): Stroke => ({
  color: '#000000', thickness: 1, opacity: 0, points, fill: false, ...extra,
});

test('점이 둘인 선 획만 사각형으로 편다', () => {
  assert.equal(isSegment(line([0, 0, 1, 1])), true);
  assert.equal(isSegment(line([0, 0, 1, 1, 2, 2])), false);
  assert.equal(isSegment(line([0, 0, 1, 1], { fill: true })), false);
  assert.equal(isSegment(line([0, 0])), false);
});

test('가로 선은 굵기의 절반만큼 위아래로 벌어진다', () => {
  const positions = new Float32Array(8);
  const count = writeQuads([line([0, 0, 10, 0], { thickness: 2 })], 0, 1, 2, positions);
  assert.equal(count, 1);
  // 무대는 y 가 위로, PIXI 는 아래로 자라므로 y 는 뒤집혀 나온다.
  assert.deepEqual([...positions], [0, 1, 10, 1, 10, -1, 0, -1]);
});

test('세로 선도 같은 규칙으로 벌어진다', () => {
  const positions = new Float32Array(8);
  writeQuads([line([0, 0, 0, 10], { thickness: 4 })], 0, 1, 4, positions);
  assert.deepEqual([...positions], [2, 0, 2, -10, -2, -10, -2, -0]);
});

test('길이가 없는 획은 아무 곳도 덮지 않는다', () => {
  const positions = new Float32Array(8);
  writeQuads([line([3, 3, 3, 3], { thickness: 2 })], 0, 1, 2, positions);
  // 방향이 없으므로 네 꼭짓점이 한 점에 겹쳐 넓이가 0 이다.
  assert.deepEqual([...positions], [3, -3, 3, -3, 3, -3, 3, -3]);
});

test('점이 모자란 획은 건너뛰고 세지 않는다', () => {
  const positions = new Float32Array(16);
  const count = writeQuads(
    [line([0, 0]), line([0, 0, 2, 0], { thickness: 2 })],
    0,
    2,
    2,
    positions,
  );
  assert.equal(count, 1);
  assert.deepEqual([...positions.slice(0, 8)], [0, 1, 2, 1, 2, -1, 0, -1]);
});

test('사각형마다 삼각형 두 개가 같은 차례로 나온다', () => {
  assert.deepEqual([...quadIndices(2)], [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
});
