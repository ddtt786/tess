/**
 * @fileoverview 컴파일된 코드가 부르는 블록 동작 모음입니다.
 *
 * 이름 하나가 엔트리 블록 하나에 대응하고, 계산과 부작용은 entryjs 의
 * `src/playground/blocks/block_*.js` 에 있는 것을 그대로 옮겼습니다. 프레임을 넘겨야
 * 하는 블록은 제너레이터이며, 컴파일된 코드가 `yield*` 로 이어 받습니다.
 */
import { BOUNCE_THRESHOLD, TOUCH_THRESHOLD } from '../collision/detect.ts';
import * as cast from './cast.ts';
import {
  COLLISION,
  stage,
  type Entity,
  type Stroke,
  type Target,
  type Variable,
} from './model.ts';
import { cellToRowCol, columnIndex } from './table.ts';
import type { Vm } from './engine.ts';

export type Ops = ReturnType<typeof createOps>;

/**
 * Thrown to unwind a script that was told to stop from inside itself. Entry
 * ends the executor and its `execute` loop bails out at the very next check,
 * so nothing after the stopping block runs — including the rest of a function
 * the block was called from.
 */
export class ThreadStop extends Error {
  constructor() {
    super('thread stopped');
    this.name = 'ThreadStop';
  }
}

const SQRT3 = Math.sqrt(3);
const HALF_SQRT2 = Math.SQRT2 / 2;

/** `Entry.preciseTrig` — exact values on the angles people actually type. */
const TRIG: Record<string, Record<number, number>> = {
  sin: {
    0: 0, 30: 0.5, 45: HALF_SQRT2, 60: SQRT3 / 2, 90: 1, 120: SQRT3 / 2, 135: HALF_SQRT2,
    150: 0.5, 180: 0, 210: -0.5, 225: -HALF_SQRT2, 240: -SQRT3 / 2, 270: -1,
    300: -SQRT3 / 2, 315: -HALF_SQRT2, 330: -0.5, 360: 0,
  },
  cos: {
    0: 1, 30: SQRT3 / 2, 45: HALF_SQRT2, 60: 0.5, 90: 0, 120: -0.5, 135: -HALF_SQRT2,
    150: -SQRT3 / 2, 180: -1, 210: -SQRT3 / 2, 225: -HALF_SQRT2, 240: -0.5, 270: 0,
    300: 0.5, 315: HALF_SQRT2, 330: SQRT3 / 2, 360: 1,
  },
  tan: {
    0: 0, 30: SQRT3 / 3, 45: 1, 60: SQRT3, 90: Infinity, 120: -SQRT3, 135: -1,
    150: -SQRT3 / 3, 180: 0, 210: SQRT3 / 3, 225: 1, 240: SQRT3, 270: -Infinity,
    300: -SQRT3, 315: -1, 330: -SQRT3 / 3, 360: 0,
  },
};

function preciseTrig(degrees: number, operator: 'sin' | 'cos' | 'tan'): number {
  const angle = degrees % 360;
  const table = TRIG[operator]!;
  if (Object.prototype.hasOwnProperty.call(table, angle)) {
    return table[angle]!;
  }
  return Math[operator]((angle * Math.PI) / 180);
}

function factorial(n: number): number {
  let result = 1;
  for (let i = 2; i <= n; i += 1) {
    result *= i;
  }
  return result;
}

function hex2rgb(hexstr: string): { r: number; g: number; b: number } {
  let hex = hexstr[0] === '#' ? hexstr : `#${hexstr}`;
  if (hex.length === 4) {
    hex = `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
  }
  if (!/^#[0-9a-f]{6}$/i.test(hex)) {
    hex = '#000000';
  }
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

function rgb2hex(r: number, g: number, b: number): string {
  return `#${(((1 << 24) + (r << 16) + (g << 8) + b) >>> 0).toString(16).slice(1)}`;
}

/** `Entry.convertToRoundedDecimals` — dialogs round long decimals before showing. */
function roundedDecimals(value: unknown, decimals: number): unknown {
  if (!cast.isNumber(value) || !/\d+\.\d+$/.test(String(value))) {
    return value;
  }
  return Number(`${Math.round(Number(`${value}e${decimals}`))}e-${decimals}`);
}

function newBrush() {
  return {
    color: '#ff0000',
    thickness: 1,
    opacity: 0,
    stop: false,
    path: [] as number[],
    strokes: [] as Stroke[],
    fill: false,
  };
}

export function createOps(vm: Vm) {
  /** Extends the pen trail after the entity moved. */
  function pen(entity: Entity): void {
    const brush = entity.brush;
    if (brush && !brush.stop) {
      brush.path.push(entity.x, entity.y);
      vm.renderer?.penChanged?.(entity);
    }
    const paint = entity.paint;
    if (paint && !paint.stop) {
      paint.path.push(entity.x, entity.y);
      vm.renderer?.penChanged?.(entity);
    }
  }

  function targetFor(id: string): Target | null {
    return vm.targetOf(id);
  }

  function entityFor(id: string): Entity | null {
    return vm.entityOf(id);
  }

  function variable(entity: Entity, index: number): Variable | null {
    return vm.variableAt(index, entity);
  }

  /** `Entry.getListRealIndex`. */
  function listIndex(raw: unknown, list: Variable): number {
    if (!cast.isNumber(raw)) {
      if (raw === 'FIRST') {
        return 1;
      }
      if (raw === 'LAST') {
        return list.array.length;
      }
      if (raw === 'RANDOM') {
        return Math.floor(Math.random() * list.array.length) + 1;
      }
    }
    return Number(raw);
  }

  function startStroke(entity: Entity, which: 'brush' | 'paint'): void {
    const state = entity[which];
    if (!state) {
      return;
    }
    if (state.path.length >= 4) {
      state.strokes.push({
        color: state.color,
        thickness: state.thickness,
        opacity: state.opacity,
        points: state.path,
        fill: which === 'paint',
      });
    }
    state.path = [entity.x, entity.y];
    vm.renderer?.penChanged?.(entity);
  }

  const ops = {
    // -----------------------------------------------------------------------
    //  Moving
    // -----------------------------------------------------------------------
    moveDirection(entity: Entity, value: number): void {
      const radians = ((entity.rotation + entity.direction - 90) / 180) * Math.PI;
      entity.setX(entity.x + value * Math.cos(radians));
      entity.setY(entity.y - value * Math.sin(radians));
      pen(entity);
    },

    moveX(entity: Entity, value: number): void {
      entity.setX(entity.x + value);
      pen(entity);
    },

    moveY(entity: Entity, value: number): void {
      entity.setY(entity.y + value);
      pen(entity);
    },

    moveToAngle(entity: Entity, value: number, angle: number): void {
      entity.setX(entity.x + value * Math.cos(((angle - 90) / 180) * Math.PI));
      entity.setY(entity.y - value * Math.sin(((angle - 90) / 180) * Math.PI));
      pen(entity);
    },

    locateX(entity: Entity, value: number): void {
      entity.setX(value);
      pen(entity);
    },

    locateY(entity: Entity, value: number): void {
      entity.setY(value);
      pen(entity);
    },

    locateXY(entity: Entity, x: number, y: number): void {
      entity.setX(x);
      entity.setY(y);
      pen(entity);
    },

    locateTo(entity: Entity, targetId: string): void {
      const point = ops.pointOf(targetId);
      if (!point) {
        return;
      }
      entity.setX(Number(point.x));
      entity.setY(Number(point.y));
      pen(entity);
    },

    pointOf(targetId: string): { x: number; y: number } | null {
      if (targetId === 'mouse') {
        return { x: vm.mouseX, y: vm.mouseY };
      }
      const target = entityFor(targetId);
      return target ? { x: target.x, y: target.y } : null;
    },

    *moveXYTime(entity: Entity, seconds: number, dx: number, dy: number) {
      let frames = Math.max(Math.floor(seconds * vm.frameRate), 1);
      const stepX = dx / frames;
      const stepY = dy / frames;
      const step = () => {
        entity.setX(entity.x + stepX);
        entity.setY(entity.y + stepY);
        frames -= 1;
        pen(entity);
      };
      if (frames === 1) {
        step();
      }
      while (frames !== 0) {
        step();
        yield 0;
      }
    },

    *locateXYTime(entity: Entity, seconds: number, x: number, y: number) {
      let frames = Math.max(Math.floor(seconds * vm.frameRate), 1);
      const step = () => {
        entity.setX(entity.x + (x - entity.x) / frames);
        entity.setY(entity.y + (y - entity.y) / frames);
        frames -= 1;
        pen(entity);
      };
      if (frames === 1) {
        step();
      }
      while (frames !== 0) {
        step();
        yield 0;
      }
    },

    *locateObjectTime(entity: Entity, seconds: number, targetId: string) {
      const frames = Math.floor(seconds * vm.frameRate);
      const point = ops.pointOf(targetId);
      if (!point) {
        return;
      }
      if (frames === 0) {
        entity.setX(Number(point.x));
        entity.setY(Number(point.y));
        pen(entity);
        return;
      }
      const stepX = (point.x - entity.x) / frames;
      const stepY = (point.y - entity.y) / frames;
      let left = frames;
      while (left !== 0) {
        entity.setX(entity.x + stepX);
        entity.setY(entity.y + stepY);
        left -= 1;
        pen(entity);
        yield 0;
      }
    },

    rotateRelative(entity: Entity, value: number): void {
      entity.setRotation(value + entity.rotation);
    },

    directionRelative(entity: Entity, value: number): void {
      entity.setDirection(value + entity.direction);
    },

    rotateAbsolute(entity: Entity, value: number): void {
      entity.setRotation(value);
    },

    directionAbsolute(entity: Entity, value: number): void {
      entity.setDirection(value);
    },

    *rotateByTime(entity: Entity, seconds: number, angle: number) {
      let frames = Math.max(Math.floor(seconds * vm.frameRate), 1);
      const stepAngle = angle / frames;
      const step = () => {
        entity.setRotation(entity.rotation + stepAngle);
        frames -= 1;
      };
      if (frames === 1) {
        step();
      }
      while (frames !== 0) {
        step();
        yield 0;
      }
    },

    *directionByTime(entity: Entity, seconds: number, angle: number) {
      let frames = Math.max(Math.floor(seconds * vm.frameRate), 1);
      const stepAngle = angle / frames;
      const step = () => {
        entity.setDirection(entity.direction + stepAngle);
        frames -= 1;
      };
      if (frames === 1) {
        step();
      }
      while (frames !== 0) {
        step();
        yield 0;
      }
    },

    seeAngleObject(entity: Entity, targetId: string): void {
      if (entity.target.id === targetId) {
        return;
      }
      const point = ops.pointOf(targetId);
      if (!point) {
        return;
      }
      const deltaX = point.x - entity.x;
      const deltaY = point.y - entity.y;
      let value: number;
      if (deltaX === 0 && deltaY === 0) {
        value = entity.direction + entity.rotation;
      } else if (deltaX >= 0) {
        value = (-Math.atan(deltaY / deltaX) / Math.PI) * 180 + 90;
      } else {
        value = (-Math.atan(deltaY / deltaX) / Math.PI) * 180 + 270;
      }
      if (entity.target.rotateMethod === 'free') {
        const native = entity.direction + entity.rotation;
        entity.setRotation(entity.rotation + value - native);
      } else {
        entity.setDirection(value);
      }
    },

    /** `bounce_wall` — flips the heading once per contact, per entry's state machine. */
    bounceWall(entity: Entity): void {
      const method = entity.target.rotateMethod;
      const angle =
        method === 'free' ? cast.mod(entity.rotation + entity.direction, 360) : entity.direction;
      const flipVertical = () => {
        if (method === 'free') {
          entity.setRotation(-entity.rotation - entity.direction * 2 + 180);
        } else {
          entity.setDirection(-entity.direction + 180);
        }
      };
      const flipHorizontal = () => {
        if (method === 'free') {
          entity.setRotation(-entity.rotation - entity.direction * 2);
        } else {
          entity.setDirection(-entity.direction + 360);
        }
      };
      const hits = (side: string) => vm.collision.touchingWall(entity, side, BOUNCE_THRESHOLD);

      const test = (first: string, second: string, firstFlag: number, secondFlag: number, flip: () => void) => {
        let skip = entity.collision === firstFlag;
        let hit = hits(first);
        if (!hit && skip) {
          entity.collision = COLLISION.NONE;
        }
        if (hit && skip) {
          hit = false;
        }
        if (hit) {
          flip();
          entity.collision = firstFlag;
          return;
        }
        skip = entity.collision === secondFlag;
        let other = hits(second);
        if (!other && skip) {
          entity.collision = COLLISION.NONE;
        }
        if (other && skip) {
          other = false;
        }
        if (other) {
          flip();
          entity.collision = secondFlag;
        }
      };

      if ((angle < 90 && angle >= 0) || (angle < 360 && angle >= 270)) {
        test('wall_up', 'wall_down', COLLISION.UP, COLLISION.DOWN, flipVertical);
      } else if (angle < 270 && angle >= 90) {
        test('wall_down', 'wall_up', COLLISION.DOWN, COLLISION.UP, flipVertical);
      }
      if (angle < 360 && angle >= 180) {
        test('wall_left', 'wall_right', COLLISION.LEFT, COLLISION.RIGHT, flipHorizontal);
      } else if (angle < 180 && angle >= 0) {
        test('wall_right', 'wall_left', COLLISION.RIGHT, COLLISION.LEFT, flipHorizontal);
      }
    },

    // -----------------------------------------------------------------------
    //  Looks
    // -----------------------------------------------------------------------
    dialog(entity: Entity, message: unknown, mode: string): void {
      entity.dialog = { message: dialogText(message), mode: mode as 'speak' | 'think' };
      entity.dirty = true;
      vm.renderer?.syncDialog?.(entity);
    },

    *dialogTime(entity: Entity, message: unknown, seconds: number, mode: string) {
      ops.dialog(entity, message, mode);
      const until = vm.clock + seconds * 1000;
      while (vm.clock < until && entity.dialog) {
        yield 0;
      }
      ops.removeDialog(entity);
    },

    removeDialog(entity: Entity): void {
      entity.dialog = null;
      entity.dirty = true;
      vm.renderer?.syncDialog?.(entity);
    },

    setPicture(entity: Entity, id: string): void {
      entity.setImage(entity.target.getPicture(id));
    },

    nextPicture(entity: Entity, direction: string): void {
      const current = entity.picture?.id ?? '';
      const picture =
        direction === 'prev'
          ? entity.target.getPrevPicture(current)
          : entity.target.getNextPicture(current);
      entity.setImage(picture);
    },

    addEffect(entity: Entity, effect: string, value: number): void {
      if (effect === 'color') {
        entity.effect.hsv += value;
      } else if (effect === 'brightness') {
        entity.effect.brightness += value;
      } else if (effect === 'transparency') {
        entity.effect.alpha -= value / 100;
      }
      entity.applyEffects();
    },

    setEffect(entity: Entity, effect: string, value: number): void {
      if (effect === 'color') {
        entity.effect.hsv = value;
      } else if (effect === 'brightness') {
        entity.effect.brightness = value;
      } else if (effect === 'transparency') {
        entity.effect.alpha = 1 - value / 100;
      }
      entity.applyEffects();
    },

    stretchSize(entity: Entity, dimension: unknown, value: number): void {
      if (dimension === 'WIDTH') {
        entity.setXSize(entity.getSize() + value);
      } else {
        entity.setYSize(entity.getSize() + value);
      }
    },

    changeObjectIndex(entity: Entity, location: string): void {
      vm.renderer?.moveEntity?.(entity, location);
    },

    // -----------------------------------------------------------------------
    //  Flow
    // -----------------------------------------------------------------------
    *waitSecond(seconds: number) {
      const until = vm.clock + (60 / vm.frameRate) * seconds * 1000;
      yield 0;
      while (vm.clock < until) {
        yield 0;
      }
    },

    /** Ends the running script here and now; nothing after this call runs. */
    die(): never {
      throw new ThreadStop();
    },

    stopAll(): void {
      for (const target of vm.targets) {
        for (const thread of target.threads) {
          thread.stop();
        }
        target.threads = [];
      }
    },

    stopEntity(entity: Entity): void {
      vm.stopThreadsOf(entity);
    },

    stopTarget(entity: Entity): void {
      const target = entity.target;
      for (const thread of target.threads) {
        thread.stop();
      }
      target.threads = [];
    },

    stopOtherThreads(entity: Entity, current: unknown): void {
      const threads = entity.target.threads;
      for (let i = threads.length - 1; i >= 0; i -= 1) {
        const thread = threads[i]!;
        if (thread !== current && thread.entity === entity) {
          thread.stop();
          threads.splice(i, 1);
        }
      }
    },

    stopOtherTargets(entity: Entity): void {
      for (const target of vm.targets) {
        if (target === entity.target) {
          continue;
        }
        for (const thread of target.threads) {
          thread.stop();
        }
        target.threads = [];
      }
    },

    restart(): void {
      vm.stop();
      vm.start();
    },

    createClone(entity: Entity, targetId: string): void {
      if (targetId === 'self') {
        vm.addClone(entity.target, entity);
        return;
      }
      const target = targetFor(targetId);
      if (target) {
        vm.addClone(target, target.entity);
      }
    },

    removeAllClones(entity: Entity): void {
      for (const clone of entity.target.getClonedEntities()) {
        clone.removeClone();
      }
    },

    // -----------------------------------------------------------------------
    //  Events and scenes
    // -----------------------------------------------------------------------
    castMessage(id: string): void {
      vm.fireEvent('when_message_cast', id);
    },

    *castMessageWait(id: string) {
      const started = vm.fireEvent('when_message_cast', id);
      while (started.some((thread) => !thread.done)) {
        yield 0;
      }
    },

    startScene(id: string): void {
      vm.selectScene(id);
      vm.fireEvent('when_scene_start');
    },

    startNeighborScene(operator: string): void {
      const index = vm.scenes.findIndex((scene) => scene.id === vm.currentSceneId);
      const next = operator === 'next' ? index + 1 : index - 1;
      const scene = vm.scenes[next];
      if (scene) {
        vm.selectScene(scene.id);
        vm.fireEvent('when_scene_start');
      }
    },

    entityOf(id: string): Entity | null {
      return entityFor(id);
    },

    // -----------------------------------------------------------------------
    //  Variables and lists
    // -----------------------------------------------------------------------
    getVariable(entity: Entity, index: number): string | number {
      return variable(entity, index)?.getValue() ?? 0;
    },

    setVariable(entity: Entity, index: number, value: unknown): void {
      variable(entity, index)?.setValue(value as string | number);
    },

    /** Adds when both sides read as numbers, joins as text otherwise. */
    changeVariable(entity: Entity, index: number, value: unknown): void {
      const target = variable(entity, index);
      if (!target) {
        return;
      }
      const current = target.getValue();
      if (cast.isNumber(value) && target.isNumber()) {
        // Entry stores the result of `toFixed`, so a counter holds "1", not 1.
        const places = maxFloatPoint([value as string | number, current]);
        target.setValue(cast.addNum(Number(value), Number(current)).toFixed(places));
        return;
      }
      target.setValue(`${current}${value}`);
    },

    showVariable(entity: Entity, index: number, visible: boolean): void {
      const target = variable(entity, index);
      if (target) {
        target.visible = visible;
      }
    },

    listValue(entity: Entity, index: number, raw: unknown): string | number {
      const list = variable(entity, index);
      if (!list) {
        return 0;
      }
      const at = listIndex(raw, list);
      return list.array[at - 1]?.data ?? 0;
    },

    listLength(entity: Entity, index: number): number {
      return variable(entity, index)?.array.length ?? 0;
    },

    listIncludes(entity: Entity, index: number, data: string): boolean {
      const list = variable(entity, index);
      if (!list) {
        return false;
      }
      for (const item of list.array) {
        if (String(item.data) === data) {
          return true;
        }
      }
      return false;
    },

    listAppend(entity: Entity, index: number, value: unknown): void {
      variable(entity, index)?.array.push({ data: value as string | number });
    },

    listRemove(entity: Entity, index: number, raw: unknown): void {
      const list = variable(entity, index);
      if (!list) {
        return;
      }
      const at = listIndex(raw, list);
      if (at >= 1 && at <= list.array.length) {
        list.array.splice(at - 1, 1);
      }
    },

    listInsert(entity: Entity, index: number, raw: unknown, value: unknown): void {
      const list = variable(entity, index);
      if (!list) {
        return;
      }
      const at = listIndex(raw, list);
      if (at >= 1 && at <= list.array.length + 1) {
        list.array.splice(at - 1, 0, { data: value as string | number });
      }
    },

    listReplace(entity: Entity, index: number, raw: unknown, value: unknown): void {
      const list = variable(entity, index);
      if (!list) {
        return;
      }
      const at = listIndex(raw, list);
      if (at >= 1 && at <= list.array.length) {
        list.array[at - 1] = { data: value as string | number };
      }
    },

    *askAndWait(entity: Entity, message: unknown) {
      ops.dialog(entity, message, 'ask');
      vm.question = String(message);
      vm.pendingAnswer = null;
      vm.renderer?.showQuestion?.(String(message));
      while (vm.pendingAnswer === null) {
        yield 0;
      }
      vm.answer = vm.pendingAnswer;
      vm.pendingAnswer = null;
      vm.question = null;
      vm.renderer?.hideQuestion?.();
      ops.removeDialog(entity);
    },

    answer(): string | number {
      return vm.answer;
    },

    showAnswer(visible: boolean): void {
      vm.answerVisible = visible;
    },

    // -----------------------------------------------------------------------
    //  Text boxes
    // -----------------------------------------------------------------------
    readText(entity: Entity, targetId: string): string {
      const source = targetId === 'self' ? entity : entityFor(targetId);
      return (source?.text ?? '').replace(/\n/gim, ' ');
    },

    textEffect(entity: Entity, effect: string, mode: string): void {
      const on = mode === 'on';
      if (effect === 'bold') {
        entity.fontBold = on;
      } else if (effect === 'italic') {
        entity.fontItalic = on;
      } else if (effect === 'underline') {
        entity.underLine = on;
      } else if (effect === 'through') {
        entity.strike = on;
      }
      entity.measure();
      entity.touch();
    },

    textFont(entity: Entity, font: string): void {
      entity.fontFamily = font;
      entity.measure();
      entity.touch();
    },

    textColor(entity: Entity, colour: string): void {
      entity.colour = colour.startsWith('#') ? colour : `#${colour}`;
      entity.touch();
    },

    textBgColor(entity: Entity, colour: string): void {
      entity.bgColor = colour.startsWith('#') ? colour : `#${colour}`;
      entity.touch();
    },

    // -----------------------------------------------------------------------
    //  Sound
    // -----------------------------------------------------------------------
    playSound(entity: Entity, id: string, startSeconds = 0, durationSeconds = 0): void {
      const sound = entity.target.getSound(id);
      if (sound) {
        vm.audio?.play(
          sound,
          entity.id,
          startSeconds * 1000,
          durationSeconds ? durationSeconds * 1000 : undefined,
        );
      }
    },

    playSoundRange(entity: Entity, id: string, start: number, end: number): void {
      const sound = entity.target.getSound(id);
      if (!sound) {
        return;
      }
      const from = Math.min(start, end) * 1000;
      const to = Math.max(start, end) * 1000;
      vm.audio?.play(sound, entity.id, from, to - from);
    },

    *playSoundWait(entity: Entity, id: string, startSeconds = 0, durationSeconds = 0) {
      const sound = entity.target.getSound(id);
      if (!sound) {
        return;
      }
      ops.playSound(entity, id, startSeconds, durationSeconds);
      const speed = vm.audio?.getSpeed() ?? 1;
      const ms = durationSeconds
        ? durationSeconds * 1000
        : Math.floor((sound.duration * 1000) / speed);
      const until = vm.clock + ms;
      yield 0;
      while (vm.clock < until) {
        yield 0;
      }
    },

    *playSoundRangeWait(entity: Entity, id: string, start: number, end: number) {
      const sound = entity.target.getSound(id);
      if (!sound) {
        return;
      }
      ops.playSoundRange(entity, id, start, end);
      const ms = Math.abs(end - start) * 1000;
      const until = vm.clock + ms;
      yield 0;
      while (vm.clock < until) {
        yield 0;
      }
    },

    changeVolume(value: number): void {
      vm.audio?.setVolume(cast.clamp((vm.audio?.getVolume() ?? 1) + value / 100, 0, 1));
    },

    setVolume(value: number): void {
      vm.audio?.setVolume(cast.clamp(value / 100, 0, 1));
    },

    volume(): number {
      return (vm.audio?.getVolume() ?? 1) * 100;
    },

    changeSpeed(value: number): void {
      vm.audio?.setSpeed(cast.clamp((vm.audio?.getSpeed() ?? 1) + value, 0.5, 2));
    },

    setSpeed(value: number): void {
      vm.audio?.setSpeed(cast.clamp(value, 0.5, 2));
    },

    speed(): number {
      return vm.audio?.getSpeed() ?? 1;
    },

    stopSounds(entity: Entity, target: string): void {
      if (target === 'thisOnly') {
        vm.audio?.stopEntity(entity.id);
      } else if (target === 'other_objects') {
        vm.audio?.stopExcept(entity.id);
      } else {
        vm.audio?.stopAll();
      }
    },

    playBgm(entity: Entity, id: string): void {
      const sound = entity.target.getSound(id);
      if (sound) {
        vm.audio?.stopBgm();
        vm.audio?.playBgm(sound);
      }
    },

    stopBgm(): void {
      vm.audio?.stopBgm();
    },

    soundDuration(entity: Entity, id: string): number {
      return entity.target.getSound(id)?.duration ?? 0;
    },

    // -----------------------------------------------------------------------
    //  Pen
    // -----------------------------------------------------------------------
    startDrawing(entity: Entity): void {
      if (entity.brush) {
        entity.brush.stop = false;
      } else {
        entity.brush = newBrush();
      }
      startStroke(entity, 'brush');
    },

    stopDrawing(entity: Entity): void {
      if (entity.brush) {
        entity.brush.stop = true;
        startStroke(entity, 'brush');
        entity.brush.path = [];
      }
    },

    startFill(entity: Entity): void {
      if (entity.paint) {
        entity.paint.stop = false;
      } else {
        entity.paint = newBrush();
      }
      startStroke(entity, 'paint');
    },

    stopFill(entity: Entity): void {
      if (entity.paint) {
        entity.paint.stop = true;
        startStroke(entity, 'paint');
        entity.paint.path = [];
      }
    },

    setPenColor(entity: Entity, colour: string): void {
      if (!entity.brush) {
        entity.brush = newBrush();
        entity.brush.stop = true;
      }
      startStroke(entity, 'brush');
      entity.brush.color = colour.startsWith('#') ? colour : `#${colour}`;
    },

    setRandomPenColor(entity: Entity): void {
      const random = () =>
        rgb2hex(
          Math.floor(Math.random() * 256),
          Math.floor(Math.random() * 256),
          Math.floor(Math.random() * 256),
        );
      ops.setPenColor(entity, random());
      ops.setFillColor(entity, random());
    },

    setFillColor(entity: Entity, colour: string): void {
      if (!entity.paint) {
        entity.paint = newBrush();
        entity.paint.stop = true;
      }
      startStroke(entity, 'paint');
      entity.paint.color = colour.startsWith('#') ? colour : `#${colour}`;
    },

    changeThickness(entity: Entity, value: number): void {
      if (!entity.brush) {
        entity.brush = newBrush();
        entity.brush.stop = true;
      }
      startStroke(entity, 'brush');
      entity.brush.thickness = Math.max(1, entity.brush.thickness + value);
    },

    setThickness(entity: Entity, value: number): void {
      if (!entity.brush) {
        entity.brush = newBrush();
        entity.brush.stop = true;
      }
      startStroke(entity, 'brush');
      entity.brush.thickness = Math.max(1, value);
    },

    changePenOpacity(entity: Entity, value: number): void {
      if (!entity.brush) {
        entity.brush = newBrush();
        entity.brush.stop = true;
      }
      startStroke(entity, 'brush');
      entity.brush.opacity = cast.clamp(entity.brush.opacity + value, 0, 100);
    },

    setPenOpacity(entity: Entity, value: number): void {
      if (!entity.brush) {
        entity.brush = newBrush();
        entity.brush.stop = true;
      }
      startStroke(entity, 'brush');
      entity.brush.opacity = cast.clamp(value, 0, 100);
    },

    eraseAll(entity: Entity): void {
      if (entity.brush) {
        entity.brush.strokes = [];
        entity.brush.path = entity.brush.stop ? [] : [entity.x, entity.y];
      }
      if (entity.paint) {
        entity.paint.strokes = [];
        entity.paint.path = entity.paint.stop ? [] : [entity.x, entity.y];
      }
      entity.stamps = [];
      vm.renderer?.eraseAll?.(entity);
    },

    stamp(entity: Entity): void {
      entity.stamps.push({
        picture: entity.picture,
        x: entity.x,
        y: entity.y,
        regX: entity.regX,
        regY: entity.regY,
        scaleX: entity.scaleX,
        scaleY: entity.scaleY,
        rotation: entity.rotation,
        alpha: entity.effect.alpha,
      });
      vm.renderer?.stamp?.(entity);
    },

    // -----------------------------------------------------------------------
    //  Data tables
    // -----------------------------------------------------------------------
    tableAppend(index: number, property: string): void {
      const table = vm.tables[index];
      if (!table) {
        return;
      }
      if (property === 'ROW') {
        table.appendRow();
      } else {
        table.appendCol();
      }
    },

    tableInsert(index: number, at: number, property: string): void {
      const table = vm.tables[index];
      if (!table) {
        return;
      }
      if (property === 'ROW') {
        table.insertRow(at - 1);
      } else {
        table.insertCol(at);
      }
    },

    tableDelete(index: number, at: number, property: string): void {
      const table = vm.tables[index];
      if (!table) {
        return;
      }
      if (property === 'ROW') {
        table.deleteRow(at - 1);
      } else {
        table.deleteCol(at);
      }
    },

    tableSet(index: number, row: number, col: unknown, value: unknown): void {
      const table = vm.tables[index];
      const column = columnIndex(col);
      if (table && table.isExist(row - 1, column)) {
        table.replaceValue(row - 1, column, value as string | number);
      }
    },

    tableSetCell(index: number, cell: unknown, value: unknown): void {
      const table = vm.tables[index];
      if (!table) {
        return;
      }
      const { row, col } = cellToRowCol(String(cell ?? '').toUpperCase());
      if (table.isExist(row, col)) {
        table.replaceValue(row, col, value as string | number);
      }
    },

    tableCount(index: number, property: string): number {
      const table = vm.tables[index];
      if (!table) {
        return 0;
      }
      if (property === 'ROW') {
        return table.rows.length + 1;
      }
      if (property === 'COL') {
        return table.fields.length;
      }
      return 0;
    },

    tableValue(index: number, row: number, col: unknown): string | number | null {
      return vm.tables[index]?.getValue(row - 1, columnIndex(col)) ?? null;
    },

    tableLastValue(index: number, col: unknown): string | number | null {
      const table = vm.tables[index];
      if (!table) {
        return null;
      }
      return table.getValue(table.rows.length, columnIndex(col));
    },

    tableCellValue(index: number, cell: unknown): string | number | null {
      const table = vm.tables[index];
      if (!table) {
        return null;
      }
      const { row, col } = cellToRowCol(String(cell ?? '').toUpperCase());
      return table.getValue(row, col);
    },

    tableCalc(index: number, col: unknown, calc: string): number {
      const table = vm.tables[index];
      if (!table) {
        return 0;
      }
      const values = table.column(columnIndex(col));
      const total = values.length;
      if (!total) {
        return 0;
      }
      const sum = values.reduce((a, b) => a + b, 0);
      switch (calc) {
        case 'SUM':
          return sum;
        case 'MAX':
          return values.reduce((a, b) => Math.max(a, b));
        case 'MIN':
          return values.reduce((a, b) => Math.min(a, b));
        case 'AVG':
          return sum / total;
        case 'STDEV': {
          const mean = sum / total;
          const variance = values.reduce((acc, x) => acc + (x - mean) ** 2, 0) / total;
          return Math.sqrt(variance);
        }
        default:
          return 0;
      }
    },

    tableCoefficient(index: number, x: unknown, y: unknown): number {
      const table = vm.tables[index];
      if (!table) {
        return 0;
      }
      return table.coefficient(columnIndex(x) - 1, columnIndex(y) - 1);
    },

    tableLookup(index: number, field: unknown, value: unknown, returnField: unknown): string | number | null {
      const table = vm.tables[index];
      if (!table) {
        return null;
      }
      const col = columnIndex(field);
      const returnCol = columnIndex(returnField);
      for (let row = 0; row <= table.rows.length; row += 1) {
        // eslint-disable-next-line eqeqeq
        if (table.getValue(row, col) == value) {
          return table.getValue(row, returnCol);
        }
      }
      return null;
    },

    // -----------------------------------------------------------------------
    //  Text to speech
    // -----------------------------------------------------------------------
    speak(entity: Entity, text: string): void {
      vm.speech?.speak(text, entity.voice);
    },

    *speakWait(entity: Entity, text: string) {
      const done = vm.speech?.speak(text, entity.voice);
      if (!done) {
        return;
      }
      let finished = false;
      void done.then(() => {
        finished = true;
      });
      while (!finished) {
        yield 0;
      }
    },

    setVoice(entity: Entity, speaker: string, speed: unknown, pitch: unknown): void {
      entity.voice = { speaker, speed: Number(speed) || 0, pitch: Number(pitch) || 0, volume: 1 };
    },

    // -----------------------------------------------------------------------
    //  Timer
    // -----------------------------------------------------------------------
    timerAction(action: string): void {
      if (action === 'START') {
        vm.startTimer();
      } else if (action === 'STOP') {
        vm.pauseTimer();
      } else {
        vm.resetTimer();
      }
    },

    showTimer(visible: boolean): void {
      vm.timerVisible = visible;
    },

    timerValue(): number {
      return vm.timerValue();
    },

    // -----------------------------------------------------------------------
    //  Calculation
    // -----------------------------------------------------------------------
    random(left: string, right: string): number | string {
      const low = Math.min(Number(left), Number(right));
      const high = Math.max(Number(left), Number(right));
      const isFloat = /\d+\.\d+$/.test(left) || /\d+\.\d+$/.test(right);
      if (isFloat) {
        return (Math.random() * (high - low) + low).toFixed(2);
      }
      return Math.floor(Math.random() * (high - low + 1) + low);
    },

    mathOp(value: number, rawOperator: string): number {
      let operator = rawOperator;
      if (operator.indexOf('_') > 0) {
        operator = operator.split('_')[0]!;
      }
      switch (operator) {
        case 'square':
          return value * value;
        case 'factorial':
          return factorial(value);
        case 'root':
          return Math.sqrt(value);
        case 'log':
          return Math.log(value) / Math.LN10;
        case 'ln':
          return Math.log(value);
        case 'asin':
        case 'acos':
        case 'atan':
          return ((Math[operator](value) as number) * 180) / Math.PI;
        case 'sin':
        case 'cos':
        case 'tan':
          return preciseTrig(value, operator);
        case 'unnatural': {
          const fraction = cast.subNum(value, Math.floor(value));
          return value < 0 && fraction !== 0 ? 1 - fraction : fraction;
        }
        case 'abs':
          return Math.abs(value);
        case 'floor':
          return Math.floor(value);
        case 'ceil':
          return Math.ceil(value);
        case 'round':
          return Math.round(value);
        default:
          return Math.round(value);
      }
    },

    quotient(left: number, right: number, operator: string): number {
      if (operator === 'QUOTIENT') {
        return Math.floor(left / right);
      }
      return left - right * Math.floor(left / right);
    },

    mouseCoordinate(axis: string): number {
      return axis === 'x' ? vm.mouseX : vm.mouseY;
    },

    objectProperty(entity: Entity, targetId: string, property: string): string | number {
      const target = targetId === 'self' ? entity : entityFor(targetId);
      if (!target) {
        return 0;
      }
      switch (property) {
        case 'x':
          return target.x;
        case 'y':
          return target.y;
        case 'rotation':
          return target.rotation;
        case 'direction':
          return target.direction;
        case 'picture_index':
          return target.target.pictures.indexOf(target.picture!) + 1;
        case 'size':
          return cast.fixed(target.getSize(), 1);
        case 'picture_name':
          return target.picture?.name ?? '';
        default:
          return 0;
      }
    },

    distanceTo(entity: Entity, targetId: string): number {
      const point = ops.pointOf(targetId);
      if (!point) {
        return 0;
      }
      return Math.sqrt((entity.x - point.x) ** 2 + (entity.y - point.y) ** 2);
    },

    dateValue(unit: string): number {
      const now = new Date();
      switch (unit) {
        case 'YEAR':
          return now.getFullYear();
        case 'MONTH':
          return now.getMonth() + 1;
        case 'DAY':
          return now.getDate();
        case 'HOUR':
          return now.getHours();
        case 'MINUTE':
          return now.getMinutes();
        case 'DAY_OF_WEEK':
          return now.getDay();
        default:
          return now.getSeconds();
      }
    },

    charAt(text: string, index: number): string {
      return text[index - 1] ?? '';
    },

    substring(text: string, start: number, end: number): string {
      const from = start - 1;
      const to = end - 1;
      return text.substring(Math.min(from, to), Math.max(from, to) + 1);
    },

    changeCase(text: string, mode: string): string {
      if (mode === 'toUpperCase') {
        return text.toUpperCase();
      }
      if (mode === 'toLowerCase') {
        return text.toLowerCase();
      }
      return text;
    },

    rgbToHex(r: number, g: number, b: number): string {
      return rgb2hex(r, g, b);
    },

    hexToRgb(hex: unknown, channel: string): number {
      const rgb = hex2rgb(String(hex));
      return rgb[channel as 'r' | 'g' | 'b'] ?? 0;
    },

    // -----------------------------------------------------------------------
    //  Judgement
    // -----------------------------------------------------------------------
    isClicked(): boolean {
      return vm.mouseDown;
    },

    isObjectClicked(entity: Entity): boolean {
      return vm.clickedEntityId === entity.id;
    },

    isKeyPressed(code: unknown): boolean {
      return vm.pressedKeys.has(Number(code));
    },

    isType(value: string, type: string): boolean {
      if (type === 'number') {
        return cast.isNumber(value);
      }
      if (type === 'en') {
        return /^[a-zA-Z]+$/.test(value);
      }
      if (type === 'ko') {
        return /^[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]+$/.test(value);
      }
      return false;
    },

    touching(entity: Entity, targetId: string): boolean {
      if (!entity.visible) {
        return false;
      }
      if (/wall/.test(targetId)) {
        return vm.collision.touchingWall(entity, targetId, TOUCH_THRESHOLD);
      }
      if (targetId === 'mouse') {
        return vm.collision.touchingMouse(
          entity,
          vm.mouseX * stage.scale + stage.worldWidth / 2,
          -vm.mouseY * stage.scale + stage.worldHeight / 2,
        );
      }
      const target = targetFor(targetId);
      if (!target) {
        return false;
      }
      return vm.collision.touchingTarget(entity, target, TOUCH_THRESHOLD);
    },

    isBoostMode(): boolean {
      return vm.boost;
    },

    isDeviceType(device: string): boolean {
      if (device !== 'desktop') {
        return vm.deviceType === device;
      }
      return vm.deviceType !== 'mobile' && vm.deviceType !== 'tablet';
    },

    isTouchSupported(): boolean {
      return vm.touch;
    },
  };

  return ops;
}

function dialogText(message: unknown): string {
  let text: unknown = message;
  if (text === '') {
    text = '    ';
  } else if (typeof text === 'boolean') {
    text = text ? 'True' : 'False';
  } else {
    text = `${text}`;
  }
  return String(roundedDecimals(text, 3));
}

/** `Entry.getMaxFloatPoint`. */
function maxFloatPoint(numbers: Array<string | number>): number {
  let max = 0;
  for (const value of numbers) {
    const text = String(value);
    const dot = text.indexOf('.');
    if (dot !== -1) {
      max = Math.max(max, text.length - dot - 1);
    }
  }
  return Math.min(max, 20);
}
