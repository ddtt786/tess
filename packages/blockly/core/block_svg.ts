/**
 * @license
 * Copyright 2012 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Methods for graphically rendering a block as SVG.
 *
 * @class
 */
// Former goog.module ID: Blockly.BlockSvg

import {Block} from './block.js';
import * as blockAnimations from './block_animations.js';
import {computeAriaLabel, configureAriaRole} from './block_aria_composer.js';
import * as browserEvents from './browser_events.js';
import {BlockCopyData, BlockPaster} from './clipboard/block_paster.js';
import * as common from './common.js';
import {config} from './config.js';
import type {Connection} from './connection.js';
import {ConnectionType} from './connection_type.js';
import * as constants from './constants.js';
import * as ContextMenu from './contextmenu.js';
import {
  ContextMenuOption,
  ContextMenuRegistry,
  LegacyContextMenuOption,
} from './contextmenu_registry.js';
import {BlockDragStrategy} from './dragging/block_drag_strategy.js';
import {DragProxy} from './dragging/drag_proxy.js';
import type {BlockMove} from './events/events_block_move.js';
import {EventType} from './events/type.js';
import * as eventUtils from './events/utils.js';
import {FieldLabel} from './field_label.js';
import {getFocusManager} from './focus_manager.js';
import * as hints from './hints.js';
import {IconType} from './icons/icon_types.js';
import {MutatorIcon} from './icons/mutator_icon.js';
import {WarningIcon} from './icons/warning_icon.js';
import type {Input} from './inputs/input.js';
import type {IBoundedElement} from './interfaces/i_bounded_element.js';
import {IContextMenu} from './interfaces/i_contextmenu.js';
import type {ICopyable} from './interfaces/i_copyable.js';
import {IDeletable} from './interfaces/i_deletable.js';
import type {
  DragDisposition,
  IDragStrategy,
  IDraggable,
} from './interfaces/i_draggable.js';
import type {IFocusableNode} from './interfaces/i_focusable_node.js';
import type {IFocusableTree} from './interfaces/i_focusable_tree.js';
import {IIcon} from './interfaces/i_icon.js';
import * as internalConstants from './internal_constants.js';
import {KeyboardMover} from './keyboard_nav/keyboard_mover.js';
import {Msg} from './msg.js';
import * as renderManagement from './render_management.js';
import {RenderedConnection} from './rendered_connection.js';
import type {IPathObject} from './renderers/common/i_path_object.js';
import * as blocks from './serialization/blocks.js';
import type {BlockStyle} from './theme.js';
import * as Tooltip from './tooltip.js';
import {idGenerator} from './utils.js';
import * as aria from './utils/aria.js';
import {Coordinate} from './utils/coordinate.js';
import * as dom from './utils/dom.js';
import {Rect} from './utils/rect.js';
import {Svg} from './utils/svg.js';
import * as svgMath from './utils/svg_math.js';
import {FlyoutItemInfo} from './utils/toolbox.js';
import * as userAgent from './utils/useragent.js';
import type {Workspace} from './workspace.js';
import type {WorkspaceSvg} from './workspace_svg.js';

/**
 * Class for a block's SVG representation.
 * Not normally called directly, workspace.newBlock() is preferred.
 */
/** The top block owning each stack group. */
const stackOwners = new WeakMap<Node, BlockSvg>();

/** Blocks whose selection outline is drawn apart from their group. */
const outlined = new Set<BlockSvg>();

/**
 * Moves a block group, keeping focus inside it where the browser can
 * (`moveBefore`); otherwise the caller restores focus.
 */
function moveGroup(parent: Element, group: Element, ref: Node | null) {
  const atomic = parent as Element & {
    moveBefore?: (node: Node, child: Node | null) => void;
  };
  if (atomic.moveBefore && parent.isConnected && group.isConnected) {
    try {
      atomic.moveBefore(group, ref);
      return;
    } catch {
      // Falls back to a plain move.
    }
  }
  parent.insertBefore(group, ref);
}

/** The block each selection outline group belongs to. */
const outlineOwners = new WeakMap<Element, BlockSvg>();

/**
 * Moves an insertion point past the selection outlines of `parent` and its
 * ancestors, which stock Blockly draws below blocks attached after them.
 */
function skipOutlines(
  after: Element | null,
  parent: BlockSvg,
): Element | null {
  for (;;) {
    const next: Element | null = after
      ? after.nextElementSibling
      : null;
    const owner = next ? outlineOwners.get(next) : undefined;
    if (!next || !owner) return after;
    let ancestor: BlockSvg | null = parent;
    while (ancestor && ancestor !== owner) ancestor = ancestor.getParent();
    if (!ancestor) return after;
    after = next;
  }
}

/** Number of blocks hidden by `setSvgDisplay`. */
let hiddenBlocks = 0;

export class BlockSvg
  extends Block
  implements
    IBoundedElement,
    IContextMenu,
    ICopyable<BlockCopyData>,
    IDraggable,
    IDeletable,
    IFocusableNode
{
  /**
   * Constant for identifying rows that are to be rendered inline.
   * Don't collide with Blockly.inputTypes.
   */
  static readonly INLINE = -1;

  /**
   * ID to give the "collapsed warnings" warning. Allows us to remove the
   * "collapsed warnings" warning without removing any warnings that belong to
   * the block.
   */
  static readonly COLLAPSED_WARNING_ID = 'TEMP_COLLAPSED_WARNING_';
  override decompose?: (p1: Workspace) => BlockSvg;
  // override compose?: ((p1: BlockSvg) => void)|null;

  /**
   * An optional method which saves a record of blocks connected to
   * this block so they can be later restored after this block is
   * recoomposed (reconfigured).  Typically records the connected
   * blocks on properties on blocks in the mutator flyout, so that
   * rearranging those component blocks will automatically rearrange
   * the corresponding connected blocks on this block after this block
   * is recomposed.
   *
   * To keep the saved connection information up-to-date, MutatorIcon
   * arranges for an event listener to call this method any time the
   * mutator flyout is open and a change occurs on this block's
   * workspace.
   *
   * @param rootBlock The root block in the mutator flyout.
   */
  saveConnections?: (rootBlock: BlockSvg) => void;

  customContextMenu?: (
    p1: Array<ContextMenuOption | LegacyContextMenuOption>,
  ) => void;

  /**
   * Height of this block, not including any statement blocks above or below.
   * Height is in workspace units.
   */
  height = 0;

  /**
   * Width of this block, including any connected value blocks.
   * Width is in workspace units.
   */
  width = 0;

  /**
   * Width of this block, not including any connected value blocks.
   * Width is in workspace units.
   *
   * @internal
   */
  childlessWidth = 0;

  /**
   * Map from IDs for warnings text to PIDs of functions to apply them.
   * Used to be able to maintain multiple warnings.
   */
  private warningTextDb = new Map<string, ReturnType<typeof setTimeout>>();

  /** Block's mutator icon (if any). */
  mutator: MutatorIcon | null = null;

  private svgGroup: SVGGElement;
  style: BlockStyle;
  /** @internal */
  pathObject: IPathObject;

  /** Is this block a BlockSVG? */
  override readonly rendered = true;

  private visuallyDisabled = false;

  override workspace: WorkspaceSvg;
  override outputConnection: RenderedConnection | null = null;
  override nextConnection: RenderedConnection | null = null;
  override previousConnection: RenderedConnection | null = null;

  private translation = '';

  /** Whether this block is currently being dragged. */
  private dragging = false;

  /**
   * The location of the top left of this block (in workspace coordinates)
   * relative to either its parent block, or the workspace origin if it has no
   * parent.
   *
   * @internal
   */
  relativeCoords = new Coordinate(0, 0);

  private dragStrategy: IDragStrategy = new BlockDragStrategy(this);

  /** Stand-in drawn while this stack is dragged; the stack itself stays put. */
  private dragProxy: DragProxy | null = null;

  /**
   * While this is a top block, the group holding the groups of its whole stack
   * side by side, in drawing order. Stock Blockly nests each block's group in
   * its parent's, which makes moving a long stack in the DOM, and laying it out
   * again, cost more with every block.
   */
  private stackGroup: SVGGElement | null = null;

  /**
   * Whether this block's group sits directly in its stack's group. A block in
   * a value input is not flat: its group nests in its parent's, as in stock
   * Blockly.
   */
  private flat = true;

  /** Offset from the top block of the stack, in workspace units. */
  private stackX = 0;
  private stackY = 0;

  /** Whether this block is hidden for lying outside the view. */
  private culled = false;

  /** The `display` stock Blockly gives this block's group, set by inputs. */
  private svgDisplay = '';

  /** The selection outline while it is drawn above the rest of the stack. */
  private selectedPath: SVGElement | null = null;
  private selectedGroup: SVGGElement | null = null;
  private selectedClassSync: MutationObserver | null = null;

  /**
   * @param workspace The block's workspace.
   * @param prototypeName Name of the language object containing type-specific
   *     functions for this block.
   * @param opt_id Optional ID.  Use this ID if provided, otherwise create a new
   *     ID.
   */
  constructor(workspace: WorkspaceSvg, prototypeName: string, opt_id?: string) {
    super(workspace, prototypeName, opt_id);
    if (!workspace.rendered) {
      throw TypeError('Cannot create a rendered block in a headless workspace');
    }
    this.workspace = workspace;
    this.svgGroup = dom.createSvgElement(Svg.G, {});

    if (prototypeName) {
      dom.addClass(this.svgGroup, prototypeName);
    }
    /** A block style object. */
    this.style = workspace.getRenderer().getConstants().getBlockStyle(null);

    /** The renderer's path object. */
    this.pathObject = workspace
      .getRenderer()
      .makePathObject(this.svgGroup, this.style);

    const svgPath = this.pathObject.svgPath;
    (svgPath as any).tooltip = this;
    Tooltip.bindMouseEvents(svgPath);

    // Expose this block's ID on its top-level SVG group.
    this.svgGroup.setAttribute('data-id', this.id);

    // The page-wide unique ID of this Block used for focusing.
    svgPath.id = idGenerator.getNextUniqueId();

    this.doInit_();
  }

  /**
   * Create and initialize the SVG representation of the block.
   * May be called more than once.
   */
  initSvg() {
    if (this.initialized) return;
    for (const input of this.inputList) {
      input.init();
    }
    for (const icon of this.getIcons()) {
      icon.initView(this.createIconPointerDownListener(icon));
      icon.updateEditable();
    }
    this.applyColour();
    this.pathObject.updateMovable(this.isMovable() || this.isInFlyout);
    const svg = this.getSvgRoot();
    if (svg) {
      browserEvents.conditionalBind(svg, 'pointerdown', this, this.onMouseDown);
    }

    if (!this.parentBlock_) {
      const stack = this.getStackSvgRoot();
      if (!stack.parentNode) this.workspace.getCanvas().appendChild(stack);
    } else if (!svg.parentNode) {
      this.workspace.getCanvas().appendChild(svg);
    }
    this.recomputeAriaContext();
    this.initialized = true;
  }

  /**
   * Get the secondary colour of a block.
   *
   * @returns #RRGGBB string.
   */
  getColourSecondary(): string {
    return this.style.colourSecondary;
  }

  /**
   * Get the tertiary colour of a block.
   *
   * @returns #RRGGBB string.
   */
  getColourTertiary(): string {
    return this.style.colourTertiary;
  }

  /** Selects this block. Highlights the block visually. */
  select() {
    this.addSelect();
    common.fireSelectedEvent(this);
  }

  /** Unselects this block. Unhighlights the block visually. */
  unselect() {
    this.removeSelect();
    common.fireSelectedEvent(null);
  }

  /**
   * Sets the parent of this block to be a new block or null.
   *
   * @param newParent New parent block.
   * @internal
   */
  override setParent(newParent: this | null) {
    const oldParent = this.parentBlock_;
    if (newParent === oldParent) {
      return;
    }

    dom.startTextWidthCache();
    super.setParent(newParent);
    dom.stopTextWidthCache();

    const svgRoot = this.getSvgRoot();

    // Bail early if workspace is clearing, or we aren't rendered.
    // We won't need to reattach ourselves anywhere.
    if (this.workspace.isClearing || !svgRoot) {
      return;
    }

    const wasFlat = this.flat;
    const oldStack = oldParent
      ? oldParent.stackRoot().stackGroup
      : this.stackGroup;
    // Groups of this block's subtree that sit in its old stack's group.
    const moving = this.flatGroups(wasFlat);
    const focusedNode = getFocusManager().getFocusedNode();
    const focusedElement = focusedNode?.getFocusableElement() ?? null;
    let restoreFocus =
      !!focusedElement &&
      (svgRoot.contains(focusedElement) ||
        moving.some((group) => group.contains(focusedElement)));

    if (newParent) {
      const parent = newParent as BlockSvg;
      const root = parent.stackRoot();
      const stack = root.getStackSvgRoot();
      this.flat = !this.outputConnection;
      if (!this.flat) {
        moveGroup(parent.svgGroup, svgRoot, null);
        if (wasFlat) moving.shift();
      }
      const after = moving.length
        ? skipOutlines(this.precedingFlatGroup(), parent)
        : null;
      const ownStack = this.stackGroup;
      if (
        ownStack &&
        moving.length > stack.childElementCount &&
        ownStack.parentNode &&
        ownStack.parentNode === stack.parentNode
      ) {
        // Fewer groups move if the parent's stack joins this one's group.
        const others = Array.from(stack.children);
        restoreFocus ||=
          !!focusedElement && others.some((g) => g.contains(focusedElement));
        const split = after ? others.indexOf(after) + 1 : 0;
        const first = moving[0];
        for (const group of others.slice(0, split)) {
          moveGroup(ownStack, group, first);
        }
        const next = moving[moving.length - 1].nextSibling;
        for (const group of others.slice(split)) {
          moveGroup(ownStack, group, next);
        }
        // The merged stack keeps this one's place in the drawing order.
        stack.remove();
        root.setStackGroup(ownStack);
        ownStack.setAttribute('transform', stack.getAttribute('transform') ?? '');
      } else {
        const next = after ? after.nextSibling : stack.firstChild;
        for (const group of moving) moveGroup(stack, group, next);
        ownStack?.remove();
      }
      this.setStackGroup(null);
      if (!this.flat) svgRoot.setAttribute('transform', this.getTranslation());
      this.placeSubtree();
    } else if (oldParent) {
      const oldXY = this.getRelativeToSurfaceXY();
      const oldRoot = oldParent.stackRoot();
      if (
        wasFlat &&
        oldStack?.parentNode &&
        moving.length * 2 > oldStack.childElementCount
      ) {
        // Fewer groups move if the rest of the old stack leaves its group.
        const leaving = new Set<Element>(moving);
        restoreFocus ||= !!focusedElement && !svgRoot.contains(focusedElement);
        const rest = dom.createSvgElement(Svg.G, {
          'transform': oldStack.getAttribute('transform') ?? '',
        });
        // Attached first, so that its groups move without losing focus.
        oldStack.parentNode.insertBefore(rest, oldStack);
        for (const group of Array.from(oldStack.children)) {
          if (!leaving.has(group)) moveGroup(rest, group, null);
        }
        oldRoot.setStackGroup(rest);
        this.setStackGroup(oldStack);
      } else {
        const stack = dom.createSvgElement(Svg.G, {});
        this.workspace.getCanvas().appendChild(stack);
        if (!wasFlat) moveGroup(stack, svgRoot, null);
        for (const group of moving) moveGroup(stack, group, null);
        this.setStackGroup(stack);
      }
      this.flat = true;
      this.translate(oldXY.x, oldXY.y);
      this.placeSubtree();
    }
    for (const block of outlined) block.placeSelectedPath();
    if (hiddenBlocks) this.applyDisplay();

    // appendChild() clears focus state, so re-focus the previously focused
    // node in case it was this block and would otherwise lose its focus. Once
    // Element.moveBefore() has better browser support, it should be used
    // instead.
    if (restoreFocus && focusedNode) {
      getFocusManager().focusNode(focusedNode);
    }

    this.applyColour();
    this.recomputeAriaContext();
  }

  /**
   * Move a block by a relative offset.
   *
   * @param dx Horizontal offset in workspace units.
   * @param dy Vertical offset in workspace units.
   * @param reason Why is this move happening?  'drag', 'bump', 'snap', ...
   */
  override moveBy(dx: number, dy: number, reason?: string[]) {
    if (this.parentBlock_) {
      throw Error('Block has parent');
    }
    const eventsEnabled = eventUtils.isEnabled();
    let event: BlockMove | null = null;
    if (eventsEnabled) {
      event = new (eventUtils.get(EventType.BLOCK_MOVE)!)(this) as BlockMove;
      if (reason) event.setReason(reason);
    }

    const delta = new Coordinate(dx, dy);
    const currLoc = this.getRelativeToSurfaceXY();
    const newLoc = Coordinate.sum(currLoc, delta);
    this.translate(newLoc.x, newLoc.y);
    // Nothing moves on a zero offset (every block loaded without coordinates
    // gets one), so the connection DB and the content bounds stay as they are.
    const moved = dx !== 0 || dy !== 0;
    if (moved) {
      this.workspace.connectionDBList.forEach((db) => db?.beginBulkUpdates());
      this.updateComponentLocations(newLoc);
      this.workspace.connectionDBList.forEach((db) => db?.endBulkUpdates());
    }

    if (eventsEnabled && event) {
      event!.recordNew();
      eventUtils.fire(event);
    }
    if (moved) this.workspace.resizeContents();
  }

  /**
   * Transforms a block by setting the translation on the transform attribute
   * of the block's SVG.
   *
   * @param x The x coordinate of the translation in workspace units.
   * @param y The y coordinate of the translation in workspace units.
   */
  translate(x: number, y: number) {
    this.translation = `translate(${x}, ${y})`;
    this.relativeCoords = new Coordinate(x, y);
    if (this.dragProxy) {
      this.dragProxy.moveTo(x, y);
      return;
    }
    if (!this.parentBlock_) {
      this.getStackSvgRoot().setAttribute('transform', this.translation);
      this.workspace.queueCull();
      return;
    }
    if (!this.flat) {
      this.svgGroup.setAttribute('transform', this.translation);
    }
    if (!renderManagement.deferPlacement(this)) this.placeSubtree();
  }

  /**
   * The group holding this block's stack if it is a top block, created on
   * first use; otherwise the block's own group.
   *
   * @internal
   */
  getStackSvgRoot(): SVGGElement {
    if (this.parentBlock_) return this.svgGroup;
    if (!this.stackGroup) {
      this.setStackGroup(dom.createSvgElement(Svg.G, {}));
      const stack = this.stackGroup!;
      if (this.translation) {
        stack.setAttribute('transform', this.translation);
      }
      this.svgGroup.parentNode?.replaceChild(stack, this.svgGroup);
      stack.appendChild(this.svgGroup);
      this.placeSubtree();
    }
    return this.stackGroup!;
  }

  /** Sets the stack group this top block owns. */
  private setStackGroup(group: SVGGElement | null) {
    this.stackGroup = group;
    if (group) stackOwners.set(group, this);
  }

  /**
   * The top block of this block's stack, found through the stack group its
   * group sits in rather than by walking up a possibly long stack.
   */
  private stackRoot(): BlockSvg {
    for (
      let element: Node | null = this.svgGroup;
      element;
      element = element.parentNode
    ) {
      const owner = stackOwners.get(element);
      if (owner) {
        // The group is only trusted while it is still its owner's.
        if (owner.stackGroup === element && !owner.parentBlock_) return owner;
        break;
      }
    }
    return this.getRootBlock();
  }

  /**
   * Positions the groups of this block's subtree that sit in the stack's
   * group, relative to the top block.
   *
   * @internal
   */
  placeSubtree() {
    const parent = this.getParent();
    const pending: Array<[BlockSvg, number, number]> = [
      [this, parent?.stackX ?? 0, parent?.stackY ?? 0],
    ];
    while (pending.length) {
      const [block, baseX, baseY] = pending.pop()!;
      const top = !block.parentBlock_;
      const x = top ? 0 : baseX + block.relativeCoords.x;
      const y = top ? 0 : baseY + block.relativeCoords.y;
      block.stackX = x;
      block.stackY = y;
      if (block.flat) {
        const transform = `translate(${x}, ${y})`;
        if (block.svgGroup.getAttribute('transform') !== transform) {
          block.svgGroup.setAttribute('transform', transform);
        }
        block.selectedGroup?.setAttribute('transform', transform);
      }
      for (const child of block.childBlocks_) pending.push([child, x, y]);
    }
  }

  /**
   * Hides this subtree's statement blocks that lie outside the given surface
   * rectangle, so painting skips them; `null` shows them all.
   *
   * @internal
   */
  cullStack(view: Rect | null) {
    const origin = view ? this.getRelativeToSurfaceXY() : null;
    const pending: BlockSvg[] = [this];
    while (pending.length) {
      const block = pending.pop()!;
      let out = false;
      if (view && origin && block.flat) {
        const x = origin.x + block.stackX - this.stackX;
        const y = origin.y + block.stackY - this.stackY;
        out =
          x + block.width < view.left ||
          x > view.right ||
          y + block.height < view.top ||
          y > view.bottom;
      }
      if (block.culled !== out) {
        block.culled = out;
        if (out) dom.addClass(block.svgGroup, 'blocklyCulled');
        else dom.removeClass(block.svgGroup, 'blocklyCulled');
      }
      for (const child of block.childBlocks_) pending.push(child);
    }
  }

  /**
   * The groups of this block's subtree that sit in the stack's group, in
   * drawing order.
   *
   * @param self Whether to count this block's own group as flat.
   */
  private flatGroups(self: boolean): SVGGElement[] {
    const groups: SVGGElement[] = [];
    const pending: BlockSvg[] = [this];
    while (pending.length) {
      const block = pending.pop()!;
      if (block === this ? self : block.flat) groups.push(block.svgGroup);
      const children = block.orderedChildren();
      for (let i = children.length - 1; i >= 0; i--) pending.push(children[i]);
    }
    return groups;
  }

  /** Children in drawing order: those in inputs, then the next block. */
  private orderedChildren(): BlockSvg[] {
    const children: BlockSvg[] = [];
    for (const input of this.inputList) {
      const child = input.connection?.targetBlock() as BlockSvg | null;
      if (child) children.push(child);
    }
    const next = this.getNextBlock();
    if (next) children.push(next);
    return children;
  }

  /** The last flat group of this block's subtree, if it has any. */
  private lastFlatGroup(): SVGGElement | null {
    // The last child's subtree first, then earlier ones, then the block itself.
    const pending: Array<[BlockSvg, boolean]> = [[this, false]];
    while (pending.length) {
      const [block, visited] = pending.pop()!;
      if (visited) {
        if (block.flat) return block.svgGroup;
        continue;
      }
      pending.push([block, true]);
      for (const child of block.orderedChildren()) pending.push([child, false]);
    }
    return null;
  }

  /** The flat group drawn right before this block's subtree. */
  private precedingFlatGroup(): SVGGElement | null {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let child: BlockSvg = this;
    for (
      let parent = child.getParent();
      parent;
      child = parent, parent = parent.getParent()
    ) {
      const siblings = parent.orderedChildren();
      for (let i = siblings.indexOf(child) - 1; i >= 0; i--) {
        const last = siblings[i].lastFlatGroup();
        if (last) return last;
      }
      if (parent.flat) return parent.svgGroup;
    }
    return null;
  }

  /**
   * Shows or hides this block's subtree, as setting its group's `display`
   * does in stock Blockly.
   *
   * @internal
   */
  setSvgDisplay(visible: boolean) {
    const display = visible ? 'block' : 'none';
    if (this.svgDisplay === display) return;
    if (this.svgDisplay === 'none') hiddenBlocks--;
    if (display === 'none') hiddenBlocks++;
    this.svgDisplay = display;
    this.applyDisplay();
  }

  /** Hides this subtree's groups that a hidden block contains. */
  private applyDisplay() {
    let hidden = false;
    for (let parent = this.getParent(); parent; parent = parent.getParent()) {
      if (parent.svgDisplay === 'none') {
        hidden = true;
        break;
      }
    }
    const pending: Array<[BlockSvg, boolean]> = [[this, hidden]];
    while (pending.length) {
      const [block, above] = pending.pop()!;
      // Hidden with `visibility`, which keeps the layout, so showing the
      // blocks again (e.g. expanding) does not lay out their text again.
      const hide = (block.flat && above) || block.svgDisplay === 'none';
      const visibility = hide ? 'hidden' : '';
      if (block.svgGroup.style.visibility !== visibility) {
        block.svgGroup.style.visibility = visibility;
      }
      const inside = above || block.svgDisplay === 'none';
      for (const child of block.childBlocks_) pending.push([child, inside]);
    }
  }

  /**
   * Draws the selection outline where stock Blockly does, above the blocks
   * below this one, by moving it to the end of the stack's group.
   */
  private placeSelectedPath() {
    const path = this.selectedPath;
    if (!path) return;
    if (!this.flat) {
      this.selectedGroup?.remove();
      if (path.parentNode !== this.svgGroup) this.svgGroup.appendChild(path);
      return;
    }
    let group = this.selectedGroup;
    if (!group) {
      group = this.selectedGroup = dom.createSvgElement(Svg.G, {});
      outlineOwners.set(group, this);
      // Same classes as the block's group, for the rules that style its paths.
      const sync = () =>
        group!.setAttribute('class', this.svgGroup.getAttribute('class') ?? '');
      sync();
      this.selectedClassSync = new MutationObserver(sync);
      this.selectedClassSync.observe(this.svgGroup, {
        attributes: true,
        attributeFilter: ['class'],
      });
      browserEvents.conditionalBind(group, 'pointerdown', this, this.onMouseDown);
    }
    group.setAttribute('transform', `translate(${this.stackX}, ${this.stackY})`);
    if (path.parentNode !== group) group.appendChild(path);
    // Right after the blocks under this one, as stock Blockly appends it to
    // the block's group: blocks attached later are drawn over it.
    const stack = this.getRootBlock().getStackSvgRoot();
    if (group.parentNode !== stack) {
      stack.insertBefore(group, this.lastFlatGroup()?.nextSibling ?? null);
    }
  }

  /** Stops drawing the selection outline apart from the block. */
  private dropSelectedPath() {
    outlined.delete(this);
    this.selectedPath = null;
    this.selectedClassSync?.disconnect();
    this.selectedClassSync = null;
    this.selectedGroup?.remove();
    this.selectedGroup = null;
  }

  /**
   * Adds a transform to the block's position, e.g. to skew it.
   *
   * @internal
   */
  setExtraTransform(extra: string) {
    if (this.dragProxy) {
      this.dragProxy.setExtraTransform(extra);
    } else if (this.parentBlock_ && !this.flat) {
      this.svgGroup.setAttribute('transform', `${this.translation} ${extra}`);
    } else if (this.parentBlock_) {
      this.svgGroup.setAttribute(
        'transform',
        `translate(${this.stackX}, ${this.stackY}) ${extra}`,
      );
    } else {
      this.getStackSvgRoot().setAttribute(
        'transform',
        `${this.translation} ${extra}`,
      );
    }
  }

  /**
   * Draws a stand-in for this stack for the rest of the drag.
   *
   * @internal
   */
  startDragProxy() {
    this.cullStack(null);
    if (!this.dragProxy) this.dragProxy = new DragProxy(this);
  }

  /**
   * Whether a drag of this stack should be drawn by a stand-in.
   *
   * @internal
   */
  canUseDragProxy(): boolean {
    return DragProxy.shouldUse(this);
  }

  /**
   * Removes the stand-in and puts the stack where the drag left it.
   *
   * @internal
   */
  stopDragProxy() {
    const proxy = this.dragProxy;
    if (!proxy) return;
    this.dragProxy = null;
    proxy.dispose();
    this.getStackSvgRoot().setAttribute('transform', this.getTranslation());
    this.pathObject.updateDraggingDelete(proxy.deleteStyle);
  }

  /**
   * Returns the SVG translation of this block.
   *
   * @internal
   */
  getTranslation(): string {
    return this.translation;
  }

  /**
   * Move a block to a position.
   *
   * @param xy The position to move to in workspace units.
   * @param reason Why is this move happening?  'drag', 'bump', 'snap', ...
   */
  moveTo(xy: Coordinate, reason?: string[]) {
    const curXY = this.getRelativeToSurfaceXY();
    this.moveBy(xy.x - curXY.x, xy.y - curXY.y, reason);
  }

  /**
   * Move this block during a drag.
   * This block must be a top-level block.
   *
   * @param newLoc The location to translate to, in workspace coordinates.
   * @internal
   */
  moveDuringDrag(newLoc: Coordinate) {
    this.translate(newLoc.x, newLoc.y);
    this.updateComponentLocations(newLoc);
  }

  /** Snap this block to the nearest grid point. */
  snapToGrid() {
    if (this.isDeadOrDying()) return;
    if (this.getParent()) return;
    if (this.isInFlyout) return;
    const grid = this.workspace.getGrid();
    if (!grid?.shouldSnap()) return;
    const currentXY = this.getRelativeToSurfaceXY();
    const alignedXY = grid.alignXY(currentXY);
    if (alignedXY !== currentXY) {
      this.moveTo(alignedXY, ['snap']);
    }
  }

  /**
   * Returns the coordinates of a bounding box describing the dimensions of this
   * block and any blocks stacked below it.
   * Coordinate system: workspace coordinates.
   *
   * @returns Object with coordinates of the bounding box.
   */
  getBoundingRectangle(): Rect {
    return this.getBoundingRectangleWithDimensions(this.getHeightWidth());
  }

  /**
   * Returns the coordinates of a bounding box describing the dimensions of this
   * block alone.
   * Coordinate system: workspace coordinates.
   *
   * @returns Object with coordinates of the bounding box.
   */
  getBoundingRectangleWithoutChildren(): Rect {
    return this.getBoundingRectangleWithDimensions({
      height: this.height,
      width: this.childlessWidth,
    });
  }

  private getBoundingRectangleWithDimensions(blockBounds: {
    height: number;
    width: number;
  }) {
    const blockXY = this.getRelativeToSurfaceXY();
    let left;
    let right;
    if (this.RTL) {
      left = blockXY.x - blockBounds.width;
      right = blockXY.x;
    } else {
      left = blockXY.x;
      right = blockXY.x + blockBounds.width;
    }
    return new Rect(blockXY.y, blockXY.y + blockBounds.height, left, right);
  }

  /**
   * Notify every input on this block to mark its fields as dirty.
   * A dirty field is a field that needs to be re-rendered.
   */
  markDirty() {
    this.pathObject.constants = this.workspace.getRenderer().getConstants();
    for (let i = 0, input; (input = this.inputList[i]); i++) {
      input.markDirty();
    }
  }

  /**
   * Set whether the block is collapsed or not.
   *
   * @param collapsed True if collapsed.
   */
  override setCollapsed(collapsed: boolean) {
    if (this.collapsed_ === collapsed) {
      return;
    }
    super.setCollapsed(collapsed);
    this.updateCollapsed();
  }

  /**
   * Traverses child blocks to see if any of them have a warning.
   *
   * @returns true if any child has a warning, false otherwise.
   */
  private childHasWarning(): boolean {
    // Walks the blocks inside this one; the blocks after it are not inside.
    const next = this.getNextBlock();
    const pending = this.getChildren(false).filter((child) => child !== next);
    while (pending.length) {
      const block = pending.pop()!;
      if (block.getIcon(WarningIcon.TYPE)) return true;
      pending.push(...block.getChildren(false));
    }
    return false;
  }

  /**
   * Makes sure that when the block is collapsed, it is rendered correctly
   * for that state.
   */
  private updateCollapsed() {
    const collapsed = this.isCollapsed();
    const collapsedInputName = constants.COLLAPSED_INPUT_NAME;
    const collapsedFieldName = constants.COLLAPSED_FIELD_NAME;

    for (let i = 0, input; (input = this.inputList[i]); i++) {
      if (input.name !== collapsedInputName) {
        input.setVisible(!collapsed);
      }
    }

    for (const icon of this.getIcons()) {
      icon.updateCollapsed();
    }

    if (!collapsed) {
      // Expanding changes nothing the blocks after this one inherit, so only
      // this block and the blocks in its inputs are brought up to date.
      this.updateDisabledWith(this.getInheritedDisabled(), false);
      this.removeInput(collapsedInputName);
      dom.removeClass(this.svgGroup, 'blocklyCollapsed');
      this.setWarningText(null, BlockSvg.COLLAPSED_WARNING_ID);
      return;
    }

    dom.addClass(this.svgGroup, 'blocklyCollapsed');
    if (this.childHasWarning()) {
      this.setWarningText(
        Msg['COLLAPSED_WARNINGS_WARNING'],
        BlockSvg.COLLAPSED_WARNING_ID,
      );
    }

    const text = this.toString(internalConstants.COLLAPSE_CHARS);
    const field = this.getField(collapsedFieldName);
    if (field) {
      field.setValue(text);
      return;
    }
    const input =
      this.getInput(collapsedInputName) ||
      this.appendDummyInput(collapsedInputName);
    input.appendField(new FieldLabel(text), collapsedFieldName);
    this.recomputeAriaContext();
  }

  /**
   * Handle a pointerdown on an SVG block.
   *
   * @param e Pointer down event.
   */
  private onMouseDown(e: PointerEvent) {
    if (this.workspace.isReadOnly()) return;

    const gesture = this.workspace.getGesture(e);
    if (gesture) {
      gesture.handleBlockStart(e, this);
    }
  }

  /**
   * Load the block's help page in a new window.
   *
   * @internal
   */
  showHelp() {
    const url =
      typeof this.helpUrl === 'function' ? this.helpUrl() : this.helpUrl;
    if (url) {
      window.open(url);
    }
  }

  /**
   * Generate the context menu for this block.
   *
   * @returns Context menu options or null if no menu.
   */
  protected generateContextMenu(
    e: Event,
  ): Array<ContextMenuOption | LegacyContextMenuOption> | null {
    if (this.workspace.isReadOnly() || !this.contextMenu) {
      return null;
    }
    const menuOptions = ContextMenuRegistry.registry.getContextMenuOptions(
      {block: this, focusedNode: this},
      e,
    );

    // Allow the block to add or modify menuOptions.
    if (this.customContextMenu) {
      this.customContextMenu(menuOptions);
    }

    return menuOptions;
  }

  /**
   * Gets the location in which to show the context menu for this block.
   * Use the location of a click if the block was clicked, or a location
   * based on the block's fields otherwise.
   */
  protected calculateContextMenuLocation(e: Event): Coordinate {
    // Open the menu where the user clicked, if they clicked
    if (e instanceof PointerEvent) {
      return new Coordinate(e.clientX, e.clientY);
    }

    // Otherwise, calculate a location.
    // Get the location of the top-left corner of the block in
    // screen coordinates.
    const blockCoords = svgMath.wsToScreenCoordinates(
      this.workspace,
      this.getRelativeToSurfaceXY(),
    );

    // Prefer a y position below the first field in the block.
    const fieldBoundingClientRect = this.inputList
      .filter((input) => input.isVisible())
      .flatMap((input) => input.fieldRow)
      .find((f) => f.isVisible())
      ?.getSvgRoot()
      ?.getBoundingClientRect();

    const y =
      fieldBoundingClientRect && fieldBoundingClientRect.height
        ? fieldBoundingClientRect.y + fieldBoundingClientRect.height
        : blockCoords.y + this.height;

    return new Coordinate(
      this.RTL ? blockCoords.x - 5 : blockCoords.x + 5,
      y + 5,
    );
  }

  /**
   * Show the context menu for this block.
   *
   * @param e Mouse event.
   * @internal
   */
  showContextMenu(e: Event) {
    // Forward to the nearest non-shadow ancestor and focus it for keyboard users.
    if (this.isShadow()) {
      let parent = this.getParent();
      while (parent && parent.isShadow()) {
        parent = parent.getParent();
      }
      if (parent) {
        getFocusManager().focusNode(parent);
        parent.showContextMenu(e);
      }
      return;
    }
    const menuOptions = this.generateContextMenu(e);

    const location = this.calculateContextMenuLocation(e);

    if (menuOptions && menuOptions.length) {
      ContextMenu.show(e, menuOptions, this.RTL, this.workspace, location);
      ContextMenu.setCurrentBlock(this);
    }
  }

  /**
   * Updates the locations of any parts of the block that need to know where
   * they are (e.g. connections, icons).
   *
   * @param blockOrigin The top-left of this block in workspace coordinates.
   * @internal
   */
  updateComponentLocations(blockOrigin: Coordinate) {
    // The blocks under this one follow, walked without recursion.
    const pending: Array<[BlockSvg, Coordinate]> = [[this, blockOrigin]];
    while (pending.length) {
      const [block, origin] = pending.pop()!;
      block.xy.x = origin.x;
      block.xy.y = origin.y;

      if (!block.dragging) block.updateConnectionLocations(origin);
      block.updateIconLocations(origin);
      block.updateFieldLocations(origin);

      for (const child of block.getChildren(false)) {
        pending.push([child, Coordinate.sum(origin, child.relativeCoords)]);
      }
    }
  }

  private updateConnectionLocations(blockOrigin: Coordinate) {
    for (const conn of this.getConnections_(false)) {
      conn.moveToOffset(blockOrigin);
    }
  }

  private updateIconLocations(blockOrigin: Coordinate) {
    for (const icon of this.getIcons()) {
      icon.onLocationChange(blockOrigin);
    }
  }

  private updateFieldLocations(blockOrigin: Coordinate) {
    for (const input of this.inputList) {
      for (const field of input.fieldRow) {
        field.onLocationChange(blockOrigin);
      }
    }
  }

  /**
   * Add a CSS class to the SVG group of this block.
   *
   * @param className
   */
  addClass(className: string) {
    dom.addClass(this.svgGroup, className);
  }

  /**
   * Remove a CSS class from the SVG group of this block.
   *
   * @param className
   */
  removeClass(className: string) {
    dom.removeClass(this.svgGroup, className);
  }

  /**
   * Recursively adds or removes the dragging class to this node and its
   * children.
   *
   * @param adding True if adding, false if removing.
   * @param mark Whether to add or remove the dragging class. A stack drawn by a
   *     stand-in is not marked: the class would restyle every block in it.
   * @internal
   */
  setDragging(adding: boolean, mark = true) {
    if (adding) this.cullStack(null);
    // Every block attached under this one, in order, without recursion.
    for (const block of this.getDescendants(false)) {
      block.dragging = adding;
      if (adding) {
        block.translation = '';
        for (const connection of block.getConnections_(true)) {
          common.draggingConnections.push(connection);
        }
        if (mark) block.addClass('blocklyDragging');
      } else {
        common.draggingConnections.length = 0;
        if (mark) block.removeClass('blocklyDragging');
        if (block.getFullBlockField()) {
          block.recomputeAriaContext();
        }
      }
    }
  }

  /**
   * Returns whether or not this block is currently being dragged.
   */
  isDragging() {
    return this.dragging;
  }

  /**
   * Set whether this block is movable or not.
   *
   * @param movable True if movable.
   */
  override setMovable(movable: boolean) {
    super.setMovable(movable);
    this.pathObject.updateMovable(movable);
  }

  /**
   * Set whether this block is editable or not.
   *
   * @param editable True if editable.
   */
  override setEditable(editable: boolean) {
    super.setEditable(editable);

    if (editable) {
      dom.removeClass(this.svgGroup, 'blocklyNotEditable');
    } else {
      dom.addClass(this.svgGroup, 'blocklyNotEditable');
    }

    const icons = this.getIcons();
    for (let i = 0; i < icons.length; i++) {
      icons[i].updateEditable();
    }
  }

  /**
   * Sets whether this block is a shadow block or not.
   * This method is internal and should not be called by users of Blockly. To
   * create shadow blocks programmatically call connection.setShadowState
   *
   * @param shadow True if a shadow.
   * @internal
   */
  override setShadow(shadow: boolean) {
    super.setShadow(shadow);
    this.applyColour();
    this.recomputeAriaContext();
  }

  /**
   * Set whether this block is an insertion marker block or not.
   * Once set this cannot be unset.
   *
   * @param insertionMarker True if an insertion marker.
   * @internal
   */
  override setInsertionMarker(insertionMarker: boolean) {
    if (this.isInsertionMarker_ === insertionMarker) {
      return; // No change.
    }
    this.isInsertionMarker_ = insertionMarker;
    if (this.isInsertionMarker_) {
      this.setColour(
        this.workspace.getRenderer().getConstants().INSERTION_MARKER_COLOUR,
      );
      this.pathObject.updateInsertionMarker(true);
    }
  }

  /**
   * Return the root node of the SVG or null if none exists.
   *
   * @returns The root SVG node (probably a group).
   */
  getSvgRoot(): SVGGElement {
    return this.svgGroup;
  }

  /**
   * Returns the closest live block to this one, if any.
   */
  private getNearestNeighbour() {
    if (!this.workspace.rendered) return null;

    const blocks = this.workspace
      .getAllBlocks(false)
      .filter((block) => !block.isDeadOrDying());
    let nearestNeighbour = null;
    let closestDistance = Number.MAX_SAFE_INTEGER;
    const self = this.getRelativeToSurfaceXY();
    for (const block of blocks) {
      const other = block.getRelativeToSurfaceXY();
      const distance = Math.sqrt(
        Math.pow(other.x - self.x, 2) + Math.pow(other.y - self.y, 2),
      );
      if (distance < closestDistance) {
        nearestNeighbour = block;
        closestDistance = distance;
      }
    }

    return nearestNeighbour;
  }

  /**
   * Dispose of this block.
   *
   * @param healStack If true, then try to heal any gap by connecting the next
   *     statement with the previous statement.  Otherwise, dispose of all
   *     children of this block.
   * @param animate If true, show a disposal animation and sound.
   */
  override dispose(healStack?: boolean, animate?: boolean) {
    this.disposing = true;
    this.stopDragProxy();

    Tooltip.unbindMouseEvents(this.pathObject.svgPath);
    delete (this.pathObject.svgPath as any).tooltip;
    Tooltip.dispose();
    ContextMenu.hide();

    if (animate) {
      this.unplug(healStack);
      blockAnimations.disposeUiEffect(this);
    }

    const focusManager = getFocusManager();
    let focusedElement: Element | null;
    try {
      // This can throw for a focused connection.
      focusedElement =
        focusManager.getFocusedNode()?.getFocusableElement() ?? null;
    } catch {
      focusedElement = null;
    }

    const stack = this.parentBlock_ ? null : this.stackGroup;
    super.dispose(!!healStack);
    const root = this.stackGroup ?? stack ?? this.svgGroup;
    dom.removeNode(root);

    // If this block (or a descendant) was focused, focus its parent or
    // workspace instead.
    if (root.contains(focusedElement)) {
      let parent: BlockSvg | undefined | null = this.getParent();
      if (!parent) {
        // In some cases, blocks are disconnected from their parents before
        // being deleted. Attempt to infer if there was a parent by checking
        // for a connection within a radius of 0. Even if this wasn't a parent,
        // it must be adjacent to this block and so is as good an option as any
        // to focus after deleting.
        const connection = this.outputConnection ?? this.previousConnection;
        if (connection) {
          const targetConnection = connection.closest(
            0,
            new Coordinate(0, 0),
          ).connection;
          parent = targetConnection?.getSourceBlock();
        }
      }
      setTimeout(() => {
        if (!this.workspace.rendered) return;
        if (parent) {
          focusManager.focusNode(parent);
        } else {
          const nearestNeighbour = this.getNearestNeighbour();

          if (nearestNeighbour) {
            focusManager.focusNode(nearestNeighbour);
          } else {
            focusManager.focusTree(this.workspace);
          }
        }
      }, 0);
    }
  }

  /**
   * Disposes of this block without doing things required by the top block.
   * E.g. does trigger UI effects, remove nodes, etc.
   */
  override disposeInternal() {
    this.disposing = true;
    super.disposeInternal();
    this.dropSelectedPath();
    if (this.svgDisplay === 'none') hiddenBlocks--;
    this.svgDisplay = '';

    if (getFocusManager().getFocusedNode() === this) {
      this.workspace.cancelCurrentGesture();
    }

    [...this.warningTextDb.values()].forEach((n) => clearTimeout(n));
    this.warningTextDb.clear();

    this.getIcons().forEach((i) => i.dispose());
  }

  /**
   * Delete a block and hide chaff when doing so. The block will not be deleted
   * if it's in a flyout. This is called from the context menu and keyboard
   * shortcuts as the full delete action. If you are disposing of a block from
   * the workspace and don't need to perform flyout checks, handle event
   * grouping, or hide chaff, then use `block.dispose()` directly.
   */
  checkAndDelete() {
    if (this.workspace.isFlyout) {
      return;
    }
    eventUtils.setGroup(true);
    this.workspace.hideChaff();
    if (this.outputConnection) {
      // Do not attempt to heal rows
      // (https://github.com/google/blockly/issues/4832)
      this.dispose(false, true);
    } else {
      this.dispose(/* heal */ true, true);
    }
    eventUtils.setGroup(false);
  }

  /**
   * Encode a block for copying.
   *
   * @param addNextBlocks If true, copy subsequent blocks attached to this one
   *     as well.
   *
   * @returns Copy metadata, or null if the block is an insertion marker.
   */
  toCopyData(addNextBlocks = false): BlockCopyData | null {
    if (this.isInsertionMarker_) {
      return null;
    }
    return {
      paster: BlockPaster.TYPE,
      blockState: blocks.save(this, {
        addCoordinates: true,
        addNextBlocks,
        saveIds: false,
      }) as blocks.State,
      typeCounts: common.getBlockTypeCounts(this, true),
    };
  }

  /**
   * Updates the colour of the block to match the block's state.
   *
   * @internal
   */
  applyColour() {
    this.pathObject.applyColour?.(this);

    const icons = this.getIcons();
    for (let i = 0; i < icons.length; i++) {
      icons[i].applyColour();
    }

    for (const field of this.getFields()) {
      field.applyColour();
    }
  }

  /**
   * Updates the colour of the block (and children) to match the current
   * disabled state.
   *
   * @internal
   */
  updateDisabled() {
    this.updateDisabledWith(this.getInheritedDisabled());
  }

  /**
   * Same as `updateDisabled`, given whether an enclosing block is disabled.
   * The blocks after this one share that value, and the blocks inside a block
   * inherit its own, so no block looks up its ancestors again.
   */
  private updateDisabledWith(inherited: boolean, chain = true) {
    for (
      let block: BlockSvg | null = this;
      block;
      block = chain ? block.getNextBlock() : null
    ) {
      const disabled = !block.isEnabled() || inherited;
      if (block.visuallyDisabled === disabled) continue;
      block.applyColour();
      block.visuallyDisabled = disabled;
      const next = block.getNextBlock();
      for (const child of block.getChildren(false)) {
        if (child !== next) child.updateDisabledWith(disabled);
      }
      block.recomputeAriaContext();
    }
  }

  /**
   * Set this block's warning text.
   *
   * @param text The text, or null to delete.
   * @param id An optional ID for the warning text to be able to maintain
   *     multiple warnings.
   */
  override setWarningText(text: string | null, id: string = '') {
    if (!id) {
      // Kill all previous pending processes, this edit supersedes them all.
      for (const timeout of this.warningTextDb.values()) {
        clearTimeout(timeout);
      }
      this.warningTextDb.clear();
    } else if (this.warningTextDb.has(id)) {
      // Only queue up the latest change.  Kill any earlier pending process.
      clearTimeout(this.warningTextDb.get(id)!);
      this.warningTextDb.delete(id);
    }
    if (this.workspace.isDragging()) {
      // Don't change the warning text during a drag.
      // Wait until the drag finishes.
      this.warningTextDb.set(
        id,
        setTimeout(() => {
          if (!this.isDeadOrDying()) {
            this.warningTextDb.delete(id);
            this.setWarningText(text, id);
          }
        }, 100),
      );
      return;
    }
    if (this.isInFlyout) {
      text = null;
    }

    const icon = this.getIcon(WarningIcon.TYPE) as WarningIcon | undefined;
    if (text) {
      // Bubble up to add a warning on top-most collapsed block.
      // TODO(#6020): This warning is never removed.
      let parent = this.getSurroundParent();
      let collapsedParent = null;
      while (parent) {
        if (parent.isCollapsed()) {
          collapsedParent = parent;
        }
        parent = parent.getSurroundParent();
      }
      if (collapsedParent) {
        collapsedParent.setWarningText(
          Msg['COLLAPSED_WARNINGS_WARNING'],
          BlockSvg.COLLAPSED_WARNING_ID,
        );
      }

      if (icon) {
        (icon as WarningIcon).addMessage(text, id);
      } else {
        this.addIcon(new WarningIcon(this).addMessage(text, id));
      }
    } else if (icon) {
      // Dispose all warnings if no ID is given.
      if (!id) {
        this.removeIcon(WarningIcon.TYPE);
      } else {
        // Remove just this warning id's message.
        icon.addMessage('', id);
        // Then remove the entire icon if there is no longer any text.
        if (!icon.getText()) this.removeIcon(WarningIcon.TYPE);
      }
    }
  }

  /**
   * Give this block a mutator dialog.
   *
   * @param mutator A mutator dialog instance or null to remove.
   */
  override setMutator(mutator: MutatorIcon | null) {
    this.removeIcon(MutatorIcon.TYPE);
    if (mutator) this.addIcon(mutator);
  }

  override addIcon<T extends IIcon>(icon: T): T {
    super.addIcon(icon);

    if (icon instanceof MutatorIcon) this.mutator = icon;

    icon.initView(this.createIconPointerDownListener(icon));
    icon.applyColour();
    icon.updateEditable();
    this.queueRender();

    return icon;
  }

  /**
   * Creates a pointer down event listener for the icon to append to its
   * root svg.
   */
  private createIconPointerDownListener(icon: IIcon) {
    return (e: PointerEvent) => {
      if (this.isDeadOrDying()) return;
      const gesture = this.workspace.getGesture(e);
      if (gesture) {
        this.bringToFront();
        gesture.setStartIcon(icon);
        getFocusManager().focusNode(icon);
      }
    };
  }

  override removeIcon(type: IconType<IIcon>): boolean {
    const removed = super.removeIcon(type);

    if (type.equals(MutatorIcon.TYPE)) this.mutator = null;

    this.queueRender();

    return removed;
  }

  /**
   * Add or remove a reason why the block might be disabled. If a block has
   * any reasons to be disabled, then the block itself will be considered
   * disabled. A block could be disabled for multiple independent reasons
   * simultaneously, such as when the user manually disables it, or the block
   * is invalid.
   *
   * @param disabled If true, then the block should be considered disabled for
   *     at least the provided reason, otherwise the block is no longer disabled
   *     for that reason.
   * @param reason A language-neutral identifier for a reason why the block
   *     could be disabled. Call this method again with the same identifier to
   *     update whether the block is currently disabled for this reason.
   */
  override setDisabledReason(disabled: boolean, reason: string): void {
    const wasEnabled = this.isEnabled();
    super.setDisabledReason(disabled, reason);
    if (this.isEnabled() !== wasEnabled && !this.getInheritedDisabled()) {
      this.updateDisabled();
    }
  }

  /**
   * Add blocklyNotDeletable class when block is not deletable
   * Or remove class when block is deletable
   */
  override setDeletable(deletable: boolean) {
    super.setDeletable(deletable);

    if (deletable) {
      dom.removeClass(this.svgGroup, 'blocklyNotDeletable');
    } else {
      dom.addClass(this.svgGroup, 'blocklyNotDeletable');
    }
  }

  /**
   * Set whether the block is highlighted or not.  Block highlighting is
   * often used to visually mark blocks currently being executed.
   *
   * @param highlighted True if highlighted.
   */
  setHighlighted(highlighted: boolean) {
    this.pathObject.updateHighlighted(highlighted);
  }

  /**
   * Adds the visual "select" effect to the block, but does not actually select
   * it or fire an event.
   *
   * @see BlockSvg#select
   */
  addSelect() {
    this.pathObject.updateSelected(true);
    this.selectedPath ??= this.svgGroup.querySelector(
      ':scope > .blocklyPathSelected',
    );
    if (this.selectedPath) {
      outlined.add(this);
      this.placeSelectedPath();
    }
  }

  /**
   * Removes the visual "select" effect from the block, but does not actually
   * unselect it or fire an event.
   *
   * @see BlockSvg#unselect
   */
  removeSelect() {
    this.pathObject.updateSelected(false);
    this.dropSelectedPath();
  }

  /**
   * Update the cursor over this block by adding or removing a class.
   *
   * @param enable True if the delete cursor should be shown, false otherwise.
   * @internal
   */
  setDeleteStyle(enable: boolean) {
    // The hidden stack takes the class when its stand-in goes.
    if (this.dragProxy) this.dragProxy.setDeleteStyle(enable);
    else this.pathObject.updateDraggingDelete(enable);
  }

  // Overrides of functions on Blockly.Block that take into account whether the
  // block has been rendered.

  /**
   * Get the colour of a block.
   *
   * @returns #RRGGBB string.
   */
  override getColour(): string {
    return this.style.colourPrimary;
  }

  /**
   * Change the colour of a block.
   *
   * @param colour HSV hue value, or #RRGGBB string.
   */
  override setColour(colour: number | string) {
    super.setColour(colour);
    const styleObj = this.workspace
      .getRenderer()
      .getConstants()
      .getBlockStyleForColour(this.colour_);

    this.pathObject.setStyle?.(styleObj.style);
    this.style = styleObj.style;
    this.styleName_ = styleObj.name;

    this.applyColour();
  }

  /**
   * Set the style and colour values of a block.
   *
   * @param blockStyleName Name of the block style.
   * @throws {Error} if the block style does not exist.
   */
  override setStyle(blockStyleName: string) {
    const blockStyle = this.workspace
      .getRenderer()
      .getConstants()
      .getBlockStyle(blockStyleName);

    if (this.styleName_) {
      dom.removeClass(this.svgGroup, this.styleName_);
    }

    if (blockStyle) {
      this.hat = blockStyle.hat;
      this.pathObject.setStyle?.(blockStyle);
      // Set colour to match Block.
      this.colour_ = blockStyle.colourPrimary;
      this.style = blockStyle;

      this.applyColour();

      dom.addClass(this.svgGroup, blockStyleName);
      this.styleName_ = blockStyleName;
    } else {
      throw Error('Invalid style name: ' + blockStyleName);
    }
  }

  /**
   * Returns the BlockStyle object used to style this block.
   *
   * @returns This block's style object.
   */
  getStyle(): BlockStyle {
    return this.style;
  }

  /**
   * Move this block to the front of the visible workspace.
   * <g> tags do not respect z-index so SVG renders them in the
   * order that they are in the DOM.  By placing this block first within the
   * block group's <g>, it will render on top of any other blocks.
   * Use sparingly, this method is expensive because it reorders the DOM
   * nodes.
   *
   * @param blockOnly True to only move this block to the front without
   *     adjusting its parents.
   */
  bringToFront(blockOnly = false) {
    const previouslyFocused = getFocusManager().getFocusedNode();
    this.moveSvgRootToFront(blockOnly);
    if (previouslyFocused) {
      // Bringing a block to the front of the stack doesn't fundamentally change
      // the logical structure of the page, but it does change element ordering
      // which can take automatically take away focus from a node. Ensure focus
      // is restored to avoid a discontinuity.
      getFocusManager().focusNode(previouslyFocused);
    }
  }

  /**
   * Reorders this block's SVG root and those of its parents (unless
   * `blockOnly`` is set to `true`) to the end of their respective parents so
   * they render on top of their siblings.
   *
   * Unlike `bringToFront`, this does not preserve focus across the reorder, so
   * it is safe to call from within a focus callback
   *
   * @param blockOnly True to only move this block to the front without
   * adjusting its parents.
   * @internal
   */
  moveSvgRootToFront(blockOnly = false) {
    if (this.isDeadOrDying()) {
      return;
    }
    requestAnimationFrame(() => {
      if (this.dragging) return;
      /* eslint-disable-next-line @typescript-eslint/no-this-alias */
      let block: this | null = this;
      do {
        if (block.isDeadOrDying()) return;
        // Flat blocks keep their place in the stack's drawing order.
        if (!block.parentBlock_ || !block.flat) {
          const root = block.getStackSvgRoot();
          const parent = root.parentNode;
          if (!parent) return;
          const childNodes = parent.childNodes;
          // Avoid moving the block if it's already at the bottom.
          if (childNodes[childNodes.length - 1] !== root) {
            // Moved elements are laid out again: move the smaller side.
            let later = 0;
            for (let node = root.nextSibling; node; node = node.nextSibling) {
              later += (node as Element).childElementCount ?? 0;
            }
            // Moving the stack itself must keep focus in it (`moveBefore`), or
            // the block pressed to start a drag would lose its selection.
            const atomic = parent as ParentNode & {
              moveBefore?: (node: Node, child: Node | null) => void;
            };
            let moved = false;
            if (
              !block.parentBlock_ &&
              root.childElementCount < later &&
              atomic.moveBefore
            ) {
              try {
                atomic.moveBefore(root, null);
                moved = true;
              } catch {
                // Falls back to moving the later siblings.
              }
            }
            if (!moved) {
              while (root.nextSibling) {
                parent.insertBefore(root.nextSibling, root);
              }
            }
          }
        }
        if (blockOnly) break;
        block = block.getParent();
      } while (block);
    });
  }

  /**
   * Set whether this block can chain onto the bottom of another block.
   *
   * @param newBoolean True if there can be a previous statement.
   * @param opt_check Statement type or list of statement types.  Null/undefined
   *     if any type could be connected.
   */
  override setPreviousStatement(
    newBoolean: boolean,
    opt_check?: string | string[] | null,
  ) {
    super.setPreviousStatement(newBoolean, opt_check);
    this.queueRender();
  }

  /**
   * Set whether another block can chain onto the bottom of this block.
   *
   * @param newBoolean True if there can be a next statement.
   * @param opt_check Statement type or list of statement types.  Null/undefined
   *     if any type could be connected.
   */
  override setNextStatement(
    newBoolean: boolean,
    opt_check?: string | string[] | null,
  ) {
    super.setNextStatement(newBoolean, opt_check);
    this.queueRender();
  }

  /**
   * Set whether this block returns a value.
   *
   * @param newBoolean True if there is an output.
   * @param opt_check Returned type or list of returned types.  Null or
   *     undefined if any type could be returned (e.g. variable get).
   */
  override setOutput(
    newBoolean: boolean,
    opt_check?: string | string[] | null,
  ) {
    super.setOutput(newBoolean, opt_check);
    this.queueRender();
  }

  /**
   * Set whether value inputs are arranged horizontally or vertically.
   *
   * @param newBoolean True if inputs are horizontal.
   */
  override setInputsInline(newBoolean: boolean) {
    super.setInputsInline(newBoolean);
    this.queueRender();
  }

  /**
   * Remove an input from this block.
   *
   * @param name The name of the input.
   * @param opt_quiet True to prevent error if input is not present.
   * @returns True if operation succeeds, false if input is not present and
   *     opt_quiet is true
   * @throws {Error} if the input is not present and opt_quiet is not true.
   */
  override removeInput(name: string, opt_quiet?: boolean): boolean {
    const removed = super.removeInput(name, opt_quiet);
    this.queueRender();
    return removed;
  }

  /**
   * Move a numbered input to a different location on this block.
   *
   * @param inputIndex Index of the input to move.
   * @param refIndex Index of input that should be after the moved input.
   */
  override moveNumberedInputBefore(inputIndex: number, refIndex: number) {
    super.moveNumberedInputBefore(inputIndex, refIndex);
    this.queueRender();
  }

  override appendInput(input: Input): Input {
    super.appendInput(input);
    this.queueRender();
    return input;
  }

  /**
   * Sets whether this block's connections are tracked in the database or not.
   *
   * Used by the deserializer to be more efficient. Setting a connection's
   * tracked_ value to false keeps it from adding itself to the db when it
   * gets its first moveTo call, saving expensive ops for later.
   *
   * @param track If true, start tracking. If false, stop tracking.
   * @internal
   */
  setConnectionTracking(track: boolean, subtree = true) {
    // Walked with a list rather than recursion, for long stacks. Without
    // `subtree`, only this block's own connections change.
    const pending: BlockSvg[] = [this];
    while (pending.length) {
      const block = pending.pop()!;
      if (block.previousConnection) {
        block.previousConnection.setTracking(track);
      }
      if (block.outputConnection) {
        block.outputConnection.setTracking(track);
      }
      if (block.nextConnection) {
        block.nextConnection.setTracking(track);
        const child = block.nextConnection.targetBlock();
        if (child && subtree) pending.push(child);
      }

      if (block.collapsed_) {
        // When track is true, we don't want to start tracking collapsed
        // connections. When track is false, we're already not tracking
        // collapsed connections, so no need to update.
        continue;
      }

      for (let i = 0; i < block.inputList.length; i++) {
        const conn = block.inputList[i].connection as RenderedConnection;
        if (conn) {
          conn.setTracking(track);

          // Pass tracking on down the chain.
          const child = conn.targetBlock();
          if (child && subtree) pending.push(child);
        }
      }
    }
  }

  /**
   * Returns connections originating from this block.
   *
   * @param all If true, return all connections even hidden ones.
   *     Otherwise, for a collapsed block don't return inputs connections.
   * @returns Array of connections.
   * @internal
   */
  override getConnections_(all: boolean): RenderedConnection[] {
    const myConnections = [];
    if (this.outputConnection) {
      myConnections.push(this.outputConnection);
    }
    if (this.previousConnection) {
      myConnections.push(this.previousConnection);
    }
    if (this.nextConnection) {
      myConnections.push(this.nextConnection);
    }
    if (all || !this.collapsed_) {
      for (let i = 0, input; (input = this.inputList[i]); i++) {
        if (input.connection) {
          myConnections.push(input.connection as RenderedConnection);
        }
      }
    }
    return myConnections;
  }

  /**
   * Walks down a stack of blocks and finds the last next connection on the
   * stack.
   *
   * @param ignoreShadows If true,the last connection on a non-shadow block will
   *     be returned. If false, this will follow shadows to find the last
   *     connection.
   * @returns The last next connection on the stack, or null.
   * @internal
   */
  override lastConnectionInStack(
    ignoreShadows: boolean,
  ): RenderedConnection | null {
    return super.lastConnectionInStack(ignoreShadows) as RenderedConnection;
  }

  /**
   * Find the connection on this block that corresponds to the given connection
   * on the other block.
   * Used to match connections between a block and its insertion marker.
   *
   * @param otherBlock The other block to match against.
   * @param conn The other connection to match.
   * @returns The matching connection on this block, or null.
   * @internal
   */
  override getMatchingConnection(
    otherBlock: Block,
    conn: Connection,
  ): RenderedConnection | null {
    return super.getMatchingConnection(otherBlock, conn) as RenderedConnection;
  }

  /**
   * Create a connection of the specified type.
   *
   * @param type The type of the connection to create.
   * @returns A new connection of the specified type.
   * @internal
   */
  override makeConnection_(type: ConnectionType): RenderedConnection {
    return new RenderedConnection(this, type);
  }

  /**
   * Return the next statement block directly connected to this block.
   *
   * @returns The next statement block or null.
   */
  override getNextBlock(): BlockSvg | null {
    return super.getNextBlock() as BlockSvg;
  }

  /**
   * Returns the block connected to the previous connection.
   *
   * @returns The previous statement block or null.
   */
  override getPreviousBlock(): BlockSvg | null {
    return super.getPreviousBlock() as BlockSvg;
  }

  /**
   * Bumps unconnected blocks out of alignment.
   *
   * Two blocks which aren't actually connected should not coincidentally line
   * up on screen, because that creates confusion for end-users.
   */
  override bumpNeighbours() {
    const root = this.getRootBlock();
    if (
      this.isDeadOrDying() ||
      this.workspace.isDragging() ||
      this.isDragging() ||
      root.isInFlyout
    ) {
      return;
    }

    // Blocks of the stack, looked up once rather than by walking up from each
    // neighbour.
    let stack: Set<BlockSvg> | null = null;
    const neighbourIsInStack = (neighbour: RenderedConnection) => {
      stack ??= new Set(root.getDescendants(false));
      return stack.has(neighbour.getSourceBlock());
    };

    // Down the block stack in the same order as recursing through each
    // superior connection, with a list of frames instead of the call stack.
    const frames: Array<{
      connections: RenderedConnection[];
      index: number;
      descended: boolean;
    }> = [{connections: this.getConnections_(false), index: 0, descended: false}];
    while (frames.length) {
      const frame = frames[frames.length - 1];
      if (frame.index >= frame.connections.length) {
        frames.pop();
        continue;
      }
      const conn = frame.connections[frame.index];
      if (!frame.descended) {
        frame.descended = true;
        const child = conn.isSuperior() ? conn.targetBlock() : null;
        if (child && !child.isDeadOrDying() && !child.isDragging()) {
          frames.push({
            connections: child.getConnections_(false),
            index: 0,
            descended: false,
          });
          continue;
        }
      }
      frame.index++;
      frame.descended = false;

      for (const neighbour of conn.neighbours(config.snapRadius)) {
        if (neighbourIsInStack(neighbour)) continue;
        if (conn.isConnected() && neighbour.isConnected()) continue;

        if (conn.isSuperior()) {
          neighbour.bumpAwayFrom(conn, /* initiatedByThis = */ false);
        } else if (!neighbour.getSourceBlock().isDragging()) {
          conn.bumpAwayFrom(neighbour, /* initiatedByThis = */ true);
        }
      }
    }
  }

  /**
   * Snap to grid, and then bump neighbouring blocks away at the end of the next
   * render.
   */
  scheduleSnapAndBump() {
    this.snapToGrid();
    this.bumpNeighbours();
  }

  /**
   * Position a block so that it doesn't move the target block when connected.
   * The block to position is usually either the first block in a dragged stack
   * or an insertion marker.
   *
   * @param sourceConnection The connection on the moving block's stack.
   * @param originalOffsetToTarget The connection original offset to the target connection
   * @param originalOffsetInBlock The connection original offset in its block
   * @internal
   */
  positionNearConnection(
    sourceConnection: RenderedConnection,
    originalOffsetToTarget: {x: number; y: number},
    originalOffsetInBlock: Coordinate,
  ) {
    // We only need to position the new block if it's before the existing one,
    // otherwise its position is set by the previous block.
    if (
      sourceConnection.type === ConnectionType.NEXT_STATEMENT ||
      sourceConnection.type === ConnectionType.INPUT_VALUE
    ) {
      // First move the block to match the orginal target connection position
      let dx = originalOffsetToTarget.x;
      let dy = originalOffsetToTarget.y;
      // Then adjust its position according to the connection resize
      dx += originalOffsetInBlock.x - sourceConnection.getOffsetInBlock().x;
      dy += originalOffsetInBlock.y - sourceConnection.getOffsetInBlock().y;

      this.moveBy(dx, dy);
    }
  }

  /**
   * Find all the blocks that are directly nested inside this one.
   * Includes value and statement inputs, as well as any following statement.
   * Excludes any connection on an output tab or any preceding statement.
   * Blocks are optionally sorted by position; top to bottom.
   *
   * @param ordered Sort the list if true.
   * @returns Array of blocks.
   */
  override getChildren(ordered: boolean): BlockSvg[] {
    return super.getChildren(ordered) as BlockSvg[];
  }

  /**
   * Triggers a rerender after a delay to allow for batching.
   *
   * @returns A promise that resolves after the currently queued renders have
   *     been completed. Used for triggering other behavior that relies on
   *     updated size/position location for the block.
   * @internal
   */
  queueRender(): Promise<void> {
    return renderManagement.queueRender(this);
  }

  /**
   * Immediately lays out and reflows a block based on its contents and
   * settings.
   */
  render() {
    this.queueRender();
    renderManagement.triggerQueuedRenders();
  }

  /**
   * Renders this block in a way that's compatible with the more efficient
   * render management system.
   *
   * @internal
   */
  renderEfficiently() {
    dom.startTextWidthCache();

    if (this.isCollapsed()) {
      this.updateCollapsed();
    }

    if (!this.isEnabled()) {
      this.updateDisabled();
    }

    this.workspace.getRenderer().render(this);
    this.tightenChildrenEfficiently();

    dom.stopTextWidthCache();
  }

  /**
   * Tightens all children of this block so they are snuggly rendered against
   * their parent connections.
   *
   * Does not update connection locations, so that they can be updated more
   * efficiently by the render management system.
   *
   * @internal
   */
  tightenChildrenEfficiently() {
    for (const input of this.inputList) {
      const conn = input.connection as RenderedConnection;
      if (conn) conn.tightenEfficiently();
    }
    if (this.nextConnection) this.nextConnection.tightenEfficiently();
  }

  /**
   * Returns a bounding box describing the dimensions of this block
   * and any blocks stacked below it.
   *
   * @returns Object with height and width properties in workspace units.
   * @internal
   */
  getHeightWidth(): {height: number; width: number} {
    let height = this.height;
    let width = this.width;
    // Adds the size of subsequent blocks, walking down the stack.
    const tabHeight = this.workspace.getRenderer().getConstants().NOTCH_HEIGHT;
    for (let next = this.getNextBlock(); next; next = next.getNextBlock()) {
      height += next.height - tabHeight;
      width = Math.max(width, next.width);
    }
    return {height, width};
  }

  /**
   * Visual effect to show that if the dragging block is dropped, this block
   * will be replaced.  If a shadow block, it will disappear.  Otherwise it will
   * bump.
   *
   * @param add True if highlighting should be added.
   * @internal
   */
  fadeForReplacement(add: boolean) {
    this.pathObject.updateReplacing?.(add);
  }

  /**
   * Returns the drag strategy currently in use by this block.
   *
   * @internal
   * @returns This block's drag strategy.
   */
  getDragStrategy(): IDragStrategy {
    return this.dragStrategy;
  }

  /** Sets the drag strategy for this block. */
  setDragStrategy(dragStrategy: IDragStrategy) {
    this.dragStrategy = dragStrategy;
  }

  /** Returns whether this block is copyable or not. */
  isCopyable(): boolean {
    return this.isOwnDeletable() && this.isOwnMovable();
  }

  /** Returns whether this block is movable or not. */
  override isMovable(): boolean {
    return this.dragStrategy.isMovable();
  }

  /** Starts a drag on the block. */
  startDrag(e?: PointerEvent | KeyboardEvent) {
    return this.dragStrategy.startDrag(e);
  }

  /** Drags the block to the given location. */
  drag(newLoc: Coordinate, e?: PointerEvent | KeyboardEvent): void {
    this.dragStrategy.drag(newLoc, e);
  }

  /** Ends the drag on the block. */
  endDrag(
    e: PointerEvent | KeyboardEvent | undefined,
    disposition: DragDisposition,
  ): void {
    this.dragStrategy.endDrag(e, disposition);
  }

  /** Moves the block back to where it was at the start of a drag. */
  revertDrag(): void {
    this.dragStrategy.revertDrag();
  }

  /**
   * Returns a representation of this block that can be displayed in a flyout.
   */
  toFlyoutInfo(): FlyoutItemInfo[] {
    const json: FlyoutItemInfo = {
      kind: 'BLOCK',
      ...blocks.save(this),
    };

    const toRemove = new Set(['id', 'height', 'width', 'pinned', 'enabled']);

    // Traverse the JSON recursively.
    const traverseJson = function (json: {[key: string]: unknown}) {
      for (const key in json) {
        if (toRemove.has(key)) {
          delete json[key];
        } else if (typeof json[key] === 'object') {
          traverseJson(json[key] as {[key: string]: unknown});
        }
      }
    };

    traverseJson(json as unknown as {[key: string]: unknown});
    return [json];
  }

  override jsonInit(json: AnyDuringMigration): void {
    super.jsonInit(json);

    if (json['classes']) {
      this.addClass(
        Array.isArray(json['classes'])
          ? json['classes'].join(' ')
          : json['classes'],
      );
    }
  }

  /**
   * Returns the number of blocks that this block is nested inside of.
   *
   * @internal
   */
  getNestingLevel(): number {
    const surroundParent = this.getSurroundParent();
    return surroundParent ? surroundParent.getNestingLevel() + 1 : 0;
  }

  /** See IFocusableNode.getFocusableElement. */
  getFocusableElement(): HTMLElement | SVGElement {
    // For full-block fields, we focus the field itself
    const fullBlockField = this.getFullBlockField();
    if (fullBlockField) {
      return fullBlockField.getFocusableElement();
    }
    return this.pathObject.svgPath;
  }

  /** See IFocusableNode.getFocusableTree. */
  getFocusableTree(): IFocusableTree {
    return this.workspace;
  }

  /** See IFocusableNode.onNodeFocus. */
  onNodeFocus(): void {
    this.recomputeAriaContext();
    this.select();
    if (!this.workspace.isFlyout) {
      this.moveSvgRootToFront();
    }
    const focusedNode = getFocusManager().getFocusedNode();
    if (focusedNode && focusedNode !== this) {
      renderManagement.finishQueuedRenders().then(() => {
        this.workspace.scrollBoundsIntoView(
          this.getBoundingRectangleWithoutChildren(),
        );
      });
    }
  }

  /** See IFocusableNode.onNodeBlur. */
  onNodeBlur(): void {
    this.unselect();
  }

  /** See IFocusableNode.canBeFocused. */
  canBeFocused(): boolean {
    return true;
  }

  /**
   * Handles the user acting on this block via keyboard navigation.
   * If this block is in the flyout, a new copy is spawned in move mode on the
   * main workspace. If this block has a single full-block field, that field
   * will be focused. Otherwise, this is a no-op.
   */
  performAction(e?: KeyboardEvent) {
    if (this.workspace.isFlyout) {
      KeyboardMover.mover.startMove(this, e);
      return;
    } else if (this.isSimpleReporter()) {
      for (const input of this.inputList) {
        for (const field of input.fieldRow) {
          if (field.isClickable() && field.isFullBlockField()) {
            field.showEditor();
            return;
          }
        }
      }
    }

    if (this.workspace.getNavigator().getInNode(this)) {
      hints.showBlockNavigationHint(this.workspace);
    } else {
      hints.showHelpHint(this.workspace);
    }
  }

  /**
   * Returns a set of all of the parent blocks of the given block.
   *
   * @internal
   * @returns A set of the parents of the given block.
   */
  getParents(): Set<BlockSvg> {
    const parents = new Set<BlockSvg>();
    let parent = this.getParent();
    while (parent) {
      parents.add(parent);
      parent = parent.getParent();
    }

    return parents;
  }

  /**
   * Returns a set of all of the parent blocks connected to an output of the
   * given block or one of its parents. Also includes the given block.
   *
   * @internal
   * @returns A set of the output-connected parents of the given block.
   */
  getOutputParents(): Set<BlockSvg> {
    const parents = new Set<BlockSvg>();
    parents.add(this);
    let parent = this.outputConnection?.targetBlock();
    while (parent) {
      parents.add(parent);
      parent = parent.outputConnection?.targetBlock();
    }

    return parents;
  }

  /**
   * Returns an ID for the logical "row" this block is part of. A "row" is
   * bounded by a previous/next connection, a statement input, or a block stack
   * boundary; all blocks/inputs nested inside of one of those are conceptually
   * part of its same row.
   *
   * @internal
   */
  getRowId(): string {
    const connectedInput =
      this.outputConnection?.targetConnection?.getParentInput();
    // Blocks with an output value have the same ID as the input they're
    // connected to.
    if (connectedInput) {
      return connectedInput.getRowId();
    }

    // All other blocks are their own row.
    return this.id;
  }

  /**
   * Updates the ARIA label, role and roledescription for this block.
   */
  private recomputeAriaContext() {
    const fullBlockField = this.getFullBlockField();
    if (fullBlockField) {
      fullBlockField.recomputeAriaContext();
      return;
    }
    let label = this.getAriaLabel(aria.Verbosity.STANDARD);
    // VoiceOver inserts a comma between aria-label and aria-roledescription.
    // Specific screen readers are not detectable, so OS is used as a proxy.
    if (label && !userAgent.APPLE && !label.endsWith(',')) {
      label += ',';
    }
    aria.setState(this.getFocusableElement(), aria.State.LABEL, label);
    configureAriaRole(this);
  }

  /**
   * Returns a description of this block suitable for screenreaders or use in
   * ARIA attributes.
   *
   * @param verbosity How much detail to include in the description.
   * @returns An accessibility description of this block.
   */
  getAriaLabel(verbosity: aria.Verbosity) {
    return computeAriaLabel(this, verbosity);
  }

  /**
   * Count the number of blocks in this stack (connected by next connections)
   * and return a label to describe it. Uses the standard label if there is only one block.
   *
   * @internal
   */
  getStackBlocksCountLabel(): string {
    let count = 1;
    let block = this.getNextBlock();
    while (block) {
      count++;
      block = block.getNextBlock();
    }
    if (count <= 1) {
      return computeAriaLabel(this, aria.Verbosity.TERSE);
    }

    const labelTemplate = Msg['BLOCK_LABEL_STACK_BLOCKS'];
    return labelTemplate.replace('%1', count.toString());
  }
}
