import type { Tool } from '../../core/tool.js';
import type { PointerInfo, Rect } from '../../core/types.js';
import { dragRect } from '../../core/geom.js';
import type { BitmapPainter } from '../BitmapPainter.js';

/** Drag-to-create behaviour for the raster line / ellipse / rectangle tools. */
export abstract class RasterShapeTool implements Tool {
  abstract readonly name: string;
  readonly cursor = 'crosshair';
  protected active = false;

  constructor(protected readonly painter: BitmapPainter) {}

  deactivate(): void { this.cancel(); }

  onPointerDown(info: PointerInfo): void {
    this.painter.commitFloating();
    this.active = true;
    this.preview(info);
  }

  onPointerMove(info: PointerInfo): void {
    if (!this.active) return;
    this.preview(info);
  }

  onPointerUp(info: PointerInfo): void {
    if (!this.active) return;
    this.active = false;
    this.painter.clearOverlay();
    if (!this.isViable(info)) {
      this.painter.renderOverlay();
      return;
    }
    this.paint(this.painter.ctx, info, false);
    this.painter.commit();
  }

  cancel(): void {
    this.active = false;
    this.painter.clearOverlay();
    this.painter.renderOverlay();
  }

  protected preview(info: PointerInfo): void {
    this.painter.clearOverlay();
    // `destination-out` on the (empty) overlay would show nothing, so a
    // transparent shape previews as a dashed outline instead.
    this.paint(this.painter.overlayCtx, info, this.painter.isTransparentPaint);
  }

  /** Sets up fill/stroke for a real paint pass or for the ghost preview. */
  protected applyPaint(ctx: CanvasRenderingContext2D, ghost: boolean): void {
    if (!ghost) {
      this.painter.usePaint(ctx);
      return;
    }
    ctx.fillStyle = 'rgba(47, 109, 246, 0.14)';
    ctx.strokeStyle = '#2f6df6';
    ctx.setLineDash([6, 4]);
  }

  protected rectFor(info: PointerInfo): Rect {
    return dragRect({ x: info.startX, y: info.startY }, { x: info.x, y: info.y }, info.shiftKey, info.altKey);
  }

  protected isViable(info: PointerInfo): boolean {
    return Math.hypot(info.x - info.startX, info.y - info.startY) > 1;
  }

  protected get lineWidth(): number {
    return Math.max(1, this.painter.style.strokeWidth || this.painter.brush.size);
  }

  protected abstract paint(ctx: CanvasRenderingContext2D, info: PointerInfo, ghost: boolean): void;
}
