/**
 * @fileoverview 붓 채우기 경로를 nonzero 감김 규칙대로 사다리꼴로 자릅니다.
 *
 * 엔트리의 채우기는 createjs 를 거쳐 캔버스의 `ctx.fill()` 로 칠해지므로 **nonzero
 * 감김 규칙**을 따릅니다 — 어떤 자리가 안인지 바깥인지는 외곽선이 그 자리를 몇 번
 * 감았는지로 정해집니다. 가로 왕복과 세로 왕복을 한 경로에 이어 붙이면 겹친 칸의
 * 감김 수가 0 이 되어 체커보드가 나오는데(`examples/ent/3dcheese.ent` 의 바닥판),
 * PIXI 는 폴리곤을 단순 외곽선으로 보고 earcut 으로 삼각분할하므로(`buildPolygon`)
 * 그 경로를 계단 모양으로 뭉갭니다.
 *
 * 그래서 채우기 경로는 여기서 먼저 훑어(scanline) 감김 수가 0 이 아닌 구간만 사다리꼴로
 * 내보냅니다. 스스로 가로지르지 않는 경로는 두 방식의 결과가 같으므로, 이 길을 지나도
 * 모양이 달라지지 않습니다.
 */

/** 훑기를 포기하는 점 개수. 이보다 긴 경로는 원래대로 PIXI 에 넘깁니다. */
const MAX_POINTS = 8192;

/** 같은 자리로 볼 거리. 좌표는 무대 픽셀이라 이 정도면 한 픽셀 한참 아래입니다. */
const EPSILON = 1e-9;

interface Edge {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** 아래로 내려가면 +1, 올라가면 -1 — 감김 수를 세는 방향입니다. */
  dir: number;
}

/**
 * 닫힌 경로의 변. 수평인 변은 어떤 훑는 선과도 만나지 않으므로 빼 둡니다(끝점의 y 는
 * 띠의 경계로 따로 챙깁니다).
 */
function edgesOf(points: number[]): Edge[] {
  const edges: Edge[] = [];
  const count = points.length / 2;
  for (let at = 0; at < count; at += 1) {
    const next = (at + 1) % count;
    const x0 = points[at * 2]!;
    const y0 = points[at * 2 + 1]!;
    const x1 = points[next * 2]!;
    const y1 = points[next * 2 + 1]!;
    if (y0 === y1) continue;
    edges.push({ x0, y0, x1, y1, dir: y1 > y0 ? 1 : -1 });
  }
  return edges;
}

/** 변이 y 를 지나는 자리의 x. 부르는 쪽이 y 가 변 안에 있음을 보장합니다. */
function xAt(edge: Edge, y: number): number {
  return edge.x0 + ((edge.x1 - edge.x0) * (y - edge.y0)) / (edge.y1 - edge.y0);
}

/** 변이 이 띠를 가로지르는가 — 띠 안에서 끊기는 변은 없습니다(경계가 꼭짓점이므로). */
function spans(edge: Edge, top: number, bottom: number): boolean {
  return Math.min(edge.y0, edge.y1) <= top && Math.max(edge.y0, edge.y1) >= bottom;
}

/**
 * 띠의 위아래에서 변의 좌우 차례가 같은가. 곧은 선분끼리는 많아야 한 번 만나므로,
 * 차례가 그대로면 이 띠 안에서 만나는 변이 없습니다 — 짝 맞춰 보는 일을 건너뜁니다.
 */
function keepsOrder(edges: Edge[], top: number, bottom: number): boolean {
  const byTop = edges.map((edge, at) => at).sort((a, b) => xAt(edges[a]!, top) - xAt(edges[b]!, top));
  const byBottom = edges
    .map((edge, at) => at)
    .sort((a, b) => xAt(edges[a]!, bottom) - xAt(edges[b]!, bottom));
  return byTop.every((at, index) => at === byBottom[index]);
}

/** 두 변이 띠 안에서 실제로 만나는 y 들. 끝점만 스치는 경우는 세지 않습니다. */
function crossingsIn(edges: Edge[], top: number, bottom: number): number[] {
  if (keepsOrder(edges, top, bottom)) return [];
  const found: number[] = [];
  for (let a = 0; a < edges.length; a += 1) {
    const first = edges[a]!;
    const ax = first.x1 - first.x0;
    const ay = first.y1 - first.y0;
    for (let b = a + 1; b < edges.length; b += 1) {
      const second = edges[b]!;
      const bx = second.x1 - second.x0;
      const by = second.y1 - second.y0;
      const denominator = ax * by - ay * bx;
      if (Math.abs(denominator) < EPSILON) continue;
      const dx = second.x0 - first.x0;
      const dy = second.y0 - first.y0;
      const t = (dx * by - dy * bx) / denominator;
      const u = (dx * ay - dy * ax) / denominator;
      if (t <= EPSILON || t >= 1 - EPSILON) continue;
      if (u <= EPSILON || u >= 1 - EPSILON) continue;
      const y = first.y0 + ay * t;
      if (y > top + EPSILON && y < bottom - EPSILON) found.push(y);
    }
  }
  return found.sort((a, b) => a - b);
}

/** 한 띠에서 감김 수가 0 이 아닌 구간을 좌우 변 쌍으로 돌려줍니다. */
function insideSpans(edges: Edge[], y: number): { left: Edge; right: Edge }[] {
  const hits = edges.map((edge) => ({ x: xAt(edge, y), edge }));
  hits.sort((a, b) => a.x - b.x);

  const found: { left: Edge; right: Edge }[] = [];
  let winding = 0;
  for (let at = 0; at < hits.length - 1; at += 1) {
    winding += hits[at]!.edge.dir;
    if (winding !== 0) found.push({ left: hits[at]!.edge, right: hits[at + 1]!.edge });
  }
  return found;
}

/**
 * 경로를 nonzero 로 칠한 것과 같은 모양의 사다리꼴 목록. 자를 수 없거나 칠할 것이
 * 없으면 `null` 을 돌려줍니다 — 그때는 부르는 쪽이 경로를 그대로 넘깁니다.
 *
 * @param points `[x, y, x, y, …]` 로 이어진 닫힌 경로
 * @example
 * nonzeroParts([0, 0, 10, 0, 10, 10, 0, 10]); // [[0,0, 10,0, 10,10, 0,10]]
 */
export function nonzeroParts(points: number[]): number[][] | null {
  if (points.length < 6 || points.length > MAX_POINTS * 2) return null;
  const edges = edgesOf(points);
  if (edges.length < 2) return null;

  // 띠의 경계는 모든 꼭짓점의 y — 그 사이에서는 변이 끊기지 않습니다.
  const rows: number[] = [];
  for (let at = 1; at < points.length; at += 2) rows.push(points[at]!);
  rows.sort((a, b) => a - b);

  const parts: number[][] = [];
  for (let at = 0; at < rows.length - 1; at += 1) {
    const top = rows[at]!;
    const bottom = rows[at + 1]!;
    if (bottom - top < EPSILON) continue;
    const crossing = edges.filter((edge) => spans(edge, top, bottom));
    if (crossing.length === 0) continue;

    // 띠 안에서 변끼리 만나면 좌우 차례가 그 자리에서 바뀌므로, 만나는 높이마다 띠를
    // 한 번 더 자릅니다. 그러고 나면 한 구간이 사다리꼴 하나로 떨어집니다.
    const cuts = [top, ...crossingsIn(crossing, top, bottom), bottom];
    for (let cut = 0; cut < cuts.length - 1; cut += 1) {
      const from = cuts[cut]!;
      const to = cuts[cut + 1]!;
      if (to - from < EPSILON) continue;
      for (const span of insideSpans(crossing, (from + to) / 2)) {
        parts.push([
          xAt(span.left, from), from,
          xAt(span.right, from), from,
          xAt(span.right, to), to,
          xAt(span.left, to), to,
        ]);
      }
    }
  }
  return parts.length > 0 ? parts : null;
}

/**
 * 이 채우기 경로를 PIXI 에 넘기기 전에 잘라야 하는가. 엔트리에서 부스트 모드는 **WebGL
 * 렌더러를 고르는 스위치**이고(`Entry.setBasicPaint` 의 `GEHelper.isWebGL`), 그 쪽은
 * 채우기를 PIXI 로 칠하므로 자기교차 경로를 여기와 같은 자리에서 같게 뭉갭니다. 그래서
 * 부스트 모드에서는 자르지 않고 그대로 넘깁니다.
 *
 * @example
 * fillParts([0, 0, 20, 20, 20, 0, 0, 20], true); // null — 부스트 모드는 PIXI 그대로
 */
export function fillParts(points: number[], boost: boolean): number[][] | null {
  return boost ? null : nonzeroParts(points);
}
