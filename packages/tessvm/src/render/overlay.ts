/**
 * @fileoverview 무대 위에 얹히는 것들 — 말풍선, 변수·리스트 상자, 초시계, 대답 —
 * 을 그립니다. 위치와 크기는 엔트리(`Entry.Dialog`, `Entry.Variable.generateView`)가
 * 쓰는 값을 그대로 따릅니다.
 */
import { Container, Graphics, Text } from 'pixi.js';
import { entityBounds, type Rect } from '../collision/detect.ts';
import { WORLD_SCALE, type Entity, type Variable } from '../runtime/model.ts';

const DIALOG_PADDING = 10;
const DIALOG_FONT = 15;
const DIALOG_BORDER = '#4f80ff';
const DIALOG_BG = '#ffffff';
const MONITOR_BLUE = '#4f80ff';
const MONITOR_FONT = 10;
const MONITOR_HEIGHT = 20;

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
  items: Container | null;
}

/** Entity bounds converted back to entry stage units, as `Entry.Dialog` expects. */
function stageBounds(entity: Entity): Rect {
  const rect: Rect = { x: 0, y: 0, width: 0, height: 0 };
  entityBounds(entity, rect);
  return {
    x: (rect.x - 320) / WORLD_SCALE,
    y: (rect.y - 180) / WORLD_SCALE,
    width: rect.width / WORLD_SCALE,
    height: rect.height / WORLD_SCALE,
  };
}

export class Overlay {
  private readonly root = new Container();
  private readonly dialogLayer = new Container();
  private readonly monitorLayer = new Container();
  private readonly dialogs = new Map<Entity, DialogView>();
  private readonly monitors = new Map<Variable, MonitorView>();
  private variables: Variable[] = [];
  private answerMonitor: MonitorView | null = null;
  private timerMonitor: MonitorView | null = null;
  private answerValue: () => string | number = () => '';
  private answerShown: () => boolean = () => false;
  private timerValue: () => number = () => 0;
  private timerShown: () => boolean = () => false;
  private currentScene: () => string = () => '';

  constructor(stage: Container) {
    // The overlay lives in the same 640×360 space the world does.
    this.root.position.set(320, 180);
    this.root.scale.set(WORLD_SCALE);
    this.root.addChild(this.monitorLayer, this.dialogLayer);
    stage.addChild(this.root);
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
      style: { fontFamily: 'Nanum Gothic, sans-serif', fontSize: DIALOG_FONT, fill: '#000000' },
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
    const north = bound.y - 20 - 2 > -135;
    const east = bound.x + bound.width / 2 < 0;
    view.root.y = north
      ? Math.max(bound.y - height / 2 - 20 - DIALOG_PADDING, -135 + height / 2 + DIALOG_PADDING)
      : Math.min(bound.y + bound.height + height / 2 + 20 + DIALOG_PADDING, 135 - height / 2 - DIALOG_PADDING);
    view.root.x = east
      ? Math.min(bound.x + bound.width + width / 2, 240 - width / 2 - DIALOG_PADDING)
      : Math.max(bound.x - width / 2, -240 + width / 2 + DIALOG_PADDING);
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
  private makeMonitor(): MonitorView {
    const root = new Container();
    const frame = new Graphics();
    const label = new Text({
      text: '',
      style: { fontFamily: 'Nanum Gothic, sans-serif', fontSize: MONITOR_FONT, fill: '#000000' },
      resolution: 2,
    });
    const value = new Text({
      text: '',
      style: { fontFamily: 'Nanum Gothic, sans-serif', fontSize: MONITOR_FONT, fill: '#ffffff' },
      resolution: 2,
    });
    label.position.set(4, 4);
    root.addChild(frame, label, value);
    this.monitorLayer.addChild(root);
    return { root, frame, label, value, items: null };
  }

  private drawValueMonitor(view: MonitorView, name: string, text: string, x: number, y: number): void {
    view.label.text = name;
    view.value.text = text;
    const labelWidth = view.label.width;
    const valueWidth = Math.max(view.value.width + 10, 24);
    const width = labelWidth + valueWidth + 12;
    view.frame
      .clear()
      .roundRect(0, 0, width, MONITOR_HEIGHT, 4)
      .fill({ color: '#ffffff' })
      .stroke({ width: 1, color: '#a0a0a0' })
      .roundRect(labelWidth + 8, 3, valueWidth, MONITOR_HEIGHT - 6, 4)
      .fill({ color: MONITOR_BLUE });
    view.value.position.set(labelWidth + 8 + (valueWidth - view.value.width) / 2, 4);
    view.root.position.set(x, y);
  }

  private drawListMonitor(view: MonitorView, variable: Variable): void {
    const width = variable.width || 100;
    const height = variable.height || 120;
    view.label.text = variable.name;
    view.value.text = '';
    view.frame
      .clear()
      .roundRect(0, 0, width, height, 4)
      .fill({ color: '#ffffff' })
      .stroke({ width: 1, color: '#a0a0a0' })
      .rect(0, 0, width, 18)
      .fill({ color: MONITOR_BLUE });
    view.label.style.fill = '#ffffff';
    view.label.position.set(4, 3);
    if (!view.items) {
      view.items = new Container();
      view.root.addChild(view.items);
    }
    const items = view.items;
    items.removeChildren().forEach((child) => child.destroy());
    const rows = Math.min(variable.array.length, Math.floor((height - 22) / 16));
    for (let i = 0; i < rows; i += 1) {
      const row = new Text({
        text: `${i + 1}  ${variable.array[i]!.data}`,
        style: { fontFamily: 'Nanum Gothic, sans-serif', fontSize: MONITOR_FONT, fill: '#000000' },
        resolution: 2,
      });
      row.position.set(4, 22 + i * 16);
      items.addChild(row);
    }
    view.root.position.set(variable.x, variable.y);
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
      if (variable.isList) {
        this.drawListMonitor(view, variable);
      } else {
        this.drawValueMonitor(
          view,
          variable.name,
          Overlay.formatValue(variable.value),
          variable.x,
          variable.y,
        );
      }
    }
    this.flushBuiltin();
  }

  private flushBuiltin(): void {
    if (this.answerShown()) {
      if (!this.answerMonitor) {
        this.answerMonitor = this.makeMonitor();
      }
      this.answerMonitor.root.visible = true;
      this.drawValueMonitor(this.answerMonitor, '대답', String(this.answerValue()), -230, -85);
    } else if (this.answerMonitor) {
      this.answerMonitor.root.visible = false;
    }
    if (this.timerShown()) {
      if (!this.timerMonitor) {
        this.timerMonitor = this.makeMonitor();
      }
      this.timerMonitor.root.visible = true;
      this.drawValueMonitor(
        this.timerMonitor,
        '초시계',
        this.timerValue().toFixed(1),
        -230,
        -105,
      );
    } else if (this.timerMonitor) {
      this.timerMonitor.root.visible = false;
    }
  }
}
