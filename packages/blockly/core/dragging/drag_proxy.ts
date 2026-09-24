/**
 * @license
 * Copyright 2026 Tess contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A stand-in drawn for a long stack while it is dragged.
 *
 * The stack itself stays where it is in the block canvas, clipped out of
 * sight, so picking it up and dropping it neither re-parents nor restyles it.
 * The stand-in holds shallow copies of the stack's block groups laid out flat
 * in drawing order, inside a composited overlay above the workspace. The
 * overlay is moved by a Web Animation whose keyframes follow the pointer, which
 * the compositor applies without repainting, rasterizing or re-layerizing
 * anything (a plain style transform would re-layerize the whole page).
 * Only the blocks near the visible area are copied; more are copied as the
 * stack moves. Changes to the real blocks during the drag rebuild the copies.
 *
 * @internal
 */

import type {BlockSvg} from '../block_svg.js';
import {Coordinate} from '../utils/coordinate.js';
import * as dom from '../utils/dom.js';
import {Rect} from '../utils/rect.js';
import {Svg} from '../utils/svg.js';

/** Stacks with at least this many blocks, shadows included, use a stand-in. */
const MIN_BLOCKS = 40;

/** Clip that hides the real stack; it also keeps it out of hit testing. */
const HIDDEN = 'polygon(0 0, 0 0, 0 0)';

/** One run of a block group's own children between its child blocks. */
interface Segment {
  order: number;
  entry: Entry;
  parts: Element[];
  copy: SVGGElement | null;
}

interface Entry {
  block: BlockSvg;
  /** Position at the start of the drag, in workspace units. */
  xy: Coordinate;
  /** Bounds at the start of the drag, in workspace units. */
  rect: Rect;
  segments: Segment[];
  copied: boolean;
}

export class DragProxy {
  private readonly overlay: HTMLDivElement;
  private readonly layer: SVGGElement;
  private readonly content: SVGGElement;
  private entries: Entry[] = [];
  /** Copied segments, in drawing order. */
  private placed: Segment[] = [];
  /** Area already scanned for blocks to copy, relative to the start position. */
  private covered: Rect | null = null;
  private readonly origin: Coordinate;
  private offset = new Coordinate(0, 0);
  private readonly savedClip: string;
  private readonly observer: MutationObserver;
  private readonly motion: Animation;
  /** Transform added after the position, e.g. the wobble when unplugged. */
  private extra = '';
  deleteStyle = false;

  /** Whether a drag of this block should use a stand-in. */
  static shouldUse(block: BlockSvg): boolean {
    const workspace = block.workspace;
    if (block.isInFlyout || workspace.isFlyout || workspace.isMutator) {
      return false;
    }
    if (!workspace.getInjectionDiv() || typeof MutationObserver === 'undefined') {
      return false;
    }
    return block.getDescendants(false).length >= MIN_BLOCKS;
  }

  constructor(private readonly block: BlockSvg) {
    const workspace = block.workspace;
    const root = block.getStackSvgRoot();
    this.origin = block.getRelativeToSurfaceXY();

    // In front of the other stacks, as the drop will leave it. Later siblings
    // move behind it; moving the stack itself would restyle all of it.
    const parent = root.parentNode;
    if (parent) {
      while (root.nextSibling) parent.insertBefore(root.nextSibling, root);
    }

    this.overlay = document.createElement('div');
    this.overlay.className = 'blocklyDragProxy';
    this.overlay.style.cssText =
      'position:absolute;left:0;top:0;right:0;bottom:0;z-index:80;' +
      'pointer-events:none;overflow:visible;will-change:transform;' +
      'transform-origin:0 0;';
    const svg = dom.createSvgElement(Svg.SVG, {
      'xmlns': dom.SVG_NS,
      'xmlns:html': dom.HTML_NS,
      'xmlns:xlink': dom.XLINK_NS,
      'version': '1.1',
      'style':
        'position:absolute;left:0;top:0;width:100%;height:100%;overflow:visible;',
    });
    this.layer = dom.createSvgElement(Svg.G, {}, svg);
    this.content = dom.createSvgElement(Svg.G, {}, this.layer);
    this.overlay.appendChild(svg);
    this.syncLayer();

    // Below the drag layer, which carries the stack's open bubbles.
    const injectionDiv = workspace.getInjectionDiv();
    const dragSurface = injectionDiv.querySelector(
      ':scope > .blocklyBlockDragSurface',
    );
    injectionDiv.insertBefore(this.overlay, dragSurface);
    this.motion = this.overlay.animate(keyframes('translate(0px, 0px)'), {
      duration: Infinity,
      fill: 'both',
    });

    this.index();
    this.fill();

    this.savedClip = root.style.clipPath;
    root.style.clipPath = HIDDEN;

    this.observer = new MutationObserver(() => this.rebuild());
    this.observer.observe(root, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true,
    });
  }

  /** Follows the stack to a new position, in workspace units. */
  moveTo(x: number, y: number) {
    this.offset = new Coordinate(x - this.origin.x, y - this.origin.y);
    this.syncLayer();
    this.animate();
    this.fill();
  }

  /**
   * Adds an SVG transform after the stack's position, as Blockly adds it to
   * the stack's group, e.g. `skewX(5)`.
   */
  setExtraTransform(extra: string) {
    this.extra = extra.trim();
    this.animate();
  }

  private animate() {
    const scale = this.block.workspace.scale;
    let transform = `translate(${this.offset.x * scale}px, ${this.offset.y * scale}px)`;
    const skew = /^skewX\(([-\d.e]+)\)$/.exec(this.extra);
    if (skew) {
      // Around the stack's start position, in the overlay's pixels.
      const matrix = this.layer.transform.baseVal.consolidate()?.matrix;
      const x = (matrix?.a ?? scale) * this.origin.x + (matrix?.e ?? 0);
      const y = (matrix?.d ?? scale) * this.origin.y + (matrix?.f ?? 0);
      transform +=
        ` translate(${x}px, ${y}px) skewX(${skew[1]}deg)` +
        ` translate(${-x}px, ${-y}px)`;
    }
    (this.motion.effect as KeyframeEffect | null)?.setKeyframes(
      keyframes(transform),
    );
  }

  setDeleteStyle(enable: boolean) {
    if (this.deleteStyle === enable) return;
    this.deleteStyle = enable;
    for (const segment of this.placed) {
      if (segment.entry.block === this.block && segment.copy) {
        this.markDelete(segment.copy);
      }
    }
  }

  /** Removes the stand-in and shows the real stack again. */
  dispose() {
    this.observer.disconnect();
    this.motion.cancel();
    this.overlay.remove();
    this.block.getStackSvgRoot().style.clipPath = this.savedClip;
  }

  /** Keeps the overlay in the workspace's scroll and zoom. */
  private syncLayer() {
    const transform =
      this.block.workspace.getCanvas().getAttribute('transform') ?? '';
    if (this.layer.getAttribute('transform') !== transform) {
      this.layer.setAttribute('transform', transform);
    }
  }

  /** Lists the stack's blocks and their segments in drawing order. */
  private index() {
    const blocks = new Map<Element, BlockSvg>();
    for (const block of this.block.getDescendants(false)) {
      blocks.set(block.getSvgRoot(), block);
    }
    // Positions relative to where the root was picked up.
    const root = this.block.getRelativeToSurfaceXY();
    const shiftX = this.origin.x - root.x;
    const shiftY = this.origin.y - root.y;
    let order = 0;
    const entryOf = (block: BlockSvg): Entry => {
      const now = block.getRelativeToSurfaceXY();
      const xy = new Coordinate(now.x + shiftX, now.y + shiftY);
      const left = block.RTL ? xy.x - block.width : xy.x;
      const entry: Entry = {
        block,
        xy,
        rect: new Rect(xy.y, xy.y + block.height, left, left + block.width),
        segments: [],
        copied: false,
      };
      this.entries.push(entry);
      return entry;
    };
    const visit = (block: BlockSvg) => {
      const entry = entryOf(block);
      let parts: Element[] = [];
      const flush = () => {
        entry.segments.push({order: order++, entry, parts, copy: null});
        parts = [];
      };
      for (const child of Array.from(block.getSvgRoot().children)) {
        const childBlock = blocks.get(child);
        if (childBlock) {
          if (parts.length) flush();
          visit(childBlock);
        } else {
          parts.push(child);
        }
      }
      if (parts.length || !entry.segments.length) flush();
    };
    // The stack's group holds the groups of its flat blocks side by side;
    // anything else in it, like a selection outline, goes with the top block.
    let rootEntry: Entry | null = null;
    for (const child of Array.from(this.block.getStackSvgRoot().children)) {
      const childBlock = blocks.get(child);
      if (childBlock) {
        visit(childBlock);
        if (childBlock === this.block) {
          rootEntry = this.entries.find((entry) => entry.block === this.block)!;
        }
        continue;
      }
      rootEntry ??= entryOf(this.block);
      rootEntry.segments.push({
        order: order++,
        entry: rootEntry,
        parts: [child],
        copy: null,
      });
    }
  }

  /** Copies the blocks that are, or are about to be, in view. */
  private fill() {
    const view = this.block.workspace.getMetricsManager().getViewMetrics(true);
    // The view in start-of-drag coordinates, with half a view of margin.
    const left = view.left - this.offset.x;
    const top = view.top - this.offset.y;
    const needed = new Rect(
      top - view.height / 2,
      top + view.height * 1.5,
      left - view.width / 2,
      left + view.width * 1.5,
    );
    const covered = this.covered;
    if (
      covered &&
      covered.top <= needed.top &&
      covered.bottom >= needed.bottom &&
      covered.left <= needed.left &&
      covered.right >= needed.right
    ) {
      return;
    }
    const area = covered
      ? new Rect(
          Math.min(covered.top, needed.top),
          Math.max(covered.bottom, needed.bottom),
          Math.min(covered.left, needed.left),
          Math.max(covered.right, needed.right),
        )
      : needed;
    for (const entry of this.entries) {
      if (entry.copied || !entry.rect.intersects(area)) continue;
      entry.copied = true;
      for (const segment of entry.segments) this.place(segment);
    }
    this.covered = area;
  }

  private place(segment: Segment) {
    const {block, xy} = segment.entry;
    const copy = block.getSvgRoot().cloneNode(false) as SVGGElement;
    strip(copy);
    copy.setAttribute('transform', `translate(${xy.x}, ${xy.y})`);
    if (block === this.block) {
      copy.style.clipPath = this.savedClip;
      if (this.deleteStyle) this.markDelete(copy);
    }
    // The look Blockly gives every dragged block.
    dom.addClass(copy, 'blocklyDragging');
    for (const part of segment.parts) {
      const partCopy = part.cloneNode(true) as Element;
      strip(partCopy);
      for (const inner of Array.from(partCopy.querySelectorAll('[id],[tabindex]'))) {
        strip(inner);
      }
      copy.appendChild(partCopy);
    }
    segment.copy = copy;
    // Binary search for the first placed segment drawn after this one.
    let low = 0;
    let high = this.placed.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (this.placed[mid].order < segment.order) low = mid + 1;
      else high = mid;
    }
    this.content.insertBefore(copy, this.placed[low]?.copy ?? null);
    this.placed.splice(low, 0, segment);
  }

  private markDelete(copy: SVGGElement) {
    if (this.deleteStyle) dom.addClass(copy, 'blocklyDraggingDelete');
    else dom.removeClass(copy, 'blocklyDraggingDelete');
  }

  /** Copies the stack again after its blocks changed under the drag. */
  private rebuild() {
    this.content.replaceChildren();
    this.entries = [];
    this.placed = [];
    this.covered = null;
    this.index();
    this.fill();
    // Records from the rebuild itself are not changes to the stack.
    this.observer.takeRecords();
  }
}

/** A constant transform, as keyframes. */
function keyframes(transform: string): Keyframe[] {
  return [{transform}, {transform}];
}

/** Copies must not claim the real elements' ids or take keyboard focus. */
function strip(element: Element) {
  element.removeAttribute('id');
  element.removeAttribute('tabindex');
}
