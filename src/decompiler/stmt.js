// ============================================================================
//  Entry statement block -> Tess source lines.
//
//  Inverts the exact mapping in src/compiler/statement.js. Takes a thread
//  (a chain of blocks) and returns unindented text lines; the caller
//  applies indentation via `indent()`. An unknown block is left as a
//  comment rather than aborting the whole conversion.
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
// Maps set_tts_property code values back to the TTS_SPEAKERS/TTS_LEVELS aliases in src/compiler/statement.js.
const REVERSE_TTS_SPEAKER = {
  kyuri: 'female', jinho: 'male', hana: 'kind', dinna: 'sweet', brown: 'echo',
  minions: 'mischievous', sally: 'dainty', nsabina: 'nsabina', nmammon: 'nmammon',
  nmeow: 'kitty', nwoof: 'doggy',
};

export function indent(lines) {
  return lines.map((line) => (line === '' ? line : `  ${line}`));
}

/** Renders a single thread (block array) as Tess source lines. */
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
    // --- Event (hat) blocks are handled by the caller that builds flow
    //     (events.js). They shouldn't reappear inside a thread body, but
    //     skip them defensively.
    case 'when_run_button_click': case 'when_scene_start': case 'when_some_key_pressed':
    case 'when_object_click': case 'when_message_cast': case 'when_clone_start':
      return [];

    // --- Control flow --------------------------------------------------------
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

    // --- Signals · clones · scenes ---------------------------------------
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

    // --- Movement --------------------------------------------------------------
    case 'move_direction': return [`forward ${e(0)}`];
    case 'move_to_angle': return [`forward ${e(1)} at ${e(0)}`];
    case 'bounce_wall': return ['bounce'];
    case 'move_xy_time': return [`move ${e(1)} ${e(2)} in ${e(0)}`];
    case 'move_x': return [`x += ${e(0)}`];
    case 'move_y': return [`y += ${e(0)}`];
    case 'locate': {
      const target = at(0);
      return [target === 'self' ? '# go self (original Entry block targeted itself)'
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

    // --- Looks · speech bubbles ------------------------------------------------
    case 'show': return ['show'];
    case 'hide': return ['hide'];
    case 'show_variable': return [`show ${ctx.varName(at(0))}`];
    case 'hide_variable': return [`hide ${ctx.varName(at(0))}`];
    case 'show_list': return [`show ${ctx.varName(at(0))}`];
    case 'hide_list': return [`hide ${ctx.varName(at(0))}`];
    case 'set_visible_project_timer': return [`${at(1) === 'SHOW' ? 'show' : 'hide'} timer`];
    case 'set_visible_answer': return [`${at(0) === 'SHOW' ? 'show' : 'hide'} answer`];
    case 'change_to_next_shape': return [at(0) === 'prev' ? 'prev costume' : 'next costume'];
    case 'change_to_some_shape': return [`costume = ${resourceExpr(at(0), ctx, ctx.picturesById)}`];
    case 'dialog': return [`${at(1) === 'think' ? 'think' : 'say'} ${e(0)}`];
    case 'dialog_time': return [`${at(2) === 'think' ? 'think' : 'say'} ${e(0)} for ${e(1)}`];
    case 'flip_y': return ['flip x']; // Entry's flip_x/flip_y block names are swapped.
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

    // --- Text box ----------------------------------------------------------
    case 'text_write': return [`write ${e(0)}`];
    case 'text_append': return [`append ${e(0)}`];
    case 'text_prepend': return [`prepend ${e(0)}`];
    case 'text_flush': return ['clear text'];
    case 'text_change_font': return [`font = ${tessString(at(0))}`];
    case 'text_change_font_color': return [`font_color = ${colorExpr(at(0), ctx)}`];
    case 'text_change_bg_color': return [`bg_color = ${colorExpr(at(0), ctx)}`];
    case 'text_change_effect': {
      const name = REVERSE_TEXT_EFFECT[at(0)];
      return name ? [`${name} = ${at(1) === 'on' ? 'true' : 'false'}`] : unsupported(ctx, block);
    }

    // --- Pen ---------------------------------------------------------------
    case 'start_drawing': return ['start draw'];
    case 'stop_drawing': return ['stop draw'];
    case 'start_fill': return ['start fill'];
    case 'stop_fill': return ['stop fill'];
    case 'brush_stamp': return ['stamp'];
    case 'brush_erase_all': return ['clear draw'];
    case 'set_color': return [`draw_color = ${colorExpr(at(0), ctx)}`];
    case 'set_fill_color': return [`fill_color = ${colorExpr(at(0), ctx)}`];
    case 'set_random_color': return ['draw_color = random_color()'];
    case 'set_thickness': return [`draw_width = ${e(0)}`];
    case 'change_thickness': return [`draw_width += ${e(0)}`];
    case 'set_brush_tranparency': return [`draw_alpha = ${e(0)}`];
    case 'change_brush_transparency': return [`draw_alpha += ${e(0)}`];

    // --- Timer ---------------------------------------------------------------
    case 'choose_project_timer_action': {
      const action = { START: 'start timer', STOP: 'stop timer', RESET: 'reset timer' }[at(1)];
      return action ? [action] : unsupported(ctx, block);
    }

    // --- Sound ---------------------------------------------------------------
    case 'sound_something_with_block': return [`play sound ${resourceExpr(at(0), ctx, ctx.soundsById)}`];
    case 'sound_something_wait_with_block': return [`play sound ${resourceExpr(at(0), ctx, ctx.soundsById)} and wait`];
    case 'sound_something_second_with_block': return [`play sound ${resourceExpr(at(0), ctx, ctx.soundsById)} for ${e(1)}`];
    case 'sound_something_second_wait_with_block': return [`play sound ${resourceExpr(at(0), ctx, ctx.soundsById)} for ${e(1)} and wait`];
    case 'sound_from_to': return [`play sound ${resourceExpr(at(0), ctx, ctx.soundsById)} from ${e(1)} to ${e(2)}`];
    case 'sound_from_to_and_wait': return [`play sound ${resourceExpr(at(0), ctx, ctx.soundsById)} from ${e(1)} to ${e(2)} and wait`];
    case 'play_bgm': return [`play bgm ${resourceExpr(at(0), ctx, ctx.soundsById)}`];
    case 'stop_bgm': return ['stop bgm'];
    case 'sound_silent_all': return [`stop sound ${at(0) === 'thisOnly' ? 'this' : 'all'}`];
    case 'sound_volume_set': return [`sound_volume = ${e(0)}`];
    case 'sound_volume_change': return [`sound_volume += ${e(0)}`];
    case 'sound_speed_set': return [`sound_speed = ${e(0)}`];
    case 'sound_speed_change': return [`sound_speed += ${e(0)}`];

    // --- TTS speech (addendum) --------------------------------------------------
    case 'read_text': return [`read ${e(0)}`];
    case 'read_text_wait_with_block': return [`read ${e(0)} and wait`];
    case 'set_tts_property': {
      // Speed/pitch are passed through as raw code values (an alias here would be
      // ambiguous since the same code means the opposite thing for speed vs. pitch).
      return [`tts voice ${tessString(REVERSE_TTS_SPEAKER[at(0)] ?? at(0))} `
        + `speed ${tessString(String(at(1)))} pitch ${tessString(String(at(2)))}`];
    }

    // --- Data --------------------------------------------------------------------
    case 'ask_and_wait': return [`ask ${e(0)}`];
    case 'add_value_to_list': return [`in ${ctx.varName(at(1))} add ${e(0)}`];
    case 'insert_value_to_list': return [`in ${ctx.varName(at(1))} insert ${e(0)} at ${unshift(at(2), ctx)}`];
    case 'remove_value_from_list': return [`remove ${ctx.varName(at(1))}[${unshift(at(0), ctx)}]`];
    case 'change_value_list_index': return [`${ctx.varName(at(0))}[${unshift(at(1), ctx)}] = ${e(2)}`];

    // --- Variables -----------------------------------------------------------
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

/**
 * A color parameter may be a plain '#RRGGBB' string (a static entity value)
 * or, since a VALUE field like set_color's declares `Block, accept:'string'`,
 * wrapped in a value block such as `{type:'number', params:['#RRGGBB']}`.
 * Both forms must be unwrapped, or the color would render as the literal
 * string "[object Object]". A non-literal value (a variable or expression)
 * is passed to exprOf via ctx for proper Tess expression rendering.
 */
export function colorExpr(value, ctx) {
  const literal = literalStringOf(value);
  if (literal !== null) {
    if (/^#[0-9a-fA-F]{6}$/.test(literal)) return literal;
    if (literal === 'transparent') return 'transparent';
    return tessString(literal);
  }
  return ctx ? exprOf(value, ctx) : tessString(String(value ?? ''));
}

/** Returns the string value of a value block (or primitive) if it's a literal, else null. */
function literalStringOf(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && (value.type === 'number' || value.type === 'text')) {
    const raw = value.params?.[0];
    if (typeof raw === 'string') return raw;
  }
  return null;
}

/**
 * A costume/sound value slot may hold a get_pictures/get_sounds block, or,
 * as a common editor trick, the resource's raw Entry id typed directly as a
 * string literal — Entry resolves such values by id, then name, then
 * registration order, so a raw id string still resolves to the intended
 * resource. Recompiling this raw id verbatim would fail, since ids are
 * reassigned deterministically on rebuild and the old id would no longer
 * match anything. So a literal is first checked against ids actually
 * present in the project and, if it matches, rendered by name like
 * get_pictures/get_sounds. (A plain index, e.g. "switch to costume #n",
 * doesn't collide with a literal id and passes through as a normal number.)
 */
function resourceExpr(value, ctx, byId) {
  const literal = literalStringOf(value);
  if (literal !== null && byId.has(literal)) {
    // Inside a function, keep the id rather than renaming it. Its costume/sound
    // declaration carries `force id`, so recompiling still produces the same id
    // (see index.js).
    if (ctx.inFunction) return tessString(literal);
    return tessString(byId.get(literal).identifier);
  }
  return exprOf(value, ctx);
}

/**
 * Turns the top-level block (function_create[_value]) of
 * project.functions[i].content into a `function name(a, b): ... end`
 * declaration. Called directly by index.js while iterating the function
 * list, not from within an object script — function definitions live only
 * there, and their name/param names are already in ctx.functionsById.
 */
export function functionDeclarationLines(fn, createBlock, ctx) {
  const p = createBlock.params ?? [];
  const isValue = createBlock.type === 'function_create_value';
  // Costume/sound ids are not resolved to names inside a function body
  // (resourceExpr) — a function is global in Entry and may be called by
  // multiple objects, so renaming a hardcoded id to "this object's name"
  // would be wrong for any other caller (see the forcedIds note in
  // index.js's buildContext).
  const previousInFunction = ctx.inFunction;
  ctx.inFunction = true;
  const body = indent(blocksToLines(createBlock.statements?.[0] ?? [], ctx));
  const returnExpr = isValue ? exprOf(p[3], ctx) : null;
  ctx.inFunction = previousInFunction;

  const lines = [`function ${fn.name}(${fn.params.join(', ')}):`, ...body];
  if (isValue) lines.push(...indent([`return ${returnExpr}`]));
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
