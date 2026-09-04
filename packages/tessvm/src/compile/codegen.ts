/**
 * @fileoverview 엔트리 블록 트리를 자바스크립트 소스로 옮기는 JIT 컴파일러입니다.
 *
 * 블록 하나하나를 해석하는 대신, 작품을 한 번 읽어 제너레이터 함수의 소스를 만들고
 * `new Function` 으로 한 번만 컴파일합니다. 프레임을 넘겨야 하는 자리(반복 한 바퀴,
 * 기다리기, 시간이 걸리는 이동)는 `yield` 가 되고, 나머지는 전부 평범한 자바스크립트
 * 문장이 됩니다. 리터럴은 컴파일 시점에 접어 두고, 변수·오브젝트·함수는 배열 인덱스로
 * 미리 풀어 둡니다.
 */

/** A block as it appears in `project.json`. */
export interface RawBlock {
  id: string;
  type: string;
  params: unknown[];
  statements?: RawBlock[][];
}

export interface FunctionEntry {
  id: string;
  type: string;
  localVariables: Array<{ id: string; name: string; value: string | number }>;
  content: string | RawBlock[][];
}

export interface CompileInput {
  objects: Array<{ id: string; script: string | RawBlock[][] }>;
  variables: Array<{ id: string; variableType?: string }>;
  functions: FunctionEntry[];
  scenes: Array<{ id: string }>;
  messages: Array<{ id: string }>;
  tables: Array<{ id: string }>;
}

export interface ScriptPlan {
  targetIndex: number;
  event: string;
  filter: string | null;
  blockId: string;
  /** Index into the generated `scripts` array. */
  index: number;
}

export interface CompiledProgram {
  source: string;
  plans: ScriptPlan[];
  /** Block types the compiler did not know, with how often they appeared. */
  unknown: Map<string, number>;
}

/** Hat blocks and the runtime event each one waits for. */
const HATS: Record<string, string> = {
  when_run_button_click: 'start',
  when_some_key_pressed: 'keyPress',
  mouse_clicked: 'mouse_clicked',
  mouse_click_cancled: 'mouse_click_cancled',
  when_object_click: 'when_object_click',
  when_object_click_canceled: 'when_object_click_canceled',
  when_message_cast: 'when_message_cast',
  when_scene_start: 'when_scene_start',
  when_clone_start: 'when_clone_start',
};

/** Which param of a hat block narrows it (key code, message id). */
const HAT_FILTER: Record<string, number> = {
  when_some_key_pressed: 1,
  when_message_cast: 1,
};

const RESERVED_PARAM = /^(string|boolean)Param_/;

type Kind = 'num' | 'str' | 'bool' | 'any';

interface Value {
  code: string;
  kind: Kind;
  /** Set when the value is a compile-time constant. */
  constant?: string | number | boolean;
}

const NULL_VALUE: Value = { code: 'undefined', kind: 'any' };

function literal(value: unknown): string {
  return JSON.stringify(value === undefined ? null : value);
}

function isBlock(value: unknown): value is RawBlock {
  return Boolean(value) && typeof value === 'object' && typeof (value as RawBlock).type === 'string';
}

export class Codegen {
  private readonly input: CompileInput;
  private readonly varIndex = new Map<string, number>();
  private readonly targetIndex = new Map<string, number>();
  private readonly funcIndex = new Map<string, number>();
  private readonly tableIndex = new Map<string, number>();
  private readonly localVarIds = new Set<string>();
  private readonly plans: ScriptPlan[] = [];
  private readonly bodies: string[] = [];
  private readonly functionSources: string[] = [];
  readonly unknown = new Map<string, number>();

  /** Names bound inside the function body currently being compiled. */
  private paramSlots: Map<string, number> | null = null;
  private funcLocals: Set<string> | null = null;
  private loopDepth = 0;

  constructor(input: CompileInput) {
    this.input = input;
    input.variables.forEach((variable, index) => {
      this.varIndex.set(variable.id, index);
    });
    input.objects.forEach((object, index) => {
      this.targetIndex.set(object.id, index);
    });
    (input.tables ?? []).forEach((table, index) => {
      this.tableIndex.set(table.id, index);
    });
    input.functions.forEach((fn, index) => {
      this.funcIndex.set(fn.id, index);
      for (const local of fn.localVariables ?? []) {
        this.localVarIds.add(local.id);
      }
    });
  }

  compile(): CompiledProgram {
    for (const fn of this.input.functions) {
      this.functionSources.push(this.compileFunction(fn));
    }
    this.input.objects.forEach((object, targetIndex) => {
      const script = parseScript(object.script);
      for (const stack of script) {
        const hat = stack[0];
        if (!hat) {
          continue;
        }
        const event = HATS[hat.type];
        if (!event) {
          // Loose stacks and comment-only blocks never run; entry ignores them too.
          continue;
        }
        const filterIndex = HAT_FILTER[hat.type];
        const filter =
          filterIndex === undefined ? null : String(hat.params[filterIndex] ?? '');
        const body = this.compileStack(stack.slice(1));
        this.plans.push({
          targetIndex,
          event,
          filter,
          blockId: hat.id,
          index: this.bodies.length,
        });
        this.bodies.push(`function* (e, th) {\n${body}}`);
      }
    });
    return { source: this.emitModule(), plans: this.plans, unknown: this.unknown };
  }

  private emitModule(): string {
    const parts: string[] = [];
    parts.push('"use strict";');
    parts.push('const O = R.ops, V = R.variables, T = R.targets, C = R.cast;');
    parts.push('const n = C.num, s = C.str, b = C.bool, nf = C.field;');
    parts.push('const F = [];');
    this.functionSources.forEach((source, index) => {
      parts.push(`F[${index}] = ${source};`);
    });
    parts.push(`return { scripts: [\n${this.bodies.join(',\n')}\n], functions: F };`);
    return parts.join('\n');
  }

  private compileFunction(fn: FunctionEntry): string {
    const content = parseScript(fn.content);
    const define = findFunctionDefine(content);
    if (!define) {
      return 'function* () {}';
    }
    const params = collectParams(define.params[0]);
    this.paramSlots = new Map(params.map((name, index) => [name, index]));
    this.funcLocals = new Set((fn.localVariables ?? []).map((local) => local.id));
    const previousLoopDepth = this.loopDepth;
    this.loopDepth = 0;

    const locals = (fn.localVariables ?? [])
      .map((local) => `${literal(local.id)}: ${literal(local.value ?? 0)}`)
      .join(', ');
    const body = this.compileStack(define.statements?.[0] ?? []);
    let source = `function* (e, th, P) {\n  const L = {${locals}};\n${body}`;
    if (define.type === 'function_create_value') {
      const result = this.value(define.params[3]);
      source += `  return ${result.code};\n`;
    }
    source += '}';

    this.paramSlots = null;
    this.funcLocals = null;
    this.loopDepth = previousLoopDepth;
    return source;
  }

  private compileStack(blocks: RawBlock[], indent = '  '): string {
    let out = '';
    for (const block of blocks) {
      out += this.statement(block, indent);
    }
    return out;
  }

  // -------------------------------------------------------------------------
  //  Statements
  // -------------------------------------------------------------------------
  private statement(block: RawBlock, ind: string): string {
    const p = block.params;
    const line = (code: string) => `${ind}${code}\n`;

    switch (block.type) {
      // ----- moving -----
      case 'move_direction':
        return line(`O.moveDirection(e, ${this.num(p[0])});`);
      case 'bounce_wall':
        return line('O.bounceWall(e);');
      case 'move_x':
        return line(`O.moveX(e, ${this.num(p[0])});`);
      case 'move_y':
        return line(`O.moveY(e, ${this.num(p[0])});`);
      case 'move_to_angle':
        return line(`O.moveToAngle(e, ${this.numOf(p[1])}, ${this.numOf(p[0])});`);
      case 'locate_x':
        return line(`O.locateX(e, ${this.num(p[0])});`);
      case 'locate_y':
        return line(`O.locateY(e, ${this.num(p[0])});`);
      case 'locate_xy':
        return line(`O.locateXY(e, ${this.numOf(p[0])}, ${this.numOf(p[1])});`);
      case 'locate':
        return line(`O.locateTo(e, ${this.field(p[0])});`);
      case 'move_xy_time':
        return line(
          `yield* O.moveXYTime(e, ${this.numOf(p[0])}, ${this.numOf(p[1])}, ${this.numOf(p[2])});`,
        );
      case 'locate_xy_time':
        return line(
          `yield* O.locateXYTime(e, ${this.numOf(p[0])}, ${this.numOf(p[1])}, ${this.numOf(p[2])});`,
        );
      case 'locate_object_time':
        return line(`yield* O.locateObjectTime(e, ${this.num(p[0])}, ${this.field(p[1])});`);
      case 'rotate_relative':
        return line(`O.rotateRelative(e, ${this.num(p[0])});`);
      case 'direction_relative':
        return line(`O.directionRelative(e, ${this.num(p[0])});`);
      case 'rotate_absolute':
        return line(`O.rotateAbsolute(e, ${this.num(p[0])});`);
      case 'direction_absolute':
        return line(`O.directionAbsolute(e, ${this.num(p[0])});`);
      case 'rotate_by_time':
        return line(`yield* O.rotateByTime(e, ${this.numOf(p[0])}, ${this.numOf(p[1])});`);
      case 'direction_relative_duration':
        return line(`yield* O.directionByTime(e, ${this.numOf(p[0])}, ${this.numOf(p[1])});`);
      case 'see_angle_object':
        return line(`O.seeAngleObject(e, ${this.field(p[0])});`);

      // ----- looks -----
      case 'show':
        return line('e.setVisible(true);');
      case 'hide':
        return line('e.setVisible(false);');
      case 'dialog':
        return line(`O.dialog(e, ${this.raw(p[0])}, ${this.field(p[1])});`);
      case 'dialog_time':
        return line(`yield* O.dialogTime(e, ${this.raw(p[0])}, ${this.numOf(p[1])}, ${this.field(p[2])});`);
      case 'remove_dialog':
        return line('O.removeDialog(e);');
      case 'change_to_some_shape':
        return line(`O.setPicture(e, ${this.str(p[0])});`);
      case 'change_to_next_shape':
        return line(`O.nextPicture(e, ${this.field(p[0])});`);
      case 'add_effect_amount':
        return line(`O.addEffect(e, ${this.field(p[0])}, ${this.num(p[1])});`);
      case 'change_effect_amount':
        return line(`O.setEffect(e, ${this.field(p[0])}, ${this.num(p[1])});`);
      case 'erase_all_effects':
        return line('e.resetFilter();');
      case 'change_scale_size':
        return line(`e.setSize(e.getSize() + ${this.num(p[0])});`);
      case 'set_scale_size':
        return line(`e.setSize(${this.num(p[0])});`);
      case 'stretch_scale_size':
        return line(`O.stretchSize(e, ${this.raw(p[0])}, ${this.num(p[1])});`);
      case 'reset_scale_size':
        return line('e.resetSize();');
      case 'flip_x':
        return line('e.setScaleY(-e.getScaleY());');
      case 'flip_y':
        return line('e.setScaleX(-e.getScaleX());');
      case 'change_object_index':
        return line(`O.changeObjectIndex(e, ${this.field(p[0])});`);

      // ----- flow -----
      case 'wait_second':
        return line(`yield* O.waitSecond(${this.num(p[0])});`);
      case 'repeat_basic':
        return this.repeatBasic(block, ind);
      case 'repeat_inf':
        return this.loop(`while (true) {`, block.statements?.[0] ?? [], ind);
      case 'repeat_while_true':
        return this.repeatWhile(block, ind);
      case '_if':
        return (
          line(`if (${this.bool(p[0])}) {`) +
          this.compileStack(block.statements?.[0] ?? [], `${ind}  `) +
          line('}')
        );
      case 'if_else':
        return (
          line(`if (${this.bool(p[0])}) {`) +
          this.compileStack(block.statements?.[0] ?? [], `${ind}  `) +
          line('} else {') +
          this.compileStack(block.statements?.[1] ?? [], `${ind}  `) +
          line('}')
        );
      case 'wait_until_true':
        return line(`while (!(${this.bool(p[0])})) { yield 0; }`);
      case 'stop_repeat':
        return this.loopDepth > 0 ? line('break;') : line('return;');
      case 'continue_repeat':
        return this.loopDepth > 0 ? line('{ yield 0; continue; }') : line('yield 0;');
      case 'stop_object':
        return this.stopObject(String(p[0] ?? ''), ind);
      case 'restart_project':
        return line('O.restart(); return;');
      case 'create_clone':
        return line(`O.createClone(e, ${this.field(p[0])});`);
      case 'delete_clone':
        return line('if (e.isClone) { e.removeClone(); return; }');
      case 'remove_all_clones':
        return line('O.removeAllClones(e);');

      // ----- events -----
      case 'message_cast':
        return line(`O.castMessage(${this.field(p[0])});`);
      case 'message_cast_wait':
        return line(`yield* O.castMessageWait(${this.field(p[0])});`);
      case 'start_scene':
        return line(`O.startScene(${this.field(p[0])}); return;`);
      case 'start_neighbor_scene':
        return line(`O.startNeighborScene(${this.field(p[0])}); return;`);
      case 'switch_scope':
        return line(`e = O.entityOf(${this.field(p[0])}) || e;`);

      // ----- variables -----
      case 'set_variable':
        return line(`O.setVariable(e, ${this.varRef(p[0])}, ${this.raw(p[1])});`);
      case 'change_variable':
        return line(`O.changeVariable(e, ${this.varRef(p[0])}, ${this.raw(p[1])});`);
      case 'show_variable':
        return line(`O.showVariable(e, ${this.varRef(p[0])}, true);`);
      case 'hide_variable':
        return line(`O.showVariable(e, ${this.varRef(p[0])}, false);`);
      case 'add_value_to_list':
        return line(`O.listAppend(e, ${this.varRef(p[1])}, ${this.raw(p[0])});`);
      case 'remove_value_from_list':
        return line(`O.listRemove(e, ${this.varRef(p[1])}, ${this.raw(p[0])});`);
      case 'insert_value_to_list':
        return line(`O.listInsert(e, ${this.varRef(p[1])}, ${this.raw(p[2])}, ${this.raw(p[0])});`);
      case 'change_value_list_index':
        return line(`O.listReplace(e, ${this.varRef(p[0])}, ${this.raw(p[1])}, ${this.raw(p[2])});`);
      case 'show_list':
        return line(`O.showVariable(e, ${this.varRef(p[0])}, true);`);
      case 'hide_list':
        return line(`O.showVariable(e, ${this.varRef(p[0])}, false);`);
      case 'ask_and_wait':
        return line(`yield* O.askAndWait(e, ${this.raw(p[0])});`);
      case 'set_visible_answer':
        return line(`O.showAnswer(${this.field(p[0])} !== 'HIDE');`);
      case 'set_func_variable':
        return line(`L[${this.funcVarKey(p[0])}] = ${this.raw(p[1])};`);

      // ----- text boxes -----
      case 'text_write':
        return line(`e.setText(${this.str(p[0])});`);
      case 'text_append':
        return line(`e.setText(e.getText() + ${this.str(p[0])});`);
      case 'text_prepend':
        return line(`e.setText(${this.str(p[0])} + e.getText());`);
      case 'text_flush':
        return line("e.setText('');");
      case 'text_change_effect':
        return line(`O.textEffect(e, ${this.field(p[0])}, ${this.field(p[1])});`);
      case 'text_change_font':
        return line(`O.textFont(e, ${this.field(p[0])});`);
      case 'text_change_font_color':
        return line(`O.textColor(e, ${this.str(p[0])});`);
      case 'text_change_bg_color':
        return line(`O.textBgColor(e, ${this.str(p[0])});`);

      // ----- sound -----
      case 'sound_something_with_block':
        return line(`O.playSound(e, ${this.str(p[0])});`);
      case 'sound_something_second_with_block':
        return line(`O.playSound(e, ${this.strOf(p[0])}, 0, ${this.numOf(p[1])});`);
      case 'sound_from_to':
        return line(`O.playSoundRange(e, ${this.strOf(p[0])}, ${this.numOf(p[1])}, ${this.numOf(p[2])});`);
      case 'sound_something_wait_with_block':
        return line(`yield* O.playSoundWait(e, ${this.str(p[0])});`);
      case 'sound_something_second_wait_with_block':
        return line(`yield* O.playSoundWait(e, ${this.strOf(p[0])}, 0, ${this.numOf(p[1])});`);
      case 'sound_from_to_and_wait':
        return line(
          `yield* O.playSoundRangeWait(e, ${this.strOf(p[0])}, ${this.numOf(p[1])}, ${this.numOf(p[2])});`,
        );
      case 'sound_volume_change':
        return line(`O.changeVolume(${this.num(p[0])});`);
      case 'sound_volume_set':
        return line(`O.setVolume(${this.num(p[0])});`);
      case 'sound_speed_change':
        return line(`O.changeSpeed(${this.num(p[0])});`);
      case 'sound_speed_set':
        return line(`O.setSpeed(${this.num(p[0])});`);
      case 'sound_silent_all':
        return line(`O.stopSounds(e, ${this.field(p[0])});`);
      case 'play_bgm':
        return line(`O.playBgm(e, ${this.str(p[0])});`);
      case 'stop_bgm':
        return line('O.stopBgm();');

      // ----- pen -----
      case 'brush_stamp':
        return line('O.stamp(e);');
      case 'start_drawing':
        return line('O.startDrawing(e);');
      case 'stop_drawing':
        return line('O.stopDrawing(e);');
      case 'start_fill':
        return line('O.startFill(e);');
      case 'stop_fill':
        return line('O.stopFill(e);');
      case 'set_color':
        return line(`O.setPenColor(e, ${this.str(p[0])});`);
      case 'set_random_color':
        return line('O.setRandomPenColor(e);');
      case 'set_fill_color':
        return line(`O.setFillColor(e, ${this.str(p[0])});`);
      case 'change_thickness':
        return line(`O.changeThickness(e, ${this.num(p[0])});`);
      case 'set_thickness':
        return line(`O.setThickness(e, ${this.num(p[0])});`);
      case 'change_brush_transparency':
        return line(`O.changePenOpacity(e, ${this.num(p[0])});`);
      case 'set_brush_tranparency':
        return line(`O.setPenOpacity(e, ${this.num(p[0])});`);
      case 'brush_erase_all':
        return line('O.eraseAll(e);');

      // ----- data tables -----
      case 'append_row_to_table':
        return line(`O.tableAppend(${this.tableRef(p[0])}, ${this.str(p[1])});`);
      case 'insert_row_to_table':
        return line(`O.tableInsert(${this.tableRef(p[0])}, ${this.num(p[1])}, ${this.str(p[2])});`);
      case 'delete_row_from_table':
        return line(`O.tableDelete(${this.tableRef(p[0])}, ${this.num(p[1])}, ${this.str(p[2])});`);
      case 'set_value_from_table':
        return line(
          `O.tableSet(${this.tableRef(p[0])}, ${this.num(p[1])}, ${this.raw(p[2])}, ${this.raw(p[3])});`,
        );
      case 'set_value_from_cell':
        return line(`O.tableSetCell(${this.tableRef(p[0])}, ${this.raw(p[1])}, ${this.raw(p[2])});`);
      case 'save_current_table':
      case 'open_table':
      case 'open_table_chart':
      case 'close_table_chart':
        // Chart and save dialogs are editor UI; the running project sees nothing.
        return line(`/* ${block.type} */`);
      case 'open_table_wait':
        return line(`yield* O.waitSecond(${this.num(p[1])});`);

      // ----- text to speech -----
      case 'read_text':
        return line(`O.speak(e, ${this.str(p[0])});`);
      case 'read_text_wait_with_block':
        return line(`yield* O.speakWait(e, ${this.str(p[0])});`);
      case 'set_tts_property':
        return line(
          `O.setVoice(e, ${this.field(p[0])}, ${this.field(p[1])}, ${this.field(p[2])});`,
        );

      // ----- timer -----
      case 'choose_project_timer_action':
        return line(`O.timerAction(${this.field(p[1])});`);
      case 'set_visible_project_timer':
        return line(`O.showTimer(${this.field(p[1])} === 'SHOW');`);

      default:
        if (block.type.startsWith('func_')) {
          return this.callFunction(block, ind, false).code;
        }
        this.note(block.type);
        return line(`/* ${block.type} */`);
    }
  }

  private repeatBasic(block: RawBlock, ind: string): string {
    const count = this.num(block.params[0]);
    const varName = `i${this.loopDepth}`;
    let out = `${ind}{ let ${varName} = Math.floor(${count});\n`;
    this.loopDepth += 1;
    out += `${ind}while (${varName} !== 0 && !(${varName} < 0)) { ${varName}--;\n`;
    out += this.compileStack(block.statements?.[0] ?? [], `${ind}  `);
    out += `${ind}  yield 0;\n${ind}} }\n`;
    this.loopDepth -= 1;
    return out;
  }

  private repeatWhile(block: RawBlock, ind: string): string {
    const until = String(block.params[1] ?? 'until') === 'until';
    const condition = until ? `!(${this.bool(block.params[0])})` : this.bool(block.params[0]);
    return this.loop(`while (${condition}) {`, block.statements?.[0] ?? [], ind);
  }

  private loop(header: string, body: RawBlock[], ind: string): string {
    this.loopDepth += 1;
    const inner = this.compileStack(body, `${ind}  `);
    this.loopDepth -= 1;
    return `${ind}${header}\n${inner}${ind}  yield 0;\n${ind}}\n`;
  }

  private stopObject(target: string, ind: string): string {
    const line = (code: string) => `${ind}${code}\n`;
    switch (target) {
      case 'all':
        return line('O.stopAll(); return;');
      case 'thisOnly':
        return line('O.stopEntity(e); return;');
      case 'thisObject':
        return line('O.stopTarget(e); return;');
      case 'thisThread':
        return line('return;');
      case 'otherThread':
        return line('O.stopOtherThreads(e, th);');
      case 'other_objects':
        return line('O.stopOtherTargets(e);');
      default:
        return line('return;');
    }
  }

  // -------------------------------------------------------------------------
  //  Values
  // -------------------------------------------------------------------------
  private num(param: unknown): string {
    const value = this.value(param);
    if (value.constant !== undefined) {
      const folded = parseFloat(String(value.constant)) || 0;
      return String(folded);
    }
    return value.kind === 'num' ? value.code : `n(${value.code})`;
  }

  /** `Number(x)` rather than `parseFloat(x) || 0` — the timed blocks use this. */
  private numOf(param: unknown): string {
    const value = this.value(param);
    if (value.constant !== undefined) {
      return String(Number(value.constant));
    }
    return value.kind === 'num' ? value.code : `Number(${value.code})`;
  }

  private str(param: unknown): string {
    const value = this.value(param);
    if (value.constant !== undefined) {
      return literal(String(value.constant));
    }
    return value.kind === 'str' ? value.code : `s(${value.code})`;
  }

  private strOf(param: unknown): string {
    return this.str(param);
  }

  private bool(param: unknown): string {
    const value = this.value(param);
    if (value.constant !== undefined) {
      return String(Boolean(value.constant));
    }
    return value.kind === 'bool' ? value.code : `b(${value.code})`;
  }

  private raw(param: unknown): string {
    const value = this.value(param);
    return value.code;
  }

  /** A dropdown value: always a plain literal in the project file. */
  private field(param: unknown): string {
    if (isBlock(param)) {
      return this.value(param).code;
    }
    return literal(param ?? null);
  }

  private varRef(param: unknown): string {
    const id = String(param ?? '');
    const index = this.varIndex.get(id);
    if (index === undefined) {
      this.note(`variable:${id}`);
      return 'null';
    }
    return `${index}`;
  }

  private tableRef(param: unknown): string {
    const id = String(param ?? '');
    const index = this.tableIndex.get(id);
    if (index === undefined) {
      this.note(`table:${id}`);
      return '-1';
    }
    return `${index}`;
  }

  private funcVarKey(param: unknown): string {
    return literal(String(param ?? ''));
  }

  private value(param: unknown): Value {
    if (!isBlock(param)) {
      if (param === null || param === undefined) {
        return NULL_VALUE;
      }
      return { code: literal(param), kind: typeof param === 'number' ? 'num' : 'any', constant: param as string };
    }
    const block = param;
    const p = block.params;

    switch (block.type) {
      case 'number':
      case 'text':
        return { code: literal(p[0] ?? ''), kind: 'any', constant: (p[0] ?? '') as string };
      case 'angle':
        return { code: String(Number(p[0] ?? 0) || 0), kind: 'num', constant: Number(p[0] ?? 0) || 0 };
      case 'True':
        return { code: 'true', kind: 'bool', constant: true };
      case 'False':
        return { code: 'false', kind: 'bool', constant: false };
      case 'get_pictures':
      case 'get_sounds':
        return { code: literal(String(p[0] ?? '')), kind: 'str', constant: String(p[0] ?? '') };

      case 'calc_basic':
        return this.calcBasic(block);
      case 'calc_rand':
        return { code: `O.random(${this.str(p[1])}, ${this.str(p[3])})`, kind: 'any' };
      case 'calc_operation':
        return { code: `O.mathOp(${this.num(p[1])}, ${this.field(p[3])})`, kind: 'num' };
      case 'quotient_and_mod':
        return {
          code: `O.quotient(${this.num(p[1])}, ${this.num(p[3])}, ${this.field(p[5])})`,
          kind: 'num',
        };
      case 'coordinate_mouse':
        return { code: `O.mouseCoordinate(${this.field(p[1])})`, kind: 'num' };
      case 'coordinate_object':
        return { code: `O.objectProperty(e, ${this.field(p[1])}, ${this.field(p[3])})`, kind: 'any' };
      case 'distance_something':
        return { code: `O.distanceTo(e, ${this.field(p[1])})`, kind: 'num' };
      case 'get_project_timer_value':
        return { code: 'O.timerValue()', kind: 'num' };
      case 'get_date':
        return { code: `O.dateValue(${this.field(p[1])})`, kind: 'num' };
      case 'get_user_name':
      case 'get_nickname':
        return { code: "' '", kind: 'str', constant: ' ' };

      case 'length_of_string':
        return { code: `${this.str(p[1])}.length`, kind: 'num' };
      case 'reverse_of_string':
        return { code: `${this.str(p[1])}.split('').reverse().join('')`, kind: 'str' };
      case 'combine_something':
        return { code: `(${this.str(p[1])} + ${this.str(p[3])})`, kind: 'str' };
      case 'char_at':
        return { code: `O.charAt(${this.str(p[1])}, ${this.num(p[3])})`, kind: 'str' };
      case 'substring':
        return {
          code: `O.substring(${this.str(p[1])}, ${this.num(p[3])}, ${this.num(p[5])})`,
          kind: 'str',
        };
      case 'count_match_string':
        return { code: `(${this.str(p[0])}.split(${this.str(p[2])}).length - 1)`, kind: 'num' };
      case 'index_of_string':
        return { code: `(${this.str(p[1])}.indexOf(${this.str(p[3])}) + 1)`, kind: 'num' };
      case 'replace_string':
        return {
          code: `${this.str(p[1])}.split(${this.str(p[3])}).join(${this.str(p[5])})`,
          kind: 'str',
        };
      case 'change_string_case':
        return { code: `O.changeCase(${this.str(p[1])}, ${this.field(p[3])})`, kind: 'str' };
      case 'change_rgb_to_hex':
        return {
          code: `O.rgbToHex(${this.num(p[0])}, ${this.num(p[1])}, ${this.num(p[2])})`,
          kind: 'str',
        };
      case 'change_hex_to_rgb':
        return { code: `O.hexToRgb(${this.raw(p[0])}, ${this.field(p[1])})`, kind: 'num' };
      case 'get_boolean_value':
        return { code: `(${this.raw(p[0])} ? 'TRUE' : 'FALSE')`, kind: 'str' };
      case 'get_block_count':
        return { code: '0', kind: 'num', constant: 0 };

      // ----- judgement -----
      case 'is_clicked':
        return { code: 'O.isClicked()', kind: 'bool' };
      case 'is_object_clicked':
        return { code: 'O.isObjectClicked(e)', kind: 'bool' };
      case 'is_press_some_key':
        return { code: `O.isKeyPressed(${this.field(p[0])})`, kind: 'bool' };
      case 'reach_something':
        return { code: `O.touching(e, ${this.field(p[1])})`, kind: 'bool' };
      case 'is_type':
        return { code: `O.isType(${this.str(p[0])}, ${this.field(p[2])})`, kind: 'bool' };
      case 'boolean_basic_operator':
        return this.compare(block);
      case 'boolean_and_or':
        // Entry reads both sides before combining them, so neither is skipped.
        return {
          code:
            String(p[1] ?? 'AND') === 'AND'
              ? `C.andOf(${this.raw(p[0])}, ${this.raw(p[2])})`
              : `C.orOf(${this.raw(p[0])}, ${this.raw(p[2])})`,
          kind: 'bool',
        };
      case 'boolean_not':
        return { code: `(!${this.bool(p[1])})`, kind: 'bool' };
      case 'is_boost_mode':
        return { code: 'O.isBoostMode()', kind: 'bool' };
      case 'is_current_device_type':
        return { code: `O.isDeviceType(${this.field(p[0])})`, kind: 'bool' };
      case 'is_touch_supported':
        return { code: 'O.isTouchSupported()', kind: 'bool' };

      // ----- variables -----
      case 'get_variable':
        return { code: `O.getVariable(e, ${this.varRef(p[0])})`, kind: 'any' };
      case 'value_of_index_from_list':
        return { code: `O.listValue(e, ${this.varRef(p[1])}, ${this.raw(p[3])})`, kind: 'any' };
      case 'length_of_list':
        return { code: `O.listLength(e, ${this.varRef(p[1])})`, kind: 'num' };
      case 'is_included_in_list':
        return { code: `O.listIncludes(e, ${this.varRef(p[1])}, ${this.str(p[3])})`, kind: 'bool' };
      case 'get_canvas_input_value':
        return { code: 'O.answer()', kind: 'any' };
      case 'get_func_variable':
        return { code: `L[${this.funcVarKey(p[0])}]`, kind: 'any' };

      // ----- text boxes -----
      case 'text_read':
        return { code: `O.readText(e, ${this.field(p[0])})`, kind: 'str' };

      // ----- data tables -----
      case 'get_table_count':
        return { code: `O.tableCount(${this.tableRef(p[0])}, ${this.str(p[1])})`, kind: 'num' };
      case 'get_value_from_table':
        return {
          code: `O.tableValue(${this.tableRef(p[0])}, ${this.num(p[1])}, ${this.raw(p[2])})`,
          kind: 'any',
        };
      case 'get_value_from_last_row':
        return { code: `O.tableLastValue(${this.tableRef(p[0])}, ${this.raw(p[1])})`, kind: 'any' };
      case 'get_value_from_cell':
        return { code: `O.tableCellValue(${this.tableRef(p[0])}, ${this.raw(p[1])})`, kind: 'any' };
      case 'calc_values_from_table':
        return {
          code: `O.tableCalc(${this.tableRef(p[0])}, ${this.raw(p[1])}, ${this.field(p[2])})`,
          kind: 'num',
        };
      case 'get_coefficient':
        return {
          code: `O.tableCoefficient(${this.tableRef(p[0])}, ${this.raw(p[1])}, ${this.raw(p[2])})`,
          kind: 'num',
        };
      case 'get_value_v_lookup':
        return {
          code: `O.tableLookup(${this.tableRef(p[0])}, ${this.raw(p[1])}, ${this.raw(p[2])}, ${this.raw(p[3])})`,
          kind: 'any',
        };

      // ----- sound -----
      case 'get_sound_volume':
        return { code: 'O.volume()', kind: 'num' };
      case 'get_sound_speed':
        return { code: 'O.speed()', kind: 'num' };
      case 'get_sound_duration':
        return { code: `O.soundDuration(e, ${this.field(p[1])})`, kind: 'num' };

      default: {
        if (block.type.startsWith('func_')) {
          return { code: this.callFunction(block, '', true).code, kind: 'any' };
        }
        const slot = this.paramSlots?.get(block.type);
        if (slot !== undefined) {
          return { code: `P[${slot}]`, kind: 'any' };
        }
        if (RESERVED_PARAM.test(block.type)) {
          return NULL_VALUE;
        }
        this.note(block.type);
        return NULL_VALUE;
      }
    }
  }

  private calcBasic(block: RawBlock): Value {
    const operator = String(block.params[1] ?? 'PLUS');
    const left = block.params[0];
    const right = block.params[2];
    if (operator === 'PLUS') {
      return { code: `C.calcPlus(${this.raw(left)}, ${this.raw(right)})`, kind: 'any' };
    }
    const l = this.num(left);
    const r = this.num(right);
    switch (operator) {
      case 'MINUS':
        return { code: `C.subNum(${l}, ${r})`, kind: 'num' };
      case 'MULTI':
        return { code: `C.mulNum(${l}, ${r})`, kind: 'num' };
      default:
        return { code: `C.divNum(${l}, ${r})`, kind: 'num' };
    }
  }

  private compare(block: RawBlock): Value {
    const left = this.raw(block.params[0]);
    const right = this.raw(block.params[2]);
    const table: Record<string, string> = {
      EQUAL: 'cmpEqual',
      NOT_EQUAL: 'cmpNotEqual',
      GREATER: 'cmpGreater',
      LESS: 'cmpLess',
      GREATER_OR_EQUAL: 'cmpGreaterEqual',
      LESS_OR_EQUAL: 'cmpLessEqual',
    };
    const fn = table[String(block.params[1] ?? 'EQUAL')] ?? 'cmpEqual';
    return { code: `C.${fn}(${left}, ${right})`, kind: 'bool' };
  }

  private callFunction(block: RawBlock, ind: string, asValue: boolean): { code: string } {
    const id = block.type.slice('func_'.length);
    const index = this.funcIndex.get(id);
    if (index === undefined) {
      this.note(block.type);
      return { code: asValue ? 'undefined' : `${ind}/* missing ${block.type} */\n` };
    }
    const args = block.params
      .filter((param) => param !== null && param !== undefined)
      .map((param) => this.raw(param));
    const call = `(yield* F[${index}](e, th, [${args.join(', ')}]))`;
    return { code: asValue ? call : `${ind}${call};\n` };
  }

  private note(type: string): void {
    this.unknown.set(type, (this.unknown.get(type) ?? 0) + 1);
  }
}

function parseScript(script: string | RawBlock[][] | undefined): RawBlock[][] {
  if (!script) {
    return [];
  }
  if (typeof script === 'string') {
    if (!script.trim()) {
      return [];
    }
    try {
      return JSON.parse(script) as RawBlock[][];
    } catch {
      return [];
    }
  }
  return script;
}

/** The stack that actually defines a function; comment blocks can precede it. */
function findFunctionDefine(content: RawBlock[][]): RawBlock | null {
  for (const stack of content) {
    const first = stack[0];
    if (first && (first.type === 'function_create' || first.type === 'function_create_value')) {
      return first;
    }
  }
  return null;
}

/** Walks the label/param chain of a function head, in call order. */
function collectParams(field: unknown): string[] {
  const names: string[] = [];
  let node = field;
  while (isBlock(node)) {
    if (node.type === 'function_field_string' || node.type === 'function_field_boolean') {
      const slot = node.params[0];
      if (isBlock(slot)) {
        names.push(slot.type);
      }
      node = node.params[1];
    } else if (node.type === 'function_field_label') {
      node = node.params[1];
    } else {
      break;
    }
  }
  return names;
}

export { parseScript, findFunctionDefine, collectParams };
