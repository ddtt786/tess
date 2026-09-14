/**
 * @fileoverview Where the `store` values of works run on playentry are kept.
 *
 * They belong to the extension, not to the page: a page's IndexedDB is
 * playentry's own and nothing outside that origin can read it, so the settings
 * panel could neither show what a work saved nor throw it away. Here the popup
 * opens the same database the service worker writes to, because both are the
 * extension itself.
 *
 * One row per work holds every name at once (`runtime/save.ts` in tessvm hands
 * them over whole), so a save is a single write and what a run starts on is
 * what the last save left.
 */
import { Dexie, type Table } from 'dexie';
import { exportDB, importInto, peakImportFile } from 'dexie-export-import';

const DATABASE = 'tessvm-store';

/** A value as the work holds it: a variable's own, or a list's items. */
export type StoredValue = string | number | Array<{ data: string | number }>;

/** One work's kept names. */
export interface SavedWork {
  /** The work's playentry id — what the runner asks for. */
  work: string;
  /** What the work calls itself, for the panel to show. */
  title: string;
  values: Record<string, StoredValue>;
  /** When it was last written, in milliseconds. */
  updated: number;
}

/** One row as the settings panel lists it. */
export interface SavedSummary {
  work: string;
  title: string;
  /** How many names are kept. */
  names: number;
  /** Roughly how much they take, in bytes of json. */
  bytes: number;
  updated: number;
}

class StoreDatabase extends Dexie {
  works!: Table<SavedWork, string>;

  constructor() {
    super(DATABASE);
    this.version(1).stores({ works: 'work' });
  }
}

let database: StoreDatabase | null = null;

function open(): StoreDatabase {
  database ??= new StoreDatabase();
  return database;
}

/** What is kept for one work; an empty object where nothing is. */
export async function readWork(work: string): Promise<Record<string, StoredValue>> {
  const row = await open().works.get(work);
  return row?.values ?? {};
}

/** Writes one work's names over whatever was there. */
export async function writeWork(
  work: string,
  title: string,
  values: Record<string, StoredValue>,
): Promise<void> {
  await open().works.put({ work, title, values, updated: Date.now() });
}

/** Every work that has something kept, the most recently written first. */
export async function listWorks(): Promise<SavedSummary[]> {
  const rows = await open().works.toArray();
  return rows
    .map((row) => ({
      work: row.work,
      title: row.title || row.work,
      names: Object.keys(row.values ?? {}).length,
      bytes: JSON.stringify(row.values ?? {}).length,
      updated: row.updated ?? 0,
    }))
    .sort((a, b) => b.updated - a.updated);
}

/** Throws one work's saved data away. */
export async function removeWork(work: string): Promise<void> {
  await open().works.delete(work);
}

/** Throws every work's saved data away. */
export async function clearWorks(): Promise<void> {
  await open().works.clear();
}


// ---------------------------------------------------------------------------
//  파일로 내보내기 · 파일에서 가져오기
// ---------------------------------------------------------------------------
/**
 * Everything kept, as one json file's worth of bytes
 * (`dexie-export-import`). What comes out is what `importAll` takes back.
 */
export async function exportAll(): Promise<Blob> {
  return exportDB(open(), { prettyJson: true });
}

/** What a file to be imported is called. */
export function exportName(now = new Date()): string {
  const stamp = [now.getFullYear(), now.getMonth() + 1, now.getDate()]
    .map((part) => String(part).padStart(2, '0'))
    .join('-');
  return `tessvm-save-${stamp}.json`;
}

/**
 * Reads a file back in. A work the file carries lands over the one kept here;
 * works the file says nothing about are left alone, so two computers' saves can
 * be brought together one file at a time.
 *
 * Throws where the file is not one of these — a file from another database is
 * refused rather than half-read.
 *
 * @returns how many works the file held.
 */
export async function importAll(file: Blob): Promise<number> {
  const meta = await peakImportFile(file);
  if (meta.data.databaseName !== DATABASE) {
    throw new Error('tessvm 이 내보낸 파일이 아닙니다.');
  }
  await importInto(open(), file, { overwriteValues: true });
  return meta.data.tables.find((table) => table.name === 'works')?.rowCount ?? 0;
}
