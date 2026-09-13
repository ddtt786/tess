/**
 * @fileoverview 차트 창 — 표에 딸린 차트를 무대 위에 띄웁니다.
 *
 * 엔트리도 차트는 캔버스가 아니라 모달(`DataTable.createChart` 가 만드는
 * `entry-table-chart`)로 띄웁니다. 여기서도 같은 자리에 HTML 로 올립니다 — 글자가
 * 또렷하고, 차트를 고르는 드롭다운처럼 손이 닿는 것을 그대로 쓸 수 있습니다.
 *
 * 작품이 담은 글자(표 이름·차트 제목·열 이름·칸 값)는 모두 `textContent` 로만 들어가고
 * 그림은 우리가 낸 수치로만 그립니다 — 마크업으로 읽히는 자리가 없습니다.
 */
import type { ChartLike, TableLike } from '../render/overlay.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** 엔트리가 계열에 쓰는 열두 가지 색. */
const COLORS = [
  '#4f80ff', '#f16670', '#6e5ae6', '#00b6b1', '#9fbaff', '#fcad93',
  '#c5b4ff', '#b3c3cd', '#2d51ac', '#a23941', '#423496', '#2a7d7f',
];
const GRID = '#e4e6eb';
const ZERO_LINE = '#c8ccd4';
/** 세로축에 긋는 눈금 수의 어림값 — 간격은 1·2·5 배수로 맞춰 잡습니다. */
const TICKS = 4;
/** 가로축 이름 한 칸이 차지하는 폭, 글자 크기의 배수. */
const LABEL_ROOM = 3.4;
/** 줄이 이만큼 넘어가면 꺾은선의 점은 생략합니다. */
const DOT_LIMIT = 40;
/** 이름을 얹을 만큼 큰 원 차트 조각. */
const SLICE_LABEL = 0.35;

/** 창을 잴 수 없을 때(아직 자리를 잡지 않았을 때) 쓰는 크기, 글자 크기의 배수. */
const FALLBACK_WIDTH = 30;
const FALLBACK_HEIGHT = 13;

/** `images/btn_close.svg` — 창 오른쪽 위의 닫기 단추. */
const CLOSE_ICON =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" ' +
  'stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"/></svg>';

export const CHART_WINDOW_STYLE = `
.tessvm-chart {
  --chart-unit: calc(var(--tessvm-stage-width, 640px) / 640);
  position: absolute;
  inset: 0;
  z-index: 3;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0;
  padding: calc(var(--chart-unit) * 16);
  background: #14161a52;
  color-scheme: light;
  color: #16151a;
  font-family: 'Nanum Gothic', sans-serif;
  font-size: calc(var(--chart-unit) * 14);
  line-height: 1.4;
  text-align: left;
}

.tessvm-chart[hidden] { display: none !important; }
.tessvm-chart * { box-sizing: border-box; }

.tessvm-chart .tessvm-chart-card {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: #fff;
  border-radius: calc(var(--chart-unit) * 12);
  box-shadow: 0 calc(var(--chart-unit) * 10) calc(var(--chart-unit) * 34) #00000038;
}

.tessvm-chart .tessvm-chart-head {
  flex: none;
  display: flex;
  align-items: center;
  gap: 0.5em;
  padding: 0.5em 0.5em 0.5em 1em;
  border-bottom: 1px solid #e6e8ec;
}

.tessvm-chart .tessvm-chart-name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 1.05em;
  font-weight: 700;
}

.tessvm-chart .tessvm-chart-pick {
  flex: none;
  max-width: 45%;
  margin: 0;
  padding: 0.3em 1.9em 0.3em 0.7em;
  font: inherit;
  font-size: 0.9em;
  color: inherit;
  background-color: #fff;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%23767b85' stroke-width='1.4' stroke-linecap='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 0.7em center;
  background-size: 0.7em;
  border: 1px solid #d9dce2;
  border-radius: 0.45em;
  appearance: none;
  cursor: pointer;
}

.tessvm-chart .tessvm-chart-pick:hover { border-color: #b9bec7; }
.tessvm-chart .tessvm-chart-pick[hidden] { display: none !important; }

.tessvm-chart .tessvm-chart-close {
  flex: none;
  display: grid;
  place-items: center;
  width: 1.9em;
  height: 1.9em;
  padding: 0;
  color: #767b85;
  background: none;
  border: 0;
  border-radius: 0.45em;
  cursor: pointer;
  line-height: 0;
}

.tessvm-chart .tessvm-chart-close:hover { color: #16151a; background: #f2f4f7; }
.tessvm-chart .tessvm-chart-close svg { width: 1em; height: 1em; }

.tessvm-chart .tessvm-chart-body {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 0.7em 1em 0.9em;
}

.tessvm-chart .tessvm-chart-title {
  flex: none;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-weight: 700;
}

.tessvm-chart .tessvm-chart-axis {
  flex: none;
  display: flex;
  flex-wrap: wrap;
  gap: 0 1.2em;
  margin-top: 0.1em;
  font-size: 0.85em;
  color: #8b909a;
}

.tessvm-chart .tessvm-chart-legend {
  flex: none;
  display: flex;
  flex-wrap: wrap;
  gap: 0.2em 0.9em;
  margin: 0.5em 0 0.2em;
  padding: 0;
  list-style: none;
  font-size: 0.85em;
}

.tessvm-chart .tessvm-chart-legend li { display: flex; align-items: center; gap: 0.4em; }

.tessvm-chart .tessvm-chart-legend i {
  width: 0.75em;
  height: 0.75em;
  border-radius: 0.2em;
}

.tessvm-chart .tessvm-chart-plot {
  flex: 1 1 auto;
  width: 100%;
  min-height: 0;
  display: block;
  overflow: visible;
}

.tessvm-chart .tessvm-chart-plot text { fill: #8b909a; font-size: 0.8em; }
.tessvm-chart .tessvm-chart-plot text.tessvm-chart-slice { fill: #fff; font-size: 0.82em; font-weight: 700; }
.tessvm-chart .tessvm-chart-plot[hidden] { display: none !important; }

.tessvm-chart .tessvm-chart-empty {
  flex: 1 1 auto;
  display: grid;
  place-items: center;
  color: #8b909a;
}

.tessvm-chart .tessvm-chart-empty[hidden] { display: none !important; }
`;

export interface ChartWindow {
  /** 표 하나의 차트 한 벌을 띄웁니다. 번호는 엔트리처럼 0부터 셉니다. */
  show(table: TableLike, chart: number): void;
  hide(): void;
  /** 열려 있는 동안 표가 바뀌었으면 다시 그립니다. */
  sync(): void;
  dispose(): void;
}

/** 창 안의 글자 크기(픽셀). 창이 없는 자리에서는 기본값으로 둡니다. */
function unitOf(element: HTMLElement): number {
  const size = typeof getComputedStyle === 'function'
    ? parseFloat(getComputedStyle(element).fontSize)
    : Number.NaN;
  return Number.isFinite(size) && size > 0 ? size : 14;
}

function node<K extends keyof HTMLElementTagNameMap>(
  parent: HTMLElement,
  tag: K,
  className: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = className;
  parent.appendChild(element);
  return element;
}

/** 그림 조각 하나. 값은 모두 우리가 낸 수치이거나 우리가 고른 색입니다. */
function shape(tag: string, attributes: Record<string, string | number>): SVGElement {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attributes)) {
    element.setAttribute(key, String(value));
  }
  return element;
}

/** SVG 에는 `hidden` 속성이 없으므로 속성으로 여닫습니다 — 모양은 CSS 가 냅니다. */
function reveal(element: SVGElement, shown: boolean): void {
  if (shown) {
    element.removeAttribute('hidden');
  } else {
    element.setAttribute('hidden', '');
  }
}

/** 좌표는 소수점 두 자리까지 — 그림은 그대로이고 속성 글자는 짧아집니다. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * 눈금 간격 — 1·2·5 에 10의 거듭제곱을 곱한 수 중에서 고릅니다. 차트가 늘 읽히는 수에
 * 선을 긋도록 하는, 어느 차트나 쓰는 방법입니다.
 */
export function tickStep(span: number, count: number): number {
  const rough = Math.abs(span) / Math.max(count, 1);
  if (!Number.isFinite(rough) || rough <= 0) {
    return 1;
  }
  const power = 10 ** Math.floor(Math.log10(rough));
  for (const step of [1, 2, 5]) {
    if (rough <= step * power) {
      return step * power;
    }
  }
  return 10 * power;
}

/** 눈금에 적는 숫자. 소수점이 길어지지 않도록 자릅니다. */
export function tickLabel(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

/** 차트가 쓰는 계열들. 계열이 따로 없으면 세로축 하나를 계열로 삼습니다. */
function seriesOf(chart: ChartLike): number[] {
  if (chart.categoryIndexes.length) {
    return chart.categoryIndexes;
  }
  return chart.yIndex >= 0 ? [chart.yIndex] : [];
}

/**
 * 차트 창을 `parent` 에 올립니다. 닫기 단추는 `onClose` 를 부를 뿐이므로, 창을 내리는
 * 것은 부른 쪽(엔트리에서는 실행기)이 정합니다.
 */
export function mountChartWindow(parent: HTMLElement, onClose: () => void): ChartWindow {
  const root = document.createElement('div');
  root.className = 'tessvm-chart';
  root.hidden = true;
  const card = node(root, 'div', 'tessvm-chart-card');
  const head = node(card, 'div', 'tessvm-chart-head');
  const name = node(head, 'span', 'tessvm-chart-name');
  const pick = node(head, 'select', 'tessvm-chart-pick');
  pick.title = '차트 고르기';
  pick.setAttribute('aria-label', '차트 고르기');
  const close = node(head, 'button', 'tessvm-chart-close');
  close.type = 'button';
  close.title = '닫기';
  close.setAttribute('aria-label', '닫기');
  close.innerHTML = CLOSE_ICON;
  const body = node(card, 'div', 'tessvm-chart-body');
  const title = node(body, 'div', 'tessvm-chart-title');
  const axis = node(body, 'div', 'tessvm-chart-axis');
  const legend = node(body, 'ul', 'tessvm-chart-legend');
  const plot = document.createElementNS(SVG_NS, 'svg');
  plot.setAttribute('class', 'tessvm-chart-plot');
  body.appendChild(plot);
  const empty = node(body, 'div', 'tessvm-chart-empty');
  empty.hidden = true;
  parent.appendChild(root);

  let table: TableLike | null = null;
  let at = 0;
  /** 마지막으로 그린 표의 상태 — 표가 바뀌면 다시 그립니다. */
  let drawn = '';

  close.addEventListener('click', (event) => {
    event.preventDefault();
    onClose();
  });
  pick.addEventListener('change', () => {
    at = Number(pick.value) || 0;
    draw();
  });
  // 창 위에서 일어난 것은 창의 것입니다 — 엔트리의 모달이 그렇듯, 뒤의 무대는 이
  // 누름을 받지 않습니다.
  const swallow = (event: Event) => event.stopPropagation();
  const SWALLOWED = ['pointerdown', 'pointerup', 'pointermove', 'click', 'wheel'];
  for (const type of SWALLOWED) {
    root.addEventListener(type, swallow);
  }

  const watch = typeof ResizeObserver === 'undefined'
    ? null
    : new ResizeObserver(() => {
      if (!root.hidden) {
        draw();
      }
    });
  watch?.observe(body);

  /** 표에 담긴 것이 바뀌었는지 보는 자국. */
  const mark = (): string =>
    `${at}/${table?.revision ?? 0}/${table?.rows.length ?? 0}/${table?.fields.length ?? 0}`;

  function fill(list: Array<{ text: string; color: string }>): void {
    legend.replaceChildren();
    for (const item of list) {
      const row = document.createElement('li');
      const chip = document.createElement('i');
      chip.style.background = item.color;
      const text = document.createElement('span');
      text.textContent = item.text;
      row.append(chip, text);
      legend.appendChild(row);
    }
  }

  /** 창 크기. 아직 자리를 잡지 않았으면 글자 크기로 어림잡습니다. */
  function measure(): { em: number; width: number; height: number } {
    const em = unitOf(root);
    const box = plot.getBoundingClientRect();
    return {
      em,
      width: Math.round(box.width) || Math.round(em * FALLBACK_WIDTH),
      height: Math.round(box.height) || Math.round(em * FALLBACK_HEIGHT),
    };
  }

  function draw(): void {
    const spec = table?.charts?.[at] ?? null;
    if (!table || !spec) {
      return;
    }
    drawn = mark();
    const field = (index: number) => String(table?.fields[index] ?? '');
    const series = seriesOf(spec);
    name.textContent = table.name || '차트 보기';
    title.textContent = spec.title || field(spec.xIndex);

    // 엔트리가 제목 아래에 적어 두는 축 요약 — `가로축 일자` · `계열 신규 확진자 외 1건`.
    const summary = [`가로축 ${field(spec.xIndex)}`];
    if (series.length) {
      const rest = series.length > 1 ? ` 외 ${series.length - 1}건` : '';
      summary.push(`${spec.categoryIndexes.length ? '계열' : '세로축'} ${field(series[0]!)}${rest}`);
    }
    axis.replaceChildren();
    for (const line of summary) {
      const part = document.createElement('span');
      part.textContent = line;
      axis.appendChild(part);
    }

    plot.replaceChildren();
    const drawable = series.length > 0 && table.rows.length > 0;
    reveal(plot, drawable);
    empty.hidden = drawable;
    if (!drawable) {
      fill([]);
      empty.textContent = '차트로 표현할 수 없습니다.';
      return;
    }

    const size = measure();
    plot.setAttribute('viewBox', `0 0 ${size.width} ${size.height}`);
    if (spec.type === 'pie') {
      drawPie(table, spec, series[0]!, size);
    } else {
      drawAxisChart(table, spec, series, size);
    }
  }

  /** 막대·꺾은선·점 차트 — 가로축은 줄, 세로축은 값입니다. */
  function drawAxisChart(
    source: TableLike,
    spec: ChartLike,
    series: number[],
    size: { em: number; width: number; height: number },
  ): void {
    fill(series.map((column, index) => ({
      text: String(source.fields[column] ?? ''),
      color: COLORS[index % COLORS.length]!,
    })));

    const numbers = (index: number) =>
      source.rows.map((row) => Number(row[index] ?? 0) || 0);
    const columns = series.map((column) => numbers(column));
    const values = columns.flat();
    const step = tickStep(Math.max(...values, 0) - Math.min(0, ...values), TICKS);
    const low = Math.floor(Math.min(0, ...values) / step) * step;
    const high = Math.max(Math.ceil(Math.max(...values, 0) / step) * step, low + step);

    // 왼쪽은 눈금 글자가 들어갈 만큼만 비웁니다.
    const marks: number[] = [];
    for (let value = low; value <= high + step / 2; value += step) {
      marks.push(value);
    }
    const widest = marks.reduce((most, value) => Math.max(most, tickLabel(value).length), 1);
    const pad = {
      left: size.em * (0.6 + widest * 0.5),
      right: size.em * 0.9,
      top: size.em * 0.7,
      bottom: size.em * 1.9,
    };
    const plotWidth = Math.max(size.em, size.width - pad.left - pad.right);
    const plotHeight = Math.max(size.em, size.height - pad.top - pad.bottom);
    const atY = (value: number) =>
      pad.top + plotHeight - ((value - low) / (high - low)) * plotHeight;

    for (const value of marks) {
      const y = round(atY(value));
      plot.appendChild(shape('line', {
        x1: round(pad.left), y1: y, x2: round(pad.left + plotWidth), y2: y,
        stroke: value === 0 ? ZERO_LINE : GRID, 'stroke-width': 1,
      }));
      const label = shape('text', {
        x: round(pad.left - size.em * 0.4), y, 'text-anchor': 'end', 'dominant-baseline': 'central',
      });
      label.textContent = tickLabel(value);
      plot.appendChild(label);
    }

    const rows = source.rows.length;
    const scatter = spec.type === 'scatter';
    // 점 차트의 가로는 줄 번호가 아니라 값입니다.
    const xs = scatter ? numbers(spec.xIndex) : [];
    const lowX = scatter ? Math.min(...xs, 0) : 0;
    const highX = scatter ? Math.max(Math.max(...xs), lowX + 1) : 1;
    const slot = plotWidth / Math.max(rows, 1);
    const line = (row: number) => (rows > 1 ? pad.left + (plotWidth * row) / (rows - 1) : pad.left + plotWidth / 2);

    if (spec.type === 'bar') {
      // 한 줄이 쥔 자리를 계열 수만큼 나눠 나란히 세웁니다.
      const group = slot * 0.72;
      const barWidth = Math.max(1, group / series.length);
      const base = atY(Math.max(low, 0));
      columns.forEach((column, index) => {
        const color = COLORS[index % COLORS.length]!;
        column.forEach((value, row) => {
          const top = atY(value);
          const height = Math.abs(base - top);
          plot.appendChild(shape('rect', {
            x: round(pad.left + slot * row + (slot - group) / 2 + barWidth * index),
            y: round(Math.min(base, top)),
            width: round(barWidth),
            height: round(Math.max(height, value === 0 ? 0 : 1)),
            rx: round(Math.min(size.em * 0.15, barWidth / 3)),
            fill: color,
          }));
        });
      });
    } else if (scatter) {
      columns.forEach((column, index) => {
        const color = COLORS[index % COLORS.length]!;
        column.forEach((value, row) => {
          plot.appendChild(shape('circle', {
            cx: round(pad.left + ((xs[row]! - lowX) / (highX - lowX)) * plotWidth),
            cy: round(atY(value)),
            r: round(size.em * 0.26),
            fill: color,
            'fill-opacity': 0.85,
          }));
        });
      });
    } else {
      columns.forEach((column, index) => {
        const color = COLORS[index % COLORS.length]!;
        const points = column
          .map((value, row) => `${round(line(row))},${round(atY(value))}`)
          .join(' ');
        plot.appendChild(shape('polyline', {
          points, fill: 'none', stroke: color, 'stroke-width': round(size.em * 0.14),
          'stroke-linejoin': 'round', 'stroke-linecap': 'round',
        }));
        if (rows <= DOT_LIMIT) {
          column.forEach((value, row) => {
            plot.appendChild(shape('circle', {
              cx: round(line(row)), cy: round(atY(value)),
              r: round(size.em * 0.19), fill: color,
            }));
          });
        }
      });
    }

    const baseline = pad.top + plotHeight + size.em * 1.1;
    const write = (x: number, anchor: string, text: string) => {
      const label = shape('text', { x: round(x), y: round(baseline), 'text-anchor': anchor });
      label.textContent = text;
      plot.appendChild(label);
    };
    if (scatter) {
      // 점 차트의 가로축은 줄 이름이 아니라 값이므로, 세로축처럼 눈금을 놓습니다.
      const across = tickStep(highX - lowX, TICKS);
      for (let value = Math.ceil(lowX / across) * across; value <= highX + across / 2; value += across) {
        // 양 끝의 눈금은 그림 밖으로 넘지 않도록 안쪽으로 붙입니다.
        const first = value - across < lowX;
        const last = value + across > highX;
        write(
          pad.left + ((value - lowX) / (highX - lowX)) * plotWidth,
          first ? 'start' : last ? 'end' : 'middle',
          tickLabel(value),
        );
      }
      return;
    }
    // 가로축 이름 — 자리가 나는 만큼만 띄엄띄엄 적습니다.
    const every = Math.max(1, Math.ceil((rows * size.em * LABEL_ROOM) / plotWidth));
    const bar = spec.type === 'bar';
    source.rows.forEach((row, index) => {
      if (index % every !== 0) {
        return;
      }
      // 양 끝의 이름은 그림 밖으로 넘지 않도록 안쪽으로 붙입니다.
      const anchor = bar || (index > 0 && index < rows - 1)
        ? 'middle'
        : index === 0 ? 'start' : 'end';
      write(bar ? pad.left + slot * index + slot / 2 : line(index), anchor, String(row[spec.xIndex] ?? ''));
    });
  }

  /** 원 차트 — 값이 차지하는 만큼 부채꼴을 돌립니다. */
  function drawPie(
    source: TableLike,
    spec: ChartLike,
    column: number,
    size: { em: number; width: number; height: number },
  ): void {
    const values = source.rows.map((row) => Math.max(0, Number(row[column] ?? 0) || 0));
    const total = values.reduce((sum, value) => sum + value, 0);
    fill(source.rows.map((row, index) => ({
      text: String(row[spec.xIndex] ?? ''),
      color: COLORS[index % COLORS.length]!,
    })));
    if (total <= 0) {
      reveal(plot, false);
      empty.hidden = false;
      empty.textContent = '차트로 표현할 수 없습니다.';
      return;
    }

    const radius = Math.max(size.em, Math.min(size.width, size.height) / 2 - size.em * 0.6);
    const centreX = size.width / 2;
    const centreY = size.height / 2;
    let from = -Math.PI / 2;
    values.forEach((value, row) => {
      const sweep = (value / total) * Math.PI * 2;
      const color = COLORS[row % COLORS.length]!;
      if (sweep >= Math.PI * 2 - 1e-6) {
        plot.appendChild(shape('circle', {
          cx: round(centreX), cy: round(centreY), r: round(radius), fill: color,
        }));
      } else if (sweep > 0) {
        const to = from + sweep;
        plot.appendChild(shape('path', {
          d: `M ${round(centreX)} ${round(centreY)}`
            + ` L ${round(centreX + Math.cos(from) * radius)} ${round(centreY + Math.sin(from) * radius)}`
            + ` A ${round(radius)} ${round(radius)} 0 ${sweep > Math.PI ? 1 : 0} 1`
            + ` ${round(centreX + Math.cos(to) * radius)} ${round(centreY + Math.sin(to) * radius)} Z`,
          fill: color, stroke: '#fff', 'stroke-width': 1.5, 'stroke-linejoin': 'round',
        }));
      }
      // 조각이 이름을 담을 만큼 클 때만 몫을 얹습니다.
      if (sweep > SLICE_LABEL) {
        const middle = from + sweep / 2;
        const label = shape('text', {
          x: round(centreX + Math.cos(middle) * radius * 0.62),
          y: round(centreY + Math.sin(middle) * radius * 0.62),
          'text-anchor': 'middle', 'dominant-baseline': 'central',
          class: 'tessvm-chart-slice',
        });
        label.textContent = `${Math.round((value / total) * 100)}%`;
        plot.appendChild(label);
      }
      from += sweep;
    });
  }

  return {
    show(next: TableLike, chart: number): void {
      const charts = next.charts ?? [];
      const wanted = Math.max(0, Math.min(charts.length - 1, Math.floor(chart) || 0));
      table = next;
      at = wanted;
      // 드롭다운은 차트가 둘 이상일 때만 — 하나뿐이면 고를 것이 없습니다.
      pick.hidden = charts.length < 2;
      pick.replaceChildren();
      charts.forEach((spec, index) => {
        const option = document.createElement('option');
        option.value = String(index);
        option.textContent = spec.title || `차트 ${index + 1}`;
        pick.appendChild(option);
      });
      pick.value = String(wanted);
      root.hidden = false;
      draw();
    },
    hide(): void {
      root.hidden = true;
      table = null;
      plot.replaceChildren();
      legend.replaceChildren();
    },
    sync(): void {
      if (!root.hidden && table && mark() !== drawn) {
        draw();
      }
    },
    dispose(): void {
      watch?.disconnect();
      for (const type of SWALLOWED) {
        root.removeEventListener(type, swallow);
      }
      root.remove();
    },
  };
}
