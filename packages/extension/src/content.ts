/**
 * @fileoverview Runs at document_start in the isolated world.
 *
 * A work page does not run the work itself — an iframe pointing at `/iframe/<id>`
 * does. That frame is sent to `about:blank` before it can navigate, so neither
 * the entry runner nor the megabytes it pulls in are ever fetched.
 *
 * The emptied frame stays in the layout, hidden: the page sizes the player
 * through `.wrapper iframe { height: … }` rules that change with the viewport,
 * so the frame's own box is what the mount point is laid over. Removing the
 * element instead would both collapse that box and take a node out from under
 * the page's own view code.
 */
import { api, readSettings, ENABLED_KEY, SVG_KEY, MASK_KEY, NOTICE_KEY } from './browser.ts';

const IFRAME_MARK = '/iframe/';
/** `data-tessvm-held` — set on a frame this has already taken over. */
const HELD = 'tessvmHeld';

interface Held {
  frame: HTMLIFrameElement;
  /** The entry runner's own address, put back when the extension is turned off. */
  src: string;
  id: string;
  /** Set when the frame's parent had to be made a positioning root. */
  positioned: boolean;
  parent: HTMLElement | null;
  host: HTMLElement | null;
  anchor: HTMLElement | null;
  visibility: string;
}

let enabled: boolean | null = null;
let svg = true;
let mask = true;
let notice = false;
let injected = false;
const held: Held[] = [];
const byFrame = new WeakMap<HTMLIFrameElement, Held>();

function idOf(src: string): string | null {
  return /\/iframe\/([^/?#]+)/.exec(src)?.[1] ?? null;
}

function hostAfter(frame: HTMLIFrameElement): HTMLElement | null {
  return byFrame.get(frame)?.host ?? null;
}

/** Loads the page-side runner once, into the page's own world. */
function inject(): void {
  if (injected) {
    return;
  }
  injected = true;
  const parent = document.head ?? document.documentElement;
  const style = document.createElement('link');
  style.rel = 'stylesheet';
  style.href = api.runtime.getURL('player.css');
  const script = document.createElement('script');
  script.type = 'module';
  script.src = api.runtime.getURL('page/main.js');
  // A runner that never arrives would leave an empty box and no reason for it.
  script.onerror = () => {
    for (const item of held) {
      const host = hostAfter(item.frame);
      if (host) {
        host.textContent = '실행기를 불러오지 못했습니다. 확장을 다시 불러와 주세요.';
        host.setAttribute('style', 'display:grid;place-items:center;font:13px sans-serif;color:#c0392b');
      }
    }
  };
  parent.append(style, script);
}

function capture(item: Held): void {
  item.frame.style.visibility = 'hidden';
  if (item.frame.getAttribute('src') !== 'about:blank') {
    item.frame.setAttribute('src', 'about:blank');
  }
}

function mount(item: Held): void {
  capture(item);
  if (item.parent !== item.frame.parentElement) removeHost(item);
  if (item.host?.isConnected && item.host.parentElement === item.frame.parentElement) {
    updateHost(item.host);
    return;
  }
  removeHost(item);
  const parent = item.frame.parentElement;
  item.parent = parent;
  if (parent && getComputedStyle(parent).position === 'static') {
    parent.style.position = 'relative';
    item.positioned = true;
  }
  const anchor = document.createElement('span');
  anchor.className = 'tess-frame-anchor';
  anchor.style.display = 'none';

  const host = document.createElement('div');
  host.className = 'tess-host tessvm-host-view';
  host.dataset.tessProject = item.id;
  const group = new URLSearchParams(location.search).get('groupId');
  if (group) {
    host.dataset.tessvmGroup = group;
  }
  item.host = host;
  item.anchor = anchor;
  updateHost(host);
  item.frame.after(anchor, host);
  inject();
}

function updateHost(host: HTMLElement): void {
  for (const [key, value] of Object.entries({ tessvmSvg: svg, tessvmMask: mask, tessvmNotice: notice })) {
    const text = value ? '1' : '0';
    if (host.dataset[key] !== text) host.dataset[key] = text;
  }
}

/** Removes only the nodes and layout changes owned by this frame. */
function removeHost(item: Held): void {
  item.host?.remove();
  item.anchor?.remove();
  item.host = null;
  item.anchor = null;
  if (item.positioned) {
    item.parent?.style.removeProperty('position');
    item.positioned = false;
  }
  item.parent = null;
}

function release(item: Held): void {
  removeHost(item);
  if (item.visibility) item.frame.style.visibility = item.visibility;
  else item.frame.style.removeProperty('visibility');
  if (item.frame.getAttribute('src') !== item.src) {
    item.frame.setAttribute('src', item.src);
  }
}

function applyAll(): void {
  for (let i = held.length - 1; i >= 0; i -= 1) {
    const item = held[i]!;
    if (!item.frame.isConnected) {
      release(item);
      byFrame.delete(item.frame);
      delete item.frame.dataset[HELD];
      held.splice(i, 1);
      continue;
    }
    if (enabled === null) {
      capture(item);
    } else if (enabled) {
      mount(item);
    } else {
      release(item);
    }
  }
}

/**
 * Takes a frame over the moment it shows up. The setting may not have arrived
 * yet — the frame is blanked either way, because a frame that has already begun
 * loading entry cannot be un-loaded, and putting its address back costs nothing.
 */
function hold(frame: HTMLIFrameElement): void {
  const previous = byFrame.get(frame);
  const src = frame.getAttribute('src') ?? '';
  if (previous) {
    if (src !== 'about:blank' && src !== previous.src) {
      const id = idOf(src);
      if (!id) {
        removeHost(previous);
        if (previous.visibility) frame.style.visibility = previous.visibility;
        else frame.style.removeProperty('visibility');
        byFrame.delete(frame);
        held.splice(held.indexOf(previous), 1);
        delete frame.dataset[HELD];
        return;
      }
      previous.src = src;
      if (previous.id !== id) {
        previous.id = id;
        removeHost(previous);
      }
    }
    if (enabled !== false) {
      if (enabled === null) capture(previous);
      else mount(previous);
    }
    return;
  }
  if (!src.includes(IFRAME_MARK)) {
    return;
  }
  const id = idOf(src);
  if (!id) {
    return;
  }
  frame.dataset[HELD] = '1';
  const item: Held = {
    frame, src, id, positioned: false, parent: null, host: null, anchor: null,
    visibility: frame.style.visibility,
  };
  held.push(item);
  byFrame.set(frame, item);
  if (enabled === null) {
    capture(item);
  } else if (enabled) {
    mount(item);
  } else {
    release(item);
  }
}

function sweep(node: Node): void {
  if (node instanceof HTMLIFrameElement) {
    hold(node);
    return;
  }
  if (node instanceof HTMLElement) {
    for (const frame of node.querySelectorAll('iframe')) {
      hold(frame);
    }
  }
}

// The frame is written by the page's own view code, and its address can be set
// either with it or a moment after, so both are watched.
const observer = new MutationObserver((records) => {
  for (const record of records) {
    if (record.type === 'attributes') {
      if (record.target instanceof HTMLIFrameElement) {
        hold(record.target);
      }
      continue;
    }
    for (const node of record.addedNodes) {
      sweep(node);
    }
  }
  applyAll();
});
observer.observe(document, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ['src'],
});
if (document.documentElement) sweep(document.documentElement);

api.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') {
    return;
  }
  if (MASK_KEY in changes) {
    mask = changes[MASK_KEY]?.newValue !== false;
  }
  if (NOTICE_KEY in changes) {
    notice = changes[NOTICE_KEY]?.newValue === true;
  }
  if (SVG_KEY in changes) {
    svg = changes[SVG_KEY]?.newValue !== false;
    // The runner reads this when it starts, so the players have to be built again.
    for (const item of held) {
      removeHost(item);
    }
  }
  if (ENABLED_KEY in changes) {
    enabled = changes[ENABLED_KEY]?.newValue !== false;
  }
  applyAll();
});

void readSettings().then((settings) => {
  enabled = settings.enabled;
  svg = settings.svg;
  mask = settings.mask;
  notice = settings.notice;
  applyAll();
}).catch(() => {
  enabled = true;
  applyAll();
});

/**
 * The runner saves through here. What a work keeps belongs to the extension
 * (`store-db.ts`), which the page's own world cannot reach, so a request is
 * carried to the worker and its answer posted back under the same id.
 */
window.addEventListener('message', (event) => {
  if (event.source !== window) {
    return;
  }
  const data = event.data as { __tessvm?: string; id?: number } | null;
  if (!data || typeof data !== 'object'
      || (data.__tessvm !== 'store-read' && data.__tessvm !== 'store-write')) {
    return;
  }
  const reply = (answer: unknown) => {
    const targetOrigin = location.origin === 'null' ? '*' : location.origin;
    window.postMessage({ __tessvm: 'store-answer', id: data.id, answer }, targetOrigin);
  };
  let sent: Promise<unknown> | undefined;
  try {
    sent = api.runtime.sendMessage?.(data);
  } catch {
    reply({ error: true });
    return;
  }
  if (!sent) {
    reply({ error: true });
    return;
  }
  void sent.then(reply, () => reply({ error: true }));
});
