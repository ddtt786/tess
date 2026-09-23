/**
 * @fileoverview String literal text, shared by both parsers.
 */

const ESCAPES: Record<string, string> = {
  n: '\n',
  t: '\t',
  r: '\r',
  b: '\b',
  f: '\f',
  v: '\v',
  0: '\0',
};

/** Reads a string literal's text, resolving the escapes the grammar allows. */
export function decodeString(image: string): string {
  const raw = image.slice(1, -1);
  let out = '';
  for (let i = 0; i < raw.length; i += 1) {
    if (raw[i] !== '\\') {
      out += raw[i];
      continue;
    }
    const next = raw[i + 1];
    const hex = raw.slice(i + 2, i + 6);
    if (next === 'u' && /^[0-9a-fA-F]{4}$/.test(hex)) {
      out += String.fromCharCode(parseInt(hex, 16));
      i += 5;
    } else {
      out += ESCAPES[next] ?? next;
      i += 1;
    }
  }
  return out;
}
