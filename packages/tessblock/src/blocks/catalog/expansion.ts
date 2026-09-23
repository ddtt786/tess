/** Expansion category: entry's weather, festival, disaster and translate blocks. */
import {
  define,
  menu,
  numIn,
  textIn,
  type Arg,
  type BlockSpec,
} from "../spec.ts";
import { Order } from "../../codegen/order.ts";
import { quote } from "../../codegen/quote.ts";

const DATE: Array<[string, string]> = [
  ["오늘", "오늘"],
  ["내일", "내일"],
  ["모레", "모레"],
];

const CITY: Array<[string, string]> = [
  "서울",
  "부산",
  "대구",
  "인천",
  "광주",
  "대전",
  "울산",
  "세종",
  "경기",
  "강원",
  "충북",
  "충남",
  "전북",
  "전남",
  "경북",
  "경남",
  "제주",
].map((name) => [name, name] as [string, string]);

const AREA: Array<[string, string]> = [
  "중구",
  "종로구",
  "강남구",
  "서초구",
  "송파구",
  "영등포구",
  "마포구",
  "용산구",
  "성동구",
  "광진구",
  "동대문구",
  "성북구",
  "노원구",
  "은평구",
  "서대문구",
  "양천구",
  "강서구",
  "구로구",
  "관악구",
  "동작구",
  "강동구",
  "해운대구",
  "수성구",
].map((name) => [name, name] as [string, string]);

const TIME: Array<[string, string]> = [
  ["12시", "12"],
  ["00시", "00"],
  ["03시", "03"],
  ["06시", "06"],
  ["09시", "09"],
  ["15시", "15"],
  ["18시", "18"],
  ["21시", "21"],
];

const SKY: Array<[string, string]> = [
  ["맑음", "맑음"],
  ["구름 많음", "구름많음"],
  ["흐림", "흐림"],
  ["비", "비"],
  ["소나기", "소나기"],
  ["눈", "눈"],
];

const DUST: Array<[string, string]> = [
  ["좋음", "좋음"],
  ["보통", "보통"],
  ["나쁨", "나쁨"],
  ["매우 나쁨", "매우나쁨"],
];

const MEASURE: Array<[string, string]> = [
  ["기온", "기온"],
  ["강수량", "강수량"],
  ["습도", "습도"],
  ["풍속", "풍속"],
];

const MONTH: Array<[string, string]> = Array.from(
  { length: 12 },
  (_, index) => {
    const month = `${index + 1}월`;
    return [month, month] as [string, string];
  },
);

const FESTIVAL_FIELD: Array<[string, string]> = [
  ["축제명", "축제명"],
  ["지역", "지역"],
  ["기간", "기간"],
  ["내용", "내용"],
  ["주최", "주최"],
];

const DISASTER: Array<[string, string]> = [
  "호우",
  "태풍",
  "지진",
  "폭염",
  "한파",
  "대설",
  "강풍",
  "황사",
  "미세먼지",
].map((name) => [name, name] as [string, string]);

const ALERT_FIELD: Array<[string, string]> = [
  ["내용", "내용"],
  ["지역", "지역"],
  ["날짜", "날짜"],
];

const DISASTER_KIND: Array<[string, string]> = [
  ["자연재난", "자연재난"],
  ["사회재난", "사회재난"],
];

const STATE_CODE: Array<[string, string]> = [
  ["서울 (Seoul)", "Seoul"],
  ["부산 (Busan)", "Busan"],
  ["대구 (Daegu)", "Daegu"],
  ["인천 (Incheon)", "Incheon"],
  ["광주 (Gwangju)", "Gwangju"],
  ["대전 (Daejeon)", "Daejeon"],
  ["울산 (Ulsan)", "Ulsan"],
  ["경기 (Gyeonggi-do)", "Gyeonggi-do"],
  ["강원 (Gangwon-do)", "Gangwon-do"],
  ["제주 (Jeju-do)", "Jeju-do"],
];

const SUBLOC_CODE: Array<[string, string]> = [
  ["중구 (Jung-gu)", "Jung-gu"],
  ["종로구 (Jongno-gu)", "Jongno-gu"],
  ["강남구 (Gangnam-gu)", "Gangnam-gu"],
  ["서초구 (Seocho-gu)", "Seocho-gu"],
  ["송파구 (Songpa-gu)", "Songpa-gu"],
  ["해운대구 (Haeundae-gu)", "Haeundae-gu"],
];

const NATURAL_DISASTER_TOPIC: Array<[string, string]> = [
  "태풍",
  "홍수",
  "호우",
  "강풍",
  "대설",
  "가뭄",
  "지진",
  "황사",
  "지진해일",
  "화산폭발",
  "낙뢰",
  "폭염",
  "한파",
].map((name) => [name, name] as [string, string]);

const SOCIAL_DISASTER_TOPIC: Array<[string, string]> = [
  "화재",
  "산불",
  "붕괴",
  "폭발",
  "교통사고",
  "화생방사고",
  "환경오염사고",
  "감염병",
].map((name) => [name, name] as [string, string]);

const SOCIAL_DISASTER_DETAIL: Array<[string, string]> = [
  "건물",
  "지하철",
  "다중이용시설",
  "선박",
  "철도",
  "도로",
  "일반",
].map((name) => [name, name] as [string, string]);

const SAFETY_ACCIDENT_TOPIC: Array<[string, string]> = [
  "등산",
  "물놀이",
  "소방안전",
  "승강기",
  "전기안전",
  "가스안전",
  "어린이놀이시설",
].map((name) => [name, name] as [string, string]);

const SAFETY_ACCIDENT_DETAIL: Array<[string, string]> = [
  "조난",
  "실족",
  "익수",
  "안전사고",
  "화재대피",
  "일반",
].map((name) => [name, name] as [string, string]);

const DISASTER_BEHAVIOR_TOPIC: Array<[string, string]> = [
  "지진",
  "태풍",
  "호우",
  "대설",
  "황사",
  "화재",
  "산불",
].map((name) => [name, name] as [string, string]);

const DISASTER_BEHAVIOR_DETAIL: Array<[string, string]> = [
  "실내",
  "실외",
  "대피소",
  "차량",
  "엘리베이터",
  "일반",
].map((name) => [name, name] as [string, string]);

const LIFE_SAFETY_TOPIC: Array<[string, string]> = [
  "응급처치",
  "소방안전",
  "자연재난",
  "사회재난",
  "생활안전",
].map((name) => [name, name] as [string, string]);

const LIFE_SAFETY_DETAIL: Array<[string, string]> = [
  "심폐소생술",
  "기도폐쇄",
  "화상",
  "골절",
  "지혈",
  "일반",
].map((name) => [name, name] as [string, string]);

const LANGUAGE: Array<[string, string]> = [
  ["한국어", "한국어"],
  ["영어", "영어"],
  ["일본어", "일본어"],
  ["중국어 간체", "중국어 간체"],
  ["스페인어", "스페인어"],
  ["프랑스어", "프랑스어"],
  ["독일어", "독일어"],
  ["러시아어", "러시아어"],
];

/** Same languages, with the usual target first. */
const TARGET_LANGUAGE: Array<[string, string]> = [
  LANGUAGE[1]!,
  ...LANGUAGE.filter((entry) => entry !== LANGUAGE[1]),
];

/**
 * One expansion call. Field slots are written as text in the source, value
 * slots take a whole expression, which is what the compiler expects.
 */
function call(
  type: string,
  message: string,
  args: Arg[],
  shape: "value" | "boolean" = "value",
): BlockSpec {
  return {
    type: `ext_${type}`,
    category: "expansion",
    message,
    args,
    shape,
    order: Order.ATOMIC,
    code: (a) => {
      const slots = args.map((arg) =>
        arg.type === "value" ? a[arg.name]! : quote(a[arg.name]!),
      );
      return [`${type}(${slots.join(", ")})`, Order.ATOMIC];
    },
  };
}

define(
  // Weather by province.
  call(
    "check_weather",
    "%1 %2 의 날씨가 %3 인가?",
    [menu("DATE", DATE), menu("CITY", CITY), menu("SKY", SKY)],
    "boolean",
  ),
  call("get_weather_data", "%1 %2 의 %3", [
    menu("DATE", DATE),
    menu("CITY", CITY),
    menu("KIND", MEASURE),
  ]),
  call("get_current_weather_data", "현재 %1 의 %2", [
    menu("CITY", CITY),
    menu("KIND", MEASURE),
  ]),
  call("get_today_temperature", "오늘 %1 %2 시의 기온", [
    menu("CITY", CITY),
    menu("TIME", TIME),
  ]),
  call(
    "check_finedust",
    "%1 의 미세먼지가 %2 인가?",
    [menu("CITY", CITY), menu("DUST", DUST)],
    "boolean",
  ),

  // Weather down to the district.
  call(
    "check_city_weather",
    "%1 %2 %3 의 날씨가 %4 인가?",
    [
      menu("DATE", DATE),
      menu("CITY", CITY),
      menu("AREA", AREA),
      menu("SKY", SKY),
    ],
    "boolean",
  ),
  call(
    "check_city_finedust",
    "%1 %2 의 미세먼지가 %3 인가?",
    [menu("CITY", CITY), menu("AREA", AREA), menu("DUST", DUST)],
    "boolean",
  ),
  call("get_city_weather_data", "%1 %2 %3 의 %4", [
    menu("DATE", DATE),
    menu("CITY", CITY),
    menu("AREA", AREA),
    menu("KIND", MEASURE),
  ]),
  call("get_current_city_weather_data", "현재 %1 %2 의 %3", [
    menu("CITY", CITY),
    menu("AREA", AREA),
    menu("KIND", MEASURE),
  ]),
  call("get_today_city_temperature", "오늘 %1 %2 %3 시의 기온", [
    menu("CITY", CITY),
    menu("AREA", AREA),
    menu("TIME", TIME),
  ]),
  // Entry keeps this block's dropdowns on the weather service's romanised names.
  call("get_korea_area_code", "%1 %2 의 지역 코드", [
    menu("STATE", STATE_CODE),
    menu("SUBLOC", SUBLOC_CODE),
  ]),

  // Weather blocks that take an area code in a value slot.
  call("get_cur_weather", "%1 의 지금 날씨", [textIn("AREA", "")]),
  call("get_cur_wind", "%1 의 지금 바람", [textIn("AREA", "")]),
  call("get_cur_weather_data", "%1 의 지금 %2", [
    textIn("AREA", ""),
    menu("KIND", MEASURE),
  ]),
  call(
    "check_cur_weather",
    "%1 의 지금 날씨가 %2 인가?",
    [textIn("AREA", ""), menu("SKY", SKY)],
    "boolean",
  ),
  call(
    "check_cur_finddust",
    "%1 의 지금 미세먼지가 %2 인가?",
    [textIn("AREA", ""), menu("DUST", DUST)],
    "boolean",
  ),
  call("get_day_weather", "%1 %2 의 날씨", [
    menu("DATE", DATE),
    textIn("AREA", ""),
  ]),
  call("get_day_weather_data", "%1 %2 의 %3", [
    menu("DATE", DATE),
    textIn("AREA", ""),
    menu("KIND", MEASURE),
  ]),
  call(
    "check_day_weather",
    "%1 %2 의 날씨가 %3 인가?",
    [menu("DATE", DATE), textIn("AREA", ""), menu("SKY", SKY)],
    "boolean",
  ),
  call("get_time_weather", "%1 의 %2 시 날씨", [
    textIn("AREA", ""),
    menu("TIME", TIME),
  ]),
  call("get_time_weather_data", "%1 의 %2 시 %3", [
    textIn("AREA", ""),
    menu("TIME", TIME),
    menu("KIND", MEASURE),
  ]),
  call(
    "check_time_weather",
    "%1 의 %2 시 날씨가 %3 인가?",
    [textIn("AREA", ""), menu("TIME", TIME), menu("SKY", SKY)],
    "boolean",
  ),

  // Festivals.
  call("count_festival", "%1 의 %2 축제 수", [
    menu("CITY", CITY),
    menu("MONTH", MONTH),
  ]),
  call("get_festival_info", "%1 의 %2 축제 %3 번째의 %4", [
    menu("CITY", CITY),
    menu("MONTH", MONTH),
    numIn("INDEX", 1),
    menu("FIELD", FESTIVAL_FIELD),
  ]),

  // Disaster alerts.
  call("count_disaster_alert", "%1 재난문자 수", [menu("KIND", DISASTER)]),
  call("get_disaster_alert", "%1 재난문자 %2 번째의 %3", [
    menu("KIND", DISASTER),
    numIn("INDEX", 1),
    menu("FIELD", ALERT_FIELD),
  ]),
  call(
    "check_disaster_alert",
    "%1 재난문자가 있는가?",
    [menu("KIND", DISASTER)],
    "boolean",
  ),

  // Safety guidelines.
  call("count_disaster_guideline", "%1 %2 국민행동요령 수", [
    menu("KIND", DISASTER_KIND),
    menu("TOPIC", NATURAL_DISASTER_TOPIC),
  ]),
  call("get_disaster_guideline", "%1 %2 국민행동요령 %3 번째", [
    menu("KIND", DISASTER_KIND),
    menu("TOPIC", NATURAL_DISASTER_TOPIC),
    numIn("INDEX", 1),
  ]),
  call("count_social_disaster_guideline", "사회재난 %1 %2 행동요령 수", [
    menu("TOPIC", SOCIAL_DISASTER_TOPIC),
    menu("DETAIL", SOCIAL_DISASTER_DETAIL),
  ]),
  call("get_social_disaster_guideline", "사회재난 %1 %2 행동요령 %3 번째", [
    menu("TOPIC", SOCIAL_DISASTER_TOPIC),
    menu("DETAIL", SOCIAL_DISASTER_DETAIL),
    numIn("INDEX", 1),
  ]),
  call("count_safety_accident_guideline", "생활안전 %1 %2 행동요령 수", [
    menu("TOPIC", SAFETY_ACCIDENT_TOPIC),
    menu("DETAIL", SAFETY_ACCIDENT_DETAIL),
  ]),
  call("get_safety_accident_guideline", "생활안전 %1 %2 행동요령 %3 번째", [
    menu("TOPIC", SAFETY_ACCIDENT_TOPIC),
    menu("DETAIL", SAFETY_ACCIDENT_DETAIL),
    numIn("INDEX", 1),
  ]),
  call("count_disaster_behavior", "재난 행동요령 %1 %2 수", [
    menu("TOPIC", DISASTER_BEHAVIOR_TOPIC),
    menu("DETAIL", DISASTER_BEHAVIOR_DETAIL),
  ]),
  call("get_disaster_behavior", "재난 행동요령 %1 %2 %3 번째", [
    menu("TOPIC", DISASTER_BEHAVIOR_TOPIC),
    menu("DETAIL", DISASTER_BEHAVIOR_DETAIL),
    numIn("INDEX", 1),
  ]),
  call("count_lifeSafety_behavior", "생활안전 행동요령 %1 %2 수", [
    menu("TOPIC", LIFE_SAFETY_TOPIC),
    menu("DETAIL", LIFE_SAFETY_DETAIL),
  ]),
  call("get_lifeSafety_behavior", "생활안전 행동요령 %1 %2 %3 번째", [
    menu("TOPIC", LIFE_SAFETY_TOPIC),
    menu("DETAIL", LIFE_SAFETY_DETAIL),
    numIn("INDEX", 1),
  ]),

  // Translation.
  call("get_translated_string", "%1 %2 를 %3 로 번역하기", [
    menu("FROM", LANGUAGE),
    textIn("TEXT", "안녕"),
    menu("TO", TARGET_LANGUAGE),
  ]),
  call("check_language", "%1 의 언어", [textIn("TEXT", "안녕")]),
);
