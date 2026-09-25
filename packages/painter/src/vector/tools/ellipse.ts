import type { PointerInfo } from '../../core/types.js';
import { round } from '../../core/geom.js';
import { ShapeTool } from './shape-base.js';

/** Ellipse (hold Shift for a circle, Alt to grow from the centre). */
export class EllipseTool extends ShapeTool {
  readonly name = 'ellipse';

  protected create(): SVGGraphicsElement {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
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
    element.setAttribute('cx', String(round(r.x + r.width / 2, 2)));
    element.setAttribute('cy', String(round(r.y + r.height / 2, 2)));
    element.setAttribute('rx', String(round(Math.max(r.width / 2, 0.01), 2)));
    element.setAttribute('ry', String(round(Math.max(r.height / 2, 0.01), 2)));
  }
}
