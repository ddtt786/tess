/** Calc category: numbers, text, colours and everything read off the stage. */
import { colourField, colourIn, define, emptyIn, menu, numField, numIn, pick, textField, textIn } from '../spec.ts';
import { Order, type OrderValue } from '../../codegen/order.ts';
import { num, quote } from '../../codegen/quote.ts';

interface Operator {
  token: string;
  order: OrderValue;
  /** The loosest order the right operand may have without brackets. */
  right: OrderValue;
  /** The loosest order the left operand may have without brackets. */
  left: OrderValue;
}

const OPERATORS: Record<string, Operator> = {
  '+': { token: '+', order: Order.ADD, left: Order.ADD, right: Order.MUL },
  '-': { token: '-', order: Order.ADD, left: Order.ADD, right: Order.MUL },
  '*': { token: '*', order: Order.MUL, left: Order.MUL, right: Order.POW },
  '/': { token: '/', order: Order.MUL, left: Order.MUL, right: Order.POW },
  '//': { token: '//', order: Order.MUL, left: Order.MUL, right: Order.POW },
  '%': { token: '%', order: Order.MUL, left: Order.MUL, right: Order.POW },
  '**': { token: '**', order: Order.POW, left: Order.UNARY, right: Order.POW },
};

const MATH_FUNCTIONS: Array<[string, string]> = [
  ['제곱근', 'sqrt'],
  ['제곱', 'square'],
  ['절댓값', 'abs'],
  ['버림', 'floor'],
  ['올림', 'ceil'],
  ['반올림', 'round'],
  ['sin', 'sin'],
  ['cos', 'cos'],
  ['tan', 'tan'],
  ['asin', 'asin'],
  ['acos', 'acos'],
  ['atan', 'atan'],
  ['자연로그', 'ln'],
  ['상용로그', 'log10'],
  ['밑이 2인 로그', 'log2'],
  ['팩토리얼', 'factorial'],
];

const OBJECT_VALUES: Array<[string, string]> = [
  ['x 좌푯값', 'x'],
  ['y 좌푯값', 'y'],
  ['방향', 'angle'],
  ['이동 방향', 'way'],
  ['크기', 'size'],
  ['모양 번호', 'costume_number'],
  ['모양 이름', 'costume'],
];

/** Blocks that write a bare name, which `name[i]` can index. */
const NAMED_VALUES = new Set(['data_variable', 'func_param_value', 'func_local_get']);

define(
  {
    type: 'calc_number',
    category: 'calc',
    message: '%1',
    args: [numField('NUM', 10)],
    shape: 'value',
    order: Order.ATOMIC,
    code: (a) => [num(a.NUM), Order.ATOMIC],
  },
  {
    type: 'calc_text',
    category: 'calc',
    message: '%1',
    args: [textField('TEXT', '안녕!')],
    shape: 'value',
    order: Order.ATOMIC,
    code: (a) => [quote(a.TEXT), Order.ATOMIC],
  },
  {
    type: 'calc_arithmetic',
    category: 'calc',
    message: '%1 %2 %3',
    args: [
      numIn('A', 10, Order.MUL),
      menu('OP', [['+', '+'], ['-', '-'], ['×', '*'], ['÷', '/'], ['몫', '//'], ['나머지', '%'], ['제곱', '**']]),
      numIn('B', 10, Order.MUL),
    ],
    shape: 'value',
    order: Order.ADD,
    code: (a, block, generator) => {
      const operator = OPERATORS[block.getFieldValue('OP')] ?? OPERATORS['+']!;
      const left = generator.expr(block, 'A', operator.left, '0');
      const right = generator.expr(block, 'B', operator.right, '0');
      return [`${left} ${operator.token} ${right}`, operator.order];
    },
  },
  {
    type: 'calc_random',
    category: 'calc',
    message: '%1 부터 %2 사이의 무작위 수',
    args: [numIn('FROM', 0), numIn('TO', 10)],
    shape: 'value',
    order: Order.ATOMIC,
    code: (a) => [`random(${a.FROM}, ${a.TO})`, Order.ATOMIC],
  },
  {
    type: 'calc_math',
    category: 'calc',
    message: '%1 %2',
    args: [menu('FUNC', MATH_FUNCTIONS), numIn('VALUE', 10, Order.NONE)],
    shape: 'value',
    order: Order.ATOMIC,
    code: (a, block, generator) => {
      const name = block.getFieldValue('FUNC');
      if (name === 'sqrt') return [`root(${a.VALUE}, 2)`, Order.ATOMIC];
      if (name === 'square') {
        const base = generator.expr(block, 'VALUE', Order.UNARY, '0');
        return [`${base} ** 2`, Order.POW];
      }
      return [`${name}(${a.VALUE})`, Order.ATOMIC];
    },
  },
  {
    type: 'calc_root',
    category: 'calc',
    message: '%1 의 %2 제곱근',
    args: [numIn('VALUE', 16), numIn('DEGREE', 2)],
    shape: 'value',
    order: Order.ATOMIC,
    code: (a) => [`root(${a.VALUE}, ${a.DEGREE})`, Order.ATOMIC],
  },
  {
    type: 'calc_mouse',
    category: 'calc',
    message: '마우스 %1 좌표',
    args: [menu('AXIS', [['x', 'x'], ['y', 'y']])],
    shape: 'value',
    order: Order.ATOMIC,
    code: (a) => [`${a.AXIS}("mouse")`, Order.ATOMIC],
  },
  {
    type: 'calc_object_value',
    category: 'calc',
    message: '%1 의 %2',
    args: [pick('TARGET', 'object'), menu('VALUE', OBJECT_VALUES)],
    shape: 'value',
    order: Order.ATOMIC,
    code: (a) => [`${a.VALUE}(${quote(a.TARGET)})`, Order.ATOMIC],
  },
  {
    type: 'calc_self_value',
    category: 'calc',
    message: '자신의 %1',
    args: [menu('VALUE', OBJECT_VALUES)],
    shape: 'value',
    order: Order.ATOMIC,
    code: (a) => [`${a.VALUE}("self")`, Order.ATOMIC],
  },
  {
    type: 'calc_distance',
    category: 'calc',
    message: '%1 까지의 거리',
    args: [pick('TARGET', 'lookTarget')],
    shape: 'value',
    order: Order.ATOMIC,
    code: (a) => [`distance(${quote(a.TARGET)})`, Order.ATOMIC],
  },
  {
    type: 'calc_timer',
    category: 'calc',
    message: '초시계 값',
    args: [],
    shape: 'value',
    order: Order.ATOMIC,
    code: () => ['timer', Order.ATOMIC],
  },
  {
    type: 'calc_timer_control',
    category: 'calc',
    message: '초시계 %1',
    args: [menu('MODE', [['시작하기', 'start timer'], ['정지하기', 'stop timer'], ['초기화하기', 'reset timer']])],
    shape: 'statement',
    code: (a) => a.MODE,
  },
  {
    type: 'calc_timer_visible',
    category: 'calc',
    message: '초시계 %1',
    args: [menu('MODE', [['보이기', 'show'], ['숨기기', 'hide']])],
    shape: 'statement',
    code: (a) => `${a.MODE} timer`,
  },
  {
    type: 'calc_now',
    category: 'calc',
    message: '현재 %1',
    args: [
      menu('UNIT', [
        ['연도', 'year'], ['월', 'month'], ['일', 'day'],
        ['시각(시)', 'hour'], ['시각(분)', 'minute'], ['시각(초)', 'second'], ['요일', 'weekday'],
      ]),
    ],
    shape: 'value',
    order: Order.ATOMIC,
    code: (a) => [`now(${quote(a.UNIT)})`, Order.ATOMIC],
  },
  {
    type: 'calc_join',
    category: 'calc',
    message: '%1 과(와) %2 를 합치기',
    args: [textIn('A', '안녕'), textIn('B', '!')],
    shape: 'value',
    order: Order.ATOMIC,
    code: (a) => [`join(${a.A}, ${a.B})`, Order.ATOMIC],
  },
  {
    type: 'calc_char_at',
    category: 'calc',
    message: '%1 의 %2 번째 글자',
    args: [textIn('TEXT', '안녕!'), numIn('INDEX', 1)],
    shape: 'value',
    order: Order.ATOMIC,
    // `name[i]` is entry's own letter block; any other text goes through slice.
    code: (a, block) => [
      NAMED_VALUES.has(block.getInputTargetBlock('TEXT')?.type ?? '')
        ? `${a.TEXT}[${a.INDEX}]`
        : `slice(${a.TEXT}, ${a.INDEX}, ${a.INDEX})`,
      Order.ATOMIC,
    ],
  },
  {
    type: 'calc_slice',
    category: 'calc',
    message: '%1 의 %2 번째부터 %3 번째까지의 글자',
    args: [textIn('TEXT', '안녕하세요'), numIn('FROM', 1), numIn('TO', 3)],
    shape: 'value',
    order: Order.ATOMIC,
    code: (a) => [`slice(${a.TEXT}, ${a.FROM}, ${a.TO})`, Order.ATOMIC],
  },
  {
    type: 'calc_length',
    category: 'calc',
    message: '%1 의 글자 수',
    args: [textIn('TEXT', '안녕!')],
    shape: 'value',
    order: Order.ATOMIC,
    code: (a) => [`length(${a.TEXT})`, Order.ATOMIC],
  },
  {
    type: 'calc_index_of',
    category: 'calc',
    message: '%1 에서 %2 의 시작 위치',
    args: [textIn('TEXT', '안녕하세요'), textIn('FIND', '하')],
    shape: 'value',
    order: Order.ATOMIC,
    code: (a) => [`index_of(${a.TEXT}, ${a.FIND})`, Order.ATOMIC],
  },
  {
    type: 'calc_count',
    category: 'calc',
    message: '%1 에서 %2 의 개수',
    args: [textIn('TEXT', '안녕하세요'), textIn('FIND', '하')],
    shape: 'value',
    order: Order.ATOMIC,
    code: (a) => [`count(${a.TEXT}, ${a.FIND})`, Order.ATOMIC],
  },
  {
    type: 'calc_replace',
    category: 'calc',
    message: '%1 의 %2 을(를) %3 로 바꾸기',
    args: [textIn('TEXT', '안녕하세요'), textIn('FIND', '하'), textIn('TO', '허')],
    shape: 'value',
    order: Order.ATOMIC,
    code: (a) => [`replace(${a.TEXT}, ${a.FIND}, ${a.TO})`, Order.ATOMIC],
  },
  {
    type: 'calc_case',
    category: 'calc',
    message: '%1 을(를) %2',
    args: [
      textIn('TEXT', 'Hello'),
      menu('MODE', [['대문자로', 'uppercase'], ['소문자로', 'lowercase'], ['뒤집기', 'reverse']]),
    ],
    shape: 'value',
    order: Order.ATOMIC,
    code: (a) => [`${a.MODE}(${a.TEXT})`, Order.ATOMIC],
  },
  {
    type: 'calc_type',
    category: 'calc',
    message: '%1 의 자료형',
    args: [textIn('VALUE', '10')],
    shape: 'value',
    order: Order.ATOMIC,
    code: (a) => [`type(${a.VALUE})`, Order.ATOMIC],
  },
  {
    type: 'calc_colour',
    category: 'calc',
    message: '%1',
    args: [colourField('COLOUR', '#ff5f5f')],
    shape: 'value',
    order: Order.ATOMIC,
    code: (a) => [a.COLOUR, Order.ATOMIC],
  },
  {
    type: 'calc_random_colour',
    category: 'calc',
    message: '무작위 색',
    args: [],
    shape: 'value',
    order: Order.ATOMIC,
    code: () => ['random_color()', Order.ATOMIC],
  },
  {
    type: 'calc_to_hex',
    category: 'calc',
    message: '빨강 %1 초록 %2 파랑 %3 인 색',
    args: [numIn('R', 255), numIn('G', 0), numIn('B', 0)],
    shape: 'value',
    order: Order.ATOMIC,
    code: (a) => [`to_hex(${a.R}, ${a.G}, ${a.B})`, Order.ATOMIC],
  },
  {
    type: 'calc_from_hex',
    category: 'calc',
    message: '%1 의 %2 값',
    args: [colourIn('COLOUR', '#ff5f5f'), menu('CHANNEL', [['빨강', 'red'], ['초록', 'green'], ['파랑', 'blue']])],
    shape: 'value',
    order: Order.ATOMIC,
    code: (a) => [`from_hex(${a.COLOUR}, ${a.CHANNEL})`, Order.ATOMIC],
  },
  {
    // A colour given by a value, as entry works do.
    type: 'calc_from_hex_value',
    category: 'calc',
    message: '%1 의 %2 값',
    args: [emptyIn('VALUE', '"#ff5f5f"'), menu('CHANNEL', [['빨강', 'red'], ['초록', 'green'], ['파랑', 'blue']])],
    shape: 'value',
    order: Order.ATOMIC,
    hidden: true,
    code: (a) => [`from_hex(${a.VALUE}, ${a.CHANNEL})`, Order.ATOMIC],
  },
  {
    type: 'calc_sound_duration',
    category: 'calc',
    message: '소리 %1 의 길이',
    args: [pick('SOUND', 'sound')],
    shape: 'value',
    order: Order.ATOMIC,
    code: (a) => [`sound_duration(${quote(a.SOUND)})`, Order.ATOMIC],
  },
  {
    type: 'calc_text_content',
    category: 'calc',
    message: '%1 의 글자 값',
    args: [pick('TARGET', 'object')],
    shape: 'value',
    order: Order.ATOMIC,
    code: (a) => [`text_content(${quote(a.TARGET)})`, Order.ATOMIC],
  },
  {
    type: 'calc_block_count',
    category: 'calc',
    message: '%1 의 블록 수',
    args: [pick('TARGET', 'object')],
    shape: 'value',
    order: Order.ATOMIC,
    code: (a) => [`block_count(${quote(a.TARGET)})`, Order.ATOMIC],
  },
  {
    type: 'calc_user',
    category: 'calc',
    message: '사용자 %1',
    args: [menu('INFO', [['아이디', 'user_id'], ['닉네임', 'nickname']])],
    shape: 'value',
    order: Order.ATOMIC,
    code: (a) => [a.INFO, Order.ATOMIC],
  },
  {
    type: 'calc_block_count_all',
    category: 'calc',
    message: '전체 블록 수',
    args: [],
    shape: 'value',
    order: Order.ATOMIC,
    code: () => ['block_count', Order.ATOMIC],
  },
  {
    type: 'calc_can_save',
    category: 'calc',
    message: '저장할 수 있는가',
    args: [],
    shape: 'value',
    order: Order.ATOMIC,
    code: () => ['can_save', Order.ATOMIC],
  },
  {
    // Kept for projects saved before the blocks above were split out.
    type: 'calc_state',
    category: 'calc',
    hidden: true,
    message: '%1',
    args: [
      menu('STATE', [
        ['아이디', 'user_id'],
        ['닉네임', 'nickname'],
        ['기기 종류', 'device'],
        ['저장할 수 있는가', 'can_save'],
        ['전체 블록 수', 'block_count'],
      ]),
    ],
    shape: 'value',
    order: Order.ATOMIC,
    code: (a) => [a.STATE, Order.ATOMIC],
  },
);
