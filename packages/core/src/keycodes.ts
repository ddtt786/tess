/**
 * @fileoverview 키 이름과 엔트리 키 코드 간의 매핑을 제공합니다.
 */

/**
 * 키 이름을 엔트리 키 코드로 매핑한 객체입니다.
 * 
 * @type {Record<string, number>}
 * 
 * @example
 * KEY_CODES["enter"]; // 13
 * KEY_CODES["space"]; // 32
 */
export const KEY_CODES: Record<string, number> = {
  backspace: 8, tab: 9, enter: 13, shift: 16, ctrl: 17, alt: 18,
  esc: 27, escape: 27, space: 32,
  left: 37, up: 38, right: 39, down: 40,
  // Keys entry's dropdown does not offer. A work can still carry them — one
  // written by hand or by another tool — and the browser sends them all the
  // same, so they have names here rather than only numbers.
  capslock: 20, pageup: 33, pagedown: 34, end: 35, home: 36,
  insert: 45, delete: 46,
};

for (let i = 1; i <= 12; i += 1) KEY_CODES[`f${i}`] = 111 + i;
for (let i = 0; i <= 9; i += 1) KEY_CODES[`numpad${i}`] = 96 + i;

for (let i = 0; i <= 9; i += 1) KEY_CODES[String(i)] = 48 + i;
for (let i = 0; i < 26; i += 1) KEY_CODES[String.fromCharCode(97 + i)] = 65 + i;

// The punctuation keys of entryjs' own dropdown (extern/util/static.js
// keyInputList). Real works use them, so leaving them out made those blocks
// impossible to write and impossible to bring back with decompile.
// `backslash` comes before its symbol so that decompile picks the readable one.
Object.assign(KEY_CODES, {
  ';': 186, '=': 187, ',': 188, '-': 189, '.': 190, '/': 191, '~': 192,
  '[': 219, backslash: 220, '\\': 220, ']': 221, "'": 222,
});

/**
 * 키 이름에 해당하는 엔트리 키 코드 문자열을 반환합니다.
 * 인식되지 않는 키 이름일 경우 null을 반환합니다.
 *
 * @param name - 변환할 키 이름
 * @returns 엔트리 키 코드 문자열 또는 null
 *
 * @example
 * keyCodeOf("enter"); // "13"
 * keyCodeOf("a"); // "65"
 * keyCodeOf("unknown"); // null
 */
export function keyCodeOf(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  const key = name.trim().toLowerCase();
  const code = KEY_CODES[key];
  if (code !== undefined) return String(code);
  // A work can hold a key code no name here spells. The number is what the
  // block carries, so it stands for itself and such a work still round-trips.
  return /^[0-9]{1,3}$/.test(key) ? key : null;
}
