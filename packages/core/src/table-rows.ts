/**
 * @fileoverview 엔트리 표(데이터 분석)의 자료 줄을 읽는 한 가지 방법입니다.
 *
 * 엔트리는 표를 두 벌로 들고 다닙니다. `data` 는 지금 들고 있는 값이고 `origin` 은
 * 처음 값인데, 정지할 때마다 `data` 를 `origin` 으로 되돌립니다(DataTableSource 의
 * `stop` 처리). 그래서 실행이 보는 것은 언제나 `origin` 입니다. 줄의 모양도 두
 * 가지입니다 — 사이트에 저장된 작품은 줄마다 `{ key, value }` 로, 그렇지 않은 것은
 * 칸 배열로 담습니다.
 */

/** 표 한 줄 — 칸 배열이거나, 줄 번호를 함께 단 모양이거나. */
type RawRow = unknown[] | { value?: unknown } | null | undefined;

/** 표에서 자료 줄만 꺼내 오는 데 필요한 만큼. */
interface RawTable {
  data?: unknown;
  origin?: unknown;
}

/** 한 줄의 칸들. 어느 모양으로 담겨 있든 칸 배열로 돌려줍니다. */
export function tableRowCells(row: RawRow): unknown[] {
  if (Array.isArray(row)) {
    return row;
  }
  const value = (row as { value?: unknown } | null)?.value;
  return Array.isArray(value) ? value : [];
}

/**
 * 표가 실행될 때 들고 있는 자료 줄. 처음 값(`origin`)이 있으면 그것을, 없으면
 * 지금 값(`data`)을 씁니다.
 */
export function tableRows(table: RawTable | null | undefined): unknown[][] {
  const origin = Array.isArray(table?.origin) ? (table.origin as RawRow[]) : [];
  const data = Array.isArray(table?.data) ? (table.data as RawRow[]) : [];
  const rows = origin.length ? origin : data;
  return rows.map((row) => tableRowCells(row));
}
