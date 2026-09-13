/**
 * @fileoverview The page side of `$TESSVM` and the names beside it.
 *
 * The clipboard, the cursor and the pointer are the viewer's, not the work's,
 * so every one of them is asked for before it is taken. The dialog stands over
 * the stage and carries the whole answer in the click on its button: the
 * browser only lets a page write to the clipboard or hold the pointer while it
 * is acting on something the viewer just did, and an answer that came back
 * through a promise is no longer that.
 *
 * What is asked, and how often:
 *
 * | name          | asked                                              |
 * | ------------- | -------------------------------------------------- |
 * | `$CLIPBOARD`  | every copy, and no more than one a second           |
 * | `$CURSOR`     | only for `none`, once for as long as the page lives |
 * | `$MOUSE_LOCK` | every time it is taken, once per run                |
 *
 * Pasting is not asked about: the viewer pasting *is* the answer, and nothing
 * is read from the clipboard until they do.
 */
import { stage } from '../runtime/model.ts';
import type { PixiRenderer } from '../render/renderer.ts';
import type { Vm } from '../runtime/engine.ts';

/** The shortest gap between two copies, in milliseconds. */
const COPY_INTERVAL = 1000;
/** How much of the text to put in the dialog's own box. */
const DETAIL_LIMIT = 20_000;
/** Wheel units per notch, by `WheelEvent.deltaMode`: pixels, lines, pages. */
const WHEEL_UNITS = [100, 3, 1];

export const EXTRAS_DIALOG_STYLE = `
/* The ask field and the chart window are drawn to stage units because entry
   draws them inside its canvas. This is not one of those: it is the runner
   talking to the viewer, so it keeps ordinary pixel sizes at every stage size —
   scaled to a small embedded stage its buttons came out a few pixels tall.
   Every rule also outweighs the host page's own button reset. */
.tessvm-ask-permission {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: grid;
  place-items: center;
  padding: 16px;
  box-sizing: border-box;
  background: rgba(23, 26, 33, 0.45);
  backdrop-filter: blur(3px);
  font-family: 'Nanum Gothic', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 14px;
  line-height: normal;
  animation: tessvm-permit-in 0.14s ease-out;
}

.tessvm-ask-permission[hidden] { display: none !important; }

@keyframes tessvm-permit-in { from { opacity: 0; } to { opacity: 1; } }

.tessvm-ask-permission .tessvm-permit-card {
  width: min(100%, 400px);
  max-height: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 0;
  padding: 22px 22px 18px;
  box-sizing: border-box;
  background: #fff;
  color: #2c313d;
  border: 0;
  border-radius: 16px;
  box-shadow: 0 18px 40px rgba(16, 19, 26, 0.28);
  animation: tessvm-permit-rise 0.16s cubic-bezier(0.2, 0.8, 0.3, 1);
}

@keyframes tessvm-permit-rise {
  from { transform: translateY(12px) scale(0.98); }
  to { transform: none; }
}

.tessvm-ask-permission h2 {
  margin: 0;
  font-size: 17px;
  font-weight: 700;
  line-height: 1.35;
  color: inherit;
}

.tessvm-ask-permission p {
  margin: 0;
  font-size: 13.5px;
  line-height: 1.6;
  color: #5a616e;
  white-space: pre-line;
}

.tessvm-ask-permission details {
  min-height: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid #e4e6eb;
  border-radius: 10px;
  overflow: hidden;
}

.tessvm-ask-permission summary {
  flex: none;
  padding: 8px 12px;
  font-size: 12.5px;
  line-height: 1.5;
  color: #5a616e;
  cursor: pointer;
  user-select: none;
  list-style: none;
}

.tessvm-ask-permission summary::-webkit-details-marker { display: none; }
.tessvm-ask-permission summary::before { content: '▸ '; }
.tessvm-ask-permission details[open] summary::before { content: '▾ '; }
.tessvm-ask-permission summary:hover { background: #f5f6f8; }

.tessvm-ask-permission pre {
  flex: 1 1 auto;
  min-height: 0;
  max-height: 130px;
  margin: 0;
  padding: 10px 12px;
  overflow: auto;
  overscroll-behavior: contain;
  border-top: 1px solid #e4e6eb;
  background: #f7f8fa;
  color: #2c313d;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.55;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.tessvm-ask-permission .tessvm-permit-buttons {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 2px;
}

.tessvm-ask-permission button {
  min-width: 78px;
  min-height: 38px;
  margin: 0;
  padding: 9px 16px;
  box-sizing: border-box;
  font-family: inherit;
  font-size: 13.5px;
  font-weight: 700;
  line-height: 1.4;
  border: 0;
  border-radius: 9px;
  cursor: pointer;
  transition: background-color 0.12s ease-out;
}

.tessvm-ask-permission .tessvm-permit-deny { background: #eef0f3; color: #5a616e; }
.tessvm-ask-permission .tessvm-permit-deny:hover { background: #e2e5ea; }
.tessvm-ask-permission .tessvm-permit-allow { background: #4f80ff; color: #fff; }
.tessvm-ask-permission .tessvm-permit-allow:hover { background: #3c6df2; }
.tessvm-ask-permission button:focus-visible {
  outline: 2px solid #1b4bd8;
  outline-offset: 2px;
}
`;

interface Request {
  title: string;
  body: string;
  /** Shown folded away, in a box of its own. Left out, there is no box. */
  detail?: string;
  confirm: string;
  /** Run inside the click on the button, so the browser still counts it. */
  answer(allowed: boolean): void;
}

interface Dialog {
  /** False when one already stands — the answer is never asked for twice at once. */
  ask(request: Request): boolean;
  readonly open: boolean;
  dispose(): void;
}

/** The dialog itself. One element, reused for every question. */
function makeDialog(parent: HTMLElement): Dialog {
  const root = document.createElement('div');
  root.className = 'tessvm-ask-permission';
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');

  const card = document.createElement('div');
  card.className = 'tessvm-permit-card';
  const heading = document.createElement('h2');
  const body = document.createElement('p');
  const details = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = '내용 보기';
  const content = document.createElement('pre');
  details.append(summary, content);
  const buttons = document.createElement('div');
  buttons.className = 'tessvm-permit-buttons';
  const deny = document.createElement('button');
  deny.type = 'button';
  deny.className = 'tessvm-permit-deny';
  deny.textContent = '취소';
  const allow = document.createElement('button');
  allow.type = 'button';
  allow.className = 'tessvm-permit-allow';
  card.append(heading, body, details, buttons);
  buttons.append(deny, allow);
  root.appendChild(card);
  parent.appendChild(root);

  let pending: Request | null = null;

  const close = (allowed: boolean) => {
    const request = pending;
    pending = null;
    root.hidden = true;
    content.textContent = '';
    request?.answer(allowed);
  };
  allow.addEventListener('click', () => close(true));
  deny.addEventListener('click', () => close(false));
  // The keys are the dialog's while it stands: the work reads them off the
  // window, and one that got through here would reach it as a press.
  card.addEventListener('keydown', (event) => {
    event.stopPropagation();
    if (event.key === 'Escape') {
      close(false);
    }
  });

  return {
    get open() {
      return pending !== null;
    },
    ask(request) {
      if (pending) {
        return false;
      }
      pending = request;
      heading.textContent = request.title;
      body.textContent = request.body;
      allow.textContent = request.confirm;
      const detail = request.detail ?? '';
      details.hidden = detail === '';
      details.open = false;
      // A work can hold a novel in one variable; the whole of it is copied,
      // only the look at it is cut short.
      content.textContent =
        detail.length > DETAIL_LIMIT
          ? `${detail.slice(0, DETAIL_LIMIT)}\n… ${detail.length - DETAIL_LIMIT}자 더`
          : detail;
      root.hidden = false;
      allow.focus({ preventScroll: true });
      return true;
    },
    dispose() {
      pending = null;
      root.remove();
    },
  };
}

export interface ExtrasBinding {
  /** Cursor the work asked for, `''` when it has asked for none. */
  cursor(): string;
  dispose(): void;
}

/**
 * Hands the vm's extras a page to act on and listens for what the viewer does.
 *
 * `frame` is where the dialog goes — the box the canvas is in, so it scales
 * with the stage; `view` is what the wheel and the pointer are read from.
 */
export function bindExtras(
  vm: Vm,
  renderer: PixiRenderer,
  frame: HTMLElement,
  view: HTMLElement,
  cleanups: Array<() => void>,
): ExtrasBinding {
  const extras = vm.extras;
  const dialog = makeDialog(frame);
  const on = <T extends EventTarget>(
    target: T,
    type: string,
    handler: EventListener,
    options?: AddEventListenerOptions,
  ) => {
    target.addEventListener(type, handler, options);
    cleanups.push(() => target.removeEventListener(type, handler, options));
  };

  /** What the work last asked the cursor to be, already checked against the keywords. */
  let wanted = '';
  /** The answer for `none`, once it has been given. Kept for the life of the page. */
  let hideAllowed: boolean | null = null;
  /** Set while the run has been allowed to hold the pointer. */
  let lockAllowed = false;
  let lastCopy = 0;

  extras.host = {
    copy(text) {
      const now = performance.now();
      if (text === '' || dialog.open || now - lastCopy < COPY_INTERVAL) {
        return;
      }
      lastCopy = now;
      dialog.ask({
        title: '클립보드 복사',
        body: '작품이 클립보드에 내용을 복사하려고 합니다.',
        detail: text,
        confirm: '복사',
        answer: (allowed) => {
          if (allowed) {
            void navigator.clipboard?.writeText(text).catch(() => undefined);
          }
        },
      });
    },

    cursor(value) {
      if (value !== 'none') {
        wanted = value;
        return;
      }
      if (hideAllowed !== null) {
        wanted = hideAllowed ? 'none' : '';
        return;
      }
      dialog.ask({
        title: '마우스 포인터 감추기',
        body: '작품이 무대 위에서 마우스 포인터를 감추려고 합니다.\n포인터는 무대 밖으로 나가면 다시 보입니다.',
        confirm: '감추기',
        answer: (allowed) => {
          hideAllowed = allowed;
          wanted = allowed ? 'none' : '';
        },
      });
    },

    lock(on) {
      if (!on) {
        if (document.pointerLockElement === view) {
          document.exitPointerLock();
        }
        return;
      }
      if (document.pointerLockElement === view) {
        return;
      }
      if (lockAllowed) {
        request();
        return;
      }
      // A question already standing is left to be answered; the work asking
      // again next frame finds it there.
      dialog.ask({
        title: '마우스 잠금',
        body: '작품이 마우스 포인터를 무대 안에 가두려고 합니다.\nEsc 키를 누르면 언제든 빠져나올 수 있습니다.',
        confirm: '허용',
        answer: (allowed) => {
          lockAllowed = allowed;
          if (allowed) {
            request();
          } else {
            extras.lockChanged(false);
          }
        },
      });
    },

    release() {
      wanted = '';
      lockAllowed = false;
      if (document.pointerLockElement === view) {
        document.exitPointerLock();
      }
    },
  };

  /** A refused lock is not an error to report — the work is told it has none. */
  const request = () => {
    const result = view.requestPointerLock() as unknown as Promise<void> | undefined;
    void result?.catch?.(() => extras.lockChanged(false));
  };

  /**
   * Whether a paste was meant for the work. The listener is on the window
   * because the player is not an input and never gets the event itself, and the
   * page around it — a comment box on playentry.org — has pastes of its own.
   */
  const ours = (target: EventTarget | null): boolean => {
    if (target instanceof Node && view.contains(target)) {
      return true;
    }
    const active = document.activeElement;
    return !active || active === document.body || view.contains(active);
  };

  on(window, 'paste', (raw) => {
    const event = raw as ClipboardEvent;
    if (!extras.uses.clipboard || dialog.open || !ours(event.target)) {
      return;
    }
    const text = event.clipboardData?.getData('text/plain');
    if (text) {
      extras.pasted(text);
    }
  });

  on(
    view,
    'wheel',
    (raw) => {
      if (!extras.uses.scroll || vm.state !== 'run') {
        return;
      }
      const event = raw as WheelEvent;
      const unit = WHEEL_UNITS[event.deltaMode] ?? WHEEL_UNITS[0]!;
      // The stage counts y upwards and the wheel counts it down.
      extras.scrolled(event.deltaX / unit, -event.deltaY / unit);
      // The work is reading the wheel, so the page does not also scroll under it.
      event.preventDefault();
    },
    { passive: false },
  );

  on(document, 'pointerlockchange', () => {
    extras.lockChanged(document.pointerLockElement === view);
  });
  on(document, 'pointerlockerror', () => extras.lockChanged(false));
  on(document, 'mousemove', (raw) => {
    if (document.pointerLockElement !== view) {
      return;
    }
    const event = raw as MouseEvent;
    const rect = renderer.canvasRect();
    // Movement is given in css pixels; the work counts in stage units, and the
    // stage counts y upwards.
    const perX = rect.width ? stage.width / rect.width : 1;
    const perY = rect.height ? stage.height / rect.height : 1;
    extras.moved(event.movementX * perX, -event.movementY * perY);
  });

  return {
    cursor: () => wanted,
    dispose: () => {
      extras.host = null;
      dialog.dispose();
    },
  };
}
