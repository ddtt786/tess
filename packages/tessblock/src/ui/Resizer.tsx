/** Drag handle between the side panel and the work area. */
import { useEffect } from 'preact/hooks';
import { beginDrag } from './drag.ts';

const KEY = 'tessblock.sideWidth';
const MIN = 300;
const MAX = 700;
const DEFAULT_WIDTH = 420;

export function Resizer() {
  useEffect(() => {
    const saved = Number(localStorage.getItem(KEY));
    if (Number.isFinite(saved) && saved >= MIN) applyWidth(saved);
    else applyWidth(DEFAULT_WIDTH);
  }, []);

  function start(event: PointerEvent) {
    event.preventDefault();
    const handle = event.currentTarget as HTMLElement;
    handle.classList.add('dragging');
    beginDrag(event, {
      onMove: (moved) => applyWidth(moved.clientX),
      onEnd: () => {
        handle.classList.remove('dragging');
        localStorage.setItem(KEY, String(currentWidth()));
      },
    });
  }

  return <div class="resizer" onPointerDown={start} title="너비 조절" />;
}

function applyWidth(width: number): void {
  const clamped = Math.min(MAX, Math.max(MIN, Math.round(width)));
  document.documentElement.style.setProperty('--side-w', `${clamped}px`);
}

function currentWidth(): number {
  const value = getComputedStyle(document.documentElement).getPropertyValue('--side-w');
  return Number.parseInt(value, 10) || DEFAULT_WIDTH;
}
