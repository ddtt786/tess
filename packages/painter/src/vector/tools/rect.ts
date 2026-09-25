import type { PointerInfo } from '../../core/types.js';
import { round } from '../../core/geom.js';
import { ShapeTool } from './shape-base.js';

/** Rectangle (hold Shift for a square, Alt to grow from the centre). */
export class RectTool extends ShapeTool {
  readonly name = 'rect';

  protected create(): SVGGraphicsElement {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    const { fill, stroke, strokeWidth } = this.painter.style;
    el.setAttribute('fill', fill ?? 'none');
    el.setAttribute('stroke', stroke ?? 'none');
    el.setAttribute('stroke-width', String(strokeWidth));
    el.setAttribute('stroke-linejoin', 'round');
    return this.painter.addItem(el as unknown as SVGGraphicsElement);
  }

  protected update(info: PointerInfo, element = this.element): void {
    if (!element) return;
    const r = this.rectFor(info);
    element.setAttribute('x', String(round(r.x, 2)));
    element.setAttribute('y', String(round(r.y, 2)));
    element.setAttribute('width', String(round(Math.max(r.width, 0.01), 2)));
    element.setAttribute('height', String(round(Math.max(r.height, 0.01), 2)));
  }
}
