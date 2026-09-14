/**
 * @fileoverview Where the `store` names of a work are kept, in the browser.
 *
 * The Entry Save Manager puts them in `localStorage`; this runner uses
 * IndexedDB through Dexie instead. Both keep them per work and per browser, and
 * neither follows the viewer to another device — what a work saves here is that
 * viewer's own copy.
 *
 * One row per work holds every name at once, so a save is a single write and
 * the values a run starts on are the ones the last save left, whole.
 */
import { Dexie, type Table } from 'dexie';
import type { SaveHost, StoredValue } from '../runtime/save.ts';

const DATABASE = 'tessvm-store';

/** One work's kept names. */
interface Saved {
  /** What names this work: its playentry id, or the name it calls itself. */
  work: string;
  values: Record<string, StoredValue>;
}

class SaveDatabase extends Dexie {
  works!: Table<Saved, string>;

  constructor() {
    super(DATABASE);
    this.version(1).stores({ works: 'work' });
  }
}

let database: SaveDatabase | null = null;

/**
 * The store for one work. Answers null where the browser has no IndexedDB to
 * give (a private window with it turned off, a page barred from it) — the work
 * then runs with `can_save` saying no, and saves nothing.
 */
export function dexieSaveStore(work: string): SaveHost | null {
  if (typeof indexedDB === 'undefined') {
    return null;
  }
  try {
    database ??= new SaveDatabase();
  } catch {
    return null;
  }
  const open = database;
  return {
    async read() {
      const row = await open.works.get(work);
      return row?.values ?? {};
    },
    async write(values) {
      await open.works.put({ work, values });
    },
  };
}
