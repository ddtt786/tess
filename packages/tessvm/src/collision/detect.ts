/**
 * @fileoverview 엔트리의 픽셀 단위 충돌 판정을 그대로, 훨씬 빠르게 계산합니다.
 *
 * 엔트리(`ndgmr.checkPixelCollision`)는 겹치는 사각형만큼 캔버스를 두 장 만들어 두
 * 스프라이트를 다시 그린 뒤 알파를 비교합니다. 여기서는 같은 사각형을 같은 좌표계
 * (640×360 무대 픽셀)에서 훑되, 그림을 다시 그리지 않고 미리 만들어 둔 알파 마스크를
 * 역변환으로 찾아봅니다. 판정 결과는 프레임 안에서 재사용하고, 서로 멀리 있는 것은
 * 격자로 먼저 걸러 냅니다.
 */
import { COLLISION, stage, type Entity, type Target } from '../runtime/model.ts';
import type { AlphaMask, MaskStore } from './mask.ts';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** `reach_something` compares alpha against 0.2; `bounce_wall` against 0. */
export const TOUCH_THRESHOLD = 0.2;
export const BOUNCE_THRESHOLD = 0;

/** Entry's walls are 30 stage units thick, sitting just outside the stage. */
const WALL_DEPTH = 30;

/** One of the four wall bands, in world pixels, for the stage as it is now. */
export function wallRect(side: string): Rect | null {
  const depth = WALL_DEPTH * stage.scale;
  const width = stage.worldWidth;
  const height = stage.worldHeight;
  switch (side) {
    case 'wall_up':
      return { x: 0, y: -depth, width, height: depth };
    case 'wall_down':
      return { x: 0, y: height, width, height: depth };
    case 'wall_left':
      return { x: -depth, y: 0, width: depth, height };
    case 'wall_right':
      return { x: width, y: 0, width: depth, height };
    default:
      return null;
  }
}

const matrixA = new Float64Array(6);
const matrixB = new Float64Array(6);
const boundsA: Rect = { x: 0, y: 0, width: 0, height: 0 };
const boundsB: Rect = { x: 0, y: 0, width: 0, height: 0 };
const intersection: Rect = { x: 0, y: 0, width: 0, height: 0 };

/** Axis-aligned box of a rect transformed by a 2×3 matrix. */
function transformedBounds(
  m: Float64Array,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  out: Rect,
): Rect {
  const a = m[0]!;
  const b = m[1]!;
  const c = m[2]!;
  const d = m[3]!;
  const tx = m[4]!;
  const ty = m[5]!;
  const px0 = a * x0 + c * y0 + tx;
  const py0 = b * x0 + d * y0 + ty;
  const px1 = a * x1 + c * y0 + tx;
  const py1 = b * x1 + d * y0 + ty;
  const px2 = a * x1 + c * y1 + tx;
  const py2 = b * x1 + d * y1 + ty;
  const px3 = a * x0 + c * y1 + tx;
  const py3 = b * x0 + d * y1 + ty;
  const minX = Math.min(px0, px1, px2, px3);
  const maxX = Math.max(px0, px1, px2, px3);
  const minY = Math.min(py0, py1, py2, py3);
  const maxY = Math.max(py0, py1, py2, py3);
  out.x = minX;
  out.y = minY;
  out.width = maxX - minX;
  out.height = maxY - minY;
  return out;
}

/** World-space box of an entity, matching what entry asks PIXI for. */
export function entityBounds(entity: Entity, out: Rect): Rect {
  const m = entity.worldMatrix(matrixA);
  if (entity.type === 'textBox') {
    // The background rect is centred on the entity, so the box is symmetric.
    const halfW = entity.width / 2;
    const halfH = entity.height / 2;
    return transformedBounds(m, -halfW, -halfH, halfW, halfH, out);
  }
  return transformedBounds(m, 0, 0, entity.width, entity.height, out);
}

/** `ndgmr.calculateIntersection` — the overlap, or null when the boxes miss. */
function intersect(r1: Rect, r2: Rect, out: Rect): Rect | null {
  const hw1 = r1.width / 2;
  const hh1 = r1.height / 2;
  const hw2 = r2.width / 2;
  const hh2 = r2.height / 2;
  const dx = Math.abs(r1.x + hw1 - (r2.x + hw2)) - (hw1 + hw2);
  const dy = Math.abs(r1.y + hh1 - (r2.y + hh2)) - (hh1 + hh2);
  if (dx < 0 && dy < 0) {
    out.x = Math.max(r1.x, r2.x);
    out.y = Math.max(r1.y, r2.y);
    out.width = Math.min(r1.width, r2.width, -dx);
    out.height = Math.min(r1.height, r2.height, -dy);
    return out;
  }
  return null;
}

/** `_collisionDistancePrecheck` — plain box overlap, kept for identical edges. */
function closeEnough(r1: Rect, r2: Rect): boolean {
  return (
    Math.abs(r2.x - r1.x) < (r1.x < r2.x ? r1.width : r2.width) &&
    Math.abs(r2.y - r1.y) < (r1.y < r2.y ? r1.height : r2.height)
  );
}

/** `Entry.checkCollisionRect` — used when either side is a text box. */
export function rectsOverlap(r1: Rect, r2: Rect): boolean {
  return intersect(r1, r2, intersection) !== null;
}

export class CollisionSystem {
  private readonly masks: MaskStore;
  /** Bumped every tick so cached answers never outlive the frame. */
  private frame = 0;
  private readonly memo = new Map<string, boolean>();

  constructor(masks: MaskStore) {
    this.masks = masks;
  }

  beginFrame(): void {
    this.frame += 1;
    if (this.memo.size) {
      this.memo.clear();
    }
  }

  private maskOf(entity: Entity): AlphaMask | null {
    const picture = entity.picture;
    if (!picture) {
      return null;
    }
    return this.masks.get(
      picture.id,
      Math.round(picture.dimension.width),
      Math.round(picture.dimension.height),
    );
  }

  /** Entity against one other entity, with entry's pixel rule. */
  touchingEntity(a: Entity, b: Entity, threshold: number): boolean {
    if (a === b) {
      return false;
    }
    const key = `${a.id}|${b.id}|${a.version}|${b.version}|${threshold}`;
    const cached = this.memo.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const result = this.computeEntity(a, b, threshold);
    this.memo.set(key, result);
    return result;
  }

  private computeEntity(a: Entity, b: Entity, threshold: number): boolean {
    entityBounds(a, boundsA);
    entityBounds(b, boundsB);
    if (a.type === 'textBox' || b.type === 'textBox') {
      return rectsOverlap(boundsA, boundsB);
    }
    if (!closeEnough(boundsA, boundsB)) {
      return false;
    }
    const rect = intersect(boundsA, boundsB, intersection);
    if (!rect || rect.width < 1 || rect.height < 1) {
      return false;
    }
    const maskA = this.maskOf(a);
    const maskB = this.maskOf(b);
    if (!maskA || !maskB) {
      return false;
    }
    return pixelOverlap(a, maskA, b, maskB, rect, threshold);
  }

  /** Entity against every visible entity (and clone) of another object. */
  touchingTarget(a: Entity, target: Target, threshold: number): boolean {
    if (!a.visible) {
      return false;
    }
    const own = target.entity;
    if (own !== a && own.visible && this.touchingEntity(a, own, threshold)) {
      return true;
    }
    const clones = target.clones;
    for (let i = 0; i < clones.length; i += 1) {
      const clone = clones[i]!;
      if (clone === a || !clone.visible) {
        continue;
      }
      if (this.touchingEntity(a, clone, threshold)) {
        return true;
      }
    }
    return false;
  }

  /** Entity against one of the four stage walls. */
  touchingWall(entity: Entity, side: string, threshold: number): boolean {
    if (side === 'wall') {
      return (
        this.touchingWall(entity, 'wall_up', threshold) ||
        this.touchingWall(entity, 'wall_down', threshold) ||
        this.touchingWall(entity, 'wall_left', threshold) ||
        this.touchingWall(entity, 'wall_right', threshold)
      );
    }
    const wall = wallRect(side);
    if (!wall) {
      return false;
    }
    const key = `${entity.id}|${side}|${entity.version}|${threshold}`;
    const cached = this.memo.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const result = this.computeWall(entity, wall, threshold);
    this.memo.set(key, result);
    return result;
  }

  private computeWall(entity: Entity, wall: Rect, threshold: number): boolean {
    entityBounds(entity, boundsA);
    if (entity.type === 'textBox') {
      return rectsOverlap(boundsA, wall);
    }
    if (!closeEnough(wall, boundsA)) {
      return false;
    }
    const rect = intersect(wall, boundsA, intersection);
    if (!rect || rect.width < 1 || rect.height < 1) {
      return false;
    }
    const mask = this.maskOf(entity);
    if (!mask) {
      return false;
    }
    return pixelInRect(entity, mask, rect, threshold);
  }

  /** `GEHelper.hitTestMouse` — the sprite's own pixel under the pointer. */
  touchingMouse(entity: Entity, worldX: number, worldY: number): boolean {
    if (!entity.visible || entity.effect.alpha < 0.001) {
      return false;
    }
    const m = entity.worldMatrix(matrixA);
    const det = m[0]! * m[3]! - m[1]! * m[2]!;
    if (det === 0) {
      return false;
    }
    const dx = worldX - m[4]!;
    const dy = worldY - m[5]!;
    const localX = (m[3]! * dx - m[2]! * dy) / det;
    const localY = (m[0]! * dy - m[1]! * dx) / det;
    if (entity.type === 'textBox') {
      return (
        localX >= -entity.width / 2 &&
        localX < entity.width / 2 &&
        localY >= -entity.height / 2 &&
        localY < entity.height / 2
      );
    }
    if (localX < 0 || localX >= entity.width || localY < 0 || localY >= entity.height) {
      return false;
    }
    const mask = this.maskOf(entity);
    if (!mask) {
      return false;
    }
    const tx = Math.floor((localX * mask.width) / entity.width);
    const ty = Math.floor((localY * mask.height) / entity.height);
    if (tx < 0 || tx >= mask.width || ty < 0 || ty >= mask.height) {
      return false;
    }
    return mask.data[ty * mask.width + tx]! > 1;
  }
}

/** Inverse of the entity's world matrix, written into `out` as `[a,b,c,d,tx,ty]`. */
function inverseInto(entity: Entity, scratch: Float64Array, out: Float64Array): boolean {
  const m = entity.worldMatrix(scratch);
  const det = m[0]! * m[3]! - m[1]! * m[2]!;
  if (det === 0 || !isFinite(det)) {
    return false;
  }
  out[0] = m[3]! / det;
  out[1] = -m[1]! / det;
  out[2] = -m[2]! / det;
  out[3] = m[0]! / det;
  out[4] = m[4]!;
  out[5] = m[5]!;
  return true;
}

const inverseA = new Float64Array(6);
const inverseB = new Float64Array(6);

/**
 * Walks the overlap one world pixel at a time, stepping the two local-space
 * coordinates by constant increments instead of multiplying a matrix per pixel.
 */
function pixelOverlap(
  a: Entity,
  maskA: AlphaMask,
  b: Entity,
  maskB: AlphaMask,
  rect: Rect,
  threshold: number,
): boolean {
  if (!inverseInto(a, matrixA, inverseA) || !inverseInto(b, matrixB, inverseB)) {
    return false;
  }
  const limit = Math.round(Math.min(0.99999, threshold) * 255) | 0;
  const width = rect.width | 0;
  const height = rect.height | 0;

  const scaleAX = maskA.width / a.width;
  const scaleAY = maskA.height / a.height;
  const scaleBX = maskB.width / b.width;
  const scaleBY = maskB.height / b.height;

  const startX = rect.x + 0.5;
  const startY = rect.y + 0.5;

  let rowAX = ((startX - inverseA[4]!) * inverseA[0]! + (startY - inverseA[5]!) * inverseA[2]!) * scaleAX;
  let rowAY = ((startX - inverseA[4]!) * inverseA[1]! + (startY - inverseA[5]!) * inverseA[3]!) * scaleAY;
  let rowBX = ((startX - inverseB[4]!) * inverseB[0]! + (startY - inverseB[5]!) * inverseB[2]!) * scaleBX;
  let rowBY = ((startX - inverseB[4]!) * inverseB[1]! + (startY - inverseB[5]!) * inverseB[3]!) * scaleBY;

  const stepAXx = inverseA[0]! * scaleAX;
  const stepAYx = inverseA[1]! * scaleAY;
  const stepAXy = inverseA[2]! * scaleAX;
  const stepAYy = inverseA[3]! * scaleAY;
  const stepBXx = inverseB[0]! * scaleBX;
  const stepBYx = inverseB[1]! * scaleBY;
  const stepBXy = inverseB[2]! * scaleBX;
  const stepBYy = inverseB[3]! * scaleBY;

  const dataA = maskA.data;
  const dataB = maskB.data;
  const wA = maskA.width;
  const hA = maskA.height;
  const wB = maskB.width;
  const hB = maskB.height;
  const aMinX = maskA.trimX;
  const aMaxX = maskA.trimX + maskA.trimWidth;
  const aMinY = maskA.trimY;
  const aMaxY = maskA.trimY + maskA.trimHeight;
  const bMinX = maskB.trimX;
  const bMaxX = maskB.trimX + maskB.trimWidth;
  const bMinY = maskB.trimY;
  const bMaxY = maskB.trimY + maskB.trimHeight;

  for (let y = 0; y < height; y += 1) {
    let ax = rowAX;
    let ay = rowAY;
    let bx = rowBX;
    let by = rowBY;
    for (let x = 0; x < width; x += 1) {
      const tax = ax | 0;
      const tay = ay | 0;
      if (
        ax >= aMinX &&
        tax < aMaxX &&
        ay >= aMinY &&
        tay < aMaxY &&
        tax >= 0 &&
        tax < wA &&
        tay >= 0 &&
        tay < hA &&
        dataA[tay * wA + tax]! > limit
      ) {
        const tbx = bx | 0;
        const tby = by | 0;
        if (
          bx >= bMinX &&
          tbx < bMaxX &&
          by >= bMinY &&
          tby < bMaxY &&
          tbx >= 0 &&
          tbx < wB &&
          tby >= 0 &&
          tby < hB &&
          dataB[tby * wB + tbx]! > limit
        ) {
          return true;
        }
      }
      ax += stepAXx;
      ay += stepAYx;
      bx += stepBXx;
      by += stepBYx;
    }
    rowAX += stepAXy;
    rowAY += stepAYy;
    rowBX += stepBXy;
    rowBY += stepBYy;
  }
  return false;
}

/** Same walk against a solid rectangle — the stage walls have no texture holes. */
function pixelInRect(entity: Entity, mask: AlphaMask, rect: Rect, threshold: number): boolean {
  if (!inverseInto(entity, matrixA, inverseA)) {
    return false;
  }
  const limit = Math.round(Math.min(0.99999, threshold) * 255) | 0;
  const width = rect.width | 0;
  const height = rect.height | 0;
  const scaleX = mask.width / entity.width;
  const scaleY = mask.height / entity.height;
  const startX = rect.x + 0.5;
  const startY = rect.y + 0.5;
  let rowX = ((startX - inverseA[4]!) * inverseA[0]! + (startY - inverseA[5]!) * inverseA[2]!) * scaleX;
  let rowY = ((startX - inverseA[4]!) * inverseA[1]! + (startY - inverseA[5]!) * inverseA[3]!) * scaleY;
  const stepXx = inverseA[0]! * scaleX;
  const stepYx = inverseA[1]! * scaleY;
  const stepXy = inverseA[2]! * scaleX;
  const stepYy = inverseA[3]! * scaleY;
  const data = mask.data;
  const w = mask.width;
  const h = mask.height;
  for (let y = 0; y < height; y += 1) {
    let px = rowX;
    let py = rowY;
    for (let x = 0; x < width; x += 1) {
      const tx = px | 0;
      const ty = py | 0;
      if (px >= 0 && tx < w && py >= 0 && ty < h && data[ty * w + tx]! > limit) {
        return true;
      }
      px += stepXx;
      py += stepYx;
    }
    rowX += stepXy;
    rowY += stepYy;
  }
  return false;
}

export { COLLISION };
