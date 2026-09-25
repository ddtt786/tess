import type { Tool } from '../../core/tool.js';
import type { InputPoint, PointerInfo } from '../../core/types.js';
import { ringToSmoothPathData, strokeOutline } from '../../core/freehand.js';
import { unionRings } from '../../core/clipper.js';
import type { VectorPainter } from '../VectorPainter.js';

/**
 * Vector eraser: the swept area is produced by perfect-freehand and then
 * subtracted from every item it touches with clipper2, so shapes really lose
 * the erased region (holes included) instead of being masked.
 */
export class EraserTool implements Tool {
  readonly name = 'eraser';
  readonly cursor = 'crosshair';

  private points: InputPoint[] = [];
  private preview: SVGPathElement | null = null;

  constructor(private readonly painter: VectorPainter) {}

  deactivate(): void { this.cancel(); }

  onPointerDown(info: PointerInfo): void {
    this.painter.deselect();
    this.points = [{ x: info.x, y: info.y, pressure: info.pressure }];
    this.painter.suppressOverlay = true;
    this.painter.clearOverlay();
    this.preview = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    this.preview.setAttribute('class', 'pt-eraser-preview');
    this.preview.setAttribute('stroke-width', String(1 / this.painter.zoom));
    this.painter.overlay.node.appendChild(this.preview);
    this.render(false);
  }

  onPointerMove(info: PointerInfo): void {
    if (!this.preview) return;
    const last = this.points[this.points.length - 1];
    if (last && Math.hypot(info.x - last.x, info.y - last.y) < 0.2) return;
    this.points.push({ x: info.x, y: info.y, pressure: info.pressure });
    this.render(false);
  }

  onPointerUp(): void {
    if (!this.preview) return;
    this.preview.remove();
    this.preview = null;
    this.painter.suppressOverlay = false;

    const outline = strokeOutline(this.points, this.brushOptions(), true);
    this.points = [];
    if (outline.length < 3) {
      this.painter.refreshOverlay();
      return;
    }
    const cleaned = unionRings([outline]);
    this.painter.subtractFromItems(cleaned.length ? cleaned : [outline]);
    this.painter.refreshOverlay();
  }

  cancel(): void {
    this.preview?.remove();
    this.preview = null;
    this.points = [];
    this.painter.suppressOverlay = false;
  }

  private render(done: boolean): void {
    if (!this.preview) return;
    const outline = strokeOutline(this.points, this.brushOptions(), done);
    this.preview.setAttribute('d', ringToSmoothPathData(outline));
  }

  /** The eraser ignores pressure thinning so its footprint is predictable. */
  private brushOptions() {
    return { ...this.painter.brush, thinning: 0, simulatePressure: false };
  }
}
