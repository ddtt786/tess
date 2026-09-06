/**
 * @fileoverview `node:path` stand-in for the browser bundle.
 *
 * The compiler and the decompiler only ever join, split and resolve posix-style
 * paths of the virtual `main.tess` tree, so a posix-only implementation is
 * enough. Every export keeps node's signature and its behaviour for those cases.
 */

function normalizeParts(parts: string[]): string[] {
  const out: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (out.length && out[out.length - 1] !== '..') out.pop();
      else out.push('..');
      continue;
    }
    out.push(part);
  }
  return out;
}

export function resolve(...segments: string[]): string {
  let path = '';
  let absolute = false;
  for (const segment of segments) {
    if (!segment) continue;
    if (segment.startsWith('/')) {
      path = segment;
      absolute = true;
    } else {
      path = path ? `${path}/${segment}` : segment;
    }
  }
  const normalized = normalizeParts(path.split('/')).join('/');
  if (absolute) return `/${normalized}`;
  return normalized || '.';
}

export function normalize(path: string): string {
  const absolute = path.startsWith('/');
  const trailing = path.endsWith('/');
  let normalized = normalizeParts(path.split('/')).join('/');
  if (!normalized && !absolute) normalized = '.';
  if (trailing && normalized) normalized += '/';
  return absolute ? `/${normalized}` : normalized;
}

export function join(...segments: string[]): string {
  const joined = segments.filter(Boolean).join('/');
  return joined ? normalize(joined) : '.';
}

export function dirname(path: string): string {
  const cut = path.replace(/\/+$/, '').lastIndexOf('/');
  if (cut < 0) return '.';
  if (cut === 0) return '/';
  return path.slice(0, cut);
}

export function basename(path: string, ext?: string): string {
  const base = path.replace(/\/+$/, '').split('/').pop() ?? '';
  if (ext && base !== ext && base.endsWith(ext)) return base.slice(0, -ext.length);
  return base;
}

export function extname(path: string): string {
  const base = basename(path);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot) : '';
}

export function relative(from: string, to: string): string {
  const fromParts = resolve(from).split('/').filter(Boolean);
  const toParts = resolve(to).split('/').filter(Boolean);
  let shared = 0;
  while (shared < fromParts.length && shared < toParts.length && fromParts[shared] === toParts[shared]) {
    shared += 1;
  }
  const up = new Array(fromParts.length - shared).fill('..');
  return [...up, ...toParts.slice(shared)].join('/');
}

export function isAbsolute(path: string): boolean {
  return path.startsWith('/');
}

export const sep = '/';
export const posix = { resolve, normalize, join, dirname, basename, extname, relative, isAbsolute, sep };

export default { resolve, normalize, join, dirname, basename, extname, relative, isAbsolute, sep, posix };
