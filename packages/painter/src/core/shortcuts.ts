export interface ZoomTarget {
  zoomIn(): void;
  zoomOut(): void;
  resetZoom(): void;
  zoomToFit(): void;
}

/**
 * Browser shortcuts the painter swallows while it has focus, so the page never
 * zooms, saves or prints out from under a drawing. Ctrl/Cmd + `=`/`-`/`0`/`9`
 * are re-bound to the canvas zoom instead.
 */
const SWALLOWED = new Set(['s', 'p', 'o', 'u', '=', '+', '-', '_', '0', '9']);

/**
 * The key a shortcut is matched on: letters and digits by their physical key,
 * so Shift (`G`) and a Korean input mode (`ㅎ`) still read as `g`; everything
 * else (Delete, arrows, `=`) as `event.key`.
 */
export function shortcutKey(event: KeyboardEvent): string {
  const code = event.code ?? '';
  if (code.startsWith('Key')) return code.slice(3).toLowerCase();
  if (code.startsWith('Digit')) return code.slice(5);
  return event.key.length === 1 ? event.key.toLowerCase() : event.key;
}

/**
 * Handles the view/browser shortcuts shared by both surfaces.
 * Returns `true` when the event was consumed (the caller should `preventDefault`).
 */
export function handleViewShortcut(event: KeyboardEvent, target: ZoomTarget, swallow = true): boolean {
  if (!event.ctrlKey && !event.metaKey) return false;
  const key = shortcutKey(event);
  switch (key) {
    case '=':
    case '+':
      target.zoomIn();
      return true;
    case '-':
    case '_':
      target.zoomOut();
      return true;
    case '0':
      target.resetZoom();
      return true;
    case '9':
      target.zoomToFit();
      return true;
    default:
      return swallow && SWALLOWED.has(key);
  }
}
