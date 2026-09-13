/**
 * @fileoverview Turns a playentry work into the work tessvm actually runs.
 *
 * The runner takes the same road here as `tessvm run` does with a `.ent`: the
 * work is decompiled to Tess and compiled back, so what reaches the vm is a
 * project the Tess compiler built, not entry's own. One set of blocks, one set
 * of rules, one thing to fix when something is off.
 *
 * The only thing carried across untouched is where the files are: costumes and
 * sounds keep the urls the site serves them from, and nothing is downloaded to
 * be packed.
 */
import { decompileProject } from '../../../decompiler/src/index.ts';
import { compileProject } from '../../../compiler/src/index.ts';
import type { EntryProjectLike } from '../../../tessvm/src/runtime/engine.ts';
import type { EntryWork } from './entry-project.ts';

export interface TessBuild {
  project: EntryProjectLike;
  /** The Tess source the work was built from, for the console to look at. */
  source: string;
  /** Blocks that had no Tess form, so the work runs without them. */
  dropped: string[];
}

/** `문장 블록 'X' 은(는) …` — the block's own name out of a decompile warning. */
const DROPPED_BLOCK = /블록 '([^']+)'/;

function droppedBlocks(warnings: string[]): string[] {
  const names = new Set<string>();
  for (const warning of warnings) {
    const name = DROPPED_BLOCK.exec(warning)?.[1];
    if (name) names.add(name);
  }
  return [...names];
}

export function toTessProject(work: EntryWork): TessBuild {
  const decompiled = decompileProject(work as never, [], {
    // Nowhere to write fragment files, and the sizes have to be in the source
    // because there is no file here to measure.
    inline: true,
    sizes: true,
    // The vector is kept as it is; the renderer picks between it and the raster
    // beside it, the same way it does for a work loaded from a file.
    keepSvg: true,
    // 사이트에서 열던 그대로 놓고 싶으니 변수 상자 자리도 함께 옮긴다. 명령줄로
    // 되돌릴 때는 읽는 사람을 위해 생략하고, 실행기가 알아서 자리를 잡는다.
    positions: true,
  });
  const compiled = compileProject(decompiled.source, {
    path: `${work.id}.tess`,
    name: work.name,
    assetUrls: true,
    // Block comments are for the editor, and nothing opens this work in one.
    comments: new Map(),
  });
  if (!compiled.project) {
    const first = compiled.errors[0];
    throw new Error(
      first ? `작품을 옮기지 못했습니다 (${first.line}:${first.column} ${first.message})` : '작품을 옮기지 못했습니다',
    );
  }
  // The work's own id names it in storage, so shared variables stay with it.
  const project = { ...compiled.project, id: work.id } as unknown as EntryProjectLike;
  return { project, source: decompiled.source, dropped: droppedBlocks(decompiled.warnings) };
}
