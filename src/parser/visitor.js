// ============================================================================
//  Tess CST -> AST
//
//  The grammar decides whether code is well formed; this decides what it means.
//  Node shapes are the contract the compiler, validator and decompiler share.
// ============================================================================
import { parser } from './parser.js';

const BaseVisitor = parser.getBaseCstVisitorConstructor();

const ESCAPES = {
  n: '\n',
  t: '\t',
  r: '\r',
  b: '\b',
  f: '\f',
  v: '\v',
  0: '\0',
};

/** Span of a parsed rule. `end` is exclusive, matching the offsets in `loc`. */
const nodeLoc = (node) => ({
  start: node.location.startOffset,
  end: node.location.endOffset + 1,
});

const tokenLoc = (token) => ({ start: token.startOffset, end: token.endOffset + 1 });

/** The one child a dispatch-only rule matched. */
function onlyChild(ctx) {
  for (const key of Object.keys(ctx)) {
    const value = ctx[key]?.[0];
    if (value !== undefined) return value;
  }
  return undefined;
}

/** The one token a rule consumed, whatever key it landed under. */
function onlyToken(ctx) {
  const child = onlyChild(ctx);
  return child?.image !== undefined ? child : undefined;
}

/** Reads a string literal's text, resolving the escapes the grammar allows. */
export function decodeString(image) {
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

const stringNode = (token) => ({
  type: 'String',
  value: decodeString(token.image),
  loc: tokenLoc(token),
});

const numberNode = (token) => ({
  type: 'Number',
  value: token.image.includes('.') ? parseFloat(token.image) : parseInt(token.image, 10),
  loc: tokenLoc(token),
});

export class TessAstVisitor extends BaseVisitor {
  constructor() {
    super();
    this.sourceLength = 0;
    this.validateVisitor();
  }

  /**
   * The stock dispatcher hands a rule only its children, but every node needs
   * its own span for `loc`, so pass the node itself as the second argument.
   */
  visit(cstNode, param) {
    const node = Array.isArray(cstNode) ? cstNode[0] : cstNode;
    if (node === undefined) return undefined;
    return this[node.name](node.children, param ?? node);
  }

  /**
   * Folds `a op b op c` into left-leaning Binary nodes.
   *
   * Spans come from the parsed operands rather than their AST nodes, because a
   * parenthesised operand reports its inner span while the operator node covers
   * the brackets too.
   */
  foldBinary(ctx) {
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
  foldPrefix(operators, parsed, name) {
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
  program(ctx, node) {
    const body = (ctx.topLevelItem ?? []).map((item) => this.visit(item));
    const start = node.location.startOffset >= 0
      ? node.location.startOffset
      : this.sourceLength;
    return { type: 'Program', body, loc: { start, end: this.sourceLength } };
  }

  sceneFragment(ctx) {
    return (ctx.sceneMember ?? []).map((member) => this.visit(member));
  }

  objectFragment(ctx) {
    return (ctx.objectMember ?? []).map((member) => this.visit(member));
  }

  topLevelItem(ctx) {
    return this.visit(onlyChild(ctx));
  }

  sceneMember(ctx) {
    return this.visit(onlyChild(ctx));
  }

  objectMember(ctx) {
    return this.visit(onlyChild(ctx));
  }

  useDecl(ctx, node) {
    return {
      type: 'Use',
      path: decodeString(ctx.path[0].image),
      loc: nodeLoc(node),
    };
  }

  useObjectDecl(ctx, node) {
    return {
      type: 'UseObject',
      kind: ctx.kind[0].image === 'useobject' ? 'object' : 'text',
      path: decodeString(ctx.path[0].image),
      loc: nodeLoc(node),
    };
  }

  projectDecl(ctx, node) {
    return {
      type: 'Project',
      fields: (ctx.projectField ?? []).map((field) => this.visit(field)),
      loc: nodeLoc(node),
    };
  }

  projectField(ctx, node) {
    const value = ctx.text ? stringNode(ctx.text[0]) : numberNode(ctx.number[0]);
    return {
      type: 'ProjectField',
      field: ctx.field[0].image,
      value,
      loc: nodeLoc(node),
    };
  }

  sceneDecl(ctx, node) {
    return {
      type: 'Scene',
      name: decodeString(ctx.name[0].image),
      body: (ctx.sceneMember ?? []).map((member) => this.visit(member)),
      loc: nodeLoc(node),
    };
  }

  // Shaped like an object's `name` property so the compiler can treat both alike.
  sceneNameDecl(ctx, node) {
    return {
      type: 'Property',
      name: 'name',
      value: stringNode(ctx.text[0]),
      loc: nodeLoc(node),
    };
  }

  objectDecl(ctx, node) {
    return {
      type: 'Object',
      kind: ctx.kind[0].image,
      name: decodeString(ctx.name[0].image),
      body: (ctx.objectMember ?? []).map((member) => this.visit(member)),
      loc: nodeLoc(node),
    };
  }

  // ==========================================================================
  //  Object properties
  // ==========================================================================
  propertyDecl(ctx, node) {
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

  propertyName(ctx) {
    return onlyToken(ctx).image;
  }

  costumeProperty(ctx, node) {
    return {
      type: 'Costume',
      id: this.visit(ctx.id).name,
      file: decodeString(ctx.file[0].image),
      isDefault: Boolean(ctx.isDefault),
      width: ctx.width ? numberNode(ctx.width[0]).value : null,
      height: ctx.height ? numberNode(ctx.height[0]).value : null,
      forceId: ctx.forceId ? this.visit(ctx.forceId) : null,
      loc: nodeLoc(node),
    };
  }

  soundProperty(ctx, node) {
    return {
      type: 'Sound',
      id: this.visit(ctx.id).name,
      file: decodeString(ctx.file[0].image),
      duration: ctx.duration ? numberNode(ctx.duration[0]).value : null,
      forceId: ctx.forceId ? this.visit(ctx.forceId) : null,
      loc: nodeLoc(node),
    };
  }

  forceId(ctx) {
    return decodeString(ctx.text[0].image);
  }

  rotateMethod(ctx) {
    return onlyToken(ctx).image;
  }

  // ==========================================================================
  //  Functions, variables and lists
  // ==========================================================================
  functionDecl(ctx, node) {
    const declared = (ctx.params ?? []).map((param) => this.visit(param));
    return {
      type: 'FunctionDecl',
      name: this.visit(ctx.name).name,
      params: declared.map((param) => param.name),
      booleanParams: declared.filter((param) => param.boolean).map((param) => param.name),
      body: this.visit(ctx.body),
      loc: nodeLoc(node),
    };
  }

  functionParam(ctx) {
    return { name: this.visit(ctx.name).name, boolean: Boolean(ctx.boolean) };
  }

  varDecl(ctx, node) {
    return {
      type: 'VarDecl',
      name: this.visit(ctx.name).name,
      value: this.visit(ctx.value),
      loc: nodeLoc(node),
    };
  }

  listDecl(ctx, node) {
    return {
      type: 'ListDecl',
      name: this.visit(ctx.name).name,
      value: this.visit(ctx.value),
      loc: nodeLoc(node),
    };
  }

  // ==========================================================================
  //  Events
  // ==========================================================================
  eventHandler(ctx, node) {
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
  blockOpen() {
    return null;
  }

  block(ctx) {
    return (ctx.statements ?? []).map((statement) => this.visit(statement));
  }

  statement(ctx) {
    return this.visit(onlyChild(ctx));
  }

  ifStatement(ctx, node) {
    return {
      type: 'If',
      test: this.visit(ctx.test),
      consequent: this.visit(ctx.consequent),
      alternate: ctx.alternate ? this.visit(ctx.alternate) : null,
      loc: nodeLoc(node),
    };
  }

  repeatStatement(ctx, node) {
    return {
      type: 'Repeat', count: this.visit(ctx.test), body: this.visit(ctx.body), loc: nodeLoc(node),
    };
  }

  whileStatement(ctx, node) {
    return {
      type: 'While', test: this.visit(ctx.test), body: this.visit(ctx.body), loc: nodeLoc(node),
    };
  }

  untilStatement(ctx, node) {
    return {
      type: 'Until', test: this.visit(ctx.test), body: this.visit(ctx.body), loc: nodeLoc(node),
    };
  }

  foreverStatement(ctx, node) {
    return { type: 'Forever', body: this.visit(ctx.body), loc: nodeLoc(node) };
  }

  waitStatement(ctx, node) {
    return { type: 'Wait', value: this.visit(ctx.value), loc: nodeLoc(node) };
  }

  flowStatement(ctx, node) {
    const kinds = { break: 'Break', skip: 'Skip', restart: 'Restart' };
    return { type: kinds[ctx.kind[0].image], loc: nodeLoc(node) };
  }

  returnStatement(ctx, node) {
    return { type: 'Return', value: this.visit(ctx.value), loc: nodeLoc(node) };
  }

  stopStatement(ctx, node) {
    const loc = nodeLoc(node);
    if (ctx.sound) return { type: 'StopSound', target: ctx.target[0].image, loc };
    if (ctx.what) {
      const kinds = {
        draw: 'StopDraw', fill: 'StopFill', bgm: 'StopBgm', timer: 'StopTimer',
      };
      return { type: kinds[ctx.what[0].image], loc };
    }
    // A bare `stop` ends this script.
    return { type: 'Stop', target: ctx.scope ? ctx.scope[0].image : 'this', loc };
  }

  startStatement(ctx, node) {
    const kinds = { draw: 'StartDraw', fill: 'StartFill', timer: 'StartTimer' };
    return { type: kinds[ctx.what[0].image], loc: nodeLoc(node) };
  }

  resetStatement(ctx, node) {
    const kinds = { size: 'ResetSize', timer: 'ResetTimer' };
    return { type: kinds[ctx.what[0].image], loc: nodeLoc(node) };
  }

  clearStatement(ctx, node) {
    return { type: 'Clear', target: ctx.what[0].image, loc: nodeLoc(node) };
  }

  signalStatement(ctx, node) {
    return {
      type: 'Send',
      signal: this.visit(ctx.signal),
      wait: ctx.kind[0].image === 'call',
      loc: nodeLoc(node),
    };
  }

  cloneStatement(ctx, node) {
    return {
      type: 'Clone',
      target: ctx.target ? this.visit(ctx.target) : null,
      loc: nodeLoc(node),
    };
  }

  deleteStatement(ctx, node) {
    return { type: ctx.all ? 'DeleteClones' : 'DeleteClone', loc: nodeLoc(node) };
  }

  jumpStatement(ctx, node) {
    return {
      type: 'Jump',
      target: ctx.where ? ctx.where[0].image : this.visit(ctx.target),
      loc: nodeLoc(node),
    };
  }

  // ==========================================================================
  //  Movement
  // ==========================================================================
  forwardStatement(ctx, node) {
    return {
      type: 'Forward',
      distance: this.visit(ctx.distance),
      angle: ctx.angle ? this.visit(ctx.angle) : null,
      loc: nodeLoc(node),
    };
  }

  bounceStatement(ctx, node) {
    return { type: 'Bounce', loc: nodeLoc(node) };
  }

  pointArgs(ctx) {
    return {
      x: this.visit(ctx.x),
      y: this.visit(ctx.y),
      duration: ctx.duration ? this.visit(ctx.duration) : null,
    };
  }

  moveStatement(ctx, node) {
    return { type: 'Move', ...this.visit(ctx.point), loc: nodeLoc(node) };
  }

  goStatement(ctx, node) {
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

  turnStatement(ctx, node) {
    return {
      type: ctx.kind[0].image === 'turn' ? 'Turn' : 'Steer',
      angle: this.visit(ctx.angle),
      duration: ctx.duration ? this.visit(ctx.duration) : null,
      loc: nodeLoc(node),
    };
  }

  lookStatement(ctx, node) {
    return { type: 'Look', target: this.visit(ctx.target), loc: nodeLoc(node) };
  }

  // ==========================================================================
  //  Looks and speech
  // ==========================================================================
  showHideStatement(ctx, node) {
    return {
      type: ctx.kind[0].image === 'show' ? 'Show' : 'Hide',
      target: ctx.target ? this.visit(ctx.target) : null,
      loc: nodeLoc(node),
    };
  }

  costumeStepStatement(ctx, node) {
    return {
      type: 'CostumeStep',
      direction: ctx.direction[0].image,
      loc: nodeLoc(node),
    };
  }

  sayStatement(ctx, node) {
    return {
      type: ctx.kind[0].image === 'say' ? 'Say' : 'Think',
      message: this.visit(ctx.message),
      duration: ctx.duration ? this.visit(ctx.duration) : null,
      loc: nodeLoc(node),
    };
  }

  flipStatement(ctx, node) {
    return { type: 'Flip', axis: ctx.axis[0].image, loc: nodeLoc(node) };
  }

  orderStatement(ctx, node) {
    return { type: 'Order', to: ctx.to[0].image, loc: nodeLoc(node) };
  }

  // ==========================================================================
  //  Text box, pen and sound
  // ==========================================================================
  textStatement(ctx, node) {
    return {
      type: 'TextWrite',
      mode: ctx.mode[0].image,
      value: this.visit(ctx.value),
      loc: nodeLoc(node),
    };
  }

  penStatement(ctx, node) {
    return { type: 'Stamp', loc: nodeLoc(node) };
  }

  soundStatement(ctx, node) {
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

  readStatement(ctx, node) {
    return {
      type: 'Read',
      value: this.visit(ctx.value),
      wait: Boolean(ctx.wait),
      loc: nodeLoc(node),
    };
  }

  ttsStatement(ctx, node) {
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
  listAddStatement(ctx, node) {
    const loc = nodeLoc(node);
    const list = this.visit(ctx.list);
    if (ctx.add) return { type: 'ListAdd', list, value: this.visit(ctx.value), loc };
    return {
      type: 'ListInsert',
      list,
      value: this.visit(ctx.value),
      index: this.visit(ctx.index),
      loc,
    };
  }

  listRemoveStatement(ctx, node) {
    return {
      type: 'ListRemove',
      list: this.visit(ctx.list),
      index: this.visit(ctx.index),
      loc: nodeLoc(node),
    };
  }

  askStatement(ctx, node) {
    return { type: 'Ask', question: this.visit(ctx.question), loc: nodeLoc(node) };
  }

  // ==========================================================================
  //  Assignment and calls
  // ==========================================================================
  assignOrCall(ctx, node) {
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

  lvalue(ctx, node) {
    const name = this.visit(ctx.name);
    if (!ctx.index) return name;
    return {
      type: 'Index',
      target: name,
      index: this.visit(ctx.index),
      loc: nodeLoc(node),
    };
  }

  assignOperator(ctx) {
    return onlyToken(ctx).image;
  }

  // ==========================================================================
  //  Expressions
  // ==========================================================================
  expr(ctx) {
    return this.visit(ctx.orExpr);
  }

  orExpr(ctx) {
    return this.foldBinary(ctx);
  }

  andExpr(ctx) {
    return this.foldBinary(ctx);
  }

  notExpr(ctx) {
    return this.foldPrefix(ctx.operators ?? [], ctx.operand, 'not');
  }

  compareExpr(ctx) {
    return this.foldBinary(ctx);
  }

  addExpr(ctx) {
    return this.foldBinary(ctx);
  }

  mulExpr(ctx) {
    return this.foldBinary(ctx);
  }

  powExpr(ctx) {
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

  unaryExpr(ctx) {
    return this.foldPrefix(ctx.operators ?? [], ctx.operand, '-');
  }

  posExpr(ctx) {
    return this.visit(ctx.unaryExpr);
  }

  primaryExpr(ctx, node) {
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

  callExpr(ctx, node) {
    return {
      type: 'Call',
      callee: this.visit(ctx.callee).name,
      arguments: (ctx.args ?? []).map((arg) => this.visit(arg)),
      loc: nodeLoc(node),
    };
  }

  indexExpr(ctx, node) {
    return {
      type: 'Index',
      target: this.visit(ctx.target),
      index: this.visit(ctx.index),
      loc: nodeLoc(node),
    };
  }

  listLiteral(ctx, node) {
    return {
      type: 'ListLiteral',
      elements: (ctx.elements ?? []).map((element) => this.visit(element)),
      loc: nodeLoc(node),
    };
  }

  // ==========================================================================
  //  Terminals
  // ==========================================================================
  identifier(ctx) {
    const token = ctx.name[0];
    return { type: 'Identifier', name: token.image, loc: tokenLoc(token) };
  }

  booleanLiteral(ctx) {
    const token = ctx.value[0];
    return { type: 'Boolean', value: token.image === 'true', loc: tokenLoc(token) };
  }

  signedNumber(ctx, node) {
    const text = (ctx.sign ? '-' : '') + ctx.number[0].image;
    return { type: 'Number', value: parseFloat(text), loc: nodeLoc(node) };
  }
}

export const visitor = new TessAstVisitor();

/** Turns a parsed rule into its AST. */
export function toAst(cst, sourceLength) {
  visitor.sourceLength = sourceLength;
  return visitor.visit(cst);
}
