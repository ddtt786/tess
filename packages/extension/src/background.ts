/**
 * @fileoverview The extension's own worker: it keeps what the works save.
 *
 * The runner lives in the page's world and cannot reach extension storage, so
 * it asks through the content script and this answers. Keeping the values here
 * rather than in the page is what lets the settings panel show and throw away
 * what a work saved (`store-db.ts`).
 */
import { api } from './browser.ts';
import { readWork, writeWork, type StoredValue } from './store-db.ts';

/** What the page asks for, relayed by the content script. */
export interface StoreRequest {
  __tessvm: 'store-read' | 'store-write';
  work: string;
  title?: string;
  values?: Record<string, StoredValue>;
}

/** Answers one request. Anything else is left to whoever it was meant for. */
export function answer(message: StoreRequest): Promise<unknown> | undefined {
  if (message?.__tessvm === 'store-read') {
    return readWork(message.work).then((values) => ({ values }));
  }
  if (message?.__tessvm === 'store-write') {
    return writeWork(message.work, message.title ?? '', message.values ?? {}).then(() => ({
      ok: true,
    }));
  }
  return undefined;
}

api.runtime.onMessage?.addListener((message, _sender, sendResponse) => {
  const reply = answer(message as StoreRequest);
  if (!reply) {
    return false;
  }
  // The worker may be woken for this alone, so the answer is sent when the
  // write has landed — `true` keeps the channel open until then.
  void reply.then(
    (value) => sendResponse(value),
    () => sendResponse({ error: true }),
  );
  return true;
});
