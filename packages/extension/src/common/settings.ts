/**
 * @fileoverview Extension settings and the storage they live in.
 *
 * Every surface (popup, background, content script, page runner) reads the same
 * record, so the shape and its defaults are declared once here.
 */

export interface Settings {
  /** Master switch. Off means the page keeps entry's own runner. */
  enabled: boolean;
  /**
   * How the work reaches tessvm. `tess` sends it through Tess source, which is
   * what tessvm is built to run; `direct` hands the entry work over unchanged.
   */
  pipeline: 'tess' | 'direct';
  /** Drops playentry.org's CSP so the JIT can compile in the page. */
  relaxCsp: boolean;
  /** Frame counter under the stage. */
  showStats: boolean;
  /** Render scale. 1 follows the display, 2 and 4 oversample. */
  quality: 1 | 2 | 4;
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  pipeline: 'tess',
  relaxCsp: false,
  showStats: false,
  quality: 1,
};

export const STORAGE_KEY = 'tessvm-settings';

/** Fills in anything missing or out of range, so a partial record still loads. */
export function normalizeSettings(value: unknown): Settings {
  const raw = (value ?? {}) as Partial<Settings>;
  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : DEFAULT_SETTINGS.enabled,
    pipeline: raw.pipeline === 'direct' ? 'direct' : 'tess',
    relaxCsp: raw.relaxCsp === true,
    showStats: raw.showStats === true,
    quality: raw.quality === 2 || raw.quality === 4 ? raw.quality : 1,
  };
}
