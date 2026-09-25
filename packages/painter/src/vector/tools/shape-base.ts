import type { Tool } from '../../core/tool.js';
import type { PointerInfo, Rect } from '../../core/types.js';
import { dragRect } from '../../core/geom.js';
import type { VectorPainter } from '../VectorPainter.js';
import { SelectTool } from './select.js';

/** Shared drag-to-create behaviour for the line / ellipse / rectangle tools. */
export abstract class ShapeTool implements Tool {
  abstract readonly name: string;
  readonly cursor = 'crosshair';

  protected element: SVGGraphicsElement | null = null;

  /** The shape just drawn stays selected: pressing it or its handles moves, scales or rotates it. */
  private readonly select: SelectTool;
  private editing = false;

  constructor(protected readonly painter: VectorPainter) {
    this.select = new SelectTool(painter);
  }

  deactivate(): void { this.cancel(); }

  /** Whether a press lands on the current selection or one of its handles. */
  private onSelection(info: PointerInfo): boolean {
    const selection = this.painter.selection;
    if (!selection.length) return false;
    if (this.painter.hitHandle(info.clientX, info.clientY)) return true;
    const hit = this.painter.hitTest(info.clientX, info.clientY, 3, { includeUnfilled: true, keepLayer: true });
    return !!hit && selection.includes(hit.item);
  }

  onPointerHover(info: PointerInfo): void {
    if (this.onSelection(info)) this.select.onPointerHover(info);
    else this.painter.setCursor(this.cursor);
  }

  onPointerDown(info: PointerInfo): void {
    if (!info.shiftKey && this.onSelection(info)) {
      this.editing = true;
      this.select.onPointerDown(info);
      return;
    }
    this.painter.deselect();
    this.element = this.create();
    this.update(info);
  }

  onPointerMove(info: PointerInfo): void {
    if (this.editing) {
      this.select.onPointerMove(info);
      return;
    }
    if (!this.element) return;
    this.update(info);
  }

  onPointerUp(info: PointerInfo): void {
    if (this.editing) {
      this.editing = false;
      this.select.onPointerUp(info);
      return;
    }
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
    if (this.editing) {
      this.editing = false;
      this.select.cancel();
    }
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
