/**
 * @fileoverview Tess grammar for tree-sitter.
 *
 * Mirrors the Chevrotain grammar in `src/parser/parser.ts` rule for rule, so the
 * converter in `src/tree/convert.ts` can build the same AST. Two things the
 * Chevrotain grammar decides with gates are handled differently here:
 *
 * - "same line" conditions use `_same_line`, a zero-width token from the
 *   external scanner that exists only when no line break comes before the next
 *   token;
 * - keywords that double as names are listed in `identifier`, and the
 *   statement/assignment choice is left to GLR with dynamic precedence.
 *
 * The keyword lists below must match `src/parser/tokens.ts`; a test checks it.
 */

/* eslint-disable no-undef */

const KEYWORDS = [
  'add', 'all', 'and', 'append', 'as', 'ask', 'async', 'at', 'back', 'bgm', 'bounce', 'break',
  'bubble', 'call', 'center', 'clear', 'click', 'clone', 'cloned', 'clones',
  'chart', 'column', 'columns', 'continue', 'costume', 'default', 'del', 'description', 'do', 'draw', 'effects', 'else',
  'end', 'false', 'fill', 'flip', 'for', 'force', 'forever', 'forward', 'fps',
  'free', 'from', 'front', 'first', 'function', 'go', 'hide', 'id', 'if', 'in',
  'insert', 'jump', 'key', 'kill', 'last', 'list', 'lock', 'look', 'me', 'move',
  'name', 'next', 'none', 'not', 'object', 'or', 'order', 'other', 'pitch',
  'play', 'prepend', 'prev', 'project', 'read', 'realtime', 'remove', 'repeat',
  'reset', 'restart', 'return', 'rotation', 'row', 'save', 'say', 'scene', 'send',
  'series', 'shared', 'signal', 'show',
  'size', 'skip', 'sound', 'speed', 'stage', 'stamp', 'start', 'steer', 'stop', 'store',
  'table', 'text', 'them', 'then', 'think', 'this', 'timer', 'title', 'to', 'transparent',
  'true', 'tts', 'turn', 'until', 'up', 'use', 'useobject', 'usetext', 'var',
  'vertical', 'visible', 'voice', 'wait', 'when', 'while', 'write', 'x', 'y',
];

const RESERVED = ['and', 'or', 'not', 'true', 'false', 'end', 'then', 'do', 'in', 'wait'];

const STANDALONE = [
  'break', 'continue', 'skip', 'restart', 'stop', 'bounce', 'stamp', 'show', 'hide',
  'clone', 'kill',
];

/** Plain words that name an object property in `name = value` (not keywords in Tess). */
const PROPERTY_WORDS = [
  'scale_x', 'scale_y',
  'text_content', 'text_bold', 'text_italic',
  'text_underline', 'text_strikethrough', 'text_align',
  'font_color', 'font_size', 'font', 'bg_color', 'line_break',
  'draw_color', 'draw_width', 'draw_alpha', 'fill_color',
  'angle', 'way',
];

/** Keywords that open a statement; followed by `(` they still do (`if (a):`). */
const STATEMENT_LEADERS = [
  'if', 'repeat', 'while', 'until', 'forever', 'wait', 'return', 'break', 'continue', 'skip', 'restart',
  'stop', 'start', 'reset', 'clear', 'send', 'call', 'clone', 'del', 'kill', 'jump', 'forward', 'bounce',
  'move', 'go', 'turn', 'steer', 'look', 'show', 'hide', 'next', 'prev', 'say', 'think', 'flip', 'order',
  'write', 'append', 'prepend', 'stamp', 'play', 'read', 'tts', 'in', 'remove', 'ask', 'save', 'var', 'list',
];

/** Keywords that are also names wherever a name is read. */
const NAME_KEYWORDS = KEYWORDS.filter((word) => !RESERVED.includes(word));

/** Names an assignment or call may start with: a standalone command never does. */
const LEAD_KEYWORDS = NAME_KEYWORDS.filter((word) => !STANDALONE.includes(word));

/** Names a statement-level call may start with. */
const CALL_KEYWORDS = LEAD_KEYWORDS.filter((word) => !STATEMENT_LEADERS.includes(word));

const PREC = {
  keyword_statement: 2,
  assignment: 1,
};

const commaSep = (rule) => optional(seq(rule, repeat(seq(',', rule))));
const commaSep1 = (rule) => seq(rule, repeat(seq(',', rule)));

module.exports = grammar({
  name: 'tess',

  word: ($) => $._word,

  // No keyword is ever a plain word; the ones that name things are listed in `identifier`.
  reserved: {
    global: () => KEYWORDS,
  },

  externals: ($) => [$._same_line, $.color, $.comment, $._call_open, $._index_open, $.string],

  extras: ($) => [/\s/, $.comment],

  conflicts: ($) => [
    [$.point_args, $._pow],
    [$._and, $.and_expr],
    [$.block],
  ],

  rules: {
    program: ($) => repeat($._top_level_item),

    _top_level_item: ($) => choice(
      $.project_decl,
      $.scene_decl,
      $.object_decl,
      $.function_decl,
      $.use_object_decl,
      $.use_decl,
      $.var_decl,
      $.list_decl,
      $.table_decl,
    ),

    table_decl: ($) => seq(
      'table',
      field('name', $.identifier),
      optional(field('display_name', $.display_name)),
      ':',
      field('columns', $.table_columns),
      repeat(field('rows', $.table_row)),
      repeat(field('charts', $.table_chart)),
      'end',
    ),

    table_chart: ($) => seq(
      'chart',
      field('kind', $.identifier),
      optional(field('title', $.string)),
      optional(seq('x', field('x', $._unary))),
      optional(seq('y', field('y', $._unary))),
      optional(seq('series', field('series', $._unary), repeat(seq(',', field('series', $._unary))))),
    ),

    table_columns: ($) => seq('columns', $._table_cells),
    table_row: ($) => seq('row', $._table_cells),
    _table_cells: ($) => commaSep1(field('cell', $._expr)),

    use_decl: ($) => seq('use', field('path', $.string)),

    use_object_decl: ($) => seq(field('kind', choice('useobject', 'usetext')), field('path', $.string)),

    project_decl: ($) => seq('project', $._block_open, repeat($.project_field), 'end'),

    project_field: ($) => choice(
      seq(field('field', 'title'), field('text', $.string)),
      seq(field('field', 'description'), field('text', $.string)),
      seq(field('field', 'fps'), field('number', $.number)),
    ),

    scene_decl: ($) => seq('scene', field('name', $.string), $._block_open, repeat($._scene_member), 'end'),

    _scene_member: ($) => choice($.object_decl, $.use_object_decl, $.use_decl, $.scene_name_decl),

    scene_name_decl: ($) => seq('name', field('text', $.string)),

    object_decl: ($) => seq(
      field('kind', choice('object', 'text')),
      field('name', $.string),
      $._block_open,
      repeat($.object_member),
      'end',
    ),

    object_member: ($) => choice(
      $.var_decl,
      $.list_decl,
      $.function_decl,
      $.event_handler,
      $.use_decl,
      $.costume_property,
      $.sound_property,
      $.name_property,
      $.flag_property,
      $.rotation_property,
      $.box_size_property,
      $.center_property,
      $.assign_property,
    ),

    name_property: ($) => seq('name', field('text', $.string)),
    flag_property: ($) => seq(field('flag', choice('visible', 'lock')), field('value', $.boolean)),
    rotation_property: ($) => seq('rotation', field('method', choice('free', 'vertical', 'none'))),
    box_size_property: ($) => seq('size', field('width', $.number), field('height', $.number)),
    center_property: ($) => seq('center', field('x', $.signed_number), field('y', $.signed_number)),
    assign_property: ($) => seq(field('target', $.property_name), '=', field('value', $._expr)),

    property_name: ($) => choice('size', 'x', 'y', ...PROPERTY_WORDS),

    costume_property: ($) => prec.right(seq(
      optional(field('is_default', 'default')),
      'costume',
      field('id', $.identifier),
      field('file', $.string),
      optional(seq('size', field('width', $.number), field('height', $.number))),
      optional(field('display_name', $.display_name)),
      optional(field('force_id', $.force_id)),
    )),

    sound_property: ($) => prec.right(seq(
      'sound',
      field('id', $.identifier),
      field('file', $.string),
      optional(seq('for', field('duration', $.number))),
      optional(field('display_name', $.display_name)),
      optional(field('force_id', $.force_id)),
    )),

    display_name: ($) => seq('as', field('text', $.string)),
    force_id: ($) => seq('force', 'id', field('text', $.string)),

    function_decl: ($) => seq(
      'function',
      field('name', $.identifier),
      '(',
      commaSep(field('params', $.function_param)),
      ')',
      $._block_open,
      optional(field('body', $.block)),
      'end',
    ),

    function_param: ($) => seq(field('name', $.identifier), optional(field('boolean', '?'))),

    storage_scope: ($) => choice('shared', 'realtime', 'store'),
    _storage_prefix: ($) => field('scope', $.storage_scope),

    var_decl: ($) => prec.right(1, seq(
      optional($._storage_prefix),
      'var',
      field('name', $.identifier),
      optional(field('display_name', $.display_name)),
      '=',
      field('value', $._expr),
      optional(seq('from', field('min', $._expr), 'to', field('max', $._expr))),
      optional(field('shown', 'visible')),
      optional(seq('at', field('at_x', $._unary), field('at_y', $._unary))),
    )),

    list_decl: ($) => prec.right(1, seq(
      optional($._storage_prefix),
      'list',
      field('name', $.identifier),
      optional(field('display_name', $.display_name)),
      '=',
      field('value', $.list_literal),
      optional(field('shown', 'visible')),
      optional(seq('at', field('at_x', $._unary), field('at_y', $._unary))),
      optional(seq('size', field('size_w', $._unary), field('size_h', $._unary))),
    )),

    event_handler: ($) => seq(
      'when',
      choice(
        seq(field('scene_start', 'scene'), 'start'),
        field('start', 'start'),
        seq(field('key', 'key'), field('key_name', $.string), optional(field('up', 'up'))),
        seq(field('stage', 'stage'), 'click', optional(field('up', 'up'))),
        seq(field('click', 'click'), optional(field('up', 'up'))),
        seq(field('signal', 'signal'), field('signal_name', $.string)),
        field('cloned', 'cloned'),
      ),
      $._block_open,
      optional(field('body', $.block)),
      'end',
    ),

    _block_open: ($) => choice(':', 'then', 'do'),

    block: ($) => repeat1($.statement),

    statement: ($) => choice(
      prec.dynamic(PREC.keyword_statement, choice(
        $.if_statement,
        $.repeat_statement,
        $.while_statement,
        $.until_statement,
        $.forever_statement,
        $.wait_statement,
        $.return_statement,
        $.flow_statement,
        $.stop_statement,
        $.start_statement,
        $.reset_statement,
        $.clear_statement,
        $.signal_statement,
        $.clone_statement,
        $.delete_statement,
        $.jump_statement,
        $.forward_statement,
        $.bounce_statement,
        $.move_statement,
        $.go_statement,
        $.turn_statement,
        $.look_statement,
        $.show_hide_statement,
        $.costume_step_statement,
        $.say_statement,
        $.flip_statement,
        $.order_statement,
        $.text_statement,
        $.pen_statement,
        $.sound_statement,
        $.read_statement,
        $.tts_statement,
        $.list_add_statement,
        $.list_remove_statement,
        $.ask_statement,
        $.save_statement,
        $.var_decl,
        $.list_decl,
      )),
      prec.dynamic(PREC.assignment, $.assign_or_call),
    ),

    if_statement: ($) => prec.right(1, seq(
      'if',
      field('test', $._expr),
      $._block_open,
      optional(field('consequent', $.block)),
      optional(seq('else', $._block_open, optional(field('alternate', $.block)))),
      'end',
    )),

    repeat_statement: ($) => prec.right(1, seq('repeat', field('test', $._expr), $._block_open, optional(field('body', $.block)), 'end')),
    while_statement: ($) => prec.right(1, seq('while', field('test', $._expr), $._block_open, optional(field('body', $.block)), 'end')),
    until_statement: ($) => prec.right(1, seq('until', field('test', $._expr), $._block_open, optional(field('body', $.block)), 'end')),
    forever_statement: ($) => prec.right(1, seq('forever', $._block_open, optional(field('body', $.block)), 'end')),

    wait_statement: ($) => prec.right(1, seq('wait', field('value', $._expr))),
    flow_statement: ($) => field('kind', choice('break', 'continue', 'skip', 'restart')),
    return_statement: ($) => prec.right(1, seq('return', field('value', $._expr))),

    stop_statement: ($) => prec.right(1, seq('stop', optional(choice(
      seq(field('sound', 'sound'), field('target', choice('this', 'all'))),
      field('what', choice('draw', 'fill', 'bgm', 'timer', 'project')),
      field('scope', choice('other', 'me', 'object', 'them', 'all')),
    )))),

    start_statement: ($) => prec.right(1, seq('start', field('what', choice('draw', 'fill', 'timer')))),
    reset_statement: ($) => prec.right(1, seq('reset', field('what', choice('size', 'timer')))),
    clear_statement: ($) => prec.right(1, seq('clear', field('what', choice('effects', 'bubble', 'draw', 'text')))),
    signal_statement: ($) => prec.right(1, seq(field('kind', choice('send', 'call')), field('signal', $._expr))),

    clone_statement: ($) => prec.right(1, seq('clone', optional(seq($._same_line, field('target', $._expr))))),

    delete_statement: ($) => prec.right(1, choice(
      seq('del', choice(field('all', 'clones'), field('one', 'clone'))),
      field('one', 'kill'),
    )),

    jump_statement: ($) => prec.right(1, seq('jump', choice(
      prec.dynamic(1, field('where', choice('next', 'back'))),
      field('target', $._expr),
    ))),

    forward_statement: ($) => prec.right(1, seq('forward', field('distance', $._expr), optional(seq('at', field('angle', $._expr))))),
    bounce_statement: () => 'bounce',
    move_statement: ($) => prec.right(1, seq('move', field('point', $.point_args))),

    point_args: ($) => seq(
      field('x', $._unary),
      $._same_line,
      field('y', $._unary),
      optional(seq($._same_line, 'in', field('duration', $._expr))),
    ),

    go_statement: ($) => prec.right(1, seq('go', choice(
      prec.dynamic(1, field('point', $.point_args)),
      seq(field('target', $._expr), optional(seq($._same_line, 'in', field('duration', $._expr)))),
    ))),

    turn_statement: ($) => prec.right(1, seq(
      field('kind', choice('turn', 'steer')),
      field('angle', $._expr),
      optional(seq($._same_line, 'in', field('duration', $._expr))),
    )),

    look_statement: ($) => prec.right(1, seq('look', field('target', $._expr))),

    show_hide_statement: ($) => prec.right(1, seq(
      field('kind', choice('show', 'hide')),
      optional(seq($._same_line, field('target', $.identifier), optional(seq($._same_line, choice(
        seq('for', field('seconds', $._expr)),
        seq('chart', field('chart', $._expr)),
      ))))),
    )),

    costume_step_statement: ($) => prec.right(1, seq(field('direction', choice('next', 'prev')), 'costume')),

    say_statement: ($) => prec.right(1, seq(
      field('kind', choice('say', 'think')),
      field('message', $._expr),
      optional(seq('for', field('duration', $._expr))),
    )),

    flip_statement: ($) => prec.right(1, seq('flip', field('axis', choice('x', 'y')))),
    order_statement: ($) => prec.right(1, seq('order', field('to', choice('front', 'back', 'first', 'last')))),
    text_statement: ($) => prec.right(1, seq(field('mode', choice('write', 'append', 'prepend')), field('value', $._expr))),
    pen_statement: () => 'stamp',

    sound_statement: ($) => prec.right(1, seq('play', choice(
      seq(
        field('sound', 'sound'),
        field('name', $._expr),
        optional(choice(
          seq('for', field('duration', $._expr)),
          seq('from', field('from', $._expr), 'to', field('to', $._expr)),
        )),
        optional(seq('and', field('wait', 'wait'))),
      ),
      seq(field('bgm', 'bgm'), field('name', $._expr)),
    ))),

    read_statement: ($) => prec.right(1, seq('read', field('value', $._expr), optional(seq('and', field('wait', 'wait'))))),

    tts_statement: ($) => prec.right(1, seq(
      'tts', 'voice', field('voice', $.string),
      'speed', field('speed', $.string),
      'pitch', field('pitch', $.string),
    )),

    list_add_statement: ($) => prec.right(1, seq('in', field('list', $.identifier), choice(
      seq(field('add', 'add'), field('value', $._expr)),
      seq(field('insert', 'insert'), field('value', $._expr), 'at', field('index', $._expr)),
      seq(
        choice(field('add_line', 'add'), field('insert_line', 'insert')),
        field('line', $.table_line),
        optional(seq('at', field('index', $._expr))),
      ),
    ))),

    table_line: () => prec(1, choice('row', 'column')),

    list_remove_statement: ($) => prec.right(1, seq('remove', field('list', $.identifier), choice(
      seq('[', field('index', $._expr), ']'),
      seq(field('line', $.table_line), field('index', $._expr)),
    ))),

    ask_statement: ($) => prec.right(1, seq('ask', field('question', $._expr))),

    save_statement: ($) => prec.right(1, seq('save', optional(seq($._same_line, choice(
      prec.dynamic(1, field('async', 'async')),
      field('table', $.identifier),
    ))))),

    assign_or_call: ($) => choice(
      field('call', alias($._lead_call, $.call_expr)),
      seq(field('target', $.lvalue), field('operator', $.assign_operator), field('value', $._expr)),
    ),

    _lead_call: ($) => seq(field('callee', alias($._call_name, $.identifier)), $._call_open, commaSep(field('args', $._expr)), ')'),

    lvalue: ($) => seq(
      field('name', alias($._lead_name, $.identifier)),
      optional(seq($._index_open, field('index', $._expr), optional(seq(',', field('column', $._expr))), ']')),
    ),

    assign_operator: () => choice('+=', '-=', '**=', '*=', '/=', '%=', '='),

    // ------------------------------------------------------------------------
    //  Expressions, lowest precedence first. Each level is its own rule, as in
    //  the Chevrotain grammar, so the converter can fold the chains the same way.
    // ------------------------------------------------------------------------
    _expr: ($) => $._or,

    _or: ($) => choice($._and, $.or_expr),
    or_expr: ($) => seq(field('operands', $._and), repeat1(seq(field('operators', 'or'), field('operands', $._and)))),

    _and: ($) => choice($._not, $.and_expr),
    and_expr: ($) => prec.left(seq(field('operands', $._not), repeat1(seq(field('operators', 'and'), field('operands', $._not))))),

    _not: ($) => choice($._compare, $.not_expr),
    not_expr: ($) => seq(repeat1(field('operators', 'not')), field('operand', $._compare)),

    _compare: ($) => choice($._add, $.compare_expr),
    compare_expr: ($) => seq(
      field('operands', $._add),
      repeat1(seq(field('operators', choice('==', '!=', '<=', '>=', '<', '>')), field('operands', $._add))),
    ),

    _add: ($) => choice($._mul, $.add_expr),
    add_expr: ($) => seq(field('operands', $._mul), repeat1(seq(field('operators', choice('+', '-')), field('operands', $._mul)))),

    _mul: ($) => choice($._pow, $.mul_expr),
    mul_expr: ($) => seq(
      field('operands', $._pow),
      repeat1(seq(field('operators', choice('//', '*', '/', '%')), field('operands', $._pow))),
    ),

    _pow: ($) => choice($._unary, $.pow_expr),
    pow_expr: ($) => seq(field('base', $._unary), '**', field('exponent', $._pow)),

    _unary: ($) => choice($.primary_expr, $.unary_expr),
    unary_expr: ($) => seq(repeat1(field('operators', '-')), field('operand', $.primary_expr)),

    primary_expr: ($) => choice(
      seq('(', field('inner', $._expr), ')'),
      field('call', $.call_expr),
      field('index', $.index_expr),
      field('number', $.number),
      field('string', $.string),
      field('boolean', $.boolean),
      field('color', $.color),
      prec(1, field('transparent', 'transparent')),
      field('name', $.identifier),
    ),

    call_expr: ($) => seq(field('callee', $.identifier), $._call_open, commaSep(field('args', $._expr)), ')'),

    index_expr: ($) => seq(
      field('target', $.identifier),
      $._index_open,
      field('index', $._expr),
      optional(seq(',', field('column', $._expr))),
      ']',
    ),

    list_literal: ($) => seq('[', commaSep(field('elements', $._expr)), ']'),

    // ------------------------------------------------------------------------
    //  Terminals
    // ------------------------------------------------------------------------
    identifier: ($) => choice($._word, ...NAME_KEYWORDS, ...PROPERTY_WORDS),
    _lead_name: ($) => choice($._word, ...LEAD_KEYWORDS, ...PROPERTY_WORDS),
    _call_name: ($) => choice($._word, ...CALL_KEYWORDS, ...PROPERTY_WORDS),

    boolean: () => choice('true', 'false'),

    // Only an attached sign counts, so `- 5` still reads as a subtraction.
    signed_number: ($) => choice(
      seq(field('sign', '-'), field('number', alias($._attached_number, $.number))),
      field('number', $.number),
    ),
    _attached_number: () => token.immediate(/\d+\.\d+|\d+/),

    number: () => /\d+\.\d+|\d+/,

    _word: () => /[\p{L}_][\p{L}0-9_]*/,
  },
});
