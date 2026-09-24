/**
 * @license
 * Copyright 2023 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {BlockSvg} from './block_svg.js';
import * as eventUtils from './events/utils.js';
import * as dom from './utils/dom.js';
import * as userAgent from './utils/useragent.js';
import type {WorkspaceSvg} from './workspace_svg.js';

/** The set of all blocks in need of rendering which don't have parents. */
const rootBlocks = new Set<BlockSvg>();

/** The set of all blocks in need of rendering. */
const dirtyBlocks = new WeakSet<BlockSvg>();

/** Blocks between a queued block and its root that are not redrawn themselves. */
const pathBlocks = new WeakSet<BlockSvg>();

/**
 * A map from queued blocks to the event context from when they were queued.
 */
const eventContexts = new WeakMap<
  BlockSvg,
  {group: string; recordUndo: boolean}
>();

/**
 * The promise which resolves after the current set of renders is completed. Or
 * null if there are no queued renders.
 *
 * Stored so that we can return it from afterQueuedRenders.
 */
let afterRendersPromise: Promise<void> | null = null;

/** The function to call to resolve the `afterRendersPromise`. */
let afterRendersResolver: (() => void) | null = null;

/**
 * The ID of the current animation frame request. Used to cancel the request
 * if necessary.
 */
let animationRequestId = 0;

/** Nesting depth of render passes that defer placing flat block groups. */
let placementBatch = 0;

/** Blocks moved during a render pass. */
const unplaced = new Set<BlockSvg>();

/**
 * Defers placing a moved block's flat groups to the end of the render pass, so
 * a pass that moves every block of a stack places each group once.
 *
 * @returns Whether the block was deferred.
 * @internal
 */
export function deferPlacement(block: BlockSvg): boolean {
  if (!placementBatch) return false;
  unplaced.add(block);
  return true;
}

/** Places each stack with a block moved during the pass, once. */
function placeMovedStacks() {
  const roots = new Set<BlockSvg>();
  const rootOf = new Map<BlockSvg, BlockSvg>();
  for (const block of unplaced) {
    if (block.isDisposed()) continue;
    const path: BlockSvg[] = [];
    let current = block;
    let root: BlockSvg | undefined;
    while (!(root = rootOf.get(current))) {
      path.push(current);
      const parent = current.getParent();
      if (!parent) {
        root = current;
        break;
      }
      current = parent;
    }
    for (const each of path) rootOf.set(each, root);
    roots.add(root);
  }
  unplaced.clear();
  for (const root of roots) root.placeSubtree();
}

/**
 * Registers that the given block and all of its parents need to be rerendered,
 * and registers a callback to do so after a delay, to allowf or batching.
 *
 * @param block The block to rerender.
 * @returns A promise that resolves after the currently queued renders have been
 *     completed. Used for triggering other behavior that relies on updated
 *     size/position location for the block.
 * @internal
 */
export function queueRender(block: BlockSvg): Promise<void> {
  queueBlock(block);

  if (alwaysImmediatelyRender()) {
    doRenders();
    return Promise.resolve();
  }

  if (!afterRendersPromise) {
    afterRendersPromise = new Promise((resolve) => {
      afterRendersResolver = resolve;
      animationRequestId = window.requestAnimationFrame(() => {
        doRenders();
        resolve();
      });
    });
  }
  return afterRendersPromise;
}

/**
 * @returns A promise that resolves after the currently queued renders have
 *     been completed.
 */
export function finishQueuedRenders(): Promise<void> {
  // If there are no queued renders, return a resolved promise so `then`
  // callbacks trigger immediately.
  return afterRendersPromise ? afterRendersPromise : Promise.resolve();
}

/**
 * Triggers an immediate render of all queued renders. Should only be used in
 * cases where queueing renders breaks functionality + backwards compatibility
 * (such as rendering icons).
 *
 * @param workspace If provided, only rerender blocks in this workspace.
 *
 * @internal
 */
export function triggerQueuedRenders(workspace?: WorkspaceSvg) {
  if (!workspace) window.cancelAnimationFrame(animationRequestId);
  doRenders(workspace);
  if (!workspace && afterRendersResolver) afterRendersResolver();
}

/**
 * @returns True if we should always trigger an immediate render.
 *     Some platforms don't properly support `requestAnimationFrame`, so to
 *     avoid glitchiness, we give up the performance improvements.
 */
function alwaysImmediatelyRender() {
  return userAgent.JavaFx;
}

/**
 * Adds the given block and its parents to the render queue. Adds the root block
 * to the list of root blocks.
 *
 * @param block The block to queue.
 */
function queueBlock(block: BlockSvg) {
  dirtyBlocks.add(block);
  eventContexts.set(block, {
    group: eventUtils.getGroup(),
    recordUndo: eventUtils.getRecordUndo(),
  });
  let child = block;
  let parent = block.getParent();
  while (parent) {
    // A block already on the way to a queued block had its ancestors marked
    // then; walking on would make queueing every block of a long stack
    // quadratic.
    const seen = pathBlocks.has(parent) || dirtyBlocks.has(parent);
    pathBlocks.add(parent);
    // A block's shape does not depend on the block after it (only a value
    // block with a next connection measures it), so a block linked to the
    // changed one through its next connection is not redrawn. Its ancestors
    // through an input still are: a statement input's height depends on the
    // whole stack in it.
    if (
      (parent.nextConnection?.targetBlock() !== child || parent.outputConnection) &&
      !dirtyBlocks.has(parent)
    ) {
      dirtyBlocks.add(parent);
      eventContexts.set(parent, {
        group: eventUtils.getGroup(),
        recordUndo: eventUtils.getRecordUndo(),
      });
    }
    if (seen) return;
    child = parent;
    parent = parent.getParent();
  }
  rootBlocks.add(child);
}

/**
 * Rerenders all of the blocks in the queue.
 *
 * @param workspace If provided, only rerender blocks in this workspace.
 */
function doRenders(workspace?: WorkspaceSvg) {
  const workspaces = workspace
    ? new Set([workspace])
    : new Set([...rootBlocks].map((block) => block.workspace));
  const blocks = [...rootBlocks]
    .filter(shouldRenderRootBlock)
    .filter((b) => workspaces.has(b.workspace));
  // Repeated field texts are measured once per batch.
  dom.startTextWidthCache();
  placementBatch++;
  try {
    for (const block of blocks) {
      renderBlock(block);
    }
  } finally {
    placementBatch--;
    if (!placementBatch) placeMovedStacks();
    dom.stopTextWidthCache();
  }
  for (const workspace of workspaces) {
    workspace.resizeContents();
    workspace.connectionDBList.forEach((db) => db?.beginBulkUpdates());
  }
  for (const block of blocks) {
    const blockOrigin = block.getRelativeToSurfaceXY();
    block.updateComponentLocations(blockOrigin);
  }
  for (const workspace of workspaces) {
    workspace.connectionDBList.forEach((db) => db?.endBulkUpdates());
  }
  for (const block of blocks) {
    const oldGroup = eventUtils.getGroup();
    const oldRecordUndo = eventUtils.getRecordUndo();
    const context = eventContexts.get(block);
    if (context) {
      if (context.group) eventUtils.setGroup(context.group);
      eventUtils.setRecordUndo(context.recordUndo);
    }

    block.bumpNeighbours();

    eventUtils.setGroup(oldGroup);
    eventUtils.setRecordUndo(oldRecordUndo);
  }

  for (const block of blocks) {
    dequeueBlock(block);
  }
  if (!workspace) afterRendersPromise = null;
}

/** Removes the given block and children from the render queue. */
function dequeueBlock(block: BlockSvg) {
  // Walked with a list rather than recursion, for long stacks.
  const pending = [block];
  while (pending.length) {
    const each = pending.pop()!;
    rootBlocks.delete(each);
    dirtyBlocks.delete(each);
    pathBlocks.delete(each);
    eventContexts.delete(each);
    for (const child of each.getChildren(false)) pending.push(child);
  }
}

function shouldRenderRootBlock(block: BlockSvg): boolean {
  return !block.isDisposed() && !block.getParent();
}

/**
 * Recursively renders all of the dirty children of the given block, and
 * then renders the block.
 *
 * @param block The block to rerender.
 */
function renderBlock(block: BlockSvg) {
  // Children before their parent, as a recursive walk would, but with a list:
  // a long stack nests each block under the one before it.
  const pending: Array<{block: BlockSvg; dirty?: boolean}> = [{block}];
  while (pending.length) {
    const {block: each, dirty} = pending.pop()!;
    if (dirty !== undefined) {
      // Only on the way to a changed block: its children are placed again.
      if (dirty) each.renderEfficiently();
      else each.tightenChildrenEfficiently();
      continue;
    }
    const isDirty = dirtyBlocks.has(each);
    if (!isDirty && !pathBlocks.has(each)) continue;
    if (!each.initialized) continue;
    pending.push({block: each, dirty: isDirty});
    const children = each.getChildren(false);
    for (let i = children.length - 1; i >= 0; i--) {
      pending.push({block: children[i]});
    }
  }
}
