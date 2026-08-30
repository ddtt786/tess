// ============================================================================
//  엔트리 이름(무엇이든 될 수 있는 문자열) -> Tess 식별자(bareword)
//
//  엔트리 오브젝트/장면/변수/모양/소리 이름은 공백·괄호·이모지까지 뭐든 될 수
//  있지만, Tess 식별자는 `identifierStart identifierPart*` (letter/'_' 로
//  시작, 그 뒤로 letter/digit/'_') 만 허용한다. 그래서 이름은 항상 두 개로
//  나뉜다 — 코드에서 가리킬 안전한 식별자, 그리고 컴파일된 작품에 실제로
//  찍힐 원래 이름(name 속성으로 되돌려 놓는다).
// ============================================================================

import { UNUSABLE_AS_NAME } from '../parser/tokens.js';

/** Ohm 의 `letter` 는 유니코드 Letter 카테고리 전부(한글 포함)를 허용한다 */
const IDENT_START = /[\p{L}_]/u;
const IDENT_PART = /[\p{L}\p{N}_]/u;

/**
 * 임의의 문자열을 안전한 Tess 식별자로 만든다. 같은 네임스페이스(usedNames)
 * 안에서 겹치면 숫자를 붙여 구분한다.
 */
export function safeIdentifier(raw, usedNames, fallback = 'item') {
  // 글자 고르기는 자리를 가리지 않는다. 맨 앞에서 IDENT_START 로 걸러 버리면 "3.png"
  // 처럼 숫자로 시작하는 이름의 그 숫자가 통째로 사라져서("png"), "1.png"·"2.png" 가
  // 죄다 같은 이름이 된 뒤 뒤에 번호가 붙어 원래 순서와 어긋났다. 숫자도 그대로 두고,
  // 식별자가 숫자로 시작하는 문제는 아래에서 앞에 이름을 붙여 푼다.
  let cleaned = '';
  for (const ch of String(raw ?? '')) cleaned += IDENT_PART.test(ch) ? ch : '_';
  cleaned = cleaned.replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  if (!cleaned || !IDENT_START.test(cleaned[0])) cleaned = `${fallback}${cleaned ? `_${cleaned}` : ''}`;
  cleaned = cleaned.slice(0, 40) || fallback;
  // A few keywords read as a statement before they read as a name, so `skip = 0`
  // never parses as an assignment. Trailing '_' keeps such a name usable.
  if (UNUSABLE_AS_NAME.has(cleaned)) cleaned = `${cleaned}_`;

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

/**
 * 다시 적어도 글자 하나 안 바뀌는 숫자인지 ("1.0"·"01"·" 1" 은 아니다).
 *
 * 엔트리의 `number` 블록과 `text` 블록은 둘 다 적어 둔 글자를 그대로 돌려주는 같은
 * 원시 블록이라(block_entry.js: 둘 다 `script.getField(...)` 하나뿐이다), 값이 글자로
 * 같기만 하면 어느 쪽으로 옮겨도 실행 결과가 똑같다. 그래서 이 검사를 통과하는
 * 리터럴만 숫자로 옮긴다.
 */
export function isExactNumber(literal) {
  return literal !== '' && String(Number(literal)) === literal;
}

/**
 * Whether the function currently being written belongs to the object that owns
 * this costume/sound. Inside such a function the resource name is unambiguous,
 * so it can be written by name instead of by raw entry id (index.js).
 */
export function ownsResource(ctx, info) {
  return Boolean(ctx.functionOwnerId) && info?.owner?.id === ctx.functionOwnerId;
}

/**
 * Entry stores every field value as a string; turn one back into the Tess
 * literal that compiles to the same value.
 */
export function tessLiteral(value) {
  if (typeof value === 'number') return tessNumber(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  const text = String(value ?? '');
  // 엔트리에서 참·거짓을 값으로 쓰면 "TRUE"/"FALSE" 가 된다(compiler/expression.js 참고).
  // 예전 작품에는 소문자로 적혀 있기도 하므로 둘 다 받아들인다.
  if (text === 'TRUE' || text === 'true') return 'true';
  if (text === 'FALSE' || text === 'false') return 'false';
  if (/^-?\d+(\.\d+)?$/.test(text)) return text;
  return tessString(text);
}
