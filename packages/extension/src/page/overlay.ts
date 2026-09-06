/**
 * @fileoverview The stage tessvm draws on, laid over entry's own canvas.
 *
 * The host tracks the canvas' rectangle rather than replacing it, so entry's
 * page keeps its layout, its buttons and its full-screen mode, and taking the
 * overlay away leaves the page exactly as it was.
 */

const HOST_ID = 'tessvm-ext-host';
const STYLE_ID = 'tessvm-ext-style';

const STYLE = `
#${HOST_ID} {
  position: fixed; z-index: 1000; display: none; overflow: hidden;
  background: #0b0d12; border-radius: inherit;
  font: 12px/1.5 system-ui, -apple-system, "Malgun Gothic", sans-serif; color: #e8eaee;
}
#${HOST_ID}.tessvm-ext-on { display: block; }
/* A notice sits over entry's own canvas without covering or blocking it, so a
   run that fell back to entry stays visible and playable underneath. */
#${HOST_ID}.tessvm-ext-notice { background: transparent; pointer-events: none; }
#${HOST_ID}.tessvm-ext-notice .tessvm-ext-badge,
#${HOST_ID}.tessvm-ext-notice .tessvm-ext-panel { pointer-events: auto; }
#${HOST_ID} .tessvm-stage {
  position: relative; width: 100%; height: 100%; display: grid; place-items: center;
}
#${HOST_ID} .tessvm-stage canvas { display: block; }
#${HOST_ID} .tessvm-frame { position: relative; }
#${HOST_ID} .tessvm-ask {
  position: absolute; left: 50%; bottom: 6%; transform: translateX(-50%);
  display: flex; gap: 6px; width: min(70%, 520px); margin: 0;
}
#${HOST_ID} .tessvm-ask input {
  flex: 1; font: inherit; padding: 6px 10px; border-radius: 6px;
  border: 2px solid #4f80ff; background: #fff; color: #111;
}
#${HOST_ID} .tessvm-ask button {
  font: inherit; padding: 6px 12px; border-radius: 6px; border: 0;
  background: #4f80ff; color: #fff; cursor: pointer;
}
#${HOST_ID} .tessvm-stats {
  position: absolute; right: 4px; bottom: 2px; color: #8b93a1; font-size: 11px;
  font-variant-numeric: tabular-nums; pointer-events: none; white-space: nowrap;
}
#${HOST_ID} .tessvm-ext-badge {
  position: absolute; top: 6px; left: 6px; display: flex; align-items: center; gap: 6px;
  padding: 3px 8px; border-radius: 999px; border: 1px solid #ffffff26;
  background: #10141bd9; color: #cfd5e1; font-size: 11px; cursor: pointer;
  backdrop-filter: blur(2px);
}
#${HOST_ID} .tessvm-ext-badge:hover { border-color: #ffffff4d; color: #fff; }
#${HOST_ID} .tessvm-ext-dot {
  width: 7px; height: 7px; border-radius: 50%; background: #4ade80; flex: none;
}
#${HOST_ID}.tessvm-ext-busy .tessvm-ext-dot { background: #fbbf24; }
#${HOST_ID}.tessvm-ext-failed .tessvm-ext-dot { background: #f87171; }
#${HOST_ID} .tessvm-ext-panel {
  position: absolute; top: 32px; left: 6px; max-width: min(80%, 420px); max-height: 70%;
  overflow: auto; display: none; padding: 10px 12px; border-radius: 10px;
  border: 1px solid #ffffff1f; background: #10141bf2; color: #cfd5e1;
  white-space: pre-wrap; word-break: break-word;
}
#${HOST_ID}.tessvm-ext-open .tessvm-ext-panel { display: block; }
#${HOST_ID} .tessvm-ext-panel h4 { margin: 0 0 6px; font-size: 12px; color: #fff; }
#${HOST_ID} .tessvm-ext-panel button {
  font: inherit; padding: 4px 10px; border-radius: 6px;
  border: 1px solid #ffffff2e; background: #1c2230; color: #e8eaee; cursor: pointer;
}
#${HOST_ID} .tessvm-ext-panel button:hover:not(:disabled) { background: #262d3d; }
#${HOST_ID} .tessvm-ext-panel button:disabled { opacity: .4; cursor: default; }
#${HOST_ID} .tessvm-ext-controls {
  display: flex; gap: 6px; margin: 10px 0 8px; flex-wrap: wrap;
}
#${HOST_ID} .tessvm-ext-controls button.primary {
  border-color: #4f80ff66; background: #24304d;
}
`;

export type OverlayTone = 'ready' | 'busy' | 'failed';

export class StageOverlay {
  readonly host: HTMLDivElement;
  readonly stage: HTMLDivElement;
  private readonly badgeText: HTMLSpanElement;
  private readonly panel: HTMLDivElement;
  private readonly panelBody: HTMLDivElement;
  private readonly startButton: HTMLButtonElement;
  private readonly pauseButton: HTMLButtonElement;
  private readonly stopButton: HTMLButtonElement;
  private readonly disableButton: HTMLButtonElement;
  private anchor: HTMLElement | null = null;
  private follow = 0;
  private noticeTimer = 0;
  private lastRect = '';

  constructor() {
    injectStyle();
    this.host = document.createElement('div');
    this.host.id = HOST_ID;

    this.stage = document.createElement('div');
    this.stage.className = 'tessvm-ext-mount';
    this.stage.style.width = '100%';
    this.stage.style.height = '100%';
    this.host.appendChild(this.stage);

    const badge = document.createElement('div');
    badge.className = 'tessvm-ext-badge';
    const dot = document.createElement('span');
    dot.className = 'tessvm-ext-dot';
    this.badgeText = document.createElement('span');
    this.badgeText.textContent = 'tessvm';
    badge.append(dot, this.badgeText);
    badge.addEventListener('click', () => this.host.classList.toggle('tessvm-ext-open'));
    this.host.appendChild(badge);

    this.panel = document.createElement('div');
    this.panel.className = 'tessvm-ext-panel';
    const title = document.createElement('h4');
    title.textContent = 'tessvm 실행기';
    this.panelBody = document.createElement('div');

    // tessvm drives the run itself, so the run controls belong to it. Entry's
    // own buttons stay wired as well; both end up in the same place.
    const controls = document.createElement('div');
    controls.className = 'tessvm-ext-controls';
    this.startButton = makeButton('시작하기', 'primary');
    this.pauseButton = makeButton('일시정지');
    this.stopButton = makeButton('정지하기');
    controls.append(this.startButton, this.pauseButton, this.stopButton);

    this.disableButton = makeButton('엔트리 실행기로 되돌리기');
    this.panel.append(title, this.panelBody, controls, this.disableButton);
    this.host.appendChild(this.panel);

    document.body.appendChild(this.host);
  }

  /** Follows this element's rectangle until told otherwise. */
  attachTo(anchor: HTMLElement): void {
    this.anchor = anchor;
    this.reposition();
    if (this.follow) return;
    this.follow = window.setInterval(() => this.reposition(), 120);
    window.addEventListener('resize', this.reposition);
    window.addEventListener('scroll', this.reposition, true);
    document.addEventListener('fullscreenchange', this.reposition);
  }

  private reposition = (): void => {
    if (!this.anchor?.isConnected) return;
    const rect = this.anchor.getBoundingClientRect();
    const key = `${rect.top}|${rect.left}|${rect.width}|${rect.height}`;
    if (key === this.lastRect) return;
    this.lastRect = key;
    this.host.style.top = `${rect.top}px`;
    this.host.style.left = `${rect.left}px`;
    this.host.style.width = `${rect.width}px`;
    this.host.style.height = `${rect.height}px`;
  };

  show(): void {
    this.reposition();
    this.host.classList.remove('tessvm-ext-notice');
    this.host.classList.add('tessvm-ext-on');
  }

  /**
   * Says something without taking the stage: entry's canvas stays visible and
   * clickable underneath, which is what the page falls back to.
   */
  notice(anchor: HTMLElement, label: string, lines: string[], tone: OverlayTone = 'failed'): void {
    this.stage.replaceChildren();
    this.attachTo(anchor);
    this.reposition();
    this.host.classList.add('tessvm-ext-on', 'tessvm-ext-notice');
    this.setStatus(label, tone);
    this.setDetail(lines);
    this.openPanel();
    if (this.noticeTimer) clearTimeout(this.noticeTimer);
    this.noticeTimer = window.setTimeout(() => {
      this.noticeTimer = 0;
      if (this.host.classList.contains('tessvm-ext-notice')) this.hide();
    }, 10000);
  }

  hide(): void {
    if (this.noticeTimer) {
      clearTimeout(this.noticeTimer);
      this.noticeTimer = 0;
    }
    this.host.classList.remove('tessvm-ext-on', 'tessvm-ext-open', 'tessvm-ext-notice');
  }

  get visible(): boolean {
    return this.host.classList.contains('tessvm-ext-on');
  }

  setStatus(label: string, tone: OverlayTone): void {
    this.badgeText.textContent = label;
    this.host.classList.toggle('tessvm-ext-busy', tone === 'busy');
    this.host.classList.toggle('tessvm-ext-failed', tone === 'failed');
  }

  setDetail(lines: string[]): void {
    this.panelBody.textContent = lines.join('\n');
  }

  /** Opens the panel by itself, for something the user has to see. */
  openPanel(): void {
    this.host.classList.add('tessvm-ext-open');
  }

  onDisable(handler: () => void): void {
    this.disableButton.addEventListener('click', handler);
  }

  /** Wires the run controls to whatever is driving tessvm. */
  onTransport(handlers: {
    start: () => void;
    pause: () => void;
    stop: () => void;
  }): void {
    this.startButton.addEventListener('click', handlers.start);
    this.pauseButton.addEventListener('click', handlers.pause);
    this.stopButton.addEventListener('click', handlers.stop);
  }

  /** Greys out the controls that would do nothing in the state tessvm is in. */
  setTransport(state: 'stopped' | 'running' | 'paused'): void {
    this.startButton.textContent = state === 'paused' ? '이어하기' : '시작하기';
    this.startButton.disabled = state === 'running';
    this.pauseButton.disabled = state !== 'running';
    this.stopButton.disabled = state === 'stopped';
  }

  dispose(): void {
    if (this.noticeTimer) {
      clearTimeout(this.noticeTimer);
      this.noticeTimer = 0;
    }
    if (this.follow) {
      clearInterval(this.follow);
      this.follow = 0;
    }
    window.removeEventListener('resize', this.reposition);
    window.removeEventListener('scroll', this.reposition, true);
    document.removeEventListener('fullscreenchange', this.reposition);
    this.host.remove();
  }
}

function makeButton(label: string, className = ''): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  if (className) button.className = className;
  return button;
}

function injectStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLE;
  (document.head ?? document.documentElement).appendChild(style);
}
