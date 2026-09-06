/**
 * @fileoverview 무대 위에 얹히는 것들 — 말풍선, 변수·리스트 상자, 초시계, 대답 —
 * 을 그립니다. 위치와 크기는 엔트리(`Entry.Dialog`, `Entry.Variable.generateView`)가
 * 쓰는 값을 그대로 따릅니다.
 */
import { Container, Graphics, Text } from 'pixi.js';
import { entityBounds, type Rect } from '../collision/detect.ts';
import { stage, type Entity, type Variable } from '../runtime/model.ts';

const DIALOG_PADDING = 10;
const DIALOG_FONT = 15;
const DIALOG_BORDER = '#4f80ff';
const DIALOG_BG = '#ffffff';
/** `_adjustSingleViewBox` — entry gives each kind of monitor its own value box. */
const MONITOR_VARIABLE = '#4f80ff';
const MONITOR_ANSWER = '#F57DF1';
const MONITOR_TIMER = '#f4af18';
const MONITOR_FAMILY = 'Nanum Gothic, sans-serif';
const MONITOR_BORDER = '#aac5d5';
const MONITOR_BG = '#ffffff';
/** `Entry.Variable` — `FONT` is `10pt`, `VALUE_FONT` is `9pt`; a point is 4/3 px. */
const MONITOR_FONT = 40 / 3;
const MONITOR_VALUE_FONT = 12;
/** `BORDER` and `RECT_RADIUS` on `Entry.Variable`. */
const MONITOR_INSET = 6;
const MONITOR_RADIUS = 7;
/** `GL_VAR_POS` · `GL_LIST_POS` — in the webgl path these are the text's top. */
const LABEL_Y = -9.5;
const VALUE_Y = -8.5;
const LIST_INDEX_Y = 5;
const LIST_VALUE_Y = 6;
const LIST_ROW_HEIGHT = 20;
/** The strip the title sits on; below it the rows begin. */
const LIST_TITLE_HEIGHT = 23;
/** Where the scroll bar starts and how tall it is (`scrollButton_`). */
const LIST_BAR_TOP = LIST_TITLE_HEIGHT + 4;
const LIST_BAR_HEIGHT = 20;
/** Where entry puts the built-in monitors when the work does not say. */
const ANSWER_HOME = { x: 150, y: -100 };
const TIMER_HOME = { x: 134, y: -70 };

interface DialogView {
  root: Container;
  frame: Graphics;
  notch: Graphics;
  text: Text;
  message: string;
  mode: string;
}

interface MonitorView {
  root: Container;
  frame: Graphics;
  label: Text;
  value: Text;
  /** List rows live here; a value monitor leaves it empty. */
  items: Container | null;
}

/** Entity bounds converted back to entry stage units, as `Entry.Dialog` expects. */
function stageBounds(entity: Entity): Rect {
  const rect: Rect = { x: 0, y: 0, width: 0, height: 0 };
  entityBounds(entity, rect);
  return {
    x: (rect.x - stage.worldWidth / 2) / stage.scale,
    y: (rect.y - stage.worldHeight / 2) / stage.scale,
    width: rect.width / stage.scale,
    height: rect.height / stage.scale,
  };
}

export class Overlay {
  private readonly root = new Container();
  private readonly dialogLayer = new Container();
  private readonly monitorLayer = new Container();
  private readonly dialogs = new Map<Entity, DialogView>();
  private readonly monitors = new Map<Variable, MonitorView>();
  private variables: Variable[] = [];
  /** First row shown in a list box, moved by dragging the rows or the bar. */
  private readonly scrolled = new Map<Variable, number>();
  private answerMonitor: MonitorView | null = null;
  private timerMonitor: MonitorView | null = null;
  private answerValue: () => string | number = () => '';
  private answerShown: () => boolean = () => false;
  private timerValue: () => number = () => 0;
  private timerShown: () => boolean = () => false;
  private currentScene: () => string = () => '';

  constructor(parent: Container) {
    this.root.addChild(this.monitorLayer, this.dialogLayer);
    parent.addChild(this.root);
    this.applyStageSize();
  }

  /** Keeps the overlay in the same space the world container uses. */
  applyStageSize(): void {
    this.root.position.set(stage.worldWidth / 2, stage.worldHeight / 2);
    this.root.scale.set(stage.scale);
  }

  bind(options: {
    variables: Variable[];
    answer: () => string | number;
    answerVisible: () => boolean;
    timer: () => number;
    timerVisible: () => boolean;
    scene: () => string;
  }): void {
    this.variables = options.variables;
    this.answerValue = options.answer;
    this.answerShown = options.answerVisible;
    this.timerValue = options.timer;
    this.timerShown = options.timerVisible;
    this.currentScene = options.scene;
  }

  clear(): void {
    this.scrolled.clear();
    for (const view of this.dialogs.values()) {
      view.root.destroy({ children: true });
    }
    this.dialogs.clear();
    for (const view of this.monitors.values()) {
      view.root.destroy({ children: true });
    }
    this.monitors.clear();
    this.answerMonitor?.root.destroy({ children: true });
    this.answerMonitor = null;
    this.timerMonitor?.root.destroy({ children: true });
    this.timerMonitor = null;
  }

  // -------------------------------------------------------------------------
  //  Dialogs
  // -------------------------------------------------------------------------
  setDialog(entity: Entity): void {
    const state = entity.dialog;
    const existing = this.dialogs.get(entity);
    if (!state) {
      if (existing) {
        existing.root.destroy({ children: true });
        this.dialogs.delete(entity);
      }
      return;
    }
    if (existing) {
      if (existing.message !== state.message || existing.mode !== state.mode) {
        existing.message = state.message;
        existing.mode = state.mode;
        existing.text.text = state.message;
        this.drawDialog(existing);
      }
      return;
    }
    const root = new Container();
    const frame = new Graphics();
    const notch = new Graphics();
    const text = new Text({
      text: state.message,
      style: { fontFamily: MONITOR_FAMILY, fontSize: DIALOG_FONT, fill: '#000000' },
      resolution: 2,
    });
    root.addChild(frame, notch, text);
    this.dialogLayer.addChild(root);
    const view: DialogView = { root, frame, notch, text, message: state.message, mode: state.mode };
    this.dialogs.set(entity, view);
    this.drawDialog(view);
  }

  private drawDialog(view: DialogView): void {
    const width = Math.max(view.text.width, 17);
    const height = view.text.height;
    view.frame
      .clear()
      .roundRect(
        -DIALOG_PADDING,
        -DIALOG_PADDING,
        width + DIALOG_PADDING * 2,
        height + DIALOG_PADDING * 2,
        DIALOG_PADDING,
      )
      .fill({ color: DIALOG_BG })
      .stroke({ width: 2, color: DIALOG_BORDER });
    view.root.pivot.set(width / 2, height / 2);
  }

  private placeDialog(entity: Entity, view: DialogView): void {
    const bound = stageBounds(entity);
    const width = Math.max(view.text.width, 17);
    const height = view.text.height;
    const north = bound.y - 20 - 2 > -stage.halfHeight;
    const east = bound.x + bound.width / 2 < 0;
    view.root.y = north
      ? Math.max(bound.y - height / 2 - 20 - DIALOG_PADDING, -stage.halfHeight + height / 2 + DIALOG_PADDING)
      : Math.min(
          bound.y + bound.height + height / 2 + 20 + DIALOG_PADDING,
          stage.halfHeight - height / 2 - DIALOG_PADDING,
        );
    view.root.x = east
      ? Math.min(bound.x + bound.width + width / 2, stage.halfWidth - width / 2 - DIALOG_PADDING)
      : Math.max(bound.x - width / 2, -stage.halfWidth + width / 2 + DIALOG_PADDING);
    // A dialog belongs to its object's scene, so it leaves with the scene.
    view.root.visible = entity.visible && entity.target.sceneId === this.currentScene();
    this.drawNotch(view, north ? 'n' : 's', east ? 'e' : 'w', width, height);
  }

  private drawNotch(
    view: DialogView,
    vertical: 'n' | 's',
    horizontal: 'e' | 'w',
    width: number,
    height: number,
  ): void {
    const notch = view.notch;
    notch.clear();
    const baseY = vertical === 'n' ? height + DIALOG_PADDING : -DIALOG_PADDING;
    const tipY = vertical === 'n' ? baseY + 9 : baseY - 9;
    const anchorX = horizontal === 'e' ? 2 : width - 2;
    const innerX = horizontal === 'e' ? 12 : width - 12;
    if (view.mode === 'think') {
      notch
        .circle(anchorX + (horizontal === 'e' ? 2 : -2), baseY + (vertical === 'n' ? 5 : -5), 4)
        .fill({ color: DIALOG_BG })
        .stroke({ width: 2, color: DIALOG_BORDER });
      notch
        .circle(anchorX + (horizontal === 'e' ? 8 : -8), baseY + (vertical === 'n' ? 12 : -12), 2.5)
        .fill({ color: DIALOG_BG })
        .stroke({ width: 2, color: DIALOG_BORDER });
      return;
    }
    notch
      .moveTo(anchorX, baseY)
      .lineTo(anchorX, tipY)
      .lineTo(innerX, baseY)
      .fill({ color: DIALOG_BG })
      .stroke({ width: 2, color: DIALOG_BORDER });
  }

  // -------------------------------------------------------------------------
  //  Monitors
  // -------------------------------------------------------------------------
  private static text(size: number, fill: string): Text {
    return new Text({
      text: '',
      style: { fontFamily: MONITOR_FAMILY, fontSize: size, fill },
      resolution: 2,
    });
  }

  private makeMonitor(): MonitorView {
    const root = new Container();
    const frame = new Graphics();
    const label = Overlay.text(MONITOR_FONT, '#000000');
    const value = Overlay.text(MONITOR_VALUE_FONT, '#ffffff');
    root.addChild(frame, label, value);
    this.monitorLayer.addChild(root);
    return { root, frame, label, value, items: null };
  }

  /**
   * `Entry.Variable._adjustSingleViewBox` — a white pill with the name on it and
   * a coloured box holding the value, 24 units tall, hanging 14 above the point
   * the work stores as the variable's position.
   */
  private drawValueMonitor(
    view: MonitorView,
    name: string,
    text: string,
    x: number,
    y: number,
    color: string,
  ): void {
    view.label.text = name;
    view.value.text = text;
    const nameWidth = view.label.width;
    const valueWidth = view.value.width;
    view.frame
      .clear()
      .roundRect(0, -14, nameWidth + valueWidth + 35, 24, 4)
      .fill({ color: MONITOR_BG })
      .stroke({ width: 1, color: MONITOR_BORDER })
      .roundRect(nameWidth + 14, -10, valueWidth + 15, 16, MONITOR_RADIUS)
      .fill({ color })
      .stroke({ width: 1, color });
    view.label.position.set(4, LABEL_Y);
    view.value.position.set(nameWidth + 21, VALUE_Y);
    view.root.position.set(x, y);
  }

  /**
   * `Entry.ListVariable.updateView` — a titled box of numbered rows, each 20 tall
   * with the value on a coloured strip. The box is `width + 7` by `height + 22`,
   * so the size the work stores is the room the rows get, not the whole frame.
   */
  private drawListMonitor(
    view: MonitorView,
    variable: Variable,
    at: { x: number; y: number },
  ): void {
    const width = variable.width || 100;
    const height = variable.height || 120;
    const rows = variable.array;
    view.value.text = '';
    view.frame
      .clear()
      .roundRect(0, 0, width + 7, height + 22, MONITOR_RADIUS)
      .fill({ color: MONITOR_BG })
      .stroke({ width: 1, color: MONITOR_BORDER });

    view.label.style.fill = '#000000';
    view.label.text = variable.name;
    view.label.position.set((width - view.label.width) / 2 + 3, MONITOR_INSET - 1);

    if (!view.items) {
      view.items = new Container();
      view.root.addChild(view.items);
    }
    const items = view.items;
    items.removeChildren().forEach((child) => child.destroy({ children: true }));

    const visible = Math.floor((height - 15) / LIST_ROW_HEIGHT);
    const overflow = visible < rows.length;
    const first = Math.max(0, Math.min(this.scrollOf(variable), rows.length - visible));
    const stripWidth = width - 2 * MONITOR_INSET - (overflow ? 30 : 20) - 6 + 14;
    for (let seat = 0; seat < visible && first + seat < rows.length; seat += 1) {
      const at = first + seat;
      const row = new Container();
      row.position.set(MONITOR_INSET, seat * LIST_ROW_HEIGHT + LIST_TITLE_HEIGHT);
      const index = Overlay.text(MONITOR_FONT, '#000000');
      index.text = String(at + 1);
      index.position.set(0, LIST_INDEX_Y);
      const strip = new Graphics()
        .roundRect(18, 4, stripWidth, 17, 2)
        .fill({ color: MONITOR_VARIABLE });
      const value = Overlay.text(MONITOR_VALUE_FONT, '#ffffff');
      value.text = Overlay.fitText(value, String(rows[at]!.data ?? ''), stripWidth - 12);
      value.position.set(24, LIST_VALUE_Y);
      row.addChild(index, strip, value);
      items.addChild(row);
    }
    const run = this.barRun(variable);
    if (run) {
      view.frame
        .roundRect(width - 9, run.top + (run.span * first) / run.room, 6, LIST_BAR_HEIGHT, 3)
        .fill({ color: MONITOR_BORDER });
    }
    view.root.position.set(at.x, at.y);
  }

  /** First row shown; `Entry.ListVariable` calls this its scroll position. */
  scrollOf(variable: Variable): number {
    return this.scrolled.get(variable) ?? 0;
  }

  scrollTo(variable: Variable, row: number): void {
    const visible = Math.floor(((variable.height || 120) - 15) / LIST_ROW_HEIGHT);
    const last = Math.max(0, variable.array.length - visible);
    this.scrolled.set(variable, Math.max(0, Math.min(last, Math.round(row))));
  }

  /**
   * The list box under a stage point, if there is one — in the overlay's own
   * space, where y counts downwards. `Entry.Variable` hands its view to a drag
   * helper; here pointers come through one path, so the hit test lives here and
   * the dragging is done where that path is.
   *
   * The rows and the bar beside them both scroll; the title strip does not.
   */
  listAt(x: number, y: number): { variable: Variable; rowsPerPixel: number } | null {
    for (const [variable, view] of this.monitors) {
      if (!variable.isList || !variable.visible || !view.root.visible) {
        continue;
      }
      const boxWidth = (variable.width || 100) + 7;
      const boxHeight = (variable.height || 120) + 22;
      const left = view.root.x;
      const top = view.root.y;
      const inside = x >= left && x <= left + boxWidth && y >= top && y <= top + boxHeight;
      if (!inside || y - top < LIST_TITLE_HEIGHT) {
        continue;
      }
      const run = this.barRun(variable);
      // On the bar the list follows the run; on the rows it follows the finger.
      const onBar = run !== null && x - left >= (variable.width || 100) - 12;
      return {
        variable,
        rowsPerPixel: onBar && run ? run.room / run.span : 1 / LIST_ROW_HEIGHT,
      };
    }
    return null;
  }

  /**
   * The run the scroll bar travels, from just under the title to the bottom of
   * the box. One place, so the bar the eye sees and the bar the pointer grabs
   * cannot drift apart — at the last row it has to sit at the end of the run.
   */
  private barRun(variable: Variable): { top: number; span: number; room: number } | null {
    const height = variable.height || 120;
    const visible = Math.floor((height - 15) / LIST_ROW_HEIGHT);
    const room = variable.array.length - visible;
    if (room <= 0) {
      return null;
    }
    // The bar runs beside the rows, not beside the box: at the first row it lines
    // up with the first strip, at the last row with the last one.
    const lastStripBottom = (visible - 1) * LIST_ROW_HEIGHT + LIST_TITLE_HEIGHT + 21;
    const bottom = lastStripBottom - LIST_BAR_HEIGHT;
    return { top: LIST_BAR_TOP, span: Math.max(1, bottom - LIST_BAR_TOP), room };
  }

  /** `updateView` shortens a row that does not fit and marks it with `..`. */
  private static fitText(view: Text, text: string, room: number): string {
    view.text = text;
    if (view.width <= room) {
      return text;
    }
    let cut = text;
    while (cut.length > 1 && view.width > room) {
      cut = `${cut.slice(0, -3)}..`;
      view.text = cut;
    }
    return cut;
  }

  /** `Entry.Variable.updateView` — integers show raw, decimals get two places. */
  private static formatValue(value: string | number): string {
    const text = String(value);
    if (text !== '' && !isNaN(Number(text))) {
      if (text[0] !== '0' && Number.isInteger(Number(text))) {
        return text;
      }
      return Number(text).toFixed(2).replace('.00', '');
    }
    return text;
  }

  flush(): void {
    for (const [entity, view] of this.dialogs) {
      this.placeDialog(entity, view);
    }
    for (const variable of this.variables) {
      if (variable.kind === 'answer' || variable.kind === 'timer') {
        // Both have a built-in monitor of their own.
        continue;
      }
      let view = this.monitors.get(variable);
      if (!variable.visible) {
        if (view) {
          view.root.visible = false;
        }
        continue;
      }
      if (!view) {
        view = this.makeMonitor();
        this.monitors.set(variable, view);
      }
      view.root.visible = true;
      const at = this.homeOf(variable);
      if (variable.isList) {
        this.drawListMonitor(view, variable, at);
      } else {
        this.drawValueMonitor(
          view,
          variable.name,
          Overlay.formatValue(variable.value),
          at.x,
          at.y,
          MONITOR_VARIABLE,
        );
      }
    }
    this.flushBuiltin();
  }

  /**
   * `Variable.generateView` — a work usually stores where its box sits, and
   * entry only lays one out itself when both numbers are missing. Zero counts as
   * missing there, so it does here too.
   */
  private homeOf(variable: Variable): { x: number; y: number } {
    if (variable.x && variable.y) {
      return { x: variable.x, y: variable.y };
    }
    const index = this.variables.indexOf(variable);
    const count = this.variables.length;
    return {
      x: 10 - 240 + Math.floor((count % 66) / 11) * 80,
      y: index * 28 + 20 - 135 - Math.floor(count / 11) * 264,
    };
  }

  /**
   * The answer and the timer are variables too — the work stores where their
   * boxes sit, and entry falls back to a place of its own for each.
   */
  private flushBuiltin(): void {
    const answer = this.variables.find((variable) => variable.kind === 'answer');
    const timer = this.variables.find((variable) => variable.kind === 'timer');
    if (this.answerShown()) {
      if (!this.answerMonitor) {
        this.answerMonitor = this.makeMonitor();
      }
      this.answerMonitor.root.visible = true;
      const at = Overlay.builtinHome(answer, ANSWER_HOME);
      this.drawValueMonitor(
        this.answerMonitor,
        '대답',
        String(this.answerValue()),
        at.x,
        at.y,
        MONITOR_ANSWER,
      );
    } else if (this.answerMonitor) {
      this.answerMonitor.root.visible = false;
    }
    if (this.timerShown()) {
      if (!this.timerMonitor) {
        this.timerMonitor = this.makeMonitor();
      }
      this.timerMonitor.root.visible = true;
      const at = Overlay.builtinHome(timer, TIMER_HOME);
      this.drawValueMonitor(
        this.timerMonitor,
        timer?.name || '초시계',
        this.timerValue().toFixed(1),
        at.x,
        at.y,
        MONITOR_TIMER,
      );
    } else if (this.timerMonitor) {
      this.timerMonitor.root.visible = false;
    }
  }

  private static builtinHome(
    variable: Variable | undefined,
    home: { x: number; y: number },
  ): { x: number; y: number } {
    return variable?.x && variable.y ? { x: variable.x, y: variable.y } : home;
  }
}
