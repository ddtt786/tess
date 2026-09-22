/**
 * @fileoverview The block description the whole catalog is written in.
 *
 * One spec produces three things: the Blockly block definition, its toolbox
 * entry with default sockets, and the Tess writer for it.
 */
import type * as Blockly from 'blockly/core';
import type { TessGenerator } from '../codegen/generator.ts';
import { Order, type OrderValue } from '../codegen/order.ts';

export type Category =
  | 'start' | 'flow' | 'moving' | 'looks' | 'brush' | 'sound'
  | 'judge' | 'calc' | 'data' | 'analysis' | 'text' | 'expansion' | 'func';

export type Shape = 'hat' | 'statement' | 'value' | 'boolean';

/** Where a dropdown's entries come from when the project decides them. */
export type DynamicSource =
  | 'object' | 'target' | 'lookTarget' | 'cloneTarget' | 'signal' | 'scene'
  | 'costume' | 'sound' | 'variable' | 'list' | 'table' | 'tableColumn' | 'key';

export type Arg =
  | { type: 'value'; name: string; fallback: string; order: OrderValue; shadow: ShadowSpec }
  | { type: 'bool'; name: string; fallback: string }
  | { type: 'statement'; name: string }
  | { type: 'number'; name: string; value: number; min?: number; max?: number }
  | { type: 'text'; name: string; value: string }
  | { type: 'dropdown'; name: string; options: Array<[string, string]> }
  | { type: 'dynamic'; name: string; source: DynamicSource }
  | { type: 'colour'; name: string; value: string }
  | { type: 'checkbox'; name: string; value: boolean };

export type ShadowSpec =
  | { kind: 'number'; value: number }
  | { kind: 'text'; value: string }
  | { kind: 'none' };

export type CodeArgs = Record<string, string>;

export type CodeFn = (
  args: CodeArgs,
  block: Blockly.Block,
  generator: TessGenerator,
) => string | [string, OrderValue];

export interface BlockSpec {
  type: string;
  category: Category;
  /** Blockly message with `%1` placeholders, one per arg in order. */
  message: string;
  args: Arg[];
  shape: Shape;
  /** Value blocks report the precedence of their outermost operator. */
  order?: OrderValue;
  inline?: boolean;
  tooltip?: string;
  /** Hidden from the palette — built by a menu or only restored from a file. */
  hidden?: boolean;
  code: CodeFn;
}

// --- argument helpers -------------------------------------------------------

/** A socket holding a number, with an inline default. */
export function numIn(name: string, value = 0, order: OrderValue = Order.NONE): Arg {
  return { type: 'value', name, fallback: String(value), order, shadow: { kind: 'number', value } };
}

/** A socket holding text, with an inline default. */
export function textIn(name: string, value = '', order: OrderValue = Order.NONE): Arg {
  return { type: 'value', name, fallback: JSON.stringify(value), order, shadow: { kind: 'text', value } };
}

/** A socket with no default block in it. */
export function emptyIn(name: string, fallback = '0', order: OrderValue = Order.NONE): Arg {
  return { type: 'value', name, fallback, order, shadow: { kind: 'none' } };
}

/** A hexagonal socket taking a judgement. */
export function boolIn(name: string, fallback = 'false'): Arg {
  return { type: 'bool', name, fallback };
}

export function stack(name = 'BODY'): Arg {
  return { type: 'statement', name };
}

export function numField(name: string, value = 0, min?: number, max?: number): Arg {
  return { type: 'number', name, value, min, max };
}

export function textField(name: string, value = ''): Arg {
  return { type: 'text', name, value };
}

export function menu(name: string, options: Array<[string, string]>): Arg {
  return { type: 'dropdown', name, options };
}

export function pick(name: string, source: DynamicSource): Arg {
  return { type: 'dynamic', name, source };
}

export function colourField(name: string, value = '#ff0000'): Arg {
  return { type: 'colour', name, value };
}

export function toggle(name: string, value = false): Arg {
  return { type: 'checkbox', name, value };
}

// --- catalog collection -----------------------------------------------------

const catalog: BlockSpec[] = [];

/** Adds specs to the catalog and hands them back for local use. */
export function define(...specs: BlockSpec[]): BlockSpec[] {
  catalog.push(...specs);
  return specs;
}

export function allSpecs(): BlockSpec[] {
  return catalog;
}

export function specsOf(category: Category): BlockSpec[] {
  return catalog.filter((spec) => spec.category === category && !spec.hidden);
}
