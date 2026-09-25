import { Emitter } from './core/emitter.js';
import type {
  BitmapToolName,
  BrushOptions,
  PaintStyle,
  PainterEvents,
  PainterMode,
  TextStyle,
  ToolName,
  VectorToolName,
} from './core/types.js';
import { injectStyles } from './ui/styles.js';
import { VectorPainter } from './vector/VectorPainter.js';
import type { VectorPainterOptions } from './vector/VectorPainter.js';
import { BitmapPainter } from './bitmap/BitmapPainter.js';
import type { BitmapPainterOptions } from './bitmap/BitmapPainter.js';
import { imageDataToLayers, layersToSVG, rasterizeSVG } from './convert/index.js';
import type { VectorizeOptions } from './convert/index.js';

export interface PainterOptions extends VectorPainterOptions, Omit<BitmapPainterOptions, 'tool'> {
  /** Surface to start on. */
  mode?: PainterMode;
  /** Tool selected on start (must belong to `mode`). */
  tool?: ToolName;
  /** Options for the bitmap -> vector tracer. */
  vectorize?: VectorizeOptions;
  /** Supersampling used by vector -> bitmap. */
  rasterScale?: number;
  /**
   * Readies the SVG before vector -> bitmap draws it as an image, which cannot
   * reach the page's fonts (e.g. embeds the fonts its text uses).
   */
  prepareSVG?: (markup: string) => Promise<string>;
}

const VECTOR_DEFAULT: VectorToolName = 'select';
const BITMAP_DEFAULT: BitmapToolName = 'brush';

/**
 * Facade over both surfaces.
 *
 * Owns exactly one live surface, forwards its events, and converts the artwork
 * when switching between vector and bitmap ("Convert to Bitmap" / "to Vector").
 */
export class Painter {
  readonly container: HTMLElement;
  readonly host: HTMLDivElement;

  private readonly emitter = new Emitter<PainterEvents>();
  private readonly options: PainterOptions;
  private readonly forwards: Array<() => void> = [];
  private _mode: PainterMode;
  private surface_: VectorPainter | BitmapPainter;

  constructor(container: HTMLElement, options: PainterOptions = {}) {
    injectStyles();
    this.container = container;
    this.options = { width: 1920, height: 1080, ...options };
    this._mode = options.mode ?? 'vector';

    this.host = document.createElement('div');
    this.host.className = 'pt-host';
    this.host.style.cssText = 'display:flex;flex:1 1 0;min-width:0;min-height:0;';
    container.appendChild(this.host);

    this.surface_ = this.createSurface(this._mode);
    this.bindSurface();
  }

  on = this.emitter.on.bind(this.emitter);
  off = this.emitter.off.bind(this.emitter);
  emit = this.emitter.emit.bind(this.emitter);

  get mode(): PainterMode { return this._mode; }
  get surface(): VectorPainter | BitmapPainter { return this.surface_; }
  get vector(): VectorPainter | null { return this._mode === 'vector' ? (this.surface_ as VectorPainter) : null; }
  get bitmap(): BitmapPainter | null { return this._mode === 'bitmap' ? (this.surface_ as BitmapPainter) : null; }
  get isVector(): boolean { return this._mode === 'vector'; }

  get width(): number { return this.surface_.width; }
  get height(): number { return this.surface_.height; }

  /* ---------------------------------------------------------------- *
   * Mode switching
   * ---------------------------------------------------------------- */

  async setMode(mode: PainterMode): Promise<void> {
    if (mode === this._mode) return;
    if (mode === 'bitmap') await this.convertToBitmap();
    else await this.convertToVector();
  }

  /** Rasterises the vector artwork and swaps in the bitmap surface. */
  async convertToBitmap(): Promise<void> {
    if (this._mode === 'bitmap') return;
    const vector = this.surface_ as VectorPainter;
    const { width, height, zoom } = vector;
    const raw = vector.toSVG();
    const markup = this.options.prepareSVG ? await this.options.prepareSVG(raw).catch(() => raw) : raw;
    const scale = this.options.rasterScale ?? 1;
    const canvas = await rasterizeSVG(markup, width, height, scale);

    this.teardown();
    this._mode = 'bitmap';
    const bitmap = this.createSurface('bitmap', { width, height, zoom }) as BitmapPainter;
    bitmap.ctx.imageSmoothingEnabled = scale !== 1;
    bitmap.ctx.drawImage(canvas, 0, 0, width, height);
    bitmap.commit();
    this.surface_ = bitmap;
    this.bindSurface();
    this.emitter.emit('modechange', 'bitmap');
  }

  /** Traces the bitmap into paths and swaps in the vector surface. */
  async convertToVector(): Promise<void> {
    if (this._mode === 'vector') return;
    const bitmap = this.surface_ as BitmapPainter;
    const { width, height, zoom } = bitmap;
    bitmap.commitFloating(false);
    const image = bitmap.toImageData();
    const layers = imageDataToLayers(image, this.options.vectorize);
    const markup = layersToSVG(layers, width, height);

    this.teardown();
    this._mode = 'vector';
    const vector = this.createSurface('vector', { width, height, zoom }) as VectorPainter;
    vector.loadSVG(markup, { resize: false });
    this.surface_ = vector;
    this.bindSurface();
    this.emitter.emit('modechange', 'vector');
  }

  private createSurface(
    mode: PainterMode,
    overrides: { width?: number; height?: number; zoom?: number } = {},
  ): VectorPainter | BitmapPainter {
    const shared = {
      ...this.options,
      ...overrides,
      tool: undefined,
    };
    if (mode === 'vector') {
      const tool = isVectorTool(this.options.tool) ? this.options.tool : VECTOR_DEFAULT;
      return new VectorPainter(this.host, { ...shared, tool });
    }
    const tool = isBitmapTool(this.options.tool) ? this.options.tool : BITMAP_DEFAULT;
    return new BitmapPainter(this.host, { ...shared, tool });
  }

  private bindSurface(): void {
    const surface = this.surface_;
    const types: Array<keyof PainterEvents> = [
      'change', 'selectionchange', 'toolchange', 'stylechange', 'historychange', 'viewchange', 'layerchange',
    ];
    for (const type of types) {
      const off = surface.on(type as never, ((payload: never) => this.emitter.emit(type as never, payload)) as never);
      this.forwards.push(off);
    }
    this.emitter.emit('change', undefined);
    this.emitter.emit('historychange', { canUndo: surface.canUndo, canRedo: surface.canRedo });
  }

  private teardown(): void {
    for (const off of this.forwards) off();
    this.forwards.length = 0;
    this.surface_.destroy();
  }

  /* ---------------------------------------------------------------- *
   * Proxied operations (work on whichever surface is live)
   * ---------------------------------------------------------------- */

  get tool(): ToolName { return this.surface_.tool; }

  setTool(name: ToolName): void {
    if (this._mode === 'vector') (this.surface_ as VectorPainter).setTool(name as VectorToolName);
    else (this.surface_ as BitmapPainter).setTool(name as BitmapToolName);
  }

  get style(): PaintStyle { return this.surface_.style; }
  get brush(): BrushOptions { return this.surface_.brush; }
  get textStyle(): TextStyle { return this.surface_.textStyle; }

  setFill(color: string | null): void { this.surface_.setFill(color); }
  setStroke(color: string | null): void { this.surface_.setStroke(color); }
  setStrokeWidth(width: number): void { this.surface_.setStrokeWidth(width); }
  setBrushOptions(patch: Partial<BrushOptions>): void { this.surface_.setBrushOptions(patch); }
  setTextStyle(patch: Partial<TextStyle>): void { this.surface_.setTextStyle(patch); }

  undo(): void { this.surface_.undo(); }
  redo(): void { this.surface_.redo(); }
  get canUndo(): boolean { return this.surface_.canUndo; }
  get canRedo(): boolean { return this.surface_.canRedo; }

  copy(): boolean { return this.surface_.copy(); }
  cut(): boolean { return this.surface_.cut(); }
  paste(): void | Promise<boolean> {
    return this._mode === 'vector'
      ? void (this.surface_ as VectorPainter).paste()
      : (this.surface_ as BitmapPainter).paste();
  }
  delete(): boolean { return this.surface_.deleteSelection(); }
  selectAll(): void { this.surface_.selectAll(); }
  deselect(): void { this.surface_.deselect(); }

  flipHorizontal(): void { this.surface_.flipHorizontal(); }
  flipVertical(): void { this.surface_.flipVertical(); }

  /** Vector-only; no-ops on the bitmap surface. */
  group(): void { this.vector?.group(); }
  ungroup(): void { this.vector?.ungroup(); }
  bringForward(): void { this.vector?.bringForward(); }
  sendBackward(): void { this.vector?.sendBackward(); }
  bringToFront(): void { this.vector?.bringToFront(); }
  sendToBack(): void { this.vector?.sendToBack(); }

  get zoom(): number { return this.surface_.zoom; }
  zoomIn(): void { this.surface_.zoomIn(); }
  zoomOut(): void { this.surface_.zoomOut(); }
  resetZoom(): void { this.surface_.resetZoom(); }
  zoomToFit(): void { this.surface_.zoomToFit(); }

  clear(): void { this.surface_.clear(); }

  /** SVG markup when vector, a PNG data URL when bitmap. */
  export(): string {
    return this._mode === 'vector'
      ? (this.surface_ as VectorPainter).toSVG()
      : (this.surface_ as BitmapPainter).toDataURL();
  }

  destroy(): void {
    this.teardown();
    this.emitter.clearListeners();
    this.host.remove();
  }
}

function isVectorTool(tool: ToolName | undefined): tool is VectorToolName {
  return !!tool && ['select', 'reshape', 'brush', 'eraser', 'fill', 'text', 'line', 'ellipse', 'rect'].includes(tool);
}

function isBitmapTool(tool: ToolName | undefined): tool is BitmapToolName {
  return !!tool && ['brush', 'line', 'ellipse', 'rect', 'text', 'fill', 'eraser', 'select'].includes(tool);
}
