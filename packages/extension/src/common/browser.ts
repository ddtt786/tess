/**
 * @fileoverview The extension API under one name, with promises everywhere.
 *
 * Firefox exposes `browser` and chrome exposes `chrome`; both answer to the
 * same calls the extension makes, so it picks whichever the browser provides.
 */
import { DEFAULT_SETTINGS, normalizeSettings, STORAGE_KEY, type Settings } from './settings.ts';

export const api: typeof chrome =
  (globalThis as { browser?: typeof chrome }).browser ?? (globalThis as { chrome?: typeof chrome }).chrome!;

/** Reads the stored settings, falling back to the defaults on any failure. */
export async function readSettings(): Promise<Settings> {
  try {
    const stored = await api.storage.local.get(STORAGE_KEY);
    return normalizeSettings(stored?.[STORAGE_KEY]);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function writeSettings(settings: Settings): Promise<void> {
  await api.storage.local.set({ [STORAGE_KEY]: settings });
}

/** Calls back with the new settings whenever any surface changes them. */
export function onSettingsChanged(listener: (settings: Settings) => void): void {
  api.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[STORAGE_KEY]) return;
    listener(normalizeSettings(changes[STORAGE_KEY].newValue));
  });
}
