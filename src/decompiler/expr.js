// ============================================================================
//  엔트리 값(value)/판단(boolean) 블록 -> Tess 표현식 문자열
//
//  src/compiler/expression.js 가 Tess 표현식을 엔트리 블록으로 바꾸는 정확한
//  대응표를 그대로 뒤집어서 쓴다. 모르는 블록은 죽지 않고 `??("타입", ...)`
//  형태의 자리표시자를 남기고 ctx.warnings 에 기록한다.
// ============================================================================
import { KEY_CODES } from '../compiler/keycodes.js';
import { tessNumber, tessString } from './ident.js';

const REVERSE_COMPARE = {
  EQUAL: '==', NOT_EQUAL: '!=', GREATER: '>', LESS: '<', GREATER_OR_EQUAL: '>=', LESS_OR_EQUAL: '<=',
};
const REVERSE_ARITHMETIC = { PLUS: '+', MINUS: '-', MULTI: '*', DIVIDE: '/' };
const REVERSE_MATH = {
  sin: 'sin', cos: 'cos', tan: 'tan', asin_radian: 'asin', acos_radian: 'acos', atan_radian: 'atan',
  ln: 'ln', log: 'log10', floor: 'floor', ceil: 'ceil', round: 'round', abs: 'abs',
};
// coordinate_object 의 COORDINATE 드롭다운은 x/y/방향/이동방향/크기 말고도
// "모양 번호"(picture_index)·"모양 이름"(picture_name) 을 갖고 있다(entryjs
// block_calc.js) — 이 둘이 빠져 있으면 그 값을 쓴 블록이 통째로 옮겨지지 못하고
// `??("coordinate_object", ...)` 자리표시자로 남는다(예전 버그).
const REVERSE_PROPERTY_COORD = {
  x: 'x', y: 'y', rotation: 'angle', direction: 'way', size: 'size',
  picture_name: 'costume', picture_index: 'costume_number',
};
const REVERSE_OBJECT_COORD = { x: 'x', y: 'y', rotation: 'angle', direction: 'way', size: 'size' };
const REVERSE_DATE_UNITS = {
  YEAR: 'year', MONTH: 'month', DAY: 'day', HOUR: 'hour', MINUTE: 'minute', SECOND: 'second', DAY_OF_WEEK: 'weekday',
};
const REVERSE_HEX_CHANNEL = { r: 'red', g: 'green', b: 'blue' };
const REVERSE_STATE = {
  is_clicked: 'mouse_down', is_object_clicked: 'clicked', is_boost_mode: 'boost_mode',
  is_touch_supported: 'touchable', get_user_name: 'user_id', get_nickname: 'nickname',
  get_project_timer_value: 'timer', get_canvas_input_value: 'answer',
};

const REVERSE_KEY_CODE = {};
for (const [name, code] of Object.entries(KEY_CODES)) {
  if (!(String(code) in REVERSE_KEY_CODE)) REVERSE_KEY_CODE[String(code)] = name;
}

/** 값 블록이 없을 때(빈 슬롯) 쓰는 기본값 */
const EMPTY = '0';

function targetName(ctx, raw) {
  if (raw === 'self' || raw === 'mouse') return raw;
  if (typeof raw === 'string' && raw.startsWith('wall')) return raw;
  const object = ctx.objectsById.get(raw);
  return object ? object.identifier : raw;
}

/** 리스트/문자열 인덱스: 엔트리(1부터) -> Tess(0부터) */
function unshiftIndex(block, ctx, delta = 1) {
  if (block && block.type === 'number' && !Number.isNaN(Number(block.params?.[0]))) {
    return tessNumber(Number(block.params[0]) - delta);
  }
  const inner = exprOf(block, ctx);
  return delta === 0 ? inner : `(${inner} - ${delta})`;
}

/**
 * 편집기 목록에서 고른 모양·소리(get_pictures/get_sounds)를 옮긴다.
 *
 * 평소에는 그 이름으로 옮기지만, 함수 안에서는 이름 대신 id 를 그대로 남긴다.
 * 엔트리에서 함수는 전역이라 어느 오브젝트가 부를지 알 수 없는데, 모양·소리 이름은
 * 오브젝트마다 다르기 때문이다. 그 id 를 가진 모양·소리 선언에는 `force id` 가
 * 붙으므로 다시 컴파일해도 같은 id 가 나온다
 * (src/decompiler/index.js 의 buildContext 주석 참고).
 */
function resourceRef(ctx, id, byId, nameOf) {
  if (ctx.inFunction && byId.has(id)) return tessString(id);
  return tessString(nameOf(id));
}

function placeholder(ctx, block) {
  const type = block?.type ?? '(빈 슬롯)';
  ctx.warnings.add(`값 블록 '${type}' 은(는) 아직 옮길 수 없습니다.`);
  return `"[decompile: ${type}]"`;
}

/** 값 또는 판단 블록 하나를 Tess 표현식 문자열로 */
export function exprOf(block, ctx) {
  if (block === null || block === undefined) return EMPTY;
  if (typeof block === 'string') return tessString(block);
  if (typeof block === 'number') return tessNumber(block);
  if (typeof block !== 'object' || !block.type) return EMPTY;

  const p = block.params ?? [];
  const at = (i) => p[i];

  switch (block.type) {
    case 'number': {
      const raw = at(0);
      const n = Number(raw);
      return Number.isNaN(n) ? tessString(String(raw)) : tessNumber(n);
    }
    case 'angle': return tessNumber(Number(at(0)) || 0);
    case 'text': {
      const raw = String(at(0) ?? '');
      if (raw === 'true' || raw === 'false') return raw;
      if (raw === 'transparent') return 'transparent';
      if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw;
      return tessString(raw);
    }

    case 'get_variable': return ctx.varName(at(0));
    case 'get_func_variable': return ctx.funcLocalName(at(0));

    case 'coordinate_object': {
      const target = at(1);
      const coordinate = REVERSE_PROPERTY_COORD[at(3)] ?? REVERSE_OBJECT_COORD[at(3)];
      if (!coordinate) return placeholder(ctx, block);
      if (target === 'self' || target === null) return coordinate;
      return `${coordinate}(${tessString(targetName(ctx, target))})`;
    }
    case 'coordinate_mouse': {
      const coordinate = REVERSE_OBJECT_COORD[at(1)];
      return coordinate ? `${coordinate}(${tessString('mouse')})` : placeholder(ctx, block);
    }

    case 'calc_basic': {
      const op = REVERSE_ARITHMETIC[at(1)];
      if (!op) return placeholder(ctx, block);
      return `(${exprOf(at(0), ctx)} ${op} ${exprOf(at(2), ctx)})`;
    }
    case 'quotient_and_mod': {
      const op = at(5) === 'MOD' ? '%' : '//';
      return `(${exprOf(at(1), ctx)} ${op} ${exprOf(at(3), ctx)})`;
    }
    case 'calc_rand': return `random(${exprOf(at(1), ctx)}, ${exprOf(at(3), ctx)})`;
    case 'calc_operation': {
      const op = at(3);
      if (op === 'square') return `(${exprOf(at(1), ctx)} ** 2)`;
      if (op === 'root') return `(${exprOf(at(1), ctx)} ** 0.5)`;
      const fn = REVERSE_MATH[op];
      return fn ? `${fn}(${exprOf(at(1), ctx)})` : placeholder(ctx, block);
    }

    case 'boolean_basic_operator': {
      const op = REVERSE_COMPARE[at(1)];
      if (!op) return placeholder(ctx, block);
      return `(${exprOf(at(0), ctx)} ${op} ${exprOf(at(2), ctx)})`;
    }
    case 'boolean_and_or': return `(${exprOf(at(0), ctx)} ${at(1) === 'AND' ? 'and' : 'or'} ${exprOf(at(2), ctx)})`;
    case 'boolean_not': return `not (${exprOf(at(1), ctx)})`;
    case 'True': return 'true';
    case 'False': return 'false';
    // `(<판단>의 값)` 은 판단을 값 자리에 넣으려고 엔트리가 씌우는 블록이며
    // "TRUE"/"FALSE" 를 돌려준다. Tess 에서는 판단을 값 자리에 그냥 쓰면 컴파일러가
    // 다시 씌워 주므로(compileValue 참고), 껍데기를 벗기고 안쪽만 옮긴다.
    case 'get_boolean_value': return exprOf(at(0), ctx);
    case 'is_clicked': case 'is_object_clicked': case 'is_boost_mode':
    case 'is_touch_supported': case 'get_user_name': case 'get_nickname':
    case 'get_project_timer_value': case 'get_canvas_input_value':
      return REVERSE_STATE[block.type];
    case 'get_sound_volume': return 'sound_volume';
    case 'get_block_count': {
      const target = at(0);
      if (!target || target === 'all') return 'block_count';
      return `block_count(${tessString(targetName(ctx, target))})`;
    }
    case 'is_press_some_key': {
      const key = REVERSE_KEY_CODE[String(at(0))];
      return key ? `key_down(${tessString(key)})` : placeholder(ctx, block);
    }
    case 'reach_something': return `touching(${tessString(targetName(ctx, at(1)))})`;
    case 'distance_something': return `distance(${tessString(targetName(ctx, at(1)))})`;
    case 'is_current_device_type': return `(device == ${tessString(at(0))})`;
    case 'is_type': {
      const kind = at(2) === 'number' ? 'number' : 'string';
      return `(type(${exprOf(at(0), ctx)}) == ${tessString(kind)})`;
    }

    case 'value_of_index_from_list': {
      const list = ctx.varName(at(1));
      return `${list}[${unshiftIndex(at(3), ctx)}]`;
    }
    case 'char_at': return `slice(${exprOf(at(1), ctx)}, ${unshiftIndex(at(3), ctx)}, ${unshiftIndex(at(3), ctx, 0)})`;
    case 'length_of_list': return `length(${ctx.varName(at(1))})`;
    case 'length_of_string': return `length(${exprOf(at(1), ctx)})`;
    case 'is_included_in_list': return `contains(${ctx.varName(at(1))}, ${exprOf(at(3), ctx)})`;
    case 'combine_something': return `join(${exprOf(at(1), ctx)}, ${exprOf(at(3), ctx)})`;
    case 'substring': {
      const start = unshiftIndex(at(3), ctx);
      const end = exprOf(at(5), ctx);
      return `slice(${exprOf(at(1), ctx)}, ${start}, ${end})`;
    }
    case 'count_match_string': return `count(${exprOf(at(0), ctx)}, ${exprOf(at(2), ctx)})`;
    case 'index_of_string': return `(index_of(${exprOf(at(1), ctx)}, ${exprOf(at(3), ctx)}) + 1)`;
    case 'replace_string': return `replace(${exprOf(at(1), ctx)}, ${exprOf(at(3), ctx)}, ${exprOf(at(5), ctx)})`;
    case 'reverse_of_string': return `reverse(${exprOf(at(1), ctx)})`;
    case 'change_string_case': return `${at(3) === 'toUpperCase' ? 'uppercase' : 'lowercase'}(${exprOf(at(1), ctx)})`;
    case 'get_date': {
      const unit = REVERSE_DATE_UNITS[at(1)];
      return unit ? `now(${tessString(unit)})` : placeholder(ctx, block);
    }
    case 'change_rgb_to_hex': return `to_hex(${exprOf(at(0), ctx)}, ${exprOf(at(1), ctx)}, ${exprOf(at(2), ctx)})`;
    case 'change_hex_to_rgb': {
      const channel = REVERSE_HEX_CHANNEL[at(1)];
      return channel ? `from_hex(${exprOf(at(0), ctx)}, ${channel})` : placeholder(ctx, block);
    }
    case 'text_read': return `text_content(${tessString(targetName(ctx, at(0)))})`;

    case 'get_pictures': return resourceRef(ctx, at(0), ctx.picturesById, ctx.pictureName);
    case 'get_sounds': return resourceRef(ctx, at(0), ctx.soundsById, ctx.soundName);

    // 사용자 정의 함수 호출(값을 돌려주는 것) — func_<함수id>
    default: {
      // 함수 본문에서 매개변수를 가리키는 블록 — stringParam_xxxx / booleanParam_xxxx
      const paramName = ctx.funcParamName?.(block.type);
      if (paramName) return paramName;

      if (block.type.startsWith('func_')) {
        const fn = ctx.functionsById.get(block.type.slice('func_'.length));
        if (fn) {
          const args = p.filter((_, i) => i < fn.params.length).map((param) => exprOf(param, ctx));
          return `${fn.name}(${args.join(', ')})`;
        }
      }
      return placeholder(ctx, block);
    }
  }
}
