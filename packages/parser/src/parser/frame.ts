/**
 * @fileoverview The code frame an error is shown with.
 *
 * A few lines of the source around the failure, numbered, with a caret under
 * the column and the message beside it — the shape `@babel/code-frame` prints,
 * written here so the parser carries no dependency into a browser build.
 */

/** Lines shown above and below the one that failed. */
const CONTEXT = 2;

/**
 * @param source 원본 소스 코드
 * @param line   1부터 세는 줄 번호
 * @param column 1부터 세는 칸 번호
 * @param message 캐럿 옆에 적을 말
 */
export function codeFrame(source: string, line: number, column: number, message: string): string {
  const lines = source.split('\n');
  const first = Math.max(1, line - CONTEXT);
  const last = Math.min(lines.length, line + CONTEXT);
  const gutter = String(last).length;
  const out: string[] = [];
  for (let at = first; at <= last; at += 1) {
    const number = String(at).padStart(gutter, ' ');
    out.push(`${at === line ? '>' : ' '} ${number} | ${lines[at - 1] ?? ''}`);
    if (at !== line) continue;
    const caret = ' '.repeat(Math.max(0, column - 1)) + '^';
    out.push(`  ${' '.repeat(gutter)} | ${caret}${message ? ` ${message}` : ''}`);
  }
  return out.join('\n');
}
