/**
 * Drag handle between the side panel and the work area.
 *
 * Dragging well past the narrowest width (under `HIDE_BELOW`) hides the panel;
 * the handle then stays at the left edge, and dragging it out shows the panel again.
 */
import { useEffect } from 'preact/hooks';
import { beginDrag } from './drag.ts';

const KEY = 'tessblock.sideWidth';
const HIDDEN_KEY = 'tessblock.sideHidden';
const MIN = 300;
const MAX = 700;
const DEFAULT_WIDTH = 420;
/** Pointer this far left while resizing means the panel should go, not just shrink. */
const HIDE_BELOW = MIN / 2;

export function Resizer() {
  useEffect(() => {
    const saved = Number(read(KEY));
    applyWidth(Number.isFinite(saved) && saved >= MIN ? saved : DEFAULT_WIDTH);
    setHidden(read(HIDDEN_KEY) === '1');
  }, []);

  function start(event: PointerEvent) {
    event.preventDefault();
    const handle = event.currentTarget as HTMLElement;
    handle.classList.add('dragging');
    beginDrag(event, {
      onMove: (moved) => {
        const hide = moved.clientX < HIDE_BELOW;
        setHidden(hide);
        if (!hide) applyWidth(moved.clientX);
      },
      onEnd: () => {
        handle.classList.remove('dragging');
        write(KEY, String(currentWidth()));
        write(HIDDEN_KEY, isHidden() ? '1' : '0');
      },
    });
  }

  return (
    <div class="resizer" onPointerDown={start} title="너비 조절 (왼쪽 끝까지 끌면 숨기기, 숨긴 뒤에는 끌어서 꺼내기)">
      <span class="resizer-grip" aria-hidden="true" />
    </div>
  );
}

function applyWidth(width: number): void {
  const clamped = Math.min(MAX, Math.max(MIN, Math.round(width)));
  document.documentElement.style.setProperty('--side-w', `${clamped}px`);
}

function currentWidth(): number {
  const value = getComputedStyle(document.documentElement).getPropertyValue('--side-w');
  return Number.parseInt(value, 10) || DEFAULT_WIDTH;
}

function setHidden(hidden: boolean): void {
  if (isHidden() === hidden) return;
  document.documentElement.classList.toggle('side-hidden', hidden);
  // Blockly and the stage measure their hosts on resize.
  window.dispatchEvent(new Event('resize'));
}

function isHidden(): boolean {
  return document.documentElement.classList.contains('side-hidden');
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Without storage the layout lasts for this page only.
  }
}
