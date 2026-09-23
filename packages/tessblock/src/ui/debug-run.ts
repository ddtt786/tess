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
import { project } from '../model/store.ts';
import { debugRequest } from './state.ts';

/** Starts the stage on `block` and the blocks under it; a hat runs its body. */
export function runStack(block: Blockly.BlockSvg, objectId: string): void {
  const model = project.peek();
  const object = model.objects.find((candidate) => candidate.id === objectId);
  if (!object) return;
  const saved = Blockly.serialization.blocks.save(block, { addNextBlocks: true, addCoordinates: false }) as
    Blockly.serialization.blocks.State;
  const body = tess.hatTypes.has(block.type) ? saved.next?.block : saved;
  if (!body) return;

  const holder = new Blockly.Workspace();
  try {
    Blockly.serialization.blocks.append({ type: 'start_when_run', x: 0, y: 0, next: { block: body } }, holder, {
      recordUndo: false,
    });
    const quiet = { ...model, objects: model.objects.map((each) => ({ ...each, blocks: null })) };
    const source = buildSource(quiet, { live: new Map([[objectId, holder]]) });
    const scene = model.scenes.find((candidate) => candidate.id === object.sceneId)?.name ?? '';
    debugRequest.value = { source, scene, label: object.name };
  } finally {
    holder.dispose();
  }
}
