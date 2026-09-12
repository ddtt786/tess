/**
 * @fileoverview Reads a work straight from playentry.org's graphql endpoint.
 *
 * The response is an entry project except for one thing: asset urls are not in
 * it. Entry's own runner builds them from `filename` when it loads the work, so
 * the same rules are applied here and written back as `fileurl`, which is what
 * tessvm's renderer and audio engine read.
 */
import type { EntryProjectLike } from '../../../tessvm/src/runtime/engine.ts';

const GRAPHQL_URL = '/graphql/SELECT_PROJECT';

/** Only the fields tessvm loads, plus the name and thumbnail the player shows. */
const SELECT_PROJECT = `query SELECT_PROJECT($id: ID!, $groupId: ID) {
  project(id: $id, groupId: $groupId) {
    id
    name
    thumb
    speed
    objects
    variables
    messages
    functions
    tables
    scenes
  }
}`;

export interface EntryWork extends EntryProjectLike {
  id: string;
  name: string;
  /** Path of the work's thumbnail, or null when it has none. */
  thumb: string | null;
}

interface RawAsset {
  fileurl?: string;
  pngurl?: string;
  filename?: string;
  imageType?: string;
  ext?: string;
}

/** Entry's own csrf guard: without this header graphql answers "form tampered with". */
function csrfToken(): string {
  return document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content ?? '';
}

function uploadsBase(): string {
  return `${location.origin}/uploads`;
}

/**
 * Entry's stored names are plain alphanumerics and they build a path, so a name
 * carrying anything else is dropped rather than pasted into a url.
 */
function safeName(value: unknown): string {
  const name = String(value ?? '');
  return /^[A-Za-z0-9]+$/.test(name) ? name : '';
}

/**
 * Whether a url the work carries points back at playentry. `fileurl` is part of
 * the work's own data, so any author can aim it anywhere; a foreign one would
 * have the reader's browser call out to that host, and a same-origin one is
 * sent with the reader's cookies. Only entry's own asset paths are kept.
 */
function sameOrigin(url: unknown): boolean {
  if (typeof url !== 'string' || !url) {
    return false;
  }
  try {
    return new URL(url, location.origin).origin === location.origin;
  } catch {
    return false;
  }
}

/** The url to load from: the work's own only while it stays on playentry. */
function assetUrl(carried: unknown, built: string): string {
  return sameOrigin(carried) ? String(carried) : built;
}

/**
 * The work's thumbnail as a url to draw, or null where it has none to trust.
 * `thumb` is the work's own data like every other path in it, so one pointing
 * off playentry is dropped; what is left is returned parsed, which leaves no
 * quote or bracket in it to end the `url("...")` it is written into.
 */
export function thumbUrl(thumb: unknown): string | null {
  if (typeof thumb !== 'string' || !thumb) {
    return null;
  }
  try {
    const url = new URL(thumb, location.origin);
    return url.origin === location.origin ? url.href : null;
  } catch {
    return null;
  }
}

/** `Entry.EntryObject.getImagePath` — two-level hash folders, then `image/`. */
function imageUrl(picture: RawAsset, type: string): string {
  const name = safeName(picture.filename);
  return `${uploadsBase()}/${name.slice(0, 2)}/${name.slice(2, 4)}/image/${name}.${type}`;
}

/** `Entry.getSoundPath` — same folders, but no `sound/` step and the stored extension. */
function soundUrl(sound: RawAsset): string {
  const name = safeName(sound.filename);
  const ext = /^\.?[A-Za-z0-9]{1,8}$/.test(String(sound.ext ?? '')) ? String(sound.ext) : '.mp3';
  const built = `${uploadsBase()}/${name.slice(0, 2)}/${name.slice(2, 4)}/${name}${ext.startsWith('.') ? ext : `.${ext}`}`;
  return assetUrl(sound.fileurl, built);
}

/**
 * Fills in the asset urls the runner needs, in place.
 *
 * A costume drawn in entry's vector editor is kept twice, as `.svg` and `.png`,
 * and entry's own runner always takes the raster. Both are handed over here and
 * the renderer chooses — the vector while it is small enough to be worth it.
 */
function withAssetUrls(work: EntryWork): EntryWork {
  for (const object of work.objects ?? []) {
    const sprite = (object as { sprite?: { pictures?: RawAsset[]; sounds?: RawAsset[] } }).sprite;
    for (const picture of sprite?.pictures ?? []) {
      if (picture.imageType === 'svg') {
        picture.fileurl = assetUrl(picture.fileurl, imageUrl(picture, 'svg'));
        picture.pngurl = imageUrl(picture, 'png');
      } else {
        picture.fileurl = assetUrl(picture.fileurl, imageUrl(picture, 'png'));
      }
    }
    for (const sound of sprite?.sounds ?? []) {
      sound.fileurl = soundUrl(sound);
    }
  }
  return work;
}

export async function fetchWork(id: string, groupId: string | null = null): Promise<EntryWork> {
  const response = await fetch(GRAPHQL_URL, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', 'csrf-token': csrfToken() },
    body: JSON.stringify({ query: SELECT_PROJECT, variables: { id, groupId } }),
  });
  if (!response.ok) {
    throw new Error(`작품을 불러오지 못했습니다 (HTTP ${response.status})`);
  }
  const body = (await response.json()) as {
    data?: { project?: EntryWork | null };
    errors?: Array<{ message?: string }>;
  };
  const failure = body.errors?.[0]?.message;
  if (failure) {
    throw new Error(failure);
  }
  const work = body.data?.project;
  if (!work) {
    throw new Error('작품을 찾을 수 없습니다 (비공개이거나 삭제된 작품일 수 있습니다)');
  }
  return withAssetUrls(work);
}
