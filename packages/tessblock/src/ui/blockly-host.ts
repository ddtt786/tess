/**
 * @fileoverview The one live block workspace.
 *
 * Blockly is imperative, so it lives outside the component tree: the pane
 * mounts it, switching objects swaps the saved state in and out, and every
 * edit is written back to the project.
 */
import * as Blockly from "blockly/core";
import { CATEGORY_ORDER } from "../blocks/theme.ts";
import {
  flyoutFor,
  installBlocks,
  searchFlyout,
  TOOLBOX,
  tessTheme,
} from "../blocks/registry.ts";
import { DEFINE_BLOCK, fnIdOf, inlineDefinitions, markForeignParams, refreshCallBlocks, relabelCalls, returnsValue, tidyHeader } from "../blocks/functions.ts";
import { StackAwarePreviewer } from "../blocks/previewer.ts";
import { runStack } from "./debug-run.ts";
import { project, restored, selectObject, selectedObjectId, setObjectBlocks } from "../model/store.ts";
import { blockQuery, dialog, editorTab, functionDraft, runningStack } from "./state.ts";
import { newId } from "../model/ids.ts";
import type { BlocklyState, FunctionDef } from "../model/types.ts";
import { signatureOf } from "../model/call-remap.ts";

/** A gap at the top of every palette, so the search strip covers no blocks. */
const PALETTE_TOP = { kind: "sep", gap: 44 };
/** A gap at the bottom so the last blocks scroll cleanly into view with comfortable margin. */
const PALETTE_BOTTOM = { kind: "sep", gap: 140 };

let workspace: Blockly.WorkspaceSvg | null = null;
let palette: ResizeObserver | null = null;
let shown = "";
let saveTimer: number | undefined;
let isLoadingWorkspace = false;
/** Signal subscriptions the mounted workspace owns. */
let watches: Array<() => void> = [];

export const WORKSPACE_OPTIONS: Blockly.BlocklyOptions = {
  theme: tessTheme,
  renderer: "zelos",
  media: "/blockly-media/",
  sounds: false,
  trashcan: true,
  zoom: {
    controls: true,
    wheel: true,
    startScale: 0.75,
    minScale: 0.3,
    maxScale: 1.8,
    pinch: true,
  },
  grid: { spacing: 28, length: 3, colour: "#e2e7f1", snap: false },
  move: { scrollbars: true, drag: true, wheel: true },
  // Long stacks would re-render top to bottom on every move of the insertion marker.
  plugins: { connectionPreviewer: StackAwarePreviewer },
};

export function mount(host: HTMLElement): void {
  installBlocks();
  if (!(Blockly.FlyoutMetricsManager.prototype as any).__scrollPatched) {
    (Blockly.FlyoutMetricsManager.prototype as any).__scrollPatched = true;
    const originalGetScrollMetrics = Blockly.FlyoutMetricsManager.prototype.getScrollMetrics;
    Blockly.FlyoutMetricsManager.prototype.getScrollMetrics = function (getReal = false, viewMetrics, contentMetrics) {
      const metrics = originalGetScrollMetrics.call(this, getReal, viewMetrics, contentMetrics);
      if (metrics && typeof metrics.height === 'number') {
        metrics.height += 90;
      }
      return metrics;
    };
  }
  workspace = Blockly.inject(host, { ...WORKSPACE_OPTIONS, toolbox: TOOLBOX });
  (window as any).__tessWorkspace = workspace;
  for (const category of CATEGORY_ORDER) {
    workspace.registerToolboxCategoryCallback(
      `TESS_${category}`,
      () => [PALETTE_TOP, ...flyoutFor(category), PALETTE_BOTTOM] as never,
    );
  }
  workspace.registerButtonCallback("NEW_VARIABLE", () => {
    dialog.value = "variable";
  });
  workspace.registerButtonCallback("NEW_LIST", () => {
    dialog.value = "list";
  });
  workspace.registerButtonCallback("NEW_SIGNAL", () => {
    dialog.value = "signal";
  });
  workspace.registerButtonCallback("NEW_TABLE", () => {
    dialog.value = "table";
  });
  workspace.registerButtonCallback("NEW_FUNCTION", () => {
    functionDraft.value = {
      id: newId("f"),
      name: "함수",
      owner: null,
      params: [],
      blocks: null,
    };
  });
  workspace.addChangeListener(onChange);
  // The palette stays open like entry's: a category swaps its contents instead
  // of toggling a drawer.
  const flyout = workspace.getFlyout();
  if (flyout) flyout.autoClose = false;
  workspace.getToolbox()?.selectItemByPosition(0);
  // Picking a category is how you leave a search.
  host.querySelector(".blocklyToolbox")?.addEventListener("pointerdown", () => {
    blockQuery.value = "";
  });
  watchPalette(host);
  host.addEventListener("dblclick", openFunctionAt);
  mountedHost = host;
  shown = "";
  showObject(selectedObjectId.value);
  // Subscribed here rather than from a component: the swap has to happen with
  // the change itself, not after the next render.
  watches = [
    selectedObjectId.subscribe((id) => showObject(id)),
    project.subscribe(() => refreshPalette()),
    // Calls already placed follow a function whose parameters changed.
    project.subscribe((model) => {
      const key = model.functions.map((definition) => `${definition.id}=${signatureOf(definition)}`).join(";");
      if (key === signatures) return;
      signatures = key;
      if (workspace && !isLoadingWorkspace) refreshCallBlocks(workspace, model.functions);
    }),
    selectedObjectId.subscribe(() => refreshPalette()),
    restored.subscribe(() => reloadShown()),
    runningStack.subscribe(() => lightStack()),
    blockQuery.subscribe((query) => showSearch(query)),
  ];
}

let mountedHost: HTMLElement | null = null;

export function unmount(): void {
  mountedHost?.removeEventListener("dblclick", openFunctionAt);
  mountedHost = null;
  flush();
  blockQuery.value = "";
  palette?.disconnect();
  palette = null;
  for (const stop of watches) stop();
  watches = [];
  workspace?.dispose();
  workspace = null;
  (window as any).__tessWorkspace = null;
  shown = "";
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
  const object = project
    .peek()
    .objects.find((candidate) => candidate.id === id);
  Blockly.Events.disable();
  isLoadingWorkspace = true;
  try {
    workspace.clear();
    if (object?.blocks) {
      Blockly.serialization.workspaces.load(object.blocks as never, workspace, {
        recordUndo: false,
      });
    }
  } finally {
    isLoadingWorkspace = false;
    Blockly.Events.enable();
  }
  markForeignParams(workspace);
  workspace.scrollCenter();
  if (revealing) focusDefinition(revealing);
  lightStack();
}

/** The stack group lit as running; Blockly nests the following blocks inside it, so they glow too. */
let lit: SVGElement | null = null;

function lightStack(): void {
  lit?.classList.remove("tess-running");
  lit = null;
  const current = runningStack.peek();
  if (!workspace || !current || current.objectId !== shown) return;
  const block = workspace.getBlockById(current.blockId) as Blockly.BlockSvg | null;
  lit = block?.getSvgRoot() ?? null;
  lit?.classList.add("tess-running");
}

/** Local function whose definition block should be brought into view once its object is shown. */
let revealing: string | null = null;

/** Shows the definition block of a local function declared among its object's scripts. */
export function revealFunction(definition: FunctionDef): void {
  revealing = definition.id;
  editorTab.value = "blocks";
  if (definition.owner && definition.owner !== selectedObjectId.peek()) selectObject(definition.owner);
  else if (workspace && shown) focusDefinition(definition.id);
}

function focusDefinition(id: string): void {
  const define = workspace?.getTopBlocks(false).find((each) => each.type === DEFINE_BLOCK && fnIdOf(each) === id);
  if (!workspace || !define) return;
  revealing = null;
  workspace.centerOnBlock(define.id);
  (define as Blockly.BlockSvg).select();
}

/**
 * Double-clicking a function block, in the palette or on the canvas, opens it
 * for editing; double-clicking any other stack on the canvas runs it.
 */
function openFunctionAt(event: MouseEvent): void {
  const element = event.target instanceof Element ? event.target.closest("[data-id]") : null;
  const id = element?.getAttribute("data-id");
  if (!id || !workspace) return;
  const block =
    workspace.getBlockById(id) ??
    workspace.getFlyout()?.getWorkspace().getBlockById(id) ??
    null;
  const match = block ? /^func_(?:call|value)_(.+)$/.exec(block.type) : null;
  if (match) {
    const definition = project.peek().functions.find((candidate) => candidate.id === match[1]);
    if (!definition) return;
    event.preventDefault();
    // A local function declared among the scripts is edited where it stands.
    if (definition.inline) {
      focusDefinition(definition.id);
      return;
    }
    functionDraft.value = structuredClone(definition);
    return;
  }
  // Any other stack on the canvas runs on its own, unless the double click was on a field being edited.
  const onField = event.target instanceof Element
    && event.target.closest(".blocklyEditableField, .blocklyEditableText, .blocklyDropdownText, .blocklyFieldRect");
  if (!block || onField || block.isInFlyout || block.outputConnection || !shown) return;
  // A function body only runs when called; its parameters have no values on their own.
  if (block.getRootBlock().type === DEFINE_BLOCK) return;
  event.preventDefault();
  // Shift held: the stack runs in boost mode, as Shift does on the flag.
  runStack(block as Blockly.BlockSvg, shown, event.shiftKey);
}

/**
 * Loads the shown object again after an undo swapped the work. The workspace is
 * not written back first: what it holds is the state being undone.
 */
function reloadShown(): void {
  if (!workspace || !shown) return;
  if (saveTimer !== undefined) {
    clearTimeout(saveTimer);
    saveTimer = undefined;
  }
  // Keep the view where it was; showObject would recentre it.
  const { scrollX, scrollY } = workspace;
  shown = "";
  showObject(selectedObjectId.peek());
  workspace.scroll(scrollX, scrollY);
  workspace.clearUndo();
  refreshPalette();
}

/** Fills the palette with search hits, or puts the open category back. */
function showSearch(query: string): void {
  const toolbox = workspace?.getToolbox();
  const flyout = workspace?.getFlyout();
  if (!toolbox || !flyout) return;
  if (!query.trim()) {
    toolbox.refreshSelection();
    return;
  }
  flyout.show([PALETTE_TOP, ...searchFlyout(query)] as never);
}

/**
 * Keeps the search strip exactly as wide as the palette — the categories and
 * the open flyout — so it never runs over the work area.
 */
function watchPalette(host: HTMLElement): void {
  const pane = host.parentElement;
  const toolbox = host.querySelector(".blocklyToolbox");
  const flyout = host.querySelector(".blocklyFlyout");
  if (!pane || !toolbox || !flyout) return;
  const measure = () => {
    const width =
      toolbox.getBoundingClientRect().width +
      flyout.getBoundingClientRect().width;
    pane.style.setProperty("--palette-w", `${Math.round(width)}px`);
  };
  measure();
  palette = new ResizeObserver(measure);
  palette.observe(toolbox);
  palette.observe(flyout);
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
    // Rebuilding the flyout closes an open menu or dropdown; wait for it.
    if (Blockly.WidgetDiv.isVisible() || Blockly.DropDownDiv.isVisible()) {
      refreshPalette();
      return;
    }
    const key = paletteKey();
    if (key === shownPalette) return;
    shownPalette = key;
    workspace?.getToolbox()?.refreshSelection();
  }, 80) as unknown as number;
}

let shownPalette = "";

/** Everything the palette lists; a change elsewhere (block edits) leaves it as it is. */
function paletteKey(): string {
  const model = project.peek();
  return JSON.stringify([
    selectedObjectId.peek(),
    model.scenes,
    model.signals,
    model.tables.map((table) => [table.id, table.name, table.columns]),
    model.variables.map((variable) => [variable.id, variable.name, variable.kind, variable.owner]),
    model.objects.map((object) => [
      object.id,
      object.name,
      object.sceneId,
      object.costumes.map((costume) => [costume.id, costume.name]),
      object.sounds.map((sound) => [sound.id, sound.name]),
    ]),
    model.functions.map((definition) => [definition.id, definition.name, definition.params, returnsValue(definition)]),
  ]);
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
  if (!workspace || !shown || isLoadingWorkspace) return;
  const inline = inlineDefinitions(workspace, shown);
  const state = Blockly.serialization.workspaces.save(
    workspace,
  ) as BlocklyState;
  setObjectBlocks(shown, state, inline);
  relabelCalls(workspace, inline);
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

/** Parameter lists of every function, last seen; call blocks are only checked when this changes. */
let signatures = "";

/** Pending frame for greying out misplaced parameter blocks. */
let paramCheck = 0;

function onChange(event: Blockly.Events.Abstract): void {
  if (isLoadingWorkspace) return;
  if (event.type === Blockly.Events.TOOLBOX_ITEM_SELECT) blockQuery.value = "";
  if (event.isUiEvent || !workspace || !shown) return;
  if (event.workspaceId !== workspace.id) return;
  if (!EDITS.has(event.type)) return;
  paramCheck ||= requestAnimationFrame(() => {
    paramCheck = 0;
    if (!workspace) return;
    // A parameter deleted from a header (Delete key, menu) leaves its slot empty; close it up.
    for (const define of workspace.getTopBlocks(false)) {
      if (define.type === DEFINE_BLOCK) tidyHeader(define as Blockly.BlockSvg);
    }
    markForeignParams(workspace);
  });
  if (saveTimer !== undefined) clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 350) as unknown as number;
}
