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
/**
 * Text in a monitor is anchored on its middle, so these are the centre lines of
 * the boxes it sits in, not the top edges entry writes in `GL_VAR_POS`.
 */
const LABEL_Y = -2;
const VALUE_Y = -2;
const LIST_ROW_HEIGHT = 20;
/** The strip the title sits on; below it the rows begin. */
const LIST_TITLE_HEIGHT = 23;
/** The coloured strip inside one list row. */
const STRIP_TOP = 4;
const STRIP_HEIGHT = 17;
/** Where the scroll bar starts and how tall it is (`scrollButton_`). */
const LIST_BAR_TOP = LIST_TITLE_HEIGHT + 4;
const LIST_BAR_HEIGHT = 20;
/**
 * `Entry.SlideVariable` — a slide variable's box is 42 tall rather than 24, and
 * carries a grey run with a knob on it. `SLIDE_BAR` is where that run starts and
 * how thick it is, `SLIDE_KNOB` the knob entry draws from a 9x20 image at 0.8.
 */
const SLIDE_HEIGHT = 42;
const SLIDE_BAR_X = 6;
const SLIDE_BAR_Y = 16;
const SLIDE_BAR_HEIGHT = 5;
const SLIDE_BAR_RADIUS = 2;
const SLIDE_BAR_COLOR = '#d8d8d8';
const SLIDE_KNOB_WIDTH = 9 * 0.8;
const SLIDE_KNOB_HEIGHT = 20 * 0.8;
const SLIDE_KNOB_COLOR = '#1bafea';
const SLIDE_KNOB_BORDER = '#a0a1a1';
/** The narrowest a monitor box gets — `Math.max(width, 90)` in entry. */
const MONITOR_MIN_WIDTH = 90;
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

/** One numbered row of a list box. Kept and rewritten, never rebuilt. */
interface RowView {
  root: Container;
  index: Text;
  strip: Graphics;
  value: Text;
  /** What the row is showing now, so an unmoved one is left alone. */
  shown: string;
  stripWidth: number;
}

interface MonitorView {
  root: Container;
  frame: Graphics;
  label: Text;
  value: Text;
  /** List rows live here; a value monitor leaves it empty. */
  items: Container | null;
  rows: RowView[];
  /** The run and knob of a slide variable; null on every other kind. */
  slider: { bar: Graphics; knob: Graphics } | null;
  /** How far the knob may travel — `Entry.SlideVariable.maxWidth`. */
  slideRun: number;
  /** What the box is showing now — a monitor that did not move is not redrawn. */
  shown: string;
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

  /**
   * Drops what the overlay holds for an entity that is gone. A clone's bubble
   * outlives the clone otherwise: nothing owns it, so it stays on the stage
   * through a stop and the next run.
   */
  forget(entity: Entity): void {
    const view = this.dialogs.get(entity);
    if (!view) {
      return;
    }
    view.root.destroy({ children: true });
    this.dialogs.delete(entity);
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
      // `new Entry.Dialog` throws the old bubble away and loads the new one, so
      // saying anything at all — the same words included — puts that bubble in
      // front of every other one.
      this.raise(existing.root);
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

  /** Moves one bubble to the front of the others. */
  private raise(root: Container): void {
    const last = this.dialogLayer.children.length - 1;
    if (last > 0 && this.dialogLayer.getChildIndex(root) !== last) {
      this.dialogLayer.setChildIndex(root, last);
    }
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
    const text = new Text({
      text: '',
      style: { fontFamily: MONITOR_FAMILY, fontSize: size, fill },
      resolution: 2,
    });
    // Centred on the line it is given: the font's own ascent and descent then
    // cannot leave the letters sitting low in their box.
    text.anchor.set(0, 0.5);
    return text;
  }

  private makeMonitor(): MonitorView {
    const root = new Container();
    const frame = new Graphics();
    const label = Overlay.text(MONITOR_FONT, '#000000');
    const value = Overlay.text(MONITOR_VALUE_FONT, '#ffffff');
    root.addChild(frame, label, value);
    this.monitorLayer.addChild(root);
    return { root, frame, label, value, items: null, rows: [], slider: null, slideRun: 0, shown: '' };
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
    view.root.position.set(x, y);
    // Every monitor is drawn on every frame, and rebuilding a box that has not
    // changed costs a text measurement and a fresh geometry each time.
    const shown = `${name}\u0000${text}\u0000${color}`;
    if (view.shown === shown) {
      return;
    }
    view.shown = shown;
    view.label.text = name;
    view.value.text = text;
    const nameWidth = view.label.width;
    const valueWidth = view.value.width;
    view.frame
      .clear()
      .roundRect(0, -14, Math.max(nameWidth + valueWidth + 35, MONITOR_MIN_WIDTH), 24, 4)
      .fill({ color: MONITOR_BG })
      .stroke({ width: 1, color: MONITOR_BORDER })
      .roundRect(nameWidth + 14, -10, valueWidth + 15, 16, MONITOR_RADIUS)
      .fill({ color })
      .stroke({ width: 1, color });
    view.label.position.set(4, LABEL_Y);
    view.value.position.set(nameWidth + 21, VALUE_Y);
  }

  /**
   * `Entry.SlideVariable.updateView` — the same pill on a box 42 tall, with a
   * grey run under it and a knob sitting where the value falls between the
   * variable's own smallest and largest.
   */
  private drawSlideMonitor(
    view: MonitorView,
    variable: Variable,
    at: { x: number; y: number },
  ): void {
    view.root.position.set(at.x, at.y);
    const text = Overlay.formatValue(variable.value);
    const shown = `slide\u0000${variable.name}\u0000${text}\u0000${variable.minValue}\u0000${variable.maxValue}`;
    if (!view.slider) {
      const bar = new Graphics();
      const knob = new Graphics();
      view.root.addChild(bar, knob);
      view.slider = { bar, knob };
    }
    // The knob moves with the value even when nothing else about the box did.
    view.slideRun = Overlay.slideRun(view);
    view.slider.knob.position.set(Overlay.slideKnobX(variable, view.slideRun), 9);
    if (view.shown === shown) {
      return;
    }
    view.shown = shown;
    view.label.text = variable.name;
    view.value.text = text;
    const nameWidth = view.label.width;
    const valueWidth = view.value.width;
    view.frame
      .clear()
      .roundRect(0, -14, Math.max(nameWidth + valueWidth + 35, MONITOR_MIN_WIDTH), SLIDE_HEIGHT, 4)
      .fill({ color: MONITOR_BG })
      .stroke({ width: 1, color: MONITOR_BORDER })
      .roundRect(nameWidth + 14, -10, valueWidth + 15, 16, MONITOR_RADIUS)
      .fill({ color: MONITOR_VARIABLE })
      .stroke({ width: 1, color: MONITOR_VARIABLE });
    view.label.position.set(4, LABEL_Y);
    view.value.position.set(nameWidth + 21, VALUE_Y);
    const run = Overlay.slideRun(view);
    view.slideRun = run;
    view.slider.bar
      .clear()
      .roundRect(SLIDE_BAR_X, SLIDE_BAR_Y, run + 4, SLIDE_BAR_HEIGHT, SLIDE_BAR_RADIUS)
      .fill({ color: SLIDE_BAR_COLOR });
    // Entry draws the knob from a 9x20 image; a rounded bar of that size is the
    // same shape without an asset to fetch.
    view.slider.knob
      .clear()
      .roundRect(-SLIDE_KNOB_WIDTH / 2, 0, SLIDE_KNOB_WIDTH, SLIDE_KNOB_HEIGHT, 2)
      .fill({ color: SLIDE_KNOB_COLOR })
      .stroke({ width: 1, color: SLIDE_KNOB_BORDER });
    view.slider.knob.position.set(Overlay.slideKnobX(variable, run), 9);
  }

  /** `maxWidth` — how far the knob travels, from the name and value widths. */
  private static slideRun(view: MonitorView): number {
    return Math.max(view.label.width + view.value.width + 26, MONITOR_MIN_WIDTH) - 16;
  }

  /** `getSlidePosition` — where the knob sits for the value the variable holds. */
  private static slideKnobX(variable: Variable, run: number): number {
    const span = Math.abs(variable.maxValue - variable.minValue);
    const ratio = span === 0 ? 0 : Math.abs(Number(variable.value) - variable.minValue) / span;
    return run * ratio + SLIDE_BAR_X;
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
    view.root.position.set(at.x, at.y);

    const visible = Math.floor((height - 15) / LIST_ROW_HEIGHT);
    const overflow = visible < rows.length;
    const first = Math.max(0, Math.min(this.scrollOf(variable), rows.length - visible));
    const stripWidth = width - 2 * MONITOR_INSET - (overflow ? 30 : 20) - 6 + 14;
    const run = this.barRun(variable);

    // The frame is geometry, so it is rebuilt only when its shape moved.
    const shown = `${variable.name}\u0000${width}\u0000${height}\u0000${first}\u0000${run ? run.room : -1}`;
    if (view.shown !== shown) {
      view.shown = shown;
      view.value.text = '';
      view.frame
        .clear()
        .roundRect(0, 0, width + 7, height + 22, MONITOR_RADIUS)
        .fill({ color: MONITOR_BG })
        .stroke({ width: 1, color: MONITOR_BORDER });
      if (run) {
        view.frame
          .roundRect(width - 9, run.top + (run.span * first) / run.room, 6, LIST_BAR_HEIGHT, 3)
          .fill({ color: MONITOR_BORDER });
      }
      view.label.style.fill = '#000000';
      view.label.text = variable.name;
      view.label.position.set((width - view.label.width) / 2 + 3, LIST_TITLE_HEIGHT / 2);
    }

    if (!view.items) {
      view.items = new Container();
      view.root.addChild(view.items);
    }
    const seats = Math.max(0, Math.min(visible, rows.length - first));
    for (let seat = 0; seat < seats; seat += 1) {
      this.drawRow(view, seat, first + seat, String(rows[first + seat]!.data ?? ''), stripWidth);
    }
    // Rows the list outgrew stay built and go out of sight; a list that grows
    // again wants them back.
    for (let seat = seats; seat < view.rows.length; seat += 1) {
      view.rows[seat]!.root.visible = false;
    }
  }

  /**
   * One row of a list box, built the first time that seat is used and rewritten
   * after that. Building a `Text` measures the string and bakes a texture, and
   * every monitor is drawn on every frame — a list that rebuilt its rows each
   * time would do that work sixty times a second for nothing.
   */
  private drawRow(
    view: MonitorView,
    seat: number,
    at: number,
    text: string,
    stripWidth: number,
  ): void {
    let row = view.rows[seat];
    if (!row) {
      // Both texts sit on the middle of the coloured strip the row is drawn on.
      const middle = STRIP_TOP + STRIP_HEIGHT / 2;
      const root = new Container();
      const index = Overlay.text(MONITOR_FONT, '#000000');
      index.position.set(0, middle);
      const strip = new Graphics();
      const value = Overlay.text(MONITOR_VALUE_FONT, '#ffffff');
      value.position.set(24, middle);
      root.addChild(index, strip, value);
      view.items!.addChild(root);
      row = { root, index, strip, value, shown: '\u0000', stripWidth: -1 };
      view.rows[seat] = row;
    }
    row.root.visible = true;
    row.root.position.set(MONITOR_INSET, seat * LIST_ROW_HEIGHT + LIST_TITLE_HEIGHT);
    if (row.stripWidth !== stripWidth) {
      row.stripWidth = stripWidth;
      row.strip
        .clear()
        .roundRect(18, STRIP_TOP, stripWidth, STRIP_HEIGHT, 2)
        .fill({ color: MONITOR_VARIABLE });
      row.shown = '\u0000';
    }
    const shown = `${at}\u0000${text}`;
    if (row.shown === shown) {
      return;
    }
    row.shown = shown;
    row.index.text = String(at + 1);
    row.value.text = Overlay.fitText(row.value, text, stripWidth - 12);
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
   * The slide variable under a stage point, if there is one — the overlay's own
   * space again, y counting downwards. Entry hands the run and the knob to its
   * drag helper; pointers come through one path here, so the hit test lives
   * beside the drawing and the dragging is done where that path is.
   */
  sliderAt(x: number, y: number): Variable | null {
    for (const [variable, view] of this.monitors) {
      if (!variable.isSlide || !variable.visible || !view.root.visible || !view.slider) {
        continue;
      }
      const width = Math.max(view.label.width + view.value.width + 35, MONITOR_MIN_WIDTH);
      const left = view.root.x;
      const top = view.root.y - 14;
      if (x < left || x > left + width || y < top || y > top + SLIDE_HEIGHT) {
        continue;
      }
      // The pill above the run keeps working as a box to look at, not to drag.
      if (y - view.root.y < SLIDE_BAR_Y - 6) {
        continue;
      }
      return variable;
    }
    return null;
  }

  /**
   * `setSlideCommandX` then `updateSlideValueByView` — the knob is put where the
   * pointer is along the run, and the value follows from how far along it
   * landed. `x` is a stage x; the knob travels from 10 to `maxWidth + 10` inside
   * the box, which is where entry reads the ratio from.
   */
  dragSlider(variable: Variable, x: number): void {
    const view = this.monitors.get(variable);
    if (!view || !view.slider) {
      return;
    }
    const run = view.slideRun || Overlay.slideRun(view);
    const command = Math.min(run + 10, Math.max(10, x - view.root.x));
    const ratio = run === 0 ? 0 : Math.min(1, Math.max(0, (command - 10) / run));
    const min = Number(variable.minValue);
    const max = Number(variable.maxValue);
    let value = parseFloat((min + Math.abs(max - min) * ratio).toFixed(2));
    value = Math.min(Math.max(value, min), max);
    // Entry only keeps the decimals when the ends themselves have some.
    if (Number.isInteger(min) && Number.isInteger(max)) {
      value = Math.round(value);
    }
    variable.setValue(value);
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
    const lastStripBottom =
      (visible - 1) * LIST_ROW_HEIGHT + LIST_TITLE_HEIGHT + STRIP_TOP + STRIP_HEIGHT;
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
      } else if (variable.isSlide) {
        this.drawSlideMonitor(view, variable, at);
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
    // `generateView` counts value boxes and list boxes apart, and stacks each
    // kind down a column before starting the next one. The index is the box's
    // own place among its kind — reading it off the whole list instead put a
    // work's later boxes below the stage, where nothing could be seen.
    const family = this.variables.filter((item) => item.isList === variable.isList);
    const index = Math.max(0, family.indexOf(variable));
    if (variable.isList) {
      return {
        x: -Math.floor((index % 24) / 6) * 110 + 120,
        y: index * 24 + 20 - 135 - Math.floor(index / 6) * 145,
      };
    }
    const column = Math.floor(index / 11);
    return { x: 10 - 240 + column * 80, y: index * 24 + 20 - 135 - column * 264 };
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
