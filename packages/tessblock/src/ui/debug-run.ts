/**
 * @fileoverview Running one stack on its own, the way scratch runs a clicked stack.
 *
 * The work is written with every script left out except a single start script
 * holding the stack: its object starts where the editor has it and nothing
 * else runs. Stopping puts the stage back to the editor's state, since the
 * run never touched the project.
 */
import * as Blockly from 'blockly/core';
import { buildSource } from '../codegen/project.ts';
import { tess } from '../codegen/generator.ts';
import { DEFINE_BLOCK } from '../blocks/functions.ts';
import { project } from '../model/store.ts';
import { debugLive, debugRequest, runningStack } from './state.ts';
import { idMap, remap } from './report-bubble.ts';
import { build, runningHandle, runningWork } from '../runtime/run.ts';
import type { FunctionEntry, RawBlock } from '../../../tessvm/src/compile/codegen.ts';
import type { Vm } from '../../../tessvm/src/runtime/engine.ts';

/** Starts the stage on `block` and the blocks under it; a hat runs its body. `boost` runs it in boost mode. */
export function runStack(block: Blockly.BlockSvg, objectId: string, boost = false): void {
  const model = project.peek();
  const object = model.objects.find((candidate) => candidate.id === objectId);
  if (!object) return;
  // A session already going takes the stack in, with everything as it now stands.
  if (debugLive.peek() && joinSession(block, objectId)) {
    runningStack.value = { objectId, blockId: block.id };
    return;
  }
  const saved = Blockly.serialization.blocks.save(block, { addNextBlocks: true, addCoordinates: false }) as
    Blockly.serialization.blocks.State;
  const body = tess.hatTypes.has(block.type) ? saved.next?.block : saved;
  if (!body) return;

  const holder = new Blockly.Workspace();
  try {
    Blockly.serialization.blocks.append({ type: 'start_when_run', x: 0, y: 0, next: { block: body } }, holder, {
      recordUndo: false,
    });
    // The stack may call the object's local functions, declared among its scripts.
    for (const define of block.workspace.getTopBlocks(false)) {
      if (define.type !== DEFINE_BLOCK || define === block) continue;
      Blockly.serialization.blocks.append(Blockly.serialization.blocks.save(define)!, holder, { recordUndo: false });
    }
    const quiet = { ...model, objects: model.objects.map((each) => ({ ...each, blocks: null })) };
    const source = buildSource(quiet, { live: new Map([[objectId, holder]]) });
    const scene = model.scenes.find((candidate) => candidate.id === object.sceneId)?.name ?? '';
    debugRequest.value = { source, scene, label: object.name, boost };
    runningStack.value = { objectId, blockId: block.id };
  } finally {
    holder.dispose();
  }
}

/** The last stack joined to a session, compiled; a click on it again starts it without compiling. */
let joined: {
  key: string;
  model: object;
  running: object;
  object: string;
  body: NonNullable<ReturnType<Vm['compileStack']>>;
  target: string;
} | null = null;

/**
 * Starts the stack inside the running session: written into a one-script copy
 * of the work, compiled, pointed at the running work's records and handed to
 * its VM as a new thread. False when it cannot, so the caller starts afresh.
 */
function joinSession(block: Blockly.BlockSvg, objectId: string): boolean {
  const live = runningHandle();
  const running = runningWork();
  if (!live || !running) return false;
  const model = project.peek();
  const index = model.objects.findIndex((each) => each.id === objectId);
  const saved = Blockly.serialization.blocks.save(block, { addNextBlocks: true, addCoordinates: false }) as
    Blockly.serialization.blocks.State;
  const body = tess.hatTypes.has(block.type) ? saved.next?.block : saved;
  if (index < 0 || !body) return false;

  // The same stack again, in the same run of the same work: its compiled form is reused.
  const key = JSON.stringify(body);
  if (joined && joined.key === key && joined.model === model && joined.running === running && joined.object === objectId) {
    return live.vm.startStack(joined.body, joined.target, block.id);
  }

  const holder = new Blockly.Workspace();
  let source: string;
  try {
    Blockly.serialization.blocks.append({ type: 'start_when_run', x: 0, y: 0, next: { block: body } }, holder, { recordUndo: false });
    for (const define of block.workspace.getTopBlocks(false)) {
      if (define.type !== DEFINE_BLOCK || define === block) continue;
      Blockly.serialization.blocks.append(Blockly.serialization.blocks.save(define)!, holder, { recordUndo: false });
    }
    const quiet = { ...model, objects: model.objects.map((each) => ({ ...each, blocks: null })) };
    source = buildSource(quiet, { live: new Map([[objectId, holder]]) });
  } finally {
    holder.dispose();
  }
  const built = build(source, model.name);
  const compiled = built.project?.objects[index];
  if (!built.project || !compiled) return false;
  const stacks = (typeof compiled.script === 'string' ? JSON.parse(compiled.script) : compiled.script) as RawBlock[][];
  const stack = stacks.find((each) => each[0]?.type === 'when_run_button_click');
  if (!stack) return false;
  const ids = idMap(built.project, running);
  // Functions the running work lacks (the compiler's helpers for `scale_x = …` and the like) travel with the stack.
  const extra = built.project.functions
    .filter((fn) => !ids.has(fn.id))
    .map((fn) => ({
      id: fn.id,
      type: String(fn.type ?? 'normal'),
      localVariables: (fn.localVariables ?? []) as FunctionEntry['localVariables'],
      content: JSON.stringify(remap(typeof fn.content === 'string' ? JSON.parse(fn.content) : fn.content, ids)),
    }));
  const target = ids.get(compiled.id) ?? compiled.id;
  const compiledStack = live.vm.compileStack(remap(stack.slice(1), ids) as RawBlock[], extra);
  if (!compiledStack) return false;
  joined = { key, model, running, object: objectId, body: compiledStack, target };
  return live.vm.startStack(compiledStack, target, block.id);
}
