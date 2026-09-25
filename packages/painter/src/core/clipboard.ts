export interface VectorClip {
  kind: 'vector';
  /** Serialised item markup (`<path .../><g .../>`). */
  svg: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BitmapClip {
  kind: 'bitmap';
  dataURL: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ClipboardPayload = VectorClip | BitmapClip;

/**
 * Module-level clipboard shared by every painter instance, so copy in the
 * vector surface can paste into the bitmap surface and vice versa.
 */
let payload: ClipboardPayload | null = null;
let pasteOffset = 0;

export function setClipboard(next: ClipboardPayload): void {
  payload = next;
  pasteOffset = 0;
}

export function getClipboard(): ClipboardPayload | null {
  return payload;
}

export function hasClipboard(): boolean {
  return payload !== null;
}

export function clearClipboard(): void {
  payload = null;
  pasteOffset = 0;
}

/** Each successive paste is nudged so stacked copies stay visible. */
export function nextPasteOffset(step = 12): number {
  pasteOffset += step;
  return pasteOffset;
}

export function resetPasteOffset(): void {
  pasteOffset = 0;
}
