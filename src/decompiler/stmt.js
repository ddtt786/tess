// ============================================================================
//  엔트리 문장(statement) 블록 -> Tess 소스 줄
//
//  src/compiler/statement.js 의 정확한 대응표를 뒤집는다. 한 스레드(블록
//  이어붙임)를 받아서 들여쓰기 없는 텍스트 줄 배열을 돌려준다 — 호출한 쪽이
//  `indent()` 로 필요한 만큼 들여쓴다. 모르는 블록은 주석으로 남기고 계속
//  진행한다 (하나 때문에 전체를 못 옮기면 안 되니까).
// ============================================================================
import { exprOf } from './expr.js';
import { tessString } from './ident.js';

const REVERSE_STOP_TARGET = {
  thisThread: '', otherThread: 'other', thisOnly: 'me', other_objects: 'them', all: 'all',
};
const REVERSE_EFFECT = { color: 'effect_color', brightness: 'effect_brightness', transparency: 'effect_alpha' };
const REVERSE_TEXT_EFFECT = {
  fontBold: 'text_bold', fontItalic: 'text_italic', underLine: 'text_underline', strike: 'text_strikethrough',
};
// set_tts_property 의 코드값 -> src/compiler/statement.js 의 TTS_SPEAKERS/TTS_LEVELS 별명으로
const REVERSE_TTS_SPEAKER = {
  kyuri: 'female', jinho: 'male', hana: 'kind', dinna: 'sweet', brown: 'echo',
  minions: 'mischievous', sally: 'dainty', nsabina: 'nsabina', nmammon: 'nmammon',
  nmeow: 'kitty', nwoof: 'doggy',
};

export function indent(lines) {
  return lines.map((line) => (line === '' ? line : `  ${line}`));
}

/** 스레드(블록 배열) 하나를 Tess 소스 줄들로 */
export function blocksToLines(blocks, ctx) {
  const lines = [];
  for (const block of blocks ?? []) lines.push(...statementLines(block, ctx));
  return lines;
}

function branch(block, index, ctx) {
  return indent(blocksToLines(block.statements?.[index] ?? [], ctx));
}

function unsupported(ctx, block) {
  const type = block?.type ?? '(알 수 없음)';
  ctx.warnings.add(`문장 블록 '${type}' 은(는) 아직 옮길 수 없습니다.`);
  const paramsText = JSON.stringify(summarizeParams(block?.params)).slice(0, 200);
  return [`# [decompile] 지원하지 않는 블록: ${type} params=${paramsText}`];
}

function summarizeParams(params) {
  return (params ?? []).map((p) => {
    if (p === null || p === undefined) return null;
    if (typeof p !== 'object') return p;
    return p.type;
  });
}

// eslint-disable-next-line complexity
function statementLines(block, ctx) {
  if (!block || typeof block !== 'object' || !block.type) return [];
  const p = block.params ?? [];
  const at = (i) => p[i];
  const e = (i) => exprOf(at(i), ctx);

  switch (block.type) {
    // --- 이벤트 hat 블록은 흐름을 만드는 쪽(events.js)이 처리한다.
    //     스레드 본문 안에서 다시 나올 일은 없지만, 방어적으로 건너뛴다.
    case 'when_run_button_click': case 'when_scene_start': case 'when_some_key_pressed':
    case 'when_object_click': case 'when_message_cast': case 'when_clone_start':
      return [];

    // --- 제어 흐름 ---------------------------------------------------------
    case '_if': return [`if ${e(0)}:`, ...branch(block, 0, ctx), 'end'];
    case 'if_else':
      return [`if ${e(0)}:`, ...branch(block, 0, ctx), 'else:', ...branch(block, 1, ctx), 'end'];
    case 'repeat_basic': return [`repeat ${e(0)}:`, ...branch(block, 0, ctx), 'end'];
    case 'repeat_inf': return ['forever:', ...branch(block, 0, ctx), 'end'];
    case 'repeat_while_true': {
      const kind = at(1) === 'until' ? 'until' : 'while';
      return [`${kind} ${e(0)}:`, ...branch(block, 0, ctx), 'end'];
    }
    case 'wait_second': return [`wait ${e(0)}`];
    case 'wait_until_true': return [`wait ${e(0)}`];
    case 'stop_repeat': return ['break'];
    case 'continue_repeat': return ['skip'];
    case 'restart_project': return ['restart'];
    case 'stop_object': {
      const target = REVERSE_STOP_TARGET[at(0)];
      return [target === undefined ? unsupported(ctx, block)[0] : `stop${target ? ` ${target}` : ''}`];
    }

    // --- 신호 · 복제 · 장면 -------------------------------------------------
    case 'message_cast': case 'message_cast_wait': {
      const name = ctx.messageName(at(0));
      return [`${block.type === 'message_cast_wait' ? 'call' : 'send'} ${tessString(name)}`];
    }
    case 'create_clone': {
      const target = at(0);
      return [target === 'self' ? 'clone' : `clone ${tessString(ctx.objectsById.get(target)?.identifier ?? target)}`];
    }
    case 'delete_clone': return ['del clone'];
    case 'remove_all_clones': return ['del clones'];
    case 'start_scene': {
      const scene = ctx.scenesById.get(at(0));
      return [`jump ${tessString(scene ? scene.identifier : at(0))}`];
    }
    case 'start_neighbor_scene': return [`jump ${at(0) === 'next' ? 'next' : 'back'}`];

    // --- 움직임 -------------------------------------------------------------
    case 'move_direction': return [`forward ${e(0)}`];
    case 'move_to_angle': return [`forward ${e(1)} at ${e(0)}`];
    case 'bounce_wall': return ['bounce'];
    case 'move_xy_time': return [`move ${e(1)} ${e(2)} in ${e(0)}`];
    case 'move_x': return [`x += ${e(0)}`];
    case 'move_y': return [`y += ${e(0)}`];
    case 'locate': {
      const target = at(0);
      return [target === 'self' ? '# go self (엔트리 원본이 자기 자신으로 이동)'
        : `go ${tessString(ctx.objectsById.get(target)?.identifier ?? target)}`];
    }
    case 'locate_object_time': {
      const target = at(1);
      return [`go ${tessString(ctx.objectsById.get(target)?.identifier ?? target)} in ${e(0)}`];
    }
    case 'locate_x': return [`x = ${e(0)}`];
    case 'locate_y': return [`y = ${e(0)}`];
    case 'locate_xy': return [`go ${e(0)} ${e(1)}`];
    case 'locate_xy_time': return [`go ${e(1)} ${e(2)} in ${e(0)}`];
    case 'rotate_relative': return [`turn ${e(0)}`];
    case 'rotate_by_time': return [`turn ${e(1)} in ${e(0)}`];
    case 'rotate_absolute': return [`angle = ${e(0)}`];
    case 'direction_relative': return [`steer ${e(0)}`];
    case 'direction_relative_duration': return [`steer ${e(1)} in ${e(0)}`];
    case 'direction_absolute': return [`way = ${e(0)}`];
    case 'see_angle_object': return [`look ${tessString(ctx.objectsById.get(at(0))?.identifier ?? at(0))}`];

    // --- 모양 · 대화 ---------------------------------------------------------
    case 'show': return ['show'];
    case 'hide': return ['hide'];
    case 'show_variable': return [`show ${ctx.varName(at(0))}`];
    case 'hide_variable': return [`hide ${ctx.varName(at(0))}`];
    case 'show_list': return [`show ${ctx.varName(at(0))}`];
    case 'hide_list': return [`hide ${ctx.varName(at(0))}`];
    case 'set_visible_project_timer': return [`${at(1) === 'SHOW' ? 'show' : 'hide'} timer`];
    case 'set_visible_answer': return [`${at(0) === 'SHOW' ? 'show' : 'hide'} answer`];
    case 'change_to_next_shape': return [at(0) === 'prev' ? 'prev costume' : 'next costume'];
    case 'change_to_some_shape': return [`costume = ${e(0)}`];
    case 'dialog': return [`${at(1) === 'think' ? 'think' : 'say'} ${e(0)}`];
    case 'dialog_time': return [`${at(2) === 'think' ? 'think' : 'say'} ${e(0)} for ${e(1)}`];
    case 'flip_y': return ['flip x']; // 엔트리 flip_x/flip_y 는 이름이 뒤집혀 있다
    case 'flip_x': return ['flip y'];
    case 'change_object_index': return [at(0) === 'FRONT' ? 'order front' : 'order back'];
    case 'reset_scale_size': return ['reset size'];
    case 'set_scale_size': return [`size = ${e(0)}`];
    case 'change_scale_size': return [`size += ${e(0)}`];
    case 'stretch_scale_size': return [`${at(0) === 'WIDTH' ? 'scale_x' : 'scale_y'} += ${e(1)}`];
    case 'change_effect_amount': return [`${REVERSE_EFFECT[at(0)] ?? at(0)} = ${e(1)}`];
    case 'add_effect_amount': return [`${REVERSE_EFFECT[at(0)] ?? at(0)} += ${e(1)}`];
    case 'erase_all_effects': return ['clear effects'];
    case 'remove_dialog': return ['clear bubble'];

    // --- 글상자 -------------------------------------------------------------
    case 'text_write': return [`write ${e(0)}`];
    case 'text_append': return [`append ${e(0)}`];
    case 'text_prepend': return [`prepend ${e(0)}`];
    case 'text_flush': return ['clear text'];
    case 'text_change_font': return [`font = ${tessString(at(0))}`];
    case 'text_change_font_color': return [`font_color = ${colorExpr(at(0))}`];
    case 'text_change_bg_color': return [`bg_color = ${colorExpr(at(0))}`];
    case 'text_change_effect': {
      const name = REVERSE_TEXT_EFFECT[at(0)];
      return name ? [`${name} = ${at(1) === 'on' ? 'true' : 'false'}`] : unsupported(ctx, block);
    }

    // --- 붓 -----------------------------------------------------------------
    case 'start_drawing': return ['start draw'];
    case 'stop_drawing': return ['stop draw'];
    case 'start_fill': return ['start fill'];
    case 'stop_fill': return ['stop fill'];
    case 'brush_stamp': return ['stamp'];
    case 'brush_erase_all': return ['clear draw'];
    case 'set_color': return [`draw_color = ${colorExpr(at(0))}`];
    case 'set_fill_color': return [`fill_color = ${colorExpr(at(0))}`];
    case 'set_random_color': return ['draw_color = random_color()'];
    case 'set_thickness': return [`draw_width = ${e(0)}`];
    case 'change_thickness': return [`draw_width += ${e(0)}`];
    case 'set_brush_tranparency': return [`draw_alpha = ${e(0)}`];
    case 'change_brush_transparency': return [`draw_alpha += ${e(0)}`];

    // --- 초시계 ---------------------------------------------------------------
    case 'choose_project_timer_action': {
      const action = { START: 'start timer', STOP: 'stop timer', RESET: 'reset timer' }[at(1)];
      return action ? [action] : unsupported(ctx, block);
    }

    // --- 소리 ---------------------------------------------------------------
    case 'sound_something_with_block': return [`play sound ${e(0)}`];
    case 'sound_something_wait_with_block': return [`play sound ${e(0)} and wait`];
    case 'sound_something_second_with_block': return [`play sound ${e(0)} for ${e(1)}`];
    case 'sound_something_second_wait_with_block': return [`play sound ${e(0)} for ${e(1)} and wait`];
    case 'sound_from_to': return [`play sound ${e(0)} from ${e(1)} to ${e(2)}`];
    case 'sound_from_to_and_wait': return [`play sound ${e(0)} from ${e(1)} to ${e(2)} and wait`];
    case 'play_bgm': return [`play bgm ${e(0)}`];
    case 'stop_bgm': return ['stop bgm'];
    case 'sound_silent_all': return [`stop sound ${at(0) === 'thisOnly' ? 'this' : 'all'}`];
    case 'sound_volume_set': return [`sound_volume = ${e(0)}`];
    case 'sound_volume_change': return [`sound_volume += ${e(0)}`];
    case 'sound_speed_set': return [`sound_speed = ${e(0)}`];
    case 'sound_speed_change': return [`sound_speed += ${e(0)}`];

    // --- TTS 읽어주기 (addendum) ---------------------------------------------
    case 'read_text': return [`read ${e(0)}`];
    case 'read_text_wait_with_block': return [`read ${e(0)} and wait`];
    case 'set_tts_property': {
      // 속도·음높이는 코드값 그대로 옮긴다(같은 코드값이라도 뜻이 반대라 별명이 헷갈린다 — 9 참고)
      return [`tts voice ${tessString(REVERSE_TTS_SPEAKER[at(0)] ?? at(0))} `
        + `speed ${tessString(String(at(1)))} pitch ${tessString(String(at(2)))}`];
    }

    // --- 자료 -----------------------------------------------------------------
    case 'ask_and_wait': return [`ask ${e(0)}`];
    case 'add_value_to_list': return [`in ${ctx.varName(at(1))} add ${e(0)}`];
    case 'insert_value_to_list': return [`in ${ctx.varName(at(1))} insert ${e(0)} at ${unshift(at(2), ctx)}`];
    case 'remove_value_from_list': return [`remove ${ctx.varName(at(1))}[${unshift(at(0), ctx)}]`];
    case 'change_value_list_index': return [`${ctx.varName(at(0))}[${unshift(at(1), ctx)}] = ${e(2)}`];

    // --- 변수 ---------------------------------------------------------------
    case 'set_variable': return [`${ctx.varName(at(0))} = ${e(1)}`];
    case 'change_variable': return [`${ctx.varName(at(0))} += ${e(1)}`];
    case 'set_func_variable': return [`${ctx.funcLocalName(at(0))} = ${e(1)}`];

    default: {
      if (block.type.startsWith('func_')) return functionCallStatement(block, ctx);
      return unsupported(ctx, block);
    }
  }
}

function unshift(indexBlock, ctx) {
  if (indexBlock && indexBlock.type === 'number') return String(Number(indexBlock.params?.[0]) - 1);
  return `(${exprOf(indexBlock, ctx)} - 1)`;
}

export function colorExpr(value) {
  if (typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)) return value;
  if (value === 'transparent') return 'transparent';
  return tessString(String(value ?? ''));
}

/**
 * project.functions[i].content 의 최상위 블록(function_create[_value])을
 * `function 이름(a, b): ... end` 선언으로 바꾼다. 오브젝트 스크립트 안이
 * 아니라 함수 목록을 훑을 때 index.js 가 직접 부른다 — 함수 정의는 언제나
 * 이 자리에만 있고, 이름·매개변수 이름은 이미 ctx.functionsById 에 있다.
 */
export function functionDeclarationLines(fn, createBlock, ctx) {
  const p = createBlock.params ?? [];
  const isValue = createBlock.type === 'function_create_value';
  const body = indent(blocksToLines(createBlock.statements?.[0] ?? [], ctx));
  const lines = [`function ${fn.name}(${fn.params.join(', ')}):`, ...body];
  if (isValue) lines.push(...indent([`return ${exprOf(p[3], ctx)}`]));
  lines.push('end');
  return lines;
}

function functionCallStatement(block, ctx) {
  const fn = ctx.functionsById.get(block.type.slice('func_'.length));
  if (!fn) return unsupported(ctx, block);
  const p = block.params ?? [];
  const args = p.filter((_, i) => i < fn.params.length).map((param) => exprOf(param, ctx));
  return [`${fn.name}(${args.join(', ')})`];
}
