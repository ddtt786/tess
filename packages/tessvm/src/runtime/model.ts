/**
 * @fileoverview 실행 중인 작품의 상태 모델입니다.
 *
 * 엔트리의 `Entry.EntityObject` · `Entry.EntryObject` · `Entry.Variable` 이 담고 있는
 * 값과 그 값을 바꾸는 규칙을 그대로 옮기되, 화면 갱신은 하지 않습니다. 좌표를 바꾸면
 * `dirty` 표시만 남기고 렌더러가 프레임 끝에 한 번만 반영합니다.
 */
import { clamp, mod, num } from './cast.ts';

/** Stage extent in entry coordinates. */
export const STAGE_WIDTH = 480;
export const STAGE_HEIGHT = 270;
/** Canvas the collision test rasterises into, and the scale that takes it there. */
export const WORLD_WIDTH = 640;
export const WORLD_HEIGHT = 360;
export const WORLD_SCALE = WORLD_WIDTH / STAGE_WIDTH;

/** `Entry.Utils.COLLISION`. */
export const COLLISION = { NONE: 0, UP: 1, RIGHT: 2, LEFT: 3, DOWN: 4 } as const;

export interface Picture {
  id: string;
  name: string;
  fileurl: string;
  dimension: { width: number; height: number };
  imageType?: string;
}

export interface Sound {
  id: string;
  name: string;
  fileurl: string;
  duration: number;
}

export interface Effects {
  blur: number;
  hue: number;
  hsv: number;
  brightness: number;
  contrast: number;
  saturation: number;
  alpha: number;
}

export function initialEffects(): Effects {
  return { blur: 0, hue: 0, hsv: 0, brightness: 0, contrast: 0, saturation: 0, alpha: 1 };
}

export interface BrushState {
  color: string;
  thickness: number;
  opacity: number;
  stop: boolean;
  /** Points laid down since the last move, in entry coordinates. */
  path: number[];
  /** Finished strokes, each `{color, thickness, opacity, points}`. */
  strokes: Stroke[];
  fill: boolean;
}

export interface Stroke {
  color: string;
  thickness: number;
  opacity: number;
  points: number[];
  fill: boolean;
}

export interface VoiceProps {
  speaker: string;
  speed: number;
  pitch: number;
  volume: number;
}

export interface DialogState {
  message: string;
  mode: 'speak' | 'think' | 'ask';
}

let entitySeq = 0;

/** One drawable instance — the object itself or one of its clones. */
export class Entity {
  readonly target: Target;
  readonly id: string;
  readonly isClone: boolean;
  readonly type: 'sprite' | 'textBox';

  x = 0;
  y = 0;
  regX = 0;
  regY = 0;
  scaleX = 1;
  scaleY = 1;
  rotation = 0;
  direction = 90;
  width = 0;
  height = 0;
  visible = true;
  flip = false;
  scaleOriginX = 1;
  scaleOriginY = 1;
  collision: number = COLLISION.NONE;

  picture: Picture | null = null;
  effect: Effects = initialEffects();

  /** Text box state. */
  text = '';
  colour = '#000000';
  bgColor = 'transparent';
  fontSize = 20;
  fontFamily = 'Nanum Gothic';
  fontBold = false;
  fontItalic = false;
  underLine = false;
  strike = false;
  textAlign = 0;
  lineBreak = false;

  /** `set_tts_property` keeps the reading voice per entity, as entry does. */
  voice: VoiceProps = { speaker: 'kyuri', speed: 0, pitch: 0, volume: 1 };

  brush: BrushState | null = null;
  paint: BrushState | null = null;
  stamps: StampState[] = [];
  dialog: DialogState | null = null;
  /**
   * Per-clone copies of the object's local variables, indexed the same way as
   * the project's variable list. Only clones carry these.
   */
  localVars: Array<Variable | undefined> | null = null;

  /** Bumped whenever anything that moves pixels changes, to key collision caches. */
  version = 1;
  /** Set when the renderer still has to catch up with this entity. */
  dirty = true;
  removed = false;

  constructor(target: Target, isClone: boolean) {
    this.target = target;
    this.id = isClone ? `${target.id}#${++entitySeq}` : target.id;
    this.isClone = isClone;
    this.type = target.objectType;
  }

  touch(): void {
    this.version++;
    this.dirty = true;
  }

  setX(x: number): void {
    if (typeof x !== 'number') {
      return;
    }
    this.x = x;
    this.touch();
  }

  setY(y: number): void {
    if (typeof y !== 'number') {
      return;
    }
    this.y = y;
    this.touch();
  }

  getX(): number {
    return this.x;
  }

  getY(): number {
    return this.y;
  }

  getDirection(): number {
    return this.direction;
  }

  /** `vertical` rotation mirrors the sprite as the heading crosses the vertical axis. */
  setDirection(dir = 0, flippable = false): void {
    const direction = mod(dir, 360);
    if (this.target.rotateMethod === 'vertical' && !flippable) {
      const previousIsRight = this.direction >= 0 && this.direction < 180;
      const afterIsRight = direction >= 0 && direction < 180;
      if (previousIsRight !== afterIsRight) {
        this.setScaleX(-this.getScaleX());
        this.flip = !this.flip;
      }
    }
    this.direction = direction;
    this.touch();
  }

  setRotation(rotation: number): void {
    this.rotation = mod(this.target.rotateMethod === 'free' ? rotation : 0, 360);
    this.touch();
  }

  getRotation(): number {
    return this.rotation;
  }

  setRegX(regX: number): void {
    this.regX = this.type === 'textBox' ? 0 : regX;
    this.touch();
  }

  setRegY(regY: number): void {
    this.regY = this.type === 'textBox' ? 0 : regY;
    this.touch();
  }

  setScaleX(scaleX: number): void {
    this.scaleX = scaleX;
    if (this.target.project.stopped) {
      this.scaleOriginX = scaleX;
    }
    this.touch();
  }

  setScaleY(scaleY: number): void {
    this.scaleY = scaleY;
    if (this.target.project.stopped) {
      this.scaleOriginY = scaleY;
    }
    this.touch();
  }

  getScaleX(): number {
    return this.scaleX;
  }

  getScaleY(): number {
    return this.scaleY;
  }

  /** Entry's one-number size: the mean of the two transformed side lengths. */
  getSize(): number {
    return (this.width * Math.abs(this.scaleX) + this.height * Math.abs(this.scaleY)) / 2;
  }

  setSize(size: number): void {
    const scale = Math.max(1, size) / this.getSize();
    this.setScaleX(this.scaleX * scale);
    this.setScaleY(this.scaleY * scale);
  }

  setXSize(size: number): void {
    this.setScaleX(this.scaleX * (Math.max(1, size) / this.getSize()));
  }

  setYSize(size: number): void {
    this.setScaleY(this.scaleY * (Math.max(1, size) / this.getSize()));
  }

  resetSize(): void {
    this.setScaleX(this.scaleOriginX);
    this.setScaleY(this.scaleOriginY);
  }

  setWidth(width: number): void {
    this.width = width;
    this.touch();
  }

  setHeight(height: number): void {
    this.height = height;
    this.touch();
  }

  getWidth(): number {
    return this.width;
  }

  getHeight(): number {
    return this.height;
  }

  setVisible(visible: boolean): boolean {
    this.visible = visible;
    this.touch();
    return visible;
  }

  getVisible(): boolean {
    return this.visible;
  }

  getText(): string {
    return this.text;
  }

  setText(text: string): void {
    this.text = text;
    this.touch();
  }

  /** `setImage` keeps the registration point where it sat relative to the middle. */
  setImage(picture: Picture | null | undefined): void {
    if (!picture) {
      return;
    }
    const absoluteRegX = this.regX - this.width / 2;
    const absoluteRegY = this.regY - this.height / 2;
    this.picture = picture;
    this.width = picture.dimension.width;
    this.height = picture.dimension.height;
    this.setRegX(this.width / 2 + absoluteRegX);
    this.setRegY(this.height / 2 + absoluteRegY);
    this.touch();
  }

  resetFilter(): void {
    if (this.type !== 'sprite') {
      return;
    }
    this.effect = initialEffects();
    this.touch();
  }

  applyEffects(): void {
    this.effect.alpha = clamp(this.effect.alpha, 0, 1);
    this.touch();
  }

  /** The 2×3 world matrix that maps texture pixels to the 640×360 collision space. */
  worldMatrix(out: Float64Array): Float64Array {
    const rad = (this.rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const sx = this.scaleX * WORLD_SCALE;
    const sy = this.scaleY * WORLD_SCALE;
    const a = cos * sx;
    const b = sin * sx;
    const c = -sin * sy;
    const d = cos * sy;
    out[0] = a;
    out[1] = b;
    out[2] = c;
    out[3] = d;
    out[4] = this.x * WORLD_SCALE + WORLD_WIDTH / 2 - (a * this.regX + c * this.regY);
    out[5] = -this.y * WORLD_SCALE + WORLD_HEIGHT / 2 - (b * this.regX + d * this.regY);
    return out;
  }

  removeClone(): void {
    if (!this.isClone || this.removed) {
      return;
    }
    this.removed = true;
    this.target.removeClone(this);
  }
}

export interface StampState {
  picture: Picture | null;
  x: number;
  y: number;
  regX: number;
  regY: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  alpha: number;
}

/** One object in the project — its assets, its scripts, and every live entity of it. */
export class Target {
  readonly project: Project;
  readonly id: string;
  readonly name: string;
  readonly objectType: 'sprite' | 'textBox';
  readonly sceneId: string;
  rotateMethod: string;
  pictures: Picture[] = [];
  sounds: Sound[] = [];
  entity!: Entity;
  clones: Entity[] = [];
  /** Scripts compiled for this object; index matches `project.scripts`. */
  scripts: CompiledScript[] = [];
  /** Live threads, in the order entry would tick them. */
  threads: Thread[] = [];
  /** Draw order inside the scene; lower is further back. */
  index = 0;

  constructor(project: Project, id: string, name: string, objectType: 'sprite' | 'textBox', sceneId: string, rotateMethod: string) {
    this.project = project;
    this.id = id;
    this.name = name;
    this.objectType = objectType;
    this.sceneId = sceneId;
    this.rotateMethod = rotateMethod;
  }

  getPicture(idOrName: string): Picture | null {
    const key = String(idOrName);
    for (const picture of this.pictures) {
      if (picture.id === key) {
        return picture;
      }
    }
    for (const picture of this.pictures) {
      if (picture.name === key) {
        return picture;
      }
    }
    return this.pictures[0] ?? null;
  }

  getNextPicture(id: string): Picture | null {
    const index = this.pictures.findIndex((picture) => picture.id === id);
    return this.pictures[(index + 1) % this.pictures.length] ?? null;
  }

  getPrevPicture(id: string): Picture | null {
    const index = this.pictures.findIndex((picture) => picture.id === id);
    const length = this.pictures.length;
    return this.pictures[(index - 1 + length) % length] ?? null;
  }

  getSound(idOrName: string): Sound | null {
    const key = String(idOrName);
    for (const sound of this.sounds) {
      if (sound.id === key) {
        return sound;
      }
    }
    for (const sound of this.sounds) {
      if (sound.name === key) {
        return sound;
      }
    }
    return null;
  }

  addClone(source: Entity): Entity {
    const clone = new Entity(this, true);
    clone.x = source.x;
    clone.y = source.y;
    clone.regX = source.regX;
    clone.regY = source.regY;
    clone.scaleX = source.scaleX;
    clone.scaleY = source.scaleY;
    clone.scaleOriginX = source.scaleOriginX;
    clone.scaleOriginY = source.scaleOriginY;
    clone.rotation = source.rotation;
    clone.direction = source.direction;
    clone.width = source.width;
    clone.height = source.height;
    clone.visible = source.visible;
    clone.picture = source.picture;
    clone.effect = { ...source.effect };
    clone.text = source.text;
    clone.colour = source.colour;
    clone.bgColor = source.bgColor;
    clone.fontSize = source.fontSize;
    clone.fontFamily = source.fontFamily;
    clone.fontBold = source.fontBold;
    clone.fontItalic = source.fontItalic;
    clone.underLine = source.underLine;
    clone.strike = source.strike;
    clone.textAlign = source.textAlign;
    clone.lineBreak = source.lineBreak;
    this.clones.push(clone);
    this.project.renderer?.addEntity(clone);
    return clone;
  }

  removeClone(clone: Entity): void {
    const index = this.clones.indexOf(clone);
    if (index >= 0) {
      this.clones.splice(index, 1);
    }
    this.project.stopThreadsOf(clone);
    this.project.renderer?.removeEntity(clone);
  }

  getClonedEntities(): Entity[] {
    return this.clones.slice();
  }

  /** The object's own entity first, then its clones — the order entry scans in. */
  forEachEntity(visit: (entity: Entity) => void): void {
    visit(this.entity);
    const clones = this.clones;
    for (let i = 0; i < clones.length; i += 1) {
      visit(clones[i]!);
    }
  }
}

export type VariableKind = 'variable' | 'list' | 'slide' | 'timer' | 'answer';

export class Variable {
  readonly id: string;
  readonly name: string;
  readonly objectId: string | null;
  readonly kind: VariableKind;
  readonly isList: boolean;
  readonly isSlide: boolean;
  value: string | number = 0;
  array: Array<{ data: string | number }> = [];
  visible = false;
  x = 0;
  y = 0;
  width = 100;
  height = 120;
  minValue = 0;
  maxValue = 100;
  /** Snapshot taken when the project starts, restored on stop. */
  private snapshotValue: string | number = 0;
  private snapshotArray: Array<{ data: string | number }> = [];
  private snapshotVisible = false;

  constructor(id: string, name: string, objectId: string | null, kind: VariableKind) {
    this.id = id;
    this.name = name;
    this.objectId = objectId;
    this.kind = kind;
    this.isList = kind === 'list';
    this.isSlide = kind === 'slide';
  }

  getValue(): string | number {
    return this.value;
  }

  setValue(value: string | number): void {
    if (this.isSlide) {
      const n = num(value);
      this.value = clamp(n, this.minValue, this.maxValue);
      return;
    }
    this.value = value;
  }

  /** `Entry.Variable.isNumber` — decides whether `change_variable` adds or joins. */
  isNumber(): boolean {
    return !isNaN(Number(this.value)) && String(this.value).trim() !== '';
  }

  getArray(): Array<{ data: string | number }> {
    return this.array;
  }

  takeSnapshot(): void {
    this.snapshotValue = this.value;
    this.snapshotArray = this.array.map((item) => ({ data: item.data }));
    this.snapshotVisible = this.visible;
  }

  loadSnapshot(): void {
    this.value = this.snapshotValue;
    this.array = this.snapshotArray.map((item) => ({ data: item.data }));
    this.visible = this.snapshotVisible;
  }
}

export interface CompiledScript {
  /** Event that starts it: `start`, `when_message_cast`, … */
  event: string;
  /** Message id, key code, or whatever the hat block filters on. */
  filter: string | null;
  /** Generator body produced by the compiler. */
  body: ScriptBody;
  /** Block id of the hat, for error reporting. */
  blockId: string;
}

export type ScriptBody = (entity: Entity, thread: Thread) => Generator<number, void, unknown>;

/** One running script — entry's `Entry.Executor`. */
export class Thread {
  readonly target: Target;
  readonly entity: Entity;
  readonly script: CompiledScript;
  iterator: Generator<number, void, unknown>;
  done = false;
  /** True while this thread's generator is on the stack. */
  running = false;
  /** Scratch space the compiled body keeps between frames. */
  state: Record<string, unknown> = {};

  constructor(target: Target, entity: Entity, script: CompiledScript) {
    this.target = target;
    this.entity = entity;
    this.script = script;
    this.iterator = script.body(entity, this);
  }

  step(): void {
    if (this.done || this.running) {
      return;
    }
    this.running = true;
    try {
      const result = this.iterator.next();
      if (result.done) {
        this.done = true;
      }
    } finally {
      this.running = false;
    }
  }

  /**
   * A thread can be told to stop from inside its own body (`stop_object`,
   * scene changes), and a generator cannot be closed while it is running —
   * marking it done is enough, the frame it is in returns on its own.
   */
  stop(): void {
    this.done = true;
    if (!this.running) {
      this.iterator.return?.(undefined as never);
    }
  }
}

export interface RendererLike {
  addEntity(entity: Entity): void;
  removeEntity(entity: Entity): void;
  flush(): void;
}

export interface Scene {
  id: string;
  name: string;
}

/** Everything the running project holds. Declared here so `Target` can reach back. */
export interface Project {
  scenes: Scene[];
  targets: Target[];
  renderer: RendererLike | null;
  stopped: boolean;
  stopThreadsOf(entity: Entity): void;
}
