import { Emitter } from '../core/emitter.js';
import { History } from '../core/history.js';
import { bindPointer } from '../core/pointer.js';
import { handleViewShortcut, shortcutKey } from '../core/shortcuts.js';
import type { Tool } from '../core/tool.js';
import { defaultBrushOptions, defaultTextStyle } from '../core/types.js';
import type {
  BitmapToolName,
  BrushOptions,
  PaintStyle,
  PainterEvents,
  Point,
  Rect,
  TextStyle,
} from '../core/types.js';
import { getClipboard, nextPasteOffset, setClipboard } from '../core/clipboard.js';
import { injectStyles } from '../ui/styles.js';
import { FloatingSelection } from './floating.js';
import { rasterizeSVG } from '../convert/rasterize.js';
import { loadImageElement } from '../convert/decode.js';

import { BitmapBrushTool } from './tools/brush.js';
import { BitmapEraserTool } from './tools/eraser.js';
import { BitmapLineTool } from './tools/line.js';
import { BitmapEllipseTool } from './tools/ellipse.js';
import { BitmapRectTool } from './tools/rect.js';
import { BitmapFillTool } from './tools/fill.js';
import { BitmapTextTool } from './tools/text.js';
import { BitmapSelectTool } from './tools/select.js';

export interface BitmapPainterOptions {
  width?: number;
  height?: number;
  background?: string | null;
  style?: Partial<PaintStyle>;
  brush?: Partial<BrushOptions>;
  text?: Partial<TextStyle>;
  historyLimit?: number;
  zoom?: number;
  tool?: BitmapToolName;
  keyboard?: boolean;
  /** Outlined shapes instead of filled ones for the ellipse / rect tools. */
  outlineShapes?: boolean;
  /**
   * Swallow browser shortcuts (page zoom, save, print, ...) while the painter
   * has focus. Ctrl/Cmd + `=`/`-`/`0` zoom the canvas instead. Default `true`.
   */
  swallowBrowserShortcuts?: boolean;
  /**
   * Memory budget for undo snapshots, in bytes. The step count is derived from
   * it, so a 1920x1080 canvas keeps fewer (but still useful) steps than a small
   * one instead of eating gigabytes. Default 192 MB.
   */
  historyBytes?: number;
}

const HANDLE_SIZE = 8;

/**
 * Raster paint surface.
 *
 * Strokes share perfect-freehand with the vector brush (the outline is filled
 * as a polygon), and the marquee behaves like a classic floating selection.
 */
export class BitmapPainter {
  readonly container: HTMLElement;
  readonly root: HTMLDivElement;
  readonly viewport: HTMLDivElement;
  readonly frame: HTMLDivElement;
  readonly canvas: HTMLCanvasElement;
  readonly overlayCanvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly overlayCtx: CanvasRenderingContext2D;

  private readonly emitter = new Emitter<PainterEvents>();
  private readonly history: History<ImageData>;
  private readonly tools = new Map<string, Tool>();
  private readonly unbind: Array<() => void> = [];

  private _zoom: number;
  private _tool: BitmapToolName = 'brush';
  private activeTool: Tool | null = null;
  private _floating: FloatingSelection | null = null;
  private antsOffset = 0;
  private antsTimer: number | null = null;

  style: PaintStyle;
  brush: BrushOptions;
  textStyle: TextStyle;
  /** Ellipse / rectangle are outlined instead of filled when true. */
  outlineShapes: boolean;
  /** Bucket fill tolerance, 0..1. */
  fillTolerance = 0.08;
  /** Bucket fill stays inside the clicked region when true. */
  fillContiguous = true;
  /** See {@link BitmapPainterOptions.swallowBrowserShortcuts}. */
  swallowBrowserShortcuts: boolean;

  constructor(container: HTMLElement, options: BitmapPainterOptions = {}) {
    injectStyles();
    this.container = container;
    this._zoom = options.zoom ?? 1;
    this.outlineShapes = options.outlineShapes ?? false;
    this.style = { fill: '#855cd6', stroke: '#000000', strokeWidth: 4, ...options.style };
    this.brush = { ...defaultBrushOptions(12), ...options.brush };
    this.swallowBrowserShortcuts = options.swallowBrowserShortcuts !== false;
    this.textStyle = { ...defaultTextStyle(), ...options.text };

    this.root = document.createElement('div');
    this.root.className = 'pt-root pt-bitmap';
    this.root.tabIndex = 0;
    this.viewport = document.createElement('div');
    this.viewport.className = 'pt-viewport';
    this.frame = document.createElement('div');
    this.frame.className = 'pt-frame';
    this.viewport.appendChild(this.frame);
    this.root.appendChild(this.viewport);
    container.appendChild(this.root);

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'pt-main-canvas';
    this.canvas.width = options.width ?? 1920;
    this.canvas.height = options.height ?? 1080;
    this.overlayCanvas = document.createElement('canvas');
    this.overlayCanvas.className = 'pt-overlay-canvas';
    this.overlayCanvas.width = this.canvas.width;
    this.overlayCanvas.height = this.canvas.height;
    this.frame.append(this.canvas, this.overlayCanvas);

    const ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    const octx = this.overlayCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx || !octx) throw new Error('[painter] 2D canvas is unavailable');
    this.ctx = ctx;
    this.overlayCtx = octx;

    if (options.background) {
      this.ctx.fillStyle = options.background;
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
    this.applyZoom();

    this.history = new History<ImageData>({
      limit: options.historyLimit ?? snapshotLimit(this.canvas, options.historyBytes),
      onChange: (state) => this.emitter.emit('historychange', state),
    });
    this.history.reset(this.snapshot());

    this.registerTool(new BitmapBrushTool(this));
    this.registerTool(new BitmapEraserTool(this));
    this.registerTool(new BitmapLineTool(this));
    this.registerTool(new BitmapEllipseTool(this));
    this.registerTool(new BitmapRectTool(this));
    this.registerTool(new BitmapFillTool(this));
    this.registerTool(new BitmapTextTool(this));
    this.registerTool(new BitmapSelectTool(this));

    this.unbind.push(
      bindPointer({
        element: this.frame,
        toScene: (cx, cy) => this.clientToCanvas(cx, cy),
        onDown: (info) => {
          this.root.focus({ preventScroll: true });
          this.activeTool?.onPointerDown(info);
        },
        onMove: (info) => this.activeTool?.onPointerMove(info),
        onUp: (info) => this.activeTool?.onPointerUp(info),
        onHover: (info) => this.activeTool?.onPointerHover?.(info),
        onDoubleClick: (info) => this.activeTool?.onDoubleClick?.(info),
      }),
      this.installViewControls(),
    );

    if (options.keyboard !== false) {
      const onKey = (e: KeyboardEvent) => this.handleKey(e);
      this.root.addEventListener('keydown', onKey);
      this.unbind.push(() => this.root.removeEventListener('keydown', onKey));
    }

    this.setTool(options.tool ?? 'brush');
  }

  on = this.emitter.on.bind(this.emitter);
  off = this.emitter.off.bind(this.emitter);
  emit = this.emitter.emit.bind(this.emitter);

  /* ---------------------------------------------------------------- *
   * View
   * ---------------------------------------------------------------- */

  get width(): number { return this.canvas.width; }
  get height(): number { return this.canvas.height; }
  get zoom(): number { return this._zoom; }

  resize(width: number, height: number, keepContent = true): void {
    const previous = keepContent ? this.toCanvasCopy() : null;
    this.canvas.width = width;
    this.canvas.height = height;
    this.overlayCanvas.width = width;
    this.overlayCanvas.height = height;
    if (previous) this.ctx.drawImage(previous, 0, 0);
    this.applyZoom();
    this.history.reset(this.snapshot());
    this.emitter.emit('change', undefined);
  }

  setZoom(zoom: number, anchor?: Point): void {
    const next = Math.max(0.1, Math.min(16, zoom));
    if (Math.abs(next - this._zoom) < 1e-4) return;
    // Without a point to hold (a button, a key), the middle of the view stays put.
    if (!anchor) {
      const view = this.viewport.getBoundingClientRect();
      anchor = this.clientToCanvas(view.left + view.width / 2, view.top + view.height / 2);
    }
    const before = anchor ? this.canvasToClient(anchor) : null;
    this._zoom = next;
    this.applyZoom();
    if (anchor && before) {
      const after = this.canvasToClient(anchor);
      this.viewport.scrollLeft += after.x - before.x;
      this.viewport.scrollTop += after.y - before.y;
    }
    this.renderOverlay();
    this.emitter.emit('viewchange', { zoom: this._zoom });
  }

  zoomIn(anchor?: Point): void { this.setZoom(this._zoom * 1.25, anchor); }
  zoomOut(anchor?: Point): void { this.setZoom(this._zoom / 1.25, anchor); }
  resetZoom(): void { this.setZoom(1); }

  zoomToFit(padding = 24): void {
    const vw = this.viewport.clientWidth - padding * 2;
    const vh = this.viewport.clientHeight - padding * 2;
    if (vw <= 0 || vh <= 0) return;
    this.setZoom(Math.min(vw / this.width, vh / this.height));
  }

  private applyZoom(): void {
    this.frame.style.width = `${Math.round(this.width * this._zoom)}px`;
    this.frame.style.height = `${Math.round(this.height * this._zoom)}px`;
  }

  /** Ctrl/Cmd + wheel zooms the canvas, never the browser page. */
  private installViewControls(): () => void {
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      this.setZoom(this._zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12), this.clientToCanvas(e.clientX, e.clientY));
    };
    this.root.addEventListener('wheel', onWheel, { passive: false });
    return () => this.root.removeEventListener('wheel', onWheel);
  }

  clientToCanvas(clientX: number, clientY: number): Point {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * this.width,
      y: ((clientY - rect.top) / rect.height) * this.height,
    };
  }

  canvasToClient(point: Point): Point {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: rect.left + (point.x / this.width) * rect.width,
      y: rect.top + (point.y / this.height) * rect.height,
    };
  }

  screenToCanvasLength(px: number): number { return px / this._zoom; }

  /* ---------------------------------------------------------------- *
   * Tools & style
   * ---------------------------------------------------------------- */

  registerTool(tool: Tool): void { this.tools.set(tool.name, tool); }
  getTool(name: string): Tool | undefined { return this.tools.get(name); }
  get tool(): BitmapToolName { return this._tool; }

  setTool(name: BitmapToolName): void {
    const next = this.tools.get(name);
    if (!next) throw new Error(`[painter] unknown bitmap tool: ${name}`);
    if (this.activeTool === next) return;
    this.activeTool?.cancel?.();
    this.activeTool?.deactivate?.();
    if (name !== 'select') this.commitFloating();
    this._tool = name;
    this.activeTool = next;
    next.activate?.();
    this.frame.style.cursor = next.cursor ?? 'default';
    this.emitter.emit('toolchange', name);
  }

  setCursor(cursor: string): void { this.frame.style.cursor = cursor; }

  setFill(color: string | null): void {
    this.style.fill = color;
    this.activeTool?.onStyleChange?.();
    this.emitter.emit('stylechange', undefined);
  }

  setStroke(color: string | null): void {
    this.style.stroke = color;
    this.emitter.emit('stylechange', undefined);
  }

  setStrokeWidth(width: number): void {
    this.style.strokeWidth = Math.max(0, width);
    this.emitter.emit('stylechange', undefined);
  }

  setBrushOptions(patch: Partial<BrushOptions>): void {
    this.brush = { ...this.brush, ...patch };
    this.emitter.emit('stylechange', undefined);
  }

  setTextStyle(patch: Partial<TextStyle>): void {
    this.textStyle = { ...this.textStyle, ...patch };
    this.emitter.emit('stylechange', undefined);
  }

  /** Colour used by the brush, shapes, text and bucket fill. */
  get paintColor(): string { return this.style.fill ?? '#000000'; }

  /**
   * A `null` fill means "transparent": painting with it removes pixels rather
   * than adding them, which is the only sensible reading on a raster canvas.
   */
  get isTransparentPaint(): boolean { return this.style.fill === null; }

  /** Configures a context for the current paint colour / transparency mode. */
  usePaint(ctx: CanvasRenderingContext2D): void {
    if (this.isTransparentPaint) {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = '#000';
      ctx.strokeStyle = '#000';
      return;
    }
    ctx.fillStyle = this.paintColor;
    ctx.strokeStyle = this.paintColor;
  }

  /* ---------------------------------------------------------------- *
   * History
   * ---------------------------------------------------------------- */

  get canUndo(): boolean { return this.history.canUndo; }
  get canRedo(): boolean { return this.history.canRedo; }

  private snapshot(): ImageData {
    return this.ctx.getImageData(0, 0, this.width, this.height);
  }

  commit(): void {
    this.history.push(this.snapshot());
    this.emitter.emit('change', undefined);
  }

  undo(): void {
    const image = this.history.undo();
    if (image) this.restore(image);
  }

  redo(): void {
    const image = this.history.redo();
    if (image) this.restore(image);
  }

  private restore(image: ImageData): void {
    this.activeTool?.cancel?.();
    this._floating = null;
    if (image.width !== this.width || image.height !== this.height) {
      this.canvas.width = image.width;
      this.canvas.height = image.height;
      this.overlayCanvas.width = image.width;
      this.overlayCanvas.height = image.height;
      this.applyZoom();
    }
    this.ctx.putImageData(image, 0, 0);
    this.renderOverlay();
    this.emitter.emit('change', undefined);
    this.emitter.emit('selectionchange', undefined);
  }

  /* ---------------------------------------------------------------- *
   * Floating selection
   * ---------------------------------------------------------------- */

  get floating(): FloatingSelection | null { return this._floating; }

  setFloating(selection: FloatingSelection | null): void {
    this._floating = selection;
    if (selection) this.startAnts();
    else this.stopAnts();
    this.renderOverlay();
    this.emitter.emit('selectionchange', undefined);
  }

  /** Stamps the floating selection back into the canvas. */
  commitFloating(record = true): boolean {
    const floating = this._floating;
    if (!floating) return false;
    this._floating = null;
    this.stopAnts();
    if (floating.lifted) {
      floating.draw(this.ctx);
      if (record) this.commit();
    }
    this.renderOverlay();
    this.emitter.emit('selectionchange', undefined);
    return true;
  }

  deleteSelection(): boolean {
    const floating = this._floating;
    if (!floating) return false;
    if (!floating.lifted) floating.lift(this.ctx);
    this._floating = null;
    this.stopAnts();
    this.renderOverlay();
    this.commit();
    this.emitter.emit('selectionchange', undefined);
    return true;
  }

  selectAll(): void {
    const selection = FloatingSelection.capture(this.ctx, { x: 0, y: 0, width: this.width, height: this.height });
    if (selection) this.setFloating(selection);
  }

  deselect(): void { this.commitFloating(); }

  /* ---------------------------------------------------------------- *
   * Clipboard
   * ---------------------------------------------------------------- */

  copy(): boolean {
    const source = this._floating
      ? this._floating.toCanvas()
      : this.toCanvasCopy();
    const rect = this._floating?.rect ?? { x: 0, y: 0, width: this.width, height: this.height };
    setClipboard({
      kind: 'bitmap',
      dataURL: source.toDataURL('image/png'),
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    });
    return true;
  }

  cut(): boolean {
    if (!this.copy()) return false;
    if (this._floating) return this.deleteSelection();
    this.ctx.clearRect(0, 0, this.width, this.height);
    this.commit();
    return true;
  }

  /** Pastes the shared clipboard as a new floating selection. */
  async paste(): Promise<boolean> {
    const clip = getClipboard();
    if (!clip) return false;
    this.commitFloating();
    const offset = nextPasteOffset(12);
    let source: HTMLCanvasElement;
    if (clip.kind === 'bitmap') {
      source = await canvasFromURL(clip.dataURL);
    } else {
      const markup =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.max(1, Math.ceil(clip.width))}" ` +
        `height="${Math.max(1, Math.ceil(clip.height))}" viewBox="${clip.x} ${clip.y} ` +
        `${Math.max(1, clip.width)} ${Math.max(1, clip.height)}">${clip.svg}</svg>`;
      source = await rasterizeSVG(markup, Math.max(1, Math.ceil(clip.width)), Math.max(1, Math.ceil(clip.height)));
    }
    const selection = FloatingSelection.fromCanvas(
      source,
      Math.round(Math.min(Math.max(0, clip.x + offset), Math.max(0, this.width - source.width))),
      Math.round(Math.min(Math.max(0, clip.y + offset), Math.max(0, this.height - source.height))),
    );
    this.setTool('select');
    this.setFloating(selection);
    return true;
  }

  /* ---------------------------------------------------------------- *
   * Transforms
   * ---------------------------------------------------------------- */

  flipHorizontal(): void { this.flip(true); }
  flipVertical(): void { this.flip(false); }

  private flip(horizontal: boolean): void {
    if (this._floating) {
      if (horizontal) this._floating.flipX = !this._floating.flipX;
      else this._floating.flipY = !this._floating.flipY;
      this._floating.lift(this.ctx);
      this.renderOverlay();
      return;
    }
    const copy = this.toCanvasCopy();
    this.ctx.save();
    this.ctx.clearRect(0, 0, this.width, this.height);
    this.ctx.translate(horizontal ? this.width : 0, horizontal ? 0 : this.height);
    this.ctx.scale(horizontal ? -1 : 1, horizontal ? 1 : -1);
    this.ctx.drawImage(copy, 0, 0);
    this.ctx.restore();
    this.commit();
  }

  rotate(degrees: number): void {
    const copy = this.toCanvasCopy();
    this.ctx.save();
    this.ctx.clearRect(0, 0, this.width, this.height);
    this.ctx.translate(this.width / 2, this.height / 2);
    this.ctx.rotate((degrees * Math.PI) / 180);
    this.ctx.drawImage(copy, -this.width / 2, -this.height / 2);
    this.ctx.restore();
    this.commit();
  }

  /* ---------------------------------------------------------------- *
   * Overlay
   * ---------------------------------------------------------------- */

  clearOverlay(): void {
    this.overlayCtx.clearRect(0, 0, this.width, this.height);
  }

  /** Redraws the floating selection and its marching-ants box. */
  /** Axes on which a moved selection has caught on the canvas middle; drawn as guide lines. */
  centreGuides = { x: false, y: false };

  renderOverlay(): void {
    this.clearOverlay();
    const floating = this._floating;
    if (!floating) return;
    const ctx = this.overlayCtx;
    if (floating.lifted) floating.draw(ctx);
    if (this.centreGuides.x || this.centreGuides.y) {
      ctx.save();
      ctx.lineWidth = 1 / this._zoom;
      ctx.strokeStyle = '#ff3d8b';
      ctx.beginPath();
      if (this.centreGuides.x) {
        ctx.moveTo(this.width / 2, 0);
        ctx.lineTo(this.width / 2, this.height);
      }
      if (this.centreGuides.y) {
        ctx.moveTo(0, this.height / 2);
        ctx.lineTo(this.width, this.height / 2);
      }
      ctx.stroke();
      ctx.restore();
    }

    const k = 1 / this._zoom;
    const r = floating.rect;
    ctx.save();
    ctx.lineWidth = k;
    ctx.setLineDash([4 * k, 3 * k]);
    ctx.lineDashOffset = -this.antsOffset * k;
    ctx.strokeStyle = '#855cd6';
    ctx.strokeRect(r.x + k / 2, r.y + k / 2, r.width - k, r.height - k);
    ctx.setLineDash([]);
    ctx.fillStyle = '#ffffff';
    for (const p of this.handlePoints(r)) {
      const s = HANDLE_SIZE * k;
      ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
      ctx.strokeRect(p.x - s / 2, p.y - s / 2, s, s);
    }
    ctx.restore();
  }

  handlePoints(r: Rect): Point[] {
    const cx = r.x + r.width / 2;
    const cy = r.y + r.height / 2;
    return [
      { x: r.x, y: r.y },
      { x: cx, y: r.y },
      { x: r.x + r.width, y: r.y },
      { x: r.x + r.width, y: cy },
      { x: r.x + r.width, y: r.y + r.height },
      { x: cx, y: r.y + r.height },
      { x: r.x, y: r.y + r.height },
      { x: r.x, y: cy },
    ];
  }

  /** Index of the handle under `point`, or -1. */
  hitHandle(point: Point): number {
    const floating = this._floating;
    if (!floating) return -1;
    const slop = (HANDLE_SIZE / this._zoom) / 2 + 2 / this._zoom;
    const points = this.handlePoints(floating.rect);
    for (let i = 0; i < points.length; i++) {
      if (Math.abs(points[i].x - point.x) <= slop && Math.abs(points[i].y - point.y) <= slop) return i;
    }
    return -1;
  }

  private startAnts(): void {
    if (this.antsTimer !== null) return;
    this.antsTimer = window.setInterval(() => {
      this.antsOffset = (this.antsOffset + 1) % 7;
      this.renderOverlay();
    }, 120);
  }

  private stopAnts(): void {
    if (this.antsTimer === null) return;
    window.clearInterval(this.antsTimer);
    this.antsTimer = null;
  }

  /* ---------------------------------------------------------------- *
   * Keyboard
   * ---------------------------------------------------------------- */

  handleKey(e: KeyboardEvent): void {
    if (this.activeTool?.onKeyDown?.(e)) {
      e.preventDefault();
      return;
    }
    if (handleViewShortcut(e, this, this.swallowBrowserShortcuts)) {
      e.preventDefault();
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    const step = e.shiftKey ? 10 : 1;
    switch (shortcutKey(e)) {
      case 'Delete':
      case 'Backspace':
        if (this.deleteSelection()) e.preventDefault();
        break;
      case 'Escape':
        this.activeTool?.cancel?.();
        this.commitFloating();
        break;
      case 'ArrowLeft': this.nudge(-step, 0, e); break;
      case 'ArrowRight': this.nudge(step, 0, e); break;
      case 'ArrowUp': this.nudge(0, -step, e); break;
      case 'ArrowDown': this.nudge(0, step, e); break;
      case 'a': if (mod) { this.setTool('select'); this.selectAll(); e.preventDefault(); } break;
      case 'c': if (mod) { this.copy(); e.preventDefault(); } break;
      case 'x': if (mod) { this.cut(); e.preventDefault(); } break;
      case 'v': if (mod) { void this.paste(); e.preventDefault(); } break;
      case 'z':
        if (mod) {
          e.shiftKey ? this.redo() : this.undo();
          e.preventDefault();
        }
        break;
      case 'y': if (mod) { this.redo(); e.preventDefault(); } break;
      default: break;
    }
  }

  private nudge(dx: number, dy: number, e: KeyboardEvent): void {
    const floating = this._floating;
    if (!floating) return;
    floating.lift(this.ctx);
    floating.moveBy(dx, dy);
    this.renderOverlay();
    e.preventDefault();
  }

  /* ---------------------------------------------------------------- *
   * Import / export
   * ---------------------------------------------------------------- */

  toCanvasCopy(): HTMLCanvasElement {
    const copy = document.createElement('canvas');
    copy.width = this.width;
    copy.height = this.height;
    copy.getContext('2d')?.drawImage(this.canvas, 0, 0);
    return copy;
  }

  toDataURL(type = 'image/png', quality?: number): string {
    this.commitFloating();
    return this.canvas.toDataURL(type, quality);
  }

  toImageData(): ImageData {
    return this.ctx.getImageData(0, 0, this.width, this.height);
  }

  /** Draws an image, scaled to fit, optionally replacing the canvas. */
  async loadImage(src: string | HTMLImageElement | HTMLCanvasElement, options: { fit?: boolean; clear?: boolean } = {}): Promise<void> {
    const image = typeof src === 'string' ? await loadImageElement(src) : src;
    if (options.clear !== false) this.ctx.clearRect(0, 0, this.width, this.height);
    const iw = 'naturalWidth' in image ? image.naturalWidth || image.width : image.width;
    const ih = 'naturalHeight' in image ? image.naturalHeight || image.height : image.height;
    if (options.fit === false) {
      this.ctx.drawImage(image, 0, 0);
    } else {
      const scale = Math.min(this.width / iw, this.height / ih, 1);
      const w = iw * scale;
      const h = ih * scale;
      this.ctx.drawImage(image, (this.width - w) / 2, (this.height - h) / 2, w, h);
    }
    this.commit();
  }

  clear(): void {
    this._floating = null;
    this.stopAnts();
    this.ctx.clearRect(0, 0, this.width, this.height);
    this.clearOverlay();
    this.commit();
  }

  get isEmpty(): boolean {
    const { data } = this.toImageData();
    for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) return false;
    return true;
  }

  destroy(): void {
    this.activeTool?.cancel?.();
    this.activeTool?.deactivate?.();
    this.stopAnts();
    for (const off of this.unbind) off();
    this.unbind.length = 0;
    this.emitter.clearListeners();
    this.root.remove();
  }
}

/** Undo depth that fits `budget` bytes of `ImageData` snapshots. */
function snapshotLimit(canvas: HTMLCanvasElement, budget = 192 * 1024 * 1024): number {
  const perStep = Math.max(1, canvas.width * canvas.height * 4);
  return Math.max(8, Math.min(60, Math.floor(budget / perStep)));
}

async function canvasFromURL(url: string): Promise<HTMLCanvasElement> {
  const image = await loadImageElement(url);
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  canvas.getContext('2d')?.drawImage(image, 0, 0);
  return canvas;
}
