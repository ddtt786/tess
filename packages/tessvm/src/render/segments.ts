/**
 * @fileoverview 점 두 개짜리 붓 획 무리를 사각형 메시 하나로 그립니다.
 *
 * `Graphics` 는 획을 받을 때마다 경로를 쌓고, 그릴 때 그 경로를 삼각형으로 다시
 * 자릅니다. 한 프레임에 선분 수천 개를 새로 긋는 작품에서는 그 자르기가 프레임의
 * 대부분을 차지합니다. 선분 하나는 자를 것이 없는 사각형 하나이므로, 여기서는 꼭짓점을
 * 직접 계산해 **다시 쓰는 버퍼**에 써 넣고 한 번에 넘깁니다.
 *
 * 끝은 각지고(`butt`) 이음매가 없으므로, **점이 정확히 두 개인 획**에만 씁니다 —
 * 그보다 긴 획은 모서리에서 엔트리의 `miter` 이음매를 따라야 하므로 `Graphics` 가
 * 계속 맡습니다.
 */
import { Mesh, MeshGeometry, Texture, type Container } from 'pixi.js';
import type { Stroke } from '../runtime/model.ts';
import { quadIndices, writeQuads } from './segment-geometry.ts';

/** Below this many segments the mesh costs more than the path it replaces. */
export const SEGMENT_FLOOR = 16;

/** Room the first buffer is made with, so a growing pen stops re-making it. */
const FIRST_ROOM = 256;

export { isSegment } from './segment-geometry.ts';

export class SegmentBatch {
  private readonly parent: Container;
  private mesh: Mesh | null = null;
  private positions: Float32Array = new Float32Array(0);
  private room = 0;
  private drawn = 0;

  constructor(parent: Container) {
    this.parent = parent;
  }

  /**
   * Lays `pieces[from…to)` down as one quad each. The stroke's own y is flipped
   * on the way in, the way the path `traceFlipped` does it. Anything shorter
   * than two points draws nothing and is stepped over.
   */
  set(
    pieces: Stroke[],
    from: number,
    to: number,
    thickness: number,
    color: number,
    alpha: number,
  ): void {
    if (to - from > this.room) {
      this.remake(to - from);
    }
    const positions = this.positions;
    const count = writeQuads(pieces, from, to, thickness, positions);
    // Corners left over from a longer frame are folded onto one point, which
    // covers nothing; only the stretch that was used last time needs clearing.
    if (this.drawn > count) {
      positions.fill(0, count * 8, this.drawn * 8);
    }
    this.drawn = count;
    const mesh = this.mesh!;
    mesh.geometry.getBuffer('aPosition').update();
    mesh.tint = color;
    mesh.alpha = alpha;
    mesh.visible = true;
  }

  hide(): void {
    if (this.mesh) {
      this.mesh.visible = false;
    }
  }

  /** Makes a bigger mesh. The old one goes whole, geometry and all. */
  private remake(count: number): void {
    const room = Math.max(count, this.room * 2, FIRST_ROOM);
    const positions = new Float32Array(room * 8);
    const uvs = new Float32Array(room * 8);
    const indices = quadIndices(room);
    const mesh = new Mesh({
      geometry: new MeshGeometry({ positions, uvs, indices }),
      texture: Texture.WHITE,
    });
    this.mesh?.destroy({ children: true });
    this.parent.addChild(mesh);
    this.mesh = mesh;
    this.positions = positions;
    this.room = room;
    this.drawn = 0;
  }
}
