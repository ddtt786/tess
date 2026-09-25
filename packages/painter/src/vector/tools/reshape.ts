import type { Tool } from '../../core/tool.js';
import type { Point, PointerInfo } from '../../core/types.js';
import type { Matrix } from '../../core/geom.js';
import { matApply, matInvert, rectFromCorners, round } from '../../core/geom.js';
import type { CubicNode, CubicSubPath } from '../../core/path-data.js';
import { cubicsToPathData, newNode, pathDataToCubics, shapeToPathData } from '../../core/path-data.js';
import { elementMatrixTo, ensurePid, readStyle } from '../scene.js';
import type { VectorPainter } from '../VectorPainter.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

interface NodeRef {
  sub: number;
  index: number;
}

type Grab =
  | { kind: 'anchor'; ref: NodeRef }
  | { kind: 'in' | 'out'; ref: NodeRef }
  | { kind: 'marquee' }
  | null;

const key = (ref: NodeRef) => `${ref.sub}:${ref.index}`;

/**
 * Node editor ("Reshape"): drags anchors and bezier handles, inserts points on
 * a segment and deletes them. Non-path items are converted to paths on the way
 * in, which is what lets rectangles and ellipses be reshaped too.
 */
export class ReshapeTool implements Tool {
  readonly name = 'reshape';
  readonly cursor = 'default';

  private item: SVGPathElement | null = null;
  private subs: CubicSubPath[] = [];
  private selected = new Set<string>();
  private grab: Grab = null;
  /** Set by a press on empty canvas; letting go hands over to the select tool. */
  private leaveOnUp = false;
  private grabStart: Point = { x: 0, y: 0 };
  private startSubs: CubicSubPath[] = [];
  private dirty = false;
  private marqueeEl: SVGRectElement | null = null;
  /**
   * The item's matrix into scene space. Reading it costs two getScreenCTM calls,
   * each forcing layout once the overlay has changed, so it is read once per
   * event instead of once per node. It does not change with zoom or pan.
   */
  private cachedMatrix: Matrix | null = null;
  /** The drawn overlay, kept so a drag moves a few elements instead of redrawing every node. */
  private drawn: {
    outline: SVGPathElement;
    nodes: SVGRectElement[][];
    handles: SVGGElement;
    zoom: number;
  } | null = null;
  /** Pending animation frame for a drag; pointer moves between frames are coalesced. */
  private frame = 0;
  private moved: NodeRef[] = [];

  constructor(private readonly painter: VectorPainter) {}

  activate(): void {
    this.painter.suppressOverlay = true;
    this.attachFromSelection();
  }

  deactivate(): void {
    this.forgetMatrix();
    this.flush();
    this.painter.suppressOverlay = false;
    this.item = null;
    this.subs = [];
    this.selected.clear();
    this.painter.clearOverlay();
    this.painter.refreshOverlay();
  }

  /* ------------------------------------------------------------ */

  private attachFromSelection(): void {
    const selection = this.painter.selection;
    this.selected.clear();
    if (selection.length !== 1) {
      this.item = null;
      this.subs = [];
      this.render();
      return;
    }
    this.attach(selection[0]);
  }

  /** Makes `node` editable, converting shapes and text to paths if needed. */
  private attach(node: SVGGraphicsElement): void {
    this.forgetMatrix();
    let target = node;
    const tag = target.tagName.toLowerCase();
    if (tag === 'text') {
      const converted = this.painter.convertTextToPath(target);
      if (!converted) {
        this.item = null;
        this.render();
        return;
      }
      target = converted;
    } else if (tag === 'g') {
      this.item = null;
      this.subs = [];
      this.render();
      return;
    } else if (tag !== 'path') {
      const converted = this.toPath(target);
      if (!converted) {
        this.item = null;
        this.render();
        return;
      }
      target = converted;
      this.painter.setSelection([target]);
      this.painter.commit();
    }
    this.item = target as SVGPathElement;
    this.subs = pathDataToCubics(this.item.getAttribute('d') ?? '');
    this.render();
  }

  private toPath(node: SVGGraphicsElement): SVGPathElement | null {
    const d = shapeToPathData(node);
    if (!d) return null;
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    const style = readStyle(node);
    path.setAttribute('fill', style.fill ?? 'none');
    path.setAttribute('stroke', style.stroke ?? 'none');
    path.setAttribute('stroke-width', String(style.strokeWidth));
    path.setAttribute('stroke-linecap', node.getAttribute('stroke-linecap') ?? 'round');
    path.setAttribute('stroke-linejoin', node.getAttribute('stroke-linejoin') ?? 'round');
    const transform = node.getAttribute('transform');
    if (transform) path.setAttribute('transform', transform);
    node.parentNode?.insertBefore(path, node);
    node.remove();
    ensurePid(path);
    return path;
  }

  /* ------------------------------------------------------------ */

  private matrix(): Matrix {
    if (!this.item) return [1, 0, 0, 1, 0, 0];
    this.cachedMatrix ??= elementMatrixTo(this.item, this.painter.scene.node as SVGGraphicsElement);
    return this.cachedMatrix;
  }

  /** Drops the cached matrix; the item or its transform may have changed. */
  private forgetMatrix(): void {
    this.cachedMatrix = null;
  }

  private toScene(p: Point): Point { return matApply(this.matrix(), p); }

  private toLocal(p: Point): Point { return matApply(matInvert(this.matrix()), p); }

  private toLocalDelta(dx: number, dy: number): Point {
    const inv = matInvert(this.matrix());
    const a = matApply(inv, { x: 0, y: 0 });
    const b = matApply(inv, { x: dx, y: dy });
    return { x: b.x - a.x, y: b.y - a.y };
  }

  /* ------------------------------------------------------------ */

  onPointerDown(info: PointerInfo): void {
    this.forgetMatrix();
    this.leaveOnUp = false;
    if (!this.item) {
      const hit = this.painter.hitTest(info.clientX, info.clientY, 4, { anyLayer: true });
      if (hit) {
        this.painter.setSelection([hit.item]);
        this.attach(hit.item);
      } else {
        this.leaveOnUp = true;
      }
      return;
    }

    const slop = this.painter.screenToSceneLength(7);
    const handleHit = this.hitHandle({ x: info.x, y: info.y }, slop);
    if (handleHit) {
      this.grab = handleHit;
      this.grabStart = { x: info.x, y: info.y };
      this.startSubs = cloneSubs(this.subs);
      if (handleHit.kind === 'anchor') {
        const k = key(handleHit.ref);
        if (info.shiftKey) {
          if (this.selected.has(k)) this.selected.delete(k);
          else this.selected.add(k);
        } else if (!this.selected.has(k)) {
          this.selected.clear();
          this.selected.add(k);
        }
      }
      this.restyle();
      return;
    }

    const hit = this.painter.hitTest(info.clientX, info.clientY, 4, { anyLayer: true });
    if (hit && hit.item !== (this.item as unknown as SVGGraphicsElement)) {
      this.flush();
      this.painter.setSelection([hit.item]);
      this.attach(hit.item);
      return;
    }

    // Well away from the shape the press means "done": back to the select tool.
    // Near it, a drag picks points with a marquee.
    const box = (this.item as unknown as Element).getBoundingClientRect();
    const pad = 12;
    if (
      info.clientX < box.left - pad || info.clientX > box.right + pad
      || info.clientY < box.top - pad || info.clientY > box.bottom + pad
    ) {
      this.leaveOnUp = true;
      return;
    }

    if (!info.shiftKey) this.selected.clear();
    this.grab = { kind: 'marquee' };
    this.grabStart = { x: info.x, y: info.y };
    this.marqueeEl = document.createElementNS(SVG_NS, 'rect');
    this.marqueeEl.setAttribute('class', 'pt-marquee');
    this.marqueeEl.setAttribute('stroke-width', String(1 / this.painter.zoom));
    this.restyle();
  }

  onPointerMove(info: PointerInfo): void {
    if (!this.grab || !this.item) return;
    const dx = info.x - this.grabStart.x;
    const dy = info.y - this.grabStart.y;

    if (this.grab.kind === 'marquee') {
      // Only the rectangle moves; the nodes are drawn already.
      if (this.marqueeEl) {
        const r = rectFromCorners(this.grabStart, { x: info.x, y: info.y });
        this.marqueeEl.setAttribute('x', String(round(r.x, 2)));
        this.marqueeEl.setAttribute('y', String(round(r.y, 2)));
        this.marqueeEl.setAttribute('width', String(round(r.width, 2)));
        this.marqueeEl.setAttribute('height', String(round(r.height, 2)));
        this.painter.overlay.node.appendChild(this.marqueeEl);
      }
      return;
    }

    const local = this.toLocalDelta(dx, dy);
    if (this.grab.kind === 'anchor') {
      const refs = this.selected.size ? [...this.selected].map(parseKey) : [this.grab.ref];
      this.moved = refs;
      for (const ref of refs) {
        const base = this.startSubs[ref.sub]?.nodes[ref.index];
        const live = this.subs[ref.sub]?.nodes[ref.index];
        if (!base || !live) continue;
        live.x = base.x + local.x;
        live.y = base.y + local.y;
      }
    } else {
      const ref = this.grab.ref;
      this.moved = [ref];
      const base = this.startSubs[ref.sub]?.nodes[ref.index];
      const live = this.subs[ref.sub]?.nodes[ref.index];
      if (base && live) {
        if (this.grab.kind === 'out') {
          live.outDX = base.outDX + local.x;
          live.outDY = base.outDY + local.y;
          if (!info.altKey && wasSmooth(base)) mirror(live, 'out');
        } else {
          live.inDX = base.inDX + local.x;
          live.inDY = base.inDY + local.y;
          if (!info.altKey && wasSmooth(base)) mirror(live, 'in');
        }
      }
    }
    this.dirty = true;
    this.frame ||= requestAnimationFrame(() => this.drawFrame());
  }

  /** Applies the latest drag position: the path, and the overlay elements of the moved nodes. */
  private drawFrame(): void {
    this.frame = 0;
    this.writeBack();
    this.redraw(this.moved);
  }

  onPointerUp(info: PointerInfo): void {
    if (this.leaveOnUp) {
      this.leaveOnUp = false;
      this.flush();
      this.painter.setSelection([]);
      this.painter.setTool('select');
      return;
    }
    if (this.frame) {
      cancelAnimationFrame(this.frame);
      this.drawFrame();
    }
    if (this.grab?.kind === 'marquee') {
      const r = rectFromCorners(this.grabStart, { x: info.x, y: info.y });
      this.marqueeEl?.remove();
      this.marqueeEl = null;
      if (r.width > 1 || r.height > 1) {
        this.subs.forEach((sub, si) => {
          sub.nodes.forEach((node, ni) => {
            const p = this.toScene(node);
            if (p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height) {
              this.selected.add(key({ sub: si, index: ni }));
            }
          });
        });
      }
    }
    this.grab = null;
    this.startSubs = [];
    this.flush();
    this.restyle();
  }

  onDoubleClick(info: PointerInfo): void {
    this.forgetMatrix();
    if (!this.item) return;
    const slop = this.painter.screenToSceneLength(7);
    if (this.hitHandle({ x: info.x, y: info.y }, slop)) {
      // Double clicking an anchor toggles between corner and smooth.
      const ref = this.hitHandle({ x: info.x, y: info.y }, slop);
      if (ref && ref.kind === 'anchor') {
        const node = this.subs[ref.ref.sub]?.nodes[ref.ref.index];
        if (node) {
          if (node.inDX || node.inDY || node.outDX || node.outDY) {
            node.inDX = node.inDY = node.outDX = node.outDY = 0;
          } else {
            smoothNode(this.subs[ref.ref.sub], ref.ref.index);
          }
          this.dirty = true;
          this.writeBack();
          this.flush();
          this.render();
        }
      }
      return;
    }
    this.insertPointNear(this.toLocal({ x: info.x, y: info.y }));
  }

  onKeyDown(e: KeyboardEvent): boolean {
    if (!this.item) return false;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (!this.selected.size) return false;
      this.deleteSelectedNodes();
      return true;
    }
    if (e.key === 'Escape') {
      this.selected.clear();
      this.render();
      return true;
    }
    if (e.key.startsWith('Arrow')) {
      if (!this.selected.size) return false;
      const step = e.shiftKey ? 10 : 1;
      const d = this.toLocalDelta(
        e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0,
        e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0,
      );
      for (const k of this.selected) {
        const ref = parseKey(k);
        const node = this.subs[ref.sub]?.nodes[ref.index];
        if (!node) continue;
        node.x += d.x;
        node.y += d.y;
      }
      this.dirty = true;
      this.writeBack();
      this.flush();
      this.render();
      return true;
    }
    return false;
  }

  cancel(): void {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.grab = null;
    this.marqueeEl?.remove();
    this.marqueeEl = null;
    this.startSubs = [];
  }

  /* ------------------------------------------------------------ */

  private deleteSelectedNodes(): void {
    const refs = [...this.selected].map(parseKey).sort((a, b) => b.sub - a.sub || b.index - a.index);
    for (const ref of refs) {
      const sub = this.subs[ref.sub];
      if (!sub) continue;
      sub.nodes.splice(ref.index, 1);
      if (sub.nodes.length < 2) this.subs.splice(ref.sub, 1);
    }
    this.selected.clear();
    this.dirty = true;
    if (!this.subs.length) {
      this.item?.remove();
      this.item = null;
      this.painter.deselect();
      this.painter.commit();
      this.dirty = false;
      this.render();
      return;
    }
    this.writeBack();
    this.flush();
    this.render();
  }

  /** Splits the closest segment at the projection of `local`. */
  private insertPointNear(local: Point): void {
    if (!this.item) return;
    let best: { sub: number; index: number; t: number; dist: number } | null = null;
    this.subs.forEach((sub, si) => {
      const limit = sub.closed ? sub.nodes.length : sub.nodes.length - 1;
      for (let i = 0; i < limit; i++) {
        const a = sub.nodes[i];
        const b = sub.nodes[(i + 1) % sub.nodes.length];
        for (let s = 0; s <= 24; s++) {
          const t = s / 24;
          const p = cubicAt(a, b, t);
          const dist = Math.hypot(p.x - local.x, p.y - local.y);
          if (!best || dist < best.dist) best = { sub: si, index: i, t, dist };
        }
      }
    });
    if (!best) return;
    const pick = best as { sub: number; index: number; t: number; dist: number };
    if (pick.dist > this.painter.screenToSceneLength(14)) return;
    const sub = this.subs[pick.sub];
    const a = sub.nodes[pick.index];
    const b = sub.nodes[(pick.index + 1) % sub.nodes.length];
    const split = splitCubic(a, b, pick.t);
    a.outDX = split.a.outDX;
    a.outDY = split.a.outDY;
    b.inDX = split.b.inDX;
    b.inDY = split.b.inDY;
    sub.nodes.splice(pick.index + 1, 0, split.mid);
    this.selected.clear();
    this.selected.add(key({ sub: pick.sub, index: pick.index + 1 }));
    this.dirty = true;
    this.writeBack();
    this.flush();
    this.render();
  }

  private writeBack(): void {
    if (!this.item) return;
    this.item.setAttribute('d', cubicsToPathData(this.subs));
  }

  private flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    this.painter.commit();
  }

  /** The nearest handle within `slop`; bezier handles of selected nodes win over anchors. */
  private hitHandle(scenePoint: Point, slop: number): Exclude<Grab, null> | null {
    let best: Exclude<Grab, null> | null = null;
    let bestDistance = Infinity;
    const consider = (p: Point, grab: Exclude<Grab, null>) => {
      const distance = Math.max(Math.abs(p.x - scenePoint.x), Math.abs(p.y - scenePoint.y));
      if (distance <= slop && distance < bestDistance) {
        best = grab;
        bestDistance = distance;
      }
    };
    for (const each of this.selected) {
      const ref = parseKey(each);
      const node = this.subs[ref.sub]?.nodes[ref.index];
      if (!node) continue;
      if (node.outDX || node.outDY) consider(this.toScene({ x: node.x + node.outDX, y: node.y + node.outDY }), { kind: 'out', ref });
      if (node.inDX || node.inDY) consider(this.toScene({ x: node.x + node.inDX, y: node.y + node.inDY }), { kind: 'in', ref });
    }
    if (best) return best;
    for (let si = 0; si < this.subs.length; si++) {
      const sub = this.subs[si];
      for (let ni = 0; ni < sub.nodes.length; ni++) consider(this.toScene(sub.nodes[ni]), { kind: 'anchor', ref: { sub: si, index: ni } });
    }
    return best;
  }


  /** Draws anchors and bezier handles into the painter overlay. */
  private render(): void {
    const overlay = this.painter.overlay.node;
    overlay.replaceChildren();
    this.drawn = null;
    if (!this.item) return;
    const k = 1 / this.painter.zoom;
    const size = 7 * k;

    const outline = document.createElementNS(SVG_NS, 'path');
    outline.setAttribute('d', this.item.getAttribute('d') ?? '');
    outline.setAttribute('class', 'pt-reshape-outline');
    outline.setAttribute('stroke-width', String(k));
    const m = this.matrix();
    outline.setAttribute('transform', `matrix(${m.join(' ')})`);
    overlay.appendChild(outline);

    const handles = document.createElementNS(SVG_NS, 'g');
    overlay.appendChild(handles);

    const nodes = this.subs.map((sub, si) => sub.nodes.map((node, ni) => {
      const anchor = this.toScene(node);
      const rect = document.createElementNS(SVG_NS, 'rect');
      rect.setAttribute('x', String(anchor.x - size / 2));
      rect.setAttribute('y', String(anchor.y - size / 2));
      rect.setAttribute('width', String(size));
      rect.setAttribute('height', String(size));
      const isSelected = this.selected.has(key({ sub: si, index: ni }));
      rect.setAttribute('class', `pt-handle pt-handle-node${isSelected ? ' is-selected' : ''}`);
      rect.setAttribute('stroke-width', String(k));
      overlay.appendChild(rect);
      return rect;
    }));
    this.drawn = { outline, nodes, handles, zoom: this.painter.zoom };
    this.drawHandles();
  }

  /** Whether the kept overlay is still on screen and drawn at the current zoom. */
  private isDrawn(): boolean {
    return !!this.drawn && this.drawn.zoom === this.painter.zoom && this.drawn.outline.isConnected;
  }

  /** Marks the selected squares; redraws everything only if the overlay is stale. */
  private restyle(): void {
    if (!this.drawn || !this.isDrawn()) {
      this.render();
      return;
    }
    this.drawn.nodes.forEach((row, si) => row.forEach((rect, ni) => {
      const isSelected = this.selected.has(key({ sub: si, index: ni }));
      rect.setAttribute('class', `pt-handle pt-handle-node${isSelected ? ' is-selected' : ''}`);
    }));
    this.drawHandles();
  }

  /** Moves the given nodes' squares and redraws the outline and the selected nodes' handles. */
  private redraw(refs: NodeRef[]): void {
    if (!this.item) return;
    if (!this.drawn || !this.isDrawn()) {
      this.render();
      return;
    }
    const size = 7 / this.painter.zoom;
    this.drawn.outline.setAttribute('d', this.item.getAttribute('d') ?? '');
    for (const ref of refs) {
      const node = this.subs[ref.sub]?.nodes[ref.index];
      const rect = this.drawn.nodes[ref.sub]?.[ref.index];
      if (!node || !rect) continue;
      const anchor = this.toScene(node);
      rect.setAttribute('x', String(anchor.x - size / 2));
      rect.setAttribute('y', String(anchor.y - size / 2));
    }
    this.drawHandles();
  }

  /** Bezier handles of the selected nodes; there are only as many as are selected. */
  private drawHandles(): void {
    if (!this.drawn) return;
    const k = 1 / this.painter.zoom;
    const size = 7 * k;
    const parts: SVGElement[] = [];
    for (const each of this.selected) {
      const ref = parseKey(each);
      const node = this.subs[ref.sub]?.nodes[ref.index];
      if (!node) continue;
      const anchor = this.toScene(node);
      for (const which of ['in', 'out'] as const) {
        const dx = which === 'in' ? node.inDX : node.outDX;
        const dy = which === 'in' ? node.inDY : node.outDY;
        if (!dx && !dy) continue;
        const hp = this.toScene({ x: node.x + dx, y: node.y + dy });
        const line = document.createElementNS(SVG_NS, 'line');
        line.setAttribute('x1', String(anchor.x));
        line.setAttribute('y1', String(anchor.y));
        line.setAttribute('x2', String(hp.x));
        line.setAttribute('y2', String(hp.y));
        line.setAttribute('class', 'pt-handle-stem');
        line.setAttribute('stroke-width', String(k));
        const dot = document.createElementNS(SVG_NS, 'circle');
        dot.setAttribute('cx', String(hp.x));
        dot.setAttribute('cy', String(hp.y));
        dot.setAttribute('r', String(size / 2));
        dot.setAttribute('class', 'pt-handle pt-handle-control');
        dot.setAttribute('stroke-width', String(k));
        parts.push(line, dot);
      }
    }
    this.drawn.handles.replaceChildren(...parts);
  }
}

/* ------------------------------------------------------------------ */

function parseKey(k: string): NodeRef {
  const [sub, index] = k.split(':').map(Number);
  return { sub, index };
}

function cloneSubs(subs: CubicSubPath[]): CubicSubPath[] {
  return subs.map((s) => ({ closed: s.closed, nodes: s.nodes.map((n) => ({ ...n })) }));
}

function wasSmooth(node: CubicNode): boolean {
  const cross = node.inDX * node.outDY - node.inDY * node.outDX;
  const dot = node.inDX * node.outDX + node.inDY * node.outDY;
  return Math.abs(cross) < 1e-3 && dot < 0;
}

function mirror(node: CubicNode, moved: 'in' | 'out'): void {
  if (moved === 'out') {
    const len = Math.hypot(node.inDX, node.inDY);
    const mag = Math.hypot(node.outDX, node.outDY) || 1;
    node.inDX = (-node.outDX / mag) * len;
    node.inDY = (-node.outDY / mag) * len;
  } else {
    const len = Math.hypot(node.outDX, node.outDY);
    const mag = Math.hypot(node.inDX, node.inDY) || 1;
    node.outDX = (-node.inDX / mag) * len;
    node.outDY = (-node.inDY / mag) * len;
  }
}

/** Gives a corner node tangent handles derived from its neighbours. */
function smoothNode(sub: CubicSubPath, index: number): void {
  const n = sub.nodes;
  const node = n[index];
  const prev = n[(index - 1 + n.length) % n.length];
  const next = n[(index + 1) % n.length];
  const dx = next.x - prev.x;
  const dy = next.y - prev.y;
  const len = Math.hypot(dx, dy) || 1;
  const scale = Math.min(Math.hypot(node.x - prev.x, node.y - prev.y), Math.hypot(next.x - node.x, next.y - node.y)) / 3;
  node.outDX = (dx / len) * scale;
  node.outDY = (dy / len) * scale;
  node.inDX = -node.outDX;
  node.inDY = -node.outDY;
}

function cubicAt(a: CubicNode, b: CubicNode, t: number): Point {
  const c1 = { x: a.x + a.outDX, y: a.y + a.outDY };
  const c2 = { x: b.x + b.inDX, y: b.y + b.inDY };
  const mt = 1 - t;
  return {
    x: mt * mt * mt * a.x + 3 * mt * mt * t * c1.x + 3 * mt * t * t * c2.x + t * t * t * b.x,
    y: mt * mt * mt * a.y + 3 * mt * mt * t * c1.y + 3 * mt * t * t * c2.y + t * t * t * b.y,
  };
}

/** de Casteljau split, returning the adjusted end handles and the new node. */
function splitCubic(a: CubicNode, b: CubicNode, t: number): { a: CubicNode; mid: CubicNode; b: CubicNode } {
  const p0 = { x: a.x, y: a.y };
  const p1 = { x: a.x + a.outDX, y: a.y + a.outDY };
  const p2 = { x: b.x + b.inDX, y: b.y + b.inDY };
  const p3 = { x: b.x, y: b.y };
  const lerpP = (u: Point, v: Point) => ({ x: u.x + (v.x - u.x) * t, y: u.y + (v.y - u.y) * t });
  const p01 = lerpP(p0, p1);
  const p12 = lerpP(p1, p2);
  const p23 = lerpP(p2, p3);
  const p012 = lerpP(p01, p12);
  const p123 = lerpP(p12, p23);
  const mid = lerpP(p012, p123);

  const newA = { ...a, outDX: p01.x - p0.x, outDY: p01.y - p0.y };
  const newB = { ...b, inDX: p23.x - p3.x, inDY: p23.y - p3.y };
  const midNode = newNode(mid.x, mid.y);
  midNode.inDX = p012.x - mid.x;
  midNode.inDY = p012.y - mid.y;
  midNode.outDX = p123.x - mid.x;
  midNode.outDY = p123.y - mid.y;
  return { a: newA, mid: midNode, b: newB };
}
