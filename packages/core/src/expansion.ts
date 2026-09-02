/**
 * @fileoverview 엔트리 확장 카테고리 블록(날씨, 축제, 재난문자, 국민행동요령 등)의 정의를 제공합니다.
 * 
 * 확장 블록들은 대부분 값 또는 판단 블록의 형태를 가지며, 필드(드롭다운)와 값 슬롯의 조합으로 이루어집니다.
 * 이 구조를 통해 각 블록의 컴파일과 역컴파일을 한 번에 처리할 수 있도록 돕습니다.
 * 식별자 이름은 엔트리 플랫폼 문서와의 일관성을 위해 원본 블록 타입을 유지합니다.
 */

/**
 * 단일 확장 블록에 대한 메타데이터 정의입니다.
 * 어떤 엔트리 모듈에 속하는지, 그리고 슬롯 배열을 지정합니다.
 */
export interface ExpansionBlock {
  /** 
   * 엔트리가 이 블록을 초기화할 때 참조하는 모듈 이름 (예: 'weather', 'festival')
   */
  module: string;
  /** 
   * 블록의 종류. 'value'는 값 블록, 'boolean'은 판단 블록을 나타냅니다.
   */
  kind: string;
  /** 
   * 순서대로 슬롯의 유형을 정의합니다. 
   * 'field'는 텍스트(드롭다운) 값, 'value'는 표현식(식)이 들어가는 자리입니다.
   */
  slots: string[];
}

/**
 * 모든 확장 블록에 대한 정의를 모아둔 객체입니다.
 */
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
  // 날씨 블록의 지역 선택 슬롯에서 시/도, 시/군/구를 선택하면
  // 해당하는 지역 코드를 반환하는 값 블록의 정의입니다.
  get_korea_area_code: {
    module: 'weather', kind: 'value',
    slots: ['field', 'field'], // STATE SUB_LOC
  },
};

/**
 * 주어진 이름이 확장 블록 식별자인 경우 해당 정의를 반환합니다.
 *
 * @param name - 확인할 블록의 식별자 이름
 * @returns 확장 블록의 메타데이터 정의, 매칭되지 않으면 null
 *
 * @example
 * expansionBlock("get_weather_data"); // { module: 'weather', kind: 'value', slots: ['field', 'field', 'field'] }
 * expansionBlock("unknown_block"); // null
 */
export function expansionBlock(name: string): ExpansionBlock | null {
  return Object.hasOwn(EXPANSION_BLOCKS, name)
    ? (EXPANSION_BLOCKS as Record<string, ExpansionBlock>)[name]!
    : null;
}
