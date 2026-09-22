/**
 * @fileoverview The one live block workspace.
 *
 * Blockly is imperative, so it lives outside the component tree: the pane
 * mounts it, switching objects swaps the saved state in and out, and every
 * edit is written back to the project.
 */
import * as Blockly from 'blockly/core';
import { CATEGORY_ORDER } from '../blocks/theme.ts';
import { flyoutFor, installBlocks, TOOLBOX, tessTheme } from '../blocks/registry.ts';
import { project, selectedObjectId, setObjectBlocks } from '../model/store.ts';
import { dialog, functionDraft } from './state.ts';
import { newId } from '../model/ids.ts';
import type { BlocklyState } from '../model/types.ts';

let workspace: Blockly.WorkspaceSvg | null = null;
let shown = '';
let saveTimer: number | undefined;
/** Signal subscriptions the mounted workspace owns. */
let watches: Array<() => void> = [];

export const WORKSPACE_OPTIONS: Blockly.BlocklyOptions = {
  theme: tessTheme,
  renderer: 'zelos',
  media: '/blockly-media/',
  sounds: false,
  trashcan: true,
  zoom: { controls: true, wheel: true, startScale: 0.75, minScale: 0.3, maxScale: 1.8, pinch: true },
  grid: { spacing: 28, length: 3, colour: '#e2e7f1', snap: false },
  move: { scrollbars: true, drag: true, wheel: true },
};

export function mount(host: HTMLElement): void {
  installBlocks();
  workspace = Blockly.inject(host, { ...WORKSPACE_OPTIONS, toolbox: TOOLBOX });
  for (const category of CATEGORY_ORDER) {
    workspace.registerToolboxCategoryCallback(`TESS_${category}`, () => flyoutFor(category) as never);
  }
  workspace.registerButtonCallback('NEW_VARIABLE', () => {
    dialog.value = 'variable';
  });
  workspace.registerButtonCallback('NEW_LIST', () => {
    dialog.value = 'list';
  });
  workspace.registerButtonCallback('NEW_SIGNAL', () => {
    dialog.value = 'signal';
  });
  workspace.registerButtonCallback('NEW_TABLE', () => {
    dialog.value = 'table';
  });
  workspace.registerButtonCallback('NEW_FUNCTION', () => {
    functionDraft.value = { id: newId('f'), name: '함수', params: [], blocks: null };
  });
  workspace.addChangeListener(onChange);
  // The palette stays open like entry's: a category swaps its contents instead
  // of toggling a drawer.
  const flyout = workspace.getFlyout();
  if (flyout) flyout.autoClose = false;
  workspace.getToolbox()?.selectItemByPosition(0);
  shown = '';
  showObject(selectedObjectId.value);
  // Subscribed here rather than from a component: the swap has to happen with
  // the change itself, not after the next render.
  watches = [
    selectedObjectId.subscribe((id) => showObject(id)),
    project.subscribe(() => refreshPalette()),
  ];
}

export function unmount(): void {
  flush();
  for (const stop of watches) stop();
  watches = [];
  workspace?.dispose();
  workspace = null;
  shown = '';
}

export function getWorkspace(): Blockly.WorkspaceSvg | null {
  return workspace;
}

/** Puts the live workspace where the writer can find it. */
export function liveWorkspaces(): Map<string, Blockly.Workspace> {
  const live = new Map<string, Blockly.Workspace>();
  if (workspace && shown) live.set(shown, workspace);
  return live;
}

export function showObject(id: string): void {
  if (!workspace || id === shown) return;
  flush();
  shown = id;
  const object = project.peek().objects.find((candidate) => candidate.id === id);
  Blockly.Events.disable();
  try {
    workspace.clear();
    if (object?.blocks) {
      Blockly.serialization.workspaces.load(object.blocks as never, workspace, { recordUndo: false });
    }
  } finally {
    Blockly.Events.enable();
  }
  workspace.cleanUp?.();
  workspace.scrollCenter();
}

let paletteTimer: number | undefined;

/**
 * Rebuilds the open category so new variables and functions show up.
 *
 * Always off the current task: rebuilding reads the project, and doing that
 * inside a signal effect would make the effect depend on its own work.
 */
export function refreshPalette(): void {
  if (paletteTimer !== undefined) return;
  paletteTimer = setTimeout(() => {
    paletteTimer = undefined;
    workspace?.getToolbox()?.refreshSelection();
  }, 80) as unknown as number;
}

export function resize(): void {
  if (workspace) Blockly.svgResize(workspace);
}

/** Writes pending block edits into the project right away. */
export function flush(): void {
  if (saveTimer !== undefined) {
    clearTimeout(saveTimer);
    saveTimer = undefined;
  }
  if (!workspace || !shown) return;
  const state = Blockly.serialization.workspaces.save(workspace) as BlocklyState;
  setObjectBlocks(shown, state);
}

/** Events that mean the script itself changed. */
const EDITS = new Set<string>([
  Blockly.Events.BLOCK_CREATE,
  Blockly.Events.BLOCK_DELETE,
  Blockly.Events.BLOCK_CHANGE,
  Blockly.Events.BLOCK_MOVE,
  Blockly.Events.BLOCK_FIELD_INTERMEDIATE_CHANGE,
  Blockly.Events.COMMENT_CREATE,
  Blockly.Events.COMMENT_DELETE,
  Blockly.Events.COMMENT_CHANGE,
  Blockly.Events.COMMENT_MOVE,
]);

function onChange(event: Blockly.Events.Abstract): void {
  if (event.isUiEvent || !workspace || !shown) return;
  if (!EDITS.has(event.type)) return;
  if (saveTimer !== undefined) clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 350) as unknown as number;
}
