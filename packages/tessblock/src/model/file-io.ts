/**
 * @fileoverview Keeping a work as a file.
 *
 * The browser's own storage is small and shared; a project file is how a work
 * leaves this machine and comes back.
 */
import { resolveAsset, saveAsset } from './assets.ts';
import { project, replaceProject } from './store.ts';
import type { TessObject, TessProject } from './types.ts';

const EXTENSION = '.tessproj';

export function downloadProject(): void {
  // Pictures and sounds live in the browser's own store, so they are written
  // into the file; otherwise it would open somewhere else with nothing in it.
  const model = withInlineAssets(project.peek());
  const blob = new Blob([JSON.stringify(model, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${model.name || '작품'}${EXTENSION}`;
  link.click();
  URL.revokeObjectURL(link.href);
}

/** Reads a project file back in. Throws when the file is not one. */
export async function loadProjectFile(file: File): Promise<void> {
  const parsed = JSON.parse(await file.text()) as TessProject;
  if (!parsed?.scenes?.length || !Array.isArray(parsed.objects)) {
    throw new Error('작품 파일이 아닙니다.');
  }
  replaceProject({
    ...parsed,
    variables: parsed.variables ?? [],
    signals: parsed.signals ?? [],
    functions: parsed.functions ?? [],
    tables: parsed.tables ?? [],
    objects: await Promise.all((parsed.objects ?? []).map(storeAssets)),
  });
}

function withInlineAssets(model: TessProject): TessProject {
  return {
    ...model,
    objects: model.objects.map((object) => ({
      ...object,
      costumes: object.costumes.map((costume) => ({ ...costume, url: resolveAsset(costume.url) })),
      sounds: object.sounds.map((sound) => ({ ...sound, url: resolveAsset(sound.url) })),
    })),
  };
}

/** Puts the files from an opened project back into this browser's store. */
async function storeAssets(object: TessObject): Promise<TessObject> {
  const keep = async (url: string) => (url.startsWith('data:') ? saveAsset(url) : url);
  return {
    ...object,
    costumes: await Promise.all(object.costumes.map(async (costume) => ({ ...costume, url: await keep(costume.url) }))),
    sounds: await Promise.all(object.sounds.map(async (sound) => ({ ...sound, url: await keep(sound.url) }))),
  };
}
