/**
 * @fileoverview `@tess/player` stand-in for the browser bundle.
 *
 * The decompiler asks this for an installed entryjs so it can pull the bytes of
 * entry's built-in costumes out of it. There is no such install in a browser;
 * those costumes keep the address the work already had, and `resolveAssetUrl`
 * points that address at the site's own copy.
 */
export function findLocalRuntime(): string | null {
  return null;
}

export function findPreactDir(): string | null {
  return null;
}
