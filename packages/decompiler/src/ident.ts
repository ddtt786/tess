import { BUILTIN_NAMES } from '@tess/core';
import { UNUSABLE_AS_NAME } from '@tess/parser';
import type { DecompileContext, ResourceInfo } from './types.ts';

/**
 * 식별자 시작 문자를 검사하는 정규 표현식입니다. 유니코드 문자(한글 등)와 언더스코어(`_`)를 허용합니다.
 *
 * @example
 * IDENT_START.test('가'); // true
 * IDENT_START.test('1'); // false
 */
const IDENT_START = /[\p{L}_]/u;
const IDENT_PART = /[\p{L}\p{N}_]/u;

/**
 * 주어진 임의의 문자열을 안전한 Tess 식별자로 변환합니다. 
 * 동일한 네임스페이스(`usedNames`) 내에서 이름이 겹칠 경우 뒤에 숫자를 붙여 구분합니다.
 *
 * @param raw - 변환할 원본 문자열
 * @param usedNames - 중복 검사를 위한 기존 식별자 목록
 * @param fallback - 유효한 문자가 없을 때 사용할 기본 접두사
 * @returns 변환된 안전한 식별자 문자열
 *
 * @example
 * const used = new Set(['my_var']);
 * safeIdentifier('my var!', used, 'var'); // "my_var_2"
 * safeIdentifier('123', used, 'var'); // "var_123"
 */
export function safeIdentifier(raw: unknown, usedNames: Set<string>, fallback = 'item'): string {
  let cleaned = '';
  for (const ch of String(raw ?? '')) cleaned += IDENT_PART.test(ch) ? ch : '_';
  cleaned = cleaned.replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  if (!cleaned || !IDENT_START.test(cleaned[0]!)) cleaned = `${fallback}${cleaned ? `_${cleaned}` : ''}`;
  cleaned = cleaned.slice(0, 40) || fallback;
  // 예약어와 내장 이름은 뒤에 `_` 를 붙여 비껴 간다. 내장 이름을 그대로 쓰면
  // 선언이 그 이름을 가려서 `x = x` 처럼 서로 다른 두 값이 한 글자가 된다.
  if (UNUSABLE_AS_NAME.has(cleaned) || BUILTIN_NAMES.has(cleaned)) cleaned = `${cleaned}_`;

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
export function tessString(value: unknown): string {
  const escaped = String(value)
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\r')
    .replaceAll('\t', '\\t');
  return `"${escaped}"`;
}

/**
 * The ` as "..."` clause that carries an Entry name the identifier cannot spell.
 * Without it a renamed resource breaks every runtime lookup by name.
 */
export function displayNamePart(identifier: string, entryName: unknown): string {
  const name = String(entryName ?? '');
  return name && name !== identifier ? ` as ${tessString(name)}` : '';
}

/** 숫자를 Tess 소스에 그대로 적을 수 있는 형태로 */
export function tessNumber(value: unknown): string {
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
export function isExactNumber(literal: string): boolean {
  const value = Number(literal);
  // "NaN" and "Infinity" round-trip through Number as text, but Tess has no
  // literal for either, so they have to stay strings.
  return literal !== '' && Number.isFinite(value) && String(value) === literal;
}

/**
 * Whether the function currently being written belongs to the object that owns
 * this costume/sound. Inside such a function the resource name is unambiguous,
 * so it can be written by name instead of by raw entry id (index.ts).
 */
export function ownsResource(ctx: DecompileContext, info: ResourceInfo | undefined): boolean {
  return Boolean(ctx.functionOwnerId) && info?.owner?.id === ctx.functionOwnerId;
}

/**
 * Entry stores every field value as a string; turn one back into the Tess
 * literal that compiles to the same value.
 */
export function tessLiteral(value: unknown): string {
  if (typeof value === 'number') return tessNumber(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  const text = String(value ?? '');
  // 엔트리에서 참·거짓을 값으로 쓰면 "TRUE"/"FALSE" 가 된다(compiler/expression.ts 참고).
  // 예전 작품에는 소문자로 적혀 있기도 하므로 둘 다 받아들인다.
  if (text === 'TRUE' || text === 'true') return 'true';
  if (text === 'FALSE' || text === 'false') return 'false';
  if (/^-?\d+(\.\d+)?$/.test(text)) return text;
  return tessString(text);
}
