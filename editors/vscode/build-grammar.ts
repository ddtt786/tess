// ============================================================================
//  파서의 키워드 목록과 builtins.ts 를 읽어 VS Code 문법 강조 파일을 만든다.
//  (손으로 키워드를 옮겨 적지 않도록 — 언어가 바뀌면 다시 돌리면 된다)
//
//  실행:  node editors/vscode/build-grammar.mjs
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILTIN_FUNCTIONS, OPTION_KEYWORDS, STATE_VALUES, OBJECT_PROPERTIES, TEXT_ONLY_PROPERTIES } from '@tess/core/builtins';
import { KEYWORDS } from '@tess/parser';

const here = path.dirname(fileURLToPath(import.meta.url));

/** 렉서가 쓰는 키워드 목록이 그대로 강조 대상이 된다 */
const keywords = new Set(KEYWORDS);

/** 낱말 경계 (Tess 식별자는 _ 와 한글도 쓴다) */
const word = (list: Iterable<string>) => `(?<![A-Za-z0-9_])(?:${[...list].sort((a, b) => b.length - a.length).join('|')})(?![A-Za-z0-9_])`;

const DECLARATION = ['project', 'scene', 'object', 'text', 'table', 'function', 'use', 'useobject', 'usetext', 'var', 'list'];
// Storage scope of a global declaration: cloud (`shared`) and real-time (`realtime`).
const STORAGE = ['shared', 'realtime'];
// Modifiers trailing a declaration: `as "name"`, `force id "..."`, `default costume`.
const MODIFIER = ['as', 'force', 'id', 'default'];
const CONTROL = ['if', 'else', 'end', 'then', 'do', 'repeat', 'while', 'until', 'forever',
  'wait', 'break', 'skip', 'restart', 'stop', 'return'];
const EVENT = ['when', 'cloned', 'signal', 'click', 'stage', 'key', 'start'];
const OPERATOR_WORDS = ['and', 'or', 'not', 'in', 'at', 'to', 'from', 'for', 'up'];
const CONSTANTS = ['true', 'false', 'transparent', 'next', 'prev', 'back', 'front', 'first', 'last',
  'all', 'this', 'me', 'them', 'other', 'free', 'vertical', 'none', ...OPTION_KEYWORDS];

const PROPERTIES = [...new Set([...OBJECT_PROPERTIES, ...TEXT_ONLY_PROPERTIES])];

// 위 갈래에 넣지 않은 나머지 키워드는 전부 "명령"으로 본다
// Keywords that double as property names (`x`, `size`, `costume`) go to PROPERTIES.
const claimed = new Set([...DECLARATION, ...STORAGE, ...MODIFIER, ...CONTROL, ...EVENT,
  ...OPERATOR_WORDS, ...CONSTANTS, ...PROPERTIES]);
const COMMANDS = [...keywords].filter((keyword) => !claimed.has(keyword));

const grammar = {
  $schema: 'https://raw.githubusercontent.com/martinring/tmlanguage/master/tmlanguage.json',
  name: 'Tess',
  scopeName: 'source.tess',
  patterns: [{ include: '#comment' }, { include: '#string' }, { include: '#color' },
    { include: '#number' }, { include: '#declaration' }, { include: '#function-call' },
    { include: '#keyword' }, { include: '#operator' }, { include: '#punctuation' },
    { include: '#identifier' }],
  repository: {
    // `#` 은 주석이지만 `#ff0000` 은 색이다 (문법의 comment 규칙과 같은 판단)
    comment: {
      name: 'comment.line.number-sign.tess',
      match: '#(?![0-9a-fA-F]{6}(?![0-9a-zA-Z_])).*$',
    },
    string: {
      name: 'string.quoted.double.tess',
      begin: '"',
      end: '"',
      patterns: [{ name: 'constant.character.escape.tess', match: '\\\\(u[0-9a-fA-F]{4}|.)' }],
    },
    color: {
      name: 'constant.other.color.tess',
      match: '#[0-9a-fA-F]{6}(?![0-9a-zA-Z_])',
    },
    number: {
      name: 'constant.numeric.tess',
      match: '(?<![A-Za-z0-9_])[0-9]+(\\.[0-9]+)?',
    },
    // 선언 뒤에 오는 이름을 따로 칠한다
    declaration: {
      patterns: [
        {
          match: `(${word(['function'])})\\s+([A-Za-z_\\p{L}][A-Za-z0-9_\\p{L}]*)`,
          captures: { 1: { name: 'keyword.declaration.tess' }, 2: { name: 'entity.name.function.tess' } },
        },
        {
          match: `(${word(['table'])})\\s+([A-Za-z_\\p{L}][A-Za-z0-9_\\p{L}]*)`,
          captures: { 1: { name: 'keyword.declaration.tess' }, 2: { name: 'entity.name.type.tess' } },
        },
        {
          match: `(${word(['var', 'list'])})\\s+([A-Za-z_\\p{L}][A-Za-z0-9_\\p{L}]*)`,
          captures: { 1: { name: 'keyword.declaration.tess' }, 2: { name: 'variable.other.tess' } },
        },
        { name: 'keyword.declaration.tess', match: word(DECLARATION) },
      ],
    },
    'function-call': {
      patterns: [
        {
          name: 'support.function.builtin.tess',
          match: `${word(BUILTIN_FUNCTIONS)}(?=\\s*\\()`,
        },
        {
          match: '([A-Za-z_\\p{L}][A-Za-z0-9_\\p{L}]*)(?=\\s*\\()',
          captures: { 1: { name: 'entity.name.function.tess' } },
        },
      ],
    },
    keyword: {
      patterns: [
        { name: 'constant.language.tess', match: word(CONSTANTS) },
        { name: 'variable.language.tess', match: word(STATE_VALUES) },
        { name: 'storage.modifier.tess', match: word([...STORAGE, ...MODIFIER]) },
        { name: 'keyword.control.tess', match: word(CONTROL) },
        { name: 'keyword.control.event.tess', match: word(EVENT) },
        { name: 'support.variable.property.tess', match: word(PROPERTIES) },
        { name: 'keyword.other.command.tess', match: word(COMMANDS) },
      ],
    },
    operator: {
      patterns: [
        { name: 'keyword.operator.assignment.tess', match: '\\*\\*=|[+\\-*/%]=|=(?!=)' },
        { name: 'keyword.operator.comparison.tess', match: '==|!=|>=|<=|>|<' },
        { name: 'keyword.operator.arithmetic.tess', match: '\\*\\*|//|[+\\-*/%]' },
        { name: 'keyword.operator.word.tess', match: word(OPERATOR_WORDS) },
        { name: 'keyword.operator.optional.tess', match: '\\?' },
      ],
    },
    punctuation: {
      patterns: [
        { name: 'punctuation.section.block.begin.tess', match: ':' },
        { name: 'punctuation.separator.comma.tess', match: ',' },
        { name: 'meta.brace.round.tess', match: '[()]' },
        { name: 'meta.brace.square.tess', match: '[\\[\\]]' },
      ],
    },
    identifier: {
      name: 'variable.other.tess',
      match: '[A-Za-z_\\p{L}][A-Za-z0-9_\\p{L}]*',
    },
  },
};

const out = path.join(here, 'syntaxes', 'tess.tmLanguage.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${JSON.stringify(grammar, null, 2)}\n`);
console.log(`${path.relative(process.cwd(), out)} 만듦 — 키워드 ${keywords.size}개, 명령 ${COMMANDS.length}개`);
