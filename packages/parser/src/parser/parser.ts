/**
 * @fileoverview Tess 구문 분석기 (Chevrotain 기반 문법)
 * 
 * 언어 명세서의 규칙을 일대일로 반영하되, 원활한 파싱을 위해 다음과 같이 조정되었습니다:
 * 1. 공통된 접두사를 가진 대체 규칙들은 선택적 꼬리를 갖는 하나의 규칙으로 병합되었습니다 (예: `say Expr (for Expr)?`).
 * 2. 순서가 중요한 선택 규칙의 경우 명시적인 게이트를 두어, PEG 파서처럼 처음 매칭되는 대안이 반드시 선택되도록 보장합니다.
 */
import { CstParser, EOF, tokenLabel } from 'chevrotain';
import type {
  CstNode, IParserErrorMessageProvider, IToken, ParserMethod, TokenType,
} from 'chevrotain';
import {
  ALL_TOKENS, ASSIGN_OPERATORS, Assign, ColorLiteral, Colon, Comma, Eq, Ge, Gt,
  IdentLike, Identifier, IntDiv, LParen, LSquare, Le, Lt, Minus, Ne,
  NumberLiteral, Percent, Plus, Pow, Question, RParen, RSquare, Slash, Star,
  STANDALONE_STATEMENTS, StringLiteral, kw,
} from './tokens.ts';

const idx = (tokenType: TokenType) => tokenType.tokenTypeIdx!;
const idxSet = (...tokenTypes: TokenType[]) => new Set(tokenTypes.map(idx));

/** Names that may take an initial value with `=` in an object body. */
const PROPERTY_NAMES = new Set([
  'scale_x', 'scale_y', 'size',
  'text_content', 'text_bold', 'text_italic',
  'text_underline', 'text_strikethrough', 'text_align',
  'font_color', 'font_size', 'font', 'bg_color', 'line_break',
  'draw_color', 'draw_width', 'draw_alpha', 'fill_color',
  'angle', 'way', 'x', 'y',
]);

const ASSIGN_OPERATOR_IDS = new Set(ASSIGN_OPERATORS.map(idx));

/** Keywords that begin a statement form. */
const STATEMENT_LEADERS = idxSet(
  kw.if, kw.repeat, kw.while, kw.until, kw.forever, kw.wait, kw.return,
  kw.break, kw.skip, kw.restart, kw.stop, kw.start, kw.reset, kw.clear,
  kw.send, kw.call, kw.clone, kw.del, kw.kill, kw.jump, kw.forward, kw.bounce,
  kw.move, kw.go, kw.turn, kw.steer, kw.look, kw.show, kw.hide, kw.next,
  kw.prev, kw.say, kw.think, kw.flip, kw.order, kw.write, kw.append,
  kw.prepend, kw.stamp, kw.play, kw.read, kw.tts, kw.in, kw.remove, kw.ask,
  kw.var, kw.list, kw.save,
);

// Statements that are complete on their own. The grammar commits to these as
// soon as it sees the keyword, so `stop = 5` is an error rather than an
// assignment to a variable named `stop`.
const STANDALONE_LEADERS = idxSet(...[...STANDALONE_STATEMENTS].map((word) => kw[word]));

/** First set of Expr — what may legally begin an expression. */
const EXPR_STARTERS = idxSet(
  LParen, Minus, kw.not, NumberLiteral, StringLiteral, kw.true, kw.false,
  ColorLiteral,
);

/** What the reader actually sees at the point the parse stopped. */
const found = (token: IToken | undefined) => (!token || token.tokenTypeIdx === idx(EOF)
  ? '입력이 끝났습니다'
  : `'${token.image}' 이(가) 있습니다`);

/** Messages the parser reports, in the language the rest of the tool speaks. */
const errorMessageProvider: IParserErrorMessageProvider = {
  buildMismatchTokenMessage: ({ expected, actual }) => `${tokenLabel(expected)} 이(가) 와야 하는데 ${found(actual)}.`,
  buildNoViableAltMessage: ({ actual }) => `여기서 시작할 수 있는 문법이 없습니다 — ${found(actual[0])}.`,
  buildEarlyExitMessage: ({ actual }) => `여기서 시작할 수 있는 문법이 없습니다 — ${found(actual[0])}.`,
  buildNotAllInputParsedMessage: ({ firstRedundant }) => `입력의 끝이 와야 하는데 ${found(firstRedundant)}.`,
};

/** A grammar rule as `$.RULE` installs it — no arguments, one CST node out. */
type Rule = ParserMethod<[], CstNode>;

export class TessParser extends CstParser {
  // Every rule below is installed by `$.RULE` in the constructor.
  declare readonly addExpr: Rule;
  declare readonly andExpr: Rule;
  declare readonly askStatement: Rule;
  declare readonly assignOperator: Rule;
  declare readonly assignOrCall: Rule;
  declare readonly block: Rule;
  declare readonly blockOpen: Rule;
  declare readonly booleanLiteral: Rule;
  declare readonly bounceStatement: Rule;
  declare readonly callExpr: Rule;
  declare readonly clearStatement: Rule;
  declare readonly cloneStatement: Rule;
  declare readonly compareExpr: Rule;
  declare readonly costumeProperty: Rule;
  declare readonly costumeStepStatement: Rule;
  declare readonly deleteStatement: Rule;
  declare readonly displayName: Rule;
  declare readonly eventHandler: Rule;
  declare readonly expr: Rule;
  declare readonly flipStatement: Rule;
  declare readonly flowStatement: Rule;
  declare readonly forceId: Rule;
  declare readonly foreverStatement: Rule;
  declare readonly forwardStatement: Rule;
  declare readonly functionDecl: Rule;
  declare readonly functionParam: Rule;
  declare readonly goStatement: Rule;
  declare readonly identifier: Rule;
  declare readonly ifStatement: Rule;
  declare readonly indexExpr: Rule;
  declare readonly jumpStatement: Rule;
  declare readonly listAddStatement: Rule;
  declare readonly listDecl: Rule;
  declare readonly listLiteral: Rule;
  declare readonly listRemoveStatement: Rule;
  declare readonly lookStatement: Rule;
  declare readonly lvalue: Rule;
  declare readonly moveStatement: Rule;
  declare readonly mulExpr: Rule;
  declare readonly notExpr: Rule;
  declare readonly objectDecl: Rule;
  declare readonly objectFragment: Rule;
  declare readonly objectMember: Rule;
  declare readonly orExpr: Rule;
  declare readonly orderStatement: Rule;
  declare readonly penStatement: Rule;
  declare readonly pointArgs: Rule;
  declare readonly posExpr: Rule;
  declare readonly powExpr: Rule;
  declare readonly primaryExpr: Rule;
  declare readonly program: Rule;
  declare readonly projectDecl: Rule;
  declare readonly projectField: Rule;
  declare readonly propertyDecl: Rule;
  declare readonly propertyName: Rule;
  declare readonly readStatement: Rule;
  declare readonly repeatStatement: Rule;
  declare readonly resetStatement: Rule;
  declare readonly returnStatement: Rule;
  declare readonly rotateMethod: Rule;
  declare readonly saveStatement: Rule;
  declare readonly sayStatement: Rule;
  declare readonly sceneDecl: Rule;
  declare readonly sceneFragment: Rule;
  declare readonly sceneMember: Rule;
  declare readonly sceneNameDecl: Rule;
  declare readonly showHideStatement: Rule;
  declare readonly signalStatement: Rule;
  declare readonly signedNumber: Rule;
  declare readonly soundProperty: Rule;
  declare readonly soundStatement: Rule;
  declare readonly startStatement: Rule;
  declare readonly statement: Rule;
  declare readonly stopStatement: Rule;
  declare readonly storageScope: Rule;
  declare readonly tableCells: Rule;
  declare readonly tableColumns: Rule;
  declare readonly tableDecl: Rule;
  declare readonly tableLine: Rule;
  declare readonly tableRow: Rule;
  declare readonly textStatement: Rule;
  declare readonly topLevelItem: Rule;
  declare readonly ttsStatement: Rule;
  declare readonly turnStatement: Rule;
  declare readonly unaryExpr: Rule;
  declare readonly untilStatement: Rule;
  declare readonly useDecl: Rule;
  declare readonly useObjectDecl: Rule;
  declare readonly varDecl: Rule;
  declare readonly waitStatement: Rule;
  declare readonly whileStatement: Rule;

  constructor() {
    super(ALL_TOKENS, {
      nodeLocationTracking: 'full',
      maxLookahead: 2,
      errorMessageProvider,
    });
    const $ = this;

    // ========================================================================
    //  Program and declarations
    // ========================================================================
    $.RULE('program', () => {
      $.MANY({ GATE: () => $.startsTopLevelItem(), DEF: () => $.SUBRULE($.topLevelItem) });
    });

    // `use` splices a file in place, so a fragment may hold only the members
    // that belong at the position it is included from.
    $.RULE('sceneFragment', () => {
      $.MANY({ GATE: () => !$.atBlockEnd(), DEF: () => $.SUBRULE($.sceneMember) });
    });

    $.RULE('objectFragment', () => {
      $.MANY({ GATE: () => !$.atBlockEnd(), DEF: () => $.SUBRULE($.objectMember) });
    });

    $.RULE('topLevelItem', () => {
      $.OR([
        { ALT: () => $.SUBRULE($.projectDecl) },
        { ALT: () => $.SUBRULE($.sceneDecl) },
        { ALT: () => $.SUBRULE($.objectDecl) },
        { ALT: () => $.SUBRULE($.functionDecl) },
        { ALT: () => $.SUBRULE($.useObjectDecl) },
        { ALT: () => $.SUBRULE($.useDecl) },
        { ALT: () => $.SUBRULE($.varDecl) },
        { ALT: () => $.SUBRULE($.listDecl) },
        { ALT: () => $.SUBRULE($.tableDecl) },
      ]);
    });

    // A table (엔트리 "테이블") — a named grid with one header row.
    $.RULE('tableDecl', () => {
      $.CONSUME(kw.table);
      $.SUBRULE($.identifier, { LABEL: 'name' });
      $.OPTION(() => $.SUBRULE($.displayName, { LABEL: 'displayName' }));
      $.CONSUME(Colon);
      $.SUBRULE($.tableColumns, { LABEL: 'columns' });
      $.MANY(() => $.SUBRULE($.tableRow, { LABEL: 'rows' }));
      $.CONSUME(kw.end);
    });

    $.RULE('tableColumns', () => {
      $.CONSUME(kw.columns);
      $.SUBRULE($.tableCells, { LABEL: 'cells' });
    });

    $.RULE('tableRow', () => {
      $.CONSUME(kw.row);
      $.SUBRULE($.tableCells, { LABEL: 'cells' });
    });

    $.RULE('tableCells', () => {
      $.SUBRULE($.expr, { LABEL: 'cell' });
      $.MANY(() => {
        $.CONSUME(Comma);
        $.SUBRULE2($.expr, { LABEL: 'cell' });
      });
    });

    $.RULE('useDecl', () => {
      $.CONSUME(kw.use);
      $.CONSUME(StringLiteral, { LABEL: 'path' });
    });

    $.RULE('useObjectDecl', () => {
      $.OR([
        { ALT: () => $.CONSUME(kw.useobject, { LABEL: 'kind' }) },
        { ALT: () => $.CONSUME(kw.usetext, { LABEL: 'kind' }) },
      ]);
      $.CONSUME(StringLiteral, { LABEL: 'path' });
    });

    $.RULE('projectDecl', () => {
      $.CONSUME(kw.project);
      $.SUBRULE($.blockOpen);
      $.MANY({ GATE: () => !$.atBlockEnd(), DEF: () => $.SUBRULE($.projectField) });
      $.CONSUME(kw.end);
    });

    $.RULE('projectField', () => {
      $.OR([
        {
          ALT: () => {
            $.CONSUME(kw.title, { LABEL: 'field' });
            $.CONSUME(StringLiteral, { LABEL: 'text' });
          },
        },
        {
          ALT: () => {
            $.CONSUME(kw.description, { LABEL: 'field' });
            $.CONSUME2(StringLiteral, { LABEL: 'text' });
          },
        },
        {
          ALT: () => {
            $.CONSUME(kw.fps, { LABEL: 'field' });
            $.CONSUME(NumberLiteral, { LABEL: 'number' });
          },
        },
      ]);
    });

    $.RULE('sceneDecl', () => {
      $.CONSUME(kw.scene);
      $.CONSUME(StringLiteral, { LABEL: 'name' });
      $.SUBRULE($.blockOpen);
      $.MANY({ GATE: () => !$.atBlockEnd(), DEF: () => $.SUBRULE($.sceneMember) });
      $.CONSUME(kw.end);
    });

    $.RULE('sceneMember', () => {
      $.OR([
        { ALT: () => $.SUBRULE($.objectDecl) },
        { ALT: () => $.SUBRULE($.useObjectDecl) },
        { ALT: () => $.SUBRULE($.useDecl) },
        { ALT: () => $.SUBRULE($.sceneNameDecl) },
      ]);
    });

    // Gives the scene a display name separate from the identifier scripts jump to.
    $.RULE('sceneNameDecl', () => {
      $.CONSUME(kw.name);
      $.CONSUME(StringLiteral, { LABEL: 'text' });
    });

    $.RULE('objectDecl', () => {
      $.OR([
        { ALT: () => $.CONSUME(kw.object, { LABEL: 'kind' }) },
        { ALT: () => $.CONSUME(kw.text, { LABEL: 'kind' }) },
      ]);
      $.CONSUME(StringLiteral, { LABEL: 'name' });
      $.SUBRULE($.blockOpen);
      $.MANY({ GATE: () => !$.atBlockEnd(), DEF: () => $.SUBRULE($.objectMember) });
      $.CONSUME(kw.end);
    });

    // Property declarations are listed last here, not first as in the reference.
    // None of the keywords below can begin a property, so the order is moot.
    $.RULE('objectMember', () => {
      $.OR([
        { ALT: () => $.SUBRULE($.varDecl) },
        { ALT: () => $.SUBRULE($.listDecl) },
        { ALT: () => $.SUBRULE($.functionDecl) },
        { ALT: () => $.SUBRULE($.eventHandler) },
        { ALT: () => $.SUBRULE($.useDecl) },
        { ALT: () => $.SUBRULE($.propertyDecl) },
      ]);
    });

    // ========================================================================
    //  Object properties
    // ========================================================================
    $.RULE('propertyDecl', () => {
      $.OR({
        IGNORE_AMBIGUITIES: true,
        DEF: [
          { ALT: () => $.SUBRULE($.costumeProperty) },
          { ALT: () => $.SUBRULE($.soundProperty) },
          {
            ALT: () => {
              $.CONSUME(kw.name, { LABEL: 'nameKeyword' });
              $.CONSUME(StringLiteral, { LABEL: 'text' });
            },
          },
          {
            ALT: () => {
              $.CONSUME(kw.visible, { LABEL: 'flag' });
              $.SUBRULE($.booleanLiteral, { LABEL: 'value' });
            },
          },
          {
            ALT: () => {
              $.CONSUME(kw.lock, { LABEL: 'flag' });
              $.SUBRULE2($.booleanLiteral, { LABEL: 'value' });
            },
          },
          {
            ALT: () => {
              $.CONSUME(kw.rotation);
              $.SUBRULE($.rotateMethod, { LABEL: 'method' });
            },
          },
          // A text box frame size. `size = 100` is the scale property instead,
          // so the numbers are what tells the two apart.
          {
            GATE: () => $.LA(1).tokenTypeIdx === idx(kw.size)
              && $.LA(2).tokenTypeIdx === idx(NumberLiteral),
            ALT: () => {
              $.CONSUME(kw.size);
              $.CONSUME(NumberLiteral, { LABEL: 'width' });
              $.CONSUME2(NumberLiteral, { LABEL: 'height' });
            },
          },
          {
            ALT: () => {
              $.CONSUME(kw.center);
              $.SUBRULE($.signedNumber, { LABEL: 'x' });
              $.SUBRULE2($.signedNumber, { LABEL: 'y' });
            },
          },
          {
            ALT: () => {
              $.SUBRULE($.propertyName, { LABEL: 'target' });
              $.CONSUME(Assign, { LABEL: 'assign' });
              $.SUBRULE($.expr, { LABEL: 'value' });
            },
          },
        ],
      });
    });

    $.RULE('propertyName', () => {
      $.OR([
        { ALT: () => $.CONSUME(kw.size) },
        { ALT: () => $.CONSUME(kw.x) },
        { ALT: () => $.CONSUME(kw.y) },
        {
          GATE: () => PROPERTY_NAMES.has($.LA(1).image),
          ALT: () => $.CONSUME(Identifier),
        },
      ]);
    });

    $.RULE('costumeProperty', () => {
      $.OPTION(() => $.CONSUME(kw.default, { LABEL: 'isDefault' }));
      $.CONSUME(kw.costume);
      $.SUBRULE($.identifier, { LABEL: 'id' });
      $.CONSUME(StringLiteral, { LABEL: 'file' });
      $.OPTION2(() => {
        $.CONSUME(kw.size);
        $.CONSUME(NumberLiteral, { LABEL: 'width' });
        $.CONSUME2(NumberLiteral, { LABEL: 'height' });
      });
      $.OPTION4(() => $.SUBRULE($.displayName, { LABEL: 'displayName' }));
      $.OPTION3(() => $.SUBRULE($.forceId, { LABEL: 'forceId' }));
    });

    $.RULE('soundProperty', () => {
      $.CONSUME(kw.sound);
      $.SUBRULE($.identifier, { LABEL: 'id' });
      $.CONSUME(StringLiteral, { LABEL: 'file' });
      $.OPTION(() => {
        $.CONSUME(kw.for);
        $.CONSUME(NumberLiteral, { LABEL: 'duration' });
      });
      $.OPTION3(() => $.SUBRULE($.displayName, { LABEL: 'displayName' }));
      $.OPTION2(() => $.SUBRULE($.forceId, { LABEL: 'forceId' }));
    });

    // The Entry name a resource actually carries, when it cannot be spelled as
    // a Tess identifier. Runtime lookups by name ("모양으로 바꾸기") use it.
    $.RULE('displayName', () => {
      $.CONSUME(kw.as);
      $.CONSUME(StringLiteral, { LABEL: 'text' });
    });

    // Pins an asset to a fixed Entry id instead of deriving one from a seed.
    $.RULE('forceId', () => {
      $.CONSUME(kw.force);
      $.CONSUME(kw.id);
      $.CONSUME(StringLiteral, { LABEL: 'text' });
    });

    $.RULE('rotateMethod', () => {
      $.OR([
        { ALT: () => $.CONSUME(kw.free) },
        { ALT: () => $.CONSUME(kw.vertical) },
        { ALT: () => $.CONSUME(kw.none) },
      ]);
    });

    // ========================================================================
    //  Functions, variables and lists
    // ========================================================================
    $.RULE('functionDecl', () => {
      $.CONSUME(kw.function);
      $.SUBRULE($.identifier, { LABEL: 'name' });
      $.CONSUME(LParen);
      $.MANY_SEP({
        SEP: Comma,
        DEF: () => $.SUBRULE($.functionParam, { LABEL: 'params' }),
      });
      $.CONSUME(RParen);
      $.SUBRULE($.blockOpen);
      $.SUBRULE($.block, { LABEL: 'body' });
      $.CONSUME(kw.end);
    });

    // A trailing `?` marks a parameter that stays a judgement after compiling.
    $.RULE('functionParam', () => {
      $.SUBRULE($.identifier, { LABEL: 'name' });
      $.OPTION(() => $.CONSUME(Question, { LABEL: 'boolean' }));
    });

    // `shared` marks an Entry cloud variable, `realtime` a real-time one.
    $.RULE('storageScope', () => {
      $.OR([
        { ALT: () => $.CONSUME(kw.shared, { LABEL: 'shared' }) },
        { ALT: () => $.CONSUME(kw.realtime, { LABEL: 'realtime' }) },
      ]);
    });

    $.RULE('varDecl', () => {
      $.OPTION(() => $.SUBRULE($.storageScope, { LABEL: 'scope' }));
      $.CONSUME(kw.var);
      $.SUBRULE($.identifier, { LABEL: 'name' });
      $.OPTION2(() => $.SUBRULE($.displayName, { LABEL: 'displayName' }));
      $.CONSUME(Assign);
      $.SUBRULE($.expr, { LABEL: 'value' });
    });

    $.RULE('listDecl', () => {
      $.OPTION(() => $.SUBRULE($.storageScope, { LABEL: 'scope' }));
      $.CONSUME(kw.list);
      $.SUBRULE($.identifier, { LABEL: 'name' });
      $.OPTION2(() => $.SUBRULE($.displayName, { LABEL: 'displayName' }));
      $.CONSUME(Assign);
      $.SUBRULE($.listLiteral, { LABEL: 'value' });
    });

    // ========================================================================
    //  Events
    // ========================================================================
    $.RULE('eventHandler', () => {
      $.CONSUME(kw.when);
      $.OR([
        {
          ALT: () => {
            $.CONSUME(kw.scene, { LABEL: 'sceneStart' });
            $.CONSUME(kw.start);
          },
        },
        { ALT: () => $.CONSUME2(kw.start, { LABEL: 'start' }) },
        {
          ALT: () => {
            $.CONSUME(kw.key, { LABEL: 'key' });
            $.CONSUME(StringLiteral, { LABEL: 'keyName' });
            $.OPTION(() => $.CONSUME(kw.up, { LABEL: 'up' }));
          },
        },
        {
          ALT: () => {
            $.CONSUME(kw.stage, { LABEL: 'stage' });
            $.CONSUME(kw.click);
            $.OPTION2(() => $.CONSUME2(kw.up, { LABEL: 'up' }));
          },
        },
        {
          ALT: () => {
            $.CONSUME2(kw.click, { LABEL: 'click' });
            $.OPTION3(() => $.CONSUME3(kw.up, { LABEL: 'up' }));
          },
        },
        {
          ALT: () => {
            $.CONSUME(kw.signal, { LABEL: 'signal' });
            $.CONSUME2(StringLiteral, { LABEL: 'signalName' });
          },
        },
        { ALT: () => $.CONSUME(kw.cloned, { LABEL: 'cloned' }) },
      ]);
      $.SUBRULE($.blockOpen);
      $.SUBRULE($.block, { LABEL: 'body' });
      $.CONSUME(kw.end);
    });

    // ========================================================================
    //  Statements
    // ========================================================================
    $.RULE('blockOpen', () => {
      $.OR([
        { ALT: () => $.CONSUME(Colon) },
        { ALT: () => $.CONSUME(kw.then) },
        { ALT: () => $.CONSUME(kw.do) },
      ]);
    });

    $.RULE('block', () => {
      $.MANY({
        GATE: () => $.startsStatement(),
        DEF: () => $.SUBRULE($.statement, { LABEL: 'statements' }),
      });
    });

    // Dispatch is by leading keyword. Each gate also lets a keyword fall through
    // to assignment when it is being used as a variable name (`say = 5`).
    $.RULE('statement', () => {
      $.OR({
        IGNORE_AMBIGUITIES: true,
        DEF: [
          { GATE: () => $.leads(kw.if), ALT: () => $.SUBRULE($.ifStatement) },
          { GATE: () => $.leads(kw.repeat), ALT: () => $.SUBRULE($.repeatStatement) },
          { GATE: () => $.leads(kw.while), ALT: () => $.SUBRULE($.whileStatement) },
          { GATE: () => $.leads(kw.until), ALT: () => $.SUBRULE($.untilStatement) },
          { GATE: () => $.leads(kw.forever), ALT: () => $.SUBRULE($.foreverStatement) },
          { GATE: () => $.leads(kw.wait), ALT: () => $.SUBRULE($.waitStatement) },
          { GATE: () => $.leads(kw.return), ALT: () => $.SUBRULE($.returnStatement) },
          { GATE: () => $.leadsAny(kw.break, kw.skip, kw.restart), ALT: () => $.SUBRULE($.flowStatement) },
          { GATE: () => $.leads(kw.stop), ALT: () => $.SUBRULE($.stopStatement) },
          { GATE: () => $.leads(kw.start), ALT: () => $.SUBRULE($.startStatement) },
          { GATE: () => $.leads(kw.reset), ALT: () => $.SUBRULE($.resetStatement) },
          { GATE: () => $.leads(kw.clear), ALT: () => $.SUBRULE($.clearStatement) },
          { GATE: () => $.leadsAny(kw.send, kw.call), ALT: () => $.SUBRULE($.signalStatement) },
          { GATE: () => $.leads(kw.clone), ALT: () => $.SUBRULE($.cloneStatement) },
          { GATE: () => $.leadsAny(kw.del, kw.kill), ALT: () => $.SUBRULE($.deleteStatement) },
          { GATE: () => $.leads(kw.jump), ALT: () => $.SUBRULE($.jumpStatement) },
          { GATE: () => $.leads(kw.forward), ALT: () => $.SUBRULE($.forwardStatement) },
          { GATE: () => $.leads(kw.bounce), ALT: () => $.SUBRULE($.bounceStatement) },
          { GATE: () => $.leads(kw.move), ALT: () => $.SUBRULE($.moveStatement) },
          { GATE: () => $.leads(kw.go), ALT: () => $.SUBRULE($.goStatement) },
          { GATE: () => $.leadsAny(kw.turn, kw.steer), ALT: () => $.SUBRULE($.turnStatement) },
          { GATE: () => $.leads(kw.look), ALT: () => $.SUBRULE($.lookStatement) },
          { GATE: () => $.leadsAny(kw.show, kw.hide), ALT: () => $.SUBRULE($.showHideStatement) },
          { GATE: () => $.leadsAny(kw.next, kw.prev), ALT: () => $.SUBRULE($.costumeStepStatement) },
          { GATE: () => $.leadsAny(kw.say, kw.think), ALT: () => $.SUBRULE($.sayStatement) },
          { GATE: () => $.leads(kw.flip), ALT: () => $.SUBRULE($.flipStatement) },
          { GATE: () => $.leads(kw.order), ALT: () => $.SUBRULE($.orderStatement) },
          { GATE: () => $.leadsAny(kw.write, kw.append, kw.prepend), ALT: () => $.SUBRULE($.textStatement) },
          { GATE: () => $.leads(kw.stamp), ALT: () => $.SUBRULE($.penStatement) },
          { GATE: () => $.leads(kw.play), ALT: () => $.SUBRULE($.soundStatement) },
          { GATE: () => $.leads(kw.read), ALT: () => $.SUBRULE($.readStatement) },
          { GATE: () => $.leads(kw.tts), ALT: () => $.SUBRULE($.ttsStatement) },
          { GATE: () => $.leads(kw.in), ALT: () => $.SUBRULE($.listAddStatement) },
          { GATE: () => $.leads(kw.remove), ALT: () => $.SUBRULE($.listRemoveStatement) },
          { GATE: () => $.leads(kw.ask), ALT: () => $.SUBRULE($.askStatement) },
          { GATE: () => $.leads(kw.save), ALT: () => $.SUBRULE($.saveStatement) },
          { GATE: () => $.leadsDecl(kw.var), ALT: () => $.SUBRULE($.varDecl) },
          { GATE: () => $.leadsDecl(kw.list), ALT: () => $.SUBRULE($.listDecl) },
          { ALT: () => $.SUBRULE($.assignOrCall) },
        ],
      });
    });

    $.RULE('ifStatement', () => {
      $.CONSUME(kw.if);
      $.SUBRULE($.expr, { LABEL: 'test' });
      $.SUBRULE($.blockOpen);
      $.SUBRULE($.block, { LABEL: 'consequent' });
      $.OPTION(() => {
        $.CONSUME(kw.else);
        $.SUBRULE2($.blockOpen);
        $.SUBRULE2($.block, { LABEL: 'alternate' });
      });
      $.CONSUME(kw.end);
    });

    const loopRule = (name: string, keyword: TokenType) => $.RULE(name, () => {
      $.CONSUME(keyword);
      $.SUBRULE($.expr, { LABEL: 'test' });
      $.SUBRULE($.blockOpen);
      $.SUBRULE($.block, { LABEL: 'body' });
      $.CONSUME(kw.end);
    });
    loopRule('repeatStatement', kw.repeat);
    loopRule('whileStatement', kw.while);
    loopRule('untilStatement', kw.until);

    $.RULE('foreverStatement', () => {
      $.CONSUME(kw.forever);
      $.SUBRULE($.blockOpen);
      $.SUBRULE($.block, { LABEL: 'body' });
      $.CONSUME(kw.end);
    });

    $.RULE('waitStatement', () => {
      $.CONSUME(kw.wait);
      $.SUBRULE($.expr, { LABEL: 'value' });
    });

    $.RULE('flowStatement', () => {
      $.OR([
        { ALT: () => $.CONSUME(kw.break, { LABEL: 'kind' }) },
        { ALT: () => $.CONSUME(kw.skip, { LABEL: 'kind' }) },
        { ALT: () => $.CONSUME(kw.restart, { LABEL: 'kind' }) },
      ]);
    });

    $.RULE('returnStatement', () => {
      $.CONSUME(kw.return);
      $.SUBRULE($.expr, { LABEL: 'value' });
    });

    // `stop` changes meaning entirely with what follows it.
    $.RULE('stopStatement', () => {
      $.CONSUME(kw.stop);
      $.OPTION(() => {
        $.OR([
          {
            ALT: () => {
              $.CONSUME(kw.sound, { LABEL: 'sound' });
              $.OR2([
                { ALT: () => $.CONSUME(kw.this, { LABEL: 'target' }) },
                { ALT: () => $.CONSUME(kw.all, { LABEL: 'target' }) },
              ]);
            },
          },
          { ALT: () => $.CONSUME(kw.draw, { LABEL: 'what' }) },
          { ALT: () => $.CONSUME(kw.fill, { LABEL: 'what' }) },
          { ALT: () => $.CONSUME(kw.bgm, { LABEL: 'what' }) },
          { ALT: () => $.CONSUME(kw.timer, { LABEL: 'what' }) },
          { ALT: () => $.CONSUME(kw.other, { LABEL: 'scope' }) },
          { ALT: () => $.CONSUME(kw.me, { LABEL: 'scope' }) },
          { ALT: () => $.CONSUME(kw.them, { LABEL: 'scope' }) },
          { ALT: () => $.CONSUME2(kw.all, { LABEL: 'scope' }) },
        ]);
      });
    });

    $.RULE('startStatement', () => {
      $.CONSUME(kw.start);
      $.OR([
        { ALT: () => $.CONSUME(kw.draw, { LABEL: 'what' }) },
        { ALT: () => $.CONSUME(kw.fill, { LABEL: 'what' }) },
        { ALT: () => $.CONSUME(kw.timer, { LABEL: 'what' }) },
      ]);
    });

    $.RULE('resetStatement', () => {
      $.CONSUME(kw.reset);
      $.OR([
        { ALT: () => $.CONSUME(kw.size, { LABEL: 'what' }) },
        { ALT: () => $.CONSUME(kw.timer, { LABEL: 'what' }) },
      ]);
    });

    $.RULE('clearStatement', () => {
      $.CONSUME(kw.clear);
      $.OR([
        { ALT: () => $.CONSUME(kw.effects, { LABEL: 'what' }) },
        { ALT: () => $.CONSUME(kw.bubble, { LABEL: 'what' }) },
        { ALT: () => $.CONSUME(kw.draw, { LABEL: 'what' }) },
        { ALT: () => $.CONSUME(kw.text, { LABEL: 'what' }) },
      ]);
    });

    $.RULE('signalStatement', () => {
      $.OR([
        { ALT: () => $.CONSUME(kw.send, { LABEL: 'kind' }) },
        { ALT: () => $.CONSUME(kw.call, { LABEL: 'kind' }) },
      ]);
      $.SUBRULE($.expr, { LABEL: 'signal' });
    });

    // The argument must sit on the same line, or a bare `clone` would swallow
    // the identifier that starts the next line.
    $.RULE('cloneStatement', () => {
      $.CONSUME(kw.clone);
      $.OPTION({
        GATE: () => $.sameLine() && $.startsExpr(),
        DEF: () => $.SUBRULE($.expr, { LABEL: 'target' }),
      });
    });

    $.RULE('deleteStatement', () => {
      $.OR([
        {
          ALT: () => {
            $.CONSUME(kw.del);
            $.OR2([
              { ALT: () => $.CONSUME(kw.clones, { LABEL: 'all' }) },
              { ALT: () => $.CONSUME(kw.clone, { LABEL: 'one' }) },
            ]);
          },
        },
        { ALT: () => $.CONSUME(kw.kill, { LABEL: 'one' }) },
      ]);
    });

    $.RULE('jumpStatement', () => {
      $.CONSUME(kw.jump);
      // `next` and `back` name the two relative scenes, so they win over reading
      // the same word as a variable holding a scene name.
      $.OR({
        IGNORE_AMBIGUITIES: true,
        DEF: [
          { ALT: () => $.CONSUME(kw.next, { LABEL: 'where' }) },
          { ALT: () => $.CONSUME(kw.back, { LABEL: 'where' }) },
          { ALT: () => $.SUBRULE($.expr, { LABEL: 'target' }) },
        ],
      });
    });

    // ========================================================================
    //  Movement
    // ========================================================================
    $.RULE('forwardStatement', () => {
      $.CONSUME(kw.forward);
      $.SUBRULE($.expr, { LABEL: 'distance' });
      $.OPTION(() => {
        $.CONSUME(kw.at);
        $.SUBRULE2($.expr, { LABEL: 'angle' });
      });
    });

    $.RULE('bounceStatement', () => $.CONSUME(kw.bounce));

    // Both coordinates are unary expressions, so `move 50 -30` is two arguments
    // rather than one subtraction. Wrap in parentheses to do arithmetic.
    $.RULE('moveStatement', () => {
      $.CONSUME(kw.move);
      $.SUBRULE($.pointArgs, { LABEL: 'point' });
    });

    $.RULE('pointArgs', () => {
      $.SUBRULE($.posExpr, { LABEL: 'x' });
      $.OR([
        { GATE: () => $.sameLine(), ALT: () => $.SUBRULE2($.posExpr, { LABEL: 'y' }) },
      ]);
      $.OPTION(() => {
        $.CONSUME(kw.in);
        $.SUBRULE($.expr, { LABEL: 'duration' });
      });
    });

    // `go` takes either a point or a single target, and only trying the point
    // form first tells them apart — `go a + b` is a target, `go 1 2` is a point.
    $.RULE('goStatement', () => {
      $.CONSUME(kw.go);
      $.OR({
        IGNORE_AMBIGUITIES: true,
        DEF: [
          {
            GATE: $.BACKTRACK($.pointArgs),
            ALT: () => $.SUBRULE($.pointArgs, { LABEL: 'point' }),
          },
          {
            ALT: () => {
              $.SUBRULE($.expr, { LABEL: 'target' });
              $.OPTION(() => {
                $.CONSUME(kw.in);
                $.SUBRULE2($.expr, { LABEL: 'duration' });
              });
            },
          },
        ],
      });
    });

    $.RULE('turnStatement', () => {
      $.OR([
        { ALT: () => $.CONSUME(kw.turn, { LABEL: 'kind' }) },
        { ALT: () => $.CONSUME(kw.steer, { LABEL: 'kind' }) },
      ]);
      $.SUBRULE($.expr, { LABEL: 'angle' });
      $.OPTION(() => {
        $.CONSUME(kw.in);
        $.SUBRULE2($.expr, { LABEL: 'duration' });
      });
    });

    $.RULE('lookStatement', () => {
      $.CONSUME(kw.look);
      $.SUBRULE($.expr, { LABEL: 'target' });
    });

    // ========================================================================
    //  Looks and speech
    // ========================================================================
    $.RULE('showHideStatement', () => {
      $.OR([
        { ALT: () => $.CONSUME(kw.show, { LABEL: 'kind' }) },
        { ALT: () => $.CONSUME(kw.hide, { LABEL: 'kind' }) },
      ]);
      $.OPTION({
        GATE: () => $.sameLine() && $.isIdentLike($.LA(1)),
        DEF: () => $.SUBRULE($.identifier, { LABEL: 'target' }),
      });
      // `show 표 for 3` closes the table again after N seconds, and
      // `show 표 chart 1` opens one of the table's saved charts instead.
      $.OPTION2({
        GATE: () => $.sameLine(),
        DEF: () => $.OR2([
          {
            ALT: () => {
              $.CONSUME(kw.for);
              $.SUBRULE($.expr, { LABEL: 'seconds' });
            },
          },
          {
            ALT: () => {
              $.CONSUME(kw.chart);
              $.SUBRULE2($.expr, { LABEL: 'chart' });
            },
          },
        ]),
      });
    });

    $.RULE('costumeStepStatement', () => {
      $.OR([
        { ALT: () => $.CONSUME(kw.next, { LABEL: 'direction' }) },
        { ALT: () => $.CONSUME(kw.prev, { LABEL: 'direction' }) },
      ]);
      $.CONSUME(kw.costume);
    });

    $.RULE('sayStatement', () => {
      $.OR([
        { ALT: () => $.CONSUME(kw.say, { LABEL: 'kind' }) },
        { ALT: () => $.CONSUME(kw.think, { LABEL: 'kind' }) },
      ]);
      $.SUBRULE($.expr, { LABEL: 'message' });
      $.OPTION(() => {
        $.CONSUME(kw.for);
        $.SUBRULE2($.expr, { LABEL: 'duration' });
      });
    });

    $.RULE('flipStatement', () => {
      $.CONSUME(kw.flip);
      $.OR([
        { ALT: () => $.CONSUME(kw.x, { LABEL: 'axis' }) },
        { ALT: () => $.CONSUME(kw.y, { LABEL: 'axis' }) },
      ]);
    });

    $.RULE('orderStatement', () => {
      $.CONSUME(kw.order);
      $.OR([
        { ALT: () => $.CONSUME(kw.front, { LABEL: 'to' }) },
        { ALT: () => $.CONSUME(kw.back, { LABEL: 'to' }) },
        { ALT: () => $.CONSUME(kw.first, { LABEL: 'to' }) },
        { ALT: () => $.CONSUME(kw.last, { LABEL: 'to' }) },
      ]);
    });

    // ========================================================================
    //  Text box, pen and sound
    // ========================================================================
    $.RULE('textStatement', () => {
      $.OR([
        { ALT: () => $.CONSUME(kw.write, { LABEL: 'mode' }) },
        { ALT: () => $.CONSUME(kw.append, { LABEL: 'mode' }) },
        { ALT: () => $.CONSUME(kw.prepend, { LABEL: 'mode' }) },
      ]);
      $.SUBRULE($.expr, { LABEL: 'value' });
    });

    $.RULE('penStatement', () => $.CONSUME(kw.stamp));

    $.RULE('soundStatement', () => {
      $.CONSUME(kw.play);
      $.OR([
        {
          ALT: () => {
            $.CONSUME(kw.sound, { LABEL: 'sound' });
            $.SUBRULE($.expr, { LABEL: 'name' });
            $.OPTION(() => {
              $.OR2([
                {
                  ALT: () => {
                    $.CONSUME(kw.for);
                    $.SUBRULE2($.expr, { LABEL: 'duration' });
                  },
                },
                {
                  ALT: () => {
                    $.CONSUME(kw.from);
                    $.SUBRULE3($.expr, { LABEL: 'from' });
                    $.CONSUME(kw.to);
                    $.SUBRULE4($.expr, { LABEL: 'to' });
                  },
                },
              ]);
            });
            $.OPTION2(() => {
              $.CONSUME(kw.and);
              $.CONSUME(kw.wait, { LABEL: 'wait' });
            });
          },
        },
        {
          ALT: () => {
            $.CONSUME(kw.bgm, { LABEL: 'bgm' });
            $.SUBRULE5($.expr, { LABEL: 'name' });
          },
        },
      ]);
    });

    $.RULE('readStatement', () => {
      $.CONSUME(kw.read);
      $.SUBRULE($.expr, { LABEL: 'value' });
      $.OPTION(() => {
        $.CONSUME(kw.and);
        $.CONSUME(kw.wait, { LABEL: 'wait' });
      });
    });

    $.RULE('ttsStatement', () => {
      $.CONSUME(kw.tts);
      $.CONSUME(kw.voice);
      $.CONSUME(StringLiteral, { LABEL: 'voice' });
      $.CONSUME(kw.speed);
      $.CONSUME2(StringLiteral, { LABEL: 'speed' });
      $.CONSUME(kw.pitch);
      $.CONSUME3(StringLiteral, { LABEL: 'pitch' });
    });

    // ========================================================================
    //  Data
    // ========================================================================
    $.RULE('listAddStatement', () => {
      $.CONSUME(kw.in);
      $.SUBRULE($.identifier, { LABEL: 'list' });
      $.OR([
        {
          GATE: () => $.leadsAny(kw.add) && $.LA(2).tokenTypeIdx !== idx(kw.row)
            && $.LA(2).tokenTypeIdx !== idx(kw.column),
          ALT: () => {
            $.CONSUME(kw.add, { LABEL: 'add' });
            $.SUBRULE($.expr, { LABEL: 'value' });
          },
        },
        {
          GATE: () => $.LA(1).tokenTypeIdx === idx(kw.insert)
            && $.LA(2).tokenTypeIdx !== idx(kw.row) && $.LA(2).tokenTypeIdx !== idx(kw.column),
          ALT: () => {
            $.CONSUME(kw.insert, { LABEL: 'insert' });
            $.SUBRULE2($.expr, { LABEL: 'value' });
            $.CONSUME(kw.at);
            $.SUBRULE3($.expr, { LABEL: 'index' });
          },
        },
        {
          ALT: () => {
            $.OR2([
              { ALT: () => $.CONSUME2(kw.add, { LABEL: 'addLine' }) },
              { ALT: () => $.CONSUME2(kw.insert, { LABEL: 'insertLine' }) },
            ]);
            $.SUBRULE($.tableLine, { LABEL: 'line' });
            $.OPTION(() => {
              $.CONSUME2(kw.at);
              $.SUBRULE4($.expr, { LABEL: 'index' });
            });
          },
        },
      ]);
    });

    /** `row` or `column` — which way a table grows or shrinks. */
    $.RULE('tableLine', () => {
      $.OR([
        { ALT: () => $.CONSUME(kw.row, { LABEL: 'row' }) },
        { ALT: () => $.CONSUME(kw.column, { LABEL: 'column' }) },
      ]);
    });

    $.RULE('listRemoveStatement', () => {
      $.CONSUME(kw.remove);
      $.SUBRULE($.identifier, { LABEL: 'list' });
      $.OR([
        {
          ALT: () => {
            $.CONSUME(LSquare);
            $.SUBRULE($.expr, { LABEL: 'index' });
            $.CONSUME(RSquare);
          },
        },
        {
          ALT: () => {
            $.SUBRULE($.tableLine, { LABEL: 'line' });
            $.SUBRULE2($.expr, { LABEL: 'index' });
          },
        },
      ]);
    });

    $.RULE('askStatement', () => {
      $.CONSUME(kw.ask);
      $.SUBRULE($.expr, { LABEL: 'question' });
    });

    /** `save 표` — writes the table's current contents back over the saved one. */
    $.RULE('saveStatement', () => {
      $.CONSUME(kw.save);
      $.SUBRULE($.identifier, { LABEL: 'table' });
    });

    // ========================================================================
    //  Assignment and calls
    // ========================================================================
    $.RULE('assignOrCall', () => {
      $.OR({
        IGNORE_AMBIGUITIES: true,
        DEF: [
          {
            GATE: () => $.LA(2).tokenTypeIdx === idx(LParen),
            ALT: () => $.SUBRULE($.callExpr, { LABEL: 'call' }),
          },
          {
            ALT: () => {
              $.SUBRULE($.lvalue, { LABEL: 'target' });
              $.SUBRULE($.assignOperator, { LABEL: 'operator' });
              $.SUBRULE($.expr, { LABEL: 'value' });
            },
          },
        ],
      });
    });

    $.RULE('lvalue', () => {
      $.SUBRULE($.identifier, { LABEL: 'name' });
      $.OPTION(() => {
        $.CONSUME(LSquare);
        $.SUBRULE($.expr, { LABEL: 'index' });
        $.OPTION2(() => {
          $.CONSUME(Comma);
          $.SUBRULE2($.expr, { LABEL: 'column' });
        });
        $.CONSUME(RSquare);
      });
    });

    $.RULE('assignOperator', () => {
      $.OR(ASSIGN_OPERATORS.map((token) => ({ ALT: () => $.CONSUME(token) })));
    });

    // ========================================================================
    //  Expressions, lowest precedence first
    // ========================================================================
    $.RULE('expr', () => $.SUBRULE($.orExpr));

    $.RULE('orExpr', () => {
      $.SUBRULE($.andExpr, { LABEL: 'operands' });
      $.MANY(() => {
        $.CONSUME(kw.or, { LABEL: 'operators' });
        $.SUBRULE2($.andExpr, { LABEL: 'operands' });
      });
    });

    $.RULE('andExpr', () => {
      $.SUBRULE($.notExpr, { LABEL: 'operands' });
      // `and wait` ends a sound or read command, so `and` only continues the
      // expression when an operand can follow it.
      $.MANY({
        GATE: () => $.LA(1).tokenTypeIdx === idx(kw.and) && $.startsExprAt(2),
        DEF: () => {
          $.CONSUME(kw.and, { LABEL: 'operators' });
          $.SUBRULE2($.notExpr, { LABEL: 'operands' });
        },
      });
    });

    $.RULE('notExpr', () => {
      $.MANY(() => $.CONSUME(kw.not, { LABEL: 'operators' }));
      $.SUBRULE($.compareExpr, { LABEL: 'operand' });
    });

    $.RULE('compareExpr', () => {
      $.SUBRULE($.addExpr, { LABEL: 'operands' });
      $.MANY(() => {
        $.OR([
          { ALT: () => $.CONSUME(Eq, { LABEL: 'operators' }) },
          { ALT: () => $.CONSUME(Ne, { LABEL: 'operators' }) },
          { ALT: () => $.CONSUME(Le, { LABEL: 'operators' }) },
          { ALT: () => $.CONSUME(Ge, { LABEL: 'operators' }) },
          { ALT: () => $.CONSUME(Lt, { LABEL: 'operators' }) },
          { ALT: () => $.CONSUME(Gt, { LABEL: 'operators' }) },
        ]);
        $.SUBRULE2($.addExpr, { LABEL: 'operands' });
      });
    });

    $.RULE('addExpr', () => {
      $.SUBRULE($.mulExpr, { LABEL: 'operands' });
      $.MANY(() => {
        $.OR([
          { ALT: () => $.CONSUME(Plus, { LABEL: 'operators' }) },
          { ALT: () => $.CONSUME(Minus, { LABEL: 'operators' }) },
        ]);
        $.SUBRULE2($.mulExpr, { LABEL: 'operands' });
      });
    });

    $.RULE('mulExpr', () => {
      $.SUBRULE($.powExpr, { LABEL: 'operands' });
      $.MANY(() => {
        $.OR([
          { ALT: () => $.CONSUME(IntDiv, { LABEL: 'operators' }) },
          { ALT: () => $.CONSUME(Star, { LABEL: 'operators' }) },
          { ALT: () => $.CONSUME(Slash, { LABEL: 'operators' }) },
          { ALT: () => $.CONSUME(Percent, { LABEL: 'operators' }) },
        ]);
        $.SUBRULE2($.powExpr, { LABEL: 'operands' });
      });
    });

    // Right associative: 2 ** 3 ** 2 is 2 ** (3 ** 2).
    $.RULE('powExpr', () => {
      $.SUBRULE($.unaryExpr, { LABEL: 'base' });
      $.OPTION(() => {
        $.CONSUME(Pow);
        $.SUBRULE($.powExpr, { LABEL: 'exponent' });
      });
    });

    $.RULE('unaryExpr', () => {
      $.MANY(() => $.CONSUME(Minus, { LABEL: 'operators' }));
      $.SUBRULE($.primaryExpr, { LABEL: 'operand' });
    });

    /** The argument form used where a command lists two values separated by space. */
    $.RULE('posExpr', () => $.SUBRULE($.unaryExpr));

    $.RULE('primaryExpr', () => {
      $.OR({
        IGNORE_AMBIGUITIES: true,
        DEF: [
          {
            ALT: () => {
              $.CONSUME(LParen);
              $.SUBRULE($.expr, { LABEL: 'inner' });
              $.CONSUME(RParen);
            },
          },
          {
            GATE: () => $.LA(2).tokenTypeIdx === idx(LParen),
            ALT: () => $.SUBRULE($.callExpr, { LABEL: 'call' }),
          },
          {
            GATE: () => $.LA(2).tokenTypeIdx === idx(LSquare),
            ALT: () => $.SUBRULE($.indexExpr, { LABEL: 'index' }),
          },
          { ALT: () => $.CONSUME(NumberLiteral, { LABEL: 'number' }) },
          { ALT: () => $.CONSUME(StringLiteral, { LABEL: 'string' }) },
          { ALT: () => $.SUBRULE($.booleanLiteral, { LABEL: 'boolean' }) },
          { ALT: () => $.CONSUME(ColorLiteral, { LABEL: 'color' }) },
          { ALT: () => $.CONSUME(kw.transparent, { LABEL: 'transparent' }) },
          { ALT: () => $.SUBRULE($.identifier, { LABEL: 'name' }) },
        ],
      });
    });

    // Calls only attach to a name, so a `(` after a line break never reads as a
    // call on the expression above it.
    $.RULE('callExpr', () => {
      $.SUBRULE($.identifier, { LABEL: 'callee' });
      $.CONSUME(LParen);
      $.MANY_SEP({ SEP: Comma, DEF: () => $.SUBRULE($.expr, { LABEL: 'args' }) });
      $.CONSUME(RParen);
    });

    // `표[2, "점수"]` reads a table cell; one index reads a list item or, on a
    // table, a spreadsheet cell reference such as `표["B2"]`.
    $.RULE('indexExpr', () => {
      $.SUBRULE($.identifier, { LABEL: 'target' });
      $.CONSUME(LSquare);
      $.SUBRULE($.expr, { LABEL: 'index' });
      $.OPTION(() => {
        $.CONSUME(Comma);
        $.SUBRULE2($.expr, { LABEL: 'column' });
      });
      $.CONSUME(RSquare);
    });

    $.RULE('listLiteral', () => {
      $.CONSUME(LSquare);
      $.MANY_SEP({ SEP: Comma, DEF: () => $.SUBRULE($.expr, { LABEL: 'elements' }) });
      $.CONSUME(RSquare);
    });

    // ========================================================================
    //  Terminals
    // ========================================================================
    $.RULE('identifier', () => $.CONSUME(IdentLike, { LABEL: 'name' }));

    $.RULE('booleanLiteral', () => {
      $.OR([
        { ALT: () => $.CONSUME(kw.true, { LABEL: 'value' }) },
        { ALT: () => $.CONSUME(kw.false, { LABEL: 'value' }) },
      ]);
    });

    // Only an attached sign counts, so `- 5` still reads as a subtraction.
    $.RULE('signedNumber', () => {
      $.OPTION({
        GATE: () => {
          const sign = $.LA(1);
          const number = $.LA(2);
          return sign.tokenTypeIdx === idx(Minus)
            && number.tokenTypeIdx === idx(NumberLiteral)
            && number.startOffset === sign.endOffset! + 1;
        },
        DEF: () => $.CONSUME(Minus, { LABEL: 'sign' }),
      });
      $.CONSUME(NumberLiteral, { LABEL: 'number' });
    });

    this.performSelfAnalysis();
  }

  // ==========================================================================
  //  Lookahead helpers
  // ==========================================================================

  /** True when the next token still sits on the line the last one ended on. */
  sameLine() {
    return this.LA(1).startLine === this.LA(0).endLine;
  }

  isIdentLike(token: IToken) {
    return token.tokenType?.CATEGORIES?.includes(IdentLike) ?? false;
  }

  /** True when the token `offset` ahead can begin an expression. */
  startsExprAt(offset: number) {
    const token = this.LA(offset);
    return EXPR_STARTERS.has(token.tokenTypeIdx) || this.isIdentLike(token);
  }

  startsExpr() {
    return this.startsExprAt(1);
  }

  /**
   * True when this keyword introduces its statement here. A keyword that also
   * works as a variable name gives way to assignment, unless its statement form
   * can stand alone — those commit before assignment is ever considered.
   */
  leads(tokenType: TokenType) {
    const token = this.LA(1);
    if (token.tokenTypeIdx !== tokenType.tokenTypeIdx) return false;
    if (STANDALONE_LEADERS.has(token.tokenTypeIdx)) return true;
    const next = this.LA(2);
    return !(ASSIGN_OPERATOR_IDS.has(next.tokenTypeIdx) || next.tokenTypeIdx === idx(LSquare));
  }

  leadsAny(...tokenTypes: TokenType[]) {
    return tokenTypes.some((tokenType) => this.leads(tokenType));
  }

  /**
   * True where a `var`/`list` declaration begins, including one prefixed by a
   * `shared`/`realtime` storage scope. Both prefixes stay usable as names, so
   * they only lead when the declaration keyword follows.
   */
  leadsDecl(tokenType: TokenType) {
    if (this.leads(tokenType)) return true;
    const token = this.LA(1);
    if (token.tokenTypeIdx !== idx(kw.shared) && token.tokenTypeIdx !== idx(kw.realtime)) return false;
    return this.LA(2).tokenTypeIdx === idx(tokenType);
  }

  atBlockEnd() {
    const token = this.LA(1);
    return token.tokenTypeIdx === idx(kw.end) || token.tokenTypeIdx === idx(EOF);
  }

  startsTopLevelItem() {
    const token = this.LA(1);
    if (token.tokenTypeIdx === idx(EOF)) return false;
    return [kw.project, kw.scene, kw.object, kw.text, kw.function, kw.useobject,
      kw.usetext, kw.use, kw.var, kw.list, kw.shared, kw.realtime, kw.table]
      .some((type) => token.tokenTypeIdx === idx(type));
  }

  /**
   * True when a statement can begin here. A name that is not a command must be
   * followed by `=`, `[` or `(` to start one, which is what lets a block end at
   * `else` — a word that is otherwise a perfectly good variable name.
   */
  startsStatement() {
    const token = this.LA(1);
    if (token.tokenTypeIdx === idx(EOF)) return false;
    if (STATEMENT_LEADERS.has(token.tokenTypeIdx)) return true;
    if (!this.isIdentLike(token)) return false;
    const next = this.LA(2);
    return ASSIGN_OPERATOR_IDS.has(next.tokenTypeIdx)
      || next.tokenTypeIdx === idx(LSquare)
      || next.tokenTypeIdx === idx(LParen);
  }
}

export const parser = new TessParser();
