import { EXPANSION_BLOCKS } from "./expansion.ts";

/**
 * @fileoverview 사양서(spec)에 정의된 내장 식별자 목록을 정의합니다.
 */

/**
 * 읽기 전용 상태 값을 나타내는 집합입니다.
 * 
 * @type {Set<string>}
 * 
 * @example
 * STATE_VALUES.has("mouse_down"); // true
 * STATE_VALUES.has("costume"); // false
 */
export const STATE_VALUES = new Set([
  "mouse_down",
  "clicked",
  "boost_mode",
  "touchable",
  "device",
  "user_id",
  "nickname",
  "timer",
  "answer",
  "block_count",
  "costume_number",
]);

/**
 * 내장 함수 이름들을 나타내는 집합입니다.
 * 
 * @type {Set<string>}
 * 
 * @example
 * BUILTIN_FUNCTIONS.has("sin"); // true
 * BUILTIN_FUNCTIONS.has("random_color"); // true
 */
export const BUILTIN_FUNCTIONS = new Set([
  "key_down",
  "touching",
  "type",
  "sin",
  "cos",
  "tan",
  "asin",
  "acos",
  "atan",
  "log2",
  "ln",
  "log10",
  "floor",
  "ceil",
  "round",
  "abs",
  "random",
  "root",
  "x",
  "y",
  "angle",
  "way",
  "size",
  "costume",
  "costume_number",
  "distance",
  "block_count",
  "text_content",
  "length",
  "slice",
  "count",
  "join",
  "index_of",
  "replace",
  "reverse",
  "uppercase",
  "lowercase",
  "contains",
  "sound_duration",
  "now",
  "to_hex",
  "from_hex",
  "random_color",
  "row_count",
  "column_count",
  "last_row",
  "correlation",
  "lookup",
  "sum",
  "average",
  "maximum",
  "minimum",
  "stdev",
  "median",
  ...Object.keys(EXPANSION_BLOCKS),
]);

/**
 * 옵션 식별자를 나타내는 집합입니다.
 * 
 * @type {Set<string>}
 * 
 * @example
 * OPTION_KEYWORDS.has("red"); // true
 */
export const OPTION_KEYWORDS = new Set(["red", "green", "blue"]);

/**
 * 글상자 전용 속성을 나타내는 집합입니다.
 * 
 * @type {Set<string>}
 * 
 * @example
 * TEXT_ONLY_PROPERTIES.has("font_size"); // true
 */
export const TEXT_ONLY_PROPERTIES = new Set([
  "text_content",
  "font",
  "font_color",
  "bg_color",
  "font_size",
  "text_bold",
  "text_italic",
  "text_underline",
  "text_strikethrough",
  "text_align",
  "line_break",
]);

/**
 * 객체가 가질 수 있는 쓰기 가능한 속성을 나타내는 집합입니다.
 * 
 * @type {Set<string>}
 * 
 * @example
 * OBJECT_PROPERTIES.has("x"); // true
 * OBJECT_PROPERTIES.has("effect_color"); // true
 */
export const OBJECT_PROPERTIES = new Set([
  "x",
  "y",
  "size",
  "scale_x",
  "scale_y",
  "angle",
  "way",
  "costume",
  "rotation",
  "effect_color",
  "effect_brightness",
  "effect_alpha",
  "draw_color",
  "draw_width",
  "draw_alpha",
  "fill_color",
  "sound_volume",
  "sound_speed",
]);
