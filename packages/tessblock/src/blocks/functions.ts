/**
 * @fileoverview Entry-style user functions.
 *
 * A function is declared in its own workspace: one definition block holding the
 * name, the parameters and the body. Every other workspace gets a call block
 * per function, built from the same record, plus a value form for a function
 * that returns something.
 */
import * as Blockly from 'blockly/core';
import { editingFunction } from '../model/function-editing.ts';
import { project } from '../model/store.ts';
import { tess } from '../codegen/generator.ts';
import { Order } from '../codegen/order.ts';
import { safeIdent } from '../codegen/ident.ts';
import type { FunctionDef, FunctionParam } from '../model/types.ts';

export const DEFINE_BLOCK = 'func_define';

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

export function defineFunctionBlocks(): void {
  Blockly.common.defineBlocksWithJsonArray([
    {
      type: 'func_param_value',
      message0: '%1',
      args0: [{ type: 'field_tess_dropdown', name: 'PARAM', source: 'param' }],
      output: 'Value',
      style: 'func_blocks',
    },
    {
      type: 'func_param_boolean',
      message0: '%1',
      args0: [{ type: 'field_tess_dropdown', name: 'PARAM', source: 'param' }],
      output: 'Boolean',
      style: 'func_blocks',
    },
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
  ]);

  const define = {
    init(this: Blockly.Block) {
      this.setStyle('func_blocks');
      this.setDeletable(false);
      this.setMovable(false);
      this.setInputsInline(true);
      this.appendDummyInput('HEAD')
        .appendField('함수 정의하기')
        .appendField(new Blockly.FieldTextInput('함수'), 'NAME');
      this.appendDummyInput('PARAMS');
      this.appendStatementInput('BODY');
      refreshParams(this as Blockly.BlockSvg, editingFunction.value?.params ?? []);
    },
    saveExtraState(this: Blockly.Block) {
      return {};
    },
    loadExtraState(this: Blockly.Block) {
      refreshParams(this, editingFunction.value?.params ?? []);
    },
  };
  (Blockly.Blocks as Record<string, unknown>)[DEFINE_BLOCK] = define;

  tess.hatTypes.add(DEFINE_BLOCK);
  tess.forBlock[DEFINE_BLOCK] = (block, generator) =>
    (generator as typeof tess).statementToCode(block, 'BODY');
  tess.forBlock['func_param_value'] = (block) => [paramName(block), Order.ATOMIC];
  tess.forBlock['func_param_boolean'] = (block) => [paramName(block), Order.ATOMIC];
  tess.forBlock['func_return'] = (block, generator) =>
    `return ${(generator as typeof tess).expr(block, 'VALUE', Order.NONE, '0')}\n`;
  tess.forBlock['func_local_var'] = (block, generator) => {
    const name = safeIdent(String(block.getFieldValue('NAME') ?? '값'));
    return `var ${name} = ${(generator as typeof tess).expr(block, 'VALUE', Order.NONE, '0')}\n`;
  };
}

/** The function whose parameters are being resolved while code is written. */
let paramContext: FunctionDef | null = null;

/** Points parameter blocks at one function's parameters while it is written. */
export function useParams(definition: FunctionDef | null): void {
  paramContext = definition;
}

/** The identifier a parameter block stands for. */
function paramName(block: Blockly.Block): string {
  const id = String(block.getFieldValue('PARAM') ?? '');
  const definition = paramContext ?? editingFunction.value;
  const param = definition?.params.find((candidate) => candidate.id === id);
  return safeIdent(param?.name ?? '값');
}

/** What the definition block does when its parameter fields are used. */
export interface ParamHandlers {
  rename(id: string, name: string): void;
  remove(id: string): void;
}

const CLOSE_ICON =
  'data:image/svg+xml;charset=utf-8,'
  + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14">'
    + '<path d="M4 4l6 6M10 4l-6 6" stroke="#ffffff" stroke-width="1.6" stroke-linecap="round" fill="none"/></svg>',
  );

let drawing = false;

/** Redraws the parameters on a definition block, editable in place. */
export function refreshParams(block: Blockly.Block, params: FunctionParam[], handlers?: ParamHandlers): void {
  const input = block.getInput('PARAMS');
  if (!input || drawing) return;
  drawing = true;
  try {
    drawParams(input, params, handlers);
  } finally {
    drawing = false;
  }
}

function drawParams(input: Blockly.Input, params: FunctionParam[], handlers?: ParamHandlers): void {
  for (const field of [...input.fieldRow]) input.removeField(field.name ?? '');
  input.appendField('(', 'PAREN_OPEN');
  params.forEach((param, index) => {
    if (index > 0) input.appendField(',', `COMMA_${index}`);
    const name = new Blockly.FieldTextInput(param.name, (value: string) => {
      handlers?.rename(param.id, value);
      return value;
    });
    input.appendField(name, `NAME_${param.id}`);
    if (param.kind === 'boolean') input.appendField('?', `MARK_${param.id}`);
    if (handlers) {
      input.appendField(
        new Blockly.FieldImage(CLOSE_ICON, 12, 12, '삭제', () => handlers.remove(param.id)),
        `DROP_${param.id}`,
      );
    }
  });
  input.appendField(')', 'PAREN_CLOSE');
}

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
