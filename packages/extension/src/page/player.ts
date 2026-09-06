/**
 * @fileoverview The tessvm runner that takes the entry player's place.
 *
 * The stage sits on top and entry's control bar underneath: stop and pause on
 * the left, the pointer position in the middle, the boost flag and full screen
 * on the right. A work that has not started yet shows its thumbnail, and a work
 * that an error brought down goes back to that screen with the message written
 * along the bottom.
 */
import { boot, type TessVmHandle } from '../../../tessvm/src/web/boot.ts';
import { ASK_FIELD_STYLE } from '../../../tessvm/src/web/ask-style.ts';
import { fetchWork } from './entry-project.ts';
import { signedInUser } from './signed-in.ts';

const ICONS = {
  stop: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="3" width="10" height="10" rx="1.5"/></svg>',
  pause:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3.5" y="3" width="3" height="10" rx="1"/>' +
    '<rect x="9.5" y="3" width="3" height="10" rx="1"/></svg>',
  play: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.6 3.1 12.9 8l-8.3 4.9Z"/></svg>',
  enterFull:
    '<svg viewBox="0 0 16 16" aria-hidden="true" class="stroke"><path d="M2.8 6V2.8H6M13.2 6V2.8H10' +
    'M2.8 10v3.2H6M13.2 10v3.2H10"/></svg>',
  exitFull:
    '<svg viewBox="0 0 16 16" aria-hidden="true" class="stroke"><path d="M6 2.8V6H2.8M10 2.8V6h3.2' +
    'M6 13.2V10H2.8M10 13.2V10h3.2"/></svg>',
};

const ASK_STYLE_ID = 'tessvm-ask-style';

export interface MountedPlayer {
  dispose(): void;
  /** The vm reads this each time the block runs, so a live work follows it. */
  setMaskUserId(mask: boolean): void;
}

/** The answer field is tessvm's own, so its look comes with it. */
function ensureAskStyle(): void {
  if (document.getElementById(ASK_STYLE_ID)) {
    return;
  }
  const style = document.createElement('style');
  style.id = ASK_STYLE_ID;
  style.textContent = ASK_FIELD_STYLE;
  (document.head ?? document.documentElement).appendChild(style);
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  parent?: HTMLElement,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  parent?.appendChild(node);
  return node;
}

function iconButton(parent: HTMLElement, className: string, label: string, icon: string) {
  const button = el('button', `tessvm-btn ${className}`, parent);
  button.type = 'button';
  button.title = label;
  button.setAttribute('aria-label', label);
  button.innerHTML = icon;
  return button;
}

/**
 * Builds the player into `host` and loads the work. The returned handle is live
 * from the first call, so a host that goes away mid-load is still cleaned up.
 */
export function mountPlayer(
  host: HTMLElement,
  projectId: string,
  groupId: string | null = null,
  svg = true,
  maskUserId = true,
): MountedPlayer {
  ensureAskStyle();
  // Idle from the start so the cover shows while the work is still on its way.
  const root = el('div', 'tessvm-player is-idle', host);
  // Keys belong to the work only while the player has focus; the page around it
  // has its own text fields.
  root.tabIndex = 0;

  const view = el('div', 'tessvm-view', root);
  const cover = el('div', 'tessvm-cover', view);
  const startButton = el('button', 'tessvm-start', cover);
  startButton.type = 'button';
  // Only once the work is loaded does this do anything, so it stays out of the
  // way until then.
  startButton.hidden = true;
  startButton.title = '시작하기';
  startButton.setAttribute('aria-label', '시작하기');
  startButton.innerHTML = ICONS.play;
  const status = el('div', 'tessvm-status', cover);
  status.textContent = '작품을 불러오는 중…';

  const bar = el('div', 'tessvm-bar', root);
  const left = el('div', 'tessvm-bar-side', bar);
  const stopButton = iconButton(left, 'tessvm-stop', '정지', ICONS.stop);
  const pauseButton = iconButton(left, 'tessvm-pause', '일시정지', ICONS.pause);
  const coords = el('div', 'tessvm-coords', bar);
  const right = el('div', 'tessvm-bar-side tessvm-bar-right', bar);
  const boostLabel = el('label', 'tessvm-boost', right);
  const boostText = el('span', 'tessvm-boost-text', boostLabel);
  boostText.textContent = '부스트모드';
  const boostInput = document.createElement('input');
  boostInput.type = 'checkbox';
  boostInput.checked = true;
  boostLabel.appendChild(boostInput);
  el('span', 'tessvm-switch', boostLabel);
  const fullButton = iconButton(right, 'tessvm-full', '전체화면', ICONS.enterFull);

  const errorBox = el('div', 'tessvm-error', root);
  errorBox.hidden = true;

  let handle: TessVmHandle | null = null;
  let disposed = false;
  let onTick: (() => void) | null = null;

  const showError = (text: string) => {
    errorBox.textContent = text;
    errorBox.hidden = false;
  };
  const clearError = () => {
    errorBox.hidden = true;
    errorBox.textContent = '';
  };

  const dispose = () => {
    if (disposed) {
      return;
    }
    disposed = true;
    clearInterval(timer);
    onTick = null;
    document.removeEventListener('fullscreenchange', onFullscreen);
    handle?.dispose();
    handle = null;
    root.remove();
  };

  function onFullscreen(): void {
    const full = document.fullscreenElement === root;
    fullButton.innerHTML = full ? ICONS.exitFull : ICONS.enterFull;
    fullButton.title = full ? '전체화면 끄기' : '전체화면';
    fullButton.setAttribute('aria-label', fullButton.title);
    root.classList.toggle('is-full', full);
    handle?.relayout();
  }
  document.addEventListener('fullscreenchange', onFullscreen);

  // One beat drives both the readout and the check that the page still holds us:
  // playentry replaces this part of the page on its own when the route changes.
  const timer = window.setInterval(() => {
    if (!host.isConnected) {
      dispose();
      return;
    }
    onTick?.();
  }, 100);

  fullButton.onclick = () => {
    if (document.fullscreenElement === root) {
      void document.exitFullscreen();
    } else {
      void root.requestFullscreen().catch(() => showError('전체화면으로 바꾸지 못했습니다'));
    }
  };

  void load();

  async function load(): Promise<void> {
    let work;
    try {
      work = await fetchWork(projectId, groupId);
    } catch (error) {
      status.textContent = '';
      showError(error instanceof Error ? error.message : String(error));
      return;
    }
    if (disposed) {
      return;
    }
    if (work.thumb) {
      cover.style.backgroundImage = `url("${location.origin}${work.thumb}")`;
    }
    status.textContent = '실행기를 준비하는 중…';

    try {
      handle = await boot({
        project: work,
        container: view,
        autoStart: false,
        keyTarget: root,
        boost: true,
        svg,
        user: signedInUser(),
        maskUserId,
        // Nothing may be pressed until the work's files are all in.
        onProgress: (done, all) => {
          status.textContent = all
            ? `불러오는 중… ${Math.floor((done / all) * 100)}%`
            : '불러오는 중…';
        },
      });
    } catch (error) {
      status.textContent = '';
      showError(error instanceof Error ? error.message : String(error));
      return;
    }
    if (disposed) {
      handle.dispose();
      handle = null;
      return;
    }
    status.textContent = '';
    startButton.hidden = false;
    ready(handle);
  }

  function ready(live: TessVmHandle): void {
    const seen = new Set<string>();
    let shown = '';

    const showState = () => {
      const state = live.vm.state;
      // Only when it really changed. Rewriting the button's markup on every beat
      // takes the node the press landed on out of the document before the release,
      // and the browser then never makes that a click.
      if (state !== shown) {
        shown = state;
        root.classList.toggle('is-idle', state === 'stop');
        root.classList.toggle('is-paused', state === 'pause');
        pauseButton.innerHTML = state === 'pause' ? ICONS.play : ICONS.pause;
        pauseButton.title = state === 'pause' ? '이어서 하기' : '일시정지';
        pauseButton.setAttribute('aria-label', pauseButton.title);
      }
      coords.textContent = `X: ${Math.round(live.vm.mouseX)}  Y: ${Math.round(live.vm.mouseY)}`;
    };
    const start = () => {
      clearError();
      seen.clear();
      live.start();
      root.focus({ preventScroll: true });
      showState();
    };
    const stop = () => {
      live.stop();
      showState();
    };

    // Entry stops the whole work on a script error and pops a toast. The work
    // goes back to its start screen here instead, with the reason written small
    // along the bottom.
    live.vm.onError = (error) => {
      const key = `${error.blockId}:${error.message}`;
      if (!seen.has(key)) {
        seen.add(key);
        const target = error.targetId ? live.vm.targetOf(error.targetId) : null;
        showError(`오류로 멈췄습니다 — ${target ? `${target.name}: ` : ''}${error.message}`);
      }
      if (live.vm.state !== 'stop') {
        stop();
      }
    };

    startButton.onclick = start;
    stopButton.onclick = stop;
    pauseButton.onclick = () => {
      if (live.vm.state === 'run') {
        live.pause();
      } else if (live.vm.state === 'pause') {
        live.start();
      }
      showState();
    };
    boostInput.onchange = () => {
      live.vm.boost = boostInput.checked;
    };
    boostInput.checked = live.vm.boost;

    // The work can stop itself, so the bar follows the vm rather than clicks.
    onTick = showState;
    showState();
  }

  return {
    dispose,
    setMaskUserId(mask: boolean) {
      maskUserId = mask;
      if (handle) {
        handle.vm.maskUserId = mask;
      }
    },
  };
}
