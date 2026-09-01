// ============================================================================
//  CLI 출력
//
//  단계는 끝나는 대로 한 줄씩 바로 찍는다. 큰 작품은 컴파일에 1초쯤 걸리는데,
//  다 끝난 뒤에 표를 한꺼번에 보여 주면 그동안 멈춘 것처럼 보이기 때문이다.
// ============================================================================
import process from 'node:process';
import path from 'node:path';
import {
  S_BAR, S_ERROR, S_STEP_SUBMIT, intro, log, note, outro,
} from '@clack/prompts';
import type { CompileDiagnostic, PhaseTiming } from '@tess/compiler';

// clack 이 제 기호에 색을 입히는 기준과 같게 맞춘다.
const COLORED = (() => {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR) return true;
  return Boolean(process.stdout.isTTY) && process.env.TERM !== 'dumb';
})();

const wrap = (open: number, close: number) => (text: unknown) => (
  COLORED ? `\u001b[${open}m${text}\u001b[${close}m` : String(text)
);

export const dim = wrap(2, 22);
export const bold = wrap(1, 22);
export const red = wrap(31, 39);
export const yellow = wrap(33, 39);
export const green = wrap(32, 39);
export const cyan = wrap(36, 39);
export const grey = wrap(90, 39);

// 한글·한자는 터미널에서 두 칸을 차지한다. 글자 수로 맞추면 칸이 어긋난다.
const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹯＀-｠￠-￦]/;

/** 터미널에서 이 글자열이 차지하는 칸 수 */
export function displayWidth(text: unknown): number {
  let width = 0;
  for (const ch of String(text)) width += WIDE.test(ch) ? 2 : 1;
  return width;
}

const padTo = (text: string, width: number) => text + ' '.repeat(Math.max(0, width - displayWidth(text)));

/** 사람이 읽는 시간. 1초가 넘으면 초로 보여 준다. */
export function duration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

const STEP_LABEL_WIDTH = 18;

/** 명령 하나를 시작한다 */
export function begin(command: string, file: string) {
  intro(`${bold(cyan('tess'))} ${command}${file ? ` ${dim(path.basename(file))}` : ''}`);
}

/**
 * 끝난 단계를 한 줄로. 시간이 세로로 맞도록 라벨 폭을 맞춘다.
 *
 * clack 의 `log.step` 은 줄마다 빈 줄을 끼워 넣어서 단계가 예닐곱 개만 돼도 화면을
 * 꽉 채운다. 세로 획은 그대로 두고 줄만 붙여서 직접 찍는다.
 */
export function step({ label, ms }: PhaseTiming) {
  process.stdout.write(`${stepLine(green(S_STEP_SUBMIT), timed(label, ms))}\n`);
}

const FRAMES = ['◒', '◐', '◓', '◑'];
const ANIMATED = COLORED && Boolean(process.stdout.isTTY);

const stepLine = (symbol: string, text: string) => `${grey(S_BAR)}  ${symbol}  ${text}`;
const timed = (label: string, ms: number) => `${padTo(label, STEP_LABEL_WIDTH)} ${dim(duration(ms).padStart(6))}`;

/**
 * 오래 걸리는 일 하나. 터미널이면 제자리에서 돌다가, 끝나면 다른 단계와 똑같은
 * 모양의 한 줄로 바뀐다. 파이프로 넘길 때는 돌지 않고 끝난 줄만 남는다.
 */
export function working(title: string) {
  const started = performance.now();
  let frame = 0;
  const paint = () => {
    process.stdout.write(`\r${stepLine(cyan(FRAMES[frame % FRAMES.length]), title)}`);
    frame += 1;
  };
  const spin = ANIMATED ? setInterval(paint, 120) : null;
  if (ANIMATED) paint();

  const finish = (symbol: string, text: string) => {
    if (spin) {
      clearInterval(spin);
      process.stdout.write('\r\u001b[K');
    }
    process.stdout.write(`${stepLine(symbol, text)}\n`);
  };
  return {
    done: (label: string) => finish(green(S_STEP_SUBMIT), timed(label, performance.now() - started)),
    fail: (message: string) => finish(red(S_ERROR), message),
  };
}

export { log, note, outro };

/**
 * 진단 하나를 사람이 읽게 찍는다.
 *
 * 위치는 `파일:줄:칸` 한 줄로 먼저 내고(편집기·터미널이 눌러서 열 수 있는 모양이다),
 * 파서가 코드 프레임을 붙여 줬으면 그 아래에 그대로 보여 준다.
 */
function diagnostic(label: string, item: CompileDiagnostic): string {
  const where = item.file && item.file !== label ? path.basename(item.file) : label;
  const head = `${cyan(`${where}:${item.line}:${item.column}`)}  ${item.message}`;
  return item.detail ? `${head}\n${dim(item.detail)}` : head;
}

/** 한 번에 보여 주는 진단 개수. 넘치면 세어서만 알려 준다. */
const MAX_SHOWN = 8;

/** 에러·경고 묶음을 찍는다 */
export function report(label: string, diagnostics: CompileDiagnostic[], kind: '에러' | '경고') {
  if (diagnostics.length === 0) return;

  const isError = kind === '에러';
  const paint = isError ? red : yellow;
  const shown = diagnostics.slice(0, MAX_SHOWN);
  const lines = [
    paint(`${kind} ${diagnostics.length}개`),
    ...shown.map((item) => diagnostic(label, item)),
  ];
  if (diagnostics.length > shown.length) {
    lines.push(dim(`… 외 ${diagnostics.length - shown.length}개`));
  }
  (isError ? log.error : log.warn)(lines.join('\n'));
}

/** `이름  값` 목록을 가지런히 */
export function details(rows: Array<[string, string]>): string {
  const width = Math.max(...rows.map(([name]) => displayWidth(name)));
  return rows.map(([name, value]) => `${dim(padTo(name, width))}  ${value}`).join('\n');
}
