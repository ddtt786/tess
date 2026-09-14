/**
 * @fileoverview Names the Entry Save Manager extension watches.
 *
 * That extension keeps every global variable and list whose entry name begins
 * with `@`, puts what it kept back before the work runs, and writes them out
 * again when the work calls the function named `@저장` (`@비동기저장` does not
 * wait for the write). While it is there it sets `@확장프로그램` to 1, so a work
 * can tell whether saving is available to the viewer at all.
 *
 * Tess writes `store var`, `store list`, `save`, `save async` and `can_save`;
 * these are the names those become in the work, in both directions.
 */

/** What marks a variable or list as the save manager's. */
export const STORE_PREFIX = '@';
/** Saves and waits for it. */
export const STORE_SAVE_FUNCTION = '@저장';
/** Saves without waiting. */
export const STORE_SAVE_ASYNC_FUNCTION = '@비동기저장';
/** Set to 1 by the extension; `0` or missing where there is none. */
export const STORE_FLAG_VARIABLE = '@확장프로그램';
/** The value the flag carries while saving is available. */
export const STORE_FLAG_ON = 1;

/** Whether an entry variable or list name is one the save manager keeps. */
export function isStoreName(name: string): boolean {
  return name.startsWith(STORE_PREFIX) && name !== STORE_FLAG_VARIABLE;
}
