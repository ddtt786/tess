/**
 * @fileoverview Color literal recognition, shared by the lexer, the comment
 * scanner and the editor grammar.
 *
 * Entry stores every colour as `#RRGGBB`, so anything written after `#` is
 * normalised to that form. A `#` that names no colour is a comment, which is
 * what keeps `# 주석` and `#ff0000` apart.
 */

/** Colour names Tess accepts after `#`, Korean and CSS, as `#RRGGBB`. */
export const NAMED_COLORS: Record<string, string> = {
  // --- Korean ---------------------------------------------------------------
  검정: '#000000', 검정색: '#000000', 검은색: '#000000', 흑색: '#000000',
  하양: '#ffffff', 하얀색: '#ffffff', 흰색: '#ffffff', 백색: '#ffffff',
  빨강: '#ff0000', 빨간색: '#ff0000', 적색: '#ff0000',
  주황: '#ff7f00', 주황색: '#ff7f00',
  노랑: '#ffff00', 노란색: '#ffff00', 황색: '#ffff00',
  연두: '#7fff00', 연두색: '#7fff00',
  초록: '#00ff00', 초록색: '#00ff00', 녹색: '#00ff00',
  청록: '#00ffff', 청록색: '#00ffff',
  하늘: '#00bfff', 하늘색: '#00bfff',
  파랑: '#0000ff', 파란색: '#0000ff', 청색: '#0000ff',
  남색: '#000080',
  보라: '#7f00ff', 보라색: '#7f00ff', 자주색: '#8b008b',
  분홍: '#ffc0cb', 분홍색: '#ffc0cb', 자홍: '#ff00ff', 자홍색: '#ff00ff',
  갈색: '#a52a2a', 밤색: '#8b4513',
  회색: '#808080', 은색: '#c0c0c0', 금색: '#ffd700',
  // --- English --------------------------------------------------------------
  black: '#000000', white: '#ffffff', red: '#ff0000', lime: '#00ff00',
  green: '#008000', blue: '#0000ff', yellow: '#ffff00', cyan: '#00ffff',
  aqua: '#00ffff', magenta: '#ff00ff', fuchsia: '#ff00ff', silver: '#c0c0c0',
  gray: '#808080', grey: '#808080', maroon: '#800000', olive: '#808000',
  purple: '#800080', teal: '#008080', navy: '#000080', orange: '#ffa500',
  pink: '#ffc0cb', brown: '#a52a2a', gold: '#ffd700', beige: '#f5f5dc',
  ivory: '#fffff0', khaki: '#f0e68c', indigo: '#4b0082', violet: '#ee82ee',
  crimson: '#dc143c', salmon: '#fa8072', coral: '#ff7f50', tomato: '#ff6347',
  turquoise: '#40e0d0', skyblue: '#87ceeb', lavender: '#e6e6fa',
  tan: '#d2b48c', plum: '#dda0dd', orchid: '#da70d6', wheat: '#f5deb3',
  snow: '#fffafa', mint: '#98ff98', chocolate: '#d2691e',
};

/** Characters that may follow `#`; the same set an identifier is made of. */
const COLOR_BODY = /^[\p{L}0-9_]+$/u;

/**
 * Expands a run of hex digits to the six Entry wants.
 *
 * Three and four digits are the CSS shorthands, with the alpha of a four
 * dropped; anything longer is cut to six, anything shorter padded out. Alpha is
 * dropped throughout — Entry has no place to put it.
 */
function hexToRgb(hex: string): string {
  const lower = hex.toLowerCase();
  if (lower.length === 3 || lower.length === 4) {
    return `#${lower.slice(0, 3).replace(/./g, (digit) => digit + digit)}`;
  }
  return `#${lower.padEnd(6, '0').slice(0, 6)}`;
}

/**
 * The `#RRGGBB` a colour literal means, or null when the text names no colour.
 *
 * `raw` is taken with or without its `#`.
 */
export function normalizeColor(raw: string): string | null {
  const body = raw.startsWith('#') ? raw.slice(1) : raw;
  if (!body || !COLOR_BODY.test(body)) return null;
  if (/^[0-9a-fA-F]+$/.test(body)) return hexToRgb(body);
  return NAMED_COLORS[body.toLowerCase()] ?? null;
}

/**
 * Length of the colour literal starting at `at` in `source`, or 0 when what is
 * there is a comment. `at` is the offset of the `#`.
 */
export function colorLiteralLength(source: string, at: number): number {
  if (source[at] !== '#') return 0;
  let end = at + 1;
  while (end < source.length && /[\p{L}0-9_]/u.test(source[end]!)) end += 1;
  const body = source.slice(at + 1, end);
  return body && normalizeColor(body) ? end - at : 0;
}
