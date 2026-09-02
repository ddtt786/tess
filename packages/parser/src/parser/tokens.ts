/**
 * Tess 어휘 분석기(Lexer)의 토큰 정의를 포함합니다.
 *
 * 키워드와 식별자(Identifier)를 정의하며, 어휘 분석 시 예약어와 일반 이름을 구분합니다.
 */
import { createToken, Lexer } from 'chevrotain';
import type { ILexingError, IToken, TokenType } from 'chevrotain';

/** 
 * 식별자의 시작 문자를 나타내는 정규식 패턴입니다. 유니코드 문자와 밑줄(_)을 허용합니다.
 * @example const IDENT_START = '[\\p{L}_]';
 */
const IDENT_START = '[\\p{L}_]';

/** 
 * 식별자의 구성 문자를 나타내는 정규식 패턴입니다. 유니코드 문자, 숫자, 밑줄(_)을 허용합니다.
 * @example const IDENT_PART = '[\\p{L}0-9_]';
 */
const IDENT_PART = '[\\p{L}0-9_]';

/**
 * 유니코드 정규식 속성을 유지하면서 텍스트를 분석하기 위한 함수입니다.
 * 
 * @param source 정규식 패턴 문자열
 * @returns 텍스트와 오프셋을 받아 매칭 결과를 반환하는 함수
 * @example
 * const pattern = unicodePattern('[\\p{L}_]');
 * const match = pattern("test", 0);
 */
function unicodePattern(source: string) {
  const sticky = new RegExp(source, 'yu');
  return (text: string, startOffset: number) => {
    sticky.lastIndex = startOffset;
    return sticky.exec(text);
  };
}

/** 
 * 언어 명세에 정의된 순서대로 나열된 키워드 목록입니다.
 * @example console.log(KEYWORDS.includes('if')); // true
 */
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

/**
 * 변수나 오브젝트 이름으로 사용할 수 없는 예약어 목록입니다.
 * @example RESERVED.has('and'); // true
 */
export const RESERVED = new Set([
  'and', 'or', 'not', 'true', 'false', 'end', 'then', 'do', 'in', 'wait',
]);

/**
 * 단독으로 문장이 될 수 있는 키워드 목록입니다. 
 * 이 키워드들은 할당문의 왼쪽에 올 수 없습니다.
 * @example STANDALONE_STATEMENTS.has('break'); // true
 */
export const STANDALONE_STATEMENTS = new Set([
  'break', 'skip', 'restart', 'stop', 'bounce', 'stamp', 'show', 'hide',
  'clone', 'kill',
]);

/** 
 * 변수 이름으로 사용할 수 없는 단어들의 목록입니다. 예약어와 단독 문장 키워드를 포함합니다.
 * @example UNUSABLE_AS_NAME.has('if'); // true
 */
export const UNUSABLE_AS_NAME = new Set([...RESERVED, ...STANDALONE_STATEMENTS]);

/** 
 * 이름이 위치할 수 있는 곳에 허용되는 모든 토큰의 카테고리입니다.
 */
export const IdentLike = createToken({ name: 'IdentLike', pattern: Lexer.NA, label: '이름' });

/**
 * 식별자를 나타내는 토큰입니다.
 */
export const Identifier = createToken({
  name: 'Identifier',
  pattern: unicodePattern(`${IDENT_START}${IDENT_PART}*`),
  line_breaks: false,
  label: '이름',
  categories: [IdentLike],
});

/**
 * 동적으로 생성된 키워드 토큰 객체 맵입니다.
 */
export const kw: Record<string, TokenType> = {};
for (const word of KEYWORDS) {
  kw[word] = createToken({
    name: `kw_${word}`,
    pattern: Lexer.NA,
    label: `'${word}'`,
    categories: RESERVED.has(word) ? [] : [IdentLike],
  });
}

/** 
 * 문자열 형태의 단어를 해당하는 키워드 토큰과 연결하는 맵입니다.
 */
const KEYWORD_TOKENS = new Map<string, TokenType>(KEYWORDS.map((word) => [word, kw[word]!]));

/**
 * 6자리의 16진수로 구성된 색상 리터럴을 나타내는 토큰입니다.
 * @example '#FF0000'
 */
export const ColorLiteral = createToken({
  name: 'ColorLiteral',
  pattern: unicodePattern(`#[0-9a-fA-F]{6}(?!${IDENT_PART})`),
  line_breaks: false,
  label: '색상',
  start_chars_hint: ['#'],
});

/**
 * 숫자 리터럴을 나타내는 토큰입니다. 정수와 소수를 포함합니다.
 * @example '123' 또는 '12.34'
 */
export const NumberLiteral = createToken({
  name: 'NumberLiteral',
  pattern: /\d+\.\d+|\d+/,
  label: '숫자',
});

/**
 * 문자열 리터럴을 나타내는 토큰입니다. 큰따옴표로 둘러싸인 텍스트를 매칭합니다.
 * @example '"안녕하세요"'
 */
export const StringLiteral = createToken({
  name: 'StringLiteral',
  pattern: /"(?:\\[\s\S]|[^"\\\n\r\u2028\u2029])*"/,
  label: '\ubb38\uc790\uc5f4', // '문자열'
});

/**
 * 공백 문자를 나타내는 토큰으로, 어휘 분석 과정에서 무시됩니다.
 */
export const WhiteSpace = createToken({
  name: 'WhiteSpace',
  pattern: /\s+/,
  group: Lexer.SKIPPED,
  line_breaks: true,
});

/**
 * 주석을 나타내는 토큰으로, 어휘 분석 과정에서 무시됩니다.
 */
export const Comment = createToken({
  name: 'Comment',
  pattern: /#[^\n\r\u2028\u2029]*/,
  group: Lexer.SKIPPED,
});

/**
 * 연산자 또는 구두점을 생성하는 헬퍼 함수입니다.
 * 
 * @param name 토큰 이름
 * @param literal 매칭될 문자열 형태의 기호
 * @returns 생성된 연산자 토큰
 */
const operator = (name: string, literal: string) => (
  createToken({ name, pattern: literal, label: `'${literal}'` })
);

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

/** 
 * 할당문에 허용되는 대입 연산자들의 목록입니다.
 */
export const ASSIGN_OPERATORS = [
  PlusAssign, MinusAssign, PowAssign, StarAssign, SlashAssign, PercentAssign, Assign,
];

/**
 * 어휘 분석기가 매칭할 모든 토큰의 배열입니다. 
 * 선언된 순서대로 매칭을 시도하므로 순서가 중요합니다.
 */
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
  ...KEYWORDS.map((word) => kw[word]!),
];

const lexer = new Lexer(ALL_TOKENS, { positionTracking: 'full' });

/** 
 * 어휘 분석된 토큰 중 키워드와 일치하는 식별자를 키워드 토큰으로 변환합니다.
 * 
 * @param tokens 분석된 토큰 배열
 * @returns 키워드 토큰으로 변환된 토큰 배열
 */
function retag(tokens: IToken[]) {
  for (const token of tokens) {
    if (token.tokenTypeIdx !== Identifier.tokenTypeIdx) continue;
    const type = KEYWORD_TOKENS.get(token.image);
    if (!type) continue;
    token.tokenType = type;
    token.tokenTypeIdx = type.tokenTypeIdx!;
  }
  return tokens;
}

/**
 * 입력된 소스 코드를 분석하여 토큰 배열과 에러 목록을 반환합니다.
 * 
 * @param source 파싱할 소스 코드 문자열
 * @returns 변환된 토큰 배열과 렉싱 에러가 포함된 객체
 * @example
 * const { tokens, errors } = tokenize("var a = 1");
 */
export function tokenize(source: string): { tokens: IToken[]; errors: ILexingError[] } {
  const result = lexer.tokenize(source);
  return { tokens: retag(result.tokens), errors: result.errors };
}

