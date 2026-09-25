import type { Tool } from '../../core/tool.js';
import type { PointerInfo, Rect } from '../../core/types.js';
import { dragRect } from '../../core/geom.js';
import type { VectorPainter } from '../VectorPainter.js';

/** Shared drag-to-create behaviour for the line / ellipse / rectangle tools. */
export abstract class ShapeTool implements Tool {
  abstract readonly name: string;
  readonly cursor = 'crosshair';

  protected element: SVGGraphicsElement | null = null;

  constructor(protected readonly painter: VectorPainter) {}

  deactivate(): void { this.cancel(); }

  onPointerDown(info: PointerInfo): void {
    this.painter.deselect();
    this.element = this.create();
    this.update(info);
  }

  onPointerMove(info: PointerInfo): void {
    if (!this.element) return;
    this.update(info);
  }

  onPointerUp(info: PointerInfo): void {
    const element = this.element;
    this.element = null;
    if (!element) return;
    if (!this.isViable(info)) {
      element.remove();
      return;
    }
    this.update(info, element);
    this.painter.setSelection([element]);
    this.painter.commit();
  }

  cancel(): void {
    this.element?.remove();
    this.element = null;
  }

  protected rectFor(info: PointerInfo): Rect {
    return dragRect({ x: info.startX, y: info.startY }, { x: info.x, y: info.y }, info.shiftKey, info.altKey);
  }

  protected isViable(info: PointerInfo): boolean {
    return Math.hypot(info.x - info.startX, info.y - info.startY) > 1.5;
  }

  protected abstract create(): SVGGraphicsElement;
  protected abstract update(info: PointerInfo, element?: SVGGraphicsElement): void;
}
