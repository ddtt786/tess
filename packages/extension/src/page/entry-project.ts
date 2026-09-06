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

/** `Entry.EntryObject.getImagePath` — two-level hash folders, then `image/`. */
function imageUrl(picture: RawAsset): string {
  if (picture.fileurl) {
    return picture.fileurl;
  }
  const name = String(picture.filename ?? '');
  const type = picture.imageType === 'svg' ? 'svg' : 'png';
  return `${uploadsBase()}/${name.slice(0, 2)}/${name.slice(2, 4)}/image/${name}.${type}`;
}

/** `Entry.getSoundPath` — same folders, but no `sound/` step and the stored extension. */
function soundUrl(sound: RawAsset): string {
  if (sound.fileurl) {
    return sound.fileurl;
  }
  const name = String(sound.filename ?? '');
  return `${uploadsBase()}/${name.slice(0, 2)}/${name.slice(2, 4)}/${name}${sound.ext || '.mp3'}`;
}

/** Fills in the asset urls the runner needs, in place. */
function withAssetUrls(work: EntryWork): EntryWork {
  for (const object of work.objects ?? []) {
    const sprite = (object as { sprite?: { pictures?: RawAsset[]; sounds?: RawAsset[] } }).sprite;
    for (const picture of sprite?.pictures ?? []) {
      picture.fileurl = imageUrl(picture);
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
