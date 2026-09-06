/**
 * @fileoverview Turns the work the page is holding into one tessvm can run.
 *
 * tessvm runs Tess, so the work goes the same way `tessvm run game.ent` sends
 * it: entry work → Tess source → entry work → JIT. The decompiler splits the
 * work into `main.tess` and one fragment per object, which the compiler reads
 * back through `readFile` out of a map instead of a disk.
 */
import { decompileProject } from '@tess/decompiler';
import { compileProject } from '@tess/compiler';
import type { CompileDiagnostic, EntryProject } from '@tess/compiler';
import { absolutizeAssetUrls, restoreAssetUrls, type EntryPaths } from './assets.ts';

/** The variable a work reads to tell which runner it is on. */
export const TESSVM_VARIABLE = '$tessvm';

/** Root of the virtual source tree the round trip compiles from. */
const ROOT = '/tessvm/';

export type RawEntryProject = Record<string, unknown> & {
  name?: string;
  objects?: unknown[];
  scenes?: unknown[];
  variables?: unknown[];
};

export interface BuildOptions {
  paths: EntryPaths;
  /** `tess` goes through Tess source; `direct` hands the work over unchanged. */
  route: 'tess' | 'direct';
}

export interface BuildResult {
  project: EntryProject;
  route: 'tess' | 'direct';
  /** The Tess source the work was rebuilt from, or null on the direct route. */
  source: string | null;
  errors: CompileDiagnostic[];
  warnings: string[];
  /** Costumes and sounds pointed back at the site's own files. */
  restored: number;
  /** Whether the work declares `$tessvm`, and so knows which runner it is on. */
  marked: boolean;
  /** Milliseconds the whole conversion took. */
  elapsed: number;
}

/**
 * Sets `$tessvm` to 1 so the work can tell it is not on entry's runner.
 * Leaves a work that never declares the variable alone.
 */
export function markTessvmVariable(project: RawEntryProject): boolean {
  let marked = false;
  for (const entry of (project.variables ?? []) as Array<Record<string, unknown>>) {
    if (typeof entry?.name !== 'string' || entry.name.trim() !== TESSVM_VARIABLE) continue;
    if (entry.variableType === 'list') continue;
    entry.value = 1;
    marked = true;
  }
  return marked;
}

/** Deep copy that leaves the page's own work untouched. */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** entry work → Tess source → entry work, then the addresses put back. */
function buildThroughTess(raw: RawEntryProject, options: BuildOptions): BuildResult {
  const started = performance.now();
  const decompiled = decompileProject(raw as never, [], {});

  // Objects come back as their own `objects/….tess` fragments that `main.tess`
  // pulls in with `use`. There is no disk here, so they are handed to the
  // compiler through a map keyed by the path `use` resolves to.
  const fragments = new Map<string, string>();
  for (const asset of decompiled.assets) {
    if (!asset.path.endsWith('.tess')) continue;
    fragments.set(ROOT + asset.path, asset.data.toString('utf-8'));
  }

  const compiled = compileProject(decompiled.source, {
    path: `${ROOT}main.tess`,
    assetDirs: [],
    name: typeof raw.name === 'string' ? raw.name : undefined,
    readFile: (target: string) => {
      const text = fragments.get(target);
      if (text === undefined) throw new Error(`조각 파일이 없습니다: ${target}`);
      return text;
    },
  });

  if (!compiled.project) {
    const first = compiled.errors[0];
    throw new Error(first ? `${first.line}:${first.column} ${first.message}` : 'Tess 컴파일 실패');
  }

  const project = compiled.project;
  const restored = restoreAssetUrls(raw, project as never, options.paths);
  const marked = markTessvmVariable(project as never);
  return {
    project,
    route: 'tess',
    source: decompiled.source,
    errors: compiled.errors,
    warnings: [...decompiled.warnings, ...compiled.warnings.map((item) => item.message)],
    restored,
    marked,
    elapsed: performance.now() - started,
  };
}

/** The work as the page has it, with only its addresses and `$tessvm` touched. */
function buildDirect(raw: RawEntryProject, options: BuildOptions): BuildResult {
  const started = performance.now();
  const project = clone(raw);
  const restored = absolutizeAssetUrls(project, options.paths);
  const marked = markTessvmVariable(project);
  return {
    project: project as unknown as EntryProject,
    route: 'direct',
    source: null,
    errors: [],
    warnings: [],
    restored,
    marked,
    elapsed: performance.now() - started,
  };
}

/**
 * Builds the work for tessvm. The Tess route is the one tessvm is written for;
 * if it cannot rebuild this particular work, the work is handed over unchanged
 * rather than dropping the user back on entry's runner.
 */
export function buildForTessvm(raw: RawEntryProject, options: BuildOptions): BuildResult {
  if (options.route === 'direct') return buildDirect(raw, options);
  try {
    return buildThroughTess(raw, options);
  } catch (error) {
    const fallback = buildDirect(raw, options);
    fallback.warnings.unshift(
      `Tess 로 되돌리지 못해 작품을 그대로 실행합니다: ${(error as Error).message}`,
    );
    return fallback;
  }
}
