/**
 * @fileoverview The Blockly generator that writes Tess.
 *
 * Statement blocks return one line; C-blocks write their own `end`. Value
 * blocks return their code with the precedence of their outermost operator, so
 * a socket can decide whether it needs brackets around what it holds.
 */
import * as Blockly from 'blockly/core';
import { Order, type OrderValue } from './order.ts';

export class TessGenerator extends Blockly.CodeGenerator {
  /** Types whose stack is written by the block itself, not by `scrub_`. */
  readonly hatTypes = new Set<string>();

  constructor() {
    super('Tess');
    this.INDENT = '  ';
  }

  /** Code in a value socket, bracketed when it binds looser than `maxOrder`. */
  expr(block: Blockly.Block, name: string, maxOrder: OrderValue = Order.NONE, fallback = '0'): string {
    const target = block.getInputTargetBlock(name);
    if (!target) return fallback;
    const produced = this.blockToCode(target, true);
    const [code, order] = Array.isArray(produced)
      ? produced
      : [produced, Order.ATOMIC as OrderValue];
    if (!code) return fallback;
    return order > maxOrder ? `(${code})` : code;
  }

  /** A stack of statements, indented one level. */
  chain(block: Blockly.Block | null): string {
    if (!block) return '';
    const produced = this.blockToCode(block);
    const code = Array.isArray(produced) ? produced[0] : produced;
    return code ? this.prefixLines(code, this.INDENT) : '';
  }

  override scrub_(block: Blockly.Block, code: string, thisOnly?: boolean): string {
    if (thisOnly || this.hatTypes.has(block.type)) return code;
    const next = block.getNextBlock();
    if (!next) return code;
    const produced = this.blockToCode(next);
    return code + (Array.isArray(produced) ? produced[0] : produced);
  }
}

export const tess = new TessGenerator();

/** Every script in a workspace, in the order the blocks sit on the canvas. */
export function workspaceScripts(workspace: Blockly.Workspace): string[] {
  const scripts: string[] = [];
  for (const block of workspace.getTopBlocks(true)) {
    if (!tess.hatTypes.has(block.type)) continue;
    const produced = tess.blockToCode(block);
    const code = Array.isArray(produced) ? produced[0] : produced;
    if (code.trim()) scripts.push(code.trimEnd());
  }
  return scripts;
}
