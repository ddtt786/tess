/**
 * @fileoverview tree-sitter syntax tree → the AST the Chevrotain visitor builds.
 *
 * Every function here mirrors a method of `parser/visitor.ts`; the two must
 * produce identical nodes, locations included (`test/tree-sitter.test.ts`
 * compares them over the example corpus).
 */
import { normalizeColor } from '@tess/core';
import { decodeString } from '../parser/strings.ts';
import type {
  BooleanNode, Expr, Identifier, Loc, NullaryStatementType, NumberNode, ProgramNode, Stmt, StringNode,
} from '../ast.ts';

/** The part of a web-tree-sitter node the converter reads. */
export interface SyntaxNode {
  type: string;
  startIndex: number;
  endIndex: number;
  isNamed: boolean;
  childCount: number;
  child(index: number): SyntaxNode | null;
  childForFieldName(name: string): SyntaxNode | null;
  childrenForFieldName(name: string): (SyntaxNode | null)[];
}

/** The part of a web-tree-sitter cursor `plainTree` reads. */
export interface SyntaxCursor {
  readonly nodeTypeId: number;
  readonly currentFieldId: number;
  readonly startIndex: number;
  readonly endIndex: number;
  gotoFirstChild(): boolean;
  gotoNextSibling(): boolean;
  gotoParent(): boolean;
}

/** The part of a web-tree-sitter language `plainTree` reads. */
export interface SyntaxLanguage {
  readonly types: readonly (string | null | undefined)[];
  readonly fields: readonly (string | null | undefined)[];
  nodeTypeIsNamed(typeId: number): boolean;
}

/** A syntax node copied out of the wasm heap; reading it costs no boundary crossings. */
class PlainNode implements SyntaxNode {
  readonly children: PlainNode[] = [];
  readonly fieldNames: (string | null)[] = [];
  readonly type: string;
  startIndex: number;
  endIndex: number;
  readonly isNamed: boolean;

  constructor(type: string, startIndex: number, endIndex: number, isNamed: boolean) {
    this.type = type;
    this.startIndex = startIndex;
    this.endIndex = endIndex;
    this.isNamed = isNamed;
  }

  get childCount() {
    return this.children.length;
  }

  child(index: number) {
    return this.children[index] ?? null;
  }

  childForFieldName(name: string) {
    const at = this.fieldNames.indexOf(name);
    return at < 0 ? null : this.children[at]!;
  }

  childrenForFieldName(name: string) {
    const out: PlainNode[] = [];
    for (let at = 0; at < this.fieldNames.length; at += 1) if (this.fieldNames[at] === name) out.push(this.children[at]!);
    return out;
  }
}

const namedTypes = new WeakMap<SyntaxLanguage, boolean[]>();

/**
 * Copies the tree under `cursor` in one walk. Positions are read on leaves
 * only; an inner node spans exactly its children.
 */
export function plainTree(cursor: SyntaxCursor, language: SyntaxLanguage): SyntaxNode {
  let named = namedTypes.get(language);
  if (!named) {
    named = language.types.map((_, id) => language.nodeTypeIsNamed(id));
    namedTypes.set(language, named);
  }
  const { types, fields } = language;
  const make = (typeId: number) => new PlainNode(types[typeId] ?? '', 0, 0, named[typeId] ?? false);
  const close = (node: PlainNode) => {
    const { children } = node;
    node.startIndex = children[0]!.startIndex;
    node.endIndex = children[children.length - 1]!.endIndex;
  };
  const root = make(cursor.nodeTypeId);
  if (!cursor.gotoFirstChild()) {
    root.startIndex = cursor.startIndex;
    root.endIndex = cursor.endIndex;
    return root;
  }
  const stack: PlainNode[] = [root];
  for (;;) {
    const node = make(cursor.nodeTypeId);
    const parent = stack[stack.length - 1]!;
    parent.children.push(node);
    parent.fieldNames.push(fields[cursor.currentFieldId] ?? null);
    if (cursor.gotoFirstChild()) {
      stack.push(node);
      continue;
    }
    node.startIndex = cursor.startIndex;
    node.endIndex = cursor.endIndex;
    while (!cursor.gotoNextSibling()) {
      close(stack.pop()!);
      if (!stack.length || !cursor.gotoParent()) {
        return root;
      }
    }
  }
}

type AnyNode = any;

let source = '';

const text = (node: SyntaxNode) => source.slice(node.startIndex, node.endIndex);

/** First and last real token under a node; comments tree-sitter tucks inside do not count. */
function firstToken(node: SyntaxNode): SyntaxNode {
  if (!node.childCount) return node;
  for (let at = 0; at < node.childCount; at += 1) {
    const child = node.child(at)!;
    if (child.type !== 'comment' && child.endIndex > child.startIndex) return firstToken(child);
  }
  return node;
}

function lastToken(node: SyntaxNode): SyntaxNode {
  if (!node.childCount) return node;
  for (let at = node.childCount - 1; at >= 0; at -= 1) {
    const child = node.child(at)!;
    if (child.type !== 'comment' && child.endIndex > child.startIndex) return lastToken(child);
  }
  return node;
}

const loc = (node: SyntaxNode): Loc => ({ start: firstToken(node).startIndex, end: lastToken(node).endIndex });
const tokenLoc = (node: SyntaxNode): Loc => ({ start: node.startIndex, end: node.endIndex });

const field = (node: SyntaxNode, name: string) => node.childForFieldName(name);
const fields = (node: SyntaxNode, name: string) => node.childrenForFieldName(name).filter((each): each is SyntaxNode => each !== null);
const has = (node: SyntaxNode, name: string) => node.childForFieldName(name) !== null;

/** Whether a keyword token appears among the node's direct children. */
function hasToken(node: SyntaxNode, word: string): boolean {
  for (let at = 0; at < node.childCount; at += 1) if (node.child(at)!.type === word) return true;
  return false;
}

const stringNode = (node: SyntaxNode): StringNode => ({ type: 'String', value: decodeString(text(node)), loc: tokenLoc(node) });

const numberNode = (node: SyntaxNode): NumberNode => {
  const image = text(node);
  return { type: 'Number', value: image.includes('.') ? parseFloat(image) : parseInt(image, 10), loc: tokenLoc(node) };
};

const identifier = (node: SyntaxNode): Identifier => ({ type: 'Identifier', name: text(node), loc: tokenLoc(node) });

/** Converts a whole program. `root` must be free of errors. */
export function programFromTree(root: SyntaxNode, input: string): ProgramNode {
  source = input;
  const body: AnyNode[] = [];
  let start = -1;
  for (let at = 0; at < root.childCount; at += 1) {
    const child = root.child(at)!;
    if (child.type === 'comment') continue;
    if (start < 0) start = firstToken(child).startIndex;
    body.push(item(child));
  }
  return { type: 'Program', body, loc: { start: start >= 0 ? start : input.length, end: input.length } };
}

function item(node: SyntaxNode): AnyNode {
  switch (node.type) {
    case 'project_decl': return {
      type: 'Project',
      fields: named(node).filter((child) => child.type === 'project_field').map(projectField),
      loc: loc(node),
    };
    case 'scene_decl': return {
      type: 'Scene',
      name: decodeString(text(field(node, 'name')!)),
      body: named(node).filter((child) => SCENE_MEMBERS.has(child.type)).map(sceneMember),
      loc: loc(node),
    };
    case 'object_decl': return objectDecl(node);
    case 'function_decl': return functionDecl(node);
    case 'use_object_decl': return {
      type: 'UseObject',
      kind: text(field(node, 'kind')!) === 'useobject' ? 'object' : 'text',
      path: decodeString(text(field(node, 'path')!)),
      loc: loc(node),
    };
    case 'use_decl': return { type: 'Use', path: decodeString(text(field(node, 'path')!)), loc: loc(node) };
    case 'var_decl': return varDecl(node);
    case 'list_decl': return listDecl(node);
    case 'table_decl': return tableDecl(node);
    default: throw new Error(`unexpected ${node.type}`);
  }
}

const SCENE_MEMBERS = new Set(['object_decl', 'use_object_decl', 'use_decl', 'scene_name_decl']);

/** Named children, comments left out. */
function named(node: SyntaxNode): SyntaxNode[] {
  const out: SyntaxNode[] = [];
  for (let at = 0; at < node.childCount; at += 1) {
    const child = node.child(at)!;
    if (child.type !== 'comment' && /^[a-z_]+$/.test(child.type) && isNamed(child)) out.push(child);
  }
  return out;
}

function isNamed(node: SyntaxNode): boolean {
  return node.isNamed;
}

function projectField(node: SyntaxNode): AnyNode {
  const textNode = field(node, 'text');
  return {
    type: 'ProjectField',
    field: text(field(node, 'field')!),
    value: textNode ? stringNode(textNode) : numberNode(field(node, 'number')!),
    loc: loc(node),
  };
}

function sceneMember(node: SyntaxNode): AnyNode {
  if (node.type === 'scene_name_decl') {
    return { type: 'Property', name: 'name', value: stringNode(field(node, 'text')!), loc: loc(node) };
  }
  return item(node);
}

function objectDecl(node: SyntaxNode): AnyNode {
  return {
    type: 'Object',
    kind: text(field(node, 'kind')!),
    name: decodeString(text(field(node, 'name')!)),
    body: named(node).filter((child) => child.type === 'object_member').map(objectMember),
    loc: loc(node),
  };
}

function objectMember(member: SyntaxNode): AnyNode {
  const node = named(member)[0]!;
  switch (node.type) {
    case 'var_decl': return varDecl(node);
    case 'list_decl': return listDecl(node);
    case 'function_decl': return functionDecl(node);
    case 'event_handler': return eventHandler(node);
    case 'use_decl': return item(node);
    case 'costume_property': return {
      type: 'Costume',
      id: text(field(node, 'id')!),
      displayName: has(node, 'display_name') ? displayName(field(node, 'display_name')!) : null,
      file: decodeString(text(field(node, 'file')!)),
      isDefault: has(node, 'is_default'),
      width: has(node, 'width') ? numberNode(field(node, 'width')!).value : null,
      height: has(node, 'height') ? numberNode(field(node, 'height')!).value : null,
      forceId: has(node, 'force_id') ? decodeString(text(field(field(node, 'force_id')!, 'text')!)) : null,
      loc: loc(member),
    };
    case 'sound_property': return {
      type: 'Sound',
      id: text(field(node, 'id')!),
      displayName: has(node, 'display_name') ? displayName(field(node, 'display_name')!) : null,
      file: decodeString(text(field(node, 'file')!)),
      duration: has(node, 'duration') ? numberNode(field(node, 'duration')!).value : null,
      forceId: has(node, 'force_id') ? decodeString(text(field(field(node, 'force_id')!, 'text')!)) : null,
      loc: loc(member),
    };
    case 'name_property': return { type: 'Property', name: 'name', value: stringNode(field(node, 'text')!), loc: loc(member) };
    case 'flag_property': return {
      type: 'Property', name: text(field(node, 'flag')!), value: booleanNode(field(node, 'value')!), loc: loc(member),
    };
    case 'rotation_property': return {
      type: 'Property', name: 'rotation', value: { type: 'Keyword', name: text(field(node, 'method')!) }, loc: loc(member),
    };
    case 'box_size_property': return {
      type: 'BoxSize',
      width: numberNode(field(node, 'width')!).value,
      height: numberNode(field(node, 'height')!).value,
      loc: loc(member),
    };
    case 'center_property': return {
      type: 'Center', x: signedNumber(field(node, 'x')!).value, y: signedNumber(field(node, 'y')!).value, loc: loc(member),
    };
    case 'assign_property': return {
      type: 'Property', name: text(field(node, 'target')!), value: expr(field(node, 'value')!), loc: loc(member),
    };
    default: throw new Error(`unexpected ${node.type}`);
  }
}

const displayName = (node: SyntaxNode) => decodeString(text(field(node, 'text')!));

function functionDecl(node: SyntaxNode): AnyNode {
  const params = fields(node, 'params').map((param) => ({ name: text(field(param, 'name')!), boolean: has(param, 'boolean') }));
  return {
    type: 'FunctionDecl',
    name: text(field(node, 'name')!),
    params: params.map((param) => param.name),
    booleanParams: params.filter((param) => param.boolean).map((param) => param.name),
    body: block(field(node, 'body')),
    loc: loc(node),
  };
}

function tableDecl(node: SyntaxNode): AnyNode {
  return {
    type: 'TableDecl',
    name: text(field(node, 'name')!),
    displayName: has(node, 'display_name') ? displayName(field(node, 'display_name')!) : null,
    columns: fields(field(node, 'columns')!, 'cell').map(expr),
    rows: fields(node, 'rows').map((row) => fields(row, 'cell').map(expr)),
    charts: fields(node, 'charts').map((chart) => ({
      kind: text(field(chart, 'kind')!),
      title: has(chart, 'title') ? JSON.parse(text(field(chart, 'title')!)) : null,
      x: has(chart, 'x') ? expr(field(chart, 'x')!) : null,
      y: has(chart, 'y') ? expr(field(chart, 'y')!) : null,
      series: fields(chart, 'series').map(expr),
    })),
    loc: loc(node),
  };
}

function storageScope(node: SyntaxNode): string | null {
  const scope = field(node, 'scope');
  return scope ? text(scope) : null;
}

function varDecl(node: SyntaxNode): AnyNode {
  return {
    type: 'VarDecl',
    name: text(field(node, 'name')!),
    displayName: has(node, 'display_name') ? displayName(field(node, 'display_name')!) : null,
    scope: storageScope(node),
    value: expr(field(node, 'value')!),
    range: has(node, 'min') ? { min: expr(field(node, 'min')!), max: expr(field(node, 'max')!) } : null,
    shown: has(node, 'shown'),
    at: has(node, 'at_x') ? { x: expr(field(node, 'at_x')!), y: expr(field(node, 'at_y')!) } : null,
    loc: loc(node),
  };
}

function listDecl(node: SyntaxNode): AnyNode {
  const value = field(node, 'value')!;
  return {
    type: 'ListDecl',
    name: text(field(node, 'name')!),
    displayName: has(node, 'display_name') ? displayName(field(node, 'display_name')!) : null,
    scope: storageScope(node),
    value: { type: 'ListLiteral', elements: fields(value, 'elements').map(expr), loc: loc(value) },
    shown: has(node, 'shown'),
    at: has(node, 'at_x') ? { x: expr(field(node, 'at_x')!), y: expr(field(node, 'at_y')!) } : null,
    loc: loc(node),
  };
}

function eventHandler(node: SyntaxNode): AnyNode {
  const up = has(node, 'up');
  const tail = { body: block(field(node, 'body')), loc: loc(node) };
  if (has(node, 'scene_start')) return { type: 'Event', event: 'scene_start', ...tail };
  if (has(node, 'start')) return { type: 'Event', event: 'start', ...tail };
  if (has(node, 'key')) {
    return { type: 'Event', event: up ? 'key_up' : 'key', key: decodeString(text(field(node, 'key_name')!)), ...tail };
  }
  if (has(node, 'stage')) return { type: 'Event', event: up ? 'stage_click_up' : 'stage_click', ...tail };
  if (has(node, 'click')) return { type: 'Event', event: up ? 'click_up' : 'click', ...tail };
  if (has(node, 'signal')) {
    return { type: 'Event', event: 'signal', signal: decodeString(text(field(node, 'signal_name')!)), ...tail };
  }
  return { type: 'Event', event: 'cloned', ...tail };
}

// ---------------------------------------------------------------------------
//  Statements
// ---------------------------------------------------------------------------

function block(node: SyntaxNode | null): Stmt[] {
  if (!node) return [];
  return named(node).filter((child) => child.type === 'statement').map(statement);
}

function statement(wrapper: SyntaxNode): Stmt {
  const node = named(wrapper)[0]!;
  const at = loc(node);
  const e = (name: string) => expr(field(node, name)!);
  const opt = (name: string) => (has(node, name) ? e(name) : null);
  const word = (name: string) => text(field(node, name)!);
  switch (node.type) {
    case 'if_statement': return {
      type: 'If',
      test: e('test'),
      consequent: block(field(node, 'consequent')),
      alternate: hasToken(node, 'else') ? block(field(node, 'alternate')) : null,
      loc: at,
    } as Stmt;
    case 'repeat_statement': return { type: 'Repeat', count: e('test'), body: block(field(node, 'body')), loc: at } as Stmt;
    case 'while_statement': return { type: 'While', test: e('test'), body: block(field(node, 'body')), loc: at } as Stmt;
    case 'until_statement': return { type: 'Until', test: e('test'), body: block(field(node, 'body')), loc: at } as Stmt;
    case 'forever_statement': return { type: 'Forever', body: block(field(node, 'body')), loc: at } as Stmt;
    case 'wait_statement': return { type: 'Wait', value: e('value'), loc: at } as Stmt;
    case 'flow_statement': {
      const kinds: Record<string, NullaryStatementType> = { break: 'Break', continue: 'Continue', skip: 'Skip', restart: 'Restart' };
      return { type: kinds[word('kind')]!, loc: at } as Stmt;
    }
    case 'return_statement': return { type: 'Return', value: e('value'), loc: at } as Stmt;
    case 'stop_statement': {
      if (has(node, 'sound')) return { type: 'StopSound', target: word('target'), loc: at } as Stmt;
      if (has(node, 'what')) {
        const kinds: Record<string, NullaryStatementType> = {
          draw: 'StopDraw', fill: 'StopFill', bgm: 'StopBgm', timer: 'StopTimer', project: 'StopProject',
        };
        return { type: kinds[word('what')]!, loc: at } as Stmt;
      }
      return { type: 'Stop', target: has(node, 'scope') ? word('scope') : 'this', loc: at } as Stmt;
    }
    case 'start_statement': {
      const kinds: Record<string, NullaryStatementType> = { draw: 'StartDraw', fill: 'StartFill', timer: 'StartTimer' };
      return { type: kinds[word('what')]!, loc: at } as Stmt;
    }
    case 'reset_statement': {
      const kinds: Record<string, NullaryStatementType> = { size: 'ResetSize', timer: 'ResetTimer' };
      return { type: kinds[word('what')]!, loc: at } as Stmt;
    }
    case 'clear_statement': return { type: 'Clear', target: word('what'), loc: at } as Stmt;
    case 'signal_statement': return { type: 'Send', signal: e('signal'), wait: word('kind') === 'call', loc: at } as Stmt;
    case 'clone_statement': return { type: 'Clone', target: opt('target'), loc: at } as Stmt;
    case 'delete_statement': return { type: has(node, 'all') ? 'DeleteClones' : 'DeleteClone', loc: at } as Stmt;
    case 'jump_statement': return { type: 'Jump', target: has(node, 'where') ? word('where') : e('target'), loc: at } as Stmt;
    case 'forward_statement': return { type: 'Forward', distance: e('distance'), angle: opt('angle'), loc: at } as Stmt;
    case 'bounce_statement': return { type: 'Bounce', loc: at } as Stmt;
    case 'move_statement': return { type: 'Move', ...pointArgs(field(node, 'point')!), loc: at } as Stmt;
    case 'go_statement': {
      const point = field(node, 'point');
      if (point) {
        const { x, y, duration } = pointArgs(point);
        return { type: 'Go', x, y, target: null, duration, loc: at } as Stmt;
      }
      return { type: 'Go', x: null, y: null, target: e('target'), duration: opt('duration'), loc: at } as Stmt;
    }
    case 'turn_statement': return {
      type: word('kind') === 'turn' ? 'Turn' : 'Steer', angle: e('angle'), duration: opt('duration'), loc: at,
    } as Stmt;
    case 'look_statement': return { type: 'Look', target: e('target'), loc: at } as Stmt;
    case 'show_hide_statement': return {
      type: word('kind') === 'show' ? 'Show' : 'Hide',
      target: has(node, 'target') ? identifier(field(node, 'target')!) : null,
      seconds: opt('seconds'),
      chart: opt('chart'),
      loc: at,
    } as Stmt;
    case 'costume_step_statement': return { type: 'CostumeStep', direction: word('direction'), loc: at } as Stmt;
    case 'say_statement': return {
      type: word('kind') === 'say' ? 'Say' : 'Think', message: e('message'), duration: opt('duration'), loc: at,
    } as Stmt;
    case 'flip_statement': return { type: 'Flip', axis: word('axis'), loc: at } as Stmt;
    case 'order_statement': return { type: 'Order', to: word('to'), loc: at } as Stmt;
    case 'text_statement': return { type: 'TextWrite', mode: word('mode'), value: e('value'), loc: at } as Stmt;
    case 'pen_statement': return { type: 'Stamp', loc: at } as Stmt;
    case 'sound_statement': {
      if (has(node, 'bgm')) return { type: 'PlayBgm', name: e('name'), loc: at } as Stmt;
      return {
        type: 'PlaySound', name: e('name'), duration: opt('duration'), from: opt('from'), to: opt('to'),
        wait: has(node, 'wait'), loc: at,
      } as Stmt;
    }
    case 'read_statement': return { type: 'Read', value: e('value'), wait: has(node, 'wait'), loc: at } as Stmt;
    case 'tts_statement': return {
      type: 'TtsSetting',
      voice: stringNode(field(node, 'voice')!),
      speed: stringNode(field(node, 'speed')!),
      pitch: stringNode(field(node, 'pitch')!),
      loc: at,
    } as Stmt;
    case 'list_add_statement': {
      const list = identifier(field(node, 'list')!);
      if (has(node, 'line')) {
        return {
          type: has(node, 'add_line') ? 'TableAddLine' : 'TableInsertLine',
          table: list,
          line: word('line'),
          index: opt('index'),
          loc: at,
        } as Stmt;
      }
      if (has(node, 'add')) return { type: 'ListAdd', list, value: e('value'), loc: at } as Stmt;
      return { type: 'ListInsert', list, value: e('value'), index: e('index'), loc: at } as Stmt;
    }
    case 'list_remove_statement': {
      if (has(node, 'line')) {
        return {
          type: 'TableRemoveLine', table: identifier(field(node, 'list')!), line: word('line'), index: e('index'), loc: at,
        } as Stmt;
      }
      return { type: 'ListRemove', list: identifier(field(node, 'list')!), index: e('index'), loc: at } as Stmt;
    }
    case 'ask_statement': return { type: 'Ask', question: e('question'), loc: at } as Stmt;
    case 'save_statement': {
      if (has(node, 'table')) return { type: 'TableSave', table: identifier(field(node, 'table')!), loc: at } as Stmt;
      return { type: 'StoreSave', async: has(node, 'async'), loc: at } as Stmt;
    }
    case 'var_decl': return varDecl(node);
    case 'list_decl': return listDecl(node);
    case 'assign_or_call': {
      const call = field(node, 'call');
      if (call) return { type: 'ExpressionStatement', expression: callExpr(call), loc: at } as Stmt;
      return {
        type: 'Assign',
        operator: text(field(node, 'operator')!),
        target: lvalue(field(node, 'target')!),
        value: e('value'),
        loc: at,
      } as Stmt;
    }
    default: throw new Error(`unexpected ${node.type}`);
  }
}

function pointArgs(node: SyntaxNode) {
  return {
    x: expr(field(node, 'x')!),
    y: expr(field(node, 'y')!),
    duration: has(node, 'duration') ? expr(field(node, 'duration')!) : null,
  };
}

function lvalue(node: SyntaxNode): AnyNode {
  const name = identifier(field(node, 'name')!);
  if (!has(node, 'index')) return name;
  return {
    type: 'Index',
    target: name,
    index: expr(field(node, 'index')!),
    column: has(node, 'column') ? expr(field(node, 'column')!) : null,
    loc: loc(node),
  };
}

// ---------------------------------------------------------------------------
//  Expressions
// ---------------------------------------------------------------------------

function expr(node: SyntaxNode): Expr {
  switch (node.type) {
    case 'or_expr':
    case 'and_expr':
    case 'compare_expr':
    case 'add_expr':
    case 'mul_expr':
      return foldBinary(node);
    case 'not_expr':
      return foldPrefix(fields(node, 'operators'), field(node, 'operand')!, 'not');
    case 'unary_expr':
      return foldPrefix(fields(node, 'operators'), field(node, 'operand')!, '-');
    case 'pow_expr': {
      const base = field(node, 'base')!;
      const exponent = field(node, 'exponent')!;
      return {
        type: 'Binary', operator: '**', left: expr(base), right: expr(exponent),
        loc: { start: loc(base).start, end: loc(exponent).end },
      } as Expr;
    }
    case 'primary_expr':
      return primary(node);
    default:
      throw new Error(`unexpected ${node.type}`);
  }
}

function foldBinary(node: SyntaxNode): Expr {
  const operands = fields(node, 'operands');
  const operators = fields(node, 'operators');
  let result = expr(operands[0]!);
  const start = loc(operands[0]!).start;
  for (let at = 0; at < operators.length; at += 1) {
    const right = operands[at + 1]!;
    result = {
      type: 'Binary', operator: text(operators[at]!), left: result, right: expr(right),
      loc: { start, end: loc(right).end },
    } as Expr;
  }
  return result;
}

function foldPrefix(operators: SyntaxNode[], operand: SyntaxNode, name: 'not' | '-'): Expr {
  let result = expr(operand);
  const end = loc(operand).end;
  for (let at = operators.length - 1; at >= 0; at -= 1) {
    result = { type: 'Unary', operator: name, argument: result, loc: { start: operators[at]!.startIndex, end } } as Expr;
  }
  return result;
}

function primary(node: SyntaxNode): Expr {
  const inner = field(node, 'inner');
  if (inner) return expr(inner);
  const call = field(node, 'call');
  if (call) return callExpr(call);
  const index = field(node, 'index');
  if (index) {
    return {
      type: 'Index',
      target: identifier(field(index, 'target')!),
      index: expr(field(index, 'index')!),
      column: has(index, 'column') ? expr(field(index, 'column')!) : null,
      loc: loc(index),
    } as Expr;
  }
  const number = field(node, 'number');
  if (number) return numberNode(number);
  const string = field(node, 'string');
  if (string) return stringNode(string);
  const boolean = field(node, 'boolean');
  if (boolean) return booleanNode(boolean);
  const color = field(node, 'color');
  if (color) {
    const image = text(color);
    return { type: 'Color', value: normalizeColor(image) ?? image.toLowerCase(), loc: tokenLoc(color) } as Expr;
  }
  if (has(node, 'transparent')) return { type: 'Transparent', loc: loc(node) } as Expr;
  return identifier(field(node, 'name')!);
}

function callExpr(node: SyntaxNode): AnyNode {
  return {
    type: 'Call',
    callee: text(field(node, 'callee')!),
    arguments: fields(node, 'args').map(expr),
    loc: loc(node),
  };
}

function booleanNode(node: SyntaxNode): BooleanNode {
  return { type: 'Boolean', value: text(node) === 'true', loc: tokenLoc(node) };
}

function signedNumber(node: SyntaxNode): NumberNode {
  const sign = has(node, 'sign') ? '-' : '';
  return { type: 'Number', value: parseFloat(sign + text(field(node, 'number')!)), loc: loc(node) };
}
