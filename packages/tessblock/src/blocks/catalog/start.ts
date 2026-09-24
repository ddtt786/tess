/** Start category: event hats, signals and scene switches. */
import { define, pick, type Arg, type BlockSpec, type CodeArgs } from '../spec.ts';
import { quote } from '../../codegen/quote.ts';

/** A hat carries its stack below it, so the body comes from `BODY`. */
function hat(type: string, message: string, head: (args: CodeArgs) => string, args: Arg[] = []): BlockSpec {
  return {
    type,
    category: 'start',
    message,
    args,
    shape: 'hat',
    code: (a) => `${head(a)} do\n${a.BODY}end`,
  };
}

/** The flag the run button shows, drawn on the hat it starts. */
const FLAG_ICON = '<path d="M3.6 14.2V2.4" stroke-width="1.8" />'
  + '<path d="M3.8 2.8c2.2-1.2 3.8 1 6 0 .9-.4 1.8-.3 2.4.1v5.8c-.6-.4-1.5-.5-2.4-.1-2.2 1-3.8-1.2-6 0z" fill="#fff" />';

define(
  { ...hat('start_when_run', '시작하기 버튼을 클릭했을 때', () => 'when start'), icon: FLAG_ICON },
  hat('start_when_key', '%1 키를 눌렀을 때', (a) => `when key ${quote(a.KEY!)}`, [pick('KEY', 'key')]),
  hat('start_when_key_up', '%1 키를 뗐을 때', (a) => `when key ${quote(a.KEY!)} up`, [pick('KEY', 'key')]),
  hat('start_when_click', '오브젝트를 클릭했을 때', () => 'when click'),
  hat('start_when_click_up', '오브젝트 클릭을 해제했을 때', () => 'when click up'),
  hat('start_when_stage_click', '마우스를 클릭했을 때', () => 'when stage click'),
  hat('start_when_stage_click_up', '마우스 클릭을 해제했을 때', () => 'when stage click up'),
  hat('start_when_signal', '%1 신호를 받았을 때', (a) => `when signal ${quote(a.SIGNAL!)}`, [pick('SIGNAL', 'signal')]),
  hat('start_when_scene', '장면이 시작되었을 때', () => 'when scene start'),
  hat('start_when_cloned', '복제본이 처음 생성되었을 때', () => 'when cloned'),
);

define(
  {
    type: 'start_send',
    category: 'start',
    message: '%1 신호 보내기',
    args: [pick('SIGNAL', 'signal')],
    shape: 'statement',
    code: (a) => `send ${quote(a.SIGNAL!)}`,
  },
  {
    type: 'start_send_wait',
    category: 'start',
    message: '%1 신호 보내고 기다리기',
    args: [pick('SIGNAL', 'signal')],
    shape: 'statement',
    code: (a) => `call ${quote(a.SIGNAL!)}`,
  },
  {
    type: 'start_scene_start',
    category: 'start',
    message: '%1 시작하기',
    args: [pick('SCENE', 'scene')],
    shape: 'statement',
    code: (a) => `jump ${quote(a.SCENE!)}`,
  },
  {
    type: 'start_scene_next',
    category: 'start',
    message: '다음 장면 시작하기',
    args: [],
    shape: 'statement',
    code: () => 'jump next',
  },
  {
    type: 'start_scene_prev',
    category: 'start',
    message: '이전 장면 시작하기',
    args: [],
    shape: 'statement',
    code: () => 'jump back',
  },
);
