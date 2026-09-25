import type { PointerInfo } from '../../core/types.js';
import { constrainToAngle } from '../../core/geom.js';
import { RasterShapeTool } from './shape-base.js';

/** Straight line with round caps (Shift snaps to 15 degree steps). */
export class BitmapLineTool extends RasterShapeTool {
  readonly name = 'line';

  protected paint(ctx: CanvasRenderingContext2D, info: PointerInfo, ghost: boolean): void {
    const start = { x: info.startX, y: info.startY };
    const end = info.shiftKey ? constrainToAngle(start, { x: info.x, y: info.y }) : { x: info.x, y: info.y };
    ctx.save();
    this.applyPaint(ctx, ghost);
    ctx.lineWidth = this.lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
    ctx.restore();
  }
}
