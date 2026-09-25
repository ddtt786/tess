import type { Tool } from "../../core/tool.js";
import type { Point, PointerInfo, Rect } from "../../core/types.js";
import type { Matrix } from "../../core/geom.js";
import { rectFromCorners, round } from "../../core/geom.js";
import type { VectorPainter } from "../VectorPainter.js";
import type { HandleKind } from "../selection.js";
import { rotateMatrixFor, scaleMatrixFor } from "../selection.js";
import type { TextTool } from "./text.js";
import { paintBoundsIn } from "../scene.js";

type Mode = "idle" | "move" | "scale" | "rotate" | "marquee";

/** How close (screen pixels) the selection's middle has to come to the canvas middle to catch on it. */
const SNAP_PX = 8;

/**
 * Select / move / scale / rotate, plus rubber-band selection — the tool the
 * whole toolbar (group, order, flip, copy, ...) operates through.
 */
export class SelectTool implements Tool {
  readonly name = "select";
  readonly cursor = "default";

  private mode: Mode = "idle";
  private handle: HandleKind | null = null;
  private base = new Map<SVGGraphicsElement, Matrix>();
  private startBounds: Rect | null = null;
  private startPoint: Point = { x: 0, y: 0 };
  private moved = false;
  private marquee: SVGRectElement | null = null;

  constructor(private readonly painter: VectorPainter) {}

  activate(): void {
    this.painter.refreshOverlay();
  }

  deactivate(): void {
    this.cancel();
  }

  onPointerDown(info: PointerInfo): void {
    this.moved = false;
    this.startPoint = { x: info.x, y: info.y };

    const handle = this.painter.hitHandle(info.clientX, info.clientY);
    if (handle) {
      this.handle = handle;
      this.mode = handle === "rotate" ? "rotate" : "scale";
      this.captureBase();
      if (handle === "rotate") {
        this.painter.setCursor("grabbing");
      }
      return;
    }

    const hit = this.painter.hitTest(
      info.clientX,
      info.clientY,
      this.painter.screenToSceneLength(3) * this.painter.zoom,
      { anyLayer: true },
    );
    if (hit) {
      const selected = this.painter.selection;
      if (info.shiftKey) {
        this.painter.toggleSelection(hit.item);
      } else if (!selected.includes(hit.item)) {
        this.painter.setSelection([hit.item]);
      }
      if (this.painter.selection.length) {
        this.mode = "move";
        this.captureBase();
      }
      return;
    }

    if (!info.shiftKey) this.painter.deselect();
    this.mode = "marquee";
    this.painter.suppressOverlay = true;
    this.painter.clearOverlay();
    this.marquee = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "rect",
    );
    this.marquee.setAttribute("class", "pt-marquee");
    this.marquee.setAttribute("stroke-width", String(1 / this.painter.zoom));
    this.marquee.setAttribute(
      "stroke-dasharray",
      `${4 / this.painter.zoom} ${3 / this.painter.zoom}`,
    );
    this.painter.overlay.node.appendChild(this.marquee);
  }

  onPointerMove(info: PointerInfo): void {
    if (this.mode === "idle") return;
    const dx = info.x - info.startX;
    const dy = info.y - info.startY;
    if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) this.moved = true;

    switch (this.mode) {
      case "move": {
        let mx = dx;
        let my = dy;
        if (info.shiftKey && !info.altKey) {
          // Shift: edges and middles catch on those of the other shapes and the canvas.
          const caught = this.snapToItems(mx, my);
          this.painter.applyMatrix([...this.base.keys()], [1, 0, 0, 1, caught.mx, caught.my], this.base);
          this.painter.refreshOverlay();
          this.drawLines(caught.x, caught.y);
          break;
        }
        // The selection's middle catches on the canvas middle (Alt moves freely).
        const snapped = info.altKey ? { x: false, y: false } : this.snapToCentre(mx, my);
        if (snapped.x) mx = this.painter.width / 2 - this.startCentre().x;
        if (snapped.y) my = this.painter.height / 2 - this.startCentre().y;
        this.painter.applyMatrix(
          [...this.base.keys()],
          [1, 0, 0, 1, mx, my],
          this.base,
        );
        this.painter.refreshOverlay();
        this.drawGuides(snapped);
        break;
      }
      case "scale": {
        if (!this.startBounds || !this.handle) break;
        const m = scaleMatrixFor(
          this.startBounds,
          this.handle,
          { x: info.x, y: info.y },
          info.shiftKey,
          info.altKey,
        );
        this.painter.applyMatrix([...this.base.keys()], m, this.base);
        this.painter.refreshOverlay();
        break;
      }
      case "rotate": {
        if (!this.startBounds) break;
        const m = rotateMatrixFor(
          this.startBounds,
          this.startPoint,
          { x: info.x, y: info.y },
          info.shiftKey,
        );
        this.painter.applyMatrix([...this.base.keys()], m, this.base);
        this.painter.refreshOverlay(this.startBounds, m);
        break;
      }
      case "marquee": {
        if (!this.marquee) break;
        const rect = rectFromCorners(
          { x: info.startX, y: info.startY },
          { x: info.x, y: info.y },
        );
        this.marquee.setAttribute("x", String(round(rect.x, 2)));
        this.marquee.setAttribute("y", String(round(rect.y, 2)));
        this.marquee.setAttribute("width", String(round(rect.width, 2)));
        this.marquee.setAttribute("height", String(round(rect.height, 2)));
        break;
      }
      default:
        break;
    }
  }

  onPointerUp(info: PointerInfo): void {
    const mode = this.mode;
    this.mode = "idle";
    this.handle = null;

    if (mode === "marquee") {
      const rect = rectFromCorners(
        { x: info.startX, y: info.startY },
        { x: info.x, y: info.y },
      );
      this.painter.suppressOverlay = false;
      this.marquee?.remove();
      this.marquee = null;
      if (rect.width > 1 || rect.height > 1) {
        const found = info.altKey ? this.painter.itemsInRect(rect, true) : this.painter.itemsInMarquee(rect);
        if (info.shiftKey)
          for (const node of found) this.painter.addToSelection(node);
        else this.painter.setSelection(found);
      }
      this.painter.refreshOverlay();
      return;
    }

    if (mode !== "idle" && this.moved) this.painter.commit();
    this.base.clear();
    this.startBounds = null;
    this.painter.refreshOverlay();
    this.painter.setCursor("default");
  }

  onPointerHover(info: PointerInfo): void {
    if (this.mode === "rotate") {
      this.painter.setCursor("grabbing");
      return;
    }
    const handle = this.painter.hitHandle(info.clientX, info.clientY);
    if (handle) {
      this.painter.setCursor(this.painter.cursorForHandle(handle));
      return;
    }
    const hit = this.painter.hitTest(info.clientX, info.clientY, 3, { anyLayer: true, keepLayer: true });
    this.painter.setCursor(hit ? "move" : "default");
  }

  onDoubleClick(info: PointerInfo): void {
    const hit = this.painter.hitTest(info.clientX, info.clientY, 3, { anyLayer: true });
    if (!hit) return;
    if (hit.item.tagName.toLowerCase() === "text") {
      this.painter.setTool("text");
      (this.painter.getTool("text") as TextTool | undefined)?.beginEdit(
        hit.item as SVGTextElement,
      );
      return;
    }
    // Double click drills into a group so nested items can be edited directly.
    if (hit.item.tagName.toLowerCase() === "g" && hit.node !== hit.item) {
      this.painter.setSelection([hit.item]);
      this.painter.setTool("reshape");
    }
  }

  onKeyDown(e: KeyboardEvent): boolean {
    if (e.key === "Escape" && this.mode !== "idle") {
      this.cancel();
      return true;
    }
    return false;
  }

  cancel(): void {
    if (this.mode === "marquee") {
      this.marquee?.remove();
      this.marquee = null;
      this.painter.suppressOverlay = false;
    } else if (this.base.size) {
      for (const [node, matrix] of this.base)
        this.painter.setItemMatrix(node, matrix);
    }
    this.mode = "idle";
    this.handle = null;
    this.base.clear();
    this.startBounds = null;
    this.painter.refreshOverlay();
    this.painter.setCursor("default");
  }

  private startCentre(): Point {
    const b = this.startBounds;
    return b ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : { x: 0, y: 0 };
  }

  /** Which axes of the moved selection's middle are within reach of the canvas middle. */
  private snapToCentre(mx: number, my: number): { x: boolean; y: boolean } {
    if (!this.startBounds) return { x: false, y: false };
    const reach = this.painter.screenToSceneLength(SNAP_PX);
    const centre = this.startCentre();
    return {
      x: Math.abs(centre.x + mx - this.painter.width / 2) <= reach,
      y: Math.abs(centre.y + my - this.painter.height / 2) <= reach,
    };
  }

  /**
   * The move with the selection's left, middle or right (top, middle, bottom)
   * pulled onto the nearest such line of another shape or the canvas, per axis,
   * within reach; and where it caught.
   */
  private snapToItems(mx: number, my: number): { mx: number; my: number; x: number | null; y: number | null } {
    const b = this.startBounds;
    if (!b) return { mx, my, x: null, y: null };
    const reach = this.painter.screenToSceneLength(SNAP_PX);
    const nearest = (anchors: number[], lines: number[], shift: number) => {
      let best: { delta: number; line: number } | null = null;
      for (const anchor of anchors) {
        for (const line of lines) {
          const delta = line - (anchor + shift);
          if (Math.abs(delta) <= reach && (!best || Math.abs(delta) < Math.abs(best.delta))) best = { delta, line };
        }
      }
      return best;
    };
    const catchX = nearest([b.x, b.x + b.width / 2, b.x + b.width], this.snapLines.xs, mx);
    const catchY = nearest([b.y, b.y + b.height / 2, b.y + b.height], this.snapLines.ys, my);
    return {
      mx: mx + (catchX?.delta ?? 0),
      my: my + (catchY?.delta ?? 0),
      x: catchX?.line ?? null,
      y: catchY?.line ?? null,
    };
  }

  /** Full-length guide lines where a Shift move caught. */
  private drawLines(x: number | null, y: number | null): void {
    const overlay = this.painter.overlay.node;
    const line = (x1: number, y1: number, x2: number, y2: number) => {
      const guide = document.createElementNS("http://www.w3.org/2000/svg", "line");
      guide.setAttribute("x1", String(x1));
      guide.setAttribute("y1", String(y1));
      guide.setAttribute("x2", String(x2));
      guide.setAttribute("y2", String(y2));
      guide.setAttribute("class", "pt-guide");
      guide.setAttribute("stroke-width", String(1 / this.painter.zoom));
      overlay.appendChild(guide);
    };
    if (x !== null) line(x, 0, x, this.painter.height);
    if (y !== null) line(0, y, this.painter.width, y);
  }

  /** Guide lines through the canvas middle on the axes that caught. */
  private drawGuides(snapped: { x: boolean; y: boolean }): void {
    const overlay = this.painter.overlay.node;
    const line = (x1: number, y1: number, x2: number, y2: number) => {
      const guide = document.createElementNS("http://www.w3.org/2000/svg", "line");
      guide.setAttribute("x1", String(x1));
      guide.setAttribute("y1", String(y1));
      guide.setAttribute("x2", String(x2));
      guide.setAttribute("y2", String(y2));
      guide.setAttribute("class", "pt-guide");
      guide.setAttribute("stroke-width", String(1 / this.painter.zoom));
      overlay.appendChild(guide);
    };
    const { width, height } = this.painter;
    if (snapped.x) line(width / 2, 0, width / 2, height);
    if (snapped.y) line(0, height / 2, width, height / 2);
  }

  private captureBase(): void {
    this.base.clear();
    for (const node of this.painter.selection)
      this.base.set(node, this.painter.itemMatrix(node));
    this.startBounds = this.painter.selectionBounds;
    // What a Shift move can catch on: the other shapes' edges and middles, and the canvas's.
    const { width, height } = this.painter;
    const xs = [0, width / 2, width];
    const ys = [0, height / 2, height];
    const scene = this.painter.scene.node as SVGGraphicsElement;
    const background = this.painter.backgroundItem();
    for (const item of this.painter.items) {
      if (item === background || this.base.has(item)) continue;
      const box = paintBoundsIn(item, scene);
      if (!Number.isFinite(box.x) || !box.width && !box.height) continue;
      xs.push(box.x, box.x + box.width / 2, box.x + box.width);
      ys.push(box.y, box.y + box.height / 2, box.y + box.height);
    }
    this.snapLines = { xs, ys };
  }

  private snapLines: { xs: number[]; ys: number[] } = { xs: [], ys: [] };
}
