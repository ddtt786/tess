/**
 * @fileoverview The slice of the extension api this uses.
 *
 * Typed here rather than pulled from `@types/chrome` so the package keeps no
 * dependencies. Firefox exposes `browser` with promises and chrome's MV3
 * namespace returns promises too, so the same calls fit both.
 */

export interface StorageChange {
  newValue?: unknown;
  oldValue?: unknown;
}

export interface ExtensionApi {
  storage: {
    local: {
      get(defaults: Record<string, unknown>): Promise<Record<string, unknown>>;
      set(values: Record<string, unknown>): Promise<void>;
    };
    onChanged: {
      addListener(
        listener: (changes: Record<string, StorageChange>, area: string) => void,
      ): void;
    };
  };
  runtime: { getURL(path: string): string };
}

const globals = globalThis as unknown as { browser?: ExtensionApi; chrome?: ExtensionApi };

export const api = (globals.browser ?? globals.chrome) as ExtensionApi;

export const ENABLED_KEY = 'enabled';

/** On unless it has been turned off. */
export async function isEnabled(): Promise<boolean> {
  const stored = await api.storage.local.get({ [ENABLED_KEY]: true });
  return stored[ENABLED_KEY] !== false;
}

export async function setEnabled(value: boolean): Promise<void> {
  await api.storage.local.set({ [ENABLED_KEY]: value });
}
