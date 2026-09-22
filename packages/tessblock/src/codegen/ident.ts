/**
 * @fileoverview Names the editor shows turned into names Tess accepts.
 *
 * Anything outside an identifier becomes `_`, and a name that would shadow a
 * keyword or a builtin gets a trailing `_`. The original is kept with `as`.
 */
import { UNUSABLE_AS_NAME } from '../../../parser/src/parser/tokens.ts';
import { BUILTIN_NAMES } from '../../../core/src/builtins.ts';

const START = /[\p{L}_]/u;
const PART = /[\p{L}0-9_]/u;

export function safeIdent(name: string): string {
  const source = name.trim();
  let out = '';
  for (const char of source) {
    if (out === '') {
      // A name may not begin with a digit, but the digit itself is kept.
      if (START.test(char)) out += char;
      else if (PART.test(char)) out += `_${char}`;
      continue;
    }
    out += PART.test(char) ? char : '_';
  }
  if (out === '') out = '이름';
  if (UNUSABLE_AS_NAME.has(out) || BUILTIN_NAMES.has(out)) out = `${out}_`;
  return out;
}

/** True when the editor's name cannot be written as the identifier itself. */
export function needsDisplayName(name: string): boolean {
  return safeIdent(name) !== name.trim();
}

/** Keeps identifiers apart when two records sanitise to the same name. */
export function uniqueIdent(name: string, taken: Set<string>): string {
  const base = safeIdent(name);
  let candidate = base;
  let index = 2;
  while (taken.has(candidate)) {
    candidate = `${base}_${index}`;
    index += 1;
  }
  taken.add(candidate);
  return candidate;
}
