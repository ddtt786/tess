/**
 * @fileoverview Long stacks are dragged where they stand.
 *
 * Blockly moves a dragged stack onto its drag layer and marks every block in
 * it, and undoes both when the stack is dropped. Each of these makes the
 * browser restyle and lay out the whole stack again, which stalls pick-up and
 * drop for a stack of a few hundred blocks.
 *
 * A long stack stays in the block canvas instead, in front of the other
 * stacks, and only its outlines take the dragged look (`.tess-lifted`, same
 * rules as `.blocklyDragging`). It goes up to the drag layer, as Blockly would
 * have put it at the start, once it has to cover what is drawn over the
 * canvas: the palette, or a delete area under the pointer.
 */
import * as Blockly from 'blockly/core';

/**
 * Stacks of this many blocks, shadows included, stay in the canvas while
 * dragged. Shorter ones restyle quickly and keep Blockly's drag layer, which
 * also draws them over the scrollbars, trash can and zoom controls.
 */
const IN_PLACE_FROM = 120;

/** On the root of a stack dragged in place; the stylesheet gives its outlines the dragged look. */
const LIFTED_CLASS = 'tess-lifted';

/** Blockly's mark on every dragged block. */
const DRAGGING_CLASS = 'blocklyDragging';

interface InPlace {
  root: Blockly.BlockSvg;
  /** Moved up to the drag layer after all. */
  raised: boolean;
  /** Element the stack is held by; it shows the grabbing cursor. */
  grabbed: SVGElement | null;
  /** Its inline cursor before the drag. */
  grabbedCursor: string;
  /** Bounds of the whole stack when it was picked up, in workspace units. */
  box: Blockly.utils.Rect;
  /** Position of the root when it was picked up. */
  origin: Blockly.utils.Coordinate;
}

/** Set while a pointer drag starts; keyboard moves keep Blockly's own drag. */
let starting = false;
/** The stack being dragged in place. */
let inPlace: InPlace | null = null;
/** Last element pressed, where a stack is held. */
let pressed: EventTarget | null = null;

let setDragging: (this: Blockly.BlockSvg, adding: boolean) => void;

let installed = false;

/** Patches Blockly once so long stacks stay in the canvas while dragged. */
export function installStackDrag(): void {
  if (installed) return;
  installed = true;
  if (typeof document !== 'undefined') {
    document.addEventListener('pointerdown', (event) => {
      pressed = event.target;
    }, true);
  }

  const proto = Blockly.BlockSvg.prototype;
  setDragging = proto.setDragging;
  proto.setDragging = function (this: Blockly.BlockSvg, adding: boolean) {
    if (inPlace?.root === this) {
      if (!adding) putDown(inPlace);
    } else if (adding && starting && !inPlace && staysInPlace(this)) {
      pickUp(this);
    } else {
      setDragging.call(this, adding);
    }
  };
}

/** Starts pointer drags so a long stack can stay in place, and raises it when it has to. */
export class StackDragger extends Blockly.dragging.Dragger {
  /** Set while the drop is handled; a stack about to land is not raised any more. */
  private dropping = false;

  override onDragStart(e?: PointerEvent | KeyboardEvent): Blockly.IDraggable {
    // Left over only if a previous drag broke off.
    settle();
    starting = e instanceof PointerEvent;
    try {
      return super.onDragStart(e);
    } finally {
      starting = false;
    }
  }

  override onDrag(e: PointerEvent | KeyboardEvent | undefined, totalDelta: Blockly.utils.Coordinate): void {
    super.onDrag(e, totalDelta);
    const held = inPlace;
    if (held && !held.raised && coversPalette(held.root.workspace, currentBox(held))) raise(held);
  }

  protected override wouldDeleteDraggable(
    coordinate: Blockly.utils.Coordinate,
    rootDraggable: Blockly.IDraggable & Blockly.IDeletable,
  ): boolean {
    const deletes = super.wouldDeleteDraggable(coordinate, rootDraggable);
    // Over a delete area the stack is drawn above it, with the delete cursor.
    if (deletes && !this.dropping && inPlace && !inPlace.raised) raise(inPlace);
    return deletes;
  }

  override onDragEnd(e?: PointerEvent | KeyboardEvent): void {
    this.dropping = true;
    try {
      super.onDragEnd(e);
    } finally {
      settle();
    }
  }

  override onDragRevert(e?: PointerEvent | KeyboardEvent): void {
    try {
      super.onDragRevert(e);
    } finally {
      settle();
    }
  }
}

function staysInPlace(block: Blockly.BlockSvg): boolean {
  if (block.isInFlyout || block.getParent() || !block.workspace.getLayerManager()) return false;
  if (block.getDescendants(false).length < IN_PLACE_FROM) return false;
  // Already reaching under the palette: lifted as usual.
  return !coversPalette(block.workspace, block.getBoundingRectangle());
}

function pickUp(root: Blockly.BlockSvg): void {
  // Blockly's bookkeeping (dragging flags, dragged connections) without its class on every block.
  withoutDraggingClass(() => setDragging.call(root, true));
  root.addClass(LIFTED_CLASS);
  const grabbed = pressed instanceof SVGElement && root.getSvgRoot().contains(pressed) ? pressed : null;
  const grabbedCursor = grabbed?.style.getPropertyValue('cursor') ?? '';
  // Fields and icons carry their own cursor; Blockly's dragging class turns them to grabbing.
  grabbed?.style.setProperty('cursor', 'grabbing');
  inPlace = {
    root,
    raised: false,
    grabbed,
    grabbedCursor,
    box: root.getBoundingRectangle(),
    origin: root.getRelativeToSurfaceXY(),
  };
  patchLayers(root.workspace.getLayerManager()!);
}

function putDown(held: InPlace): void {
  inPlace = null;
  if (held.raised) {
    setDragging.call(held.root, false);
    return;
  }
  withoutDraggingClass(() => setDragging.call(held.root, false));
  release(held);
}

/** Takes the in-place look off the stack. */
function release(held: InPlace): void {
  held.root.removeClass(LIFTED_CLASS);
  if (held.grabbed) {
    if (held.grabbedCursor) held.grabbed.style.setProperty('cursor', held.grabbedCursor);
    else held.grabbed.style.removeProperty('cursor');
  }
}

/** Puts the stack where Blockly puts a dragged stack: marked and on the drag layer. */
function raise(held: InPlace): void {
  held.raised = true;
  release(held);
  const { root } = held;
  for (const block of root.getDescendants(false)) block.addClass(DRAGGING_CLASS);
  const layers = root.workspace.getLayerManager();
  if (!layers) return;
  layers.moveToDragLayer(root);
  for (const bubble of openBubbles(root)) layers.moveToDragLayer(bubble, false);
}

/** Ends a drag that did not put the stack down itself: the stack was deleted, or the drag broke off. */
function settle(): void {
  const held = inPlace;
  if (!held) return;
  if (held.root.isDisposed()) inPlace = null;
  else putDown(held);
}

function withoutDraggingClass(run: () => void): void {
  const proto = Blockly.BlockSvg.prototype;
  const { addClass, removeClass } = proto;
  proto.addClass = function (this: Blockly.BlockSvg, name: string) {
    if (name !== DRAGGING_CLASS) addClass.call(this, name);
  };
  proto.removeClass = function (this: Blockly.BlockSvg, name: string) {
    if (name !== DRAGGING_CLASS) removeClass.call(this, name);
  };
  try {
    run();
  } finally {
    proto.addClass = addClass;
    proto.removeClass = removeClass;
  }
}

/**
 * Keeps a stack dragged in place in the block canvas: moving it (or its open
 * bubbles) to the drag layer and back becomes bringing it to the front. Any
 * other element moves as usual.
 */
function patchLayers(layers: Blockly.LayerManager): void {
  const proto = Object.getPrototypeOf(layers) as Blockly.LayerManager & { __tessInPlace?: boolean };
  if (proto.__tessInPlace) return;
  proto.__tessInPlace = true;
  const { moveToDragLayer, moveOffDragLayer } = proto;
  proto.moveToDragLayer = function (this: Blockly.LayerManager, elem, focus = true) {
    const held = inPlace;
    if (held && !held.raised && elem === held.root) {
      stayInFront(held.root, focus);
    } else if (!(held && !held.raised && elem instanceof Blockly.bubbles.Bubble)) {
      moveToDragLayer.call(this, elem, focus);
    }
  };
  proto.moveOffDragLayer = function (this: Blockly.LayerManager, elem, layerNum, focus = true) {
    const held = inPlace;
    if (held && !held.raised && elem === held.root) stayInFront(held.root, focus);
    else moveOffDragLayer.call(this, elem, layerNum, focus);
  };
}

/**
 * Draws the stack over the other stacks. The later siblings go behind it
 * rather than the stack moving to the end, which would restyle all of it.
 */
function stayInFront(root: Blockly.BlockSvg, focus: boolean): void {
  const svg = root.getSvgRoot();
  const parent = svg.parentNode;
  if (parent) while (svg.nextSibling) parent.insertBefore(svg.nextSibling, svg);
  if (focus && root.canBeFocused()) Blockly.getFocusManager().focusNode(root);
}

/** Where the stack is now, in workspace units. */
function currentBox(held: InPlace): Blockly.utils.Rect {
  const xy = held.root.getRelativeToSurfaceXY();
  const dx = xy.x - held.origin.x;
  const dy = xy.y - held.origin.y;
  const { box } = held;
  return new Blockly.utils.Rect(box.top + dy, box.bottom + dy, box.left + dx, box.right + dx);
}

/** Whether a box, in workspace units, reaches the toolbox or the flyout, which are drawn over the canvas. */
function coversPalette(workspace: Blockly.WorkspaceSvg, box: Blockly.utils.Rect): boolean {
  const toScreen = (x: number, y: number) =>
    Blockly.utils.svgMath.wsToScreenCoordinates(workspace, new Blockly.utils.Coordinate(x, y));
  const topLeft = toScreen(box.left, box.top);
  const bottomRight = toScreen(box.right, box.bottom);
  const screen = new Blockly.utils.Rect(topLeft.y, bottomRight.y, topLeft.x, bottomRight.x);
  return [workspace.getToolbox(), workspace.getFlyout()].some((area) => areaRect(area)?.intersects(screen));
}

function areaRect(area: unknown): Blockly.utils.Rect | null {
  const target = area as Partial<Blockly.IDragTarget> | null;
  return typeof target?.getClientRect === 'function' ? target.getClientRect() : null;
}

/** Open bubbles of the stack, in drawing order, as Blockly moves them along with a dragged stack. */
function openBubbles(root: Blockly.BlockSvg): Blockly.IBubble[] {
  const bubbles: Blockly.IBubble[] = [];
  for (const block of root.getDescendants(false)) {
    for (const icon of block.getIcons()) {
      if (!Blockly.hasBubble(icon) || !icon.bubbleIsVisible()) continue;
      const bubble = icon.getBubble();
      if (bubble) bubbles.push(bubble);
    }
  }
  return bubbles.sort((a, b) => {
    const position = a.getSvgRoot().compareDocumentPosition(b.getSvgRoot());
    if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    return 0;
  });
}
