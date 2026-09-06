/**
 * @fileoverview `node:fs` stand-in for the browser bundle.
 *
 * Nothing in the browser path reads the disk: the compiler runs with an empty
 * `assetDirs` and a `readFile` of its own, so these only exist to keep the
 * module graph resolvable. They report "no such file" rather than throwing at
 * import time, which is what the callers already handle.
 */

export function existsSync(): boolean {
  return false;
}

export function readFileSync(target: string): never {
  throw new Error(`브라우저에서는 파일을 읽을 수 없습니다: ${target}`);
}

export function writeFileSync(target: string): never {
  throw new Error(`브라우저에서는 파일을 쓸 수 없습니다: ${target}`);
}

export function statSync(target: string): never {
  throw new Error(`브라우저에서는 파일 정보를 볼 수 없습니다: ${target}`);
}

export function mkdirSync(): void {}

export function readdirSync(): string[] {
  return [];
}

export default { existsSync, readFileSync, writeFileSync, statSync, mkdirSync, readdirSync };
