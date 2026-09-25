import type { Tool } from '../../core/tool.js';
import type { PointerInfo } from '../../core/types.js';
import { parseColor, rgbaToCss } from '../../core/color.js';
import { floodFill } from '../flood-fill.js';
import type { BitmapPainter } from '../BitmapPainter.js';

/**
 * Bucket fill. A transparent fill clears the region instead of colouring it,
 * and Alt-click samples the colour under the cursor (eyedropper).
 */
export class BitmapFillTool implements Tool {
  readonly name = 'fill';
  readonly cursor = 'crosshair';

  constructor(private readonly painter: BitmapPainter) {}

  onPointerDown(info: PointerInfo): void {
    this.painter.commitFloating();
    const x = Math.floor(info.x);
    const y = Math.floor(info.y);
    if (x < 0 || y < 0 || x >= this.painter.width || y >= this.painter.height) return;

    if (info.altKey) {
      const px = this.painter.ctx.getImageData(x, y, 1, 1).data;
      this.painter.setFill(rgbaToCss({ r: px[0], g: px[1], b: px[2], a: px[3] / 255 }));
      return;
    }

    const image = this.painter.toImageData();
    const changed = floodFill(image, x, y, parseColor(this.painter.style.fill), {
      tolerance: this.painter.fillTolerance,
      contiguous: this.painter.fillContiguous,
    });
    if (!changed) return;
    this.painter.ctx.putImageData(image, 0, 0);
    this.painter.commit();
  }

  onPointerMove(): void {}
  onPointerUp(): void {}
}
