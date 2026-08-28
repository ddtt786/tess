// ============================================================================
//  Generates the VS Code syntax highlighting grammar from tess.ohm and
//  builtins.js, so keywords stay in sync without manual copying.
//
//  Run:  node editors/vscode/build-grammar.mjs
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILTIN_FUNCTIONS, OPTION_KEYWORDS, STATE_VALUES, OBJECT_PROPERTIES, TEXT_ONLY_PROPERTIES } from '../../src/builtins.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const grammarSource = fs.readFileSync(path.join(here, '..', '..', 'src', 'tess.ohm'), 'utf-8');

/** Collects keywords from tess.ohm's `name = "text" ~identifierPart` rules. */
const keywords = new Set(
  [...grammarSource.matchAll(/^\s*[a-zA-Z_][a-zA-Z0-9_]*\s*=\s*"([^"]+)"\s*~identifierPart/gm)]
    .map((match) => match[1]),
);

/** Word boundary (Tess identifiers also allow `_` and Hangul). */
const word = (list) => `(?<![A-Za-z0-9_])(?:${[...list].sort((a, b) => b.length - a.length).join('|')})(?![A-Za-z0-9_])`;

const DECLARATION = ['project', 'scene', 'object', 'text', 'function', 'use', 'useobject', 'usetext', 'var', 'list'];
const CONTROL = ['if', 'else', 'end', 'then', 'do', 'repeat', 'while', 'until', 'forever',
  'wait', 'break', 'skip', 'restart', 'stop', 'return'];
const EVENT = ['when', 'cloned', 'signal', 'click', 'stage', 'key', 'start'];
const OPERATOR_WORDS = ['and', 'or', 'not', 'in', 'at', 'to', 'from', 'for', 'up'];
const CONSTANTS = ['true', 'false', 'transparent', 'next', 'back', 'front', 'all', 'this', 'me',
  'them', 'other', 'free', 'vertical', 'none', ...OPTION_KEYWORDS];

// Any keyword not claimed by a category above is treated as a "command".
const claimed = new Set([...DECLARATION, ...CONTROL, ...EVENT, ...OPERATOR_WORDS, ...CONSTANTS]);
const COMMANDS = [...keywords].filter((keyword) => !claimed.has(keyword));

const PROPERTIES = [...new Set([...OBJECT_PROPERTIES, ...TEXT_ONLY_PROPERTIES])];

const grammar = {
  $schema: 'https://raw.githubusercontent.com/martinring/tmlanguage/master/tmlanguage.json',
  name: 'Tess',
  scopeName: 'source.tess',
  patterns: [{ include: '#comment' }, { include: '#string' }, { include: '#color' },
    { include: '#number' }, { include: '#declaration' }, { include: '#function-call' },
    { include: '#keyword' }, { include: '#operator' }, { include: '#identifier' }],
  repository: {
    // `#` starts a comment, but `#ff0000` is a color (mirrors the grammar's comment rule).
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
    // Highlight the name following a declaration keyword separately.
    declaration: {
      patterns: [
        {
          match: `(${word(['function'])})\\s+([A-Za-z_\\p{L}][A-Za-z0-9_\\p{L}]*)`,
          captures: { 1: { name: 'keyword.declaration.tess' }, 2: { name: 'entity.name.function.tess' } },
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
        { name: 'keyword.control.tess', match: word(CONTROL) },
        { name: 'keyword.control.event.tess', match: word(EVENT) },
        { name: 'keyword.other.command.tess', match: word(COMMANDS) },
        { name: 'support.variable.property.tess', match: word(PROPERTIES) },
      ],
    },
    operator: {
      patterns: [
        { name: 'keyword.operator.assignment.tess', match: '\\*\\*=|[+\\-*/%]=|=(?!=)' },
        { name: 'keyword.operator.comparison.tess', match: '==|!=|>=|<=|>|<' },
        { name: 'keyword.operator.arithmetic.tess', match: '\\*\\*|//|[+\\-*/%]' },
        { name: 'keyword.operator.word.tess', match: word(OPERATOR_WORDS) },
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
