// ============================================================================
//  확장 블록 (엔트리 '확장' 카테고리)
//
//  날씨 · 축제 · 재난문자 · 국민행동요령 블록은 전부 값이나 판단 하나짜리이고,
//  칸은 드롭다운(field)이거나 값 자리(value) 둘 중 하나다. 그래서 블록마다 코드를
//  따로 쓰지 않고 이 표 하나로 컴파일과 되돌리기를 함께 처리한다.
//
//  Tess 이름은 엔트리 블록 타입을 그대로 쓴다 — 이 블록들은 바깥 서비스를 그대로
//  비추는 API 라, 엔트리 문서에 적힌 이름과 어긋나지 않는 편이 찾아보기 쉽다.
//
//  kind   'value' 는 값 블록, 'boolean' 은 판단 블록
//  module project.expansionBlocks 에 들어갈 이름 (엔트리가 이 목록을 보고 초기화한다)
//  slots  칸 순서대로 'field'(드롭다운, 문자열을 그대로 적는다) 또는 'value'(식)
// ============================================================================

/** @type {Record<string, {module: string, kind: string, slots: string[]}>} */
export const EXPANSION_BLOCKS = {
  count_disaster_behavior: {
    module: 'behaviorConductDisaster', kind: 'value',
    slots: ['field', 'field'], // CATEGORY SUB_CATEGORY
  },
  get_disaster_behavior: {
    module: 'behaviorConductDisaster', kind: 'value',
    slots: ['field', 'field', 'value'], // CATEGORY SUB_CATEGORY NUMBER
  },
  count_lifeSafety_behavior: {
    module: 'behaviorConductLifeSafety', kind: 'value',
    slots: ['field', 'field'], // CATEGORY SUB_CATEGORY
  },
  get_lifeSafety_behavior: {
    module: 'behaviorConductLifeSafety', kind: 'value',
    slots: ['field', 'field', 'value'], // CATEGORY SUB_CATEGORY NUMBER
  },
  count_disaster_alert: {
    module: 'disasterAlert', kind: 'value',
    slots: ['field'], // CATEGORY
  },
  get_disaster_alert: {
    module: 'disasterAlert', kind: 'value',
    slots: ['field', 'value', 'field'], // CATEGORY NUMBER OPTION
  },
  check_disaster_alert: {
    module: 'disasterAlert', kind: 'boolean',
    slots: ['field'], // CATEGORY
  },
  count_disaster_guideline: {
    module: 'emergencyActionGuidelines', kind: 'value',
    slots: ['field', 'field'], // CATEGORY SUB_CATEGORY
  },
  get_disaster_guideline: {
    module: 'emergencyActionGuidelines', kind: 'value',
    slots: ['field', 'field', 'value'], // CATEGORY SUB_CATEGORY NUMBER
  },
  count_social_disaster_guideline: {
    module: 'emergencyActionGuidelines', kind: 'value',
    slots: ['field', 'field'], // CATEGORY SUB_CATEGORY
  },
  get_social_disaster_guideline: {
    module: 'emergencyActionGuidelines', kind: 'value',
    slots: ['field', 'field', 'value'], // CATEGORY SUB_CATEGORY NUMBER
  },
  count_safety_accident_guideline: {
    module: 'emergencyActionGuidelines', kind: 'value',
    slots: ['field', 'field'], // CATEGORY SUB_CATEGORY
  },
  get_safety_accident_guideline: {
    module: 'emergencyActionGuidelines', kind: 'value',
    slots: ['field', 'field', 'value'], // CATEGORY SUB_CATEGORY NUMBER
  },
  count_festival: {
    module: 'festival', kind: 'value',
    slots: ['field', 'field'], // LOCATION MONTH
  },
  get_festival_info: {
    module: 'festival', kind: 'value',
    slots: ['field', 'field', 'value', 'field'], // LOCATION MONTH NUMBER TYPE
  },
  check_city_weather: {
    module: 'weather', kind: 'boolean',
    slots: ['field', 'field', 'field', 'field'], // DATE LOCATION SUBLOCATION WEATHER
  },
  check_city_finedust: {
    module: 'weather', kind: 'boolean',
    slots: ['field', 'field', 'field'], // LOCATION SUBLOCATION FINEDUST
  },
  get_city_weather_data: {
    module: 'weather', kind: 'value',
    slots: ['field', 'field', 'field', 'field'], // DATE LOCATION SUBLOCATION TYPE
  },
  get_current_city_weather_data: {
    module: 'weather', kind: 'value',
    slots: ['field', 'field', 'field'], // LOCATION SUBLOCATION TYPE
  },
  get_today_city_temperature: {
    module: 'weather', kind: 'value',
    slots: ['field', 'field', 'field'], // LOCATION SUBLOCATION TIME
  },
  check_weather: {
    module: 'weather', kind: 'boolean',
    slots: ['field', 'field', 'field'], // DATE LOCATION WEATHER
  },
  check_finedust: {
    module: 'weather', kind: 'boolean',
    slots: ['field', 'field'], // LOCATION FINEDUST
  },
  get_weather_data: {
    module: 'weather', kind: 'value',
    slots: ['field', 'field', 'field'], // DATE LOCATION TYPE
  },
  get_current_weather_data: {
    module: 'weather', kind: 'value',
    slots: ['field', 'field'], // LOCATION TYPE
  },
  get_today_temperature: {
    module: 'weather', kind: 'value',
    slots: ['field', 'field'], // LOCATION TIME
  },
  get_cur_weather: {
    module: 'weather', kind: 'value',
    slots: ['value'], // LOCATION
  },
  get_cur_wind: {
    module: 'weather', kind: 'value',
    slots: ['value'], // LOCATION
  },
  get_cur_weather_data: {
    module: 'weather', kind: 'value',
    slots: ['value', 'field'], // LOCATION TYPE
  },
  check_cur_weather: {
    module: 'weather', kind: 'boolean',
    slots: ['value', 'field'], // LOCATION WEATHER
  },
  check_cur_finddust: {
    module: 'weather', kind: 'boolean',
    slots: ['value', 'field'], // LOCATION FINEDUST
  },
  get_day_weather: {
    module: 'weather', kind: 'value',
    slots: ['field', 'value'], // DATE LOCATION
  },
  get_day_weather_data: {
    module: 'weather', kind: 'value',
    slots: ['field', 'value', 'field'], // DATE LOCATION TYPE
  },
  check_day_weather: {
    module: 'weather', kind: 'boolean',
    slots: ['field', 'value', 'field'], // DATE LOCATION WEATHER
  },
  get_time_weather: {
    module: 'weather', kind: 'value',
    slots: ['value', 'field'], // LOCATION TIME
  },
  get_time_weather_data: {
    module: 'weather', kind: 'value',
    slots: ['value', 'field', 'field'], // LOCATION TIME TYPE
  },
  check_time_weather: {
    module: 'weather', kind: 'boolean',
    slots: ['value', 'field', 'field'], // LOCATION TIME WEATHER
  },
  // 날씨 블록의 지역 칸에 기본으로 꽂혀 있는, 시·도와 시·군·구를 고르면 지역 코드를
  // 돌려주는 값 블록 (block_entry.js).
  get_korea_area_code: {
    module: 'weather', kind: 'value',
    slots: ['field', 'field'], // STATE SUB_LOC
  },
};

/** 확장 블록 이름이면 그 정의, 아니면 null */
export function expansionBlock(name) {
  return Object.hasOwn(EXPANSION_BLOCKS, name) ? EXPANSION_BLOCKS[name] : null;
}
