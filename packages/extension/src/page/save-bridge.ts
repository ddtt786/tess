/**
 * @fileoverview What the runner saves through, on playentry.
 *
 * The values belong to the extension rather than to the page, so the runner
 * asks the content script and it asks the worker (`background.ts`). Every
 * request carries an id and waits for the answer that comes back with it.
 */
import type { SaveHost, StoredValue } from "../../../tessvm/src/runtime/save.ts";

/** How long an answer is waited for before the call gives up, in milliseconds. */
const TIMEOUT = 5000;

interface Answer {
  values?: Record<string, StoredValue>;
  error?: boolean;
}

const waiting = new Map<number, (answer: Answer) => void>();
let nextId = 1;
let listening = false;

function listen(): void {
  if (listening) {
    return;
  }
  listening = true;
  window.addEventListener("message", (event) => {
    if (event.source !== window) {
      return;
    }
    const data = event.data as { __tessvm?: string; id?: number; answer?: Answer } | null;
    if (!data || data.__tessvm !== "store-answer") {
      return;
    }
    const done = waiting.get(Number(data.id));
    if (done) {
      waiting.delete(Number(data.id));
      done(data.answer ?? {});
    }
  });
}

function ask(message: Record<string, unknown>): Promise<Answer> {
  listen();
  const id = nextId++;
  return new Promise<Answer>((done) => {
    // A content script that never answers (the extension was turned off mid-run)
    // must not leave the work waiting on a save that will not land.
    const timer = window.setTimeout(() => {
      waiting.delete(id);
      done({ error: true });
    }, TIMEOUT);
    waiting.set(id, (answer) => {
      window.clearTimeout(timer);
      done(answer);
    });
    window.postMessage({ ...message, id }, location.origin);
  });
}

/** The store for one work, as the runner's `saveStore` option takes it. */
export function bridgeSaveStore(work: string, title: string): SaveHost {
  return {
    async read() {
      const answer = await ask({ __tessvm: "store-read", work });
      return answer.values ?? {};
    },
    async write(values) {
      await ask({ __tessvm: "store-write", work, title, values });
    },
  };
}
