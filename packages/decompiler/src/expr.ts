/**
 * 엔트리 값(value) 및 판단(boolean) 블록을 Tess 표현식 문자열로 변환하는 기능을 제공합니다.
 * 알려지지 않은 블록은 자리표시자를 남기고 경고에 기록합니다.
 */
import { KEY_CODES } from '@tess/core';
import { tessNumber, tessString, ownsResource, isExactNumber } from './ident.ts';
import { expansionBlock } from '@tess/core';
import type { DecompileContext, RawBlock, ResourceInfo } from './types.ts';

const REVERSE_COMPARE: Record<string, string> = {
  EQUAL: '==', NOT_EQUAL: '!=', GREATER: '>', LESS: '<', GREATER_OR_EQUAL: '>=', LESS_OR_EQUAL: '<=',
};
const REVERSE_ARITHMETIC: Record<string, string> = { PLUS: '+', MINUS: '-', MULTI: '*', DIVIDE: '/' };
const TABLE_CALCULATION_NAMES: Record<string, string> = {
  SUM: 'sum', AVG: 'average', MAX: 'maximum', MIN: 'minimum',
  STDEV: 'stdev', MEDIAN: 'median',
};
const REVERSE_MATH: Record<string, string> = {
  sin: 'sin', cos: 'cos', tan: 'tan', asin_radian: 'asin', acos_radian: 'acos', atan_radian: 'atan',
  ln: 'ln', log: 'log10', floor: 'floor', ceil: 'ceil', round: 'round', abs: 'abs',
  // Entry offers `asin` next to `asin_radian`, but its calc_operation strips
  // everything after the first `_` before switching, so both run the same
  // `toDegrees(Math.asin(x))`. They therefore map to the same Tess function
  // rather than to a placeholder.
  asin: 'asin', acos: 'acos', atan: 'atan',
};
/**
 * 좌표 객체의 속성을 Tess 속성 이름으로 매핑합니다.
 * x, y, 방향, 크기 외에도 모양 번호와 모양 이름 등을 처리합니다.
 * 
 * @example
 * REVERSE_PROPERTY_COORD['picture_name']; // "costume"
 */
const REVERSE_PROPERTY_COORD: Record<string, string> = {
  x: 'x', y: 'y', rotation: 'angle', direction: 'way', size: 'size',
  picture_name: 'costume', picture_index: 'costume_number',
};
const REVERSE_OBJECT_COORD: Record<string, string> = { x: 'x', y: 'y', rotation: 'angle', direction: 'way', size: 'size' };
const REVERSE_DATE_UNITS: Record<string, string> = {
  YEAR: 'year', MONTH: 'month', DAY: 'day', HOUR: 'hour', MINUTE: 'minute', SECOND: 'second', DAY_OF_WEEK: 'weekday',
};
const REVERSE_HEX_CHANNEL: Record<string, string> = { r: 'red', g: 'green', b: 'blue' };
const REVERSE_STATE: Record<string, string> = {
  is_clicked: 'mouse_down', is_object_clicked: 'clicked', is_boost_mode: 'boost_mode',
  is_touch_supported: 'touchable', get_user_name: 'user_id', get_nickname: 'nickname',
  get_project_timer_value: 'timer', get_canvas_input_value: 'answer',
};

const REVERSE_KEY_CODE: Record<string, string> = {};
for (const [name, code] of Object.entries(KEY_CODES)) {
  if (!(String(code) in REVERSE_KEY_CODE)) REVERSE_KEY_CODE[String(code)] = name;
}

/**
 * 값 블록이 없을 때(빈 슬롯) 사용하는 기본값입니다.
 * 
 * @example
 * const defaultVal = EMPTY; // "0"
 */
const EMPTY = '0';

/**
 * 주어진 문자열이 `#RRGGBB` 형태의 색상 리터럴이면 그대로 반환하고, 그 외의 경우 Tess 문자열로 변환합니다.
 * 
 * @param raw - 변환할 원본 문자열입니다.
 * @returns 변환된 색상 리터럴 또는 Tess 문자열입니다.
 * 
 * @example
 * colorLiteral("#FF0000"); // "#FF0000"
 * colorLiteral("transparent"); // "transparent"
 * colorLiteral("blue"); // "\"blue\""
 */
export function colorLiteral(raw: string): string {
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw;
  if (raw === 'transparent') return 'transparent';
  return tessString(raw);
}

function targetName(ctx: DecompileContext, raw: unknown): string {
  if (raw === 'self' || raw === 'mouse') return raw;
  if (typeof raw === 'string' && raw.startsWith('wall')) return raw;
  const object = ctx.objectsById.get(raw as string);
  if (object) return object.identifier;
  // 원본에서 지워진 오브젝트를 가리키는 블록이다(엔트리는 그런 블록을 그냥 두고
  // 실행할 때 거짓으로 친다). 이름을 만들 수 없으니 아이디를 그대로 남기고, 되돌린
  // 소스가 왜 그 자리에서 컴파일 에러를 내는지 알 수 있게 알린다.
  ctx.warnings.add(
    `'${String(raw)}' 을(를) 가리키는 블록이 있지만 그 오브젝트가 작품에 없습니다 — 아이디를 그대로 남겼습니다.`,
  );
  return String(raw);
}

/**
 * 편집기 목록에서 선택한 모양이나 소리 자원을 참조합니다.
 * 전역 함수 내부에서는 객체를 특정할 수 없으므로 이름 대신 ID를 남깁니다.
 * 
 * @param ctx - 디컴파일 컨텍스트입니다.
 * @param id - 자원의 ID입니다.
 * @param byId - ID로 자원 정보를 찾는 맵입니다.
 * @param nameOf - ID로 자원의 이름을 가져오는 함수입니다.
 * @returns 자원 참조를 나타내는 Tess 표현식 문자열입니다.
 * 
 * @example
 * resourceRef(ctx, "sound_1", soundsById, soundName);
 */
function resourceRef(
  ctx: DecompileContext,
  id: string,
  byId: Map<string, ResourceInfo>,
  nameOf: (id: string) => string,
): string {
  if (ctx.inFunction && byId.has(id) && !ownsResource(ctx, byId.get(id))) return tessString(id);
  return tessString(nameOf(id));
}

const BARE_NAME = /^[\p{L}_][\p{L}\p{N}_]*$/u;

/**
 * Whether `${text}[i]` reads the i-th character of `text`. It must be a single
 * name, and not a list or table name — on those, `[i]` reads an item or a cell
 * instead (compiler/expression.ts resolveList).
 */
function indexableName(text: string, ctx: DecompileContext): boolean {
  if (!BARE_NAME.test(text)) return false;
  for (const info of ctx.varsById.values()) if (info.isList && info.identifier === text) return false;
  for (const info of ctx.tablesById.values()) if (info.identifier === text) return false;
  return true;
}

function placeholder(ctx: DecompileContext, block: RawBlock | undefined): string {
  const type = block?.type ?? '(빈 슬롯)';
  ctx.warnings.add(`값 블록 '${type}' 은(는) 아직 옮길 수 없습니다.`);
  return `"[decompile: ${type}]"`;
}

/**
 * 단일 값 또는 판단 블록을 Tess 표현식 문자열로 변환합니다.
 * 
 * @param block - 변환할 엔트리 블록 객체입니다.
 * @param ctx - 디컴파일 컨텍스트입니다.
 * @returns 변환된 Tess 표현식 문자열입니다.
 * 
 * @example
 * const expr = exprOf({ type: 'number', params: [42] }, ctx);
 * console.log(expr); // "42"
 */
export function exprOf(block: any, ctx: DecompileContext): string {
  if (block === null || block === undefined) return EMPTY;
  if (typeof block === 'string') return tessString(block);
  if (typeof block === 'number') return tessNumber(block);
  if (typeof block !== 'object' || !block.type) return EMPTY;

  const p = block.params ?? [];
  const at = (i: number) => p[i];

  switch (block.type) {
    /**
     * 숫자와 텍스트 블록은 모두 입력된 문자열을 반환합니다.
     * 숫자로 해석 가능한 리터럴은 숫자로 변환하고, 문자열 형태가 유지되어야 하는 값(예: "01")은 문자열로 변환합니다.
     */
    case 'number': case 'text': {
      const raw = String(at(0) ?? '');
      if (raw === 'true' || raw === 'false') return raw;
      if (raw === 'transparent') return 'transparent';
      if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw;
      return isExactNumber(raw) ? raw : tessString(raw);
    }
    case 'angle': return tessNumber(Number(at(0)) || 0);

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
      // Entry's fractional-part operator (`소수 부분`) subtracts with BigNumber:
      // `BigNumber(x).minus(floor(x))`, so 49.1 gives exactly 0.1. `%` is not the
      // same thing — entryjs runs MOD as plain `l - r * floor(l / r)` in binary
      // floating point, which gives 0.09999999999999787 instead, and a work that
      // reads the decimal digits off that string (deltarune does) then computes
      // something else entirely. `-` is the block that subtracts decimally, so
      // the fraction is written out with it. `abs` covers the negative side:
      // entry's operator answers the fraction of |x| there too.
      if (op === 'unnatural') {
        const value = `abs(${exprOf(at(1), ctx)})`;
        return `(${value} - floor(${value}))`;
      }
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
    /**
     * 판단 블록을 값으로 사용할 때 감싸는 블록입니다.
     * Tess에서는 값 위치에 판단식을 그대로 사용할 수 있으므로 내부 표현식만 변환합니다.
     */
    case 'get_boolean_value': return exprOf(at(0), ctx);
    case 'is_clicked': case 'is_object_clicked': case 'is_boost_mode':
    case 'is_touch_supported': case 'get_user_name': case 'get_nickname':
    case 'get_project_timer_value': case 'get_canvas_input_value':
      return REVERSE_STATE[block.type];
    case 'get_sound_volume': return 'sound_volume';
    case 'get_sound_speed': return 'sound_speed';
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
      return `${list}[${exprOf(at(3), ctx)}]`;
    }
    case 'char_at': {
      const index = exprOf(at(3), ctx);
      const target = exprOf(at(1), ctx);
      // `이름[i]` is the only Tess form that compiles back to char_at, and it
      // takes a bare name (parser.js indexExpr). Everything else has to go
      // through slice, which evaluates the index twice — a different value
      // every time when the index is random or an answer.
      if (indexableName(target, ctx)) return `${target}[${index}]`;
      const literalIndex = at(3) === null || at(3) === undefined
        || ['number', 'text'].includes((at(3) as RawBlock | undefined)?.type ?? '');
      if (!literalIndex) {
        ctx.warnings.add(
          `'${target}' 의 글자 하나를 읽는 자리는 slice 로 옮겼습니다 — 자리 번호가 두 번 계산되니, `
          + '그 안에 무작위 수처럼 부를 때마다 달라지는 값이 있으면 결과가 달라집니다.',
        );
      }
      return `slice(${target}, ${index}, ${index})`;
    }
    case 'length_of_list': return `length(${ctx.varName(at(1))})`;
    case 'length_of_string': return `length(${exprOf(at(1), ctx)})`;
    case 'is_included_in_list': return `contains(${ctx.varName(at(1))}, ${exprOf(at(3), ctx)})`;
    case 'combine_something': return `join(${exprOf(at(1), ctx)}, ${exprOf(at(3), ctx)})`;
    case 'substring': return `slice(${exprOf(at(1), ctx)}, ${exprOf(at(3), ctx)}, ${exprOf(at(5), ctx)})`;
    case 'count_match_string': return `count(${exprOf(at(0), ctx)}, ${exprOf(at(2), ctx)})`;
    case 'index_of_string': return `index_of(${exprOf(at(1), ctx)}, ${exprOf(at(3), ctx)})`;
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

    // --- 테이블 --------------------------------------------------------------
    case 'get_table_count':
      return `${String(at(1)) === 'COL' ? 'column_count' : 'row_count'}(${ctx.tableName(at(0))})`;
    case 'get_value_from_table':
      return `${ctx.tableName(at(0))}[${exprOf(at(1), ctx)}, ${exprOf(at(2), ctx)}]`;
    case 'get_value_from_cell':
      return `${ctx.tableName(at(0))}[${exprOf(at(1), ctx)}]`;
    case 'get_value_from_last_row':
      return `last_row(${ctx.tableName(at(0))}, ${exprOf(at(1), ctx)})`;
    case 'calc_values_from_table': {
      const calc = TABLE_CALCULATION_NAMES[String(at(2))];
      if (!calc) return placeholder(ctx, block);
      return `${calc}(${ctx.tableName(at(0))}, ${exprOf(at(1), ctx)})`;
    }
    case 'get_coefficient':
      return `correlation(${ctx.tableName(at(0))}, ${exprOf(at(1), ctx)}, ${exprOf(at(2), ctx)})`;
    case 'get_value_v_lookup':
      return `lookup(${ctx.tableName(at(0))}, ${exprOf(at(1), ctx)}, `
        + `${exprOf(at(2), ctx)}, ${exprOf(at(3), ctx)})`;

    case 'get_pictures': return resourceRef(ctx, at(0), ctx.picturesById, ctx.pictureName);
    case 'get_sounds': return resourceRef(ctx, at(0), ctx.soundsById, ctx.soundName);
    /** 소리 길이 블록은 드롭다운 필드에서 소리 ID를 직접 사용합니다. */
    case 'get_sound_duration':
      return `sound_duration(${resourceRef(ctx, at(1), ctx.soundsById, ctx.soundName)})`;
    /**
     * 색상 선택 필드에서 선택한 색상(#RRGGBB)을 리터럴로 반환합니다.
     * Both blocks are primitive colour pickers holding that hex string: `color`
     * fills the brush blocks' slot, `text_color` the text blocks' one.
     */
    case 'color': case 'text_color': return colorLiteral(String(at(0) ?? ''));

    /** 사용자 정의 함수 호출 및 확장 블록을 처리합니다. */
    default: {
      /**
       * 확장 블록(날씨, 축제 등)의 드롭다운 값은 문자열로 처리하고, 값 슬롯은 표현식으로 변환합니다.
       */
      const expansion = expansionBlock(block.type);
      if (expansion) {
        const args = expansion.slots.map((slot, i) => (slot === 'value'
          ? exprOf(at(i), ctx)
          : tessString(String(at(i) ?? ''))));
        return `${block.type}(${args.join(', ')})`;
      }

      /** 함수 본문에서 매개변수를 참조하는 블록을 처리합니다. */
      const paramName = ctx.funcParamName?.(block.type);
      if (paramName) return paramName;

      if (block.type.startsWith('func_')) {
        const fn = ctx.functionsById.get(block.type.slice('func_'.length));
        if (fn) {
          const args = p.filter((_: unknown, i: number) => i < fn.params.length)
            .map((param: unknown) => exprOf(param, ctx));
          return `${fn.name}(${args.join(', ')})`;
        }
      }
      return placeholder(ctx, block);
    }
  }
}
