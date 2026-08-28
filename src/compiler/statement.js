// Tess statements -> Entry blocks.
//
// One Tess statement can expand into multiple Entry blocks — e.g. `move 20
// 20` has no matching Entry block, so it expands to move_x + move_y.
import {
  compileAnyValue, compileBoolean, compileCallArguments, compileValue,
  isBooleanBlock, resolveList, resolveTarget, shiftIndex,
} from './expression.js';
import { requireScaleSetter } from './runtime.js';

const STOP_TARGETS = {
  this: 'thisThread',      // this script only
  other: 'otherThread',    // this object's other scripts
  me: 'thisOnly',          // all of this object's scripts
  them: 'other_objects',   // every other object
  all: 'all',              // the whole project
};

const EFFECTS = {
  effect_color: 'color',
  effect_brightness: 'brightness',
  effect_alpha: 'transparency',
};

const TEXT_EFFECTS = {
  text_bold: 'fontBold',
  text_italic: 'fontItalic',
  text_underline: 'underLine',
  text_strikethrough: 'strike',
};

// TTS voice / speed / pitch — mirrors Entry's `set_tts_property` dropdown
// values (entryjs `src/playground/blocks/block_ai_utilize_tts.js`). Accepts
// both the raw code values and human-readable English aliases.
const TTS_SPEAKERS = {
  kyuri: 'kyuri', female: 'kyuri',
  jinho: 'jinho', male: 'jinho',
  hana: 'hana', kind: 'hana',
  dinna: 'dinna', sweet: 'dinna',
  brown: 'brown', echo: 'brown',
  minions: 'minions', mischievous: 'minions',
  sally: 'sally', dainty: 'sally',
  nsabina: 'nsabina',
  nmammon: 'nmammon',
  nmeow: 'nmeow', kitty: 'nmeow',
  nwoof: 'nwoof', doggy: 'nwoof',
};
// speed is more positive when slower, pitch is more positive when lower — matches Entry's code values
const TTS_LEVELS = {
  veryslow: '5', verylow: '5',
  slow: '3', low: '3',
  normal: '0',
  fast: '-3', high: '-3',
  veryfast: '-5', veryhigh: '-5',
  '5': '5', '3': '3', '0': '0', '-3': '-3', '-5': '-5',
};

/** Object properties readable as a value (used when expanding compound assignment). */
const READABLE_PROPERTIES = { x: 'x', y: 'y', angle: 'rotation', way: 'direction', size: 'size' };

export function compileStatements(statements, ctx) {
  const blocks = [];
  for (const statement of statements) blocks.push(...compileStatement(statement, ctx));
  return blocks;
}

export function compileStatement(node, ctx) {
  // tags every block created while compiling this statement (including
  // nested value/condition blocks) with its source location, for runtime panic lookups
  const previousNode = ctx.currentNode;
  ctx.currentNode = node;
  // a failed nested compile can bubble up null, so normalize to an array
  const blocks = compile(node, ctx) ?? [];
  ctx.currentNode = previousNode;
  ctx.applyComment(node, blocks[0]);
  return blocks;
}

function compile(node, ctx) {
  const one = (block) => (block ? [block] : []);

  switch (node.type) {
    // --- control flow ---------------------------------------------------------
    case 'If': {
      const test = compileBoolean(node.test, ctx);
      if (!test) return [];
      if (!node.alternate) {
        return one(ctx.block('_if', [test, null], [compileStatements(node.consequent, ctx)]));
      }
      return one(ctx.block('if_else', [test, null, null], [
        compileStatements(node.consequent, ctx),
        compileStatements(node.alternate, ctx),
      ]));
    }

    case 'Repeat': {
      const count = compileValue(node.count, ctx);
      return count && one(ctx.block('repeat_basic', [count, null], [compileStatements(node.body, ctx)]));
    }

    case 'Forever':
      return one(ctx.block('repeat_inf', [null, null], [compileStatements(node.body, ctx)]));

    case 'While': case 'Until': {
      // `while true:` naturally maps to Entry's "repeat forever"
      if (node.type === 'While' && node.test.type === 'Boolean' && node.test.value === true) {
        return one(ctx.block('repeat_inf', [null, null], [compileStatements(node.body, ctx)]));
      }
      const test = compileBoolean(node.test, ctx);
      const mode = node.type === 'While' ? 'while' : 'until';
      return test && one(ctx.block('repeat_while_true', [test, mode, null], [compileStatements(node.body, ctx)]));
    }

    case 'Wait': {
      // a value becomes "wait N seconds", a boolean becomes "wait until";
      // inspects the block before it's wrapped in get_boolean_value to tell which
      const value = compileAnyValue(node.value, ctx);
      if (!value) return [];
      return one(isBooleanBlock(value)
        ? ctx.block('wait_until_true', [value, null])
        : ctx.block('wait_second', [value, null]));
    }

    case 'Break': return one(ctx.block('stop_repeat', [null]));
    case 'Skip': return one(ctx.block('continue_repeat', [null]));
    case 'Restart': return one(ctx.block('restart_project', [null]));
    case 'Stop': return one(ctx.block('stop_object', [STOP_TARGETS[node.target], null]));

    case 'Return':
      return [ctx.error(node, 'return 은 함수의 마지막 문장에서만 쓸 수 있습니다.')].filter(Boolean);

    // --- signals, clones, scenes -------------------------------------------------
    case 'Send': {
      if (node.signal.type !== 'String') {
        return [ctx.error(node, '신호 이름은 "게임 시작" 처럼 문자열로 직접 적어야 합니다.')].filter(Boolean);
      }
      const id = ctx.messageId(node.signal.value);
      return one(ctx.block(node.wait ? 'message_cast_wait' : 'message_cast', [id, null]));
    }

    case 'Clone': {
      const target = node.target === null ? 'self' : resolveTarget(node.target, ctx, { self: true });
      return target && one(ctx.block('create_clone', [target, null]));
    }

    case 'DeleteClone': return one(ctx.block('delete_clone', [null]));
    case 'DeleteClones': return one(ctx.block('remove_all_clones', [null]));

    case 'Jump': {
      if (node.target === 'next') return one(ctx.block('start_neighbor_scene', ['next', null]));
      if (node.target === 'back') return one(ctx.block('start_neighbor_scene', ['prev', null]));
      if (node.target.type !== 'String') {
        return [ctx.error(node, '장면 이름은 문자열로 직접 적어야 합니다.')].filter(Boolean);
      }
      const scene = ctx.sceneByName.get(node.target.value);
      if (!scene) return [ctx.error(node, `'${node.target.value}' 이라는 장면이 없습니다.`)].filter(Boolean);
      return one(ctx.block('start_scene', [scene.id, null]));
    }

    // --- movement -------------------------------------------------------------
    case 'Forward': {
      const distance = compileValue(node.distance, ctx);
      if (!distance) return [];
      if (!node.angle) return one(ctx.block('move_direction', [distance, null]));
      const angle = compileAngle(node.angle, ctx);
      return angle && one(ctx.block('move_to_angle', [angle, distance, null]));
    }

    case 'Bounce': return one(ctx.block('bounce_wall', [null]));

    case 'Move': {
      const x = compileValue(node.x, ctx);
      const y = compileValue(node.y, ctx);
      if (!x || !y) return [];
      if (node.duration) {
        const duration = compileValue(node.duration, ctx);
        return duration && one(ctx.block('move_xy_time', [duration, x, y, null]));
      }
      // Entry has no single block for a combined relative x/y move -> expand to two blocks
      return [ctx.block('move_x', [x, null]), ctx.block('move_y', [y, null])];
    }

    case 'Go': {
      if (node.target) {
        const target = resolveTarget(node.target, ctx, { self: true });
        if (!target) return [];
        if (!node.duration) return one(ctx.block('locate', [target, null]));
        const duration = compileValue(node.duration, ctx);
        return duration && one(ctx.block('locate_object_time', [duration, target, null]));
      }
      const x = compileValue(node.x, ctx);
      const y = compileValue(node.y, ctx);
      if (!x || !y) return [];
      if (!node.duration) return one(ctx.block('locate_xy', [x, y, null]));
      const duration = compileValue(node.duration, ctx);
      return duration && one(ctx.block('locate_xy_time', [duration, x, y, null]));
    }

    case 'Turn': case 'Steer': {
      const angle = compileAngle(node.angle, ctx);
      if (!angle) return [];
      const isShape = node.type === 'Turn';
      if (!node.duration) {
        return one(ctx.block(isShape ? 'rotate_relative' : 'direction_relative', [angle, null]));
      }
      const duration = compileValue(node.duration, ctx);
      if (!duration) return [];
      return one(isShape
        ? ctx.block('rotate_by_time', [duration, angle, null])
        : ctx.block('direction_relative_duration', [duration, angle, null]));
    }

    case 'Look': {
      const target = resolveTarget(node.target, ctx, {});
      return target && one(ctx.block('see_angle_object', [target, null]));
    }

    // --- costume, dialog ---------------------------------------------------------
    case 'Show': case 'Hide': return compileVisibility(node, ctx);

    case 'CostumeStep':
      return one(ctx.block('change_to_next_shape', [node.direction, null]));

    case 'Say': case 'Think': {
      const message = compileValue(node.message, ctx);
      if (!message) return [];
      const mode = node.type === 'Say' ? 'speak' : 'think';
      if (!node.duration) return one(ctx.block('dialog', [message, mode, null]));
      const duration = compileValue(node.duration, ctx);
      return duration && one(ctx.block('dialog_time', [message, duration, mode, null]));
    }

    // Entry's flip_x flips vertically and flip_y flips horizontally — the names are swapped
    case 'Flip': return one(ctx.block(node.axis === 'x' ? 'flip_y' : 'flip_x', [null]));

    case 'Order':
      return one(ctx.block('change_object_index', [node.to === 'front' ? 'FRONT' : 'BACK', null]));

    case 'ResetSize': return one(ctx.block('reset_scale_size', [null]));
    case 'Clear': return compileClear(node, ctx);

    // --- text box -------------------------------------------------------------
    case 'TextWrite': {
      const value = compileValue(node.value, ctx);
      const types = { write: 'text_write', append: 'text_append', prepend: 'text_prepend' };
      return value && one(ctx.block(types[node.mode], [value, null]));
    }

    // --- brush -----------------------------------------------------------------
    case 'StartDraw': return one(ctx.block('start_drawing', [null]));
    case 'StopDraw': return one(ctx.block('stop_drawing', [null]));
    case 'StartFill': return one(ctx.block('start_fill', [null]));
    case 'StopFill': return one(ctx.block('stop_fill', [null]));
    case 'Stamp': return one(ctx.block('brush_stamp', [null]));

    // --- stopwatch -------------------------------------------------------------
    case 'StartTimer': return one(timerAction('START', ctx));
    case 'StopTimer': return one(timerAction('STOP', ctx));
    case 'ResetTimer': return one(timerAction('RESET', ctx));

    // --- sound ---------------------------------------------------------------
    case 'PlaySound': return compilePlaySound(node, ctx);
    case 'PlayBgm': {
      const sound = resolveSound(node.name, ctx);
      return sound && one(ctx.block('play_bgm', [sound, null]));
    }
    case 'StopBgm': return one(ctx.block('stop_bgm', [null]));
    case 'StopSound':
      return one(ctx.block('sound_silent_all', [node.target === 'this' ? 'thisOnly' : 'all', null]));

    // --- TTS read-aloud (addendum) ---------------------------------------------
    case 'Read': {
      const message = compileValue(node.value, ctx);
      if (!message) return [];
      ctx.usesTts = true;
      return one(ctx.block(node.wait ? 'read_text_wait_with_block' : 'read_text', [message, null]));
    }

    case 'TtsSetting': {
      const speaker = ttsOption(TTS_SPEAKERS, node.voice, '목소리', ctx);
      const speed = ttsOption(TTS_LEVELS, node.speed, '속도', ctx);
      const pitch = ttsOption(TTS_LEVELS, node.pitch, '음높이', ctx);
      if (speaker === null || speed === null || pitch === null) return [];
      ctx.usesTts = true;
      return one(ctx.block('set_tts_property', [speaker, speed, pitch, null]));
    }

    // --- data ---------------------------------------------------------------
    case 'Ask': {
      const question = compileValue(node.question, ctx);
      return question && one(ctx.block('ask_and_wait', [question, null]));
    }

    case 'ListAdd': {
      const list = requireList(node.list, ctx);
      const value = compileValue(node.value, ctx);
      return list && value && one(ctx.block('add_value_to_list', [value, list.id, null]));
    }

    case 'ListInsert': {
      const list = requireList(node.list, ctx);
      const value = compileValue(node.value, ctx);
      const index = shiftIndex(node.index, ctx);
      return list && value && index
        && one(ctx.block('insert_value_to_list', [value, list.id, index, null]));
    }

    case 'ListRemove': {
      const list = requireList(node.list, ctx);
      const index = shiftIndex(node.index, ctx);
      return list && index && one(ctx.block('remove_value_from_list', [index, list.id, null]));
    }

    case 'VarDecl': case 'ListDecl': return compileDeclaration(node, ctx);
    case 'Assign': return compileAssign(node, ctx);
    case 'ExpressionStatement': return compileCallStatement(node, ctx);

    default:
      return [ctx.error(node, `'${node.type}' 문장은 아직 엔트리 블록으로 바꿀 수 없습니다.`)].filter(Boolean);
  }
}

// ---------------------------------------------------------------------------
//  helper compilers
// ---------------------------------------------------------------------------
function timerAction(action, ctx) {
  return ctx.block('choose_project_timer_action', [null, action, null, null]);
}

/** Rotation-family blocks use the angle literal block. */
function compileAngle(node, ctx) {
  if (node.type === 'Number') return ctx.angle(node.value);
  if (node.type === 'Unary' && node.operator === '-' && node.argument.type === 'Number') {
    return ctx.angle(-node.argument.value);
  }
  return compileValue(node, ctx);
}

function compileClear(node, ctx) {
  const types = {
    effects: 'erase_all_effects',
    bubble: 'remove_dialog',
    draw: 'brush_erase_all',
    text: 'text_flush',
  };
  return [ctx.block(types[node.target], [null])];
}

function compileVisibility(node, ctx) {
  const showing = node.type === 'Show';
  if (!node.target) return [ctx.block(showing ? 'show' : 'hide', [null])];

  const name = node.target.name;
  if (name === 'timer') {
    return [ctx.block('set_visible_project_timer', [null, showing ? 'SHOW' : 'HIDE', null, null])];
  }
  if (name === 'answer') {
    return [ctx.block('set_visible_answer', [showing ? 'SHOW' : 'HIDE', null])];
  }

  const found = ctx.lookupVariable(name);
  if (found?.kind !== 'variable') {
    return [ctx.error(node, `'${name}' 은(는) 무대에 표시할 수 있는 변수나 리스트가 아닙니다.`)].filter(Boolean);
  }
  const isList = found.entry.variableType === 'list';
  const type = isList
    ? (showing ? 'show_list' : 'hide_list')
    : (showing ? 'show_variable' : 'hide_variable');
  return [ctx.block(type, [found.entry.id, null])];
}

function compilePlaySound(node, ctx) {
  const sound = resolveSound(node.name, ctx);
  if (!sound) return [];
  const { wait } = node;

  if (node.from) {
    const from = compileValue(node.from, ctx);
    const to = compileValue(node.to, ctx);
    if (!from || !to) return [];
    return [ctx.block(wait ? 'sound_from_to_and_wait' : 'sound_from_to', [sound, from, to, null])];
  }
  if (node.duration) {
    const duration = compileValue(node.duration, ctx);
    if (!duration) return [];
    const type = wait ? 'sound_something_second_wait_with_block' : 'sound_something_second_with_block';
    return [ctx.block(type, [sound, duration, null])];
  }
  const type = wait ? 'sound_something_wait_with_block' : 'sound_something_with_block';
  return [ctx.block(type, [sound, null])];
}

/**
 * Sound name -> get_sounds block.
 *
 * A string literal is checked against this object's registered sounds
 * (to catch typos) and wrapped in get_sounds. Any other value (e.g. a
 * variable) can't be checked at compile time, so it's passed through
 * unchanged — Entry's sound-playing blocks resolve a value by 1) sound id,
 * 2) sound name, 3) index at runtime, so it works as long as the runtime
 * value matches this object's sound name.
 */
function resolveSound(node, ctx) {
  if (node.type === 'String') {
    const sound = ctx.object?.sounds.get(node.value);
    if (sound) return ctx.block('get_sounds', [sound.id]);
    // not this object's own sound name, but passed through if it exactly
    // matches a real Entry id pinned elsewhere via force id (see spec-addendum
    // 1.4) — Entry resolves by 1) id 2) name 3) index, so a matching id
    // points to the same sound regardless of which object calls it (used to
    // preserve legacy code that hardcoded another object's sound id inside a function)
    if (ctx.forcedResourceIds.has(node.value)) return node.value;
    return ctx.error(node, `'${node.value}' 소리가 이 오브젝트에 없습니다. sound ${node.value} "파일명" 으로 먼저 등록하세요.`);
  }
  return compileValue(node, ctx);
}

/** Costume name -> get_pictures block (a computed value passes through, same reasoning as resolveSound). */
function resolvePicture(node, ctx) {
  if (node.type === 'String') {
    const picture = ctx.object?.pictures.get(node.value);
    if (picture) return ctx.block('get_pictures', [picture.id]);
    if (ctx.forcedResourceIds.has(node.value)) return node.value;
    return ctx.error(node, `'${node.value}' 모양이 이 오브젝트에 없습니다. costume ${node.value} "파일명" 으로 먼저 등록하세요.`);
  }
  return compileValue(node, ctx);
}

function requireList(node, ctx) {
  const list = resolveList(node, ctx);
  return list ?? ctx.error(node, `'${node.name}' 은(는) 리스트가 아닙니다.`);
}

// ---------------------------------------------------------------------------
//  declaration, assignment
// ---------------------------------------------------------------------------
function compileDeclaration(node, ctx) {
  // the declaration itself was already collected earlier; this only builds the initial assignment
  if (node.type === 'ListDecl') {
    const found = ctx.lookupVariable(node.name);
    if (found?.kind !== 'variable') return [];
    return []; // a list's initial value goes into the variable entry's array field
  }
  return compileAssign({
    type: 'Assign',
    operator: '=',
    target: { type: 'Identifier', name: node.name, loc: node.loc },
    value: node.value,
    loc: node.loc,
  }, ctx);
}

function compileAssign(node, ctx) {
  if (node.target.type === 'Index') return compileListElementAssign(node, ctx);

  const name = node.target.name;
  const found = ctx.lookupVariable(name);
  if (found) return compileVariableAssign(node, found, ctx);
  return compilePropertyAssign(node, name, ctx);
}

function compileVariableAssign(node, found, ctx) {
  const { operator } = node;

  if (found.kind === 'param') {
    return [ctx.error(node, `함수 매개변수 '${found.name}' 에는 값을 대입할 수 없습니다.`)].filter(Boolean);
  }

  const read = () => (found.kind === 'funcLocal'
    ? ctx.block('get_func_variable', [found.id, null])
    : ctx.block('get_variable', [found.entry.id, null]));
  const write = (value) => (found.kind === 'funcLocal'
    ? ctx.block('set_func_variable', [found.id, value, null])
    : ctx.block('set_variable', [found.entry.id, value, null]));

  if (operator === '=') {
    const value = compileValue(node.value, ctx);
    return value ? [write(value)] : [];
  }

  if (operator === '+=' && found.kind === 'variable') {
    const value = compileValue(node.value, ctx);
    return value ? [ctx.block('change_variable', [found.entry.id, value, null])] : [];
  }

  const combined = combine(read(), operator, node.value, ctx);
  return combined ? [write(combined)] : [];
}

function compileListElementAssign(node, ctx) {
  const list = requireList(node.target.target, ctx);
  const index = shiftIndex(node.target.index, ctx);
  if (!list || !index) return [];

  if (node.operator === '=') {
    const value = compileValue(node.value, ctx);
    return value ? [ctx.block('change_value_list_index', [list.id, index, value, null])] : [];
  }

  const current = ctx.block('value_of_index_from_list', [null, list.id, null, shiftIndex(node.target.index, ctx), null]);
  const combined = combine(current, node.operator, node.value, ctx);
  return combined ? [ctx.block('change_value_list_index', [list.id, index, combined, null])] : [];
}

/** Expands `target op= value` into a `target op value` expression. */
function combine(current, operator, valueNode, ctx) {
  const value = compileValue(valueNode, ctx);
  if (!value) return null;
  const arithmetic = { '+=': 'PLUS', '-=': 'MINUS', '*=': 'MULTI', '/=': 'DIVIDE' };
  if (arithmetic[operator]) return ctx.block('calc_basic', [current, arithmetic[operator], value]);
  if (operator === '%=') return ctx.block('quotient_and_mod', [null, current, null, value, null, 'MOD']);
  if (operator === '**=') {
    if (valueNode.type === 'Number' && valueNode.value === 2) {
      return ctx.block('calc_operation', [null, current, null, 'square']);
    }
    if (valueNode.type === 'Number' && valueNode.value === 0.5) {
      return ctx.block('calc_operation', [null, current, null, 'root']);
    }
    return ctx.error(valueNode, '엔트리에서 **= 은 2(제곱) 또는 0.5(제곱근)만 쓸 수 있습니다.');
  }
  return ctx.error(valueNode, `연산자 '${operator}' 를 엔트리 블록으로 바꿀 수 없습니다.`);
}

/** Object property assignment. */
function compilePropertyAssign(node, name, ctx) {
  const { operator } = node;
  const relative = operator === '+=' || operator === '-=';
  const negate = operator === '-=';

  const value = () => {
    const compiled = compileValue(node.value, ctx);
    if (!compiled || !negate) return compiled;
    if (node.value.type === 'Number') return ctx.number(-node.value.value);
    return ctx.block('calc_basic', [ctx.number(0), 'MINUS', compiled]);
  };
  const angleValue = () => {
    if (!negate) return compileAngle(node.value, ctx);
    if (node.value.type === 'Number') return ctx.angle(-node.value.value);
    const compiled = compileValue(node.value, ctx);
    return compiled && ctx.block('calc_basic', [ctx.number(0), 'MINUS', compiled]);
  };
  const simple = (setType, addType, make = value) => {
    if (operator === '=') {
      const compiled = make();
      return compiled ? [ctx.block(setType, [compiled, null])] : [];
    }
    if (relative && addType) {
      const compiled = make();
      return compiled ? [ctx.block(addType, [compiled, null])] : [];
    }
    return readModifyWrite(name, setType, node, ctx);
  };

  switch (name) {
    case 'x': return simple('locate_x', 'move_x');
    case 'y': return simple('locate_y', 'move_y');
    case 'size': return simple('set_scale_size', 'change_scale_size');
    case 'angle': return simple('rotate_absolute', 'rotate_relative', angleValue);
    case 'way': return simple('direction_absolute', 'direction_relative', angleValue);

    case 'scale_x': case 'scale_y': {
      if (relative) {
        const compiled = value();
        const dimension = name === 'scale_x' ? 'WIDTH' : 'HEIGHT';
        return compiled ? [ctx.block('stretch_scale_size', [dimension, compiled, null])] : [];
      }
      if (operator !== '=') {
        return [ctx.error(node, `${name} 에는 = 과 +=, -= 만 쓸 수 있습니다.`)].filter(Boolean);
      }
      // Entry has no block that "sets" a single axis's ratio directly.
      // A compiler-synthesized function measures the current size and hits the target ratio.
      if (ctx.funcScope) {
        return [ctx.error(node, `${name} 을(를) 정하는 일은 함수 안에서 할 수 없습니다. 오브젝트마다 시작 배율이 다르기 때문입니다.`)].filter(Boolean);
      }
      const compiled = compileValue(node.value, ctx);
      if (!compiled) return [];
      const setter = requireScaleSetter(name, ctx);
      return [ctx.block(`func_${setter.id}`, [compiled, ctx.number(originScale(name, ctx)), null])];
    }

    case 'costume': {
      if (operator !== '=') return [ctx.error(node, 'costume 은 = 로만 바꿀 수 있습니다.')].filter(Boolean);
      const picture = resolvePicture(node.value, ctx);
      return picture ? [ctx.block('change_to_some_shape', [picture, null])] : [];
    }

    case 'effect_color': case 'effect_brightness': case 'effect_alpha': {
      const effect = EFFECTS[name];
      const compiled = value();
      if (!compiled) return [];
      if (operator === '=') return [ctx.block('change_effect_amount', [effect, compiled, null])];
      if (relative) return [ctx.block('add_effect_amount', [effect, compiled, null])];
      return [ctx.error(node, `효과 값에는 = 과 +=, -= 만 쓸 수 있습니다.`)].filter(Boolean);
    }

    case 'draw_color': case 'fill_color': {
      if (operator !== '=') return [ctx.error(node, `${name} 은(는) = 로만 정할 수 있습니다.`)].filter(Boolean);
      if (node.value.type === 'Call' && node.value.callee === 'random_color') {
        if (name === 'fill_color') {
          return [ctx.error(node, '엔트리에는 무작위 채우기 색 블록이 없습니다.')].filter(Boolean);
        }
        return [ctx.block('set_random_color', [null])];
      }
      const compiled = compileColor(node.value, ctx);
      if (compiled === 'transparent') return [rejectRuntimeTransparent(name, node, ctx)].filter(Boolean);
      const type = name === 'draw_color' ? 'set_color' : 'set_fill_color';
      return compiled ? [ctx.block(type, [compiled, null])] : [];
    }

    case 'draw_width': return simple('set_thickness', 'change_thickness');
    case 'draw_alpha': return simple('set_brush_tranparency', 'change_brush_transparency');
    case 'sound_volume': return simple('sound_volume_set', 'sound_volume_change');
    case 'sound_speed': return simple('sound_speed_set', 'sound_speed_change');

    // --- text box -------------------------------------------------------------
    case 'text_content': {
      if (operator !== '=') return [ctx.error(node, 'text_content 는 = 로만 바꿀 수 있습니다. 이어 붙이려면 append 를 쓰세요.')].filter(Boolean);
      const compiled = value();
      return compiled ? [ctx.block('text_write', [compiled, null])] : [];
    }

    case 'font': {
      if (node.value.type !== 'String') return [ctx.error(node, '글씨체는 문자열로 적어야 합니다.')].filter(Boolean);
      return [ctx.block('text_change_font', [node.value.value, null])];
    }

    case 'font_color': case 'bg_color': {
      const compiled = compileColor(node.value, ctx);
      if (compiled === 'transparent') return [rejectRuntimeTransparent(name, node, ctx)].filter(Boolean);
      const type = name === 'font_color' ? 'text_change_font_color' : 'text_change_bg_color';
      return compiled ? [ctx.block(type, [compiled, null])] : [];
    }

    case 'text_bold': case 'text_italic': case 'text_underline': case 'text_strikethrough': {
      if (node.value.type !== 'Boolean') {
        return [ctx.error(node, `${name} 에는 true 또는 false 만 쓸 수 있습니다.`)].filter(Boolean);
      }
      const mode = node.value.value ? 'on' : 'off';
      return [ctx.block('text_change_effect', [TEXT_EFFECTS[name], mode, null])];
    }

    default:
      return [ctx.error(node, `선언되지 않은 이름 '${name}' 에 값을 대입했습니다. var 로 먼저 선언하세요.`)].filter(Boolean);
  }
}

/** Object's starting width/height scale (what Entry's "reset to original size" reverts to). */
function originScale(name, ctx) {
  const properties = ctx.object?.properties;
  const read = (key) => {
    const value = properties?.get(key);
    return value?.type === 'Number' ? value.value : null;
  };
  return (read(name) ?? read('size') ?? 100) / 100;
}

/** Expands compound assignment by reading, computing, and writing back the value. */
function readModifyWrite(name, setType, node, ctx) {
  const coordinate = READABLE_PROPERTIES[name];
  if (!coordinate) {
    return [ctx.error(node, `'${name}' 은(는) ${node.operator} 연산을 지원하지 않습니다.`)].filter(Boolean);
  }
  const current = ctx.block('coordinate_object', [null, 'self', null, coordinate]);
  const combined = combine(current, node.operator, node.value, ctx);
  return combined ? [ctx.block(setType, [combined, null])] : [];
}

/** Converts a tts statement's voice/speed/pitch value to Entry's code value (see SPEC-ADDENDUM.md 5). */
function ttsOption(table, node, label, ctx) {
  if (node.type !== 'String') return ctx.error(node, `tts ${label}은(는) 문자열로 적어야 합니다.`);
  const key = node.value.trim().toLowerCase();
  const value = table[key];
  if (value === undefined) {
    const known = [...new Set(Object.values(table))].join(', ');
    return ctx.error(node, `tts ${label} '${node.value}' 을(를) 모릅니다. 쓸 수 있는 값: ${known}`);
  }
  return value;
}

function compileColor(node, ctx) {
  if (node.type === 'Color') return node.value;
  if (node.type === 'Transparent') return 'transparent';
  if (node.type === 'String') return node.value;
  return ctx.error(node, '색은 #ff0000 처럼 색상 리터럴로 적어야 합니다.');
}

/**
 * set_color/set_fill_color/text_change_font_color/text_change_bg_color all
 * force-prepend '#' to any value that doesn't already start with it
 * (entryjs block_brush.js / block_text.js func: `if (color.indexOf('#') !==
 * 0) color = '#' + color`). Passing 'transparent' therefore becomes the
 * invalid color "#transparent", which hex2rgb then reduces to '#000000'
 * black (brush) or which the browser silently ignores, leaving the prior
 * color — usually near-black (text box). So these four properties can
 * never actually be set to transparent through this block at runtime —
 * an Entry limitation. Static properties declared at the top of an
 * object/text-box declaration bypass this block entirely and write
 * directly into the Entry project.json entity value, so those work fine.
 */
function rejectRuntimeTransparent(name, node, ctx) {
  return ctx.error(
    node,
    `실행 중에는 ${name} 을(를) transparent 로 정할 수 없습니다. 엔트리의 색 블록은 '#' 로 시작하지 `
    + `않는 값을 받으면 강제로 '#' 를 붙이는데, 그러면 transparent 가 잘못된 색이 되어 오히려 검은색으로 `
    + `보입니다(엔트리 자체의 한계로, 이 프로젝트가 만들 수 있는 블록으로는 피할 방법이 없습니다). `
    + `오브젝트/글상자 선언 맨 위에서 ${name} = transparent 로 정적으로만 쓸 수 있습니다.`,
  );
}

// ---------------------------------------------------------------------------
//  function call statements
// ---------------------------------------------------------------------------
function compileCallStatement(node, ctx) {
  const call = node.expression;
  const fn = ctx.functionByName.get(call.callee);
  if (!fn) {
    return [ctx.error(node, `'${call.callee}' 함수를 찾을 수 없습니다. 내장 함수는 문장으로 쓸 수 없습니다.`)].filter(Boolean);
  }
  if (fn.isValue) {
    return [ctx.error(node, `함수 '${call.callee}' 는 값을 돌려줍니다. var 결과 = ${call.callee}(...) 처럼 값으로 받아 쓰세요.`)].filter(Boolean);
  }
  if (call.arguments.length !== fn.params.length) {
    return [ctx.error(node, `함수 '${call.callee}' 는 인자가 ${fn.params.length}개여야 합니다.`)].filter(Boolean);
  }
  const params = compileCallArguments(fn, call.arguments, ctx);
  if (params.some((param) => param === null)) return [];
  // a void function block has one extra icon slot (null) appended
  return [ctx.block(`func_${fn.id}`, [...params, null])];
}
