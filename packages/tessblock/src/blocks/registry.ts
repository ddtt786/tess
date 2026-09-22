/**
 * @fileoverview Turns the catalog into Blockly blocks, writers and a palette.
 *
 * Every spec produces one block definition and one generator entry; the
 * palette is rebuilt from the same specs plus whatever the project holds now.
 */
import * as Blockly from 'blockly/core';
import * as Ko from 'blockly/msg/ko';
import { tess } from '../codegen/generator.ts';
import { Order } from '../codegen/order.ts';
import { editingFunction } from '../model/function-editing.ts';
import { project } from '../model/store.ts';
import { installContextMenu } from './context-menu.ts';
import { registerColourPicker } from './colour-field.ts';
import { registerFields } from './fields.ts';
import { defineFunctionBlocks, callType, returnsValue, syncFunctionBlocks, valueCallType } from './functions.ts';
import { CATEGORY_LABELS, CATEGORY_ORDER, installCategoryStyles, tessTheme } from './theme.ts';
import { allSpecs, specsOf, type Arg, type BlockSpec, type CodeArgs, type Category } from './spec.ts';
import { resolveDynamic } from '../codegen/refs.ts';

import './catalog/start.ts';
import './catalog/flow.ts';
import './catalog/moving.ts';
import './catalog/looks.ts';
import './catalog/brush.ts';
import './catalog/sound.ts';
import './catalog/judge.ts';
import './catalog/calc.ts';
import './catalog/data.ts';
import './catalog/analysis.ts';
import './catalog/text.ts';
import './catalog/expansion.ts';

export { tessTheme };

let ready = false;

/** Defines every block and writer once, before any workspace is injected. */
export function installBlocks(): void {
  if (ready) return;
  ready = true;
  Blockly.setLocale(Ko as unknown as Record<string, string>);
  installCategoryStyles();
  registerColourPicker();
  registerFields();
  installContextMenu();

  const definitions = allSpecs().map(blockDefinition);
  Blockly.common.defineBlocksWithJsonArray(definitions as never[]);
  for (const spec of allSpecs()) registerWriter(spec);

  defineFunctionBlocks();
  syncFunctionBlocks();
  // A saved function needs its call block before any palette asks for it.
  project.subscribe((model) => syncFunctionBlocks(model.functions));
}

function blockDefinition(spec: BlockSpec): Record<string, unknown> {
  const json: Record<string, unknown> = {
    type: spec.type,
    style: `${spec.category}_blocks`,
    inputsInline: spec.inline ?? true,
    tooltip: spec.tooltip ?? '',
  };
  layoutRows(spec).forEach((row, index) => {
    json[`message${index}`] = row.message;
    json[`args${index}`] = row.args.map(argDefinition);
  });
  switch (spec.shape) {
    case 'hat':
      json.nextStatement = null;
      break;
    case 'statement':
      json.previousStatement = null;
      json.nextStatement = null;
      break;
    case 'value':
      json.output = 'Value';
      break;
    case 'boolean':
      json.output = 'Boolean';
      break;
  }
  return json;
}

interface Row {
  message: string;
  args: Arg[];
}

/**
 * Splits a spec's message into Blockly rows.
 *
 * A statement input takes a row of its own, so the words around it stay on the
 * line above it instead of being pushed under the notch.
 */
function layoutRows(spec: BlockSpec): Row[] {
  const rows: Row[] = [];
  let message = '';
  let args: Arg[] = [];

  const flush = () => {
    if (message.trim() || args.length) rows.push({ message: message.trim(), args });
    message = '';
    args = [];
  };

  for (const part of spec.message.split(/(%\d+)/)) {
    const placeholder = /^%(\d+)$/.exec(part);
    if (!placeholder) {
      message += part;
      continue;
    }
    const arg = spec.args[Number(placeholder[1]) - 1];
    if (!arg) continue;
    if (arg.type === 'statement') {
      flush();
      rows.push({ message: '%1', args: [arg] });
      continue;
    }
    args.push(arg);
    message += `%${args.length}`;
  }
  flush();
  return rows.length ? rows : [{ message: spec.message, args: [] }];
}

function argDefinition(arg: Arg): Record<string, unknown> {
  switch (arg.type) {
    case 'value':
      return { type: 'input_value', name: arg.name };
    case 'bool':
      return { type: 'input_value', name: arg.name, check: 'Boolean' };
    case 'statement':
      return { type: 'input_statement', name: arg.name };
    case 'number':
      return { type: 'field_number', name: arg.name, value: arg.value, min: arg.min, max: arg.max };
    case 'text':
      return { type: 'field_input', name: arg.name, text: arg.value };
    case 'dropdown':
      return { type: 'field_dropdown', name: arg.name, options: arg.options };
    case 'dynamic':
      return { type: 'field_tess_dropdown', name: arg.name, source: arg.source };
    case 'colour':
      return { type: 'field_colour_picker', name: arg.name, colour: arg.value };
    case 'checkbox':
      return { type: 'field_checkbox', name: arg.name, checked: arg.value };
  }
}

function registerWriter(spec: BlockSpec): void {
  if (spec.shape === 'hat') tess.hatTypes.add(spec.type);
  tess.forBlock[spec.type] = (block, generator) => {
    const writer = generator as typeof tess;
    const args: CodeArgs = {};
    for (const arg of spec.args) {
      switch (arg.type) {
        case 'value':
        case 'bool':
          args[arg.name] = writer.expr(
            block,
            arg.name,
            arg.type === 'value' ? arg.order : Order.NONE,
            arg.fallback,
          );
          break;
        case 'statement':
          args[arg.name] = writer.statementToCode(block, arg.name);
          break;
        case 'dynamic':
          args[arg.name] = resolveDynamic(arg.source, String(block.getFieldValue(arg.name) ?? ''));
          break;
        default:
          args[arg.name] = String(block.getFieldValue(arg.name) ?? '');
      }
    }
    if (spec.shape === 'hat') args.BODY = writer.chain(block.getNextBlock());
    const produced = spec.code(args, block, writer);
    if (spec.shape === 'value' || spec.shape === 'boolean') {
      return Array.isArray(produced) ? produced : [produced, spec.order ?? Order.ATOMIC];
    }
    return `${Array.isArray(produced) ? produced[0] : produced}\n`;
  };
}

// --- palette ----------------------------------------------------------------

interface FlyoutBlock {
  kind: 'block';
  type: string;
  fields?: Record<string, unknown>;
  extraState?: Record<string, unknown>;
  inputs?: Record<string, unknown>;
}

type FlyoutItem =
  | FlyoutBlock
  | { kind: 'button'; text: string; callbackkey: string }
  | { kind: 'label'; text: string }
  | { kind: 'sep'; gap: number };

export const TOOLBOX = {
  kind: 'categoryToolbox',
  contents: CATEGORY_ORDER.map((category) => ({
    kind: 'category',
    name: CATEGORY_LABELS[category],
    categorystyle: `${category}_category`,
    custom: `TESS_${category}`,
  })),
};

/** Palette entries for one category, rebuilt every time it opens. */
export function flyoutFor(category: Category): FlyoutItem[] {
  const items: FlyoutItem[] = [];
  if (category === 'start') items.push({ kind: 'button', text: '＋ 신호 만들기', callbackkey: 'NEW_SIGNAL' });
  if (category === 'data') {
    items.push({ kind: 'button', text: '＋ 변수 만들기', callbackkey: 'NEW_VARIABLE' });
    items.push({ kind: 'button', text: '＋ 리스트 만들기', callbackkey: 'NEW_LIST' });
  }
  if (category === 'analysis') items.push({ kind: 'button', text: '＋ 테이블 만들기', callbackkey: 'NEW_TABLE' });
  if (category === 'func') {
    const editing = editingFunction.value;
    if (editing) {
      // Only the parameters this function has. New ones come from the ＋ on the
      // definition block, so the palette never offers a nameless one.
      for (const param of editing.params) {
        items.push({
          kind: 'block',
          type: param.kind === 'boolean' ? 'func_param_boolean' : 'func_param_value',
          fields: { NAME: param.name },
          extraState: { param: param.id },
        });
      }
      items.push({ kind: 'block', type: 'func_return' });
    } else {
      items.push({ kind: 'button', text: '＋ 함수 만들기', callbackkey: 'NEW_FUNCTION' });
      for (const definition of project.value.functions) {
        items.push({ kind: 'block', type: callType(definition.id) });
        if (returnsValue(definition)) items.push({ kind: 'block', type: valueCallType(definition.id) });
      }
    }
    items.push({ kind: 'block', type: 'func_local_var' });
  }
  for (const spec of specsOf(category)) items.push(blockEntry(spec));
  return items;
}

/** Palette entries matching a search, taken from every category at once. */
export function searchFlyout(query: string): FlyoutItem[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const items: FlyoutItem[] = [];
  for (const spec of allSpecs()) {
    if (spec.hidden) continue;
    if (terms.every((term) => searchText(spec).includes(term))) items.push(blockEntry(spec));
  }
  for (const definition of project.value.functions) {
    const name = definition.name.toLowerCase();
    if (!terms.every((term) => name.includes(term) || '함수'.includes(term))) continue;
    items.push({ kind: 'block', type: callType(definition.id) });
    if (returnsValue(definition)) items.push({ kind: 'block', type: valueCallType(definition.id) });
  }
  return items.length ? items : [{ kind: 'label', text: '찾는 블록이 없습니다' }];
}

const searchIndex = new Map<string, string>();

/** What a block can be found by: its wording, its category and its menus. */
function searchText(spec: BlockSpec): string {
  const cached = searchIndex.get(spec.type);
  if (cached !== undefined) return cached;
  const words = [spec.message.replace(/%\d+/g, ' '), CATEGORY_LABELS[spec.category], spec.type];
  for (const arg of spec.args) {
    if (arg.type === 'dropdown') words.push(...arg.options.map(([label]) => label));
  }
  const text = words.join(' ').toLowerCase();
  searchIndex.set(spec.type, text);
  return text;
}

function blockEntry(spec: BlockSpec): FlyoutBlock {
  const entry: FlyoutBlock = { kind: 'block', type: spec.type };
  const inputs: Record<string, unknown> = {};
  for (const arg of spec.args) {
    if (arg.type !== 'value' || arg.shadow.kind === 'none') continue;
    inputs[arg.name] = arg.shadow.kind === 'number'
      ? { shadow: { type: 'calc_number', fields: { NUM: arg.shadow.value } } }
      : { shadow: { type: 'calc_text', fields: { TEXT: arg.shadow.value } } };
  }
  if (Object.keys(inputs).length) entry.inputs = inputs;
  return entry;
}
