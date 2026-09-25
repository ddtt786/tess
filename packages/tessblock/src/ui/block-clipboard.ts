/**
 * @fileoverview Shift+drag on the canvas marks blocks; ctrl+c / ctrl+x / ctrl+v
 * copy, cut and paste them (or the selected block's stack) through the system
 * clipboard.
 *
 * The clipboard holds the blocks as Tess code (`text/plain`) and as saved block
 * states (`CLIP_TYPE`), which a paste reads back exactly. Blockly's own copy,
 * cut and paste shortcuts are replaced.
 */
import * as Blockly from 'blockly/core';
import { tess } from '../codegen/generator.ts';

const CLIP_TYPE = 'application/x-tessblock+json';

interface ClipData {
  tessblock: 1;
  /** Top-level states, positioned relative to the copied group's top left. */
  blocks: Blockly.serialization.blocks.State[];
}

interface Board {
  workspace: Blockly.WorkspaceSvg;
  marked: Set<Blockly.BlockSvg>;
  /** Last pointer position over the canvas, in client pixels. */
  pointer: { x: number; y: number } | null;
}

const boards = new Set<Board>();
/** The board last pressed on; keys and clipboard events go to it. */
let active: Board | null = null;
/** What the last copy wrote, so a paste of the same text needs no parsing. */
let lastCopy: { text: string; data: ClipData } | null = null;
let installed = false;

/** Adds marking and the clipboard to a workspace; the returned function removes them. */
export function installBlockClipboard(workspace: Blockly.WorkspaceSvg): () => void {
  installGlobal();
  const board: Board = { workspace, marked: new Set(), pointer: null };
  boards.add(board);
  const host = workspace.getInjectionDiv();

  const press = (event: PointerEvent) => {
    active = board;
    if (event.button !== 0) return;
    if (event.shiftKey && onBackground(workspace, event.target)) {
      event.preventDefault();
      event.stopPropagation();
      startMarquee(board, event);
      return;
    }
    clearMarks(board);
  };
  const move = (event: PointerEvent) => {
    board.pointer = { x: event.clientX, y: event.clientY };
  };
  const leave = () => {
    board.pointer = null;
  };
  host.addEventListener('pointerdown', press, true);
  host.addEventListener('pointermove', move, { passive: true });
  host.addEventListener('pointerleave', leave);
  return () => {
    host.removeEventListener('pointerdown', press, true);
    host.removeEventListener('pointermove', move);
    host.removeEventListener('pointerleave', leave);
    boards.delete(board);
    if (active === board) active = null;
  };
}

function installGlobal(): void {
  if (installed) return;
  installed = true;
  const registry = Blockly.ShortcutRegistry.registry;
  const names = Blockly.ShortcutItems.names;
  for (const name of [names.COPY, names.CUT, names.PASTE]) {
    if (registry.getRegistry()[name]) registry.unregister(name);
  }
  document.addEventListener('copy', (event) => onCopy(event, false));
  document.addEventListener('cut', (event) => onCopy(event, true));
  document.addEventListener('paste', onPaste);
  // Before Blockly's own keys, so Delete takes the marked blocks rather than the focused one.
  window.addEventListener('keydown', onKeyDown, true);
}

/** The board a clipboard key applies to, or null when a text field or another pane has it. */
function targetBoard(): Board | null {
  const board = active;
  if (!board || !boards.has(board)) return null;
  const host = board.workspace.getInjectionDiv();
  if (!host.isConnected || !host.offsetParent) return null;
  const focused = document.activeElement;
  if (focused instanceof HTMLElement) {
    if (focused.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(focused.tagName)) return null;
    if (focused !== document.body && !host.contains(focused)) return null;
  }
  if (board.workspace.isDragging() || Blockly.WidgetDiv.isVisible() || Blockly.DropDownDiv.isVisible()) return null;
  return board;
}

// --- marking ----------------------------------------------------------------

/** Whether a press landed on the empty canvas, not on a block, the palette or a control. */
function onBackground(workspace: Blockly.WorkspaceSvg, target: EventTarget | null): boolean {
  if (!(target instanceof Element) || !workspace.getParentSvg().contains(target)) return false;
  return !target.closest(
    '.blocklyBlockCanvas, .blocklyBubbleCanvas, .blocklyFlyout, .blocklyScrollbarHorizontal, '
    + '.blocklyScrollbarVertical, .blocklyZoom, .blocklyTrash',
  );
}

function startMarquee(board: Board, down: PointerEvent): void {
  const box = document.createElement('div');
  box.className = 'block-marquee';
  document.body.appendChild(box);
  const from = { x: down.clientX, y: down.clientY };
  let to = from;
  let frame = 0;
  const draw = () => {
    frame = 0;
    const left = Math.min(from.x, to.x);
    const top = Math.min(from.y, to.y);
    box.style.transform = `translate(${left}px, ${top}px)`;
    box.style.width = `${Math.abs(to.x - from.x)}px`;
    box.style.height = `${Math.abs(to.y - from.y)}px`;
    markInside(board, from, to);
  };
  draw();
  const move = (event: PointerEvent) => {
    to = { x: event.clientX, y: event.clientY };
    if (!frame) frame = requestAnimationFrame(draw);
  };
  const up = () => {
    if (frame) cancelAnimationFrame(frame);
    draw();
    box.remove();
    window.removeEventListener('pointermove', move, true);
    window.removeEventListener('pointerup', up, true);
    window.removeEventListener('pointercancel', up, true);
  };
  window.addEventListener('pointermove', move, true);
  window.addEventListener('pointerup', up, true);
  window.addEventListener('pointercancel', up, true);
}

/** Marks the statement and top-level blocks whose own row the client rectangle touches. */
function markInside(board: Board, a: { x: number; y: number }, b: { x: number; y: number }): void {
  const workspace = board.workspace;
  const toWs = (x: number, y: number) =>
    Blockly.utils.svgMath.screenToWsCoordinates(workspace, new Blockly.utils.Coordinate(x, y));
  const p = toWs(a.x, a.y);
  const q = toWs(b.x, b.y);
  const left = Math.min(p.x, q.x);
  const right = Math.max(p.x, q.x);
  const top = Math.min(p.y, q.y);
  const bottom = Math.max(p.y, q.y);
  const next = new Set<Blockly.BlockSvg>();
  if (right - left > 2 || bottom - top > 2) {
    for (const block of workspace.getAllBlocks(false)) {
      if (block.isShadow() || (block.outputConnection && block.getParent()) || !block.isMovable()) continue;
      const xy = block.getRelativeToSurfaceXY();
      // A C-block counts by its header, so marking the blocks inside it does not take it along.
      const inner = block.inputList.find((input) => input.type === Blockly.inputs.inputTypes.STATEMENT && input.connection);
      const own = inner
        ? Math.min(block.height, (inner.connection as Blockly.RenderedConnection).getOffsetInBlock().y)
        : block.height;
      if (xy.x <= right && xy.x + block.width >= left && xy.y <= bottom && xy.y + own >= top) next.add(block);
    }
  }
  setMarks(board, next);
}

function setMarks(board: Board, next: Set<Blockly.BlockSvg>): void {
  for (const block of board.marked) {
    if (!next.has(block) && !block.isDisposed()) block.getSvgRoot().classList.remove('tessMarked');
  }
  for (const block of next) {
    if (!board.marked.has(block)) block.getSvgRoot().classList.add('tessMarked');
  }
  board.marked = next;
}

function clearMarks(board: Board): void {
  if (board.marked.size) setMarks(board, new Set());
}

/** Marked blocks still on the canvas. */
function liveMarks(board: Board): Blockly.BlockSvg[] {
  const live = [...board.marked].filter((block) => !block.isDisposed() && block.workspace === board.workspace);
  if (live.length !== board.marked.size) board.marked = new Set(live);
  return live;
}

// --- copying ----------------------------------------------------------------

/** Consecutive marked blocks of one stack, first to last. */
type Run = Blockly.BlockSvg[];

/**
 * The marked blocks as runs. A block inside a marked block's input is already
 * part of that block, and a run ends at the first unmarked block below it.
 */
function runsOf(marked: Blockly.BlockSvg[]): Run[] {
  const set = new Set(marked);
  const runs: Run[] = [];
  for (const block of marked) {
    const parent = block.getParent();
    if (parent && parent.getNextBlock() === block && set.has(parent as Blockly.BlockSvg)) continue;
    if (insideMarked(block, set)) continue;
    const run: Run = [block];
    for (let next = block.getNextBlock(); next && set.has(next as Blockly.BlockSvg); next = next.getNextBlock()) {
      run.push(next as Blockly.BlockSvg);
    }
    runs.push(run);
  }
  return runs;
}

/** Whether a marked block holds this one in one of its inputs, at any depth. */
function insideMarked(block: Blockly.Block, set: Set<Blockly.BlockSvg>): boolean {
  for (let child = block, parent = block.getParent(); parent; child = parent, parent = parent.getParent()) {
    if (parent.getNextBlock() !== child && set.has(parent as Blockly.BlockSvg)) return true;
  }
  return false;
}

/** The selected block's stack from it down, or the value block itself. */
function selectedRun(workspace: Blockly.WorkspaceSvg): Run | null {
  const selected = Blockly.getSelected();
  if (!(selected instanceof Blockly.BlockSvg) || selected.workspace !== workspace) return null;
  if (selected.isShadow() || !selected.isMovable() || !selected.isDeletable()) return null;
  if (selected.outputConnection) return [selected];
  const run: Run = [selected];
  for (let next = selected.getNextBlock(); next; next = next.getNextBlock()) run.push(next as Blockly.BlockSvg);
  return run;
}

/** Saved states of the runs, linked through `next`, placed relative to the group. */
function clipData(runs: Run[]): ClipData {
  const origins = runs.map((run) => run[0]!.getRelativeToSurfaceXY());
  const minX = Math.min(...origins.map((xy) => xy.x));
  const minY = Math.min(...origins.map((xy) => xy.y));
  const blocks = runs.map((run, index) => {
    const states = run.map((block) =>
      Blockly.serialization.blocks.save(block, { addCoordinates: false, addNextBlocks: false })!);
    for (let at = states.length - 2; at >= 0; at--) states[at]!.next = { block: states[at + 1]! };
    const first = states[0]!;
    first.x = origins[index]!.x - minX;
    first.y = origins[index]!.y - minY;
    return first;
  });
  return { tessblock: 1, blocks };
}

/** The runs as Tess code, one after another. */
function clipText(runs: Run[]): string {
  const parts: string[] = [];
  try {
    for (const run of runs) {
      tess.stopAfter = run[run.length - 1]!;
      const produced = tess.blockToCode(run[0]!);
      const code = Array.isArray(produced) ? produced[0] : produced;
      if (code.trim()) parts.push(code.trimEnd());
    }
  } finally {
    tess.stopAfter = null;
  }
  return parts.join('\n\n');
}

function onCopy(event: ClipboardEvent, cut: boolean): void {
  const board = targetBoard();
  if (!board || !event.clipboardData) return;
  const marked = liveMarks(board);
  const runs = marked.length ? runsOf(marked) : [selectedRun(board.workspace)].filter((run): run is Run => !!run);
  if (!runs.length) return;
  const data = clipData(runs);
  const text = clipText(runs) || ' ';
  event.preventDefault();
  event.clipboardData.setData('text/plain', text);
  event.clipboardData.setData(CLIP_TYPE, JSON.stringify(data));
  lastCopy = { text, data };
  if (cut) deleteRuns(board, runs);
}

/** Removes the runs, keeping what hangs below each run attached above it. */
function deleteRuns(board: Board, runs: Run[]): void {
  Blockly.Events.setGroup(true);
  try {
    for (const run of runs) {
      for (let index = run.length - 1; index >= 0; index--) {
        const block = run[index]!;
        if (!block.isDisposed() && block.isDeletable()) block.dispose(true, false);
      }
    }
  } finally {
    Blockly.Events.setGroup(false);
  }
  clearMarks(board);
}

// --- pasting ----------------------------------------------------------------

function readClip(event: ClipboardEvent): ClipData | null {
  const raw = event.clipboardData?.getData(CLIP_TYPE);
  if (raw) {
    try {
      const data = JSON.parse(raw) as ClipData;
      if (data?.tessblock === 1 && Array.isArray(data.blocks)) return data;
    } catch {
      // Not ours after all.
    }
  }
  const text = event.clipboardData?.getData('text/plain');
  if (lastCopy && text === lastCopy.text) return lastCopy.data;
  return null;
}

function onPaste(event: ClipboardEvent): void {
  const board = targetBoard();
  if (!board) return;
  const data = readClip(event);
  if (!data?.blocks.length) return;
  event.preventDefault();
  const workspace = board.workspace;
  const origin = pasteOrigin(board, data);
  const pasted = new Set<Blockly.BlockSvg>();
  Blockly.Events.setGroup(true);
  Blockly.utils.dom.startTextWidthCache();
  try {
    for (const state of data.blocks) {
      const placed = { ...state, x: origin.x + (state.x ?? 0), y: origin.y + (state.y ?? 0) };
      const block = Blockly.serialization.blocks.append(placed, workspace) as Blockly.BlockSvg;
      for (let each: Blockly.BlockSvg | null = block; each; each = each.getNextBlock() as Blockly.BlockSvg | null) {
        pasted.add(each);
      }
    }
  } finally {
    Blockly.utils.dom.stopTextWidthCache();
    Blockly.Events.setGroup(false);
  }
  setMarks(board, pasted);
}

/** Where the pasted group's top left goes: under the pointer, else beside the copied place. */
function pasteOrigin(board: Board, data: ClipData): Blockly.utils.Coordinate {
  const workspace = board.workspace;
  if (board.pointer) {
    return Blockly.utils.svgMath.screenToWsCoordinates(
      workspace,
      new Blockly.utils.Coordinate(board.pointer.x, board.pointer.y),
    );
  }
  const view = workspace.getMetricsManager().getViewMetrics(true);
  const first = data.blocks[0]!;
  return new Blockly.utils.Coordinate(view.left + 40 - (first.x ?? 0), view.top + 40 - (first.y ?? 0));
}

// --- keys -------------------------------------------------------------------

function onKeyDown(event: KeyboardEvent): void {
  if (event.defaultPrevented) return;
  const board = targetBoard();
  if (!board) return;
  if (event.key === 'Escape') {
    clearMarks(board);
    return;
  }
  if ((event.key === 'Delete' || event.key === 'Backspace') && !event.ctrlKey && !event.metaKey) {
    const marked = liveMarks(board);
    if (!marked.length) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    deleteRuns(board, runsOf(marked));
  }
}
