// ============================================================================
//  키 이름 -> 엔트리 키코드 (Entry.getKeyCodeMap 과 같은 값, 표준 JS keyCode)
// ============================================================================
export const KEY_CODES = {
  backspace: 8, tab: 9, enter: 13, shift: 16, ctrl: 17, alt: 18,
  esc: 27, escape: 27, space: 32,
  left: 37, up: 38, right: 39, down: 40,
};

for (let i = 0; i <= 9; i += 1) KEY_CODES[String(i)] = 48 + i;
for (let i = 0; i < 26; i += 1) KEY_CODES[String.fromCharCode(97 + i)] = 65 + i;

/** 키 이름을 엔트리 키코드 문자열로. 모르는 키면 null */
export function keyCodeOf(name) {
  if (typeof name !== 'string') return null;
  const key = name.trim().toLowerCase();
  const code = KEY_CODES[key];
  return code === undefined ? null : String(code);
}
