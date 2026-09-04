/**
 * @fileoverview 실행할 작품을 읽어들이는 곳입니다.
 *
 * tessvm 이 실제로 돌리는 것은 Tess 소스입니다. `.tess` 는 그대로 컴파일하고,
 * `.ent` 는 먼저 Tess 로 되돌린 뒤 같은 길을 지나갑니다 — 어느 쪽이든 실행기가 받는
 * 것은 같은 컴파일 결과입니다.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compileProject, type AssetFile, type CompileDiagnostic, type EntryProject, type SourceMap } from '@tess/compiler';

export interface LoadOptions {
  assetDirs?: string[];
  name?: string;
  strict?: boolean;
  /** Where a `.ent` is unpacked to; a temporary folder when omitted. */
  decompileTo?: string;
}

export interface LoadedProject {
  project: EntryProject;
  assets: AssetFile[];
  assetDirs: string[];
  sourceMap?: SourceMap;
  name: string;
  /** The `.tess` entry point that was compiled — the decompiled one for `.ent`. */
  sourcePath: string;
  errors: CompileDiagnostic[];
  warnings: CompileDiagnostic[];
  notices: CompileDiagnostic[];
  /** Set when the input was a `.ent` that had to be decompiled first. */
  decompiledTo?: string;
  decompileWarnings?: string[];
}

/** `.tess` or `.ent` in, a runnable entry project out. */
export async function loadProject(file: string, options: LoadOptions = {}): Promise<LoadedProject> {
  const absolute = path.resolve(file);
  if (/\.ent$/i.test(absolute)) {
    return loadEnt(absolute, options);
  }
  return loadTess(absolute, options);
}

function loadTess(file: string, options: LoadOptions): LoadedProject {
  const source = fs.readFileSync(file, 'utf-8');
  const assetDirs = assetDirsFor(file, options.assetDirs);
  const result = compileProject(source, {
    path: file,
    assetDirs,
    name: options.name,
    strict: options.strict,
  });
  if (!result.project) {
    const first = result.errors[0];
    throw new Error(
      first ? `${path.basename(file)}:${first.line}:${first.column} ${first.message}` : '컴파일 실패',
    );
  }
  return {
    project: result.project,
    assets: result.assets,
    assetDirs,
    sourceMap: result.sourceMap,
    name: options.name ?? result.project.name ?? path.basename(file, path.extname(file)),
    sourcePath: file,
    errors: result.errors,
    warnings: result.warnings,
    notices: result.notices,
  };
}

async function loadEnt(file: string, options: LoadOptions): Promise<LoadedProject> {
  const { decompileEnt } = await import('@tess/decompiler');
  const bytes = fs.readFileSync(file);
  const decompiled = await decompileEnt(bytes, {});
  const outDir =
    options.decompileTo ??
    fs.mkdtempSync(path.join(os.tmpdir(), `tessvm-${path.basename(file, '.ent')}-`));
  fs.mkdirSync(outDir, { recursive: true });
  const mainFile = path.join(outDir, 'main.tess');
  fs.writeFileSync(mainFile, decompiled.source);
  for (const asset of decompiled.assets) {
    const target = path.join(outDir, asset.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, asset.data);
  }
  const loaded = loadTess(mainFile, {
    ...options,
    name: options.name ?? decompiled.name,
    assetDirs: [...(options.assetDirs ?? []), path.join(outDir, 'assets'), outDir],
  });
  loaded.decompiledTo = outDir;
  loaded.decompileWarnings = decompiled.warnings;
  return loaded;
}

/** Same search entry's own tooling does: next to the source, then `assets/`. */
export function assetDirsFor(file: string, extra: string[] = []): string[] {
  const dir = path.dirname(path.resolve(file));
  return [...extra, dir, path.join(dir, 'assets')];
}
