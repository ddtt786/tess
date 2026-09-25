import type { Tool } from '../../core/tool.js';
import type { InputPoint, PointerInfo } from '../../core/types.js';
import { ringToCanvasPath, strokeOutline } from '../../core/freehand.js';
import type { BitmapPainter } from '../BitmapPainter.js';

/** Shared freehand plumbing for the raster brush and eraser. */
export abstract class RasterStrokeTool implements Tool {
  abstract readonly name: string;
  readonly cursor = 'crosshair';
  protected points: InputPoint[] = [];
  protected drawing = false;

  constructor(protected readonly painter: BitmapPainter) {}

  deactivate(): void { this.cancel(); }

  onPointerDown(info: PointerInfo): void {
    this.painter.commitFloating();
    this.drawing = true;
    this.points = [{ x: info.x, y: info.y, pressure: info.pressure }];
    this.render(false);
  }

  onPointerMove(info: PointerInfo): void {
    if (!this.drawing) return;
    const last = this.points[this.points.length - 1];
    if (last && Math.hypot(info.x - last.x, info.y - last.y) < 0.35) return;
    this.points.push({ x: info.x, y: info.y, pressure: info.pressure });
    this.render(false);
  }

  onPointerUp(): void {
    if (!this.drawing) return;
    this.drawing = false;
    this.painter.clearOverlay();
    this.render(true);
    this.points = [];
    this.painter.commit();
  }

  cancel(): void {
    this.drawing = false;
    this.points = [];
    this.painter.clearOverlay();
    this.painter.renderOverlay();
  }

  protected path(done: boolean): Path2D | null {
    const outline = strokeOutline(this.points, this.options(), done);
    if (outline.length < 3) return null;
    return ringToCanvasPath(outline);
  }

  protected options() { return this.painter.brush; }
  protected abstract render(done: boolean): void;
}
