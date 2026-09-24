/**
 * @fileoverview Keeping placed function calls in step with their function.
 *
 * A call block's slots are made for particular parameters (ids, in order). When
 * a function gains, loses or reorders parameters, the slots of saved calls are
 * moved to where their parameters now stand. Plain JSON, no Blockly.
 */
import type { FunctionDef } from './types.ts';
import { copyDeep } from './json.ts';

/** What a call's slots depend on: the parameters, in order, with their kinds. */
export function signatureOf(definition: FunctionDef): string {
  return definition.params.map((param) => `${param.id}:${param.kind}`).join(',');
}

export type BlockJson = {
  type?: string;
  extraState?: Record<string, unknown>;
  inputs?: Record<string, { block?: BlockJson; shadow?: BlockJson }>;
  next?: { block?: BlockJson };
};

/** The function a call block type belongs to, or null. */
export function calledId(type: string | undefined): string | null {
  const match = type ? /^func_(?:call|value)_(.+)$/.exec(type) : null;
  return match ? match[1]! : null;
}

/** Slots of one call, moved to where their parameters now stand; `old` are the ids the slots were made for. */
export function remapSlots(state: BlockJson, old: string[], definition: FunctionDef): void {
  const inputs: Record<string, { block?: BlockJson; shadow?: BlockJson }> = {};
  definition.params.forEach((param, index) => {
    const from = old.indexOf(param.id);
    const kept = from >= 0 ? state.inputs?.[`ARG${from}`] : undefined;
    if (kept) inputs[`ARG${index}`] = kept;
    else if (param.kind !== 'boolean') inputs[`ARG${index}`] = { shadow: { type: 'calc_text', fields: { TEXT: '10' } } as BlockJson };
  });
  for (const [name, input] of Object.entries(state.inputs ?? {})) if (!name.startsWith('ARG')) inputs[name] = input;
  state.inputs = inputs;
  state.extraState = { ...state.extraState, params: definition.params.map((param) => param.id) };
}

/**
 * Rewrites saved scripts after functions changed their parameters. `before`
 * holds each changed function's old parameter ids; calls saved without their
 * own record are taken to have been made for those.
 */
export function remapSavedCalls(state: unknown, changed: Map<string, FunctionDef>, before: Map<string, string[]>): boolean {
  if (!state || !changed.size) return false;
  let touched = false;
  // A list, not recursion: a long stack nests each block under the one before it.
  const pending: Array<BlockJson | undefined> = [...((state as { blocks?: { blocks?: BlockJson[] } }).blocks?.blocks ?? [])];
  while (pending.length) {
    const block = pending.pop();
    if (!block) continue;
    const id = calledId(block.type);
    const definition = id ? changed.get(id) : undefined;
    if (definition) {
      const old = (block.extraState?.params as string[] | undefined) ?? before.get(definition.id) ?? [];
      remapSlots(block, old, definition);
      touched = true;
    }
    for (const input of Object.values(block.inputs ?? {})) pending.push(input.block, input.shadow);
    pending.push(block.next?.block);
  }
  return touched;
}

/**
 * Rewrites every saved script in `draft` for the functions whose parameters
 * differ from `previous`. Runs inside the update that changed them.
 */
export function remapProjectCalls(
  draft: { functions: FunctionDef[]; objects: Array<{ blocks: unknown }> },
  previous: FunctionDef[],
): void {
  const before = new Map(previous.map((definition) => [definition.id, definition]));
  const changed = new Map<string, FunctionDef>();
  const oldIds = new Map<string, string[]>();
  for (const definition of draft.functions) {
    const old = before.get(definition.id);
    if (!old || signatureOf(old) === signatureOf(definition)) continue;
    changed.set(definition.id, definition);
    oldIds.set(definition.id, old.params.map((param) => param.id));
  }
  if (!changed.size) return;
  // States are shared with the history, so a state is copied before it changes.
  for (const owner of [...draft.objects, ...draft.functions]) {
    if (!callsAny(owner.blocks, changed)) continue;
    const copy = copyDeep(owner.blocks);
    remapSavedCalls(copy, changed, oldIds);
    owner.blocks = copy;
  }
}

/** Whether a saved state calls any of the given functions. */
function callsAny(state: unknown, functions: Map<string, FunctionDef>): boolean {
  const pending: Array<BlockJson | undefined> = [...((state as { blocks?: { blocks?: BlockJson[] } } | null)?.blocks?.blocks ?? [])];
  while (pending.length) {
    const block = pending.pop();
    if (!block) continue;
    const id = calledId(block.type);
    if (id && functions.has(id)) return true;
    for (const input of Object.values(block.inputs ?? {})) pending.push(input.block, input.shadow);
    pending.push(block.next?.block);
  }
  return false;
}
