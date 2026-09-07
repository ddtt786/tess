/**
 * @fileoverview Where a work's shared and real-time variables are kept.
 *
 * Entry holds them on its server so their value outlives a run and every player
 * of the work sees the same one. Outside the site there is no server, so the
 * browser's own storage takes that place: the value survives a stop, a reload
 * and a new tab, for this reader on this browser.
 */
import type { VariableStore } from '../runtime/engine.ts';

const PREFIX = 'tessvm:vars';

type Stored = string | number | Array<{ data: string | number }>;

/**
 * A store keyed on the work, so two works on the same page keep their own.
 * Answers null where the browser has no storage to give (a private window with
 * it turned off, a page whose origin is barred from it) — the vm then holds the
 * values in memory for as long as it is up.
 */
export function localVariableStore(projectKey: string): VariableStore | null {
  let backing: Storage;
  try {
    backing = window.localStorage;
    const probe = `${PREFIX}:probe`;
    backing.setItem(probe, '1');
    backing.removeItem(probe);
  } catch {
    return null;
  }
  const keyOf = (id: string) => `${PREFIX}:${projectKey}:${id}`;
  return {
    read(id) {
      try {
        const text = backing.getItem(keyOf(id));
        return text === null ? undefined : (JSON.parse(text) as Stored);
      } catch {
        return undefined;
      }
    },
    write(id, value) {
      try {
        backing.setItem(keyOf(id), JSON.stringify(value));
      } catch {
        // Full or refused: the run carries on with what it holds in memory.
      }
    },
  };
}
