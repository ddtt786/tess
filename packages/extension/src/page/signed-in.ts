/** Reads the current Entry account for the ID and nickname blocks. */
import type { EntryUser } from '../../../tessvm/src/runtime/engine.ts';

interface AccountState {
  common?: {
    user?: { username?: unknown; nickname?: unknown } | null;
  };
}

interface NextPayload {
  props?: { pageProps?: { initialState?: AccountState } };
}

interface ReactNode {
  child?: ReactNode | null;
  sibling?: ReactNode | null;
  stateNode?: { current?: ReactNode };
  memoizedProps?: { store?: { getState?: () => AccountState } };
}

/** Finds the page's Redux state through its mounted React provider. */
function liveState(): AccountState | undefined {
  const root = document.getElementById('__next') as (HTMLElement & {
    _reactRootContainer?: { _internalRoot?: { current?: ReactNode } };
    [key: string]: unknown;
  }) | null;
  if (!root) return undefined;
  const key = Object.keys(root).find(key => key.startsWith('__reactContainer$'));
  const container = key ? root[key] as ReactNode | undefined : undefined;
  const current = container?.stateNode?.current ?? root._reactRootContainer?._internalRoot?.current;
  const pending = current ? [current] : [];
  const seen = new Set<ReactNode>();
  while (pending.length && seen.size < 100) {
    const node = pending.pop()!;
    if (seen.has(node)) continue;
    seen.add(node);
    const store = node.memoizedProps?.store;
    if (typeof store?.getState === 'function') {
      const state = store.getState();
      if (state && typeof state === 'object' && state.common && 'user' in state.common) return state;
    }
    if (node.sibling) pending.push(node.sibling);
    if (node.child) pending.push(node.child);
  }
  return undefined;
}

/** Uses live account state, with the server payload as a pre-hydration fallback. */
export function signedInUser(): EntryUser | null {
  let state: AccountState | undefined;
  try {
    state = liveState();
  } catch {
    // Unsupported React roots fall back to the server payload.
  }
  if (!state) {
    const payload = document.getElementById('__NEXT_DATA__')?.textContent;
    if (!payload) return null;
    try {
      state = (JSON.parse(payload) as NextPayload | null)?.props?.pageProps?.initialState;
    } catch {
      return null;
    }
  }
  const user = state?.common?.user;
  if (!user) return null;
  const id = typeof user.username === 'string' ? user.username : '';
  const nickname = typeof user.nickname === 'string' ? user.nickname : '';
  return id || nickname ? { id, nickname } : null;
}
