import type { PointerInfo } from '../../core/types.js';
import { constrainToAngle, round } from '../../core/geom.js';
import { ShapeTool } from './shape-base.js';

/** Straight line drawn with the outline colour and width. */
export class LineTool extends ShapeTool {
  readonly name = 'line';

  protected create(): SVGGraphicsElement {
    const color = this.painter.style.stroke ?? this.painter.style.fill ?? '#000000';
    const width = this.painter.style.strokeWidth || this.painter.brush.size;
    const path = this.painter.createPath('', { fill: null, stroke: color, strokeWidth: width });
    path.setAttribute('stroke-linecap', 'round');
    this.painter.dashShape(path, this.painter.lineDash);
    return path;
  }

  protected update(info: PointerInfo, element = this.element): void {
    if (!element) return;
    const end = info.shiftKey
      ? constrainToAngle({ x: info.startX, y: info.startY }, { x: info.x, y: info.y })
      : { x: info.x, y: info.y };
    element.setAttribute(
      'd',
      `M ${round(info.startX, 2)} ${round(info.startY, 2)} L ${round(end.x, 2)} ${round(end.y, 2)}`,
    );
  }
}
