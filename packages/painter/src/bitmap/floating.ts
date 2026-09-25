import type { Rect } from '../core/types.js';

/**
 * A lifted piece of the bitmap that can be moved, scaled and flipped before
 * being stamped back down — the "marching ants" selection of a raster editor.
 */
export class FloatingSelection {
  readonly source: HTMLCanvasElement;
  rect: Rect;
  flipX = false;
  flipY = false;
  /** Set once the pixels have been cut out of the main canvas. */
  lifted = false;

  constructor(source: HTMLCanvasElement, rect: Rect) {
    this.source = source;
    this.rect = { ...rect };
  }

  /** Captures `rect` from `ctx` into a detached canvas. */
  static capture(ctx: CanvasRenderingContext2D, rect: Rect): FloatingSelection | null {
    const x = Math.round(rect.x);
    const y = Math.round(rect.y);
    const w = Math.round(rect.width);
    const h = Math.round(rect.height);
    if (w < 1 || h < 1) return null;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const c = canvas.getContext('2d');
    if (!c) return null;
    c.drawImage(ctx.canvas, x, y, w, h, 0, 0, w, h);
    return new FloatingSelection(canvas, { x, y, width: w, height: h });
  }

  static fromCanvas(source: HTMLCanvasElement, x: number, y: number): FloatingSelection {
    const sel = new FloatingSelection(source, { x, y, width: source.width, height: source.height });
    sel.lifted = true;
    return sel;
  }

  moveBy(dx: number, dy: number): void {
    this.rect = { ...this.rect, x: this.rect.x + dx, y: this.rect.y + dy };
  }

  setRect(rect: Rect): void {
    this.rect = {
      x: rect.x,
      y: rect.y,
      width: Math.max(1, rect.width),
      height: Math.max(1, rect.height),
    };
  }

  /** Erases the original pixels so dragging does not duplicate them. */
  lift(ctx: CanvasRenderingContext2D): void {
    if (this.lifted) return;
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = '#000';
    ctx.fillRect(this.rect.x, this.rect.y, this.rect.width, this.rect.height);
    ctx.restore();
    this.lifted = true;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const { x, y, width, height } = this.rect;
    ctx.save();
    ctx.translate(x + width / 2, y + height / 2);
    ctx.scale(this.flipX ? -1 : 1, this.flipY ? -1 : 1);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.source, -width / 2, -height / 2, width, height);
    ctx.restore();
  }

  clone(): FloatingSelection {
    const canvas = document.createElement('canvas');
    canvas.width = this.source.width;
    canvas.height = this.source.height;
    canvas.getContext('2d')?.drawImage(this.source, 0, 0);
    const copy = new FloatingSelection(canvas, this.rect);
    copy.flipX = this.flipX;
    copy.flipY = this.flipY;
    copy.lifted = this.lifted;
    return copy;
  }

  /** Renders the floating content into a standalone canvas (for the clipboard). */
  toCanvas(): HTMLCanvasElement {
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(this.rect.width));
    out.height = Math.max(1, Math.round(this.rect.height));
    const ctx = out.getContext('2d');
    if (ctx) {
      ctx.save();
      ctx.translate(out.width / 2, out.height / 2);
      ctx.scale(this.flipX ? -1 : 1, this.flipY ? -1 : 1);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.source, -out.width / 2, -out.height / 2, out.width, out.height);
      ctx.restore();
    }
    return out;
  }
}
