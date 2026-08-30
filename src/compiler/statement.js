// ============================================================================
//  Tess 문장 -> 엔트리 블록
//
//  Tess 문장 하나가 엔트리 블록 여러 개가 되기도 한다.
//  (예: `move 20 20` 은 엔트리에 대응 블록이 없어서 move_x + move_y 로 펼친다)
// ============================================================================
import {
  ambiguousLocalError,
  compileAnyValue,
  compileBoolean,
  compileCallArguments,
  compileValue,
  isBooleanBlock,
  resolveList,
  resolveTarget,
} from "./expression.js";
import { requireScaleSetter } from "./runtime.js";
import { didYouMean, orHint } from "./suggest.js";

const STOP_TARGETS = {
  this: "thisThread", // 현재 스크립트만
  other: "otherThread", // 이 오브젝트의 다른 스크립트
  me: "thisOnly", // 이 오브젝트의 모든 스크립트
  them: "other_objects", // 다른 모든 오브젝트
  all: "all", // 프로젝트 전체
};

const EFFECTS = {
  effect_color: "color",
  effect_brightness: "brightness",
  effect_alpha: "transparency",
};

const TEXT_EFFECTS = {
  text_bold: "fontBold",
  text_italic: "fontItalic",
  text_underline: "underLine",
  text_strikethrough: "strike",
};

// TTS(읽어주기) 목소리 · 속도 · 음높이 — 엔트리 `set_tts_property` 의 드롭다운 값 그대로다
// (entryjs `src/playground/blocks/block_ai_utilize_tts.js`). 원래 코드값도 그대로 받고,
// 사람이 읽기 좋은 영어 별명도 같이 받는다.
const TTS_SPEAKERS = {
  kyuri: "kyuri",
  female: "kyuri",
  jinho: "jinho",
  male: "jinho",
  hana: "hana",
  kind: "hana",
  dinna: "dinna",
  sweet: "dinna",
  brown: "brown",
  echo: "brown",
  minions: "minions",
  mischievous: "minions",
  sally: "sally",
  dainty: "sally",
  nsabina: "nsabina",
  nmammon: "nmammon",
  nmeow: "nmeow",
  kitty: "nmeow",
  nwoof: "nwoof",
  doggy: "nwoof",
};
// speed 는 느릴수록 +, pitch 는 낮을수록 + — 엔트리 코드값을 그대로 따른다
const TTS_LEVELS = {
  veryslow: "5",
  verylow: "5",
  slow: "3",
  low: "3",
  normal: "0",
  fast: "-3",
  high: "-3",
  veryfast: "-5",
  veryhigh: "-5",
  5: "5",
  3: "3",
  0: "0",
  "-3": "-3",
  "-5": "-5",
};

/** 값을 읽어올 수 있는 오브젝트 속성 (복합 대입을 풀 때 쓴다) */
const READABLE_PROPERTIES = {
  x: "x",
  y: "y",
  angle: "rotation",
  way: "direction",
  size: "size",
};

export function compileStatements(statements, ctx) {
  const blocks = [];
  for (const statement of statements)
    blocks.push(...compileStatement(statement, ctx));
  return blocks;
}

export function compileStatement(node, ctx) {
  // 이 문장을 컴파일하는 동안 만들어지는 모든 블록(중첩된 값·조건 블록 포함)에
  // 이 문장의 소스 위치를 붙인다 — 실행 중 panic 났을 때 되짚어 보려고.
  const previousNode = ctx.currentNode;
  ctx.currentNode = node;
  // 하위 컴파일이 실패하면 null 이 올라올 수 있으므로 항상 배열로 맞춰 준다
  const blocks = compile(node, ctx) ?? [];
  ctx.currentNode = previousNode;
  ctx.applyComment(node, blocks[0]);
  return blocks;
}

function compile(node, ctx) {
  const one = (block) => (block ? [block] : []);

  switch (node.type) {
    // --- 제어 흐름 ---------------------------------------------------------
    case "If": {
      const test = compileBoolean(node.test, ctx);
      if (!test) return [];
      if (!node.alternate) {
        return one(
          ctx.block(
            "_if",
            [test, null],
            [compileStatements(node.consequent, ctx)],
          ),
        );
      }
      return one(
        ctx.block(
          "if_else",
          [test, null, null],
          [
            compileStatements(node.consequent, ctx),
            compileStatements(node.alternate, ctx),
          ],
        ),
      );
    }

    case "Repeat": {
      const count = compileValue(node.count, ctx);
      return (
        count &&
        one(
          ctx.block(
            "repeat_basic",
            [count, null],
            [compileStatements(node.body, ctx)],
          ),
        )
      );
    }

    case "Forever":
      return one(
        ctx.block(
          "repeat_inf",
          [null, null],
          [compileStatements(node.body, ctx)],
        ),
      );

    case "While":
    case "Until": {
      // `while true:` 는 엔트리의 "계속 반복하기" 로 바꾸는 게 자연스럽다
      if (
        node.type === "While" &&
        node.test.type === "Boolean" &&
        node.test.value === true
      ) {
        return one(
          ctx.block(
            "repeat_inf",
            [null, null],
            [compileStatements(node.body, ctx)],
          ),
        );
      }
      const test = compileBoolean(node.test, ctx);
      const mode = node.type === "While" ? "while" : "until";
      return (
        test &&
        one(
          ctx.block(
            "repeat_while_true",
            [test, mode, null],
            [compileStatements(node.body, ctx)],
          ),
        )
      );
    }

    case "Wait": {
      // 값이면 "n초 기다리기", 판단이면 "~까지 기다리기" 가 된다. 어느 쪽인지 알아야
      // 하므로 get_boolean_value 로 감싸기 전의 블록을 본다.
      const value = compileAnyValue(node.value, ctx);
      if (!value) return [];
      return one(
        isBooleanBlock(value)
          ? ctx.block("wait_until_true", [value, null])
          : ctx.block("wait_second", [value, null]),
      );
    }

    case "Break":
      return one(ctx.block("stop_repeat", [null]));
    case "Skip":
      return one(ctx.block("continue_repeat", [null]));
    case "Restart":
      return one(ctx.block("restart_project", [null]));
    case "Stop":
      return one(ctx.block("stop_object", [STOP_TARGETS[node.target], null]));

    case "Return":
      return [
        ctx.error(node, "return 은 함수의 마지막 문장에서만 쓸 수 있습니다."),
      ].filter(Boolean);

    // --- 신호 · 복제 · 장면 -------------------------------------------------
    case "Send": {
      if (node.signal.type !== "String") {
        return [
          ctx.error(
            node,
            '신호 이름은 "게임 시작" 처럼 문자열로 직접 적어야 합니다.',
          ),
        ].filter(Boolean);
      }
      const id = ctx.messageId(node.signal.value);
      return one(
        ctx.block(node.wait ? "message_cast_wait" : "message_cast", [id, null]),
      );
    }

    case "Clone": {
      const target =
        node.target === null
          ? "self"
          : resolveTarget(node.target, ctx, { self: true });
      return target && one(ctx.block("create_clone", [target, null]));
    }

    case "DeleteClone":
      return one(ctx.block("delete_clone", [null]));
    case "DeleteClones":
      return one(ctx.block("remove_all_clones", [null]));

    case "Jump": {
      if (node.target === "next")
        return one(ctx.block("start_neighbor_scene", ["next", null]));
      if (node.target === "back")
        return one(ctx.block("start_neighbor_scene", ["prev", null]));
      if (node.target.type !== "String") {
        return [
          ctx.error(node, "장면 이름은 문자열로 직접 적어야 합니다."),
        ].filter(Boolean);
      }
      const scene = ctx.sceneByName.get(node.target.value);
      if (!scene)
        return [
          ctx.error(node, `'${node.target.value}' 이라는 장면이 없습니다.${didYouMean(node.target.value, ctx.sceneByName.keys())}`),
        ].filter(Boolean);
      return one(ctx.block("start_scene", [scene.id, null]));
    }

    // --- 움직임 -------------------------------------------------------------
    case "Forward": {
      const distance = compileValue(node.distance, ctx);
      if (!distance) return [];
      if (!node.angle)
        return one(ctx.block("move_direction", [distance, null]));
      const angle = compileAngle(node.angle, ctx);
      return angle && one(ctx.block("move_to_angle", [angle, distance, null]));
    }

    case "Bounce":
      return one(ctx.block("bounce_wall", [null]));

    case "Move": {
      const x = compileValue(node.x, ctx);
      const y = compileValue(node.y, ctx);
      if (!x || !y) return [];
      if (node.duration) {
        const duration = compileValue(node.duration, ctx);
        return (
          duration && one(ctx.block("move_xy_time", [duration, x, y, null]))
        );
      }
      // 엔트리에는 x·y 를 한 번에 상대 이동하는 블록이 없다 -> 두 블록으로 펼친다
      return [ctx.block("move_x", [x, null]), ctx.block("move_y", [y, null])];
    }

    case "Go": {
      if (node.target) {
        const target = resolveTarget(node.target, ctx, { self: true });
        if (!target) return [];
        if (!node.duration) return one(ctx.block("locate", [target, null]));
        const duration = compileValue(node.duration, ctx);
        return (
          duration &&
          one(ctx.block("locate_object_time", [duration, target, null]))
        );
      }
      const x = compileValue(node.x, ctx);
      const y = compileValue(node.y, ctx);
      if (!x || !y) return [];
      if (!node.duration) return one(ctx.block("locate_xy", [x, y, null]));
      const duration = compileValue(node.duration, ctx);
      return (
        duration && one(ctx.block("locate_xy_time", [duration, x, y, null]))
      );
    }

    case "Turn":
    case "Steer": {
      const angle = compileAngle(node.angle, ctx);
      if (!angle) return [];
      const isShape = node.type === "Turn";
      if (!node.duration) {
        return one(
          ctx.block(isShape ? "rotate_relative" : "direction_relative", [
            angle,
            null,
          ]),
        );
      }
      const duration = compileValue(node.duration, ctx);
      if (!duration) return [];
      return one(
        isShape
          ? ctx.block("rotate_by_time", [duration, angle, null])
          : ctx.block("direction_relative_duration", [duration, angle, null]),
      );
    }

    case "Look": {
      const target = resolveTarget(node.target, ctx, {});
      return target && one(ctx.block("see_angle_object", [target, null]));
    }

    // --- 모양 · 대화 ---------------------------------------------------------
    case "Show":
    case "Hide":
      return compileVisibility(node, ctx);

    case "CostumeStep":
      return one(ctx.block("change_to_next_shape", [node.direction, null]));

    case "Say":
    case "Think": {
      const message = compileValue(node.message, ctx);
      if (!message) return [];
      const mode = node.type === "Say" ? "speak" : "think";
      if (!node.duration)
        return one(ctx.block("dialog", [message, mode, null]));
      const duration = compileValue(node.duration, ctx);
      return (
        duration &&
        one(ctx.block("dialog_time", [message, duration, mode, null]))
      );
    }

    // 엔트리의 flip_x 는 상하, flip_y 는 좌우 뒤집기다 (이름이 반대다)
    case "Flip":
      return one(ctx.block(node.axis === "x" ? "flip_y" : "flip_x", [null]));

    case "Order":
      return one(
        ctx.block("change_object_index", [
          { first: "FRONT", front: "FORWARD", back: "BACKWARD", last: "BACK" }[
            node.to
          ],
          null,
        ]),
      );
    case "ResetSize":
      return one(ctx.block("reset_scale_size", [null]));
    case "Clear":
      return compileClear(node, ctx);

    // --- 글상자 -------------------------------------------------------------
    case "TextWrite": {
      const value = compileValue(node.value, ctx);
      const types = {
        write: "text_write",
        append: "text_append",
        prepend: "text_prepend",
      };
      return value && one(ctx.block(types[node.mode], [value, null]));
    }

    // --- 붓 -----------------------------------------------------------------
    case "StartDraw":
      return one(ctx.block("start_drawing", [null]));
    case "StopDraw":
      return one(ctx.block("stop_drawing", [null]));
    case "StartFill":
      return one(ctx.block("start_fill", [null]));
    case "StopFill":
      return one(ctx.block("stop_fill", [null]));
    case "Stamp":
      return one(ctx.block("brush_stamp", [null]));

    // --- 초시계 -------------------------------------------------------------
    case "StartTimer":
      return one(timerAction("START", ctx));
    case "StopTimer":
      return one(timerAction("STOP", ctx));
    case "ResetTimer":
      return one(timerAction("RESET", ctx));

    // --- 소리 ---------------------------------------------------------------
    case "PlaySound":
      return compilePlaySound(node, ctx);
    case "PlayBgm": {
      const sound = resolveSound(node.name, ctx);
      return sound && one(ctx.block("play_bgm", [sound, null]));
    }
    case "StopBgm":
      return one(ctx.block("stop_bgm", [null]));
    case "StopSound":
      return one(
        ctx.block("sound_silent_all", [
          node.target === "this" ? "thisOnly" : "all",
          null,
        ]),
      );

    // --- TTS 읽어주기 (addendum) ---------------------------------------------
    case "Read": {
      const message = compileValue(node.value, ctx);
      if (!message) return [];
      ctx.usesTts = true;
      return one(
        ctx.block(node.wait ? "read_text_wait_with_block" : "read_text", [
          message,
          null,
        ]),
      );
    }

    case "TtsSetting": {
      const speaker = ttsOption(TTS_SPEAKERS, node.voice, "목소리", ctx);
      const speed = ttsOption(TTS_LEVELS, node.speed, "속도", ctx);
      const pitch = ttsOption(TTS_LEVELS, node.pitch, "음높이", ctx);
      if (speaker === null || speed === null || pitch === null) return [];
      ctx.usesTts = true;
      return one(ctx.block("set_tts_property", [speaker, speed, pitch, null]));
    }

    // --- 자료 ---------------------------------------------------------------
    case "Ask": {
      const question = compileValue(node.question, ctx);
      return question && one(ctx.block("ask_and_wait", [question, null]));
    }

    case "ListAdd": {
      const list = requireList(node.list, ctx);
      const value = compileValue(node.value, ctx);
      return (
        list &&
        value &&
        one(ctx.block("add_value_to_list", [value, list.id, null]))
      );
    }

    case "ListInsert": {
      const list = requireList(node.list, ctx);
      const value = compileValue(node.value, ctx);
      const index = compileValue(node.index, ctx);
      return (
        list &&
        value &&
        index &&
        one(ctx.block("insert_value_to_list", [value, list.id, index, null]))
      );
    }

    case "ListRemove": {
      const list = requireList(node.list, ctx);
      const index = compileValue(node.index, ctx);
      return (
        list &&
        index &&
        one(ctx.block("remove_value_from_list", [index, list.id, null]))
      );
    }

    case "TableAddLine":
    case "TableInsertLine":
    case "TableRemoveLine":
      return compileTableLine(node, ctx);

    case "TableSave": {
      const table = requireTable(node.table, ctx);
      return table ? one(ctx.block("save_current_table", [table.id, null])) : [];
    }

    case "VarDecl":
    case "ListDecl":
      return compileDeclaration(node, ctx);

    case "TableDecl":
      return []; // 선언은 collectTable 이 미리 모아 두었다
    case "Assign":
      return compileAssign(node, ctx);
    case "ExpressionStatement":
      return compileCallStatement(node, ctx);

    default:
      return [
        ctx.error(
          node,
          `'${node.type}' 문장은 아직 엔트리 블록으로 바꿀 수 없습니다.`,
        ),
      ].filter(Boolean);
  }
}

// ---------------------------------------------------------------------------
//  보조 컴파일러
// ---------------------------------------------------------------------------
function timerAction(action, ctx) {
  return ctx.block("choose_project_timer_action", [null, action, null, null]);
}

/** 회전 계열 블록은 각도 리터럴 블록(angle)을 쓴다 */
function compileAngle(node, ctx) {
  if (node.type === "Number") return ctx.angle(node.value);
  if (
    node.type === "Unary" &&
    node.operator === "-" &&
    node.argument.type === "Number"
  ) {
    return ctx.angle(-node.argument.value);
  }
  return compileValue(node, ctx);
}

function compileClear(node, ctx) {
  const types = {
    effects: "erase_all_effects",
    bubble: "remove_dialog",
    draw: "brush_erase_all",
    text: "text_flush",
  };
  return [ctx.block(types[node.target], [null])];
}

function compileVisibility(node, ctx) {
  const showing = node.type === "Show";
  // `hide chart` closes whichever table or chart window is open.
  if (node.target?.name === "chart" && !ctx.lookupVariable("chart")) {
    if (showing) {
      return [ctx.error(node, "show chart 는 없습니다. 'show 테이블 chart 1' 처럼 어떤 테이블의 차트인지 적으세요.")]
        .filter(Boolean);
    }
    return [ctx.block("close_table_chart", [null])];
  }

  const table = node.target && ctx.tableByName.get(node.target.name);
  if (table) return compileTableWindow(node, table, showing, ctx);

  if (!node.target) return [ctx.block(showing ? "show" : "hide", [null])];

  const name = node.target.name;
  if (name === "timer") {
    return [
      ctx.block("set_visible_project_timer", [
        null,
        showing ? "SHOW" : "HIDE",
        null,
        null,
      ]),
    ];
  }
  if (name === "answer") {
    return [ctx.block("set_visible_answer", [showing ? "SHOW" : "HIDE", null])];
  }

  const found = ctx.lookupVariable(name);
  if (found?.kind === "ambiguousLocal") {
    return [ambiguousLocalError(node, found, ctx)].filter(Boolean);
  }
  if (found?.kind !== "variable") {
    return [
      ctx.error(
        node,
        `'${name}' 은(는) 무대에 표시할 수 있는 변수나 리스트가 아닙니다.`,
      ),
    ].filter(Boolean);
  }
  const isList = found.entry.variableType === "list";
  const type = isList
    ? showing
      ? "show_list"
      : "hide_list"
    : showing
      ? "show_variable"
      : "hide_variable";
  return [ctx.block(type, [found.entry.id, null])];
}

// ---------------------------------------------------------------------------
//  테이블 (엔트리 '자료 분석' 블록)
// ---------------------------------------------------------------------------
/** `show 표` · `show 표 for N` · `show 표 chart N`, and `hide 표`. */
function compileTableWindow(node, table, showing, ctx) {
  if (!showing) return [ctx.block("close_table_chart", [null])];
  if (node.seconds) {
    const seconds = compileValue(node.seconds, ctx);
    return seconds ? [ctx.block("open_table_wait", [table.id, seconds, null])] : [];
  }
  if (node.chart) {
    const chart = literalIndex(node.chart, ctx);
    return chart === null ? [] : [ctx.block("open_table_chart", [table.id, chart, null])];
  }
  return [ctx.block("open_table", [table.id, "0", null])];
}

/**
 * A chart number, which Entry keeps as a dropdown field rather than a value
 * slot, so it has to be written out at compile time.
 */
function literalIndex(node, ctx) {
  if (node.type === "Number") return String(node.value - 1);
  if (node.type === "String") return node.value;
  return ctx.error(node, "차트 번호는 숫자로 직접 적어야 합니다.");
}

/** The table a statement names, or an error when the name is not one. */
function requireTable(node, ctx) {
  const table = ctx.tableByName.get(node.name);
  if (table) return table;
  return ctx.error(
    node,
    `'${node.name}' 은(는) 테이블이 아닙니다.${didYouMean(node.name, ctx.tableByName.keys())}`,
  );
}

function compileTableLine(node, ctx) {
  const table = requireTable(node.table, ctx);
  if (!table) return [];
  const property = node.line === "row" ? "ROW" : "COL";

  if (node.type === "TableAddLine") {
    return [ctx.block("append_row_to_table", [table.id, property, null])];
  }
  const index = compileValue(node.index, ctx);
  if (!index) return [];
  const type = node.type === "TableInsertLine" ? "insert_row_to_table" : "delete_row_from_table";
  return [ctx.block(type, [table.id, index, property, null])];
}

/** `표[행, "열"] = 값` and `표["B2"] = 값`. */
function compileTableAssign(node, table, ctx) {
  const value = compileValue(node.value, ctx);
  if (!value) return [];
  if (!node.target.column) {
    const cell = compileValue(node.target.index, ctx);
    return cell ? [ctx.block("set_value_from_cell", [table.id, cell, value, null])] : [];
  }
  const row = compileValue(node.target.index, ctx);
  const column = compileValue(node.target.column, ctx);
  if (!row || !column) return [];
  return [ctx.block("set_value_from_table", [table.id, row, column, value, null])];
}

function compilePlaySound(node, ctx) {
  const sound = resolveSound(node.name, ctx);
  if (!sound) return [];
  const { wait } = node;

  if (node.from) {
    const from = compileValue(node.from, ctx);
    const to = compileValue(node.to, ctx);
    if (!from || !to) return [];
    return [
      ctx.block(wait ? "sound_from_to_and_wait" : "sound_from_to", [
        sound,
        from,
        to,
        null,
      ]),
    ];
  }
  if (node.duration) {
    const duration = compileValue(node.duration, ctx);
    if (!duration) return [];
    const type = wait
      ? "sound_something_second_wait_with_block"
      : "sound_something_second_with_block";
    return [ctx.block(type, [sound, duration, null])];
  }
  const type = wait
    ? "sound_something_wait_with_block"
    : "sound_something_with_block";
  return [ctx.block(type, [sound, null])];
}

/**
 * 소리 이름 -> get_sounds 블록.
 *
 * 문자열 리터럴이면 오타를 바로 잡아 줄 수 있게 이 오브젝트에 등록된 소리인지
 * 확인하고 get_sounds 로 감싼다. 그 밖의 값(변수 등으로 계산한 값)이면 컴파일
 * 시점에는 확인할 수 없으니 그대로 흘려보낸다 — 엔트리의 소리 재생 블록은
 * 실행할 때 그 값을 1) 소리 id, 2) 소리 이름, 3) 순번 순으로 찾기 때문에,
 * 그 값이 실행 시점에 이 오브젝트의 소리 이름과 같기만 하면 정상 동작한다.
 */
/**
 * A costume/sound name Tess cannot tie to one resource, left as the plain
 * string it already is. Entry matches such a value against the resources of
 * whichever object runs the block — by id, then name, then position — so no
 * one object's id is the right answer, and a name that matches nothing here
 * may still be the id of a resource the work no longer carries. Neither can be
 * settled before the block runs, so both only warn.
 */
function byNameAtRuntime(node, ctx, found, kind) {
  if (found) return compileValue(node, ctx);
  const isPicture = kind === 'pictures';
  const shelf = isPicture ? ctx.object?.pictures : ctx.object?.sounds;
  const label = isPicture ? '모양을' : '소리를';
  const declare = isPicture ? 'costume' : 'sound';
  ctx.warn(
    node,
    `'${node.value}' ${label} ${ctx.object ? '이 오브젝트에서' : '어느 오브젝트에서도'} 찾지 못했습니다. `
    + `실행할 때 이름으로 찾습니다.${orHint(node.value, shelf?.keys() ?? [], `${declare} ${node.value} "파일명" 으로 먼저 등록하세요.`)}`,
  );
  return compileValue(node, ctx);
}

function resolveSound(node, ctx) {
  if (node.type === "String") {
    const sound = ctx.object?.sounds.get(node.value);
    if (sound) return ctx.block("get_sounds", [sound.id]);
    // 이 오브젝트 소리 이름은 아니지만, force id 로 어딘가에 고정해 둔 진짜 엔트리
    // id 와 정확히 같으면(1.4절 참고) 그대로 흘려보낸다 — 엔트리는 값을 1) id 2) 이름
    // 3) 순번 순으로 찾으므로, 그 id 만 맞으면 어느 오브젝트가 불러도 그 소리를 그대로
    // 가리킨다(예전에 함수 안에 특정 오브젝트의 소리 id 를 그대로 박아 넣던 관습을
    // 되돌릴 때 쓴다).
    if (ctx.forcedResourceIds.has(node.value)) return node.value;
    // 전역 함수에는 기준 오브젝트가 없다 — 이 이름을 가진 오브젝트가 단 하나뿐이면
    // 오브젝트 로컬 변수와 같은 이유로 그 소리를 그대로 가리킨다.
    const found = ctx.object ? null : ctx.lookupObjectResource('sounds', node.value);
    if (found?.kind === 'found') return ctx.block("get_sounds", [found.asset.id]);
    return byNameAtRuntime(node, ctx, found, 'sounds');
  }
  return compileValue(node, ctx);
}

/** 모양 이름 -> get_pictures 블록 (계산된 값은 resolveSound 와 같은 이유로 그대로 흘려보낸다) */
function resolvePicture(node, ctx) {
  if (node.type === "String") {
    const picture = ctx.object?.pictures.get(node.value);
    if (picture) return ctx.block("get_pictures", [picture.id]);
    if (ctx.forcedResourceIds.has(node.value)) return node.value;
    const found = ctx.object ? null : ctx.lookupObjectResource('pictures', node.value);
    if (found?.kind === 'found') return ctx.block("get_pictures", [found.asset.id]);
    return byNameAtRuntime(node, ctx, found, 'pictures');
  }
  return compileValue(node, ctx);
}

function requireList(node, ctx) {
  const list = resolveList(node, ctx);
  return list ?? ctx.error(node, `'${node.name}' 은(는) 리스트가 아닙니다.`);
}

// ---------------------------------------------------------------------------
//  선언 · 대입
// ---------------------------------------------------------------------------
function compileDeclaration(node, ctx) {
  // 선언 자체는 미리 수집해 두었고, 여기서는 초기값 대입만 만든다.
  if (node.type === "ListDecl") {
    const found = ctx.lookupVariable(node.name);
    if (found?.kind !== "variable") return [];
    return []; // 리스트 초기값은 변수 항목의 array 로 들어간다
  }
  return compileAssign(
    {
      type: "Assign",
      operator: "=",
      target: { type: "Identifier", name: node.name, loc: node.loc },
      value: node.value,
      loc: node.loc,
    },
    ctx,
  );
}

function compileAssign(node, ctx) {
  if (node.target.type === "Index") return compileListElementAssign(node, ctx);

  const name = node.target.name;
  const found = ctx.lookupVariable(name);
  if (found) return compileVariableAssign(node, found, ctx);
  return compilePropertyAssign(node, name, ctx);
}

function compileVariableAssign(node, found, ctx) {
  const { operator } = node;

  if (found.kind === "ambiguousLocal") {
    return [ambiguousLocalError(node, found, ctx)].filter(Boolean);
  }

  if (found.kind === "param") {
    return [
      ctx.error(
        node,
        `함수 매개변수 '${found.name}' 에는 값을 대입할 수 없습니다.`,
      ),
    ].filter(Boolean);
  }

  const read = () =>
    found.kind === "funcLocal"
      ? ctx.block("get_func_variable", [found.id, null])
      : ctx.block("get_variable", [found.entry.id, null]);
  const write = (value) =>
    found.kind === "funcLocal"
      ? ctx.block("set_func_variable", [found.id, value, null])
      : ctx.block("set_variable", [found.entry.id, value, null]);

  if (operator === "=") {
    const value = compileValue(node.value, ctx);
    return value ? [write(value)] : [];
  }

  if (operator === "+=" && found.kind === "variable") {
    const value = compileValue(node.value, ctx);
    return value
      ? [ctx.block("change_variable", [found.entry.id, value, null])]
      : [];
  }

  const combined = combine(read(), operator, node.value, ctx);
  return combined ? [write(combined)] : [];
}

function compileListElementAssign(node, ctx) {
  const table = node.target.target.type === "Identifier"
    && ctx.tableByName.get(node.target.target.name);
  if (table) {
    if (node.operator !== "=") {
      return [ctx.error(node, `테이블 칸에는 '=' 로만 값을 넣을 수 있습니다.`)].filter(Boolean);
    }
    return compileTableAssign(node, table, ctx);
  }
  if (node.target.column) {
    return [ctx.error(node, `'${node.target.target.name}' 은(는) 테이블이 아니라서 [행, 열] 로 쓸 수 없습니다.`)]
      .filter(Boolean);
  }
  const list = requireList(node.target.target, ctx);
  const index = compileValue(node.target.index, ctx);
  if (!list || !index) return [];

  if (node.operator === "=") {
    const value = compileValue(node.value, ctx);
    return value
      ? [ctx.block("change_value_list_index", [list.id, index, value, null])]
      : [];
  }

  const current = ctx.block("value_of_index_from_list", [
    null,
    list.id,
    null,
    compileValue(node.target.index, ctx),
    null,
  ]);
  const combined = combine(current, node.operator, node.value, ctx);
  return combined
    ? [ctx.block("change_value_list_index", [list.id, index, combined, null])]
    : [];
}

/** `대상 op= 값` 을 `대상 op 값` 표현식으로 푼다 */
function combine(current, operator, valueNode, ctx) {
  const value = compileValue(valueNode, ctx);
  if (!value) return null;
  const arithmetic = {
    "+=": "PLUS",
    "-=": "MINUS",
    "*=": "MULTI",
    "/=": "DIVIDE",
  };
  if (arithmetic[operator])
    return ctx.block("calc_basic", [current, arithmetic[operator], value]);
  if (operator === "%=")
    return ctx.block("quotient_and_mod", [
      null,
      current,
      null,
      value,
      null,
      "MOD",
    ]);
  if (operator === "**=") {
    if (valueNode.type === "Number" && valueNode.value === 2) {
      return ctx.block("calc_operation", [null, current, null, "square"]);
    }
    if (valueNode.type === "Number" && valueNode.value === 0.5) {
      return ctx.block("calc_operation", [null, current, null, "root"]);
    }
    return ctx.error(
      valueNode,
      "엔트리에서 **= 은 2(제곱) 또는 0.5(제곱근)만 쓸 수 있습니다.",
    );
  }
  return ctx.error(
    valueNode,
    `연산자 '${operator}' 를 엔트리 블록으로 바꿀 수 없습니다.`,
  );
}

/** 오브젝트 속성 대입 */
function compilePropertyAssign(node, name, ctx) {
  const { operator } = node;
  const relative = operator === "+=" || operator === "-=";
  const negate = operator === "-=";

  const value = () => {
    const compiled = compileValue(node.value, ctx);
    if (!compiled || !negate) return compiled;
    if (node.value.type === "Number") return ctx.number(-node.value.value);
    return ctx.block("calc_basic", [ctx.number(0), "MINUS", compiled]);
  };
  const angleValue = () => {
    if (!negate) return compileAngle(node.value, ctx);
    if (node.value.type === "Number") return ctx.angle(-node.value.value);
    const compiled = compileValue(node.value, ctx);
    return (
      compiled && ctx.block("calc_basic", [ctx.number(0), "MINUS", compiled])
    );
  };
  const simple = (setType, addType, make = value) => {
    if (operator === "=") {
      const compiled = make();
      return compiled ? [ctx.block(setType, [compiled, null])] : [];
    }
    if (relative && addType) {
      const compiled = make();
      return compiled ? [ctx.block(addType, [compiled, null])] : [];
    }
    return readModifyWrite(name, setType, node, ctx);
  };

  switch (name) {
    case "x":
      return simple("locate_x", "move_x");
    case "y":
      return simple("locate_y", "move_y");
    case "size":
      return simple("set_scale_size", "change_scale_size");
    case "angle":
      return simple("rotate_absolute", "rotate_relative", angleValue);
    case "way":
      return simple("direction_absolute", "direction_relative", angleValue);

    case "scale_x":
    case "scale_y": {
      if (relative) {
        const compiled = value();
        const dimension = name === "scale_x" ? "WIDTH" : "HEIGHT";
        return compiled
          ? [ctx.block("stretch_scale_size", [dimension, compiled, null])]
          : [];
      }
      if (operator !== "=") {
        return [
          ctx.error(node, `${name} 에는 = 과 +=, -= 만 쓸 수 있습니다.`),
        ].filter(Boolean);
      }
      // 엔트리에는 한 축의 비율을 "정하는" 블록이 없다.
      // 컴파일러가 만들어 넣는 함수가 지금 크기를 재서 목표 비율로 맞춘다.
      if (ctx.funcScope) {
        return [
          ctx.error(
            node,
            `${name} 을(를) 정하는 일은 함수 안에서 할 수 없습니다. 오브젝트마다 시작 배율이 다르기 때문입니다.`,
          ),
        ].filter(Boolean);
      }
      const compiled = compileValue(node.value, ctx);
      if (!compiled) return [];
      const setter = requireScaleSetter(name, ctx);
      return [
        ctx.block(`func_${setter.id}`, [
          compiled,
          ctx.number(originScale(name, ctx)),
          null,
        ]),
      ];
    }

    case "costume": {
      if (operator !== "=")
        return [ctx.error(node, "costume 은 = 로만 바꿀 수 있습니다.")].filter(
          Boolean,
        );
      const picture = resolvePicture(node.value, ctx);
      return picture
        ? [ctx.block("change_to_some_shape", [picture, null])]
        : [];
    }

    case "effect_color":
    case "effect_brightness":
    case "effect_alpha": {
      const effect = EFFECTS[name];
      const compiled = value();
      if (!compiled) return [];
      if (operator === "=")
        return [ctx.block("change_effect_amount", [effect, compiled, null])];
      if (relative)
        return [ctx.block("add_effect_amount", [effect, compiled, null])];
      return [
        ctx.error(node, `효과 값에는 = 과 +=, -= 만 쓸 수 있습니다.`),
      ].filter(Boolean);
    }

    case "draw_color":
    case "fill_color": {
      if (operator !== "=")
        return [
          ctx.error(node, `${name} 은(는) = 로만 정할 수 있습니다.`),
        ].filter(Boolean);
      if (node.value.type === "Call" && node.value.callee === "random_color") {
        if (name === "fill_color") {
          return [
            ctx.error(node, "엔트리에는 무작위 채우기 색 블록이 없습니다."),
          ].filter(Boolean);
        }
        return [ctx.block("set_random_color", [null])];
      }
      const compiled = compileColor(node.value, ctx);
      if (compiled === "transparent")
        return [rejectRuntimeTransparent(name, node, ctx)].filter(Boolean);
      const type = name === "draw_color" ? "set_color" : "set_fill_color";
      return compiled ? [ctx.block(type, [compiled, null])] : [];
    }

    case "draw_width":
      return simple("set_thickness", "change_thickness");
    case "draw_alpha":
      return simple("set_brush_tranparency", "change_brush_transparency");
    case "sound_volume":
      return simple("sound_volume_set", "sound_volume_change");
    case "sound_speed":
      return simple("sound_speed_set", "sound_speed_change");

    // --- 글상자 -------------------------------------------------------------
    case "text_content": {
      if (operator !== "=")
        return [
          ctx.error(
            node,
            "text_content 는 = 로만 바꿀 수 있습니다. 이어 붙이려면 append 를 쓰세요.",
          ),
        ].filter(Boolean);
      const compiled = value();
      return compiled ? [ctx.block("text_write", [compiled, null])] : [];
    }

    case "font": {
      if (node.value.type !== "String")
        return [ctx.error(node, "글씨체는 문자열로 적어야 합니다.")].filter(
          Boolean,
        );
      return [ctx.block("text_change_font", [node.value.value, null])];
    }

    case "font_color":
    case "bg_color": {
      const compiled = compileColor(node.value, ctx);
      if (compiled === "transparent")
        return [rejectRuntimeTransparent(name, node, ctx)].filter(Boolean);
      const type =
        name === "font_color"
          ? "text_change_font_color"
          : "text_change_bg_color";
      return compiled ? [ctx.block(type, [compiled, null])] : [];
    }

    case "text_bold":
    case "text_italic":
    case "text_underline":
    case "text_strikethrough": {
      if (node.value.type !== "Boolean") {
        return [
          ctx.error(node, `${name} 에는 true 또는 false 만 쓸 수 있습니다.`),
        ].filter(Boolean);
      }
      const mode = node.value.value ? "on" : "off";
      return [
        ctx.block("text_change_effect", [TEXT_EFFECTS[name], mode, null]),
      ];
    }

    default:
      return [
        ctx.error(
          node,
          `선언되지 않은 이름 '${name}' 에 값을 대입했습니다.`
          + orHint(name, ctx.knownNames(), 'var 로 먼저 선언하세요.'),
        ),
      ].filter(Boolean);
  }
}

/** 오브젝트가 시작할 때의 가로/세로 배율 (엔트리의 "원래 크기로 되돌리기" 가 돌아가는 값) */
function originScale(name, ctx) {
  const properties = ctx.object?.properties;
  const read = (key) => {
    const value = properties?.get(key);
    return value?.type === "Number" ? value.value : null;
  };
  return (read(name) ?? read("size") ?? 100) / 100;
}

/** 값을 읽어서 계산한 뒤 다시 넣는 방식으로 복합 대입을 푼다 */
function readModifyWrite(name, setType, node, ctx) {
  const coordinate = READABLE_PROPERTIES[name];
  if (!coordinate) {
    return [
      ctx.error(
        node,
        `'${name}' 은(는) ${node.operator} 연산을 지원하지 않습니다.`,
      ),
    ].filter(Boolean);
  }
  const current = ctx.block("coordinate_object", [
    null,
    "self",
    null,
    coordinate,
  ]);
  const combined = combine(current, node.operator, node.value, ctx);
  return combined ? [ctx.block(setType, [combined, null])] : [];
}

/** tts 문의 voice/speed/pitch 값을 엔트리 코드값으로 바꾼다 (SPEC-ADDENDUM.md 5 참고) */
function ttsOption(table, node, label, ctx) {
  if (node.type !== "String")
    return ctx.error(node, `tts ${label}은(는) 문자열로 적어야 합니다.`);
  const key = node.value.trim().toLowerCase();
  const value = table[key];
  if (value === undefined) {
    const known = [...new Set(Object.values(table))].join(", ");
    return ctx.error(
      node,
      `tts ${label} '${node.value}' 을(를) 모릅니다. 쓸 수 있는 값: ${known}`,
    );
  }
  return value;
}

function compileColor(node, ctx) {
  if (node.type === "Color") return node.value;
  if (node.type === "Transparent") return "transparent";
  if (node.type === "String") return node.value;
  // Entry's colour slots take a value block as well as a picked colour, so any
  // expression that yields a colour string belongs here.
  return compileValue(node, ctx);
}

/**
 * set_color/set_fill_color/text_change_font_color/text_change_bg_color 네 블록은
 * 모두 값이 '#' 로 시작하지 않으면 무조건 '#' 를 붙인다(entryjs block_brush.js·block_text.js
 * func 안의 `if (color.indexOf('#') !== 0) color = '#' + color`). 그래서 'transparent' 를
 * 넘기면 실제로는 "#transparent" 라는 잘못된 색이 되어 버리는데, 이 잘못된 값을 다시
 * hex2rgb 가 '#000000'(검정)으로 되돌리거나(붓) 브라우저가 잘못된 CSS 색을 그냥 무시하며
 * 이전 색(대개 검정에 가까운 값)을 그대로 두거나(글상자) 한다 — 결과적으로 실행 중에는
 * 이 네 속성을 이 블록만으로는 절대 transparent 로 만들 수 없다(엔트리 자체의 한계).
 * 반면 오브젝트/글상자 선언 맨 위에 적는 정적 속성은 이 블록을 거치지 않고 엔트리
 * project.json 의 엔티티 값으로 바로 들어가므로 문제없이 동작한다.
 */
function rejectRuntimeTransparent(name, node, ctx) {
  return ctx.error(
    node,
    `실행 중에는 ${name} 을(를) transparent 로 정할 수 없습니다. 엔트리의 색 블록은 '#' 로 시작하지 ` +
      `않는 값을 받으면 강제로 '#' 를 붙이는데, 그러면 transparent 가 잘못된 색이 되어 오히려 검은색으로 ` +
      `보입니다(엔트리 자체의 한계로, 이 프로젝트가 만들 수 있는 블록으로는 피할 방법이 없습니다). ` +
      `오브젝트/글상자 선언 맨 위에서 ${name} = transparent 로 정적으로만 쓸 수 있습니다.`,
  );
}

// ---------------------------------------------------------------------------
//  함수 호출 문장
// ---------------------------------------------------------------------------
function compileCallStatement(node, ctx) {
  const call = node.expression;
  const fn = ctx.functionByName.get(call.callee);
  if (!fn) {
    return [
      ctx.error(
        node,
        `'${call.callee}' 함수를 찾을 수 없습니다. 내장 함수는 문장으로 쓸 수 없습니다.`,
      ),
    ].filter(Boolean);
  }
  if (fn.isValue) {
    return [
      ctx.error(
        node,
        `함수 '${call.callee}' 는 값을 돌려줍니다. var 결과 = ${call.callee}(...) 처럼 값으로 받아 쓰세요.`,
      ),
    ].filter(Boolean);
  }
  if (call.arguments.length !== fn.params.length) {
    return [
      ctx.error(
        node,
        `함수 '${call.callee}' 는 인자가 ${fn.params.length}개여야 합니다.`,
      ),
    ].filter(Boolean);
  }
  const params = compileCallArguments(fn, call.arguments, ctx);
  if (params.some((param) => param === null)) return [];
  // 값을 돌려주지 않는 함수 블록은 끝에 아이콘 자리(null)가 하나 더 붙는다
  return [ctx.block(`func_${fn.id}`, [...params, null])];
}
