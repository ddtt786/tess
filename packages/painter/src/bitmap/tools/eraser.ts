import { RasterStrokeTool } from './stroke-base.js';

/**
 * Raster eraser. `destination-out` is idempotent, so the in-progress stroke can
 * be applied straight to the canvas for a true live preview.
 */
export class BitmapEraserTool extends RasterStrokeTool {
  readonly name = 'eraser';

  protected render(_done: boolean): void {
    const path = this.path(false);
    if (!path) return;
    const ctx = this.painter.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = '#000';
    ctx.fill(path, 'nonzero');
    ctx.restore();
  }

  protected override options() {
    return { ...this.painter.brush, thinning: 0, simulatePressure: false };
  }
}
