/**
 * 차트 창(`packages/tessvm/src/web/chart-view.ts`)을 확인합니다.
 *
 * 엔트리도 차트는 캔버스가 아니라 모달로 띄우므로(`DataTable.createChart`), 여기서도
 * HTML 로 올립니다. 브라우저 모듈이라 노드 타입 검사에서 빠져 있어, 다른 브라우저
 * 모듈 테스트와 같은 방식으로 타입만 지운 원본을 jsdom 위에 올립니다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

interface ChartSpec {
  type: string;
  title: string;
  xIndex: number;
  yIndex: number;
  categoryIndexes: number[];
}

interface TableLike {
  name: string;
  fields: string[];
  rows: Array<Array<string | number>>;
  charts: ChartSpec[];
  revision?: number;
}

/** 한 계열짜리 표 하나에 차트 네 가지를 모두 달아 둔 것. */
function sampleTable(): TableLike {
  return {
    name: '판매',
    fields: ['분기', '서울', '부산'],
    rows: [
      ['1분기', 120, 80],
      ['2분기', 90, 140],
      ['3분기', 150, 60],
    ],
    charts: [
      { type: 'bar', title: '막대 차트', xIndex: 0, yIndex: -1, categoryIndexes: [1, 2] },
      { type: 'line', title: '꺾은선 차트', xIndex: 0, yIndex: -1, categoryIndexes: [1, 2] },
      { type: 'pie', title: '원 차트', xIndex: 0, yIndex: 1, categoryIndexes: [] },
      { type: 'scatter', title: '점 차트', xIndex: 1, yIndex: 2, categoryIndexes: [] },
    ],
    revision: 0,
  };
}

/** 차트 창을 jsdom 에 올린다 — 실행 페이지가 무대 옆에 올리는 것과 같은 자리다. */
function mountChart(t: any) {
  const dom = new JSDOM('<!doctype html><body><div id="stage"><div id="frame"></div></div></body>', {
    pretendToBeVisual: true,
  });
  t.after(() => dom.window.close());

  const source = stripTypeScriptTypes(
    fs.readFileSync(path.join(root, 'packages/tessvm/src/web/chart-view.ts'), 'utf-8'),
    { mode: 'strip' },
  );
  const sandbox: Record<string, unknown> = {
    window: dom.window,
    document: dom.window.document,
    getComputedStyle: (element: unknown) => dom.window.getComputedStyle(element as Element),
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(
    `${source.replace(/^export /gm, '')}\n`
      + 'this.mount = mountChartWindow; this.style = CHART_WINDOW_STYLE; this.tickStep = tickStep;',
    sandbox,
  );

  const frame = dom.window.document.getElementById('frame')!;
  const closed: number[] = [];
  const window_ = (sandbox.mount as Function)(frame, () => closed.push(1)) as {
    show(table: TableLike, chart: number): void;
    hide(): void;
    sync(): void;
    dispose(): void;
  };
  const find = (selector: string) => frame.querySelector(selector);
  const all = (selector: string) => Array.from(frame.querySelectorAll(selector));
  return {
    dom, frame, closed, chart: window_, find, all,
    sandbox,
    /** 그림 조각만 — 눈금 선과 글자는 뺀다. */
    marks: (tag: string) => all(`.tessvm-chart-plot ${tag}`),
    press(type: string, on: Element) {
      const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
      on.dispatchEvent(event);
    },
  };
}

test('차트 창은 작품이 담은 글자를 마크업이 아니라 글자로만 넣는다', (t) => {
  const view = mountChart(t);
  const table = sampleTable();
  table.name = '<img src=x onerror="alert(1)">';
  table.fields = ['<b>분기</b>', '서울', '부산'];
  table.charts[0]!.title = '<script>alert(1)</script>';
  view.chart.show(table, 0);

  assert.equal(view.find('img'), null, '이름에 담긴 태그는 태그가 되지 않습니다');
  assert.equal(view.find('script'), null);
  assert.equal(view.find('b'), null);
  assert.equal(view.find('.tessvm-chart-name')!.textContent, '<img src=x onerror="alert(1)">');
  assert.equal(view.find('.tessvm-chart-title')!.textContent, '<script>alert(1)</script>');
  assert.match(view.find('.tessvm-chart-legend')!.textContent ?? '', /<b>분기<\/b>|서울/);
});

test('막대 차트는 줄마다 계열 수만큼 막대를 세운다', (t) => {
  const view = mountChart(t);
  view.chart.show(sampleTable(), 0);

  const bars = view.marks('rect');
  assert.equal(bars.length, 6, '세 줄 × 두 계열');
  // 계열 색은 엔트리가 쓰는 열두 가지의 앞에서부터.
  assert.deepEqual(
    [...new Set(bars.map((bar) => bar.getAttribute('fill')))],
    ['#4f80ff', '#f16670'],
  );
  // 값이 큰 막대가 더 높다.
  const first = bars.filter((bar) => bar.getAttribute('fill') === '#4f80ff');
  assert.ok(
    Number(first[2]!.getAttribute('height')) > Number(first[1]!.getAttribute('height')),
    '150 이 90 보다 높습니다',
  );
  assert.ok(view.marks('line').length >= 2, '눈금 선');
  const ticks = view.all('.tessvm-chart-plot text').map((text) => text.textContent);
  assert.ok(ticks.includes('0') && ticks.includes('150'), `읽히는 눈금: ${ticks.join(',')}`);
  assert.ok(ticks.includes('1분기'), '가로축 이름');
});

test('꺾은선 차트는 계열마다 선을 하나씩 긋는다', (t) => {
  const view = mountChart(t);
  view.chart.show(sampleTable(), 1);

  const lines = view.marks('polyline');
  assert.equal(lines.length, 2);
  assert.equal(lines[0]!.getAttribute('points')!.split(' ').length, 3, '줄마다 꼭짓점 하나');
  assert.equal(lines[0]!.getAttribute('fill'), 'none');
  assert.equal(lines[1]!.getAttribute('stroke'), '#f16670');
  assert.equal(view.marks('circle').length, 6, '꼭짓점마다 점');
  // 양 끝의 가로축 이름은 그림 밖으로 넘지 않도록 안쪽으로 붙인다.
  const ends = view.all('.tessvm-chart-plot text').filter((t) => t.textContent!.endsWith('분기'));
  assert.deepEqual(
    ends.map((text) => [text.textContent, text.getAttribute('text-anchor')]),
    [['1분기', 'start'], ['2분기', 'middle'], ['3분기', 'end']],
  );
});

test('원 차트는 줄마다 다른 색의 부채꼴을 그린다', (t) => {
  const view = mountChart(t);
  view.chart.show(sampleTable(), 2);

  const slices = view.marks('path');
  assert.equal(slices.length, 3);
  assert.deepEqual(
    slices.map((slice) => slice.getAttribute('fill')),
    ['#4f80ff', '#f16670', '#6e5ae6'],
  );
  for (const slice of slices) {
    assert.match(slice.getAttribute('d') ?? '', /^M [\d.-]+ [\d.-]+ L [\d.-]+ [\d.-]+ A /);
  }
  // 조각 위에는 그 몫을 적는다 — 120 · 90 · 150 이면 33% · 25% · 42%.
  const labels = view.all('.tessvm-chart-slice').map((text) => text.textContent);
  assert.deepEqual(labels, ['33%', '25%', '42%']);
  // 계열 표시는 줄 이름으로 — 엔트리가 원 차트에 붙이는 것과 같다.
  assert.equal(view.find('.tessvm-chart-legend')!.textContent, '1분기2분기3분기');
});

test('점 차트는 두 열을 가로·세로로 놓고 점을 찍는다', (t) => {
  const view = mountChart(t);
  view.chart.show(sampleTable(), 3);

  const dots = view.marks('circle');
  assert.equal(dots.length, 3);
  assert.equal(dots[0]!.getAttribute('fill'), '#4f80ff');
  // 서울이 가장 큰 줄(150)이 가장 오른쪽에 찍힌다.
  const xs = dots.map((dot) => Number(dot.getAttribute('cx')));
  assert.ok(xs[2]! > xs[0]! && xs[0]! > xs[1]!, `가로 자리: ${xs.join(',')}`);
  // 가로축도 줄 이름이 아니라 값으로 — 0·50·100·150 처럼 읽히는 수에 적고,
  // 양 끝은 그림 밖으로 넘지 않도록 안쪽으로 붙인다.
  const labels = view.all('.tessvm-chart-plot text:not([dominant-baseline])');
  assert.deepEqual(
    labels.map((text) => [text.textContent, text.getAttribute('text-anchor')]),
    [['0', 'start'], ['50', 'middle'], ['100', 'middle'], ['150', 'end']],
  );
});

test('차트가 둘 이상이면 드롭다운으로 고를 수 있다', (t) => {
  const view = mountChart(t);
  view.chart.show(sampleTable(), 0);

  const pick = view.find('.tessvm-chart-pick') as HTMLSelectElement;
  assert.equal(pick.hidden, false);
  assert.deepEqual(
    Array.from(pick.options).map((option) => option.textContent),
    ['막대 차트', '꺾은선 차트', '원 차트', '점 차트'],
  );
  assert.equal(pick.value, '0');
  assert.equal(view.marks('rect').length, 6, '처음에는 막대 차트');

  pick.value = '2';
  view.press('change', pick);
  assert.equal(view.marks('rect').length, 0);
  assert.equal(view.marks('path').length, 3, '고른 원 차트로 바뀝니다');
  assert.equal(view.find('.tessvm-chart-title')!.textContent, '원 차트');
});

test('차트가 하나뿐인 표에는 드롭다운을 두지 않는다', (t) => {
  const view = mountChart(t);
  const table = sampleTable();
  table.charts = [table.charts[0]!];
  view.chart.show(table, 0);
  assert.equal((view.find('.tessvm-chart-pick') as HTMLSelectElement).hidden, true);
});

test('창을 열 때 고른 차트가 드롭다운에도 그대로 뜬다', (t) => {
  const view = mountChart(t);
  view.chart.show(sampleTable(), 1);
  assert.equal((view.find('.tessvm-chart-pick') as HTMLSelectElement).value, '1');
  assert.equal(view.find('.tessvm-chart-title')!.textContent, '꺾은선 차트');
  // 없는 번호를 부르면 있는 것 중 가까운 쪽으로.
  view.chart.show(sampleTable(), 9);
  assert.equal(view.find('.tessvm-chart-title')!.textContent, '점 차트');
});

test('닫기 단추는 창을 내려 달라고 알린다', (t) => {
  const view = mountChart(t);
  view.chart.show(sampleTable(), 0);
  assert.equal((view.find('.tessvm-chart') as HTMLElement).hidden, false);

  view.press('click', view.find('.tessvm-chart-close')!);
  assert.equal(view.closed.length, 1, '창을 내리는 것은 실행기가 정합니다');

  view.chart.hide();
  assert.equal((view.find('.tessvm-chart') as HTMLElement).hidden, true);
  assert.equal(view.marks('rect').length, 0);
});

/** 엔트리의 모달처럼, 창 위의 누름은 뒤에 있는 무대가 받지 않는다. */
test('창 위의 누름은 무대로 새지 않는다', (t) => {
  const view = mountChart(t);
  view.chart.show(sampleTable(), 0);
  const stage = view.dom.window.document.getElementById('stage')!;
  let heard = 0;
  stage.addEventListener('pointerdown', () => {
    heard += 1;
  });

  view.press('pointerdown', view.find('.tessvm-chart-card')!);
  assert.equal(heard, 0);

  view.chart.hide();
  view.press('pointerdown', stage);
  assert.equal(heard, 1, '창이 내려간 뒤에는 무대가 받습니다');
});

test('열려 있는 동안 표가 바뀌면 다시 그린다', (t) => {
  const view = mountChart(t);
  const table = sampleTable();
  view.chart.show(table, 0);
  assert.equal(view.marks('rect').length, 6);

  view.chart.sync();
  assert.equal(view.marks('rect').length, 6, '바뀐 것이 없으면 그대로 둡니다');

  table.rows.push(['4분기', 200, 30]);
  table.revision = 1;
  view.chart.sync();
  assert.equal(view.marks('rect').length, 8, '늘어난 줄이 따라옵니다');
});

test('그릴 것이 없는 차트는 그렇다고 알린다', (t) => {
  const view = mountChart(t);
  const table = sampleTable();
  table.rows = [];
  view.chart.show(table, 0);
  assert.equal(view.find('.tessvm-chart-empty')!.textContent, '차트로 표현할 수 없습니다.');
  assert.equal(view.marks('rect').length, 0);
});

/** 눈금은 1·2·5 배수로 — 0, 10000, 20000 처럼 읽히는 수에만 선을 긋는다. */
test('눈금 간격은 읽히는 수로 잡는다', (t) => {
  const view = mountChart(t);
  const step = view.sandbox.tickStep as (span: number, count: number) => number;
  assert.equal(step(31234, 4), 10000);
  assert.equal(step(8, 4), 2);
  assert.equal(step(0.4, 4), 0.1);
  assert.equal(step(0, 4), 1, '값이 하나뿐이어도 눈금은 있습니다');
});
