/**
 * @fileoverview Where the compiler reaches outside itself.
 *
 * Reading a `use`d source and measuring a costume are the only two things it
 * needs a filesystem for, so they go through this one port. The compiler
 * itself runs anywhere; `node-host.ts` fills the port in on node and the
 * browser leaves it empty.
 */

/** Files the compiler may read while it builds a work. */
export interface CompilerHost {
  /** `base` joined with `target`, in whatever shape this host's paths take. */
  resolve(base: string, target: string): string;
  /** Whether a readable file sits there. */
  isFile(file: string): boolean;
  /** The file's bytes, or null when it cannot be read. */
  readFile(file: string): Uint8Array | null;
  /** The file's text, or null when it cannot be read. */
  readText(file: string): string | null;
}

/** A host with no files at all: everything is declared or it is not there. */
export const EMPTY_HOST: CompilerHost = {
  resolve: (base, target) => (base ? `${base.replace(/\/+$/, '')}/${target}` : target),
  isFile: () => false,
  readFile: () => null,
  readText: () => null,
};

/** The last path segment, with a trailing extension optionally taken off. */
export function basename(file: string, ext = ''): string {
  const name = file.split(/[\\/]/).pop() ?? '';
  return ext && name.endsWith(ext) ? name.slice(0, -ext.length) : name;
}

/** Everything before the last separator, or `.` when there is none. */
export function dirname(file: string): string {
  const cut = Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\'));
  return cut < 0 ? '.' : file.slice(0, cut) || '/';
}

/** The trailing `.ext`, or an empty string. A leading dot does not start one. */
export function extname(file: string): string {
  const name = basename(file);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot) : '';
}
