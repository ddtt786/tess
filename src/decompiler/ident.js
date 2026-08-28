// ============================================================================
//  엔트리 이름(무엇이든 될 수 있는 문자열) -> Tess 식별자(bareword)
//
//  엔트리 오브젝트/장면/변수/모양/소리 이름은 공백·괄호·이모지까지 뭐든 될 수
//  있지만, Tess 식별자는 `identifierStart identifierPart*` (letter/'_' 로
//  시작, 그 뒤로 letter/digit/'_') 만 허용한다. 그래서 이름은 항상 두 개로
//  나뉜다 — 코드에서 가리킬 안전한 식별자, 그리고 컴파일된 작품에 실제로
//  찍힐 원래 이름(name 속성으로 되돌려 놓는다).
// ============================================================================

/** Ohm 의 `letter` 는 유니코드 Letter 카테고리 전부(한글 포함)를 허용한다 */
const IDENT_START = /[\p{L}_]/u;
const IDENT_PART = /[\p{L}\p{N}_]/u;

/**
 * 임의의 문자열을 안전한 Tess 식별자로 만든다. 같은 네임스페이스(usedNames)
 * 안에서 겹치면 숫자를 붙여 구분한다.
 */
export function safeIdentifier(raw, usedNames, fallback = 'item') {
  let cleaned = '';
  for (const ch of String(raw ?? '')) {
    cleaned += (cleaned.length === 0 ? IDENT_START : IDENT_PART).test(ch) ? ch : (cleaned ? '_' : '');
  }
  cleaned = cleaned.replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  if (!cleaned || !IDENT_START.test(cleaned[0])) cleaned = `${fallback}${cleaned ? `_${cleaned}` : ''}`;
  cleaned = cleaned.slice(0, 40) || fallback;

  let candidate = cleaned;
  let n = 2;
  while (usedNames.has(candidate)) {
    candidate = `${cleaned}_${n}`;
    n += 1;
  }
  usedNames.add(candidate);
  return candidate;
}

/** Tess 문자열 리터럴로 안전하게 넣는다 (따옴표 · 역슬래시 · 줄바꿈 이스케이프) */
export function tessString(value) {
  const escaped = String(value)
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\r')
    .replaceAll('\t', '\\t');
  return `"${escaped}"`;
}

/** 숫자를 Tess 소스에 그대로 적을 수 있는 형태로 */
export function tessNumber(value) {
  if (!Number.isFinite(value)) return '0';
  return String(value);
}
