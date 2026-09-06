/**
 * @fileoverview Costume and sound addresses, kept pointing at the site.
 *
 * The compiler mints a fresh `temp/…` address for every resource it is given,
 * because a work built from Tess sources carries its own files. A work read out
 * of playentry.org has none: its files are already on the site. So after the
 * round trip every resource gets the address the original had, resolved the
 * same way entry resolves it.
 */

/** Where entry looks for uploads, sounds and its own built-in images. */
export interface EntryPaths {
  defaultPath: string;
  soundPath: string;
  mediaFilePath: string;
}

export const DEFAULT_ENTRY_PATHS: EntryPaths = {
  defaultPath: '',
  soundPath: '',
  mediaFilePath: '/lib/@entrylabs/entry/images/',
};

interface RawResource {
  id?: string;
  name?: string;
  filename?: string;
  fileurl?: string;
  imageType?: string;
  ext?: string;
  duration?: number;
  dimension?: { width: number; height: number };
}

interface RawObject {
  id?: string;
  name?: string;
  sprite?: { pictures?: RawResource[]; sounds?: RawResource[] };
}

/** Loose enough for the work as the page has it, and for a freshly built one. */
interface RawProject {
  objects?: unknown[];
}

function objectsOf(project: RawProject): RawObject[] {
  return (project.objects ?? []) as RawObject[];
}

// Works saved before the uploads server moved still name entry's own costumes
// through the old bundle path. The files are the ones the site serves today.
const BUILTIN_PATH = /(?:^|\/)bower_components\/[^/]+\/images\/(.+)$/;

function rewriteBuiltin(url: string, paths: EntryPaths): string {
  const match = BUILTIN_PATH.exec(url);
  if (!match) return url;
  return `${paths.mediaFilePath}${match[1]}`;
}

function uploadPath(filename: string, paths: EntryPaths): string {
  return `${paths.defaultPath}/uploads/${filename.slice(0, 2)}/${filename.slice(2, 4)}/`;
}

/** The address entry itself would load this costume from. */
export function pictureUrl(picture: RawResource, paths: EntryPaths): string | null {
  if (picture.fileurl) return rewriteBuiltin(picture.fileurl, paths);
  if (!picture.filename) return null;
  const ext = picture.imageType === 'svg' ? 'svg' : 'png';
  return `${uploadPath(picture.filename, paths)}image/${picture.filename}.${ext}`;
}

/** The address entry itself would load this sound from. */
export function soundUrl(sound: RawResource, paths: EntryPaths): string | null {
  if (sound.fileurl) return rewriteBuiltin(sound.fileurl, paths);
  if (!sound.filename) return null;
  return `${uploadPath(sound.filename, paths)}${paths.soundPath}${sound.filename}${sound.ext || '.mp3'}`;
}

/** Pairs two lists up by position when they line up, and by name when they do not. */
function pairUp<T extends { name?: string }>(left: T[], right: T[]): Array<[T, T]> {
  if (left.length === right.length) {
    return left.map((item, index) => [item, right[index]!] as [T, T]);
  }
  const taken = new Set<number>();
  const pairs: Array<[T, T]> = [];
  for (const item of left) {
    const index = right.findIndex(
      (candidate, position) => !taken.has(position) && candidate.name === item.name,
    );
    if (index < 0) continue;
    taken.add(index);
    pairs.push([item, right[index]!]);
  }
  return pairs;
}

/**
 * Points every costume and sound of `built` back at the file the original work
 * used. Returns how many resources were matched.
 */
export function restoreAssetUrls(
  original: RawProject,
  built: RawProject,
  paths: EntryPaths,
): number {
  let restored = 0;
  for (const [source, target] of pairUp(objectsOf(original), objectsOf(built))) {
    for (const [from, to] of pairUp(source.sprite?.pictures ?? [], target.sprite?.pictures ?? [])) {
      const url = pictureUrl(from, paths);
      if (!url) continue;
      to.fileurl = url;
      if (from.filename) to.filename = from.filename;
      if (from.imageType) to.imageType = from.imageType;
      if (from.dimension) to.dimension = { ...from.dimension };
      restored += 1;
    }
    for (const [from, to] of pairUp(source.sprite?.sounds ?? [], target.sprite?.sounds ?? [])) {
      const url = soundUrl(from, paths);
      if (!url) continue;
      to.fileurl = url;
      if (from.filename) to.filename = from.filename;
      if (from.ext) to.ext = from.ext;
      if (Number.isFinite(from.duration)) to.duration = from.duration;
      restored += 1;
    }
  }
  return restored;
}

/** Rewrites a work's own addresses in place, for the route that skips Tess. */
export function absolutizeAssetUrls(project: RawProject, paths: EntryPaths): number {
  let count = 0;
  for (const object of objectsOf(project)) {
    for (const picture of object.sprite?.pictures ?? []) {
      const url = pictureUrl(picture, paths);
      if (!url) continue;
      picture.fileurl = url;
      count += 1;
    }
    for (const sound of object.sprite?.sounds ?? []) {
      const url = soundUrl(sound, paths);
      if (!url) continue;
      sound.fileurl = url;
      count += 1;
    }
  }
  return count;
}

/** Reads entry's own path settings out of the page, with entry's defaults. */
export function entryPaths(entry: Record<string, unknown> | null | undefined): EntryPaths {
  return {
    defaultPath: typeof entry?.defaultPath === 'string' ? entry.defaultPath : DEFAULT_ENTRY_PATHS.defaultPath,
    soundPath: typeof entry?.soundPath === 'string' ? entry.soundPath : DEFAULT_ENTRY_PATHS.soundPath,
    mediaFilePath:
      typeof entry?.mediaFilePath === 'string' ? entry.mediaFilePath : DEFAULT_ENTRY_PATHS.mediaFilePath,
  };
}
