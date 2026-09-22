/** Text category: what a text box writes and how it looks. */
import { colourField, define, menu, textIn } from '../spec.ts';
import { quote } from '../../codegen/quote.ts';

const FONTS: Array<[string, string]> = [
  ['나눔고딕', '나눔고딕'],
  ['나눔명조', '나눔명조'],
  ['나눔손글씨', '나눔손글씨'],
  ['바탕체', '바탕체'],
  ['고딕체', '고딕체'],
  ['궁서체', '궁서체'],
  ['둥근모꼴', 'DungGeunMo'],
];

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
    args: [menu('FONT', FONTS)],
    shape: 'statement',
    code: (a) => `font = ${quote(a.FONT)}`,
  },
  {
    type: 'text_set_colour',
    category: 'text',
    message: '글자 색을 %1 로 정하기',
    args: [colourField('COLOUR', '#000000')],
    shape: 'statement',
    code: (a) => `font_color = ${a.COLOUR}`,
  },
  {
    type: 'text_set_bg_colour',
    category: 'text',
    message: '글상자 배경색을 %1 로 정하기',
    args: [colourField('COLOUR', '#ffffff')],
    shape: 'statement',
    code: (a) => `bg_color = ${a.COLOUR}`,
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
