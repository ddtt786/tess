/**
 * @fileoverview Entry-style user functions.
 *
 * A function is declared in its own workspace. The definition block carries the
 * name and the parameters, and the parameters are blocks: drag one out of the
 * header to use it in the body (a copy stays behind), drop one into the empty
 * slot to add it, throw one away to remove it.
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

export { DEFINE_BLOCK, PARAM_BOOLEAN, PARAM_TYPES, PARAM_VALUE } from './function-ids.ts';

interface ParamBlock extends Blockly.BlockSvg {
  paramId: string;
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
  return JSON.stringify(definition.blocks ?? {}).includes('"func_return"');
}

/** The two buttons on the definition block that add a parameter. */
const ADD_VALUE_ICON = plusIcon('<rect x="3" y="7" width="14" height="9" rx="4.5" />');
const ADD_BOOLEAN_ICON = plusIcon('<path d="M6.5 7h7l3 4.5-3 4.5h-7l-3-4.5z" />');

function plusIcon(shape: string): string {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22" fill="none" '
    + 'stroke="#ffffff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">'
    + `${shape}<path d="M10 1.5v4M8 3.5h4" /></svg>`,
  );
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
    init(this: Blockly.BlockSvg) {
      this.setStyle('func_blocks');
      this.setDeletable(false);
      this.setInputsInline(true);
      this.appendDummyInput('HEAD')
        .appendField('함수 정의하기')
        .appendField(new Blockly.FieldTextInput('함수'), 'NAME');
      this.appendDummyInput('OPEN').appendField('(');
      this.appendValueInput('ARG0').setCheck('FuncParam');
      this.appendDummyInput('CLOSE')
        .appendField(')')
        .appendField(
          new Blockly.FieldImage(ADD_VALUE_ICON, 22, 22, '값 매개변수 추가', () => addParamBlock(this, 'value')),
          'ADD_VALUE',
        )
        .appendField(
          new Blockly.FieldImage(ADD_BOOLEAN_ICON, 22, 22, '판단 매개변수 추가', () => addParamBlock(this, 'boolean')),
          'ADD_BOOLEAN',
        );
      this.appendStatementInput('BODY');
    },
    /** The header grows a slot per parameter, so the slots are part of the state. */
    saveExtraState(this: Blockly.BlockSvg) {
      return { slots: this.inputList.filter((input) => input.name.startsWith('ARG')).map((input) => input.name) };
    },
    loadExtraState(this: Blockly.BlockSvg, state: { slots?: string[] }) {
      for (const name of state?.slots ?? []) {
        nextSlot = Math.max(nextSlot, Number(name.slice(3)) + 1 || nextSlot);
        if (this.getInput(name)) continue;
        this.appendValueInput(name).setCheck('FuncParam');
        this.moveInputBefore(name, 'CLOSE');
      }
    },
  };

  tess.hatTypes.add(DEFINE_BLOCK);
  tess.forBlock[DEFINE_BLOCK] = (block, generator) => (generator as typeof tess).statementToCode(block, 'BODY');
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
    // Thrown away: the parameter goes with it, so the copy goes too.
    if (copy && this.block.isDisposed()) copy.dispose(false);
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
  const args = definition.params.map((param, index) => ({
    type: 'input_value',
    name: `ARG${index}`,
    ...(param.kind === 'boolean' ? { check: 'Boolean' } : {}),
  }));
  const message = `${definition.name}${definition.params.map((_, index) => ` %${index + 1}`).join('')}`;
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
  Blockly.common.defineBlocksWithJsonArray([json as never]);

  tess.forBlock[type] = (block, generator) => {
    const writer = generator as typeof tess;
    const values = definition.params.map((param, index) =>
      writer.expr(block, `ARG${index}`, Order.NONE, param.kind === 'boolean' ? 'false' : '0'),
    );
    const call = `${safeIdent(definition.name)}(${values.join(', ')})`;
    return asValue ? [call, Order.ATOMIC] : `${call}\n`;
  };
}
