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
}

let enabled: boolean | null = null;
let svg = true;
let mask = true;
let notice = false;
let injected = false;
const held: Held[] = [];

function idOf(src: string): string | null {
  return /\/iframe\/([^/?#]+)/.exec(src)?.[1] ?? null;
}

function hostAfter(frame: HTMLIFrameElement): HTMLElement | null {
  const next = frame.nextElementSibling;
  return next instanceof HTMLElement && next.dataset.tessvmProject ? next : null;
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
  if (hostAfter(item.frame)) {
    return;
  }
  const parent = item.frame.parentElement;
  if (parent && getComputedStyle(parent).position === 'static') {
    parent.style.position = 'relative';
    item.positioned = true;
  }
  const host = document.createElement('div');
  host.className = 'tessvm-host';
  host.dataset.tessvmProject = item.id;
  const group = new URLSearchParams(location.search).get('groupId');
  if (group) {
    host.dataset.tessvmGroup = group;
  }
  host.dataset.tessvmSvg = svg ? '1' : '0';
  host.dataset.tessvmMask = mask ? '1' : '0';
  host.dataset.tessvmNotice = notice ? '1' : '0';
  item.frame.after(host);
  inject();
  window.postMessage({ __tessvm: 'scan' }, location.origin);
}

function release(item: Held): void {
  hostAfter(item.frame)?.remove();
  if (item.positioned) {
    item.frame.parentElement?.style.removeProperty('position');
    item.positioned = false;
  }
  item.frame.style.removeProperty('visibility');
  if (item.frame.getAttribute('src') !== item.src) {
    item.frame.setAttribute('src', item.src);
  }
}

function applyAll(): void {
  for (let i = held.length - 1; i >= 0; i -= 1) {
    const item = held[i]!;
    if (!item.frame.isConnected) {
      held.splice(i, 1);
      continue;
    }
    if (enabled) {
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
  if (frame.dataset[HELD]) {
    return;
  }
  const src = frame.getAttribute('src') ?? '';
  if (!src.includes(IFRAME_MARK)) {
    return;
  }
  const id = idOf(src);
  if (!id) {
    return;
  }
  frame.dataset[HELD] = '1';
  const item: Held = { frame, src, id, positioned: false };
  held.push(item);
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
});
observer.observe(document.documentElement, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ['src'],
});
sweep(document.documentElement);

api.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') {
    return;
  }
  if (MASK_KEY in changes) {
    mask = changes[MASK_KEY]?.newValue !== false;
    window.postMessage({ __tessvm: 'mask', mask }, location.origin);
  }
  if (NOTICE_KEY in changes) {
    notice = changes[NOTICE_KEY]?.newValue === true;
    window.postMessage({ __tessvm: 'notice', notice }, location.origin);
  }
  if (SVG_KEY in changes) {
    svg = changes[SVG_KEY]?.newValue !== false;
    // The runner reads this when it starts, so the players have to be built again.
    window.postMessage({ __tessvm: 'unmount' }, location.origin);
    for (const item of held) {
      hostAfter(item.frame)?.remove();
    }
  }
  if (ENABLED_KEY in changes) {
    enabled = changes[ENABLED_KEY]?.newValue !== false;
  }
  if (!enabled) {
    window.postMessage({ __tessvm: 'unmount' }, location.origin);
  }
  applyAll();
});

void readSettings().then((settings) => {
  enabled = settings.enabled;
  svg = settings.svg;
  mask = settings.mask;
  notice = settings.notice;
  applyAll();
});
