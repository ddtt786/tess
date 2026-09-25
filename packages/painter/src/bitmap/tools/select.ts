import type { Tool } from '../../core/tool.js';
import type { PointerInfo, Rect } from '../../core/types.js';
import { rectFromCorners } from '../../core/geom.js';
import { FloatingSelection } from '../floating.js';
import type { BitmapPainter } from '../BitmapPainter.js';

/** How close (screen pixels) a moved selection's middle has to come to the canvas middle to catch on it. */
const SNAP_PX = 8;

type Mode = 'idle' | 'marquee' | 'move' | 'scale';

const CURSORS = [
  'nwse-resize', 'ns-resize', 'nesw-resize', 'ew-resize',
  'nwse-resize', 'ns-resize', 'nesw-resize', 'ew-resize',
];

/**
 * Rectangular marquee producing a floating selection that can be dragged,
 * scaled, flipped, copied and deleted before it is stamped back down.
 */
export class BitmapSelectTool implements Tool {
  readonly name = 'select';
  readonly cursor = 'crosshair';

  private mode: Mode = 'idle';
  private handle = -1;
  private startRect: Rect | null = null;

  constructor(private readonly painter: BitmapPainter) {}

  deactivate(): void {
    this.cancel();
    this.painter.commitFloating();
  }

  onPointerDown(info: PointerInfo): void {
    const floating = this.painter.floating;
    if (floating) {
      const handle = this.painter.hitHandle({ x: info.x, y: info.y });
      if (handle >= 0) {
        this.mode = 'scale';
        this.handle = handle;
        this.startRect = { ...floating.rect };
        floating.lift(this.painter.ctx);
        return;
      }
      const r = floating.rect;
      if (info.x >= r.x && info.x <= r.x + r.width && info.y >= r.y && info.y <= r.y + r.height) {
        this.mode = 'move';
        this.startRect = { ...r };
        return;
      }
      this.painter.commitFloating();
    }
    this.mode = 'marquee';
    this.startRect = null;
  }

  onPointerMove(info: PointerInfo): void {
    const floating = this.painter.floating;
    switch (this.mode) {
      case 'marquee': {
        const rect = this.clampRect(rectFromCorners({ x: info.startX, y: info.startY }, { x: info.x, y: info.y }));
        this.drawMarquee(rect);
        break;
      }
      case 'move': {
        if (!floating || !this.startRect) break;
        floating.lift(this.painter.ctx);
        let x = Math.round(this.startRect.x + (info.x - info.startX));
        let y = Math.round(this.startRect.y + (info.y - info.startY));
        // The selection's middle catches on the canvas middle (Alt moves freely).
        const reach = SNAP_PX / this.painter.zoom;
        const { width, height } = this.startRect;
        const guides = { x: false, y: false };
        if (!info.altKey && Math.abs(x + width / 2 - this.painter.width / 2) <= reach) {
          x = Math.round(this.painter.width / 2 - width / 2);
          guides.x = true;
        }
        if (!info.altKey && Math.abs(y + height / 2 - this.painter.height / 2) <= reach) {
          y = Math.round(this.painter.height / 2 - height / 2);
          guides.y = true;
        }
        this.painter.centreGuides = guides;
        floating.setRect({ ...this.startRect, x, y });
        this.painter.renderOverlay();
        break;
      }
      case 'scale': {
        if (!floating || !this.startRect) break;
        floating.setRect(this.scaledRect(this.startRect, this.handle, info));
        this.painter.renderOverlay();
        break;
      }
      default:
        break;
    }
  }

  onPointerUp(info: PointerInfo): void {
    const mode = this.mode;
    this.mode = 'idle';
    this.handle = -1;
    if (this.painter.centreGuides.x || this.painter.centreGuides.y) {
      this.painter.centreGuides = { x: false, y: false };
      this.painter.renderOverlay();
    }

    if (mode === 'marquee') {
      this.painter.clearOverlay();
      const rect = this.clampRect(rectFromCorners({ x: info.startX, y: info.startY }, { x: info.x, y: info.y }));
      if (rect.width < 2 || rect.height < 2) {
        this.painter.renderOverlay();
        return;
      }
      const selection = FloatingSelection.capture(this.painter.ctx, rect);
      if (selection) this.painter.setFloating(selection);
      return;
    }
    this.startRect = null;
  }

  onPointerHover(info: PointerInfo): void {
    const floating = this.painter.floating;
    if (!floating) {
      this.painter.setCursor('crosshair');
      return;
    }
    const handle = this.painter.hitHandle({ x: info.x, y: info.y });
    if (handle >= 0) {
      this.painter.setCursor(CURSORS[handle] ?? 'move');
      return;
    }
    const r = floating.rect;
    const inside = info.x >= r.x && info.x <= r.x + r.width && info.y >= r.y && info.y <= r.y + r.height;
    this.painter.setCursor(inside ? 'move' : 'crosshair');
  }

  onKeyDown(e: KeyboardEvent): boolean {
    if (e.key === 'Enter' && this.painter.floating) {
      this.painter.commitFloating();
      return true;
    }
    return false;
  }

  cancel(): void {
    this.mode = 'idle';
    this.handle = -1;
    this.startRect = null;
    this.painter.clearOverlay();
    this.painter.renderOverlay();
  }

  private clampRect(rect: Rect): Rect {
    const x = Math.max(0, Math.round(rect.x));
    const y = Math.max(0, Math.round(rect.y));
    return {
      x,
      y,
      width: Math.min(Math.round(rect.width), this.painter.width - x),
      height: Math.min(Math.round(rect.height), this.painter.height - y),
    };
  }

  private scaledRect(start: Rect, handle: number, info: PointerInfo): Rect {
    let { x, y, width, height } = start;
    const right = x + width;
    const bottom = y + height;
    const west = handle === 0 || handle === 6 || handle === 7;
    const east = handle === 2 || handle === 3 || handle === 4;
    const north = handle === 0 || handle === 1 || handle === 2;
    const south = handle === 4 || handle === 5 || handle === 6;

    if (west) {
      x = Math.min(info.x, right - 1);
      width = right - x;
    } else if (east) {
      width = Math.max(1, info.x - x);
    }
    if (north) {
      y = Math.min(info.y, bottom - 1);
      height = bottom - y;
    } else if (south) {
      height = Math.max(1, info.y - y);
    }
    if (info.shiftKey && (west || east) && (north || south)) {
      const ratio = start.width / start.height;
      if (width / height > ratio) width = height * ratio;
      else height = width / ratio;
      if (west) x = right - width;
      if (north) y = bottom - height;
    }
    return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
  }

  private drawMarquee(rect: Rect): void {
    const ctx = this.painter.overlayCtx;
    const k = 1 / this.painter.zoom;
    this.painter.clearOverlay();
    ctx.save();
    ctx.lineWidth = k;
    ctx.setLineDash([4 * k, 3 * k]);
    ctx.strokeStyle = '#855cd6';
    ctx.fillStyle = 'rgba(133, 92, 214, 0.1)';
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    ctx.strokeRect(rect.x + k / 2, rect.y + k / 2, rect.width - k, rect.height - k);
    ctx.restore();
  }
}
