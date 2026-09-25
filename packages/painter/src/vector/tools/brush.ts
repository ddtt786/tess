import type { Tool } from '../../core/tool.js';
import type { InputPoint, PointerInfo } from '../../core/types.js';
import { ringToSmoothPathData, strokeOutline } from '../../core/freehand.js';
import { simplifyRings, unionRings } from '../../core/clipper.js';
import type { VectorPainter } from '../VectorPainter.js';

/** Simplification tolerance, in screen pixels. */
const SIMPLIFY_PX = 0.35;

/**
 * Freehand brush. perfect-freehand turns the pointer samples into a closed
 * outline which is committed as a filled `<path>`, so strokes stay editable
 * shapes rather than stroked lines.
 */
export class BrushTool implements Tool {
  readonly name = 'brush';
  readonly cursor = 'crosshair';

  private points: InputPoint[] = [];
  private preview: SVGPathElement | null = null;

  constructor(private readonly painter: VectorPainter) {}

  deactivate(): void { this.cancel(); }

  onPointerDown(info: PointerInfo): void {
    this.painter.deselect();
    this.points = [{ x: info.x, y: info.y, pressure: info.pressure }];
    this.preview = this.painter.createPath('', { fill: this.color(), stroke: null, strokeWidth: 0 });
    this.preview.setAttribute('fill-rule', 'nonzero');
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
    const path = this.preview;
    this.preview = null;
    const outline = strokeOutline(this.points, this.painter.brush, true);
    this.points = [];
    if (outline.length < 3) {
      path.remove();
      return;
    }
    // Resolve self-overlap once so later boolean edits get clean input.
    const cleaned = unionRings([outline]);
    // Drop points that change the outline by less than a screen pixel, so the
    // stroke keeps a node count the reshape tool can edit smoothly.
    const simple = simplifyRings(cleaned.length ? cleaned : [outline], this.painter.screenToSceneLength(SIMPLIFY_PX))
      .filter((ring) => ring.length > 2);
    const rings = simple.length ? simple : cleaned.length ? cleaned : [outline];
    path.setAttribute('d', rings.map((r) => ringToSmoothPathData(r)).join(' '));
    this.painter.setSelection([]);
    this.painter.commit();
  }

  cancel(): void {
    this.preview?.remove();
    this.preview = null;
    this.points = [];
  }

  private render(done: boolean): void {
    if (!this.preview) return;
    const outline = strokeOutline(this.points, this.painter.brush, done);
    this.preview.setAttribute('d', ringToSmoothPathData(outline));
  }

  private color(): string {
    return this.painter.style.fill ?? this.painter.style.stroke ?? '#000000';
  }
}
