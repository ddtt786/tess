import type { PointerInfo } from '../../core/types.js';
import { RasterShapeTool } from './shape-base.js';

/** Rectangle; filled or outlined depending on `painter.outlineShapes`. */
export class BitmapRectTool extends RasterShapeTool {
  readonly name = 'rect';

  protected paint(ctx: CanvasRenderingContext2D, info: PointerInfo, ghost: boolean): void {
    const r = this.rectFor(info);
    const w = Math.max(r.width, 0.5);
    const h = Math.max(r.height, 0.5);
    ctx.save();
    this.applyPaint(ctx, ghost);
    if (ghost) {
      ctx.fillRect(r.x, r.y, w, h);
      ctx.lineWidth = 1;
      ctx.strokeRect(r.x, r.y, w, h);
    } else if (this.painter.outlineShapes) {
      ctx.lineWidth = this.lineWidth;
      ctx.lineJoin = 'miter';
      ctx.strokeRect(r.x, r.y, w, h);
    } else {
      ctx.fillRect(r.x, r.y, w, h);
    }
    ctx.restore();
  }
}
