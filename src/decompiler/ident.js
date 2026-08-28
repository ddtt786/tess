// ============================================================================
//  Entry name (an arbitrary string) -> Tess identifier (bareword).
//
//  An Entry object/scene/variable/costume/sound name can contain spaces,
//  brackets, emoji — anything. A Tess identifier only allows
//  `identifierStart identifierPart*` (letter/'_' to start, then
//  letter/digit/'_'). Names are therefore always split into a safe
//  identifier to reference in code and the original name restored via a
//  `name` property in the compiled output.
// ============================================================================

/** Ohm's `letter` accepts the full Unicode Letter category (including Hangul). */
const IDENT_START = /[\p{L}_]/u;
const IDENT_PART = /[\p{L}\p{N}_]/u;

/**
 * Turns an arbitrary string into a safe Tess identifier. Collisions within
 * the same namespace (usedNames) are disambiguated with a numeric suffix.
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

/** Safely encodes a value as a Tess string literal (escapes quotes, backslash, newlines). */
export function tessString(value) {
  const escaped = String(value)
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\r')
    .replaceAll('\t', '\\t');
  return `"${escaped}"`;
}

/** Formats a number so it can be written directly into Tess source. */
export function tessNumber(value) {
  if (!Number.isFinite(value)) return '0';
  return String(value);
}
