/**
 * 엔트리 문장 블록을 Tess 소스 코드로 변환합니다.
 * 블록 배열을 입력받아 들여쓰기가 없는 텍스트 줄 배열을 반환합니다.
 */
import { exprOf } from "./expr.ts";
import {
  tessString,
  tessNumber,
  ownsResource,
  isExactNumber,
  tessLiteral,
  displayNamePart,
} from "./ident.ts";
import type {
  DecompileContext, FunctionInfo, RawBlock, ResourceInfo,
} from './types.ts';

const REVERSE_STOP_TARGET: Record<string, string> = {
  thisThread: "",
  otherThread: "other",
  thisOnly: "me",
  other_objects: "them",
  all: "all",
};
const REVERSE_EFFECT: Record<string, string> = {
  color: "effect_color",
  brightness: "effect_brightness",
  transparency: "effect_alpha",
};
const REVERSE_TEXT_EFFECT: Record<string, string> = {
  fontBold: "text_bold",
  fontItalic: "text_italic",
  underLine: "text_underline",
  strike: "text_strikethrough",
};
// set_tts_property 의 코드값 -> packages/compiler/src/statement.ts 의 TTS_SPEAKERS/TTS_LEVELS 별명으로
const REVERSE_TTS_SPEAKER: Record<string, string> = {
  kyuri: "female",
  jinho: "male",
  hana: "kind",
  dinna: "sweet",
  brown: "echo",
  minions: "mischievous",
  sally: "dainty",
  nsabina: "nsabina",
  nmammon: "nmammon",
  nmeow: "kitty",
  nwoof: "doggy",
};

export function indent(lines: string[]): string[] {
  return lines.map((line) => (line === "" ? line : `  ${line}`));
}

/**
 * 하나의 스레드(블록 배열)를 Tess 소스 코드 줄 배열로 변환합니다.
 *
 * @param blocks 변환할 블록 배열
 * @param ctx 디컴파일 컨텍스트
 * @returns 변환된 소스 코드 줄 배열
 * @example
 * const lines = blocksToLines(blocks, ctx);
 */
export function blocksToLines(blocks: RawBlock[] | undefined, ctx: DecompileContext): string[] {
  const lines: string[] = [];
  for (const block of blocks ?? []) lines.push(...statementLines(block, ctx));
  return lines;
}

function branch(block: RawBlock, index: number, ctx: DecompileContext): string[] {
  return indent(blocksToLines(block.statements?.[index] ?? [], ctx));
}

function unsupported(ctx: DecompileContext, block: RawBlock | undefined): string[] {
  const type = block?.type ?? "(알 수 없음)";
  ctx.warnings.add(`문장 블록 '${type}' 은(는) 아직 옮길 수 없습니다.`);
  const paramsText = JSON.stringify(summarizeParams(block?.params)).slice(
    0,
    200,
  );
  return [`# [decompile] 지원하지 않는 블록: ${type} params=${paramsText}`];
}

function summarizeParams(params: any[] | undefined) {
  return (params ?? []).map((p) => {
    if (p === null || p === undefined) return null;
    if (typeof p !== "object") return p;
    return p.type;
  });
}

// eslint-disable-next-line complexity
/** ROW/COL — which way a table block works. */
function tableLine(property: unknown): string {
  return String(property) === 'COL' ? 'column' : 'row';
}

/**
 * The `x y` pair of a `go` statement. A name directly followed by `(` reads as
 * a call, which would swallow the y coordinate, so such an x gets parentheses.
 */
function point(x: string, y: string): string {
  const looksLikeCall = /[\p{L}\p{N}_]$/u.test(x) && y.startsWith('(');
  return `${looksLikeCall ? `(${x})` : x} ${y}`;
}

function statementLines(block: any, ctx: DecompileContext): string[] {
  if (!block || typeof block !== "object" || !block.type) return [];
  const p = block.params ?? [];
  const at = (i: number) => p[i];
  const e = (i: number) => exprOf(at(i), ctx);

  switch (block.type) {
    // --- 이벤트 hat 블록은 흐름을 만드는 쪽(events.js)이 처리한다.
    //     스레드 본문 안에서 다시 나올 일은 없지만, 방어적으로 건너뛴다.
    case "when_run_button_click":
    case "when_scene_start":
    case "when_some_key_pressed":
    case "when_object_click":
    case "when_message_cast":
    case "when_clone_start":
      return [];

    // --- 제어 흐름 ---------------------------------------------------------
    case "_if":
      return [`if ${e(0)}:`, ...branch(block, 0, ctx), "end"];
    case "if_else":
      return [
        `if ${e(0)}:`,
        ...branch(block, 0, ctx),
        "else:",
        ...branch(block, 1, ctx),
        "end",
      ];
    case "repeat_basic":
      return [`repeat ${e(0)}:`, ...branch(block, 0, ctx), "end"];
    case "repeat_inf":
      return ["forever:", ...branch(block, 0, ctx), "end"];
    case "repeat_while_true": {
      const kind = at(1) === "until" ? "until" : "while";
      return [`${kind} ${e(0)}:`, ...branch(block, 0, ctx), "end"];
    }
    case "wait_second":
      return [`wait ${e(0)}`];
    case "wait_until_true":
      return [`wait ${e(0)}`];
    case "stop_repeat":
      return ["break"];
    case "continue_repeat":
      return ["skip"];
    case "restart_project":
      return ["restart"];
    case "stop_object": {
      const target = REVERSE_STOP_TARGET[at(0)];
      return [
        target === undefined
          ? unsupported(ctx, block)[0]
          : `stop${target ? ` ${target}` : ""}`,
      ];
    }

    // --- 신호 · 복제 · 장면 -------------------------------------------------
    case "message_cast":
    case "message_cast_wait": {
      const name = ctx.messageName(at(0));
      return [
        `${block.type === "message_cast_wait" ? "call" : "send"} ${tessString(name)}`,
      ];
    }
    case "create_clone": {
      const target = at(0);
      return [
        target === "self"
          ? "clone"
          : `clone ${tessString(ctx.objectsById.get(target)?.identifier ?? target)}`,
      ];
    }
    case "delete_clone":
      return ["del clone"];
    case "remove_all_clones":
      return ["del clones"];
    case "start_scene": {
      const scene = ctx.scenesById.get(at(0));
      // A scene deleted while blocks still pointed at it leaves a jump that can
      // never run. Keeping it would only fail the build, so note it instead.
      if (!scene) {
        ctx.warnings.add(`장면 id '${at(0)}' 이(가) 작품에 없어 그 자리로 가는 'jump' 를 주석으로 남겼습니다.`);
        return [`# [decompile] jump ${tessString(String(at(0)))} — 작품에 없는 장면입니다`];
      }
      return [`jump ${tessString(scene.identifier)}`];
    }
    case "start_neighbor_scene":
      return [`jump ${at(0) === "next" ? "next" : "back"}`];

    // --- 움직임 -------------------------------------------------------------
    case "move_direction":
      return [`forward ${e(0)}`];
    case "move_to_angle":
      return [`forward ${e(1)} at ${e(0)}`];
    case "bounce_wall":
      return ["bounce"];
    case "move_xy_time":
      return [`move ${e(1)} ${e(2)} in ${e(0)}`];
    case "move_x":
      return [`x += ${e(0)}`];
    case "move_y":
      return [`y += ${e(0)}`];
    case "locate": {
      const target = at(0);
      return [
        target === "self"
          ? "# go self (엔트리 원본이 자기 자신으로 이동)"
          : `go ${tessString(ctx.objectsById.get(target)?.identifier ?? target)}`,
      ];
    }
    case "locate_object_time": {
      const target = at(1);
      return [
        `go ${tessString(ctx.objectsById.get(target)?.identifier ?? target)} in ${e(0)}`,
      ];
    }
    case "locate_x":
      return [`x = ${e(0)}`];
    case "locate_y":
      return [`y = ${e(0)}`];
    case "locate_xy":
      return [`go ${point(e(0), e(1))}`];
    case "locate_xy_time":
      return [`go ${point(e(1), e(2))} in ${e(0)}`];
    case "rotate_relative":
      return [`turn ${e(0)}`];
    case "rotate_by_time":
      return [`turn ${e(1)} in ${e(0)}`];
    case "rotate_absolute":
      return [`angle = ${e(0)}`];
    case "direction_relative":
      return [`steer ${e(0)}`];
    case "direction_relative_duration":
      return [`steer ${e(1)} in ${e(0)}`];
    case "direction_absolute":
      return [`way = ${e(0)}`];
    case "see_angle_object":
      return [
        `look ${tessString(ctx.objectsById.get(at(0))?.identifier ?? at(0))}`,
      ];

    // --- 모양 · 대화 ---------------------------------------------------------
    case "show":
      return ["show"];
    case "hide":
      return ["hide"];
    case "show_variable":
      return [`show ${ctx.varName(at(0))}`];
    case "hide_variable":
      return [`hide ${ctx.varName(at(0))}`];
    case "show_list":
      return [`show ${ctx.varName(at(0))}`];
    case "hide_list":
      return [`hide ${ctx.varName(at(0))}`];
    case "set_visible_project_timer":
      return [`${at(1) === "SHOW" ? "show" : "hide"} timer`];
    case "set_visible_answer":
      return [`${at(0) === "SHOW" ? "show" : "hide"} answer`];
    case "change_to_next_shape":
      return [at(0) === "prev" ? "prev costume" : "next costume"];
    case "change_to_some_shape":
      return [`costume = ${resourceExpr(at(0), ctx, ctx.picturesById)}`];
    case "dialog":
      return [`${at(1) === "think" ? "think" : "say"} ${e(0)}`];
    case "dialog_time":
      return [`${at(2) === "think" ? "think" : "say"} ${e(0)} for ${e(1)}`];
    case "flip_y":
      return ["flip x"]; // 엔트리 flip_x/flip_y 는 이름이 뒤집혀 있다
    case "flip_x":
      return ["flip y"];
    case "change_object_index":
      return [
        ({
          FRONT: "order first",
          FORWARD: "order front",
          BACKWARD: "order back",
          BACK: "order last",
        } as Record<string, string>)[at(0)]!,
      ];
    case "reset_scale_size":
      return ["reset size"];
    case "set_scale_size":
      return [`size = ${e(0)}`];
    case "change_scale_size":
      return [`size += ${e(0)}`];
    case "stretch_scale_size":
      return [`${at(0) === "WIDTH" ? "scale_x" : "scale_y"} += ${e(1)}`];
    case "change_effect_amount":
      return [`${REVERSE_EFFECT[at(0)] ?? at(0)} = ${e(1)}`];
    case "add_effect_amount":
      return [`${REVERSE_EFFECT[at(0)] ?? at(0)} += ${e(1)}`];
    case "erase_all_effects":
      return ["clear effects"];
    case "remove_dialog":
      return ["clear bubble"];

    // --- 글상자 -------------------------------------------------------------
    case "text_write":
      return [`write ${e(0)}`];
    case "text_append":
      return [`append ${e(0)}`];
    case "text_prepend":
      return [`prepend ${e(0)}`];
    case "text_flush":
      return ["clear text"];
    case "text_change_font":
      return [`font = ${tessString(at(0))}`];
    case "text_change_font_color":
      return [`font_color = ${colorExpr(at(0), ctx)}`];
    case "text_change_bg_color":
      return [`bg_color = ${colorExpr(at(0), ctx)}`];
    case "text_change_effect": {
      const name = REVERSE_TEXT_EFFECT[at(0)];
      return name
        ? [`${name} = ${at(1) === "on" ? "true" : "false"}`]
        : unsupported(ctx, block);
    }

    // --- 붓 -----------------------------------------------------------------
    case "start_drawing":
      return ["start draw"];
    case "stop_drawing":
      return ["stop draw"];
    case "start_fill":
      return ["start fill"];
    case "stop_fill":
      return ["stop fill"];
    case "brush_stamp":
      return ["stamp"];
    case "brush_erase_all":
      return ["clear draw"];
    case "set_color":
      return [`draw_color = ${colorExpr(at(0), ctx)}`];
    case "set_fill_color":
      return [`fill_color = ${colorExpr(at(0), ctx)}`];
    case "set_random_color":
      return ["draw_color = random_color()"];
    case "set_thickness":
      return [`draw_width = ${e(0)}`];
    case "change_thickness":
      return [`draw_width += ${e(0)}`];
    case "set_brush_tranparency":
      return [`draw_alpha = ${e(0)}`];
    case "change_brush_transparency":
      return [`draw_alpha += ${e(0)}`];

    // --- 초시계 ---------------------------------------------------------------
    case "choose_project_timer_action": {
      const action = ({
        START: "start timer",
        STOP: "stop timer",
        RESET: "reset timer",
      } as Record<string, string>)[at(1)];
      return action ? [action] : unsupported(ctx, block);
    }

    // --- 소리 ---------------------------------------------------------------
    case "sound_something_with_block":
      return [`play sound ${resourceExpr(at(0), ctx, ctx.soundsById)}`];
    case "sound_something_wait_with_block":
      return [
        `play sound ${resourceExpr(at(0), ctx, ctx.soundsById)} and wait`,
      ];
    case "sound_something_second_with_block":
      return [
        `play sound ${resourceExpr(at(0), ctx, ctx.soundsById)} for ${e(1)}`,
      ];
    case "sound_something_second_wait_with_block":
      return [
        `play sound ${resourceExpr(at(0), ctx, ctx.soundsById)} for ${e(1)} and wait`,
      ];
    case "sound_from_to":
      return [
        `play sound ${resourceExpr(at(0), ctx, ctx.soundsById)} from ${e(1)} to ${e(2)}`,
      ];
    case "sound_from_to_and_wait":
      return [
        `play sound ${resourceExpr(at(0), ctx, ctx.soundsById)} from ${e(1)} to ${e(2)} and wait`,
      ];
    case "play_bgm":
      return [`play bgm ${resourceExpr(at(0), ctx, ctx.soundsById)}`];
    case "stop_bgm":
      return ["stop bgm"];
    case "sound_silent_all":
      return [`stop sound ${at(0) === "thisOnly" ? "this" : "all"}`];
    case "sound_volume_set":
      return [`sound_volume = ${e(0)}`];
    case "sound_volume_change":
      return [`sound_volume += ${e(0)}`];
    case "sound_speed_set":
      return [`sound_speed = ${e(0)}`];
    case "sound_speed_change":
      return [`sound_speed += ${e(0)}`];

    // --- TTS 읽어주기 (addendum) ---------------------------------------------
    case "read_text":
      return [`read ${e(0)}`];
    case "read_text_wait_with_block":
      return [`read ${e(0)} and wait`];
    case "set_tts_property": {
      // 속도·음높이는 코드값 그대로 옮긴다(같은 코드값이라도 뜻이 반대라 별명이 헷갈린다 — 9 참고)
      return [
        `tts voice ${tessString(REVERSE_TTS_SPEAKER[at(0)] ?? at(0))} ` +
          `speed ${tessString(String(at(1)))} pitch ${tessString(String(at(2)))}`,
      ];
    }

    // --- 테이블 ---------------------------------------------------------------
    case "append_row_to_table":
      return [`in ${ctx.tableName(at(0))} add ${tableLine(at(1))}`];
    case "insert_row_to_table":
      return [
        `in ${ctx.tableName(at(0))} insert ${tableLine(at(2))} at ${exprOf(at(1), ctx)}`,
      ];
    case "delete_row_from_table":
      return [`remove ${ctx.tableName(at(0))} ${tableLine(at(2))} ${exprOf(at(1), ctx)}`];
    case "set_value_from_table":
      return [`${ctx.tableName(at(0))}[${exprOf(at(1), ctx)}, ${exprOf(at(2), ctx)}] = ${e(3)}`];
    case "set_value_from_cell":
      return [`${ctx.tableName(at(0))}[${exprOf(at(1), ctx)}] = ${e(2)}`];
    case "save_current_table":
      return [`save ${ctx.tableName(at(0))}`];
    case "open_table":
      return [`show ${ctx.tableName(at(0))}`];
    case "open_table_wait":
      return [`show ${ctx.tableName(at(0))} for ${e(1)}`];
    case "open_table_chart":
      // 엔트리는 차트 번호를 0부터 세고, Tess 는 다른 번호들처럼 1부터 센다
      return [`show ${ctx.tableName(at(0))} chart ${tessNumber(Number(at(1) ?? 0) + 1)}`];
    case "close_table_chart":
      return ['hide chart'];

    // --- 자료 -----------------------------------------------------------------
    case "ask_and_wait":
      return [`ask ${e(0)}`];
    case "add_value_to_list":
      return [`in ${ctx.varName(at(1))} add ${e(0)}`];
    case "insert_value_to_list":
      return [
        `in ${ctx.varName(at(1))} insert ${e(0)} at ${exprOf(at(2), ctx)}`,
      ];
    case "remove_value_from_list":
      return [`remove ${ctx.varName(at(1))}[${exprOf(at(0), ctx)}]`];
    case "change_value_list_index":
      return [`${ctx.varName(at(0))}[${exprOf(at(1), ctx)}] = ${e(2)}`];

    // --- 변수 ---------------------------------------------------------------
    case "set_variable":
      return [`${ctx.varName(at(0))} = ${e(1)}`];
    case "change_variable":
      return [`${ctx.varName(at(0))} += ${e(1)}`];
    case "set_func_variable":
      return [`${ctx.funcLocalName(at(0))} = ${e(1)}`];

    default: {
      if (block.type.startsWith("func_"))
        return functionCallStatement(block, ctx);
      return unsupported(ctx, block);
    }
  }
}


/**
 * 색 값 파라미터는 엔트리가 '#RRGGBB' 를 그냥 문자열로 담아 두기도 하고(정적 엔티티
 * 값), `{type:'number', params:['#RRGGBB']}` 처럼 편집기의 색 선택 필드가 만드는 값
 * 블록으로 감싸 두기도 한다(실제 프로젝트에서 흔한 형태 — set_color 등의 VALUE 필드가
 * `Block, accept:'string'` 이라 편집기가 리터럴 값도 값 블록으로 저장한다). 이 감싸진
 * 형태를 처리하지 않으면 `String(그블록객체)` 가 그대로 "[object Object]" 라는 문자열
 * 리터럴로 남아 버린다(예전 버그). 리터럴이 아니라 변수·계산식처럼 진짜 계산되는
 * 값이면 ctx 를 받아 exprOf 로 제대로 된 Tess 표현식으로 옮긴다.
 */
export function colorExpr(value: any, ctx?: DecompileContext): string {
  const literal = literalStringOf(value);
  if (literal !== null) {
    if (/^#[0-9a-fA-F]{6}$/.test(literal)) return literal;
    if (literal === "transparent") return "transparent";
    return tessString(literal);
  }
  return ctx ? exprOf(value, ctx) : tessString(String(value ?? ""));
}

/** 값 블록(또는 원시값) 하나가 리터럴이면 그 문자열 값을, 계산되는 값이면 null 을 돌려준다 */
function literalStringOf(value: any): string | null {
  const raw = literalOf(value);
  return typeof raw === "string" ? raw : null;
}

/**
 * The raw literal behind a value slot, or null when the slot is computed.
 * Entry stores the same literal as a string or as a number depending on how it
 * was entered — even inside a `text` block — so both come back.
 */
function literalOf(value: any): string | number | null {
  if (typeof value === "string" || typeof value === "number") return value;
  if (
    value &&
    typeof value === "object" &&
    (value.type === "number" || value.type === "text")
  ) {
    const raw = value.params?.[0];
    if (typeof raw === "string" || typeof raw === "number") return raw;
  }
  return null;
}

/**
 * 모양/소리 값 자리 — 편집기에서 고른 게 아니라(그러면 get_pictures/get_sounds 블록),
 * 그 모양·소리의 진짜 엔트리 id 를 문자열로 직접 박아 넣는 트릭일 수도 있다. 엔트리는
 * "OO 모양으로 바꾸기"/"소리 OO 재생하기" 값을 1) id 2) 이름 3) 등록 순번 순으로 맞춰서
 * 찾기 때문에, id 를 그대로 넣어도 실제로 그 모양·소리로 바뀐다 — 실제 엔트리 사용자들이
 * 흔히 쓰는 방법이다. 그 id 를 문자열 그대로 옮기면, 되돌린 소스를 다시 컴파일할 때
 * 모든 id 가 새로 배정되면서(결정적이지만 원본과는 다른 id) 더 이상 아무 모양도
 * 가리키지 않게 되어 컴파일 에러가 난다 — 그래서 프로젝트에 실제로 있는 id 와
 * 맞는지 먼저 확인해서, 맞으면 get_pictures/get_sounds 와 똑같이 그 이름으로 옮긴다.
 */
function resourceExpr(value: any, ctx: DecompileContext, byId: Map<string, ResourceInfo>): string {
  const raw = literalOf(value);
  const literal = raw === null ? null : String(raw);
  if (literal !== null && byId.has(literal)) {
    const info = byId.get(literal)!;
    // 함수 안에서는 이름으로 바꾸지 않고 id 를 그대로 둔다. 그 모양·소리 선언에
    // `force id` 가 붙으므로 다시 컴파일해도 같은 id 가 나온다(index.ts 참고).
    // 그 오브젝트가 가진 함수 안이라면 이름이 어느 것을 가리키는지 분명하므로 이름을 쓴다.
    if (ctx.inFunction && !ownsResource(ctx, info)) return tessString(literal);
    return tessString(info.identifier);
  }
  // Nth-resource index. Entry reads the slot as a string, so the index turns up
  // as a `text` block or a bare value just as often as a `number` block;
  // emitting the string form back compiles to a missing-resource error.
  if (literal !== null && isExactNumber(literal))
    return tessNumber(Number(literal));
  return exprOf(value, ctx);
}

/**
 * project.functions[i].content 의 최상위 블록(function_create[_value])을
 * `function 이름(a, b): ... end` 선언으로 바꾼다. 오브젝트 스크립트 안이
 * 아니라 함수 목록을 훑을 때 index.ts 가 직접 부른다 — 함수 정의는 언제나
 * 이 자리에만 있고, 이름·매개변수 이름은 이미 ctx.functionsById 에 있다.
 */
export function functionDeclarationLines(
  fn: FunctionInfo,
  createBlock: RawBlock,
  ctx: DecompileContext,
  ownerId: string | null = null,
): string[] {
  const p = createBlock.params ?? [];
  const isValue = createBlock.type === "function_create_value";
  // 함수 안에서는 리터럴 모양·소리 id 를 이름으로 되짚지 않는다(resourceExpr) — 함수는
  // 엔트리에서 전역이라 여러 오브젝트가 같이 부를 수 있는데, id 로 하드코딩된 값을
  // "이 오브젝트의 이 이름" 으로 바꿔 버리면 다른 오브젝트가 불렀을 때 어긋난다
  // (index.ts buildContext 의 forcedIds 주석 참고). `ownerId` 가 있으면 이 선언이
  // 그 오브젝트 조각 파일 안으로 들어가므로, 그 오브젝트 리소스는 이름으로 적는다.
  const previousInFunction = ctx.inFunction;
  const previousOwner = ctx.functionOwnerId;
  ctx.inFunction = true;
  ctx.functionOwnerId = ownerId;
  const body = indent(blocksToLines(createBlock.statements?.[0] ?? [], ctx));
  const returnExpr = isValue ? exprOf(p[3], ctx) : null;
  ctx.inFunction = previousInFunction;
  ctx.functionOwnerId = previousOwner;

  // Entry keeps function locals in a table on the function and initialises them
  // at each call; `var` at the top of the body is the same thing in Tess.
  const locals = (fn.locals ?? []).map(
    (local) => `var ${local.name}${displayNamePart(local.name, local.entryName)} = ${tessLiteral(local.value)}`,
  );

  const lines = [
    `function ${fn.name}(${fn.params.join(", ")}):`,
    ...indent(locals),
    ...body,
  ];
  if (isValue) lines.push(...indent([`return ${returnExpr}`]));
  lines.push("end");
  return lines;
}

function functionCallStatement(block: RawBlock, ctx: DecompileContext): string[] {
  const fn = ctx.functionsById.get(block.type!.slice("func_".length));
  if (!fn) return unsupported(ctx, block);
  const p = block.params ?? [];
  const args = p
    .filter((_: unknown, i: number) => i < fn.params.length)
    .map((param: unknown) => exprOf(param, ctx));
  return [`${fn.name}(${args.join(", ")})`];
}
