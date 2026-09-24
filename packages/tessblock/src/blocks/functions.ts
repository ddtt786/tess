/**
 * @fileoverview Entry-style user functions.
 *
 * A global function is declared in its own workspace; a local one by a
 * definition block dropped among its object's scripts. The definition block
 * carries the name and the parameters, and the parameters are blocks: drag one
 * out of the header to use it in the body (a copy stays behind), drop one into
 * the empty slot to add it, throw one away to remove it.
 */
import * as Blockly from 'blockly/core';
import { newId } from '../model/ids.ts';
import { project } from '../model/store.ts';
import { tess } from '../codegen/generator.ts';
import { Order } from '../codegen/order.ts';
import { safeIdent } from '../codegen/ident.ts';
import { FieldParamName, registerParamField } from './param-field.ts';
import { DEFINE_BLOCK, PARAM_BOOLEAN, PARAM_TYPES, PARAM_VALUE } from './function-ids.ts';
import type { FunctionDef, FunctionParam, FunctionParamKind } from '../model/types.ts';
import { calledId, remapSlots, type BlockJson } from '../model/call-remap.ts';
import { stringify } from '../model/json.ts';

export { DEFINE_BLOCK, PARAM_BOOLEAN, PARAM_TYPES, PARAM_VALUE } from './function-ids.ts';

interface ParamBlock extends Blockly.BlockSvg {
  paramId: string;
}

interface DefineBlock extends Blockly.BlockSvg {
  /** Id of the local function this block declares among an object's scripts. */
  fnId: string;
}

/** Call block types are derived from the function id, so they stay stable. */
export function callType(id: string): string {
  return `func_call_${id}`;
}

export function valueCallType(id: string): string {
  return `func_value_${id}`;
}

/** A function whose body holds a `return` can be used as a value. */
export function returnsValue(definition: FunctionDef): boolean {
  if (definition.inline) return !!definition.returns;
  return stringify(definition.blocks ?? {}).includes('"func_return"');
}

/** The two buttons on the definition block that add a parameter, shaped like the block each adds. */
const ADD_VALUE = paramButton(46, '＋ 값', (w) => `<rect x="1" y="1" width="${w - 2}" height="20" rx="10" />`);
const ADD_BOOLEAN = paramButton(
  58,
  '＋ 판단',
  (w) => `<path d="M8 1h${w - 16}l7 10-7 10H8L1 11z" />`,
);

function paramButton(width: number, label: string, shape: (width: number) => string): { url: string; width: number } {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="22" viewBox="0 0 ${width} 22">`
    + `<g fill="rgba(255,255,255,0.22)" stroke="#ffffff" stroke-width="1.4" stroke-linejoin="round">${shape(width)}</g>`
    + `<text x="${width / 2}" y="15.5" text-anchor="middle" fill="#ffffff" font-size="12" font-weight="700" `
    + `font-family="Pretendard, 'Noto Sans KR', 'Apple SD Gothic Neo', sans-serif">${label}</text></svg>`;
  return { url: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg), width };
}

export function defineFunctionBlocks(): void {
  registerParamField();
  Blockly.common.defineBlocksWithJsonArray([
    {
      type: 'func_return',
      message0: '%1 값 돌려주기',
      args0: [{ type: 'input_value', name: 'VALUE' }],
      previousStatement: null,
      style: 'func_blocks',
      inputsInline: true,
    },
    {
      type: 'func_local_var',
      message0: '지역 변수 %1 를 %2 로 정하기',
      args0: [
        { type: 'field_input', name: 'NAME', text: '값' },
        { type: 'input_value', name: 'VALUE' },
      ],
      previousStatement: null,
      nextStatement: null,
      style: 'func_blocks',
      inputsInline: true,
    },
    {
      type: 'func_local_get',
      message0: '지역 변수 %1 값',
      args0: [{ type: 'field_input', name: 'NAME', text: '값' }],
      output: 'Value',
      style: 'func_blocks',
      inputsInline: true,
    },
    {
      type: 'func_local_set',
      message0: '지역 변수 %1 를 %2 로 바꾸기',
      args0: [
        { type: 'field_input', name: 'NAME', text: '값' },
        { type: 'input_value', name: 'VALUE' },
      ],
      previousStatement: null,
      nextStatement: null,
      style: 'func_blocks',
      inputsInline: true,
    },
  ]);

  defineParamBlock(PARAM_VALUE, '값', ['Value', 'FuncParam']);
  defineParamBlock(PARAM_BOOLEAN, '판단', ['Boolean', 'FuncParam']);

  (Blockly.Blocks as Record<string, unknown>)[DEFINE_BLOCK] = {
    init(this: DefineBlock) {
      this.setStyle('func_blocks');
      this.setInputsInline(true);
      if (!this.fnId) this.fnId = newId('f');
      // Among an object's scripts it declares a local function; the function editor relabels its own.
      this.appendDummyInput('HEAD')
        .appendField('지역 함수 정의하기')
        .appendField(new Blockly.FieldTextInput('함수'), 'NAME');
      this.appendDummyInput('OPEN').appendField('(');
      this.appendValueInput('ARG0').setCheck('FuncParam');
      this.appendDummyInput('CLOSE')
        .appendField(')')
        .appendField(
          new Blockly.FieldImage(ADD_VALUE.url, ADD_VALUE.width, 22, '값 매개변수 추가', () => addParamBlock(this, 'value')),
          'ADD_VALUE',
        )
        .appendField(
          new Blockly.FieldImage(
            ADD_BOOLEAN.url, ADD_BOOLEAN.width, 22, '판단 매개변수 추가', () => addParamBlock(this, 'boolean'),
          ),
          'ADD_BOOLEAN',
        );
      this.appendStatementInput('BODY');
    },
    /** The header grows a slot per parameter, so the slots are part of the state. */
    saveExtraState(this: DefineBlock) {
      const slots = this.inputList.filter((input) => input.name.startsWith('ARG')).map((input) => input.name);
      // A copy taken from the palette must get an id of its own.
      return this.isInFlyout ? { slots } : { slots, fn: this.fnId };
    },
    loadExtraState(this: DefineBlock, state: { slots?: string[]; fn?: string }) {
      if (state?.fn) this.fnId = state.fn;
      for (const name of state?.slots ?? []) {
        nextSlot = Math.max(nextSlot, Number(name.slice(3)) + 1 || nextSlot);
        if (this.getInput(name)) continue;
        this.appendValueInput(name).setCheck('FuncParam');
        this.moveInputBefore(name, 'CLOSE');
      }
    },
  };

  tess.hatTypes.add(DEFINE_BLOCK);
  // Among an object's scripts the block is a whole declaration; the editor's
  // writer reads only the body (`functionLines`).
  tess.forBlock[DEFINE_BLOCK] = (block, generator) => {
    const params = readParams(block).map((param) => `${safeIdent(param.name)}${param.kind === 'boolean' ? '?' : ''}`);
    const name = safeIdent(String(block.getFieldValue('NAME') ?? '함수'));
    const body = (generator as typeof tess).statementToCode(block, 'BODY').replace(/\n+$/, '');
    return `function ${name}(${params.join(', ')}):\n${body ? `${body}\n` : ''}end\n`;
  };
  tess.forBlock[PARAM_VALUE] = (block) => [paramIdent(block), Order.ATOMIC];
  tess.forBlock[PARAM_BOOLEAN] = (block) => [paramIdent(block), Order.ATOMIC];
  tess.forBlock['func_return'] = (block, generator) =>
    `return ${(generator as typeof tess).expr(block, 'VALUE', Order.NONE, '0')}\n`;
  tess.forBlock['func_local_var'] = (block, generator) => {
    const name = safeIdent(String(block.getFieldValue('NAME') ?? '값'));
    return `var ${name} = ${(generator as typeof tess).expr(block, 'VALUE', Order.NONE, '0')}\n`;
  };
  tess.forBlock['func_local_get'] = (block) => [safeIdent(String(block.getFieldValue('NAME') ?? '값')), Order.ATOMIC];
  tess.forBlock['func_local_set'] = (block, generator) => {
    const name = safeIdent(String(block.getFieldValue('NAME') ?? '값'));
    return `${name} = ${(generator as typeof tess).expr(block, 'VALUE', Order.NONE, '0')}\n`;
  };
}

/**
 * Dragging a parameter out of the header leaves a copy behind, the way an
 * argument works in scratch. Dropping it in the bin takes the parameter away.
 *
 * This runs with the drag itself rather than from a change listener, so the
 * copy is there the moment the block lifts off.
 */
class ParamDragStrategy extends Blockly.dragging.BlockDragStrategy {
  private replacement: Blockly.BlockSvg | null = null;
  private header: Blockly.BlockSvg | null = null;

  override startDrag(event?: PointerEvent | KeyboardEvent): Blockly.IDraggable {
    const slot = this.block.outputConnection?.targetConnection ?? null;
    const define = slot?.getSourceBlock() ?? null;
    this.header = define?.type === DEFINE_BLOCK ? (define as Blockly.BlockSvg) : null;
    const dragged = super.startDrag(event);
    this.replacement = null;
    if (this.header && slot && !slot.targetBlock()) {
      const copy = cloneParam(this.block as ParamBlock);
      slot.connect(copy.outputConnection!);
      this.replacement = copy;
    }
    return dragged;
  }

  override endDrag(event: PointerEvent | KeyboardEvent | undefined, disposition: Blockly.DragDisposition): void {
    const copy = this.replacement;
    const header = this.header;
    super.endDrag(event, disposition);
    // Thrown away: the parameter goes with it, so the copy left in the header goes too.
    // The dragger disposes the block only after this returns, so the disposition is what tells.
    if (copy && !copy.isDisposed() && disposition === Blockly.DragDisposition.DELETE) copy.dispose(false);
    if (header && !header.isDisposed()) tidyHeader(header);
    this.replacement = null;
    this.header = null;
  }
}

/** A second block standing for the same parameter. */
function cloneParam(block: ParamBlock): Blockly.BlockSvg {
  const copy = block.workspace.newBlock(block.type) as ParamBlock;
  copy.paramId = block.paramId;
  copy.setFieldValue(block.getFieldValue('NAME'), 'NAME');
  copy.initSvg();
  copy.render();
  return copy;
}

/** Both parameter blocks are the same but for their shape and starting name. */
function defineParamBlock(type: string, label: string, output: string[]): void {
  (Blockly.Blocks as Record<string, unknown>)[type] = {
    init(this: ParamBlock) {
      this.setStyle('func_blocks');
      this.setOutput(true, output);
      this.appendDummyInput().appendField(new FieldParamName(label, renameParam), 'NAME');
      if (!this.paramId) this.paramId = newId('p');
      // Headless workspaces (the writer's) have no dragging at all.
      if (typeof (this as { setDragStrategy?: unknown }).setDragStrategy === 'function') {
        this.setDragStrategy(new ParamDragStrategy(this));
      }
    },
    /**
     * Zelos paints a reporter that holds a text field white, as if the block
     * were the input box. A parameter should read as one coloured chip until
     * it is opened for renaming, so its own colour is put back.
     */
    applyColour(this: Blockly.BlockSvg) {
      Blockly.BlockSvg.prototype.applyColour.call(this);
      const path = (this.pathObject as unknown as { svgPath?: SVGElement }).svgPath;
      path?.setAttribute('fill', this.getColour());
    },
    saveExtraState(this: ParamBlock) {
      return { param: this.paramId };
    },
    loadExtraState(this: ParamBlock, state: { param?: string }) {
      this.paramId = state?.param || this.paramId || newId('p');
    },
  };
}

/**
 * Renaming a parameter renames every block standing for it.
 *
 * Renaming one of those blocks runs this again from inside the first pass —
 * and each block still reads its old name until its own edit finishes, so the
 * passes would keep sending each other back and forth. One pass renames the
 * lot, so the rest stand aside.
 */
let renaming = false;

function renameParam(this: Blockly.Field, value: string): string {
  const block = this.getSourceBlock() as ParamBlock | null;
  const workspace = block?.workspace;
  if (renaming || !block || !workspace) return value;
  renaming = true;
  try {
    for (const other of workspace.getAllBlocks(false)) {
      const candidate = other as ParamBlock;
      if (other !== block && PARAM_TYPES.includes(other.type) && candidate.paramId === block.paramId) {
        if (other.getFieldValue('NAME') !== value) other.setFieldValue(value, 'NAME');
      }
    }
  } finally {
    renaming = false;
  }
  return value;
}

function paramIdent(block: Blockly.Block): string {
  return safeIdent(String(block.getFieldValue('NAME') ?? '값'));
}

export function paramIdOf(block: Blockly.Block): string {
  return (block as ParamBlock).paramId ?? '';
}

// --- local functions among an object's scripts ------------------------------

export function fnIdOf(block: Blockly.Block): string {
  return (block as DefineBlock).fnId ?? '';
}

/**
 * The local functions an object's scripts declare. A definition copied from
 * another (paste, duplicate) still carries that one's id, so repeats get a new one.
 */
export function inlineDefinitions(workspace: Blockly.Workspace, owner: string): FunctionDef[] {
  const taken = new Set(project.peek().functions
    .filter((definition) => definition.owner !== owner || !definition.inline)
    .map((definition) => definition.id));
  const out: FunctionDef[] = [];
  for (const block of workspace.getTopBlocks(true)) {
    if (block.type !== DEFINE_BLOCK) continue;
    const define = block as DefineBlock;
    if (!define.fnId || taken.has(define.fnId)) define.fnId = newId('f');
    taken.add(define.fnId);
    out.push({
      id: define.fnId,
      name: String(define.getFieldValue('NAME') ?? '함수').trim() || '함수',
      owner,
      params: readParams(define),
      blocks: null,
      inline: true,
      returns: define.getDescendants(false).some((each) => each.type === 'func_return'),
    });
  }
  return out;
}

/** Blocks that only mean something inside a function body. */
const BODY_ONLY = new Set(['func_return', 'func_local_var', 'func_local_get', 'func_local_set']);

/**
 * Greys out blocks that cannot work where they stand: parameter blocks used
 * outside the function they belong to (under another function's definition or
 * in an ordinary script), since they would read a value that is not there, and
 * `return` or function-local variables outside any function body. Header slots
 * are the parameters themselves.
 */
export function markForeignParams(workspace: Blockly.Workspace): void {
  for (const block of workspace.getAllBlocks(false)) {
    if (block.isInFlyout) continue;
    let fits: boolean;
    if (PARAM_TYPES.includes(block.type)) {
      const root = block.getRootBlock();
      fits = root.type === DEFINE_BLOCK && readParams(root).some((param) => param.id === paramIdOf(block));
    } else if (BODY_ONLY.has(block.type)) {
      fits = block.getRootBlock().type === DEFINE_BLOCK;
    } else {
      continue;
    }
    if (block.hasDisabledReason(FOREIGN_PARAM) === !fits) continue;
    block.setDisabledReason(!fits, FOREIGN_PARAM);
  }
}

const FOREIGN_PARAM = 'tess_foreign_param';

/** Call blocks already placed show a renamed function's new name. */
export function relabelCalls(workspace: Blockly.Workspace, definitions: FunctionDef[]): void {
  const names = new Map<string, string>();
  for (const definition of definitions) {
    names.set(callType(definition.id), definition.name);
    names.set(valueCallType(definition.id), definition.name);
  }
  for (const block of workspace.getAllBlocks(false)) {
    const name = names.get(block.type);
    const label = name === undefined ? null : block.inputList[0]?.fieldRow[0];
    if (label && label.getValue() !== shortLabel(name!)) label.setValue(shortLabel(name!));
  }
}

// --- the header -------------------------------------------------------------

/** Parameters the definition block is carrying, in slot order. */
export function readParams(define: Blockly.Block): FunctionParam[] {
  const params: FunctionParam[] = [];
  for (const input of define.inputList) {
    if (!input.name.startsWith('ARG')) continue;
    const block = input.connection?.targetBlock();
    if (!block || !PARAM_TYPES.includes(block.type)) continue;
    params.push({
      id: paramIdOf(block),
      name: String(block.getFieldValue('NAME') ?? '값'),
      kind: block.type === PARAM_BOOLEAN ? 'boolean' : 'value',
    });
  }
  return params;
}

/**
 * Keeps exactly one empty slot at the end of the header, so there is always
 * somewhere to drop the next parameter.
 *
 * Only empty slots are ever removed. Taking a filled input out would take the
 * parameter block with it, and a parameter must survive being dragged into the
 * body — that is the whole point of dragging it there.
 */
export function tidyHeader(define: Blockly.BlockSvg): void {
  const slots = () => define.inputList.filter((input) => input.name.startsWith('ARG'));
  const empty = slots().filter((input) => !input.connection?.targetBlock());
  for (const input of empty.slice(0, -1)) define.removeInput(input.name, true);

  const current = slots();
  const last = current[current.length - 1];
  if (last && !last.connection?.targetBlock()) return;

  const name = `ARG${nextSlot}`;
  nextSlot += 1;
  define.appendValueInput(name).setCheck('FuncParam');
  define.moveInputBefore(name, 'CLOSE');
}

/** Slot names only have to be unique; their order comes from `inputList`. */
let nextSlot = 1;

/** Adds a parameter block to the end of the header. */
export function addParamBlock(define: Blockly.BlockSvg, kind: FunctionParamKind): void {
  const workspace = define.workspace;
  const used = readParams(define).filter((param) => param.kind === kind).length + 1;
  const block = workspace.newBlock(kind === 'boolean' ? PARAM_BOOLEAN : PARAM_VALUE) as ParamBlock;
  block.setFieldValue(kind === 'boolean' ? `판단${used}` : `값${used}`, 'NAME');
  block.initSvg();
  block.render();
  const empty = define.inputList.find((input) => input.name.startsWith('ARG') && !input.connection?.targetBlock());
  empty?.connection?.connect(block.outputConnection!);
  tidyHeader(define);
  // A block built in code is not announced by blockly. The editor follows these
  // events to keep the palette and the saved parameters in step.
  Blockly.Events.fire(new Blockly.Events.BlockCreate(block));
}

// --- call blocks ------------------------------------------------------------

/** Registers a call block for every function given, or every one in the project. */
export function syncFunctionBlocks(functions: FunctionDef[] = project.peek().functions): void {
  for (const definition of functions) {
    defineCallBlock(definition, false);
    if (returnsValue(definition)) defineCallBlock(definition, true);
  }
}

function defineCallBlock(definition: FunctionDef, asValue: boolean): void {
  const type = asValue ? valueCallType(definition.id) : callType(definition.id);
  // Past a few arguments the slots wrap onto further rows, so the block stays about as wide as a short one.
  const wrap = definition.params.length > ARGS_BEFORE_WRAP + 1;
  const args: Array<Record<string, unknown>> = [];
  definition.params.forEach((param, index) => {
    if (wrap && index > 0 && index % ARGS_BEFORE_WRAP === 0) args.push({ type: 'input_end_row', name: `ROW${index}` });
    args.push({ type: 'input_value', name: `ARG${index}`, ...(param.kind === 'boolean' ? { check: 'Boolean' } : {}) });
  });
  const message = `${shortLabel(definition.name)}${args.map((_, index) => ` %${index + 1}`).join('')}`;
  const json: Record<string, unknown> = {
    type,
    message0: message,
    args0: args,
    style: 'func_blocks',
    inputsInline: true,
  };
  if (asValue) json.output = 'Value';
  else {
    json.previousStatement = null;
    json.nextStatement = null;
  }
  const ids = definition.params.map((param) => param.id);
  // Each call remembers which parameter each slot was made for, so its slots
  // can follow the function when parameters are added, removed or reordered.
  (Blockly.Blocks as Record<string, unknown>)[type] = {
    init(this: CallBlock) {
      this.jsonInit(json);
      this.paramIds = ids;
    },
    saveExtraState(this: CallBlock) {
      return { params: this.paramIds };
    },
    loadExtraState(this: CallBlock, state: { params?: string[] }) {
      if (state?.params) this.paramIds = state.params;
    },
  };

  tess.forBlock[type] = (block, generator) => {
    const writer = generator as typeof tess;
    const values = definition.params.map((param, index) =>
      writer.expr(block, `ARG${index}`, Order.NONE, param.kind === 'boolean' ? 'false' : '0'),
    );
    const call = `${safeIdent(definition.name)}(${values.join(', ')})`;
    return asValue ? [call, Order.ATOMIC] : `${call}\n`;
  };
}

interface CallBlock extends Blockly.BlockSvg {
  paramIds: string[];
}

// --- keeping placed calls in step with their function -----------------------

/** Rebuilds placed call blocks whose slots were made for other parameters than their function has now. */
export function refreshCallBlocks(workspace: Blockly.WorkspaceSvg, functions: FunctionDef[]): void {
  const byId = new Map(functions.map((definition) => [definition.id, definition]));
  const stale = workspace.getAllBlocks(false).filter((block) => {
    const definition = byId.get(calledId(block.type) ?? '');
    if (!definition || block.isInFlyout) return false;
    const have = (block as CallBlock).paramIds ?? [];
    return have.join(',') !== definition.params.map((param) => param.id).join(',')
      || block.inputList.filter((input) => input.name.startsWith('ARG')).length !== definition.params.length;
  }) as CallBlock[];
  if (!stale.length) return;
  Blockly.Events.setGroup(true);
  try {
    for (const block of stale) {
      if (block.isDisposed()) continue;
      const definition = byId.get(calledId(block.type)!)!;
      const state = Blockly.serialization.blocks.save(block, { addCoordinates: true, addNextBlocks: false }) as BlockJson;
      remapSlots(state, block.paramIds ?? [], definition);
      const parent = block.outputConnection?.targetConnection ?? block.previousConnection?.targetConnection ?? null;
      const next = block.nextConnection?.targetBlock() ?? null;
      if (next) block.nextConnection!.disconnect();
      block.dispose(false);
      const fresh = Blockly.serialization.blocks.append(state as never, workspace) as Blockly.BlockSvg;
      const own = fresh.outputConnection ?? fresh.previousConnection;
      if (parent && own) parent.connect(own);
      if (next?.previousConnection && fresh.nextConnection) fresh.nextConnection.connect(next.previousConnection);
    }
  } finally {
    Blockly.Events.setGroup(false);
  }
}

/** Argument slots on one row of a call block before the rest wrap below. */
const ARGS_BEFORE_WRAP = 3;

/** Longest name a call block spells out; the palette would otherwise grow as wide as the name. */
const LABEL_LIMIT = 20;

function shortLabel(name: string): string {
  const letters = [...name];
  return letters.length > LABEL_LIMIT ? `${letters.slice(0, LABEL_LIMIT - 1).join('')}…` : name;
}
