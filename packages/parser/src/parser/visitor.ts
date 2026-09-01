// ============================================================================
//  Tess CST -> AST
//
//  The grammar decides whether code is well formed; this decides what it means.
//  Node shapes are the contract the compiler, validator and decompiler share.
// ============================================================================
import type { CstNode, IToken } from 'chevrotain';
import { parser } from './parser.ts';
import type {
  AskNode, AssignNode, BooleanNode, CallNode, CenterNode, ClearNode, CloneNode,
  CostumeNode, CostumeStepNode, EventNode, Expr, ExpressionStatementNode,
  FlipNode, ForeverNode, ForwardNode, FunctionDeclNode, GoNode, Identifier,
  IfNode, IndexNode, JumpNode, ListAddNode, ListDeclNode, ListInsertNode,
  ListLiteralNode, ListRemoveNode, Loc, LookNode, LValue, MoveNode,
  NullaryNode, NullaryStatementType, NumberNode, ObjectMember, ObjectNode,
  OrderNode, ParseRoot, PlayBgmNode, PlaySoundNode, ProgramNode, ProjectFieldNode,
  ProjectNode, PropertyNode, ReadNode, RepeatNode, ReturnNode, SayNode,
  SceneMember, SceneNode, SendNode, ShowHideNode, SoundNode, StopNode,
  StopSoundNode, StorageScope, StringNode, Stmt, TableAddLineNode, TableDeclNode,
  TableLine, TableRemoveLineNode, TableSaveNode, TextWriteNode, TopLevelItem,
  TtsSettingNode, TurnNode, UntilNode, UseNode, UseObjectNode, VarDeclNode,
  WaitNode, WhileNode,
} from '../ast.ts';

/**
 * A parsed rule's children. Chevrotain shapes this per rule at runtime, so it
 * stays loose here; what each method builds out of it is typed exactly.
 */
type Ctx = Record<string, any>;

const BaseVisitor = parser.getBaseCstVisitorConstructor();

const ESCAPES: Record<string, string> = {
  n: '\n',
  t: '\t',
  r: '\r',
  b: '\b',
  f: '\f',
  v: '\v',
  0: '\0',
};

/** Span of a parsed rule. `end` is exclusive, matching the offsets in `loc`. */
const nodeLoc = (node: CstNode): Loc => ({
  start: node.location!.startOffset,
  end: node.location!.endOffset! + 1,
});

const tokenLoc = (token: IToken): Loc => ({
  start: token.startOffset,
  end: token.endOffset! + 1,
});

/** The one child a dispatch-only rule matched. */
function onlyChild(ctx: Ctx) {
  for (const key of Object.keys(ctx)) {
    const value = ctx[key]?.[0];
    if (value !== undefined) return value;
  }
  return undefined;
}

/** The one token a rule consumed, whatever key it landed under. */
function onlyToken(ctx: Ctx): IToken | undefined {
  const child = onlyChild(ctx);
  return child?.image !== undefined ? child : undefined;
}

/** Reads a string literal's text, resolving the escapes the grammar allows. */
export function decodeString(image: string): string {
  const raw = image.slice(1, -1);
  let out = '';
  for (let i = 0; i < raw.length; i += 1) {
    if (raw[i] !== '\\') {
      out += raw[i];
      continue;
    }
    const next = raw[i + 1];
    const hex = raw.slice(i + 2, i + 6);
    if (next === 'u' && /^[0-9a-fA-F]{4}$/.test(hex)) {
      out += String.fromCharCode(parseInt(hex, 16));
      i += 5;
    } else {
      out += ESCAPES[next] ?? next;
      i += 1;
    }
  }
  return out;
}

const stringNode = (token: IToken): StringNode => ({
  type: 'String',
  value: decodeString(token.image),
  loc: tokenLoc(token),
});

const numberNode = (token: IToken): NumberNode => ({
  type: 'Number',
  value: token.image.includes('.') ? parseFloat(token.image) : parseInt(token.image, 10),
  loc: tokenLoc(token),
});

export class TessAstVisitor extends BaseVisitor {
  sourceLength: number;

  constructor() {
    super();
    this.sourceLength = 0;
    this.validateVisitor();
  }

  /**
   * The stock dispatcher hands a rule only its children, but every node needs
   * its own span for `loc`, so pass the node itself as the second argument.
   */
  visit(cstNode: any, param?: any): any {
    const node = Array.isArray(cstNode) ? cstNode[0] : cstNode;
    if (node === undefined) return undefined;
    return (this as Ctx)[node.name](node.children, param ?? node);
  }

  /**
   * Folds `a op b op c` into left-leaning Binary nodes.
   *
   * Spans come from the parsed operands rather than their AST nodes, because a
   * parenthesised operand reports its inner span while the operator node covers
   * the brackets too.
   */
  foldBinary(ctx: Ctx): Expr {
    const parsed = ctx.operands;
    let node = this.visit(parsed[0]);
    const operators = ctx.operators ?? [];
    for (let i = 0; i < operators.length; i += 1) {
      const right = parsed[i + 1];
      node = {
        type: 'Binary',
        operator: operators[i].image,
        left: node,
        right: this.visit(right),
        loc: {
          start: parsed[0].location.startOffset,
          end: right.location.endOffset + 1,
        },
      };
    }
    return node;
  }

  /** Folds repeated prefix operators, innermost last. */
  foldPrefix(operators: IToken[], parsed: any, name: 'not' | '-'): Expr {
    let node = this.visit(parsed);
    const end = (Array.isArray(parsed) ? parsed[0] : parsed).location.endOffset + 1;
    for (let i = operators.length - 1; i >= 0; i -= 1) {
      node = {
        type: 'Unary',
        operator: name,
        argument: node,
        loc: { start: operators[i].startOffset, end },
      };
    }
    return node;
  }

  // ==========================================================================
  //  Program and declarations
  // ==========================================================================
  // A program must consume its whole file, so its span always ends at the end of
  // the text — trailing blank lines and comments included. An empty program has
  // no tokens to start from and collapses onto that same point.
  program(ctx: Ctx, node: CstNode): ProgramNode {
    const body = (ctx.topLevelItem ?? []).map((item: CstNode) => this.visit(item));
    const start = node.location!.startOffset >= 0
      ? node.location!.startOffset
      : this.sourceLength;
    return { type: 'Program', body, loc: { start, end: this.sourceLength } };
  }

  sceneFragment(ctx: Ctx): SceneMember[] {
    return (ctx.sceneMember ?? []).map((member: CstNode) => this.visit(member));
  }

  objectFragment(ctx: Ctx): ObjectMember[] {
    return (ctx.objectMember ?? []).map((member: CstNode) => this.visit(member));
  }

  topLevelItem(ctx: Ctx): TopLevelItem {
    return this.visit(onlyChild(ctx));
  }

  sceneMember(ctx: Ctx): SceneMember {
    return this.visit(onlyChild(ctx));
  }

  objectMember(ctx: Ctx): ObjectMember {
    return this.visit(onlyChild(ctx));
  }

  useDecl(ctx: Ctx, node: CstNode): UseNode {
    return {
      type: 'Use',
      path: decodeString(ctx.path[0].image),
      loc: nodeLoc(node),
    };
  }

  useObjectDecl(ctx: Ctx, node: CstNode): UseObjectNode {
    return {
      type: 'UseObject',
      kind: ctx.kind[0].image === 'useobject' ? 'object' : 'text',
      path: decodeString(ctx.path[0].image),
      loc: nodeLoc(node),
    };
  }

  projectDecl(ctx: Ctx, node: CstNode): ProjectNode {
    return {
      type: 'Project',
      fields: (ctx.projectField ?? []).map((field: CstNode) => this.visit(field)),
      loc: nodeLoc(node),
    };
  }

  projectField(ctx: Ctx, node: CstNode): ProjectFieldNode {
    const value = ctx.text ? stringNode(ctx.text[0]) : numberNode(ctx.number[0]);
    return {
      type: 'ProjectField',
      field: ctx.field[0].image,
      value,
      loc: nodeLoc(node),
    };
  }

  sceneDecl(ctx: Ctx, node: CstNode): SceneNode {
    return {
      type: 'Scene',
      name: decodeString(ctx.name[0].image),
      body: (ctx.sceneMember ?? []).map((member: CstNode) => this.visit(member)),
      loc: nodeLoc(node),
    };
  }

  // Shaped like an object's `name` property so the compiler can treat both alike.
  sceneNameDecl(ctx: Ctx, node: CstNode): PropertyNode {
    return {
      type: 'Property',
      name: 'name',
      value: stringNode(ctx.text[0]),
      loc: nodeLoc(node),
    };
  }

  objectDecl(ctx: Ctx, node: CstNode): ObjectNode {
    return {
      type: 'Object',
      kind: ctx.kind[0].image,
      name: decodeString(ctx.name[0].image),
      body: (ctx.objectMember ?? []).map((member: CstNode) => this.visit(member)),
      loc: nodeLoc(node),
    };
  }

  // ==========================================================================
  //  Object properties
  // ==========================================================================
  propertyDecl(ctx: Ctx, node: CstNode): PropertyNode | CenterNode | CostumeNode | SoundNode | ObjectMember {
    if (ctx.costumeProperty) return this.visit(ctx.costumeProperty);
    if (ctx.soundProperty) return this.visit(ctx.soundProperty);
    if (ctx.nameKeyword) {
      return {
        type: 'Property', name: 'name', value: stringNode(ctx.text[0]), loc: nodeLoc(node),
      };
    }
    if (ctx.flag) {
      return {
        type: 'Property',
        name: ctx.flag[0].image,
        value: this.visit(ctx.value),
        loc: nodeLoc(node),
      };
    }
    if (ctx.method) {
      return {
        type: 'Property',
        name: 'rotation',
        value: { type: 'Keyword', name: this.visit(ctx.method) },
        loc: nodeLoc(node),
      };
    }
    if (ctx.width) {
      return {
        type: 'BoxSize',
        width: numberNode(ctx.width[0]).value,
        height: numberNode(ctx.height[0]).value,
        loc: nodeLoc(node),
      };
    }
    if (ctx.x) {
      return {
        type: 'Center',
        x: this.visit(ctx.x).value,
        y: this.visit(ctx.y).value,
        loc: nodeLoc(node),
      };
    }
    return {
      type: 'Property',
      name: this.visit(ctx.target),
      value: this.visit(ctx.value),
      loc: nodeLoc(node),
    };
  }

  propertyName(ctx: Ctx): string {
    return onlyToken(ctx)!.image;
  }

  costumeProperty(ctx: Ctx, node: CstNode): CostumeNode {
    return {
      type: 'Costume',
      id: this.visit(ctx.id).name,
      displayName: ctx.displayName ? this.visit(ctx.displayName) : null,
      file: decodeString(ctx.file[0].image),
      isDefault: Boolean(ctx.isDefault),
      width: ctx.width ? numberNode(ctx.width[0]).value : null,
      height: ctx.height ? numberNode(ctx.height[0]).value : null,
      forceId: ctx.forceId ? this.visit(ctx.forceId) : null,
      loc: nodeLoc(node),
    };
  }

  soundProperty(ctx: Ctx, node: CstNode): SoundNode {
    return {
      type: 'Sound',
      id: this.visit(ctx.id).name,
      displayName: ctx.displayName ? this.visit(ctx.displayName) : null,
      file: decodeString(ctx.file[0].image),
      duration: ctx.duration ? numberNode(ctx.duration[0]).value : null,
      forceId: ctx.forceId ? this.visit(ctx.forceId) : null,
      loc: nodeLoc(node),
    };
  }

  displayName(ctx: Ctx): string {
    return decodeString(ctx.text[0].image);
  }

  forceId(ctx: Ctx): string {
    return decodeString(ctx.text[0].image);
  }

  rotateMethod(ctx: Ctx): string {
    return onlyToken(ctx)!.image;
  }

  // ==========================================================================
  //  Functions, variables and lists
  // ==========================================================================
  functionDecl(ctx: Ctx, node: CstNode): FunctionDeclNode {
    const declared = (ctx.params ?? []).map((param: CstNode) => this.visit(param));
    return {
      type: 'FunctionDecl',
      name: this.visit(ctx.name).name,
      params: declared.map((param: CstNode) => param.name),
      booleanParams: declared.filter((param: { name: string; boolean: boolean }) => param.boolean).map((param: CstNode) => param.name),
      body: this.visit(ctx.body),
      loc: nodeLoc(node),
    };
  }

  functionParam(ctx: Ctx): { name: string; boolean: boolean } {
    return { name: this.visit(ctx.name).name, boolean: Boolean(ctx.boolean) };
  }

  tableDecl(ctx: Ctx, node: CstNode): TableDeclNode {
    return {
      type: 'TableDecl',
      name: this.visit(ctx.name).name,
      displayName: ctx.displayName ? this.visit(ctx.displayName) : null,
      columns: this.visit(ctx.columns),
      rows: (ctx.rows ?? []).map((row: CstNode) => this.visit(row)),
      loc: nodeLoc(node),
    };
  }

  tableColumns(ctx: Ctx): Expr[] {
    return this.visit(ctx.cells);
  }

  tableRow(ctx: Ctx): Expr[] {
    return this.visit(ctx.cells);
  }

  tableCells(ctx: Ctx): Expr[] {
    return (ctx.cell ?? []).map((cell: CstNode) => this.visit(cell));
  }

  storageScope(ctx: Ctx): StorageScope {
    return ctx.shared ? 'shared' : 'realtime';
  }

  varDecl(ctx: Ctx, node: CstNode): VarDeclNode {
    return {
      type: 'VarDecl',
      name: this.visit(ctx.name).name,
      displayName: ctx.displayName ? this.visit(ctx.displayName) : null,
      scope: ctx.scope ? this.visit(ctx.scope) : null,
      value: this.visit(ctx.value),
      loc: nodeLoc(node),
    };
  }

  listDecl(ctx: Ctx, node: CstNode): ListDeclNode {
    return {
      type: 'ListDecl',
      name: this.visit(ctx.name).name,
      displayName: ctx.displayName ? this.visit(ctx.displayName) : null,
      scope: ctx.scope ? this.visit(ctx.scope) : null,
      value: this.visit(ctx.value),
      loc: nodeLoc(node),
    };
  }

  // ==========================================================================
  //  Events
  // ==========================================================================
  eventHandler(ctx: Ctx, node: CstNode): EventNode {
    const up = Boolean(ctx.up);
    const tail = { body: this.visit(ctx.body), loc: nodeLoc(node) };

    if (ctx.sceneStart) return { type: 'Event', event: 'scene_start', ...tail };
    if (ctx.start) return { type: 'Event', event: 'start', ...tail };
    if (ctx.key) {
      const key = decodeString(ctx.keyName[0].image);
      return {
        type: 'Event', event: up ? 'key_up' : 'key', key, ...tail,
      };
    }
    if (ctx.stage) {
      return { type: 'Event', event: up ? 'stage_click_up' : 'stage_click', ...tail };
    }
    if (ctx.click) return { type: 'Event', event: up ? 'click_up' : 'click', ...tail };
    if (ctx.signal) {
      const signal = decodeString(ctx.signalName[0].image);
      return {
        type: 'Event', event: 'signal', signal, ...tail,
      };
    }
    return { type: 'Event', event: 'cloned', ...tail };
  }

  // ==========================================================================
  //  Statements
  // ==========================================================================
  blockOpen(): null {
    return null;
  }

  block(ctx: Ctx): Stmt[] {
    return (ctx.statements ?? []).map((statement: CstNode) => this.visit(statement));
  }

  statement(ctx: Ctx): Stmt {
    return this.visit(onlyChild(ctx));
  }

  ifStatement(ctx: Ctx, node: CstNode): IfNode {
    return {
      type: 'If',
      test: this.visit(ctx.test),
      consequent: this.visit(ctx.consequent),
      alternate: ctx.alternate ? this.visit(ctx.alternate) : null,
      loc: nodeLoc(node),
    };
  }

  repeatStatement(ctx: Ctx, node: CstNode): RepeatNode {
    return {
      type: 'Repeat', count: this.visit(ctx.test), body: this.visit(ctx.body), loc: nodeLoc(node),
    };
  }

  whileStatement(ctx: Ctx, node: CstNode): WhileNode {
    return {
      type: 'While', test: this.visit(ctx.test), body: this.visit(ctx.body), loc: nodeLoc(node),
    };
  }

  untilStatement(ctx: Ctx, node: CstNode): UntilNode {
    return {
      type: 'Until', test: this.visit(ctx.test), body: this.visit(ctx.body), loc: nodeLoc(node),
    };
  }

  foreverStatement(ctx: Ctx, node: CstNode): ForeverNode {
    return { type: 'Forever', body: this.visit(ctx.body), loc: nodeLoc(node) };
  }

  waitStatement(ctx: Ctx, node: CstNode): WaitNode {
    return { type: 'Wait', value: this.visit(ctx.value), loc: nodeLoc(node) };
  }

  flowStatement(ctx: Ctx, node: CstNode): NullaryNode {
    const kinds: Record<string, NullaryStatementType> = { break: 'Break', skip: 'Skip', restart: 'Restart' };
    return { type: kinds[ctx.kind[0].image], loc: nodeLoc(node) };
  }

  returnStatement(ctx: Ctx, node: CstNode): ReturnNode {
    return { type: 'Return', value: this.visit(ctx.value), loc: nodeLoc(node) };
  }

  stopStatement(ctx: Ctx, node: CstNode): StopSoundNode | NullaryNode | StopNode {
    const loc = nodeLoc(node);
    if (ctx.sound) return { type: 'StopSound', target: ctx.target[0].image, loc };
    if (ctx.what) {
      const kinds: Record<string, NullaryStatementType> = {
        draw: 'StopDraw', fill: 'StopFill', bgm: 'StopBgm', timer: 'StopTimer',
      };
      return { type: kinds[ctx.what[0].image], loc };
    }
    // A bare `stop` ends this script.
    return { type: 'Stop', target: ctx.scope ? ctx.scope[0].image : 'this', loc };
  }

  startStatement(ctx: Ctx, node: CstNode): NullaryNode {
    const kinds: Record<string, NullaryStatementType> = { draw: 'StartDraw', fill: 'StartFill', timer: 'StartTimer' };
    return { type: kinds[ctx.what[0].image], loc: nodeLoc(node) };
  }

  resetStatement(ctx: Ctx, node: CstNode): NullaryNode {
    const kinds: Record<string, NullaryStatementType> = { size: 'ResetSize', timer: 'ResetTimer' };
    return { type: kinds[ctx.what[0].image], loc: nodeLoc(node) };
  }

  clearStatement(ctx: Ctx, node: CstNode): ClearNode {
    return { type: 'Clear', target: ctx.what[0].image, loc: nodeLoc(node) };
  }

  signalStatement(ctx: Ctx, node: CstNode): SendNode {
    return {
      type: 'Send',
      signal: this.visit(ctx.signal),
      wait: ctx.kind[0].image === 'call',
      loc: nodeLoc(node),
    };
  }

  cloneStatement(ctx: Ctx, node: CstNode): CloneNode {
    return {
      type: 'Clone',
      target: ctx.target ? this.visit(ctx.target) : null,
      loc: nodeLoc(node),
    };
  }

  deleteStatement(ctx: Ctx, node: CstNode): NullaryNode {
    return { type: ctx.all ? 'DeleteClones' : 'DeleteClone', loc: nodeLoc(node) };
  }

  jumpStatement(ctx: Ctx, node: CstNode): JumpNode {
    return {
      type: 'Jump',
      target: ctx.where ? ctx.where[0].image : this.visit(ctx.target),
      loc: nodeLoc(node),
    };
  }

  // ==========================================================================
  //  Movement
  // ==========================================================================
  forwardStatement(ctx: Ctx, node: CstNode): ForwardNode {
    return {
      type: 'Forward',
      distance: this.visit(ctx.distance),
      angle: ctx.angle ? this.visit(ctx.angle) : null,
      loc: nodeLoc(node),
    };
  }

  bounceStatement(ctx: Ctx, node: CstNode): NullaryNode {
    return { type: 'Bounce', loc: nodeLoc(node) };
  }

  pointArgs(ctx: Ctx): { x: Expr; y: Expr; duration: Expr | null } {
    return {
      x: this.visit(ctx.x),
      y: this.visit(ctx.y),
      duration: ctx.duration ? this.visit(ctx.duration) : null,
    };
  }

  moveStatement(ctx: Ctx, node: CstNode): MoveNode {
    return { type: 'Move', ...this.visit(ctx.point), loc: nodeLoc(node) };
  }

  goStatement(ctx: Ctx, node: CstNode): GoNode {
    const loc = nodeLoc(node);
    if (ctx.point) {
      const { x, y, duration } = this.visit(ctx.point);
      return {
        type: 'Go', x, y, target: null, duration, loc,
      };
    }
    return {
      type: 'Go',
      x: null,
      y: null,
      target: this.visit(ctx.target),
      duration: ctx.duration ? this.visit(ctx.duration) : null,
      loc,
    };
  }

  turnStatement(ctx: Ctx, node: CstNode): TurnNode {
    return {
      type: ctx.kind[0].image === 'turn' ? 'Turn' : 'Steer',
      angle: this.visit(ctx.angle),
      duration: ctx.duration ? this.visit(ctx.duration) : null,
      loc: nodeLoc(node),
    };
  }

  lookStatement(ctx: Ctx, node: CstNode): LookNode {
    return { type: 'Look', target: this.visit(ctx.target), loc: nodeLoc(node) };
  }

  // ==========================================================================
  //  Looks and speech
  // ==========================================================================
  showHideStatement(ctx: Ctx, node: CstNode): ShowHideNode {
    return {
      type: ctx.kind[0].image === 'show' ? 'Show' : 'Hide',
      target: ctx.target ? this.visit(ctx.target) : null,
      seconds: ctx.seconds ? this.visit(ctx.seconds) : null,
      chart: ctx.chart ? this.visit(ctx.chart) : null,
      loc: nodeLoc(node),
    };
  }

  costumeStepStatement(ctx: Ctx, node: CstNode): CostumeStepNode {
    return {
      type: 'CostumeStep',
      direction: ctx.direction[0].image,
      loc: nodeLoc(node),
    };
  }

  sayStatement(ctx: Ctx, node: CstNode): SayNode {
    return {
      type: ctx.kind[0].image === 'say' ? 'Say' : 'Think',
      message: this.visit(ctx.message),
      duration: ctx.duration ? this.visit(ctx.duration) : null,
      loc: nodeLoc(node),
    };
  }

  flipStatement(ctx: Ctx, node: CstNode): FlipNode {
    return { type: 'Flip', axis: ctx.axis[0].image, loc: nodeLoc(node) };
  }

  orderStatement(ctx: Ctx, node: CstNode): OrderNode {
    return { type: 'Order', to: ctx.to[0].image, loc: nodeLoc(node) };
  }

  // ==========================================================================
  //  Text box, pen and sound
  // ==========================================================================
  textStatement(ctx: Ctx, node: CstNode): TextWriteNode {
    return {
      type: 'TextWrite',
      mode: ctx.mode[0].image,
      value: this.visit(ctx.value),
      loc: nodeLoc(node),
    };
  }

  penStatement(ctx: Ctx, node: CstNode): NullaryNode {
    return { type: 'Stamp', loc: nodeLoc(node) };
  }

  soundStatement(ctx: Ctx, node: CstNode): PlayBgmNode | PlaySoundNode {
    const loc = nodeLoc(node);
    if (ctx.bgm) return { type: 'PlayBgm', name: this.visit(ctx.name), loc };
    return {
      type: 'PlaySound',
      name: this.visit(ctx.name),
      duration: ctx.duration ? this.visit(ctx.duration) : null,
      from: ctx.from ? this.visit(ctx.from) : null,
      to: ctx.to ? this.visit(ctx.to) : null,
      wait: Boolean(ctx.wait),
      loc,
    };
  }

  readStatement(ctx: Ctx, node: CstNode): ReadNode {
    return {
      type: 'Read',
      value: this.visit(ctx.value),
      wait: Boolean(ctx.wait),
      loc: nodeLoc(node),
    };
  }

  ttsStatement(ctx: Ctx, node: CstNode): TtsSettingNode {
    return {
      type: 'TtsSetting',
      voice: stringNode(ctx.voice[0]),
      speed: stringNode(ctx.speed[0]),
      pitch: stringNode(ctx.pitch[0]),
      loc: nodeLoc(node),
    };
  }

  // ==========================================================================
  //  Data
  // ==========================================================================
  listAddStatement(ctx: Ctx, node: CstNode): ListAddNode | ListInsertNode | TableAddLineNode {
    const loc = nodeLoc(node);
    const list = this.visit(ctx.list);
    if (ctx.line) {
      return {
        type: ctx.addLine ? 'TableAddLine' : 'TableInsertLine',
        table: list,
        line: this.visit(ctx.line),
        index: ctx.index ? this.visit(ctx.index) : null,
        loc,
      };
    }
    if (ctx.add) return { type: 'ListAdd', list, value: this.visit(ctx.value), loc };
    return {
      type: 'ListInsert',
      list,
      value: this.visit(ctx.value),
      index: this.visit(ctx.index),
      loc,
    };
  }

  tableLine(ctx: Ctx): TableLine {
    return ctx.row ? 'row' : 'column';
  }

  saveStatement(ctx: Ctx, node: CstNode): TableSaveNode {
    return { type: 'TableSave', table: this.visit(ctx.table), loc: nodeLoc(node) };
  }

  listRemoveStatement(ctx: Ctx, node: CstNode): ListRemoveNode | TableRemoveLineNode {
    const loc = nodeLoc(node);
    if (ctx.line) {
      return {
        type: 'TableRemoveLine',
        table: this.visit(ctx.list),
        line: this.visit(ctx.line),
        index: this.visit(ctx.index),
        loc,
      };
    }
    return {
      type: 'ListRemove',
      list: this.visit(ctx.list),
      index: this.visit(ctx.index),
      loc,
    };
  }

  askStatement(ctx: Ctx, node: CstNode): AskNode {
    return { type: 'Ask', question: this.visit(ctx.question), loc: nodeLoc(node) };
  }

  // ==========================================================================
  //  Assignment and calls
  // ==========================================================================
  assignOrCall(ctx: Ctx, node: CstNode): ExpressionStatementNode | AssignNode {
    if (ctx.call) {
      return {
        type: 'ExpressionStatement',
        expression: this.visit(ctx.call),
        loc: nodeLoc(node),
      };
    }
    return {
      type: 'Assign',
      operator: this.visit(ctx.operator),
      target: this.visit(ctx.target),
      value: this.visit(ctx.value),
      loc: nodeLoc(node),
    };
  }

  lvalue(ctx: Ctx, node: CstNode): LValue {
    const name = this.visit(ctx.name);
    if (!ctx.index) return name;
    return {
      type: 'Index',
      target: name,
      index: this.visit(ctx.index),
      column: ctx.column ? this.visit(ctx.column) : null,
      loc: nodeLoc(node),
    };
  }

  assignOperator(ctx: Ctx): string {
    return onlyToken(ctx)!.image;
  }

  // ==========================================================================
  //  Expressions
  // ==========================================================================
  expr(ctx: Ctx): Expr {
    return this.visit(ctx.orExpr);
  }

  orExpr(ctx: Ctx): Expr {
    return this.foldBinary(ctx);
  }

  andExpr(ctx: Ctx): Expr {
    return this.foldBinary(ctx);
  }

  notExpr(ctx: Ctx): Expr {
    return this.foldPrefix(ctx.operators ?? [], ctx.operand, 'not');
  }

  compareExpr(ctx: Ctx): Expr {
    return this.foldBinary(ctx);
  }

  addExpr(ctx: Ctx): Expr {
    return this.foldBinary(ctx);
  }

  mulExpr(ctx: Ctx): Expr {
    return this.foldBinary(ctx);
  }

  powExpr(ctx: Ctx): Expr {
    const base = this.visit(ctx.base);
    if (!ctx.exponent) return base;
    return {
      type: 'Binary',
      operator: '**',
      left: base,
      right: this.visit(ctx.exponent),
      loc: {
        start: ctx.base[0].location.startOffset,
        end: ctx.exponent[0].location.endOffset + 1,
      },
    };
  }

  unaryExpr(ctx: Ctx): Expr {
    return this.foldPrefix(ctx.operators ?? [], ctx.operand, '-');
  }

  posExpr(ctx: Ctx): Expr {
    return this.visit(ctx.unaryExpr);
  }

  primaryExpr(ctx: Ctx, node: CstNode): Expr {
    if (ctx.inner) return this.visit(ctx.inner);
    if (ctx.call) return this.visit(ctx.call);
    if (ctx.index) return this.visit(ctx.index);
    if (ctx.number) return numberNode(ctx.number[0]);
    if (ctx.string) return stringNode(ctx.string[0]);
    if (ctx.boolean) return this.visit(ctx.boolean);
    if (ctx.color) {
      return {
        type: 'Color',
        value: ctx.color[0].image.toLowerCase(),
        loc: tokenLoc(ctx.color[0]),
      };
    }
    if (ctx.transparent) return { type: 'Transparent', loc: nodeLoc(node) };
    return this.visit(ctx.name);
  }

  callExpr(ctx: Ctx, node: CstNode): CallNode {
    return {
      type: 'Call',
      callee: this.visit(ctx.callee).name,
      arguments: (ctx.args ?? []).map((arg: CstNode) => this.visit(arg)),
      loc: nodeLoc(node),
    };
  }

  indexExpr(ctx: Ctx, node: CstNode): IndexNode {
    return {
      type: 'Index',
      target: this.visit(ctx.target),
      index: this.visit(ctx.index),
      column: ctx.column ? this.visit(ctx.column) : null,
      loc: nodeLoc(node),
    };
  }

  listLiteral(ctx: Ctx, node: CstNode): ListLiteralNode {
    return {
      type: 'ListLiteral',
      elements: (ctx.elements ?? []).map((element: CstNode) => this.visit(element)),
      loc: nodeLoc(node),
    };
  }

  // ==========================================================================
  //  Terminals
  // ==========================================================================
  identifier(ctx: Ctx): Identifier {
    const token = ctx.name[0];
    return { type: 'Identifier', name: token.image, loc: tokenLoc(token) };
  }

  booleanLiteral(ctx: Ctx): BooleanNode {
    const token = ctx.value[0];
    return { type: 'Boolean', value: token.image === 'true', loc: tokenLoc(token) };
  }

  signedNumber(ctx: Ctx, node: CstNode): NumberNode {
    const text = (ctx.sign ? '-' : '') + ctx.number[0].image;
    return { type: 'Number', value: parseFloat(text), loc: nodeLoc(node) };
  }
}

export const visitor = new TessAstVisitor();

/** Turns a parsed rule into its AST. */
export function toAst(cst: CstNode, sourceLength: number): ParseRoot {
  visitor.sourceLength = sourceLength;
  return visitor.visit(cst);
}
