/** Text category: what a text box writes and how it looks. */
import { colourIn, define, emptyIn, menu, pick, textField, textIn } from '../spec.ts';
import { quote } from '../../codegen/quote.ts';
import { fontFamily } from '../../model/fonts.ts';

define(
  {
    type: 'text_write',
    category: 'text',
    message: '%1 라고 글쓰기',
    args: [textIn('TEXT', '안녕!')],
    shape: 'statement',
    code: (a) => `write ${a.TEXT}`,
  },
  {
    type: 'text_append',
    category: 'text',
    message: '%1 를 뒤에 이어쓰기',
    args: [textIn('TEXT', '안녕!')],
    shape: 'statement',
    code: (a) => `append ${a.TEXT}`,
  },
  {
    type: 'text_prepend',
    category: 'text',
    message: '%1 를 앞에 추가하기',
    args: [textIn('TEXT', '안녕!')],
    shape: 'statement',
    code: (a) => `prepend ${a.TEXT}`,
  },
  {
    type: 'text_clear',
    category: 'text',
    message: '텍스트 모두 지우기',
    args: [],
    shape: 'statement',
    code: () => 'clear text',
  },
  {
    type: 'text_set_font',
    category: 'text',
    message: '글꼴을 %1 로 정하기',
    args: [pick('FONT', 'font')],
    shape: 'statement',
    code: (a) => `font = ${quote(fontFamily(a.FONT!))}`,
  },
  {
    // A font outside the menu, as entry works may name.
    type: 'text_set_font_name',
    category: 'text',
    message: '글꼴을 %1 로 정하기',
    args: [textField('FONT', '나눔고딕')],
    shape: 'statement',
    hidden: true,
    code: (a) => `font = ${quote(a.FONT)}`,
  },
  {
    type: 'text_set_colour',
    category: 'text',
    message: '글자 색을 %1 로 정하기',
    args: [colourIn('COLOUR', '#000000')],
    shape: 'statement',
    code: (a) => `font_color = ${a.COLOUR}`,
  },
  {
    // A colour given by a value, as entry works do.
    type: 'text_set_colour_value',
    category: 'text',
    message: '글자 색을 %1 로 정하기',
    args: [emptyIn('VALUE', '"#000000"')],
    shape: 'statement',
    hidden: true,
    code: (a) => `font_color = ${a.VALUE}`,
  },
  {
    type: 'text_set_bg_colour',
    category: 'text',
    message: '글상자 배경색을 %1 로 정하기',
    args: [colourIn('COLOUR', '#ffffff')],
    shape: 'statement',
    code: (a) => `bg_color = ${a.COLOUR}`,
  },
  {
    type: 'text_set_bg_colour_value',
    category: 'text',
    message: '글상자 배경색을 %1 로 정하기',
    args: [emptyIn('VALUE', '"#ffffff"')],
    shape: 'statement',
    hidden: true,
    code: (a) => `bg_color = ${a.VALUE}`,
  },
  {
    type: 'text_effect',
    category: 'text',
    message: '글자에 %1 효과 %2',
    args: [
      menu('EFFECT', [
        ['굵게', 'text_bold'],
        ['기울임', 'text_italic'],
        ['밑줄', 'text_underline'],
        ['취소선', 'text_strikethrough'],
      ]),
      menu('MODE', [['주기', 'true'], ['지우기', 'false']]),
    ],
    shape: 'statement',
    code: (a) => `${a.EFFECT} = ${a.MODE}`,
  },
);
