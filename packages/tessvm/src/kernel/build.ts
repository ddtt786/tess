/**
 * @fileoverview 커널 MoonBit 소스를 wasm 으로 빌드합니다 (노드 쪽에서만 돕니다).
 *
 * `moon` 이 있으면 소스를 임시 모듈로 써서 `moon build --target wasm --release` 를
 * 돌리고, 결과를 소스 해시로 캐시합니다. `moon` 이 없으면 null 을 돌려주고 작품은
 * 평소의 자바스크립트 경로로 돕니다.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

/** The package the generated module imports and the prelude beside it. */
const RUNTIME = new URL('./runtime.mbt', import.meta.url);

/** Where the built modules are kept between runs. */
const CACHE = path.join(os.tmpdir(), 'tessvm-kernel');

/** Linear memory below this address is the shared region; the heap starts here. */
const HEAP_START = 1 << 22;

let toolchain: string | null | undefined;

/** The `moon` executable, or null when this machine has no toolchain. */
export function moonPath(): string | null {
  if (toolchain !== undefined) {
    return toolchain;
  }
  const candidates = [
    process.env.MOON_BIN,
    path.join(os.homedir(), '.moon', 'bin', 'moon'),
    'moon',
  ].filter((entry): entry is string => Boolean(entry));
  for (const candidate of candidates) {
    try {
      execFileSync(candidate, ['version'], { stdio: 'ignore' });
      toolchain = candidate;
      return toolchain;
    } catch {
      // Try the next one.
    }
  }
  toolchain = null;
  return null;
}

export interface BuildResult {
  wasm: Uint8Array<ArrayBuffer>;
  /** Where it came from, for the line the cli prints. */
  cached: boolean;
  ms: number;
}

/**
 * Builds one kernel module. `size` is how many f64 slots the shared region
 * needs, which decides how much memory sits below the heap.
 */
export function buildKernel(source: string, exports: string[]): BuildResult | null {
  const moon = moonPath();
  if (!moon) {
    return null;
  }
  const prelude = fs.readFileSync(RUNTIME, 'utf8');
  const full = `${prelude}\n${source}`;
  const pkg = `import {\n  "moonbitlang/core/double",\n  "moonbitlang/core/math",\n}\n\n` +
    `options(\n  link: {\n    "wasm": {\n      "exports": [ ${
      exports.map((name) => JSON.stringify(name)).join(', ')
    } ],\n      "export-memory-name": "memory",\n      "heap-start-address": ${HEAP_START},\n    }\n  }\n)\n`;
  const key = createHash('sha256').update(full).update('\u0000').update(pkg).digest('hex').slice(0, 32);
  const cached = path.join(CACHE, `${key}.wasm`);
  const started = performance.now();
  if (fs.existsSync(cached)) {
    return { wasm: fs.readFileSync(cached), cached: true, ms: performance.now() - started };
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tessvm-kernel-'));
  try {
    fs.writeFileSync(path.join(dir, 'moon.mod'), 'name = "tess/kernel"\nversion = "0.0.0"\npreferred_target = "wasm"\n');
    fs.writeFileSync(path.join(dir, 'moon.pkg'), pkg);
    fs.writeFileSync(path.join(dir, 'kernel.mbt'), full);
    execFileSync(moon, ['build', '--target', 'wasm', '--release', '--quiet'], {
      cwd: dir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const built = path.join(dir, '_build', 'wasm', 'release', 'build', 'kernel.wasm');
    const wasm = fs.readFileSync(built);
    fs.mkdirSync(CACHE, { recursive: true });
    fs.writeFileSync(cached, wasm);
    return { wasm, cached: false, ms: performance.now() - started };
  } catch (error) {
    const detail = error instanceof Error && 'stderr' in error
      ? String((error as { stderr?: Buffer }).stderr ?? '')
      : String(error);
    throw new Error(`커널을 빌드하지 못했습니다:\n${detail.slice(0, 4000)}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
