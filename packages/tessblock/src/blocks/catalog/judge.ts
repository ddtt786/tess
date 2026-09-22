/** Judge category: the hexagonal blocks that answer yes or no. */
import { boolIn, define, emptyIn, menu, pick, textIn } from '../spec.ts';
import { Order } from '../../codegen/order.ts';
import { quote } from '../../codegen/quote.ts';

const COMPARISONS: Array<[string, string]> = [
  ['=', '=='],
  ['>', '>'],
  ['<', '<'],
  ['≥', '>='],
  ['≤', '<='],
  ['≠', '!='],
];

define(
  {
    type: 'judge_touching',
    category: 'judge',
    message: '%1 에 닿았는가?',
    args: [pick('TARGET', 'target')],
    shape: 'boolean',
    order: Order.ATOMIC,
    code: (a) => `touching(${quote(a.TARGET)})`,
  },
  {
    type: 'judge_key_down',
    category: 'judge',
    message: '%1 키가 눌러져 있는가?',
    args: [pick('KEY', 'key')],
    shape: 'boolean',
    order: Order.ATOMIC,
    code: (a) => `key_down(${quote(a.KEY)})`,
  },
  {
    type: 'judge_mouse_down',
    category: 'judge',
    message: '마우스를 클릭했는가?',
    args: [],
    shape: 'boolean',
    order: Order.ATOMIC,
    code: () => 'mouse_down',
  },
  {
    type: 'judge_clicked',
    category: 'judge',
    message: '오브젝트를 클릭했는가?',
    args: [],
    shape: 'boolean',
    order: Order.ATOMIC,
    code: () => 'clicked',
  },
  {
    type: 'judge_compare',
    category: 'judge',
    message: '%1 %2 %3',
    args: [emptyIn('A', '10', Order.COMPARE), menu('OP', COMPARISONS), emptyIn('B', '10', Order.ADD)],
    shape: 'boolean',
    order: Order.COMPARE,
    code: (a) => [`${a.A} ${a.OP} ${a.B}`, Order.COMPARE],
  },
  {
    type: 'judge_logic',
    category: 'judge',
    message: '%1 %2 %3',
    args: [boolIn('A'), menu('OP', [['그리고', 'and'], ['또는', 'or']]), boolIn('B')],
    shape: 'boolean',
    order: Order.OR,
    code: (a, block, generator) => {
      const operator = block.getFieldValue('OP') === 'or' ? 'or' : 'and';
      const order = operator === 'or' ? Order.OR : Order.AND;
      const left = generator.expr(block, 'A', order, 'false');
      const right = generator.expr(block, 'B', order - 1, 'false');
      return [`${left} ${operator} ${right}`, order];
    },
  },
  {
    type: 'judge_not',
    category: 'judge',
    message: '%1 이(가) 아니다',
    args: [boolIn('VALUE')],
    shape: 'boolean',
    order: Order.NOT,
    code: (a, block, generator) => [`not ${generator.expr(block, 'VALUE', Order.NOT, 'false')}`, Order.NOT],
  },
  {
    type: 'judge_boolean',
    category: 'judge',
    message: '%1',
    args: [menu('VALUE', [['참', 'true'], ['거짓', 'false']])],
    shape: 'boolean',
    order: Order.ATOMIC,
    code: (a) => a.VALUE,
  },
  {
    type: 'judge_boost_mode',
    category: 'judge',
    message: '터보 모드인가?',
    args: [],
    shape: 'boolean',
    order: Order.ATOMIC,
    code: () => 'boost_mode',
  },
  {
    type: 'judge_touchable',
    category: 'judge',
    message: '터치할 수 있는 기기인가?',
    args: [],
    shape: 'boolean',
    order: Order.ATOMIC,
    code: () => 'touchable',
  },
  {
    type: 'judge_device',
    category: 'judge',
    message: '기기가 %1 인가?',
    args: [menu('DEVICE', [['데스크톱', 'desktop'], ['태블릿', 'tablet'], ['모바일', 'mobile']])],
    shape: 'boolean',
    order: Order.COMPARE,
    code: (a) => [`device == ${quote(a.DEVICE)}`, Order.COMPARE],
  },
  {
    type: 'judge_type',
    category: 'judge',
    message: '%1 의 자료형이 %2 인가?',
    args: [textIn('VALUE', '10'), menu('TYPE', [['숫자', 'number'], ['문자', 'string'], ['판단', 'boolean']])],
    shape: 'boolean',
    order: Order.COMPARE,
    code: (a) => [`type(${a.VALUE}) == ${quote(a.TYPE)}`, Order.COMPARE],
  },
);
