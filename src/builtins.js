// ============================================================================
//  Built-in names defined by the spec.
//  (The grammar does not special-case these; they're used in the
//  post-parse validation/compilation stages.)
// ============================================================================

/** 11.1 state values — read-only, used bare (no parentheses). */
export const STATE_VALUES = new Set([
  'mouse_down', 'clicked', 'boost_mode', 'touchable', 'device',
  'user_id', 'nickname', 'timer', 'answer', 'block_count',
  // `costume` is also assignable (in OBJECT_PROPERTIES), but costume_number
  // (the current costume index) has no assignment form and is read-only.
  'costume_number',
]);

/** 11.2 · 12 built-in functions. */
export const BUILTIN_FUNCTIONS = new Set([
  // Judgment
  'key_down', 'touching', 'type',
  // Math
  'sin', 'cos', 'tan', 'asin', 'acos', 'atan',
  'log2', 'ln', 'log10', 'floor', 'ceil', 'round', 'abs', 'random', 'root',
  // Object info
  'x', 'y', 'angle', 'way', 'size', 'costume', 'costume_number', 'distance', 'block_count', 'text_content',
  // String
  'length', 'slice', 'count', 'join', 'index_of', 'replace',
  'reverse', 'uppercase', 'lowercase',
  // List
  'contains',
  // Time · color
  'now', 'to_hex', 'from_hex', 'random_color',
]);

/** Option identifiers (spec's `Keyword` type) — bare names that aren't variables. */
export const OPTION_KEYWORDS = new Set(['red', 'green', 'blue']);

/** 8.5 text-only properties — not usable on a plain object. */
export const TEXT_ONLY_PROPERTIES = new Set([
  'text_content', 'font', 'font_color', 'bg_color', 'font_size',
  'text_bold', 'text_italic', 'text_underline', 'text_strikethrough',
  'text_align', 'line_break',
]);

/** 8.x writable object properties. */
export const OBJECT_PROPERTIES = new Set([
  'x', 'y', 'size', 'scale_x', 'scale_y', 'angle', 'way', 'costume', 'rotation',
  'effect_color', 'effect_brightness', 'effect_alpha',
  'draw_color', 'draw_width', 'draw_alpha', 'fill_color',
  'sound_volume', 'sound_speed',
]);
