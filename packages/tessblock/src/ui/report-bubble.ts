/**
 * @fileoverview A lone value block, clicked, shows what it works out to in a
 * bubble under it, as scratch does.
 *
 * The block is written into a one-script copy of the work and compiled. While
 * the work runs, the compiled block is pointed at the running work's records
 * and worked out there; otherwise a quiet copy of the work, loaded but not
 * started, answers with the starting state.
 */
import * as Blockly from 'blockly/core';
import { Vm } from '../../../tessvm/src/runtime/engine.ts';
import { EntryTranslator } from '../../../tessvm/src/web/translate.ts';
import type { RawBlock } from '../../../tessvm/src/compile/codegen.ts';
import type { EntryProject } from '../../../compiler/src/types.ts';
import type { TessProject } from '../model/types.ts';
import { DEFINE_BLOCK } from '../blocks/function-ids.ts';
import { buildSource } from '../codegen/project.ts';
import { project } from '../model/store.ts';
import { build, runningHandle, runningWork } from '../runtime/run.ts';

const PROBE_MARK = '__tess_probe__';

/** Works the block out and shows the result under it; a block that waits shows `…` meanwhile. */
export async function reportValue(block: Blockly.BlockSvg, objectId: string): Promise<void> {
  const asked = ++asking;
  showBubble(block, '…', false);
  let text: string;
  let failed = false;
  try {
    text = format(await evaluate(block, objectId));
  } catch (error) {
    text = error instanceof Error ? error.message : String(error);
    failed = true;
  }
  // A newer click, or the bubble closed while waiting, wins.
  if (asked !== asking || !bubble) return;
  showBubble(block, text, failed);
}

/** Counts clicks, so only the newest one's answer is shown. */
let asking = 0;

async function evaluate(block: Blockly.BlockSvg, objectId: string): Promise<unknown> {
  // Tess has no value for it (only `draw_color = random_color()`); a colour picked the way the runner picks one.
  if (block.type === 'calc_random_colour') return randomColour();
  const model = project.peek();
  const index = model.objects.findIndex((each) => each.id === objectId);
  if (index < 0) throw new Error('오브젝트를 찾을 수 없습니다.');

  const expressionState = Blockly.serialization.blocks.save(block, { addCoordinates: false, addNextBlocks: false }) ?? undefined;
  // The block may call the object's local functions, declared among its scripts.
  const scripts = block.isInFlyout ? block.workspace.targetWorkspace : block.workspace;
  const defines = (scripts?.getTopBlocks(false) ?? [])
    .filter((each) => each.type === DEFINE_BLOCK)
    .map((each) => Blockly.serialization.blocks.save(each)!);
  const key = JSON.stringify([objectId, expressionState, defines]);
  if (probe?.model !== model || probe.key !== key) {
    // Lets the `…` bubble paint before compiling.
    await new Promise((resolve) => {
      requestAnimationFrame(() => setTimeout(resolve, 0));
      setTimeout(resolve, 50);
    });
    probe = { model, key, ...compileProbe(model, objectId, index, expressionState, defines) };
  }
  const { work, expression, object } = probe;

  const live = runningHandle();
  const running = runningWork();
  if (live && running) {
    const ids = idMap(work, running);
    const target = ids.get(object) ?? object;
    return live.vm.evaluate(remap(expression, ids) as RawBlock, target);
  }
  const quietWork = quietVm(model, work);
  const ids = idMap(work, quietWork.work);
  return quietWork.vm.evaluate(remap(expression, ids) as RawBlock, ids.get(object) ?? object);
}

/** The last compiled probe, reused while the work and the clicked block stay the same. */
let probe: { model: TessProject; key: string; work: EntryProject; expression: unknown; object: string } | null = null;

/** Compiles a one-script copy of the work whose script says the block's value. */
function compileProbe(
  model: TessProject,
  objectId: string,
  index: number,
  expressionState: object | undefined,
  defines: object[],
): { work: EntryProject; expression: unknown; object: string } {
  const holder = new Blockly.Workspace();
  let source: string;
  try {
    Blockly.serialization.blocks.append({
      type: 'start_when_run', x: 0, y: 0,
      next: { block: {
        type: 'looks_say', inputs: { TEXT: { block: expressionState } },
        next: { block: { type: 'looks_say', inputs: { TEXT: { shadow: { type: 'calc_text', fields: { TEXT: PROBE_MARK } } } } } },
      } },
    } as never, holder, { recordUndo: false });
    for (const define of defines) Blockly.serialization.blocks.append(define as never, holder, { recordUndo: false });
    const quiet = { ...model, objects: model.objects.map((each) => ({ ...each, blocks: null })) };
    source = buildSource(quiet, { live: new Map([[objectId, holder]]), stubData: true });
  } finally {
    holder.dispose();
  }

  const built = build(source, model.name);
  if (!built.project) throw new Error(built.errors[0]?.message ?? '값을 계산할 수 없습니다.');
  const work = built.project;
  fillLists(work, model);
  const object = work.objects[index];
  if (!object) throw new Error('오브젝트를 찾을 수 없습니다.');
  const expression = probeOf(object.script);
  if (!expression) throw new Error(built.errors[0]?.message ?? '값을 계산할 수 없습니다.');
  return { work, expression, object: object.id };
}

/** Puts the model's list items into a work compiled with its lists left empty. */
function fillLists(work: EntryProject, model: TessProject): void {
  const owners = new Map(work.objects.map((object, at) => [object.id, model.objects[at]?.id ?? null]));
  const items = new Map(model.variables
    .filter((variable) => variable.kind === 'list')
    .map((variable) => [`${variable.owner ?? ''}\u0000${variable.name}`, variable.array]));
  for (const variable of work.variables) {
    if (variable.variableType !== 'list') continue;
    const owner = variable.object ? owners.get(variable.object) ?? '' : '';
    const array = items.get(`${owner}\u0000${variable.name}`);
    if (array) variable.array = array.map((data) => ({ data }));
  }
}

/** The value block the probe script says, found by the marker said after it. */
function probeOf(script: unknown): unknown {
  const stacks = (typeof script === 'string' ? JSON.parse(script) : script) as Array<Array<{ params?: unknown[] }>>;
  for (const stack of stacks) {
    const marker = (stack[2]?.params?.[0] as { params?: unknown[] } | undefined)?.params?.[0];
    if (marker === PROBE_MARK) return stack[1]?.params?.[0];
  }
  return null;
}

/** A loaded, never started copy of the work, kept while the work stays the same. */
let quiet: { model: TessProject; work: EntryProject; vm: Vm } | null = null;

function quietVm(model: TessProject, work: EntryProject): { work: EntryProject; vm: Vm } {
  if (quiet?.model !== model) {
    // It draws and plays nothing, but answers the api blocks the way a run does.
    const vm = new Vm({ renderer: null, audio: null, translator: new EntryTranslator() } as never);
    vm.load(work as never);
    quiet = { model, work, vm };
  }
  return quiet;
}

// --- pointing the probe at the running work ---------------------------------

type Named = { id: string; name?: string };

/**
 * Probe ids to the running work's ids. Both works come from the same records,
 * so objects pair by position, and the rest by name within their object.
 */
export function idMap(probe: EntryProject, running: EntryProject): Map<string, string> {
  const ids = new Map<string, string>();
  const byName = (from: Named[] = [], to: Named[] = [], scope = '') => {
    const named = new Map(to.map((each) => [`${scope}\u0000${each.name}`, each.id]));
    for (const each of from) {
      const id = named.get(`${scope}\u0000${each.name}`);
      if (id) ids.set(each.id, id);
    }
  };
  probe.objects.forEach((object, at) => {
    const other = running.objects[at];
    if (!other) return;
    ids.set(object.id, other.id);
    byName(object.sprite?.pictures as Named[], other.sprite?.pictures as Named[]);
    byName(object.sprite?.sounds as Named[], other.sprite?.sounds as Named[]);
  });
  const owner = (variable: { object?: string | null }) => (variable.object ? ids.get(variable.object) ?? '?' : '');
  const variables = new Map(running.variables.map((each) => [`${owner({ object: each.object })}\u0000${each.name}`, each.id]));
  for (const variable of probe.variables) {
    const id = variables.get(`${owner(variable)}\u0000${variable.name}`);
    if (id) ids.set(variable.id, id);
  }
  byName(probe.messages as Named[], running.messages as Named[]);
  byName(probe.scenes as Named[], running.scenes as Named[]);
  byName((probe as { tables?: Named[] }).tables, (running as { tables?: Named[] }).tables);
  const labels = new Map(running.functions.map((fn) => [functionLabel(fn.content), fn.id]));
  for (const fn of probe.functions) {
    const id = labels.get(functionLabel(fn.content));
    if (id) ids.set(fn.id, id);
  }
  return ids;
}

function functionLabel(content: unknown): string {
  try {
    const script = typeof content === 'string' ? JSON.parse(content) : content;
    return JSON.stringify(script?.[0]?.[0]?.params?.[0] ?? '');
  } catch {
    return '';
  }
}

/** Copies a block tree with record ids swapped; literals keep their text. */
export function remap(node: unknown, ids: Map<string, string>): unknown {
  if (Array.isArray(node)) return node.map((item) => remap(item, ids));
  if (typeof node === 'string') return ids.get(node) ?? node;
  if (!node || typeof node !== 'object') return node;
  const block = node as { type?: string; params?: unknown[]; statements?: unknown[] };
  if (block.type === 'text' || block.type === 'number') return block;
  const type = block.type?.startsWith('func_') ? `func_${ids.get(block.type.slice(5)) ?? block.type.slice(5)}` : block.type;
  return {
    ...block,
    type,
    params: (block.params ?? []).map((param) => remap(param, ids)),
    statements: (block.statements ?? []).map((list) => remap(list, ids)),
  };
}

/** `ops.setRandomPenColor`: each channel picked on its own. */
function randomColour(): string {
  const channel = () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0');
  return `#${channel()}${channel()}${channel()}`;
}

// --- the bubble -------------------------------------------------------------

function format(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}

let bubble: HTMLDivElement | null = null;
let unlisten: (() => void) | null = null;

function showBubble(block: Blockly.BlockSvg, text: string, failed: boolean): void {
  hideBubble();
  const element = document.createElement('div');
  element.className = `report-bubble${failed ? ' failed' : ''}`;
  element.textContent = text === '' ? ' ' : text;
  // A colour shows a swatch of itself in front.
  if (!failed && /^#[0-9a-f]{6}$/i.test(text)) {
    const swatch = document.createElement('span');
    swatch.className = 'report-swatch';
    swatch.style.background = text;
    element.prepend(swatch);
  }
  // Tinted with the block's own colour.
  element.style.setProperty('--report', block.getColour());
  const box = block.getSvgRoot().getBoundingClientRect();
  element.style.left = `${box.left + Math.min(box.width / 2, 40)}px`;
  element.style.top = `${box.bottom + 8}px`;
  document.body.appendChild(element);
  bubble = element;

  // Any press elsewhere, or the workspace moving under it, takes it away.
  const press = (event: PointerEvent) => {
    if (!element.contains(event.target as Node)) hideBubble();
  };
  const workspace = block.workspace;
  const change = (event: Blockly.Events.Abstract) => {
    if (event.type === Blockly.Events.VIEWPORT_CHANGE || event.type === Blockly.Events.BLOCK_MOVE
      || event.type === Blockly.Events.BLOCK_DELETE) hideBubble();
  };
  const timer = setTimeout(() => window.addEventListener('pointerdown', press, true), 0);
  workspace.addChangeListener(change);
  unlisten = () => {
    clearTimeout(timer);
    window.removeEventListener('pointerdown', press, true);
    workspace.removeChangeListener(change);
  };
}

export function hideBubble(): void {
  unlisten?.();
  unlisten = null;
  bubble?.remove();
  bubble = null;
}
