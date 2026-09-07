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
/** Whether a costume drawn as a vector is loaded as one. */
export const SVG_KEY = 'svg';
/** Whether the `아이디` block hides all but the first two letters. */
export const MASK_KEY = 'mask';
/** Whether the runner says which blocks it does not have yet. Off by default. */
export const NOTICE_KEY = 'notice';

export interface Settings {
  enabled: boolean;
  svg: boolean;
  mask: boolean;
  notice: boolean;
}

/** The first three are on unless turned off; the notice is off unless asked for. */
export async function readSettings(): Promise<Settings> {
  const stored = await api.storage.local.get({
    [ENABLED_KEY]: true,
    [SVG_KEY]: true,
    [MASK_KEY]: true,
    [NOTICE_KEY]: false,
  });
  return {
    enabled: stored[ENABLED_KEY] !== false,
    svg: stored[SVG_KEY] !== false,
    mask: stored[MASK_KEY] !== false,
    notice: stored[NOTICE_KEY] === true,
  };
}

export async function write(key: string, value: boolean): Promise<void> {
  await api.storage.local.set({ [key]: value });
}
