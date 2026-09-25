import { RasterStrokeTool } from './stroke-base.js';

/**
 * Raster brush. The silhouette comes from perfect-freehand, exactly like the
 * vector brush, so both surfaces produce the same stroke shape. A transparent
 * fill turns the brush into an eraser, which is what "paint with nothing" means
 * on a raster canvas.
 */
export class BitmapBrushTool extends RasterStrokeTool {
  readonly name = 'brush';

  protected render(done: boolean): void {
    const transparent = this.painter.isTransparentPaint;
    // `destination-out` is idempotent, so a transparent stroke can be applied
    // straight to the canvas and re-applied on every sample.
    const path = this.path(transparent ? false : done);
    if (!path) return;
    const ctx = transparent || done ? this.painter.ctx : this.painter.overlayCtx;
    if (!transparent && !done) this.painter.clearOverlay();
    ctx.save();
    this.painter.usePaint(ctx);
    ctx.fill(path, 'nonzero');
    ctx.restore();
  }
}
