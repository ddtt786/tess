import type { PointerInfo } from '../../core/types.js';
import { RasterShapeTool } from './shape-base.js';

/** Ellipse; filled or outlined depending on `painter.outlineShapes`. */
export class BitmapEllipseTool extends RasterShapeTool {
  readonly name = 'ellipse';

  protected paint(ctx: CanvasRenderingContext2D, info: PointerInfo, ghost: boolean): void {
    const r = this.rectFor(info);
    ctx.save();
    this.applyPaint(ctx, ghost);
    ctx.beginPath();
    ctx.ellipse(r.x + r.width / 2, r.y + r.height / 2, Math.max(r.width / 2, 0.5), Math.max(r.height / 2, 0.5), 0, 0, Math.PI * 2);
    if (this.painter.outlineShapes && !ghost) {
      ctx.lineWidth = this.lineWidth;
      ctx.stroke();
    } else if (ghost) {
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.stroke();
    } else {
      ctx.fill();
    }
    ctx.restore();
  }
}
