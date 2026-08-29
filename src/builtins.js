// ============================================================================
//  spec 에 정의된 내장 이름 목록
//  (문법은 이 이름들을 특별 취급하지 않는다. 파싱 이후 검증/변환 단계에서 쓴다.)
// ============================================================================

/** 11.1 상태 값 — 괄호 없이 이름 그대로 쓰는 읽기 전용 값 */
export const STATE_VALUES = new Set([
  'mouse_down', 'clicked', 'boost_mode', 'touchable', 'device',
  'user_id', 'nickname', 'timer', 'answer', 'block_count',
  // costume 은 costume = ... 로도 쓸 수 있어 OBJECT_PROPERTIES 에 있지만,
  // costume_number("지금 몇 번째 모양인지")는 쓰는 자리가 없는 순수 읽기 전용이다.
  'costume_number',
]);

/** 11.2 · 12 내장 함수 */
export const BUILTIN_FUNCTIONS = new Set([
  // 판단
  'key_down', 'touching', 'type',
  // 수학
  'sin', 'cos', 'tan', 'asin', 'acos', 'atan',
  'log2', 'ln', 'log10', 'floor', 'ceil', 'round', 'abs', 'random', 'root',
  // 객체 정보
  'x', 'y', 'angle', 'way', 'size', 'costume', 'costume_number', 'distance', 'block_count', 'text_content',
  // 문자열
  'length', 'slice', 'count', 'join', 'index_of', 'replace',
  'reverse', 'uppercase', 'lowercase',
  // 리스트
  'contains',
  // 소리
  'sound_duration',
  // 시간 · 색상
  'now', 'to_hex', 'from_hex', 'random_color',
]);

/** 옵션 식별자 (spec 의 `Keyword` 타입) — 괄호 없는 이름이지만 변수가 아니다 */
export const OPTION_KEYWORDS = new Set(['red', 'green', 'blue']);

/** 8.5 글상자 전용 속성 — 일반 object 에서는 쓸 수 없다 */
export const TEXT_ONLY_PROPERTIES = new Set([
  'text_content', 'font', 'font_color', 'bg_color', 'font_size',
  'text_bold', 'text_italic', 'text_underline', 'text_strikethrough',
  'text_align', 'line_break',
]);

/** 8.x 오브젝트가 가진 쓰기 가능한 속성 */
export const OBJECT_PROPERTIES = new Set([
  'x', 'y', 'size', 'scale_x', 'scale_y', 'angle', 'way', 'costume', 'rotation',
  'effect_color', 'effect_brightness', 'effect_alpha',
  'draw_color', 'draw_width', 'draw_alpha', 'fill_color',
  'sound_volume', 'sound_speed',
]);
