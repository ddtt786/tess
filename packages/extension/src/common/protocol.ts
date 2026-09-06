/**
 * @fileoverview Messages between the page runner and the content script.
 *
 * The runner lives in the page's own world so it can reach `Entry`, which puts
 * the extension APIs out of its reach. Everything it needs from them travels
 * over `window.postMessage`, tagged so the page's own traffic is never mistaken
 * for ours.
 */
import type { Settings } from './settings.ts';

export const CHANNEL = 'tessvm-entry';

/** What the stage badge and the toolbar button show. */
export interface RunnerStatus {
  /** Whether tessvm is the runner on this page right now. */
  active: boolean;
  /** One line for the badge tooltip. */
  detail: string;
  /** Set when the pipeline could not produce a runnable work. */
  error?: string;
}

export type PageMessage =
  | { channel: typeof CHANNEL; from: 'page'; type: 'ready' }
  | { channel: typeof CHANNEL; from: 'page'; type: 'save'; settings: Settings }
  | { channel: typeof CHANNEL; from: 'page'; type: 'status'; status: RunnerStatus };

export type ContentMessage = {
  channel: typeof CHANNEL;
  from: 'content';
  type: 'settings';
  settings: Settings;
};

function tagged(value: unknown, from: string): boolean {
  const message = value as { channel?: unknown; from?: unknown } | null;
  return Boolean(message) && message?.channel === CHANNEL && message?.from === from;
}

export function isPageMessage(value: unknown): value is PageMessage {
  return tagged(value, 'page');
}

export function isContentMessage(value: unknown): value is ContentMessage {
  return tagged(value, 'content');
}
