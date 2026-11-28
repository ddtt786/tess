/**
 * @fileoverview Draws a run of opaque pen fills as one vertex-coloured mesh,
 * cut into the same triangles `Graphics` makes and drawn in the same order.
 */
import { Buffer, BufferUsage, Geometry, Mesh, Shader, earcut, type Container } from 'pixi.js';
import type { Stroke } from '../runtime/model.ts';
import { nonzeroParts } from './fill.ts';
import { flatPolygon, isFanSafe } from './fill-geometry.ts';

/** Below this many fills the mesh costs more than the path it replaces. */
export const FILL_FLOOR = 16;

/** Vertices the first buffer is made with. */
const FIRST_ROOM = 1024;

const VERTEX = `
in vec2 aPosition;
in vec4 aColor;
out vec4 vColor;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform vec4 uWorldColorAlpha;
uniform mat3 uTransformMatrix;
uniform vec4 uColor;
void main() {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vColor = vec4(aColor.rgb * aColor.a, aColor.a) * uColor * uWorldColorAlpha;
}
`;

const FRAGMENT = `
in vec4 vColor;
void main() {
  gl_FragColor = vColor;
}
`;

/** A colour as `usableColor` reads it: rgb number and alpha. */
export type InkOf = (color: unknown) => { color: number; alpha: number } | null;

export class FillBatch {
  private readonly parent: Container;
  private mesh: Mesh<Geometry, Shader> | null = null;
  private positions = new Float32Array(0);
  private colors = new Uint32Array(0);
  private indices = new Uint32Array(0);
  private vertexRoom = 0;
  private indexRoom = 0;
  /** Indices drawn last time, so only that stretch needs folding away. */
  private drawn = 0;
  private vertexCount = 0;
  private indexCount = 0;
  private positionBuffer: Buffer | null = null;
  private colorBuffer: Buffer | null = null;
  private indexBuffer: Buffer | null = null;
  private readonly flat: number[] = [];

  constructor(parent: Container) {
    this.parent = parent;
  }

  /**
   * Lays `pieces[from…to)` down in order, each fill in its own colour. With `cut`
   * (boost off) a path that is not a plain convex shape is filled by the nonzero rule.
   */
  set(pieces: Stroke[], from: number, to: number, inkOf: InkOf, cut: boolean): void {
    this.vertexCount = 0;
    this.indexCount = 0;
    const flat = this.flat;
    for (let at = from; at < to; at += 1) {
      const piece = pieces[at]!;
      if (piece.points.length < 4) {
        continue;
      }
      const corners = flatPolygon(piece.points, flat);
      if (corners < 3) {
        continue;
      }
      const ink = inkOf(piece.color) ?? { color: 0x000000, alpha: 1 };
      const packed = packColor(ink.color, ink.alpha);
      const parts = cut && !isFanSafe(flat, corners) ? nonzeroParts(flat.slice(0, corners * 2)) : null;
      if (!parts) {
        this.addPolygon(flat, corners, packed);
        continue;
      }
      for (const part of parts) {
        const partCorners = flatPolygon(part, flat, false);
        if (partCorners >= 3) {
          this.addPolygon(flat, partCorners, packed);
        }
      }
    }
    const vertexCount = this.vertexCount;
    const indexCount = this.indexCount;
    this.reserve(vertexCount, indexCount);
    // Triangles left from a longer frame fold onto one corner and cover nothing.
    if (this.drawn > indexCount) {
      this.indices.fill(0, indexCount, this.drawn);
    }
    const uploaded = Math.max(this.drawn, indexCount);
    this.drawn = indexCount;
    this.positionBuffer!.update(vertexCount * 8);
    this.colorBuffer!.update(vertexCount * 4);
    this.indexBuffer!.update(uploaded * 4);
    this.mesh!.visible = indexCount > 0;
  }

  /** Appends one polygon, fanned when convex and cut by `earcut` otherwise. */
  private addPolygon(flat: number[], corners: number, packed: number): void {
    const fan = isFanSafe(flat, corners);
    const triangles = fan ? null : earcut(flat, undefined, 2);
    const added = fan ? (corners - 2) * 3 : triangles!.length;
    if (added === 0) {
      return;
    }
    const base = this.vertexCount;
    let indexCount = this.indexCount;
    this.reserve(base + corners, indexCount + added);
    const positions = this.positions;
    const colors = this.colors;
    const indices = this.indices;
    for (let corner = 0; corner < corners; corner += 1) {
      positions[(base + corner) * 2] = flat[corner * 2]!;
      positions[(base + corner) * 2 + 1] = flat[corner * 2 + 1]!;
      colors[base + corner] = packed;
    }
    if (fan) {
      for (let corner = 1; corner < corners - 1; corner += 1) {
        indices[indexCount++] = base;
        indices[indexCount++] = base + corner;
        indices[indexCount++] = base + corner + 1;
      }
    } else {
      for (const index of triangles!) {
        indices[indexCount++] = base + index;
      }
    }
    this.vertexCount = base + corners;
    this.indexCount = indexCount;
  }

  hide(): void {
    if (this.mesh) {
      this.mesh.visible = false;
    }
  }

  /** Makes room, growing the buffers and keeping what was written. */
  private reserve(vertices: number, indices: number): void {
    if (this.mesh && vertices <= this.vertexRoom && indices <= this.indexRoom) {
      return;
    }
    if (!this.mesh) {
      this.make(Math.max(vertices, FIRST_ROOM), Math.max(indices, FIRST_ROOM * 3));
      return;
    }
    if (vertices > this.vertexRoom) {
      const room = Math.max(vertices, this.vertexRoom * 2);
      const positions = new Float32Array(room * 2);
      positions.set(this.positions);
      const colors = new Uint32Array(room);
      colors.set(this.colors);
      this.positions = positions;
      this.colors = colors;
      this.vertexRoom = room;
      this.positionBuffer!.data = positions;
      this.colorBuffer!.data = colors;
    }
    if (indices > this.indexRoom) {
      const room = Math.max(indices, this.indexRoom * 2);
      const grown = new Uint32Array(room);
      grown.set(this.indices);
      this.indices = grown;
      this.indexRoom = room;
      this.indexBuffer!.data = grown;
    }
  }

  private make(vertices: number, indices: number): void {
    this.positions = new Float32Array(vertices * 2);
    this.colors = new Uint32Array(vertices);
    this.indices = new Uint32Array(indices);
    this.vertexRoom = vertices;
    this.indexRoom = indices;
    this.drawn = 0;
    const usage = BufferUsage.VERTEX | BufferUsage.COPY_DST;
    this.positionBuffer = new Buffer({ data: this.positions, usage });
    this.colorBuffer = new Buffer({ data: this.colors, usage });
    this.indexBuffer = new Buffer({ data: this.indices, usage: BufferUsage.INDEX | BufferUsage.COPY_DST });
    const geometry = new Geometry({
      attributes: {
        aPosition: { buffer: this.positionBuffer, format: 'float32x2', stride: 8, offset: 0 },
        aColor: { buffer: this.colorBuffer, format: 'unorm8x4', stride: 4, offset: 0 },
      },
      indexBuffer: this.indexBuffer,
      topology: 'triangle-list',
    });
    const shader = Shader.from({ gl: { vertex: VERTEX, fragment: FRAGMENT }, resources: {} });
    const mesh = new Mesh({ geometry, shader });
    this.parent.addChild(mesh);
    this.mesh = mesh;
  }
}

/** rgb and alpha as the four bytes `unorm8x4` reads: r, g, b, a in memory order. */
function packColor(rgb: number, alpha: number): number {
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255);
  return ((a << 24) | ((rgb & 0xff) << 16) | (rgb & 0xff00) | ((rgb >> 16) & 0xff)) >>> 0;
}
