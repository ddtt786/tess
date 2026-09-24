/**
 * @fileoverview Where an object sits on the stage, and how a handle drag
 * changes it.
 *
 * The stage is 480 × 270 with the origin in the middle and y pointing up. An
 * object's x/y place its registration point; the costume is scaled per axis
 * around that point and then rotated about it.
 */
import type { ObjectProps, TessObject } from '../model/types.ts';
export const STAGE = { width: 480, height: 270 };

export interface Point {
  x: number;
  y: number;
}

export interface Geometry {
  /** Registration point in stage pixels, y down, origin top left. */
  origin: Point;
  /** Registration point inside the costume, in costume pixels. */
  reg: Point;
  /** Costume size in its own pixels. */
  size: Point;
  /** Scale per axis as a fraction. */
  scale: Point;
  angle: number;
}

export function costumeSize(object: TessObject): Point {
  if (object.kind === 'text') {
    return { x: object.text?.boxWidth ?? 80, y: object.text?.boxHeight ?? 24 };
  }
  const costume = object.costumes.find((candidate) => candidate.id === object.selectedCostumeId)
    ?? object.costumes[0];
  return { x: costume?.width ?? 60, y: costume?.height ?? 60 };
}

export function geometryOf(object: TessObject): Geometry {
  const size = costumeSize(object);
  const props = object.props;
  return {
    origin: { x: STAGE.width / 2 + props.x, y: STAGE.height / 2 - props.y },
    reg: props.center ?? { x: textAnchor(object, size.x), y: size.y / 2 },
    size,
    scale: { x: props.scaleX / 100, y: props.scaleY / 100 },
    angle: props.rotation === 'free' ? props.angle : 0,
  };
}

/**
 * Where a one-line text box hangs from its x: entry grows left-aligned text to
 * the right of x and right-aligned text to the left of it. Wrapping boxes and
 * pictures hang from their middle.
 */
function textAnchor(object: TessObject, width: number): number {
  const text = object.kind === 'text' ? object.text : null;
  if (!text || text.lineBreak) return width / 2;
  return text.align === 'left' ? 0 : text.align === 'right' ? width : width / 2;
}

/** A point given in costume pixels, placed on the stage. */
export function localToStage(geometry: Geometry, local: Point): Point {
  const offset = {
    x: (local.x - geometry.reg.x) * geometry.scale.x,
    y: (local.y - geometry.reg.y) * geometry.scale.y,
  };
  const turned = rotate(offset, geometry.angle);
  return { x: geometry.origin.x + turned.x, y: geometry.origin.y + turned.y };
}

export function rotate(point: Point, degrees: number): Point {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { x: point.x * cos - point.y * sin, y: point.x * sin + point.y * cos };
}

export type HandleKind = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

/** Where a handle sits, in costume pixels. */
export function handleLocal(geometry: Geometry, kind: HandleKind): Point {
  const { x: width, y: height } = geometry.size;
  const left = 0;
  const right = width;
  const top = 0;
  const bottom = height;
  const midX = width / 2;
  const midY = height / 2;
  switch (kind) {
    case 'nw': return { x: left, y: top };
    case 'n': return { x: midX, y: top };
    case 'ne': return { x: right, y: top };
    case 'e': return { x: right, y: midY };
    case 'se': return { x: right, y: bottom };
    case 's': return { x: midX, y: bottom };
    case 'sw': return { x: left, y: bottom };
    default: return { x: left, y: midY };
  }
}

const MIN_SCALE = 0.05;

/** The corner or edge that stays put while the opposite one is dragged. */
function anchorLocal(geometry: Geometry, kind: HandleKind): Point {
  const { x: width, y: height } = geometry.size;
  return {
    x: kind.includes('w') ? width : kind.includes('e') ? 0 : geometry.reg.x,
    y: kind.includes('n') ? height : kind.includes('s') ? 0 : geometry.reg.y,
  };
}

/**
 * Resizing from a handle.
 *
 * The scale comes from the distance to the opposite corner, not to the
 * registration point, so dragging one edge leaves the other edge where it is.
 * x and y move with it, since they name the registration point and that point
 * slides when the picture is stretched.
 */
export function resizeFromHandle(
  geometry: Geometry,
  kind: HandleKind,
  pointer: Point,
  proportional: boolean,
): Partial<ObjectProps> {
  const anchor = anchorLocal(geometry, kind);
  const anchorStage = localToStage(geometry, anchor);
  // Pointer position in unrotated costume space, measured from the anchor.
  const local = rotate(
    { x: pointer.x - anchorStage.x, y: pointer.y - anchorStage.y },
    -geometry.angle,
  );

  const signX = kind.includes('w') ? -1 : 1;
  const signY = kind.includes('n') ? -1 : 1;
  const rawX = Math.max(MIN_SCALE, (signX * local.x) / (geometry.size.x || 1));
  const rawY = Math.max(MIN_SCALE, (signY * local.y) / (geometry.size.y || 1));

  let scaleX = geometry.scale.x;
  let scaleY = geometry.scale.y;
  if (kind.length === 2) {
    if (proportional) {
      const scale = Math.max(rawX, rawY);
      scaleX = scale;
      scaleY = scale;
    } else {
      scaleX = rawX;
      scaleY = rawY;
    }
  } else if (kind === 'e' || kind === 'w') {
    scaleX = rawX;
  } else {
    scaleY = rawY;
  }

  // Put the registration point back where it belongs relative to the anchor.
  const offset = rotate(
    { x: (anchor.x - geometry.reg.x) * scaleX, y: (anchor.y - geometry.reg.y) * scaleY },
    geometry.angle,
  );
  const origin = { x: anchorStage.x - offset.x, y: anchorStage.y - offset.y };

  return {
    scaleX: Math.round(scaleX * 1000) / 10,
    scaleY: Math.round(scaleY * 1000) / 10,
    x: Math.round(origin.x - STAGE.width / 2),
    y: Math.round(STAGE.height / 2 - origin.y),
  };
}

/** Moves the registration point to a stage position, leaving the picture put. */
export function centerFromStage(
  geometry: Geometry,
  target: Point,
): Partial<ObjectProps> {
  const delta = { x: target.x - geometry.origin.x, y: target.y - geometry.origin.y };
  const local = rotate(delta, -geometry.angle);
  const reg = {
    x: clamp(geometry.reg.x + local.x / (geometry.scale.x || 1), -geometry.size.x, geometry.size.x * 2),
    y: clamp(geometry.reg.y + local.y / (geometry.scale.y || 1), -geometry.size.y, geometry.size.y * 2),
  };
  return {
    center: { x: Math.round(reg.x), y: Math.round(reg.y) },
    x: Math.round(target.x - STAGE.width / 2),
    y: Math.round(STAGE.height / 2 - target.y),
  };
}

/** The angle that points the rotation handle at a stage position. */
export function angleFromStage(geometry: Geometry, target: Point, snap: boolean): number {
  const degrees = (Math.atan2(target.y - geometry.origin.y, target.x - geometry.origin.x) * 180) / Math.PI + 90;
  const wrapped = ((Math.round(degrees) % 360) + 360) % 360;
  return snap ? Math.round(wrapped / 15) * 15 % 360 : wrapped;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}
