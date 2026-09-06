/**
 * @fileoverview Who is signed in to playentry.org, for the `아이디` · `닉네임` blocks.
 *
 * Entry's own runner reads `window.user`, which the site fills in for its own
 * page. The runner here lives in the same page but not in the same script, so
 * it takes the same record from the next.js payload the page was rendered with.
 */
import type { EntryUser } from '../../../tessvm/src/runtime/engine.ts';

const PAYLOAD_ID = '__NEXT_DATA__';

interface NextPayload {
  props?: {
    pageProps?: {
      initialState?: {
        common?: {
          user?: { username?: unknown; nickname?: unknown } | null;
        };
      };
    };
  };
}

/**
 * The signed-in reader, or null when nobody is. The payload is missing on pages
 * next.js did not render and its shape is the site's to change, so every step
 * is treated as absent rather than trusted.
 */
export function signedInUser(): EntryUser | null {
  const payload = document.getElementById(PAYLOAD_ID)?.textContent;
  if (!payload) {
    return null;
  }
  let data: NextPayload;
  try {
    data = JSON.parse(payload) as NextPayload;
  } catch {
    return null;
  }
  const user = data.props?.pageProps?.initialState?.common?.user;
  if (!user) {
    return null;
  }
  const id = typeof user.username === 'string' ? user.username : '';
  const nickname = typeof user.nickname === 'string' ? user.nickname : '';
  // A record with neither name is nobody — the site leaves an empty one behind
  // on a page it rendered before the sign-in was known.
  return id || nickname ? { id, nickname } : null;
}
