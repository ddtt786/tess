// ============================================================================
//  Function parameter naming convention, shared by the compiler and decompiler.
//
//  An Entry function header is a chain that can alternate labels and
//  parameter slots. Tess has no such node, so that information is encoded
//  in the parameter name instead (SPEC-ADDENDUM.md 4.6).
//
//    label-arg-arg      -> name(a, b)      only the leading label is the function name
//    label-arg-label-arg -> name(a, hp)    a mid-chain label names the argument after it
//    label-arg-label     -> name(a)        a trailing label with no argument is dropped
// ============================================================================
const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

/** Auto-generated name for the i-th (0-based) unlabeled parameter: a, b, … z, a1, a2, … */
export function autoParamName(index) {
  return index < LETTERS.length ? LETTERS[index] : `a${index - LETTERS.length + 1}`;
}

/** Checks whether a name matches the auto-generated name for its position (i.e. unlabeled). */
export function isAutoParamName(name, index) {
  return name === autoParamName(index);
}
