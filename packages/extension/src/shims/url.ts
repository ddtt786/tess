/**
 * @fileoverview `node:url` stand-in for the browser bundle.
 *
 * Only `fileURLToPath` is reached, and only to look for an installed entryjs —
 * a lookup that has no answer in a browser, so the path it returns never
 * resolves to a file.
 */
export function fileURLToPath(url: string | URL): string {
  return String(url).replace(/^file:\/\//, '');
}

export function pathToFileURL(path: string): URL {
  return new URL(`file://${path}`);
}

export default { fileURLToPath, pathToFileURL };
