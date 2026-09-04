/**
 * @fileoverview CLI 콘솔 출력을 담당하는 유틸리티.
 */
import process from 'node:process';
import path from 'node:path';
import {
  S_BAR, S_ERROR, S_STEP_SUBMIT, intro, log, note, outro,
} from '@clack/prompts';
import type { CompileDiagnostic, PhaseTiming } from '@tess/compiler';

/**
 * 터미널 환경이 색상 출력을 지원하는지 판단합니다.
 * 환경 변수 및 TTY 속성을 확인하여 색상을 비활성화하거나 강제할 수 있습니다.
 */
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

const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹯＀-｠￠-￦]/;

/**
 * 터미널에서 문자열이 차지하는 시각적 너비를 계산합니다.
 * 한글 등 전각 문자는 2칸으로 계산합니다.
 *
 * @param text - 너비를 계산할 문자열
 * @returns 시각적 너비 값
 * 
 * @example
 * displayWidth("Hello"); // 5
 * displayWidth("안녕하세요"); // 10
 */
export function displayWidth(text: unknown): number {
  let width = 0;
  for (const ch of String(text)) width += WIDE.test(ch) ? 2 : 1;
  return width;
}

const padTo = (text: string, width: number) => text + ' '.repeat(Math.max(0, width - displayWidth(text)));

/**
 * 밀리초(ms) 단위의 시간을 읽기 쉬운 문자열로 변환합니다.
 * 1초 이상일 경우 초 단위(s)로 포맷팅합니다.
 *
 * @param ms - 변환할 밀리초 시간
 * @returns 포맷팅된 시간 문자열
 * 
 * @example
 * duration(500); // "500ms"
 * duration(1500); // "1.5s"
 */
export function duration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

const STEP_LABEL_WIDTH = 18;

/**
 * 단일 명령의 실행 시작을 알리는 헤더를 출력합니다.
 *
 * @param command - 실행 중인 명령어 (예: "build", "run")
 * @param file - 대상 파일 경로
 * 
 * @example
 * begin("build", "examples/tour.tess");
 */
export function begin(command: string, file: string) {
  intro(`${bold(cyan('tess'))} ${command}${file ? ` ${dim(path.basename(file))}` : ''}`);
}

/**
 * 단일 단계의 완료 정보와 소요 시간을 한 줄로 출력합니다.
 * 시간 출력이 세로로 정렬될 수 있도록 너비를 맞춥니다.
 *
 * @param timing - 완료된 단계의 정보
 * 
 * @example
 * step({ label: "파싱", ms: 15 });
 */
export function step({ label, ms }: PhaseTiming) {
  process.stdout.write(`${stepLine(green(S_STEP_SUBMIT), timed(label, ms))}\n`);
}

const FRAMES = ['◒', '◐', '◓', '◑'];
const ANIMATED = COLORED && Boolean(process.stdout.isTTY);

const stepLine = (symbol: string, text: string) => `${grey(S_BAR)}  ${symbol}  ${text}`;
const timed = (label: string, ms: number) => `${padTo(label, STEP_LABEL_WIDTH)} ${dim(duration(ms).padStart(6))}`;

/**
 * 장시간 진행되는 작업의 상태(애니메이션)를 출력하며 제어 객체를 반환합니다.
 * 반환된 객체의 메서드를 통해 작업을 완료(done)하거나 실패(fail)로 종료할 수 있습니다.
 * 
 * @param title - 진행할 작업의 이름
 * @returns 제어 가능한 상태 표시 객체
 * 
 * @example
 * const task = working("에셋 압축 중");
 * // ...작업 처리...
 * task.done("압축 완료");
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
 * 진단 항목 하나를 사람이 읽기 쉬운 형태의 문자열로 변환합니다.
 * 위치(파일:줄:칸) 정보를 기반으로 하여 코드 프레임이 있는 경우 아래에 출력합니다.
 *
 * @param label - 기본 파일 이름 또는 식별자
 * @param item - 출력할 진단 항목
 * @returns 포맷팅된 문자열
 */
function diagnostic(label: string, item: CompileDiagnostic, muted = false): string {
  const where = item.file && item.file !== label ? path.basename(item.file) : label;
  const paint = muted ? grey : cyan;
  const head = `${paint(`${where}:${item.line}:${item.column}`)}  ${muted ? dim(item.message) : item.message}`;
  return item.detail ? `${head}\n${dim(item.detail)}` : head;
}

const MAX_SHOWN = 8;

/** 진단 등급별 색과 출력 방식. 주의는 흐리게 깔려서 경고와 한눈에 갈린다. */
const REPORT_STYLES = {
  '에러': { paint: red, muted: false, write: (text: string) => log.error(text) },
  '경고': { paint: yellow, muted: false, write: (text: string) => log.warn(text) },
  '주의': {
    paint: grey,
    muted: true,
    write: (text: string) => log.message(text, { symbol: dim('·') }),
  },
} as const;

export type ReportKind = keyof typeof REPORT_STYLES;

/**
 * 에러 · 경고 · 주의 목록을 그룹지어 출력합니다.
 * 최대 출력 수치를 넘어서면 요약된 건수로 표기합니다.
 *
 * @param label - 대상 파일 이름 또는 식별자
 * @param diagnostics - 진단 메시지 배열
 * @param kind - '에러', '경고' 또는 '주의'
 * 
 * @example
 * report("main.tess", errors, "에러");
 */
export function report(label: string, diagnostics: CompileDiagnostic[], kind: ReportKind) {
  if (diagnostics.length === 0) return;

  const style = REPORT_STYLES[kind];
  const shown = diagnostics.slice(0, MAX_SHOWN);
  const lines = [
    style.paint(`${kind} ${diagnostics.length}개`),
    ...shown.map((item) => diagnostic(label, item, style.muted)),
  ];
  if (diagnostics.length > shown.length) {
    lines.push(dim(`… 외 ${diagnostics.length - shown.length}개`));
  }
  style.write(lines.join('\n'));
}

/**
 * 이름-값 튜플 배열을 받아 이름 부분을 가장 긴 너비에 맞춰 정렬된 문자열로 반환합니다.
 *
 * @param rows - 이름과 값으로 이루어진 항목 목록
 * @returns 정렬 포맷이 적용된 다중 문자열
 * 
 * @example
 * console.log(details([
 *   ["장면 1", "오브젝트 4"],
 *   ["오브젝트 32", "변수 2"]
 * ]));
 */
export function details(rows: Array<[string, string]>): string {
  const width = Math.max(...rows.map(([name]) => displayWidth(name)));
  return rows.map(([name, value]) => `${dim(padTo(name, width))}  ${value}`).join('\n');
}
