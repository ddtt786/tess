/** Tess literal writers. The string escapes match the lexer's. */

export function quote(text: string): string {
  return JSON.stringify(String(text));
}

/** A number as Tess writes it — no exponent form, no trailing noise. */
export function num(value: number | string): string {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return '0';
  if (Number.isInteger(parsed)) return String(parsed);
  return String(Number(parsed.toFixed(6)));
}

/** A field value that may hold either a number or free text. */
export function numOrQuote(value: string): string {
  const trimmed = value.trim();
  if (trimmed !== '' && Number.isFinite(Number(trimmed))) return num(Number(trimmed));
  return quote(value);
}
