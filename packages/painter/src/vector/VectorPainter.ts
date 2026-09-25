import { SVG } from "@svgdotjs/svg.js";
import type { Svg, G, Element as SvgElement } from "@svgdotjs/svg.js";

import { Emitter } from "../core/emitter.js";
import { History } from "../core/history.js";
import { bindPointer } from "../core/pointer.js";
import { handleViewShortcut, shortcutKey } from "../core/shortcuts.js";
import type { Tool } from "../core/tool.js";
import { defaultBrushOptions, defaultTextStyle } from "../core/types.js";
import type {
  BrushOptions,
  PaintStyle,
  PainterEvents,
  Point,
  PointerInfo,
  Rect,
  Rings,
  TextStyle,
  VectorToolName,
} from "../core/types.js";
import type { Matrix } from "../core/geom.js";
import {
  IDENTITY,
  matApply,
  matInvert,
  matMultiply,
  matToString,
  round,
} from "../core/geom.js";
import {
  getClipboard,
  nextPasteOffset,
  setClipboard,
} from "../core/clipboard.js";
import {
  differenceRings,
  inflateRings,
  JoinType,
  ringsOverlap,
} from "../core/clipper.js";
import { ringsToPathData, ringToPathData } from "../core/freehand.js";
import { isOpenPathData, shapeToPathData } from "../core/path-data.js";
import { fillPockets, growIntoWall, keepOffRim, labelRegions, regionMask, type Regions } from "../convert/region.js";
import { traceMask } from "../convert/trace.js";
import { injectStyles } from "../ui/styles.js";
import {
  applyStyle,
  boundsIn,
  elementMatrixTo,
  matrixScale,
  ensurePid,
  isItemNode,
  itemGeometry,
  paintBoundsIn,
  pidOf,
  readStyle,
} from "./scene.js";
import {
  HANDLE_CURSORS,
  HANDLE_KINDS,
  handlePoint,
  selectionBounds,
} from "./selection.js";
import type { HandleKind } from "./selection.js";

import { SelectTool } from "./tools/select.js";
import { ReshapeTool } from "./tools/reshape.js";
import { BrushTool } from "./tools/brush.js";
import { EraserTool } from "./tools/eraser.js";
import { FillTool } from "./tools/fill.js";
import { TextTool } from "./tools/text.js";
import { LineTool } from "./tools/line.js";
import { EllipseTool } from "./tools/ellipse.js";
import { RectTool } from "./tools/rect.js";

export interface VectorPainterOptions {
  width?: number;
  height?: number;
  /** Canvas background; `null` keeps it transparent (checkerboard). */
  background?: string | null;
  style?: Partial<PaintStyle>;
  brush?: Partial<BrushOptions>;
  text?: Partial<TextStyle>;
  historyLimit?: number;
  zoom?: number;
  tool?: VectorToolName;
  /** Bind Delete / Escape / arrow / Ctrl+Z shortcuts on the container. */
  keyboard?: boolean;
  /**
   * Swallow browser shortcuts (page zoom, save, print, ...) while the painter
   * has focus. Ctrl/Cmd + `=`/`-`/`0` zoom the canvas instead. Default `true`.
   */
  swallowBrowserShortcuts?: boolean;
}

export interface VectorSnapshot {
  /** Every layer's markup, as the layers group holds it. */
  svg: string;
  selection: string[];
  /** Index of the layer being drawn on. */
  layer: number;
}

/** One layer as a host lists it, bottom first. */
/** A two-colour gradient fill; `linear` runs along `angle` degrees, `radial` from the middle out. */
export interface GradientFill {
  kind: "linear" | "radial";
  from: string;
  to: string;
  angle: number;
}

/** How an outline is drawn. */
export type DashStyle = "solid" | "dashed" | "dotted";

const SVG_NS = "http://www.w3.org/2000/svg";
const GRADIENT_PREFIX = "ptg-";

export interface LayerInfo {
  name: string;
  visible: boolean;
  active: boolean;
}

const LAYER_ATTR = "data-layer";

export interface HitResult {
  item: SVGGraphicsElement;
  /** Leaf node actually hit (differs from `item` inside groups). */
  node: SVGGraphicsElement;
  kind: "fill" | "stroke";
}

export interface HitTestOptions {
  /** If true, treats closed shapes without fill as hittable on their interior. */
  includeUnfilled?: boolean;
  /** If true, ignores the bottom-most background rectangle. */
  ignoreBackground?: boolean;
  /**
   * If true, every visible layer is searched, topmost first, and a hit on
   * another layer makes that layer the one drawn on (unless `keepLayer`).
   */
  anyLayer?: boolean;
  /** With `anyLayer`: report the hit but leave the layer being drawn on as it is. */
  keepLayer?: boolean;
}

export interface FillRegionOptions {
  /** Maximum gap in scene pixels to bridge when detecting an enclosed region (default: 3). */
  gapTolerance?: number;
  /** Inflation in scene pixels to expand the filled polygon under surrounding strokes (default: 1.2). */
  bleed?: number;
  /** Fill color override (defaults to painter style.fill). */
  color?: string | null;
}

export type FillPreviewTarget =
  | { kind: "shape"; node: SVGGraphicsElement }
  | { kind: "stroke"; node: SVGGraphicsElement }
  | { kind: "region"; d: string };

interface SmartBarrierCache {
  pw: number;
  ph: number;
  pWall: Uint8Array;
  pOutsideExpanded: Uint8Array;
  pSmartWall: Uint8Array;
  /** Open areas of `pSmartWall`, labelled on first use. */
  regions?: Regions;
}

/** The drawing rasterised as walls for bucket fill, with what is worked out from it. */
interface BarrierCache {
  rw: number;
  rh: number;
  scale: number;
  wall: Uint8Array;
  smartBarriers?: Map<number, SmartBarrierCache>;
  /** Open areas of `wall`, labelled on first use. */
  rawRegions?: Regions;
  /** `wall` at half size, for closing gaps. */
  half?: { hw: number; hh: number; wall: Uint8Array };
  /** Traced fills by area and bleed, while the drawing stays the same. */
  regionResults?: Map<string, { d: string; rings: Array<Array<{ x: number; y: number }>> } | null>;
}

/** Fill outlines are traced at up to this many pixels per sheet pixel... */
const FILL_DETAIL = 4;
/** ...within this many fine pixels for the area's box. */
const FILL_DETAIL_PIXELS = 6_000_000;

/** How far (scene px) a bucket fill reaches under the lines around it. */
const FILL_UNDER_LINES = 2.5;
/** Holes in a fill up to this area (scene px²) are specks or slivers between lines, and get filled. */
const FILL_POCKET_AREA = 40;

const HANDLE_SIZE = 9;
const ROTATE_OFFSET = 26;

/**
 * Vector (SVG) paint surface.
 *
 * Geometry lives as real SVG nodes managed through SVG.js; freehand strokes
 * come from perfect-freehand and every boolean edit (eraser, crop) is resolved
 * with clipper2.
 */
export class VectorPainter {
  readonly container: HTMLElement;
  readonly root: HTMLDivElement;
  readonly viewport: HTMLDivElement;
  readonly frame: HTMLDivElement;
  readonly draw: Svg;
  /** Holds one group per layer, bottom first. */
  readonly layersRoot: G;
  /**
   * The layer being drawn on. Tools, selection and hit tests work on it alone;
   * the other layers are drawn but left untouched.
   */
  scene: G;
  readonly overlay: G;

  private readonly emitter = new Emitter<PainterEvents>();
  private readonly history: History<VectorSnapshot>;
  private readonly tools = new Map<string, Tool>();
  private readonly unbind: Array<() => void> = [];

  private _width: number;
  private _height: number;
  private _zoom: number;
  private _tool: VectorToolName = "select";
  private activeTool: Tool | null = null;
  private selectedIds: string[] = [];

  private _barrierCache: BarrierCache | null = null;
  private _previewTargetKey: string | null = null;
  private _previewElement: SVGElement | null = null;

  style: PaintStyle;
  brush: BrushOptions;
  textStyle: TextStyle;
  /** Gap in pixels to bridge when bucket filling an enclosed region. */
  fillGapTolerance = 8;
  /** Bleed in pixels to expand vector fill under enclosing strokes. */
  fillBleed = 1.6;
  /** Set by the select/reshape tools so the overlay can skip a redraw. */
  suppressOverlay = false;
  /** See {@link VectorPainterOptions.swallowBrowserShortcuts}. */
  swallowBrowserShortcuts: boolean;

  constructor(container: HTMLElement, options: VectorPainterOptions = {}) {
    injectStyles();
    this.container = container;
    this._width = options.width ?? 1920;
    this._height = options.height ?? 1080;
    this._zoom = options.zoom ?? 1;
    this.style = {
      fill: "#855cd6",
      stroke: "#000000",
      strokeWidth: 4,
      ...options.style,
    };
    this.brush = { ...defaultBrushOptions(8), ...options.brush };
    this.swallowBrowserShortcuts = options.swallowBrowserShortcuts !== false;
    this.textStyle = { ...defaultTextStyle(), ...options.text };

    this.root = document.createElement("div");
    this.root.className = "pt-root pt-vector";
    this.root.tabIndex = 0;
    this.viewport = document.createElement("div");
    this.viewport.className = "pt-viewport";
    this.frame = document.createElement("div");
    this.frame.className = "pt-frame";
    this.viewport.appendChild(this.frame);
    this.root.appendChild(this.viewport);
    container.appendChild(this.root);

    this.draw = SVG().addTo(this.frame).size("100%", "100%");
    this.draw.viewbox(0, 0, this._width, this._height);
    this.draw.node.setAttribute("preserveAspectRatio", "xMidYMid meet");
    this.ensureDefs();
    this.layersRoot = this.draw.group().addClass("pt-layers");
    this.scene = this.makeLayer("레이어 1");
    this.overlay = this.draw.group().addClass("pt-overlay");
    this.overlay.node.setAttribute("pointer-events", "none");
    this.applyZoom();

    if (options.background)
      this.setBackground(options.background, { commit: false });

    this.history = new History<VectorSnapshot>({
      limit: options.historyLimit ?? 60,
      onChange: (state) => this.emitter.emit("historychange", state),
    });
    this.history.reset(this.snapshot());

    this.registerTool(new SelectTool(this));
    this.registerTool(new ReshapeTool(this));
    this.registerTool(new BrushTool(this));
    this.registerTool(new EraserTool(this));
    this.registerTool(new FillTool(this));
    this.registerTool(new TextTool(this));
    this.registerTool(new LineTool(this));
    this.registerTool(new EllipseTool(this));
    this.registerTool(new RectTool(this));

    const onLeave = () => {
      if (this._tool === "fill") {
        this.clearFillPreview();
      }
    };
    this.frame.addEventListener("pointerleave", onLeave);
    this.unbind.push(() =>
      this.frame.removeEventListener("pointerleave", onLeave),
    );

    this.unbind.push(
      bindPointer({
        element: this.draw.node,
        toScene: (cx, cy) => this.clientToScene(cx, cy),
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
      this.root.addEventListener("keydown", onKey);
      this.unbind.push(() => this.root.removeEventListener("keydown", onKey));
    }

    this.setTool(options.tool ?? "select");
  }

  /* ---------------------------------------------------------------- *
   * Events
   * ---------------------------------------------------------------- */

  on = this.emitter.on.bind(this.emitter);
  off = this.emitter.off.bind(this.emitter);
  emit = this.emitter.emit.bind(this.emitter);

  /* ---------------------------------------------------------------- *
   * View
   * ---------------------------------------------------------------- */

  get width(): number {
    return this._width;
  }
  get height(): number {
    return this._height;
  }
  get zoom(): number {
    return this._zoom;
  }

  resize(width: number, height: number): void {
    this._width = width;
    this._height = height;
    this.draw.viewbox(0, 0, width, height);
    const bg = this.backgroundItem();
    if (bg) {
      bg.setAttribute("width", String(width));
      bg.setAttribute("height", String(height));
    }
    this.applyZoom();
  }

  /** Colour of the bottom-most full-canvas rectangle, or `null` if there is none. */
  get background(): string | null {
    const node = this.backgroundItem();
    return node ? node.getAttribute("fill") : null;
  }

  /**
   * Paints (or clears) the canvas background.
   *
   * The background is a normal bottom-most item in the scene, not a separate
   * layer: that is what makes "fill the empty area" undoable, erasable and
   * part of the exported document like everything else.
   */
  setBackground(
    color: string | null,
    options: { commit?: boolean } = {},
  ): SVGRectElement | null {
    let node = this.backgroundItem();
    if (!color) {
      node?.remove();
      if (options.commit !== false) this.commit();
      return null;
    }
    if (!node) {
      node = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      node.setAttribute("data-role", "background");
      node.setAttribute("x", "0");
      node.setAttribute("y", "0");
      node.setAttribute("stroke", "none");
      this.scene.node.insertBefore(node, this.scene.node.firstChild);
      ensurePid(node);
    }
    node.setAttribute("width", String(this._width));
    node.setAttribute("height", String(this._height));
    node.setAttribute("fill", color);
    if (options.commit !== false) this.commit();
    return node;
  }

  /** The bottom-most full-canvas rectangle, if the document has one. */
  backgroundItem(): SVGRectElement | null {
    const first = this.scene.node.firstElementChild;
    if (!first || first.tagName.toLowerCase() !== "rect") return null;
    if (first.getAttribute("data-role") !== "background") return null;
    return first as SVGRectElement;
  }

  setZoom(zoom: number, anchor?: Point): void {
    const next = Math.max(0.1, Math.min(16, zoom));
    if (Math.abs(next - this._zoom) < 1e-4) return;
    // Without a point to hold (a button, a key), the middle of the view stays put.
    if (!anchor) {
      const view = this.viewport.getBoundingClientRect();
      anchor = this.clientToScene(view.left + view.width / 2, view.top + view.height / 2);
    }
    const before = anchor ? this.sceneToClient(anchor) : null;
    this._zoom = next;
    this.applyZoom();
    if (anchor && before) {
      const after = this.sceneToClient(anchor);
      this.viewport.scrollLeft += after.x - before.x;
      this.viewport.scrollTop += after.y - before.y;
    }
    this.refreshOverlay();
    this.emitter.emit("viewchange", { zoom: this._zoom });
  }

  zoomIn(anchor?: Point): void {
    this.setZoom(this._zoom * 1.25, anchor);
  }
  zoomOut(anchor?: Point): void {
    this.setZoom(this._zoom / 1.25, anchor);
  }
  resetZoom(): void {
    this.setZoom(1);
  }

  zoomToFit(padding = 24): void {
    const vw = this.viewport.clientWidth - padding * 2;
    const vh = this.viewport.clientHeight - padding * 2;
    if (vw <= 0 || vh <= 0) return;
    this.setZoom(Math.min(vw / this._width, vh / this._height));
  }

  private applyZoom(): void {
    this.frame.style.width = `${Math.round(this._width * this._zoom)}px`;
    this.frame.style.height = `${Math.round(this._height * this._zoom)}px`;
  }

  /**
   * Ctrl/Cmd + wheel zooms the canvas, never the browser page. The listener
   * sits on the root (not the SVG) so the gesture is swallowed anywhere over
   * the painter, including the padding around the artboard.
   */
  private installViewControls(): () => void {
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      this.setZoom(
        this._zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12),
        this.clientToScene(e.clientX, e.clientY),
      );
    };
    this.root.addEventListener("wheel", onWheel, { passive: false });
    return () => this.root.removeEventListener("wheel", onWheel);
  }

  clientToScene(clientX: number, clientY: number): Point {
    const ctm = this.scene.node.getScreenCTM();
    if (!ctm) return { x: clientX, y: clientY };
    const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  }

  sceneToClient(point: Point): Point {
    const ctm = this.scene.node.getScreenCTM();
    if (!ctm) return point;
    const p = new DOMPoint(point.x, point.y).matrixTransform(ctm);
    return { x: p.x, y: p.y };
  }

  /** Length in scene units that covers `px` device pixels — for hit slop. */
  screenToSceneLength(px: number): number {
    return px / this._zoom;
  }

  /* ---------------------------------------------------------------- *
   * Tools
   * ---------------------------------------------------------------- */

  registerTool(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  get tool(): VectorToolName {
    return this._tool;
  }

  setTool(name: VectorToolName): void {
    const next = this.tools.get(name);
    if (!next) throw new Error(`[painter] unknown vector tool: ${name}`);
    if (this.activeTool === next) return;
    this.activeTool?.cancel?.();
    this.activeTool?.deactivate?.();
    this._tool = name;
    this.activeTool = next;
    next.activate?.();
    this.draw.node.style.cursor = next.cursor ?? "default";
    this.emitter.emit("toolchange", name);
  }

  getTool(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /* ---------------------------------------------------------------- *
   * Style
   * ---------------------------------------------------------------- */

  setFill(color: string | null): void {
    this.style.fill = color;
    if (this.selection.length) {
      for (const node of this.selection) {
        for (const shape of this.paintTargets(node)) this.dropGradient(shape);
        applyStyle(node, { fill: color });
      }
      this.commit();
    }
    this.activeTool?.onStyleChange?.();
    this.emitter.emit("stylechange", undefined);
  }

  setStroke(color: string | null): void {
    this.style.stroke = color;
    if (this.selection.length) {
      for (const node of this.selection)
        applyStyle(node, {
          stroke: color,
          strokeWidth: this.style.strokeWidth,
        });
      this.commit();
    }
    this.activeTool?.onStyleChange?.();
    this.emitter.emit("stylechange", undefined);
  }

  setStrokeWidth(width: number): void {
    this.style.strokeWidth = Math.max(0, width);
    if (this.selection.length) {
      for (const node of this.selection)
        applyStyle(node, { strokeWidth: this.style.strokeWidth });
      this.commit();
    }
    this.activeTool?.onStyleChange?.();
    this.emitter.emit("stylechange", undefined);
  }

  setBrushOptions(patch: Partial<BrushOptions>): void {
    this.brush = { ...this.brush, ...patch };
    this.emitter.emit("stylechange", undefined);
  }

  setTextStyle(patch: Partial<TextStyle>): void {
    this.textStyle = { ...this.textStyle, ...patch };
    for (const node of this.selection) {
      if (node.tagName.toLowerCase() !== "text") continue;
      if (patch.fontFamily) node.setAttribute("font-family", patch.fontFamily);
      if (patch.fontSize)
        node.setAttribute("font-size", String(patch.fontSize));
      if (patch.fontWeight)
        node.setAttribute("font-weight", String(patch.fontWeight));
      if (patch.fontStyle) node.setAttribute("font-style", patch.fontStyle);
    }
    this.emitter.emit("stylechange", undefined);
  }

  /* ---------------------------------------------------------------- *
   * Effects (all plain SVG, so a saved costume keeps them)
   * ---------------------------------------------------------------- */

  /** The leaves a style lands on: a group's shapes, or the shape itself. */
  private paintTargets(node: SVGElement): SVGElement[] {
    if (node.tagName.toLowerCase() !== "g") return [node];
    return Array.from(node.children).flatMap((child) => this.paintTargets(child as SVGElement));
  }

  /** The gradient element a shape's fill points at, if it is one of ours. */
  private gradientOf(node: SVGElement): SVGGradientElement | null {
    const match = /^url\(#([^)]+)\)$/.exec(node.getAttribute("fill") ?? "");
    if (!match || !match[1]!.startsWith(GRADIENT_PREFIX)) return null;
    return this.layersRoot.node.querySelector<SVGGradientElement>(`#${CSS.escape(match[1]!)}`);
  }

  private dropGradient(node: SVGElement): void {
    const gradient = this.gradientOf(node);
    const defs = gradient?.parentElement;
    gradient?.remove();
    if (defs && defs.tagName.toLowerCase() === "defs" && !defs.children.length) defs.remove();
  }

  /**
   * Fills the selection with a gradient, or back with one colour (`null`).
   * Each shape gets a gradient of its own in a `<defs>` right after it, so it
   * travels with the shape when saved.
   */
  setFillGradient(gradient: GradientFill | null): void {
    const shapes = this.selection.flatMap((node) => this.paintTargets(node));
    if (!shapes.length) return;
    for (const shape of shapes) {
      this.dropGradient(shape);
      if (!gradient) {
        shape.setAttribute("fill", this.style.fill ?? "none");
        continue;
      }
      const id = `${GRADIENT_PREFIX}${ensurePid(shape)}`;
      const element = document.createElementNS(SVG_NS, gradient.kind === "linear" ? "linearGradient" : "radialGradient");
      element.setAttribute("id", id);
      if (gradient.kind === "linear") {
        const rad = (gradient.angle * Math.PI) / 180;
        const dx = Math.cos(rad) / 2;
        const dy = Math.sin(rad) / 2;
        element.setAttribute("x1", String(round(0.5 - dx, 4)));
        element.setAttribute("y1", String(round(0.5 - dy, 4)));
        element.setAttribute("x2", String(round(0.5 + dx, 4)));
        element.setAttribute("y2", String(round(0.5 + dy, 4)));
      }
      for (const [offset, colour] of [["0", gradient.from], ["1", gradient.to]] as const) {
        const stop = document.createElementNS(SVG_NS, "stop");
        stop.setAttribute("offset", offset);
        stop.setAttribute("stop-color", colour);
        element.appendChild(stop);
      }
      const defs = document.createElementNS(SVG_NS, "defs");
      defs.appendChild(element);
      shape.parentNode?.insertBefore(defs, shape.nextSibling);
      shape.setAttribute("fill", `url(#${id})`);
    }
    this.commit();
    this.emitter.emit("stylechange", undefined);
  }

  /** The first selected shape's gradient, or null when it is filled plainly. */
  get selectionGradient(): GradientFill | null {
    const shape = this.selection.flatMap((node) => this.paintTargets(node))[0];
    const gradient = shape ? this.gradientOf(shape) : null;
    if (!gradient) return null;
    const stops = Array.from(gradient.querySelectorAll("stop")).map((stop) => stop.getAttribute("stop-color") ?? "#000000");
    const linear = gradient.tagName.toLowerCase() === "lineargradient";
    const x1 = Number(gradient.getAttribute("x1") ?? 0);
    const y1 = Number(gradient.getAttribute("y1") ?? 0.5);
    const x2 = Number(gradient.getAttribute("x2") ?? 1);
    const y2 = Number(gradient.getAttribute("y2") ?? 0.5);
    return {
      kind: linear ? "linear" : "radial",
      from: stops[0] ?? "#000000",
      to: stops[stops.length - 1] ?? "#ffffff",
      angle: linear ? Math.round((Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI) : 0,
    };
  }

  /** Opacity of the selection, 0 to 1. */
  setOpacity(opacity: number): void {
    const value = Math.min(1, Math.max(0, opacity));
    for (const node of this.selection) {
      if (value >= 1) node.removeAttribute("opacity");
      else node.setAttribute("opacity", String(round(value, 3)));
    }
    if (this.selection.length) this.commit();
    this.emitter.emit("stylechange", undefined);
  }

  get selectionOpacity(): number {
    const node = this.selection[0];
    const value = node ? parseFloat(node.getAttribute("opacity") ?? "1") : 1;
    return Number.isFinite(value) ? value : 1;
  }

  /** How the line tool draws new lines. */
  lineDash: DashStyle = "solid";

  /** Draws one shape's outline solid, dashed or dotted; the pattern follows its width. */
  dashShape(shape: SVGElement, dash: DashStyle): void {
    const width = Math.max(1, parseFloat(shape.getAttribute("stroke-width") ?? "") || this.style.strokeWidth || 1);
    if (dash === "solid") {
      shape.removeAttribute("stroke-dasharray");
      shape.removeAttribute("data-dash");
      return;
    }
    shape.setAttribute("stroke-dasharray", dash === "dashed" ? `${round(width * 3, 2)} ${round(width * 2, 2)}` : `0 ${round(width * 2, 2)}`);
    shape.setAttribute("stroke-linecap", "round");
    shape.setAttribute("data-dash", dash);
  }

  /** Sets the dash for new lines and for the selection's outlines. */
  setDash(dash: DashStyle): void {
    this.lineDash = dash;
    for (const shape of this.selection.flatMap((node) => this.paintTargets(node))) this.dashShape(shape, dash);
    if (this.selection.length) this.commit();
    this.emitter.emit("stylechange", undefined);
  }

  /** Whether the selection holds a line: an outline with nothing filled. */
  get selectionHasLine(): boolean {
    return this.selection.flatMap((node) => this.paintTargets(node)).some((shape) => {
      const fill = shape.getAttribute("fill");
      const stroke = shape.getAttribute("stroke");
      return (!fill || fill === "none") && !!stroke && stroke !== "none";
    });
  }

  /** Fill, outline and width of the selection's first painted part; null with nothing selected. */
  get selectionStyle(): PaintStyle | null {
    const first = this.selection.flatMap((node) => this.paintTargets(node))[0];
    return first ? readStyle(first) : null;
  }

  get selectionDash(): DashStyle {
    const shape = this.selection.flatMap((node) => this.paintTargets(node))[0];
    const dash = shape?.getAttribute("data-dash");
    return dash === "dashed" || dash === "dotted" ? dash : "solid";
  }

  /* ---------------------------------------------------------------- *
   * Items
   * ---------------------------------------------------------------- */

  get items(): SVGGraphicsElement[] {
    return Array.from(this.scene.node.children).filter(isItemNode);
  }

  addItem(element: SvgElement | SVGGraphicsElement): SVGGraphicsElement {
    const node = (element as SvgElement).node
      ? ((element as SvgElement).node as SVGGraphicsElement)
      : (element as SVGGraphicsElement);
    if (node.parentNode !== this.scene.node) this.scene.node.appendChild(node);
    ensurePid(node);
    return node;
  }

  removeItems(nodes: SVGGraphicsElement[]): void {
    for (const node of nodes) node.remove();
    this.selectedIds = this.selectedIds.filter((id) => this.findById(id));
    this.refreshOverlay();
  }

  findById(pid: string): SVGGraphicsElement | null {
    return this.scene.node.querySelector<SVGGraphicsElement>(
      `[data-pid="${CSS.escape(pid)}"]`,
    );
  }

  /** Creates a `<path>` in the scene with the current (or given) style. */
  createPath(d: string, style?: Partial<PaintStyle>): SVGPathElement {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    applyStyle(path, { fill: null, stroke: null, strokeWidth: 0, ...style });
    this.scene.node.appendChild(path);
    ensurePid(path);
    return path;
  }

  /* ---------------------------------------------------------------- *
   * Selection
   * ---------------------------------------------------------------- */

  get selection(): SVGGraphicsElement[] {
    const out: SVGGraphicsElement[] = [];
    for (const id of this.selectedIds) {
      const node = this.findById(id);
      if (node && node.parentNode === this.scene.node) out.push(node);
    }
    return out;
  }

  setSelection(nodes: SVGGraphicsElement[]): void {
    const ids = nodes.map((n) => ensurePid(n));
    const same =
      ids.length === this.selectedIds.length &&
      ids.every((id, i) => id === this.selectedIds[i]);
    this.selectedIds = ids;
    this.refreshOverlay();
    if (!same) this.emitter.emit("selectionchange", undefined);
  }

  addToSelection(node: SVGGraphicsElement): void {
    const id = ensurePid(node);
    if (this.selectedIds.includes(id)) return;
    this.selectedIds.push(id);
    this.refreshOverlay();
    this.emitter.emit("selectionchange", undefined);
  }

  toggleSelection(node: SVGGraphicsElement): void {
    const id = ensurePid(node);
    const i = this.selectedIds.indexOf(id);
    if (i >= 0) this.selectedIds.splice(i, 1);
    else this.selectedIds.push(id);
    this.refreshOverlay();
    this.emitter.emit("selectionchange", undefined);
  }

  selectAll(): void {
    this.setSelection(this.items);
  }
  deselect(): void {
    this.setSelection([]);
  }

  get selectionBounds(): Rect | null {
    return selectionBounds(
      this.selection,
      this.scene.node as SVGGraphicsElement,
    );
  }

  /* ---------------------------------------------------------------- *
   * Hit testing
   * ---------------------------------------------------------------- */

  hitTest(
    clientX: number,
    clientY: number,
    slopPx = 3,
    options: HitTestOptions = {},
  ): HitResult | null {
    if (options.anyLayer) {
      const layers = this.layerNodes();
      for (let index = layers.length - 1; index >= 0; index--) {
        const layer = layers[index]!;
        if (layer.getAttribute("display") === "none") continue;
        const items = Array.from(layer.children).filter(isItemNode);
        for (let i = items.length - 1; i >= 0; i--) {
          const hit = this.hitNode(items[i]!, items[i]!, clientX, clientY, slopPx, options);
          if (!hit) continue;
          if (layer !== this.scene.node && !options.keepLayer) {
            this.activateLayer(index);
            this.layersChanged(false);
          }
          return hit;
        }
      }
      return null;
    }
    const items = this.items;
    const bg = options.ignoreBackground ? this.backgroundItem() : null;
    for (let i = items.length - 1; i >= 0; i--) {
      if (bg && items[i] === bg) continue;
      const hit = this.hitNode(
        items[i],
        items[i],
        clientX,
        clientY,
        slopPx,
        options,
      );
      if (hit) return hit;
    }
    return null;
  }

  private hitNode(
    item: SVGGraphicsElement,
    node: SVGGraphicsElement,
    clientX: number,
    clientY: number,
    slopPx: number,
    options: HitTestOptions = {},
  ): HitResult | null {
    const tag = node.tagName.toLowerCase();
    if (tag === "g") {
      const kids = Array.from(node.children).filter(isItemNode);
      for (let i = kids.length - 1; i >= 0; i--) {
        const hit = this.hitNode(
          item,
          kids[i],
          clientX,
          clientY,
          slopPx,
          options,
        );
        if (hit) return hit;
      }
      return null;
    }
    if (options.ignoreBackground && node === this.backgroundItem()) {
      return null;
    }
    const ctm = node.getScreenCTM();
    if (!ctm) return null;
    const inv = ctm.inverse();
    const style = readStyle(node);
    const offsets: Array<[number, number]> = [[0, 0]];
    if (slopPx > 0) {
      const d = slopPx * 0.7071;
      offsets.push(
        [slopPx, 0],
        [-slopPx, 0],
        [0, slopPx],
        [0, -slopPx],
        [d, d],
        [-d, d],
        [d, -d],
        [-d, -d],
      );
    }
    const geometry =
      typeof (node as SVGGeometryElement).isPointInFill === "function";
    const isClosedShape =
      tag === "rect" ||
      tag === "circle" ||
      tag === "ellipse" ||
      tag === "polygon" ||
      (tag === "path" && !isOpenPathData(node.getAttribute("d") ?? ""));

    for (const [ox, oy] of offsets) {
      const p = new DOMPoint(clientX + ox, clientY + oy).matrixTransform(inv);
      if (geometry) {
        const geo = node as SVGGeometryElement;
        if (style.stroke && style.strokeWidth > 0 && geo.isPointInStroke(p)) {
          return { item, node, kind: "stroke" };
        }
        const canFill =
          style.fill || (options.includeUnfilled && isClosedShape);
        if (canFill && geo.isPointInFill(p)) {
          return { item, node, kind: "fill" };
        }
      } else {
        const box = node.getBBox();
        if (
          p.x >= box.x &&
          p.x <= box.x + box.width &&
          p.y >= box.y &&
          p.y <= box.y + box.height
        ) {
          return { item, node, kind: "fill" };
        }
      }
    }
    return null;
  }

  invalidateBarrierCache(): void {
    this._barrierCache = null;
  }

  /** Returns true if the scene-space coordinate (x, y) lands on an ink/stroke/fill pixel. */
  isInkAt(sceneX: number, sceneY: number): boolean {
    const barrier = this.getOrCreateBarrierMask();
    if (!barrier) return false;
    const sx = Math.round(sceneX * barrier.scale);
    const sy = Math.round(sceneY * barrier.scale);
    if (sx < 0 || sx >= barrier.rw || sy < 0 || sy >= barrier.rh) return false;
    return barrier.wall[sy * barrier.rw + sx] === 1;
  }

  private getOrCreateSmartBarrier(
    barrier: BarrierCache,
    r: number,
  ): SmartBarrierCache {
    if (!barrier.smartBarriers) {
      barrier.smartBarriers = new Map();
    }
    const existing = barrier.smartBarriers.get(r);
    if (existing) return existing;

    // Gaps are closed on the half-size wall (see `halfWall`); `r` is in its pixels.
    const { hw: rw, hh: rh, wall } = halfWall(barrier);
    const pw = rw + 2;
    const ph = rh + 2;
    const pWall = new Uint8Array(pw * ph);
    for (let y = 0; y < rh; y++) {
      const srcRow = y * rw;
      const dstRow = (y + 1) * pw + 1;
      for (let x = 0; x < rw; x++) {
        pWall[dstRow + x] = wall[srcRow + x];
      }
    }

    const pDilated = dilateMask(pWall, pw, ph, r);
    // Keep outer 1-pixel frame open for border circulation
    for (let x = 0; x < pw; x++) {
      pDilated[x] = 0;
      pDilated[(ph - 1) * pw + x] = 0;
    }
    for (let y = 0; y < ph; y++) {
      pDilated[y * pw] = 0;
      pDilated[y * pw + pw - 1] = 0;
    }

    const pOutsideMask = floodBorders(pDilated, pw, ph);
    const pOutsideExpanded = dilateMask(pOutsideMask, pw, ph, r);

    const pSmartWall = new Uint8Array(pw * ph);
    for (let i = 0; i < pw * ph; i++) {
      pSmartWall[i] = pWall[i] || pOutsideExpanded[i] ? 1 : 0;
    }

    const created: SmartBarrierCache = {
      pw,
      ph,
      pWall,
      pOutsideExpanded,
      pSmartWall,
    };
    barrier.smartBarriers.set(r, created);
    return created;
  }

  /**
   * Draws what walls in a bucket fill, black on the canvas: lines and outlines
   * (not fills), and brush strokes whole. `scale` is canvas pixels per scene
   * unit; the canvas may already be moved to show part of the sheet.
   */
  private paintBarrier(ctx: CanvasRenderingContext2D, scale: number): void {
    const bg = this.backgroundItem();
    const sceneEl = this.scene.node as SVGGraphicsElement;

    const renderItem = (el: SVGGraphicsElement) => {
      if (el === bg) return;
      const tag = el.tagName.toLowerCase();
      if (tag === "g") {
        Array.from(el.children)
          .filter(isItemNode)
          .forEach((c) => renderItem(c as SVGGraphicsElement));
        return;
      }
      // Fill regions created by bucket fill are not barriers
      const isFilledRegion =
        el.getAttribute("data-fill-region") === "true" ||
        (tag === "path" &&
          el.getAttribute("fill-rule") === "evenodd" &&
          !readStyle(el).stroke);
      if (isFilledRegion) return;

      const d = shapeToPathData(el);
      if (!d) return;

      const m = elementMatrixTo(el, sceneEl);
      const style = readStyle(el);

      ctx.save();
      ctx.scale(scale, scale);
      ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);

      const path2d = new Path2D(d);

      // Brush strokes are ribbons: their filled boundary forms the stroke line
      const isBrushRibbon =
        tag === "path" &&
        el.getAttribute("fill-rule") === "nonzero" &&
        (!style.stroke || style.strokeWidth === 0);

      if (isBrushRibbon) {
        ctx.fillStyle = "#000000";
        ctx.fill(path2d);
      } else {
        // For shapes and lines, only the outline/stroke acts as a wall!
        // We MUST NOT fill the interior in the barrier mask, so the room remains open for flood filling.
        if (style.stroke && style.strokeWidth > 0) {
          ctx.strokeStyle = "#000000";
          ctx.lineWidth = Math.max(1.5, style.strokeWidth);
          ctx.lineCap =
            (el.getAttribute("stroke-linecap") as CanvasLineCap) || "round";
          ctx.lineJoin =
            (el.getAttribute("stroke-linejoin") as CanvasLineJoin) || "round";
          ctx.stroke(path2d);
        } else if (style.fill) {
          // If a shape has fill but stroke is 0/none, stroke its perimeter so it acts as an outline boundary
          ctx.strokeStyle = "#000000";
          ctx.lineWidth = 2;
          ctx.stroke(path2d);
        }
      }
      ctx.restore();
    };

    for (const item of this.items) {
      renderItem(item);
    }

  }

  private getOrCreateBarrierMask(): BarrierCache | null {
    if (this._barrierCache) return this._barrierCache;

    const w = this.width;
    const h = this.height;
    if (w <= 0 || h <= 0) return null;

    const maxDim = 2048;
    const scale = Math.min(1, maxDim / Math.max(w, h));
    const rw = Math.max(1, Math.round(w * scale));
    const rh = Math.max(1, Math.round(h * scale));

    const canvas = document.createElement("canvas");
    canvas.width = rw;
    canvas.height = rh;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, rw, rh);
    this.paintBarrier(ctx, scale);

    const imageData = ctx.getImageData(0, 0, rw, rh);
    const data = imageData.data;
    const total = rw * rh;
    const wall = new Uint8Array(total);
    for (let i = 0; i < total; i++) {
      const brightness = (data[i * 4] + data[i * 4 + 1] + data[i * 4 + 2]) / 3;
      wall[i] = brightness < 200 ? 1 : 0;
    }

    this._barrierCache = { rw, rh, scale, wall };
    return this._barrierCache;
  }

  /**
   * Detects the enclosed region around (sceneX, sceneY) formed by brush strokes,
   * lines, and shapes, returning its SVG path data `d` without modifying the scene.
   * Preserves 100% of interior crevices without cutting corners, and automatically
   * bridges broken outlines/gaps in strokes with outside-in leak prevention.
   * Returns null if the seed is on open canvas or outside canvas boundaries.
   */
  detectEnclosedRegion(
    sceneX: number,
    sceneY: number,
    options: FillRegionOptions = {},
  ): string | null {
    return this.enclosedRegion(sceneX, sceneY, options)?.d ?? null;
  }

  /** The enclosed region's path data, and its outline in scene units before any bleed. */
  private enclosedRegion(
    sceneX: number,
    sceneY: number,
    options: FillRegionOptions = {},
  ): { d: string; rings: Array<Array<{ x: number; y: number }>> } | null {
    const bleed = options.bleed ?? this.fillBleed;
    const gapTolerance = options.gapTolerance ?? this.fillGapTolerance;

    const barrier = this.getOrCreateBarrierMask();
    if (!barrier) return null;
    const { rw, rh, scale, wall } = barrier;

    let seedX = Math.round(sceneX * scale);
    let seedY = Math.round(sceneY * scale);
    seedX = Math.max(0, Math.min(rw - 1, seedX));
    seedY = Math.max(0, Math.min(rh - 1, seedY));

    // Open areas are labelled once per drawing, so finding the one under the
    // pointer is a table read rather than a flood over the whole sheet.
    const raw = (barrier.rawRegions ??= labelRegions(wall, rw, rh));
    const enclosed = (label: number, least: number) =>
      label > 0 && !raw.touched[label] && raw.area[label] >= least;

    let found: { key: string; mask: () => Uint8Array } | null = null;

    // 1. The open area under the seed, walled in on every side.
    const here = raw.labels[seedY * rw + seedX]!;
    if (!wall[seedY * rw + seedX] && enclosed(here, 8)) {
      found = { key: `raw:${here}`, mask: () => regionMask(raw, here) };
    }

    // 2. On a wall: the nearest walled-in area within 12 pixels.
    if (!found && wall[seedY * rw + seedX]) {
      candidateSearch: for (let r = 1; r <= 12; r++) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
            const nx = seedX + dx;
            const ny = seedY + dy;
            if (nx < 0 || nx >= rw || ny < 0 || ny >= rh || wall[ny * rw + nx]) continue;
            const label = raw.labels[ny * rw + nx]!;
            if (enclosed(label, 8)) {
              found = { key: `raw:${label}`, mask: () => regionMask(raw, label) };
              seedX = nx;
              seedY = ny;
              break candidateSearch;
            }
          }
        }
      }
    }

    // 3. Leaking through a gap: close gaps of growing width until the area is walled in.
    // This works on the half-size wall; the area found is mapped back onto the open pixels.
    if (!found && gapTolerance > 0) {
      const half = halfWall(barrier);
      const targetR = Math.max(2, Math.round((gapTolerance * scale) / 2));
      const maxR = Math.min(14, Math.max(4, Math.floor(Math.min(half.hw, half.hh) * 0.15)));
      const candidateRadii = [targetR, Math.round(targetR * 1.5), Math.round(targetR * 2.2), Math.round(targetR * 3.0)];
      const radii = Array.from(new Set(candidateRadii.filter((r) => r <= maxR)));
      if (!radii.length) radii.push(Math.min(targetR, maxR));

      const pSeedX = (seedX >> 1) + 1;
      const pSeedY = (seedY >> 1) + 1;

      for (const r of radii) {
        const smart = this.getOrCreateSmartBarrier(barrier, r);
        const { pw, pWall, pOutsideExpanded, pSmartWall } = smart;

        let curSeedX = -1;
        let curSeedY = -1;
        if (!pWall[pSeedY * pw + pSeedX] && !pOutsideExpanded[pSeedY * pw + pSeedX]) {
          curSeedX = pSeedX;
          curSeedY = pSeedY;
        } else {
          searchNearby: for (let d = 1; d <= 12; d++) {
            for (let dy = -d; dy <= d; dy++) {
              for (let dx = -d; dx <= d; dx++) {
                if (Math.abs(dx) !== d && Math.abs(dy) !== d) continue;
                const nx = pSeedX + dx;
                const ny = pSeedY + dy;
                if (nx >= 1 && nx <= half.hw && ny >= 1 && ny <= half.hh && !pWall[ny * pw + nx] && !pOutsideExpanded[ny * pw + nx]) {
                  curSeedX = nx;
                  curSeedY = ny;
                  break searchNearby;
                }
              }
            }
          }
        }
        if (curSeedX < 0) continue;

        const regions = (smart.regions ??= labelRegions(pSmartWall, pw, smart.ph));
        const label = regions.labels[curSeedY * pw + curSeedX]!;
        if (!label || regions.touched[label] || regions.area[label] < 3) continue;
        found = {
          key: `gap${r}:${label}`,
          mask: () => {
            const mask = new Uint8Array(rw * rh);
            for (let y = 0; y < rh; y++) {
              const srcRow = ((y >> 1) + 1) * pw + 1;
              const dstRow = y * rw;
              for (let x = 0; x < rw; x++) {
                if (!wall[dstRow + x] && regions.labels[srcRow + (x >> 1)] === label) mask[dstRow + x] = 1;
              }
            }
            return mask;
          },
        };
        break;
      }
    }

    if (!found) return null;
    const cache = (barrier.regionResults ??= new Map());
    const key = `${found.key}:${bleed}`;
    if (cache.has(key)) return cache.get(key)!;
    const result = this.traceRegion(found.mask(), barrier, bleed);
    cache.set(key, result);
    return result;
  }

  /**
   * Outline of a filled area, drawn again finely. The area found on the sheet
   * raster is re-rasterised on its own box at up to 4x, so the edge follows
   * the lines to a fraction of a pixel. There it reaches a little under the
   * lines around it (never past them), takes in specks and slivers between
   * them, and keeps off their soft outer rim. It meets its lines in every
   * corner and shows no pixel stairs.
   */
  private traceRegion(
    mask: Uint8Array,
    barrier: BarrierCache,
    bleed: number,
  ): { d: string; rings: Array<Array<{ x: number; y: number }>> } | null {
    const { rw, rh, scale } = barrier;
    let minX = rw, minY = rh, maxX = -1, maxY = -1;
    for (let y = 0; y < rh; y++) {
      const row = y * rw;
      for (let x = 0; x < rw; x++) {
        if (!mask[row + x]) continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    if (maxX < 0) return null;

    // The area's box on the sheet raster, with room for the lines around it.
    const pad = Math.ceil(FILL_UNDER_LINES * scale) + 3;
    const x0 = Math.max(0, minX - pad);
    const y0 = Math.max(0, minY - pad);
    const cw = Math.min(rw, maxX + pad + 1) - x0;
    const ch = Math.min(rh, maxY + pad + 1) - y0;
    const fine = Math.max(1, Math.min(FILL_DETAIL, Math.floor(Math.sqrt(FILL_DETAIL_PIXELS / (cw * ch)))));
    const hw = cw * fine;
    const hh = ch * fine;

    const canvas = document.createElement("canvas");
    canvas.width = hw;
    canvas.height = hh;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, hw, hh);
    ctx.translate(-x0 * fine, -y0 * fine);
    this.paintBarrier(ctx, scale * fine);
    const pixels = ctx.getImageData(0, 0, hw, hh).data;
    const wall = new Uint8Array(hw * hh);
    for (let i = 0; i < wall.length; i++) {
      wall[i] = (pixels[i * 4] + pixels[i * 4 + 1] + pixels[i * 4 + 2]) / 3 < 200 ? 1 : 0;
    }

    // Kept to the area found (and a little round it), so a gap closed there stays closed.
    const room = growIntoWall(
      mask,
      new Uint8Array(mask.length).fill(1),
      rw,
      rh,
      2,
    );
    const confined = new Uint8Array(hw * hh);
    const hits = new Uint8Array(hw * hh);
    for (let hy = 0; hy < hh; hy++) {
      const cy = y0 + ((hy / fine) | 0);
      for (let hx = 0; hx < hw; hx++) {
        const cx = x0 + ((hx / fine) | 0);
        const i = hy * hw + hx;
        confined[i] = wall[i] || !room[cy * rw + cx] ? 1 : 0;
        // The middle of each coarse pixel of the area says which fine areas belong.
        if (mask[cy * rw + cx] && hx % fine === fine >> 1 && hy % fine === fine >> 1) hits[i] = 1;
      }
    }
    const areas = labelRegions(confined, hw, hh);
    const wanted = new Set<number>();
    for (let i = 0; i < hits.length; i++) if (hits[i] && areas.labels[i]) wanted.add(areas.labels[i]!);
    if (!wanted.size) return null;
    const area = new Uint8Array(hw * hh);
    for (let i = 0; i < area.length; i++) if (wanted.has(areas.labels[i]!)) area[i] = 1;

    const perUnit = scale * fine;
    const grown = growIntoWall(area, wall, hw, hh, Math.max(1, Math.round(FILL_UNDER_LINES * perUnit)));
    keepOffRim(grown, area, wall, hw, hh);
    fillPockets(grown, hw, hh, Math.max(4, Math.round(FILL_POCKET_AREA * perUnit * perUnit)));

    // Simplified enough that pixel stairs become straight runs, at a fraction of a scene pixel.
    const rawRings = traceMask(grown, hw, hh, 0.9);
    if (!rawRings.length) return null;
    const rings = rawRings.map((ring) =>
      ring.map((pt) => ({ x: (pt.x / fine + x0) / scale, y: (pt.y / fine + y0) / scale })));
    // Already under its lines: only a hair more, which the lines cover.
    const spread = Math.min(bleed, 0.3);
    const finalRings = spread > 0 ? inflateRings(rings, spread, JoinType.Miter) : rings;
    if (!finalRings.length) return null;
    const d = finalRings
      .filter((r) => r.length > 2)
      // Straight runs: at this detail they follow curves closely, and corners stay corners.
      .map((r) => ringToPathData(r))
      .join(" ");
    return d ? { d, rings } : null;
  }

  /**
   * Detects an enclosed region bounded by strokes/items in the scene around `(sceneX, sceneY)`
   * and creates a new filled vector `<path>` positioned neatly under the enclosing strokes.
   * Returns true if an enclosed region was successfully filled.
   */
  fillEnclosedRegion(
    sceneX: number,
    sceneY: number,
    options: FillRegionOptions = {},
  ): boolean {
    const fillColor =
      options.color !== undefined ? options.color : this.style.fill;
    if (!fillColor) return false;

    const region = this.enclosedRegion(sceneX, sceneY, options);
    if (!region) return false;
    const { d } = region;

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    path.setAttribute("fill", fillColor);
    path.setAttribute("fill-rule", "evenodd");
    path.setAttribute("stroke", "none");
    path.setAttribute("data-fill-region", "true");
    ensurePid(path);

    // The fill belongs with the strokes around it: it goes into one group with them, under them.
    const enclosers = this.enclosingItems(region.rings);
    if (enclosers.length) {
      this.groupFillWith(path, enclosers);
      this.deselect();
      this.invalidateBarrierCache();
      this.commit();
      return true;
    }

    const bg = this.backgroundItem();
    const same = Array.from(this.scene.node.children).find((child) =>
      child.getAttribute("data-fill-region") === "true" && child.getAttribute("d") === d && !child.getAttribute("transform"));
    if (same) {
      same.setAttribute("fill", fillColor);
      this.deselect();
      this.invalidateBarrierCache();
      this.commit();
      return true;
    }
    // All fills should be placed on top of older fills and shapes, but under strokes/outlines
    const firstStroke = Array.from(this.scene.node.children).find((child) => {
      if (child === bg) return false;
      const tag = child.tagName.toLowerCase();
      if (child.getAttribute("data-fill-region") === "true") return false;
      const style = readStyle(child as SVGGraphicsElement);
      const isBrushRibbon =
        tag === "path" &&
        child.getAttribute("fill-rule") === "nonzero" &&
        (!style.stroke || style.strokeWidth === 0);
      const hasStroke = style.stroke && style.strokeWidth > 0;
      return isBrushRibbon || hasStroke || tag === "line";
    });

    if (firstStroke) {
      this.scene.node.insertBefore(path, firstStroke);
    } else if (bg && bg.nextSibling) {
      this.scene.node.insertBefore(path, bg.nextSibling);
    } else {
      this.scene.node.appendChild(path);
    }

    this.deselect();
    this.invalidateBarrierCache();
    this.commit();
    return true;
  }

  /**
   * Top-level items that wall in a filled region: probed on a ring just outside
   * its edge, an item counts when its geometry covers enough of the probes.
   * Gaps the fill bridged over hit nothing and do not count.
   */
  private enclosingItems(rings: Array<Array<{ x: number; y: number }>>): SVGGraphicsElement[] {
    const scene = this.scene.node as SVGGraphicsElement;
    const reach = Math.max(0.75, this.screenToSceneLength(1.2));
    const probeRings = inflateRings(rings, reach, JoinType.Round);
    // Evenly along the edge: a traced outline keeps only the corners of a straight wall.
    const probes = probeRings.flatMap((ring) => resampleRing(ring, 160));
    if (!probes.length) return [];

    const xs = probes.map((p) => p.x);
    const ys = probes.map((p) => p.y);
    const box = {
      x: Math.min(...xs), y: Math.min(...ys),
      width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys),
    };
    const bg = this.backgroundItem();
    const candidates = this.itemsInRect(box).filter(
      (item) => item !== bg && item.getAttribute("data-fill-region") !== "true",
    );

    const hits = new Map<SVGGraphicsElement, number>();
    for (const item of candidates) {
      const leaves = geometryLeaves(item).map((leaf) => ({
        leaf,
        inverse: matInvert(elementMatrixTo(leaf, scene)),
        style: readStyle(leaf),
      }));
      let count = 0;
      for (const probe of probes) {
        const covered = leaves.some(({ leaf, inverse, style }) => {
          const local = matApply(inverse, probe);
          const point = new DOMPoint(local.x, local.y);
          if (style.fill && leaf.isPointInFill(point)) return true;
          return !!style.stroke && style.strokeWidth > 0 && leaf.isPointInStroke(point);
        });
        if (covered) count += 1;
      }
      if (count) hits.set(item, count);
    }
    const least = Math.max(2, probes.length * 0.04);
    return this.inDocumentOrder([...hits].filter(([, count]) => count >= least).map(([item]) => item));
  }

  /** Puts a new fill under the items walling it in, all in one group. */
  private groupFillWith(fill: SVGPathElement, enclosers: SVGGraphicsElement[]): void {
    const only = enclosers.length === 1 ? enclosers[0] : null;
    // Already one group: the fill joins it, over its earlier fills and under its lines.
    if (only && only.tagName.toLowerCase() === "g") {
      // The outline is in scene units; a moved or scaled group would move it again.
      const m = elementMatrixTo(only, this.scene.node as SVGGraphicsElement);
      const isIdentity = m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0;
      if (!isIdentity) fill.setAttribute("transform", matToString(matInvert(m)));
      this.placeFill(only, fill);
      return;
    }
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    const top = enclosers[enclosers.length - 1];
    this.scene.node.insertBefore(g, top.nextSibling);
    g.appendChild(fill);
    for (const item of enclosers) g.appendChild(item);
    ensurePid(g);
  }

  /**
   * Adds a fill to a container above its earlier fills and under its lines. A
   * fill with the very same outline is recoloured instead of stacked on.
   */
  private placeFill(container: Element, fill: SVGPathElement): void {
    const children = Array.from(container.children).filter(isItemNode);
    const same = children.find((child) =>
      child.getAttribute("data-fill-region") === "true"
      && child.getAttribute("d") === fill.getAttribute("d")
      && (child.getAttribute("transform") ?? "") === (fill.getAttribute("transform") ?? ""));
    if (same) {
      same.setAttribute("fill", fill.getAttribute("fill") ?? "none");
      return;
    }
    const firstLine = children.find((child) => child.getAttribute("data-fill-region") !== "true");
    container.insertBefore(fill, firstLine ?? null);
  }

  /**
   * Items a selection box picks: those inside it, and those whose outline runs
   * through it. A shape that only surrounds the box is left alone.
   */
  itemsInMarquee(rect: Rect): SVGGraphicsElement[] {
    const scene = this.scene.node as SVGGraphicsElement;
    const inside = (p: { x: number; y: number }) =>
      p.x >= rect.x && p.x <= rect.x + rect.width && p.y >= rect.y && p.y <= rect.y + rect.height;
    const contained = new Set(this.itemsInRect(rect, true));
    return this.itemsInRect(rect).filter((item) => {
      if (contained.has(item)) return true;
      const leaves = geometryLeaves(item);
      // Text and images have no outline to follow: their box decides.
      if (!leaves.length) return true;
      // Sampled no farther apart than a quarter of the box's short side.
      const spacing = Math.max(0.5, Math.min(rect.width, rect.height) / 4);
      return leaves.some((leaf) => {
        let length = 0;
        try {
          length = leaf.getTotalLength();
        } catch {
          return true;
        }
        const m = elementMatrixTo(leaf, scene);
        const count = Math.min(4000, Math.max(8, Math.ceil((length * matrixScale(m)) / spacing)));
        for (let i = 0; i <= count; i++) {
          const point = leaf.getPointAtLength((length * i) / count);
          if (inside(matApply(m, point))) return true;
        }
        return false;
      });
    });
  }

  /** Items whose painted bounds intersect (or are contained by) `rect`. */
  itemsInRect(rect: Rect, contained = false): SVGGraphicsElement[] {
    const scene = this.scene.node as SVGGraphicsElement;
    return this.items.filter((item) => {
      const b = paintBoundsIn(item, scene);
      if (contained) {
        return (
          b.x >= rect.x &&
          b.y >= rect.y &&
          b.x + b.width <= rect.x + rect.width &&
          b.y + b.height <= rect.y + rect.height
        );
      }
      return !(
        b.x + b.width < rect.x ||
        rect.x + rect.width < b.x ||
        b.y + b.height < rect.y ||
        rect.y + rect.height < b.y
      );
    });
  }

  /* ---------------------------------------------------------------- *
   * Transforms
   * ---------------------------------------------------------------- */

  /** Current transform of an item as a matrix. */
  itemMatrix(node: SVGGraphicsElement): Matrix {
    const list = node.transform.baseVal.consolidate();
    if (!list) return [...IDENTITY] as Matrix;
    const m = list.matrix;
    return [m.a, m.b, m.c, m.d, m.e, m.f];
  }

  setItemMatrix(node: SVGGraphicsElement, m: Matrix): void {
    const isIdentity =
      m[0] === 1 &&
      m[1] === 0 &&
      m[2] === 0 &&
      m[3] === 1 &&
      m[4] === 0 &&
      m[5] === 0;
    if (isIdentity) node.removeAttribute("transform");
    else node.setAttribute("transform", matToString(m));
  }

  /** Applies a scene-space matrix on top of each node's own transform. */
  applyMatrix(
    nodes: SVGGraphicsElement[],
    delta: Matrix,
    base?: Map<SVGGraphicsElement, Matrix>,
  ): void {
    for (const node of nodes) {
      const existing = base?.get(node) ?? this.itemMatrix(node);
      this.setItemMatrix(node, matMultiply(delta, existing));
    }
  }

  translateSelection(dx: number, dy: number, commit = true): void {
    const nodes = this.selection;
    if (!nodes.length) return;
    this.applyMatrix(nodes, [1, 0, 0, 1, dx, dy]);
    this.refreshOverlay();
    if (commit) this.commit();
  }

  flipHorizontal(): void {
    this.flip(true);
  }
  flipVertical(): void {
    this.flip(false);
  }

  private flip(horizontal: boolean): void {
    const nodes = this.selection;
    const bounds = nodes.length
      ? this.selectionBounds
      : { x: 0, y: 0, width: this._width, height: this._height };
    const targets = nodes.length ? nodes : this.items;
    if (!targets.length || !bounds) return;
    const cx = bounds.x + bounds.width / 2;
    const cy = bounds.y + bounds.height / 2;
    const m: Matrix = horizontal
      ? [-1, 0, 0, 1, 2 * cx, 0]
      : [1, 0, 0, -1, 0, 2 * cy];
    this.applyMatrix(targets, m);
    this.refreshOverlay();
    this.commit();
  }

  rotateSelection(degrees: number): void {
    const nodes = this.selection;
    const bounds = this.selectionBounds;
    if (!nodes.length || !bounds) return;
    const cx = bounds.x + bounds.width / 2;
    const cy = bounds.y + bounds.height / 2;
    const a = (degrees * Math.PI) / 180;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    this.applyMatrix(nodes, [
      cos,
      sin,
      -sin,
      cos,
      cx - cos * cx + sin * cy,
      cy - sin * cx - cos * cy,
    ]);
    this.refreshOverlay();
    this.commit();
  }

  /* ---------------------------------------------------------------- *
   * Z-order
   * ---------------------------------------------------------------- */

  bringToFront(): void {
    const nodes = this.selection;
    if (!nodes.length) return;
    for (const node of this.inDocumentOrder(nodes))
      this.scene.node.appendChild(node);
    this.commit();
  }

  sendToBack(): void {
    const nodes = this.inDocumentOrder(this.selection).reverse();
    if (!nodes.length) return;
    for (const node of nodes)
      this.scene.node.insertBefore(node, this.scene.node.firstChild);
    this.commit();
  }

  bringForward(): void {
    const selected = new Set(this.selection);
    if (!selected.size) return;
    const ordered = this.inDocumentOrder([...selected]).reverse();
    for (const node of ordered) {
      let next = node.nextElementSibling;
      while (next && selected.has(next as SVGGraphicsElement))
        next = next.nextElementSibling;
      if (next) this.scene.node.insertBefore(node, next.nextSibling);
    }
    this.commit();
  }

  sendBackward(): void {
    const selected = new Set(this.selection);
    if (!selected.size) return;
    for (const node of this.inDocumentOrder([...selected])) {
      let prev = node.previousElementSibling;
      while (prev && selected.has(prev as SVGGraphicsElement))
        prev = prev.previousElementSibling;
      if (prev) this.scene.node.insertBefore(node, prev);
    }
    this.commit();
  }

  private inDocumentOrder(nodes: SVGGraphicsElement[]): SVGGraphicsElement[] {
    const order = this.items;
    return nodes.slice().sort((a, b) => order.indexOf(a) - order.indexOf(b));
  }

  /* ---------------------------------------------------------------- *
   * Group / ungroup
   * ---------------------------------------------------------------- */

  group(): SVGGElement | null {
    const nodes = this.inDocumentOrder(this.selection);
    if (nodes.length < 2) return null;
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    this.scene.node.insertBefore(g, nodes[nodes.length - 1].nextSibling);
    for (const node of nodes) g.appendChild(node);
    ensurePid(g);
    this.setSelection([g]);
    this.commit();
    return g;
  }

  ungroup(): SVGGraphicsElement[] {
    const released: SVGGraphicsElement[] = [];
    let changed = false;
    for (const node of this.selection) {
      if (node.tagName.toLowerCase() !== "g") {
        released.push(node);
        continue;
      }
      changed = true;
      const gm = this.itemMatrix(node);
      const kids = Array.from(node.children).filter(isItemNode);
      for (const kid of kids) {
        this.setItemMatrix(kid, matMultiply(gm, this.itemMatrix(kid)));
        this.scene.node.insertBefore(kid, node);
        ensurePid(kid);
        released.push(kid);
      }
      node.remove();
    }
    if (!changed) return released;
    this.setSelection(released);
    this.commit();
    return released;
  }

  /* ---------------------------------------------------------------- *
   * Clipboard
   * ---------------------------------------------------------------- */

  copy(): boolean {
    const nodes = this.inDocumentOrder(this.selection);
    if (!nodes.length) return false;
    const bounds = this.selectionBounds ?? { x: 0, y: 0, width: 0, height: 0 };
    setClipboard({
      kind: "vector",
      svg: nodes.map((n) => n.outerHTML).join(""),
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    });
    return true;
  }

  cut(): boolean {
    if (!this.copy()) return false;
    this.deleteSelection();
    return true;
  }

  paste(): SVGGraphicsElement[] {
    const clip = getClipboard();
    if (!clip) return [];
    const offset = nextPasteOffset(12);
    const added: SVGGraphicsElement[] = [];

    if (clip.kind === "vector") {
      const holder = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "g",
      );
      holder.innerHTML = clip.svg;
      for (const child of Array.from(holder.children)) {
        if (!isItemNode(child)) continue;
        const node = child as SVGGraphicsElement;
        node.removeAttribute("data-pid");
        this.scene.node.appendChild(node);
        ensurePid(node);
        this.setItemMatrix(
          node,
          matMultiply([1, 0, 0, 1, offset, offset], this.itemMatrix(node)),
        );
        added.push(node);
      }
    } else {
      const image = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "image",
      );
      image.setAttribute("href", clip.dataURL);
      image.setAttribute("x", String(round(clip.x + offset, 2)));
      image.setAttribute("y", String(round(clip.y + offset, 2)));
      image.setAttribute("width", String(clip.width));
      image.setAttribute("height", String(clip.height));
      image.setAttribute("image-rendering", "pixelated");
      this.scene.node.appendChild(image);
      ensurePid(image);
      added.push(image as unknown as SVGGraphicsElement);
    }

    if (!added.length) return [];
    this.setSelection(added);
    this.commit();
    return added;
  }

  duplicate(): SVGGraphicsElement[] {
    const nodes = this.inDocumentOrder(this.selection);
    if (!nodes.length) return [];
    const added = nodes.map((node) => {
      const clone = node.cloneNode(true) as SVGGraphicsElement;
      clone.removeAttribute("data-pid");
      for (const nested of Array.from(clone.querySelectorAll("[data-pid]")))
        nested.removeAttribute("data-pid");
      this.scene.node.appendChild(clone);
      ensurePid(clone);
      this.setItemMatrix(
        clone,
        matMultiply([1, 0, 0, 1, 12, 12], this.itemMatrix(clone)),
      );
      return clone;
    });
    this.setSelection(added);
    this.commit();
    return added;
  }

  deleteSelection(): boolean {
    const nodes = this.selection;
    if (!nodes.length) return false;
    for (const node of nodes) node.remove();
    this.selectedIds = [];
    this.refreshOverlay();
    this.emitter.emit("selectionchange", undefined);
    this.commit();
    return true;
  }

  /* ---------------------------------------------------------------- *
   * Boolean editing (eraser & friends)
   * ---------------------------------------------------------------- */

  /**
   * Subtracts `eraseRings` (scene space) from every item it touches.
   * Items are rebuilt as flat paths holding the remaining fill and outline
   * regions, which is what makes the vector eraser behave like a real eraser
   * instead of a mask.
   */
  subtractFromItems(
    eraseRings: Rings,
    targets?: SVGGraphicsElement[],
  ): boolean {
    if (!eraseRings.length) return false;
    let changed = false;
    for (const item of targets ?? this.items) {
      changed =
        this.eraseNode(
          item,
          this.scene.node as SVGGraphicsElement,
          eraseRings,
        ) || changed;
    }
    if (changed) {
      this.selectedIds = this.selectedIds.filter((id) => this.findById(id));
      this.refreshOverlay();
      this.emitter.emit("selectionchange", undefined);
      this.commit();
    }
    return changed;
  }

  /** Recursive worker for {@link subtractFromItems}; groups keep their nesting. */
  private eraseNode(
    node: SVGGraphicsElement,
    parent: SVGGraphicsElement,
    eraseRings: Rings,
  ): boolean {
    if (node.tagName.toLowerCase() === "g") {
      let changed = false;
      for (const kid of Array.from(node.children).filter(isItemNode)) {
        changed =
          this.eraseNode(kid as SVGGraphicsElement, node, eraseRings) ||
          changed;
      }
      if (!node.children.length) node.remove();
      return changed;
    }

    const scene = this.scene.node as SVGGraphicsElement;
    let geo;
    try {
      geo = itemGeometry(node, scene);
    } catch {
      return false;
    }
    if (!geo.fill.length && !geo.stroke.length) return false;
    if (!ringsOverlap([...geo.fill, ...geo.stroke], eraseRings)) return false;

    const style = readStyle(node);
    const fillLeft = geo.fill.length
      ? differenceRings(geo.fill, eraseRings)
      : [];
    const strokeLeft = geo.stroke.length
      ? differenceRings(geo.stroke, eraseRings)
      : [];

    // Replacements are built in scene space, so undo the parent's transform.
    const localFromScene = matInvert(elementMatrixTo(parent, scene));
    const replacements: SVGPathElement[] = [];
    if (fillLeft.length)
      replacements.push(
        this.buildRegionPath(fillLeft, style.fill ?? "#000000"),
      );
    if (strokeLeft.length)
      replacements.push(
        this.buildRegionPath(strokeLeft, style.stroke ?? "#000000"),
      );
    for (const path of replacements) {
      this.setItemMatrix(path as unknown as SVGGraphicsElement, localFromScene);
      parent.insertBefore(path, node);
    }
    node.remove();
    return true;
  }

  private buildRegionPath(rings: Rings, fill: string): SVGPathElement {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", ringsToPathData(rings));
    path.setAttribute("fill", fill);
    // Clipper hands back correctly oriented outers and holes.
    path.setAttribute("fill-rule", "nonzero");
    path.setAttribute("stroke", "none");
    ensurePid(path);
    return path;
  }

  /** Replaces a `<text>` item with traced glyph outlines. */
  convertTextToPath(item: SVGGraphicsElement): SVGGraphicsElement | null {
    if (item.tagName.toLowerCase() !== "text") return null;
    const scene = this.scene.node as SVGGraphicsElement;
    const geo = itemGeometry(item, scene);
    if (!geo.fill.length) return null;
    const style = readStyle(item);
    const path = this.buildRegionPath(geo.fill, style.fill ?? "#000000");
    path.setAttribute("fill-rule", "evenodd");
    this.scene.node.insertBefore(path, item);
    const wasSelected = this.selectedIds.includes(ensurePid(item));
    item.remove();
    if (wasSelected) this.setSelection([path]);
    this.commit();
    return path;
  }

  /* ---------------------------------------------------------------- *
   * History
   * ---------------------------------------------------------------- */

  get canUndo(): boolean {
    return this.history.canUndo;
  }
  get canRedo(): boolean {
    return this.history.canRedo;
  }

  private snapshot(): VectorSnapshot {
    return { svg: this.layersRoot.node.innerHTML, selection: [...this.selectedIds], layer: this.activeLayerIndex };
  }

  /** Records the current document state as one undo step. */
  commit(): void {
    this.invalidateBarrierCache();
    this.history.push(this.snapshot());
    this.emitter.emit("change", undefined);
  }

  undo(): void {
    const snapshot = this.history.undo();
    if (snapshot) this.restore(snapshot);
  }

  redo(): void {
    const snapshot = this.history.redo();
    if (snapshot) this.restore(snapshot);
  }

  private restore(snapshot: VectorSnapshot): void {
    this.invalidateBarrierCache();
    this.activeTool?.cancel?.();
    this.history.silently(() => {
      this.layersRoot.node.innerHTML = snapshot.svg;
      this.activateLayer(snapshot.layer);
      this.selectedIds = snapshot.selection.filter((id) => this.findById(id));
    });
    this.refreshOverlay();
    this.emitter.emit("selectionchange", undefined);
    this.emitter.emit("change", undefined);
  }

  /* ---------------------------------------------------------------- *
   * Overlay & Fill Preview
   * ---------------------------------------------------------------- */

  ensureDefs(): void {
    let defs = this.draw.node.querySelector("defs");
    if (!defs) {
      defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
      this.draw.node.insertBefore(defs, this.draw.node.firstChild);
    }
    if (!defs.querySelector("#pt-fill-grid-pattern")) {
      const svgNs = "http://www.w3.org/2000/svg";
      const pattern = document.createElementNS(svgNs, "pattern");
      pattern.setAttribute("id", "pt-fill-grid-pattern");
      pattern.setAttribute("width", "12");
      pattern.setAttribute("height", "12");
      pattern.setAttribute("patternUnits", "userSpaceOnUse");

      const bg = document.createElementNS(svgNs, "rect");
      bg.setAttribute("width", "12");
      bg.setAttribute("height", "12");
      bg.setAttribute("fill", "rgba(37, 99, 235, 0.08)");
      pattern.appendChild(bg);

      const ch1 = document.createElementNS(svgNs, "rect");
      ch1.setAttribute("x", "0");
      ch1.setAttribute("y", "0");
      ch1.setAttribute("width", "6");
      ch1.setAttribute("height", "6");
      ch1.setAttribute("fill", "rgba(37, 99, 235, 0.12)");
      pattern.appendChild(ch1);

      const ch2 = document.createElementNS(svgNs, "rect");
      ch2.setAttribute("x", "6");
      ch2.setAttribute("y", "6");
      ch2.setAttribute("width", "6");
      ch2.setAttribute("height", "6");
      ch2.setAttribute("fill", "rgba(37, 99, 235, 0.12)");
      pattern.appendChild(ch2);

      const grid = document.createElementNS(svgNs, "path");
      grid.setAttribute("d", "M 12 0 L 0 0 0 12");
      grid.setAttribute("fill", "none");
      grid.setAttribute("stroke", "rgba(37, 99, 235, 0.35)");
      grid.setAttribute("stroke-width", "1");
      pattern.appendChild(grid);

      defs.appendChild(pattern);
    }
  }

  showFillPreview(target: FillPreviewTarget): void {
    this.ensureDefs();
    const scene = this.scene.node as SVGGraphicsElement;
    const k = 1 / this._zoom;

    let key = "";
    if (target.kind === "region") {
      key = `region:${target.d}`;
    } else {
      key = `${target.kind}:${pidOf(target.node)}`;
    }

    if (
      this._previewTargetKey === key &&
      this._previewElement &&
      this._previewElement.parentNode
    ) {
      return;
    }

    this.clearFillPreview();
    this._previewTargetKey = key;

    const svgNs = "http://www.w3.org/2000/svg";
    if (target.kind === "region") {
      const path = document.createElementNS(svgNs, "path");
      path.setAttribute("d", target.d);
      path.setAttribute("class", "pt-fill-preview");
      path.setAttribute("fill-rule", "evenodd");
      path.setAttribute("stroke-width", String(round(1.5 * k, 2)));
      this.overlay.node.appendChild(path);
      this._previewElement = path;
    } else if (target.kind === "shape") {
      const d = shapeToPathData(target.node);
      if (!d) return;
      const m = elementMatrixTo(target.node, scene);
      const path = document.createElementNS(svgNs, "path");
      path.setAttribute("d", d);
      path.setAttribute("class", "pt-fill-preview");
      if (
        m[0] !== 1 ||
        m[1] !== 0 ||
        m[2] !== 0 ||
        m[3] !== 1 ||
        m[4] !== 0 ||
        m[5] !== 0
      ) {
        path.setAttribute("transform", matToString(m));
      }
      path.setAttribute("stroke-width", String(round(1.5 * k, 2)));
      this.overlay.node.appendChild(path);
      this._previewElement = path;
    } else if (target.kind === "stroke") {
      const d = shapeToPathData(target.node);
      if (!d) return;
      const m = elementMatrixTo(target.node, scene);
      const style = readStyle(target.node);
      const sw = Math.max(style.strokeWidth || 2, 2) * k;
      const path = document.createElementNS(svgNs, "path");
      path.setAttribute("d", d);
      path.setAttribute("class", "pt-fill-stroke-preview");
      if (
        m[0] !== 1 ||
        m[1] !== 0 ||
        m[2] !== 0 ||
        m[3] !== 1 ||
        m[4] !== 0 ||
        m[5] !== 0
      ) {
        path.setAttribute("transform", matToString(m));
      }
      path.setAttribute("stroke-width", String(round(sw, 2)));
      this.overlay.node.appendChild(path);
      this._previewElement = path;
    }
  }

  clearFillPreview(): void {
    if (this._previewElement) {
      this._previewElement.remove();
      this._previewElement = null;
    }
    this._previewTargetKey = null;
  }

  clearOverlay(): void {
    this._previewElement = null;
    this._previewTargetKey = null;
    this.overlay.node.replaceChildren();
  }

  /** Redraws the selection box unless a tool asked to own the overlay. */
  refreshOverlay(customBounds?: Rect, transformMatrix?: Matrix): void {
    if (this.suppressOverlay) return;
    this.clearOverlay();
    const nodes = this.selection;
    if (!nodes.length) return;
    if (this._tool === "reshape") return;
    const bounds = customBounds ?? this.selectionBounds;
    if (!bounds) return;
    this.drawSelectionBox(
      bounds,
      nodes.length > 1 && !transformMatrix ? nodes : [],
      transformMatrix,
    );
  }

  private drawSelectionBox(
    bounds: Rect,
    extra: SVGGraphicsElement[],
    transformMatrix?: Matrix,
  ): void {
    const scene = this.scene.node as SVGGraphicsElement;
    const k = 1 / this._zoom;
    const root = this.overlay.node;
    let targetParent: SVGElement = root;

    if (transformMatrix) {
      const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
      group.setAttribute("transform", matToString(transformMatrix));
      root.appendChild(group);
      targetParent = group;
    }

    for (const node of extra) {
      const b = boundsIn(node, scene);
      targetParent.appendChild(this.overlayRect(b, "pt-item-outline", k));
    }
    targetParent.appendChild(this.overlayRect(bounds, "pt-selection-box", k));

    const rotateOffset = ROTATE_OFFSET * k;
    const stem = document.createElementNS("http://www.w3.org/2000/svg", "line");
    stem.setAttribute("x1", String(bounds.x + bounds.width / 2));
    stem.setAttribute("y1", String(bounds.y));
    stem.setAttribute("x2", String(bounds.x + bounds.width / 2));
    stem.setAttribute("y2", String(bounds.y - rotateOffset));
    stem.setAttribute("class", "pt-handle-stem");
    stem.setAttribute("stroke-width", String(k));
    targetParent.appendChild(stem);

    for (const kind of HANDLE_KINDS) {
      targetParent.appendChild(
        this.overlayHandle(handlePoint(bounds, kind), kind, k, false),
      );
    }
    targetParent.appendChild(
      this.overlayHandle(
        handlePoint(bounds, "rotate", rotateOffset),
        "rotate",
        k,
        true,
      ),
    );
  }

  private overlayRect(rect: Rect, cls: string, k: number): SVGRectElement {
    const r = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    r.setAttribute("x", String(round(rect.x, 2)));
    r.setAttribute("y", String(round(rect.y, 2)));
    r.setAttribute("width", String(round(Math.max(rect.width, 0.01), 2)));
    r.setAttribute("height", String(round(Math.max(rect.height, 0.01), 2)));
    r.setAttribute("class", cls);
    r.setAttribute("stroke-width", String(k));
    r.setAttribute("stroke-dasharray", `${4 * k} ${3 * k}`);
    return r;
  }

  private overlayHandle(
    point: Point,
    kind: HandleKind,
    k: number,
    round_: boolean,
  ): SVGElement {
    const size = HANDLE_SIZE * k;
    if (round_) {
      const c = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "circle",
      );
      c.setAttribute("cx", String(point.x));
      c.setAttribute("cy", String(point.y));
      c.setAttribute("r", String(size / 2));
      c.setAttribute("class", "pt-handle pt-handle-rotate");
      c.setAttribute("stroke-width", String(k));
      c.setAttribute("data-handle", kind);
      return c;
    }
    const r = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    r.setAttribute("x", String(point.x - size / 2));
    r.setAttribute("y", String(point.y - size / 2));
    r.setAttribute("width", String(size));
    r.setAttribute("height", String(size));
    r.setAttribute("class", "pt-handle");
    r.setAttribute("stroke-width", String(k));
    r.setAttribute("data-handle", kind);
    return r;
  }

  /** Which selection handle sits under the cursor, if any. */
  hitHandle(clientX: number, clientY: number): HandleKind | null {
    const bounds = this.selectionBounds;
    if (!bounds || !this.selection.length) return null;
    const p = this.clientToScene(clientX, clientY);
    const k = 1 / this._zoom;
    const slop = Math.max((HANDLE_SIZE * k) / 2 + 2.5 * k, 7 * k);

    const cx = bounds.x + bounds.width / 2;
    const rotateOffset = ROTATE_OFFSET * k;
    const knobY = bounds.y - rotateOffset;

    // Check rotate handle (both the knob and along the vertical stem rod)
    const distToKnob = Math.hypot(p.x - cx, p.y - knobY);
    const onStem =
      Math.abs(p.x - cx) <= slop &&
      p.y >= knobY - slop &&
      p.y < bounds.y - 1.5 * k;

    if (distToKnob <= slop * 1.3 || onStem) {
      return "rotate";
    }

    const candidates: Array<[HandleKind, Point]> = HANDLE_KINDS.map((kind) => [
      kind,
      handlePoint(bounds, kind),
    ]);
    for (const [kind, point] of candidates) {
      if (Math.abs(p.x - point.x) <= slop && Math.abs(p.y - point.y) <= slop)
        return kind;
    }
    return null;
  }

  cursorForHandle(kind: HandleKind): string {
    return HANDLE_CURSORS[kind];
  }

  setCursor(cursor: string): void {
    this.draw.node.style.cursor = cursor;
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
      case "Delete":
      case "Backspace":
        if (this.deleteSelection()) e.preventDefault();
        break;
      case "Escape":
        this.activeTool?.cancel?.();
        this.deselect();
        break;
      case "ArrowLeft":
        this.nudge(-step, 0, e);
        break;
      case "ArrowRight":
        this.nudge(step, 0, e);
        break;
      case "ArrowUp":
        this.nudge(0, -step, e);
        break;
      case "ArrowDown":
        this.nudge(0, step, e);
        break;
      case "a":
        if (mod) {
          this.selectAll();
          e.preventDefault();
        }
        break;
      case "c":
        if (mod) {
          this.copy();
          e.preventDefault();
        }
        break;
      case "x":
        if (mod) {
          this.cut();
          e.preventDefault();
        }
        break;
      case "v":
        if (mod) {
          this.paste();
          e.preventDefault();
        }
        break;
      case "d":
        if (mod) {
          this.duplicate();
          e.preventDefault();
        }
        break;
      case "g":
        if (mod) {
          e.shiftKey ? this.ungroup() : this.group();
          e.preventDefault();
        }
        break;
      case "z":
        if (mod) {
          e.shiftKey ? this.redo() : this.undo();
          e.preventDefault();
        }
        break;
      case "y":
        if (mod) {
          this.redo();
          e.preventDefault();
        }
        break;
      default:
        break;
    }
  }

  private nudge(dx: number, dy: number, e: KeyboardEvent): void {
    if (!this.selection.length) return;
    this.translateSelection(dx, dy);
    e.preventDefault();
  }

  /* ---------------------------------------------------------------- *
   * Layers
   * ---------------------------------------------------------------- */

  private makeLayer(name: string): G {
    const layer = this.layersRoot.group().addClass("pt-scene");
    layer.node.setAttribute(LAYER_ATTR, name);
    return layer;
  }

  private layerNodes(): SVGGElement[] {
    return Array.from(this.layersRoot.node.children).filter(
      (child): child is SVGGElement => child.tagName.toLowerCase() === "g",
    );
  }

  private get activeLayerIndex(): number {
    return Math.max(0, this.layerNodes().indexOf(this.scene.node as SVGGElement));
  }

  /** Points drawing at a layer; a missing one (or none at all) is made. */
  private activateLayer(index: number): void {
    let layers = this.layerNodes();
    if (!layers.length) {
      this.makeLayer("레이어 1");
      layers = this.layerNodes();
    }
    const node = layers[Math.min(Math.max(0, index), layers.length - 1)]!;
    this.scene = SVG(node) as G;
  }

  /** The layers, bottom first. */
  get layers(): LayerInfo[] {
    return this.layerNodes().map((node) => ({
      name: node.getAttribute(LAYER_ATTR) || "레이어",
      visible: node.getAttribute("display") !== "none",
      active: node === this.scene.node,
    }));
  }

  private layersChanged(record: boolean): void {
    this.selectedIds = [];
    this.refreshOverlay();
    this.emitter.emit("selectionchange", undefined);
    this.emitter.emit("layerchange", undefined);
    if (record) this.commit();
  }

  /** Adds an empty layer above the one being drawn on and draws on it. */
  addLayer(name?: string): void {
    const layers = this.layerNodes();
    const layer = this.makeLayer(name ?? `레이어 ${layers.length + 1}`);
    const above = this.scene.node.nextSibling;
    if (above) this.layersRoot.node.insertBefore(layer.node, above);
    this.scene = layer;
    this.layersChanged(true);
  }

  /** Removes a layer and what is on it; the last one left stays. */
  removeLayer(index: number): void {
    const layers = this.layerNodes();
    if (layers.length < 2 || !layers[index]) return;
    const wasActive = layers[index] === this.scene.node;
    layers[index]!.remove();
    if (wasActive) this.activateLayer(Math.max(0, index - 1));
    this.layersChanged(true);
  }

  selectLayer(index: number): void {
    const before = this.scene.node;
    this.activateLayer(index);
    if (this.scene.node !== before) this.layersChanged(false);
  }

  setLayerVisible(index: number, visible: boolean): void {
    const layer = this.layerNodes()[index];
    if (!layer) return;
    if (visible) layer.removeAttribute("display");
    else layer.setAttribute("display", "none");
    this.layersChanged(true);
  }

  renameLayer(index: number, name: string): void {
    const layer = this.layerNodes()[index];
    if (!layer || !name.trim()) return;
    layer.setAttribute(LAYER_ATTR, name.trim());
    this.layersChanged(true);
  }

  /** Moves a layer to another place in the stack (0 is the bottom). */
  moveLayerTo(index: number, to: number): void {
    const layers = this.layerNodes();
    const layer = layers[index];
    const target = Math.max(0, Math.min(layers.length - 1, to));
    if (!layer || target === index) return;
    const rest = layers.filter((_, at) => at !== index);
    const after = rest[target];
    if (after) this.layersRoot.node.insertBefore(layer, after);
    else this.layersRoot.node.appendChild(layer);
    this.layersChanged(true);
  }

  /** Moves a layer one step up (+1) or down (-1) the stack. */
  moveLayer(index: number, step: 1 | -1): void {
    const layers = this.layerNodes();
    const layer = layers[index];
    const other = layers[index + step];
    if (!layer || !other) return;
    if (step > 0) this.layersRoot.node.insertBefore(layer, other.nextSibling);
    else this.layersRoot.node.insertBefore(layer, other);
    this.layersChanged(true);
  }

  /* ---------------------------------------------------------------- *
   * Import / export
   * ---------------------------------------------------------------- */

  /**
   * Standalone SVG markup for the whole canvas. One visible layer is written
   * as plain items; more are written as `<g data-layer>` groups, a hidden one
   * with `display="none"`, which `loadSVG` reads back as layers.
   */
  toSVG(): string {
    const layers = this.layerNodes();
    const plain = layers.length === 1 && layers[0]!.getAttribute("display") !== "none";
    const body = plain
      ? layers[0]!.innerHTML
      : layers
          .map((layer) => {
            const name = (layer.getAttribute(LAYER_ATTR) ?? "").replace(/[&"<>]/g, (c) => `&#${c.charCodeAt(0)};`);
            const hidden = layer.getAttribute("display") === "none" ? ' display="none"' : "";
            return `<g ${LAYER_ATTR}="${name}"${hidden}>${layer.innerHTML}</g>`;
          })
          .join("");
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
      `width="${this._width}" height="${this._height}" viewBox="0 0 ${this._width} ${this._height}">` +
      `${body}</svg>`
    );
  }

  loadSVG(markup: string, options: { resize?: boolean } = {}): void {
    const doc = new DOMParser().parseFromString(markup, "image/svg+xml");
    const svg = doc.documentElement;
    if (svg.nodeName === "parsererror" || !svg) return;
    if (options.resize !== false) {
      const vb = (svg.getAttribute("viewBox") ?? "")
        .split(/[\s,]+/)
        .map(Number);
      if (vb.length === 4 && vb.every(Number.isFinite))
        this.resize(vb[2], vb[3]);
      else {
        const w = parseFloat(svg.getAttribute("width") ?? "");
        const h = parseFloat(svg.getAttribute("height") ?? "");
        if (Number.isFinite(w) && Number.isFinite(h)) this.resize(w, h);
      }
    }
    // Groups written as layers come back as layers; anything else is one layer.
    const children = Array.from(svg.children).filter((child) => isItemNode(child) || child.tagName.toLowerCase() === "defs");
    const layered = children.length > 0
      && children.every((child) => child.tagName.toLowerCase() === "g" && child.hasAttribute(LAYER_ATTR));
    const groups = layered
      ? children.map((child) => ({
          name: child.getAttribute(LAYER_ATTR) || "레이어",
          hidden: child.getAttribute("display") === "none",
          items: Array.from(child.children),
          // A move put on the whole layer (a host re-framing the sheet) carries on to its items.
          transform: child.getAttribute("transform"),
        }))
      : [{ name: "레이어 1", hidden: false, items: children, transform: null as string | null }];
    this.layersRoot.node.replaceChildren();
    for (const group of groups) {
      const layer = this.makeLayer(group.name);
      if (group.hidden) layer.node.setAttribute("display", "none");
      for (const child of group.items) {
        const node = document.importNode(child, true) as SVGGraphicsElement;
        node.removeAttribute("data-pid");
        if (group.transform && isItemNode(node)) {
          const own = node.getAttribute("transform");
          node.setAttribute("transform", `${group.transform}${own ? ` ${own}` : ""}`);
        }
        layer.node.appendChild(node);
        if (isItemNode(node)) ensurePid(node);
      }
    }
    this.activateLayer(groups.length - 1);
    this.selectedIds = [];
    this.refreshOverlay();
    this.history.reset(this.snapshot());
    this.emitter.emit("change", undefined);
    this.emitter.emit("selectionchange", undefined);
  }

  clear(): void {
    this.scene.node.replaceChildren();
    this.selectedIds = [];
    this.refreshOverlay();
    this.emitter.emit("selectionchange", undefined);
    this.commit();
  }

  get isEmpty(): boolean {
    return this.items.length === 0;
  }

  destroy(): void {
    this.activeTool?.cancel?.();
    this.activeTool?.deactivate?.();
    for (const off of this.unbind) off();
    this.unbind.length = 0;
    this.emitter.clearListeners();
    this.root.remove();
  }

  /** Scene-space point for a pointer sample (tools use this a lot). */
  point(info: PointerInfo): Point {
    return { x: info.x, y: info.y };
  }

  /** Maps a scene point through an item's inverse transform. */
  toItemSpace(item: SVGGraphicsElement, p: Point): Point {
    const m = elementMatrixTo(item, this.scene.node as SVGGraphicsElement);
    const inv = [
      m[3],
      -m[1],
      -m[2],
      m[0],
      m[2] * m[5] - m[3] * m[4],
      m[1] * m[4] - m[0] * m[5],
    ] as Matrix;
    const det = m[0] * m[3] - m[1] * m[2] || 1;
    const normalized: Matrix = [
      inv[0] / det,
      inv[1] / det,
      inv[2] / det,
      inv[3] / det,
      inv[4] / det,
      inv[5] / det,
    ];
    return matApply(normalized, p);
  }
}

/** The wall at half size: a half pixel is wall when any of its four is, so no line drops out. */
function halfWall(barrier: BarrierCache): { hw: number; hh: number; wall: Uint8Array } {
  if (barrier.half) return barrier.half;
  const { rw, rh, wall } = barrier;
  const hw = Math.ceil(rw / 2);
  const hh = Math.ceil(rh / 2);
  const half = new Uint8Array(hw * hh);
  for (let y = 0; y < rh; y++) {
    const row = y * rw;
    const halfRow = (y >> 1) * hw;
    for (let x = 0; x < rw; x++) if (wall[row + x]) half[halfRow + (x >> 1)] = 1;
  }
  barrier.half = { hw, hh, wall: half };
  return barrier.half;
}

function dilateMask(
  src: Uint8Array,
  w: number,
  h: number,
  radius: number,
): Uint8Array {
  if (radius <= 0) return src;
  const temp = new Uint8Array(src.length);
  const dst = new Uint8Array(src.length);

  for (let y = 0; y < h; y++) {
    const row = y * w;
    let count = 0;
    for (let x = -radius; x <= radius; x++) {
      if (x >= 0 && x < w && src[row + x]) count++;
    }
    for (let x = 0; x < w; x++) {
      temp[row + x] = count > 0 ? 1 : 0;
      const outX = x - radius;
      if (outX >= 0 && outX < w && src[row + outX]) count--;
      const inX = x + radius + 1;
      if (inX >= 0 && inX < w && src[row + inX]) count++;
    }
  }

  for (let x = 0; x < w; x++) {
    let count = 0;
    for (let y = -radius; y <= radius; y++) {
      if (y >= 0 && y < h && temp[y * w + x]) count++;
    }
    for (let y = 0; y < h; y++) {
      dst[y * w + x] = count > 0 ? 1 : 0;
      const outY = y - radius;
      if (outY >= 0 && outY < h && temp[outY * w + x]) count--;
      const inY = y + radius + 1;
      if (inY >= 0 && inY < h && temp[inY * w + x]) count++;
    }
  }

  return dst;
}

function floodBorders(
  wall: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const mask = new Uint8Array(width * height);
  // Every pixel is queued at most once.
  const queue = new Int32Array(width * height);
  let tail = 0;

  for (let x = 0; x < width; x++) {
    if (!wall[x]) {
      mask[x] = 1;
      queue[tail++] = x;
    }
    const b = (height - 1) * width + x;
    if (!wall[b] && !mask[b]) {
      mask[b] = 1;
      queue[tail++] = (b);
    }
  }
  for (let y = 0; y < height; y++) {
    const l = y * width;
    if (!wall[l] && !mask[l]) {
      mask[l] = 1;
      queue[tail++] = (l);
    }
    const r = l + width - 1;
    if (!wall[r] && !mask[r]) {
      mask[r] = 1;
      queue[tail++] = (r);
    }
  }

  let head = 0;
  while (head < tail) {
    const idx = queue[head++];
    const y = (idx / width) | 0;
    const x = idx % width;
    if (x > 0) {
      const n = idx - 1;
      if (!wall[n] && !mask[n]) {
        mask[n] = 1;
        queue[tail++] = (n);
      }
    }
    if (x < width - 1) {
      const n = idx + 1;
      if (!wall[n] && !mask[n]) {
        mask[n] = 1;
        queue[tail++] = (n);
      }
    }
    if (y > 0) {
      const n = idx - width;
      if (!wall[n] && !mask[n]) {
        mask[n] = 1;
        queue[tail++] = (n);
      }
    }
    if (y < height - 1) {
      const n = idx + width;
      if (!wall[n] && !mask[n]) {
        mask[n] = 1;
        queue[tail++] = (n);
      }
    }
  }
  return mask;
}

/** The drawable shapes inside an item (the item itself when it is one). */
function geometryLeaves(item: SVGGraphicsElement): SVGGeometryElement[] {
  if (item instanceof SVGGeometryElement) return [item];
  return Array.from(item.querySelectorAll("path, rect, circle, ellipse, line, polyline, polygon")).filter(
    (node): node is SVGGeometryElement => node instanceof SVGGeometryElement,
  );
}

/** `count` points spaced evenly along a closed ring. */
function resampleRing(ring: Array<{ x: number; y: number }>, count: number): Array<{ x: number; y: number }> {
  if (ring.length < 2) return ring.slice();
  const lengths: number[] = [];
  let total = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    lengths.push(length);
    total += length;
  }
  if (!total) return [ring[0]];
  const out: Array<{ x: number; y: number }> = [];
  const step = total / count;
  let edge = 0;
  let start = 0;
  for (let k = 0; k < count; k++) {
    const at = k * step;
    while (edge < ring.length - 1 && start + lengths[edge] < at) {
      start += lengths[edge];
      edge++;
    }
    const a = ring[edge];
    const b = ring[(edge + 1) % ring.length];
    const t = lengths[edge] ? (at - start) / lengths[edge] : 0;
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return out;
}
