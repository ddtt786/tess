// ============================================================================
//  Tess lexer — token definitions
//
//  Words are lexed as identifiers and then retagged by exact image. This
//  reproduces the grammar's `"word" ~identifierPart` closure without relying on
//  pattern ordering, and keeps every non-reserved keyword usable as a name.
// ============================================================================
import { createToken, Lexer } from 'chevrotain';

// Identifier shape follows the grammar: letters are Unicode, digits are ASCII.
const IDENT_START = '[\\p{L}_]';
const IDENT_PART = '[\\p{L}0-9_]';

// The lexer re-creates each pattern with a sticky flag and drops `u` doing so,
// which would turn `\p{L}` into a literal character class. Matching by hand
// keeps the Unicode property escapes working.
function unicodePattern(source) {
  const sticky = new RegExp(source, 'yu');
  return (text, startOffset) => {
    sticky.lastIndex = startOffset;
    return sticky.exec(text);
  };
}

/** Keyword literals, in the order the language reference declares them. */
export const KEYWORDS = [
  'add', 'all', 'and', 'append', 'as', 'ask', 'at', 'back', 'bgm', 'bounce', 'break',
  'bubble', 'call', 'center', 'clear', 'click', 'clone', 'cloned', 'clones',
  'chart', 'column', 'columns', 'costume', 'default', 'del', 'description', 'do', 'draw', 'effects', 'else',
  'end', 'false', 'fill', 'flip', 'for', 'force', 'forever', 'forward', 'fps',
  'free', 'from', 'front', 'first', 'function', 'go', 'hide', 'id', 'if', 'in',
  'insert', 'jump', 'key', 'kill', 'last', 'list', 'lock', 'look', 'me', 'move',
  'name', 'next', 'none', 'not', 'object', 'or', 'order', 'other', 'pitch',
  'play', 'prepend', 'prev', 'project', 'read', 'realtime', 'remove', 'repeat',
  'reset', 'restart', 'return', 'rotation', 'row', 'save', 'say', 'scene', 'send',
  'shared', 'signal', 'show',
  'size', 'skip', 'sound', 'speed', 'stage', 'stamp', 'start', 'steer', 'stop',
  'table', 'text', 'them', 'then', 'think', 'this', 'timer', 'title', 'to', 'transparent',
  'true', 'tts', 'turn', 'until', 'up', 'use', 'useobject', 'usetext', 'var',
  'vertical', 'visible', 'voice', 'wait', 'when', 'while', 'write', 'x', 'y',
];

// The only words that may not be used as a name. Everything else stays
// available, so `var size = 5` and `say next` keep working.
export const RESERVED = new Set([
  'and', 'or', 'not', 'true', 'false', 'end', 'then', 'do', 'in', 'wait',
]);

// Statements that are complete on their own. The parser commits to these at the
// keyword, so they cannot stand on the left of an assignment either.
export const STANDALONE_STATEMENTS = new Set([
  'break', 'skip', 'restart', 'stop', 'bounce', 'stamp', 'show', 'hide',
  'clone', 'kill',
]);

/** Words that cannot name a variable, because they read as a statement first. */
export const UNUSABLE_AS_NAME = new Set([...RESERVED, ...STANDALONE_STATEMENTS]);

/** Category matched by every token that may stand where a name is expected. */
export const IdentLike = createToken({ name: 'IdentLike', pattern: Lexer.NA, label: '이름' });

export const Identifier = createToken({
  name: 'Identifier',
  pattern: unicodePattern(`${IDENT_START}${IDENT_PART}*`),
  line_breaks: false,
  label: '이름',
  categories: [IdentLike],
});

// Keyword tokens never match on their own; `retag` assigns them after lexing.
/** @type {Record<string, import('chevrotain').TokenType>} */
export const kw = {};
for (const word of KEYWORDS) {
  kw[word] = createToken({
    name: `kw_${word}`,
    pattern: Lexer.NA,
    label: `'${word}'`,
    categories: RESERVED.has(word) ? [] : [IdentLike],
  });
}

/** Maps a word to the keyword token it should carry. */
const KEYWORD_TOKENS = new Map(KEYWORDS.map((word) => [word, kw[word]]));

// --- literals ---------------------------------------------------------------
// A color is six hex digits not followed by more name characters; anything else
// starting with `#` is a comment. Color is listed first so it wins the tie.
export const ColorLiteral = createToken({
  name: 'ColorLiteral',
  pattern: unicodePattern(`#[0-9a-fA-F]{6}(?!${IDENT_PART})`),
  line_breaks: false,
  label: '색상',
  start_chars_hint: ['#'],
});

export const NumberLiteral = createToken({
  name: 'NumberLiteral',
  pattern: /\d+\.\d+|\d+/,
  label: '숫자',
});

// `\` escapes any single character, including a line break.
export const StringLiteral = createToken({
  name: 'StringLiteral',
  pattern: /"(?:\\[\s\S]|[^"\\\n\r\u2028\u2029])*"/,
  label: '\ubb38\uc790\uc5f4',
});

// --- skipped ----------------------------------------------------------------
export const WhiteSpace = createToken({
  name: 'WhiteSpace',
  pattern: /\s+/,
  group: Lexer.SKIPPED,
  line_breaks: true,
});

export const Comment = createToken({
  name: 'Comment',
  pattern: /#[^\n\r\u2028\u2029]*/,
  group: Lexer.SKIPPED,
});

// --- operators and punctuation ----------------------------------------------
// Longest first, so `**=` beats `**` beats `*`. This is what makes the
// grammar's `~"="` and `~"*"` guards unnecessary here.
const operator = (name, literal) => createToken({ name, pattern: literal, label: `'${literal}'` });

export const PowAssign = operator('PowAssign', '**=');
export const Pow = operator('Pow', '**');
export const PlusAssign = operator('PlusAssign', '+=');
export const MinusAssign = operator('MinusAssign', '-=');
export const StarAssign = operator('StarAssign', '*=');
export const SlashAssign = operator('SlashAssign', '/=');
export const PercentAssign = operator('PercentAssign', '%=');
export const Eq = operator('Eq', '==');
export const Ne = operator('Ne', '!=');
export const Le = operator('Le', '<=');
export const Ge = operator('Ge', '>=');
export const IntDiv = operator('IntDiv', '//');
export const Plus = operator('Plus', '+');
export const Minus = operator('Minus', '-');
export const Star = operator('Star', '*');
export const Slash = operator('Slash', '/');
export const Percent = operator('Percent', '%');
export const Lt = operator('Lt', '<');
export const Gt = operator('Gt', '>');
export const Assign = operator('Assign', '=');
export const LParen = operator('LParen', '(');
export const RParen = operator('RParen', ')');
export const LSquare = operator('LSquare', '[');
export const RSquare = operator('RSquare', ']');
export const Comma = operator('Comma', ',');
export const Colon = operator('Colon', ':');
export const Question = operator('Question', '?');

/** The `=`-family operators that `AssignStatement` accepts. */
export const ASSIGN_OPERATORS = [
  PlusAssign, MinusAssign, PowAssign, StarAssign, SlashAssign, PercentAssign, Assign,
];

// Order matters: the lexer takes the first pattern that matches.
export const ALL_TOKENS = [
  WhiteSpace,
  ColorLiteral,
  Comment,
  StringLiteral,
  NumberLiteral,
  PowAssign, Pow, PlusAssign, MinusAssign, StarAssign, SlashAssign, PercentAssign,
  Eq, Ne, Le, Ge, IntDiv,
  Plus, Minus, Star, Slash, Percent, Lt, Gt, Assign,
  LParen, RParen, LSquare, RSquare, Comma, Colon, Question,
  Identifier,
  IdentLike,
  ...KEYWORDS.map((word) => kw[word]),
];

const lexer = new Lexer(ALL_TOKENS, { positionTracking: 'full' });

/** Retags identifier tokens whose image is a keyword. */
function retag(tokens) {
  for (const token of tokens) {
    if (token.tokenTypeIdx !== Identifier.tokenTypeIdx) continue;
    const type = KEYWORD_TOKENS.get(token.image);
    if (!type) continue;
    token.tokenType = type;
    token.tokenTypeIdx = type.tokenTypeIdx;
  }
  return tokens;
}

/**
 * @param {string} source
 * @returns {{tokens: Array, errors: Array}}
 */
export function tokenize(source) {
  const result = lexer.tokenize(source);
  return { tokens: retag(result.tokens), errors: result.errors };
}
