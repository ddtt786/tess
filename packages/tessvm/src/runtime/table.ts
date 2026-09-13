/**
 * @fileoverview 데이터 테이블(엔트리의 '데이터 분석' 블록이 쓰는 표)입니다.
 *
 * 엔트리는 표를 `[필드 이름 줄, 자료 줄…]` 한 덩어리로 다루고 블록은 1부터 세는 행·열
 * 번호로 접근합니다(1행이 필드 이름 줄). 여기서도 그 규칙을 그대로 씁니다.
 */
import { isNumber, num } from './cast.ts';

/** 표 한 줄 — 칸 배열이거나, 사이트가 붙인 줄 번호를 함께 단 모양이거나. */
type RawRow = unknown[] | { value?: unknown } | null | undefined;

/** 작품이 들고 온 표. 실행에 필요한 만큼만 본다. */
interface RawTable {
  id?: unknown;
  name?: unknown;
  fields?: unknown;
  data?: unknown;
  origin?: unknown;
}

/** 어느 모양으로 담겨 있든 칸 배열로. */
function cellsOf(row: RawRow): Array<string | number> {
  const cells = Array.isArray(row) ? row : (row as { value?: unknown } | null)?.value;
  return Array.isArray(cells) ? (cells as Array<string | number>) : [];
}

export class Table {
  readonly id: string;
  readonly name: string;
  fields: string[];
  /** Data rows only; row 0 in block coordinates is `fields`. */
  rows: Array<Array<string | number>>;

  /**
   * 작품이 저장해 둔 표를 실행이 보는 모양으로 읽습니다.
   *
   * 엔트리는 표를 두 벌로 듭니다 — `data` 는 지금 값, `origin` 은 처음 값 — 그리고
   * 정지할 때마다 `data` 를 `origin` 으로 되돌립니다(`DataTableSource` 의 stop 처리).
   * 그래서 실행이 보는 것은 `origin` 이고, 그것이 비어 있을 때만 `data` 입니다.
   */
  static from(raw: RawTable): Table {
    const origin = Array.isArray(raw.origin) ? (raw.origin as RawRow[]) : [];
    const data = Array.isArray(raw.data) ? (raw.data as RawRow[]) : [];
    return new Table(
      String(raw.id ?? ''),
      String(raw.name ?? ''),
      cellsOf(raw.fields as RawRow).map((field) => String(field ?? '')),
      (origin.length ? origin : data).map((row) => cellsOf(row)),
    );
  }

  constructor(id: string, name: string, fields: string[], data: Array<Array<string | number>>) {
    this.id = id;
    this.name = name;
    this.fields = fields.slice();
    this.rows = data.map((row) => row.slice());
  }

  /** Row 1 is the field-name row, so data row `i` sits at index `i + 1`. */
  private rowAt(row: number): Array<string | number> | null {
    if (row === 0) {
      return this.fields;
    }
    return this.rows[row - 1] ?? null;
  }

  getValue(row: number, col: number): string | number | null {
    const target = this.rowAt(row);
    if (!target) {
      return null;
    }
    const value = target[col - 1];
    return value === undefined ? null : value;
  }

  isExist(row: number, col: number): boolean {
    return this.getValue(row, col) !== null;
  }

  replaceValue(row: number, col: number, value: string | number): void {
    const target = this.rowAt(row);
    if (target && col >= 1 && col <= target.length) {
      target[col - 1] = value;
    }
  }

  appendRow(): void {
    this.rows.push(new Array<string>(this.fields.length).fill(''));
  }

  appendCol(): void {
    this.fields.push('');
    for (const row of this.rows) {
      row.push('');
    }
  }

  insertRow(index: number): void {
    const at = Math.max(0, Math.min(this.rows.length, index));
    this.rows.splice(at, 0, new Array<string>(this.fields.length).fill(''));
  }

  insertCol(index: number): void {
    const at = Math.max(0, Math.min(this.fields.length, index - 1));
    this.fields.splice(at, 0, '');
    for (const row of this.rows) {
      row.splice(at, 0, '');
    }
  }

  deleteRow(index: number): void {
    if (index >= 0 && index < this.rows.length) {
      this.rows.splice(index, 1);
    }
  }

  deleteCol(index: number): void {
    const at = index - 1;
    if (at >= 0 && at < this.fields.length) {
      this.fields.splice(at, 1);
      for (const row of this.rows) {
        row.splice(at, 1);
      }
    }
  }

  /** Every value of one column, unparseable entries counted as 0. */
  column(col: number): number[] {
    return this.rows.map((row) => {
      const value = row[col - 1];
      return isNumber(value) ? num(value) : 0;
    });
  }

  /** Pearson correlation between two columns, as `get_coefficient` reports it. */
  coefficient(x: number, y: number): number {
    const left = this.column(x + 1);
    const right = this.column(y + 1);
    const total = Math.min(left.length, right.length);
    if (!total) {
      return 0;
    }
    let sumX = 0;
    let sumY = 0;
    for (let i = 0; i < total; i += 1) {
      sumX += left[i]!;
      sumY += right[i]!;
    }
    const meanX = sumX / total;
    const meanY = sumY / total;
    let covariance = 0;
    let varianceX = 0;
    let varianceY = 0;
    for (let i = 0; i < total; i += 1) {
      const dx = left[i]! - meanX;
      const dy = right[i]! - meanY;
      covariance += dx * dy;
      varianceX += dx * dx;
      varianceY += dy * dy;
    }
    const denominator = Math.sqrt(varianceX * varianceY);
    return denominator === 0 ? 0 : covariance / denominator;
  }
}

/** `DataTable.getColumnIndex` — a number stays a number, letters count base 26. */
export function columnIndex(value: unknown): number {
  if (isNumber(value)) {
    return parseFloat(String(value));
  }
  const text = String(value ?? '');
  if (!text || /[^A-Za-z]|\s/.test(text)) {
    return 0;
  }
  let total = 0;
  for (let i = 0; i < text.length; i += 1) {
    total += (text.toUpperCase().charCodeAt(i) - 64) * Math.pow(26, text.length - i - 1);
  }
  return total;
}

/** `Entry.Utils.cellToRowCol` — `"B3"` is column 2, row 3. */
export function cellToRowCol(cell: string): { row: number; col: number } {
  const match = /^([A-Za-z]+)(\d+)$/.exec(cell.trim());
  if (!match) {
    return { row: 0, col: 0 };
  }
  return { col: columnIndex(match[1]!), row: Number(match[2]) };
}
