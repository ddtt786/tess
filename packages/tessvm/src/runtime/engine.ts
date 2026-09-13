/**
 * @fileoverview 작품을 실제로 돌리는 실행 엔진입니다.
 *
 * 엔트리의 `Entry.engine.update` 한 틱과 같은 일을 합니다 — 지금 장면의 오브젝트를
 * 순서대로 훑으면서 그 오브젝트에 붙은 스레드를 한 번씩 진행시킵니다. 다른 점은 각
 * 스레드가 블록 트리를 해석하는 대신 미리 컴파일해 둔 제너레이터라는 것뿐입니다.
 */
import { Codegen, type CompileInput, type RawBlock, type ScriptPlan } from '../compile/codegen.ts';
import { CollisionSystem } from '../collision/detect.ts';
import { MaskStore, type AlphaMask } from '../collision/mask.ts';
import * as cast from './cast.ts';
import {
  Entity,
  Target,
  Thread,
  Variable,
  initialEffects,
  parseFont,
  setStageSize,
  type VariableKind,
  type VoiceProps,
  type CompiledScript,
  type Picture,
  type Project,
  type RendererLike,
  type Scene,
  type Sound,
} from './model.ts';
import { Table } from './table.ts';
import { ThreadStop, createOps, type Ops } from './ops.ts';

/**
 * Tick rate used when the project does not declare one. Entry drives its loop
 * with `setInterval(Math.floor(1000 / Entry.FPS))`, so its real cadence sits a
 * little above the nominal number.
 */
export const DEFAULT_FPS = 64;
export const MAX_CLONES = 360;

export interface EntryProjectLike {
  objects: Array<Record<string, unknown>>;
  scenes: Array<{ id: string; name: string }>;
  variables: Array<Record<string, unknown>>;
  messages: Array<{ id: string; name: string }>;
  functions: Array<Record<string, unknown>>;
  tables?: Array<Record<string, unknown>>;
  speed?: number;
  name?: string;
}

/** Reads text aloud for the TTS blocks; resolves when the reading ends. */
export interface SpeechEngine {
  speak(text: string, voice: VoiceProps): Promise<void>;
  stop(): void;
  pause?(): void;
  resume?(): void;
}

/**
 * Answers the `번역` blocks. Entry asks its own papago service and takes a
 * default answer when nothing comes back within three seconds, so an
 * implementation carries its own deadline rather than leaving a script waiting.
 */
export interface Translator {
  /** The text in `target`, or an empty string where nothing could be had. */
  translate(text: string, source: string, target: string): Promise<string>;
  /** The language code the text was written in, or an empty string. */
  detect(text: string): Promise<string>;
}

/** Measures a text box exactly the way the renderer will draw it. */
export interface TextMeasurer {
  measureTextBox(entity: Entity): { width: number; height: number } | null;
}

export interface Renderer extends RendererLike, Partial<TextMeasurer> {
  /** Called once per project load, before any entity is added. */
  attach?(targets: Target[], scenes: Scene[]): void;
  /** `FRONT` · `BACK` · `FORWARD` · `BACKWARD`, as the block names them. */
  moveEntity?(entity: Entity, location: string): void;
  /**
   * The scene's entities in the order they are drawn, front-most first.
   * `오브젝트 순서 바꾸기` moves an object within that order, so a click has to
   * be looked for in it rather than in the order the work declared its objects.
   */
  drawOrder?(sceneId: string): Entity[];
  syncDialog?(entity: Entity): void;
  /** `테이블 창 열기` — the table to show, or null to close the window. */
  showTable?(table: Table | null): void;
  stamp?(entity: Entity): void;
  eraseAll?(entity: Entity): void;
  penChanged?(entity: Entity): void;
  showQuestion?(text: string): void;
  hideQuestion?(): void;
  answerSubmitted?(): string | null;
  maskFor?(pictureId: string, width: number, height: number): AlphaMask | null;
  reset?(): void;
  setScene?(sceneId: string): void;
}

export interface AudioEngine {
  play(sound: Sound, entityId: string, startMs?: number, durationMs?: number): void;
  playBgm(sound: Sound): void;
  stopBgm(): void;
  stopAll(): void;
  stopEntity(entityId: string): void;
  stopExcept(entityId: string): void;
  /** Holds what is playing where it is; `resume` picks it back up. */
  pause?(): void;
  resume?(): void;
  setVolume(volume: number): void;
  getVolume(): number;
  setSpeed(speed: number): void;
  getSpeed(): number;
}

/** Who the work is running for; `null` where nobody is signed in. */
export interface EntryUser {
  /** `아이디` — entry's `window.user.username`, unmasked. */
  id: string;
  /** `닉네임` — entry's `window.user.nickname`. */
  nickname: string;
}

/** What `아이디` and `닉네임` answer when nobody is signed in. */
export const GUEST = 'guest';

/** How often a running work writes its shared and real-time variables out. */
const STORE_FLUSH_MS = 1000;

/** Characters of an id left in the clear. */
const KEPT = 2;

/** `abcdef` → `ab****`, the way playentry shows someone else's id. */
export function maskedUserId(id: string): string {
  return id.slice(0, KEPT) + '*'.repeat(Math.max(0, id.length - KEPT));
}

export interface VmOptions {
  renderer?: Renderer | null;
  audio?: AudioEngine | null;
  speech?: SpeechEngine | null;
  /** Answers the `번역` blocks; without one they answer as entry does offline. */
  translator?: Translator | null;
  /** Overrides the project's own `speed`. Leave unset to follow the project. */
  fps?: number;
  /** Stage size in entry units; entry's own stage is 480×270. */
  stageWidth?: number;
  stageHeight?: number;
  /**
   * What `boost_mode?` answers. On by default: boost mode is entry's switch
   * between its 2D and WebGL renderers, and tessvm only has the WebGL one, so
   * the flag is the whole of it here. Works that check it do so to tell the
   * player to turn it on.
   */
  boost?: boolean;
  deviceType?: 'desktop' | 'tablet' | 'mobile';
  touch?: boolean;
  /**
   * Who `아이디`(`get_user_name`) and `닉네임`(`get_nickname`) answer with.
   * Entry reads `window.user`, which only the site itself fills in, so a runner
   * outside it leaves this unset and both blocks answer `guest`.
   */
  user?: EntryUser | null;
  /** Hides all but the first two letters of the id. On unless turned off. */
  maskUserId?: boolean;
  /** Ticks per frame ceiling when catching up on lost time. */
  maxCatchUp?: number;
  /** Where shared and real-time variables are kept between runs. */
  store?: VariableStore | null;
}

/**
 * Standing storage for the work's shared (`isCloud`) and real-time variables.
 *
 * Entry keeps these on its server, so they hold what the last run left and
 * every player of the work sees the same value. A runner outside the site puts
 * them wherever it can — the browser's own storage — and one with nowhere to
 * put them leaves this unset, which still keeps them across a stop and start.
 */
export interface VariableStore {
  /** Value of one variable, or undefined when nothing is stored for it. */
  read(key: string): string | number | Array<{ data: string | number }> | undefined;
  write(key: string, value: string | number | Array<{ data: string | number }>): void;
}

export interface VmError {
  message: string;
  blockId: string | null;
  targetId: string | null;
}

export class Vm implements Project {
  scenes: Scene[] = [];
  targets: Target[] = [];
  variables: Variable[] = [];
  messages: Array<{ id: string; name: string }> = [];
  tables: Table[] = [];
  speech: SpeechEngine | null;
  translator: Translator | null;
  renderer: Renderer | null;
  audio: AudioEngine | null;
  readonly cast = cast;
  readonly masks: MaskStore;
  readonly collision: CollisionSystem;
  ops!: Ops;

  /** `Entry.FPS` — drives the tick step and every `초` → 프레임 conversion. */
  frameRate: number;
  boost: boolean;
  deviceType: 'desktop' | 'tablet' | 'mobile';
  touch: boolean;
  user: EntryUser | null;
  maskUserId: boolean;

  state: 'stop' | 'run' | 'pause' = 'stop';
  currentSceneId = '';
  /** Milliseconds of running time; frozen while paused or stopped. */
  clock = 0;
  frame = 0;
  answer: string | number = '';
  answerVisible = true;
  question: string | null = null;
  /** Set by the renderer when the viewer submits an answer. */
  pendingAnswer: string | null = null;
  pressedKeys = new Set<number>();
  mouseX = 0;
  mouseY = 0;
  mouseDown = false;
  clickedEntityId: string | null = null;
  /** The table whose window stands open, and when it closes itself. */
  private shownTable: Table | null = null;
  private tableCloseAt: number | null = null;
  errors: VmError[] = [];
  /** Called right after an error is recorded, for the debug panel to report it. */
  onError: ((error: VmError) => void) | null = null;

  /** `Entry.engine.projectTimer` — off until a `초시계 시작하기` block runs. */
  private timerInit = false;
  private timerPaused = false;
  private timerStart = 0;
  private timerBase = 0;
  timerVisible = false;

  /** Messages sent this frame, raised once the frame is over. */
  private pendingMessages: string[] = [];

  private scripts: CompiledScript[] = [];
  private plans: ScriptPlan[] = [];
  private targetById = new Map<string, Target>();
  private variableById = new Map<string, number>();
  private sceneById = new Map<string, Scene>();
  private lastTime = 0;
  private accumulator = 0;
  private readonly maxCatchUp: number;
  private readonly requestedFps: number | undefined;
  private store: VariableStore | null;
  /** Shared and real-time variables, the only ones the store holds. */
  private storedVars: Variable[] = [];
  /** Last text written for each stored variable, so an unmoved one is skipped. */
  private readonly written = new Map<string, string>();
  private lastStoreFlush = 0;
  unknownBlocks = new Map<string, number>();

  constructor(options: VmOptions = {}) {
    this.renderer = options.renderer ?? null;
    this.audio = options.audio ?? null;
    this.speech = options.speech ?? null;
    this.translator = options.translator ?? null;
    this.requestedFps = options.fps;
    this.frameRate = options.fps ?? DEFAULT_FPS;
    if (options.stageWidth && options.stageHeight) {
      setStageSize(options.stageWidth, options.stageHeight);
    }
    this.boost = options.boost ?? true;
    this.deviceType = options.deviceType ?? 'desktop';
    this.touch = options.touch ?? false;
    this.user = options.user ?? null;
    this.maskUserId = options.maskUserId ?? true;
    this.maxCatchUp = options.maxCatchUp ?? 4;
    this.store = options.store ?? null;
    this.masks = new MaskStore(
      (key, width, height) => this.renderer?.maskFor?.(key, width, height) ?? null,
    );
    this.collision = new CollisionSystem(this.masks);
    this.ops = createOps(this);
  }

  get stopped(): boolean {
    return this.state === 'stop';
  }

  measureTextBox(entity: Entity): { width: number; height: number } | null {
    return this.renderer?.measureTextBox?.(entity) ?? null;
  }

  // -------------------------------------------------------------------------
  //  Loading
  // -------------------------------------------------------------------------
  load(project: EntryProjectLike): void {
    // `Entry.FPS = project.speed ? project.speed : 60` — a work can ask for a
    // slower loop, and every timed block counts frames at that rate.
    this.frameRate = this.requestedFps ?? (Number(project.speed) || DEFAULT_FPS);
    this.scenes = project.scenes.map((scene) => ({ id: scene.id, name: scene.name }));
    this.sceneById = new Map(this.scenes.map((scene) => [scene.id, scene]));
    this.currentSceneId = this.scenes[0]?.id ?? '';
    this.messages = project.messages.map((message) => ({ id: message.id, name: message.name }));
    this.tables = (project.tables ?? []).map((raw) => Table.from(raw as never));

    this.answerVisible = false;
    this.timerVisible = false;
    this.variables = project.variables.map((raw) => {
      const type = String(raw.variableType ?? 'variable') as VariableKind;
      const variable = new Variable(
        String(raw.id),
        String(raw.name ?? ''),
        (raw.object as string | null) ?? null,
        type,
      );
      if (type === 'answer') {
        this.answerVisible = Boolean(raw.visible);
      } else if (type === 'timer') {
        this.timerVisible = Boolean(raw.visible);
      }
      variable.isCloud = Boolean(raw.isCloud);
      variable.isRealTime = Boolean(raw.isRealTime);
      variable.value = (raw.value as string | number) ?? 0;
      variable.array = ((raw.array as Array<{ data: string | number }>) ?? []).map((item) => ({
        data: item.data,
      }));
      variable.visible = Boolean(raw.visible);
      variable.x = Number(raw.x ?? 0);
      variable.y = Number(raw.y ?? 0);
      variable.width = Number(raw.width ?? 100);
      variable.height = Number(raw.height ?? 120);
      variable.minValue = Number(raw.minValue ?? 0);
      variable.maxValue = Number(raw.maxValue ?? 100);
      return variable;
    });
    this.variableById = new Map(this.variables.map((variable, index) => [variable.id, index]));
    this.storedVars = this.variables.filter((variable) => variable.isStored);
    this.readStore();

    this.targets = [];
    this.targetById.clear();
    project.objects.forEach((raw, index) => {
      const target = new Target(
        this,
        String(raw.id),
        String(raw.name ?? ''),
        (raw.objectType as 'sprite' | 'textBox') ?? 'sprite',
        String(raw.scene ?? this.currentSceneId),
        String(raw.rotateMethod ?? 'free'),
      );
      target.index = index;
      const sprite = (raw.sprite as { pictures?: Picture[]; sounds?: Sound[] }) ?? {};
      target.pictures = (sprite.pictures ?? []).map((picture) => ({
        id: picture.id,
        name: picture.name,
        fileurl: picture.fileurl,
        pngurl: picture.pngurl,
        dimension: picture.dimension ?? { width: 0, height: 0 },
        imageType: picture.imageType,
      }));
      target.sounds = (sprite.sounds ?? []).map((sound) => ({
        id: sound.id,
        name: sound.name,
        fileurl: sound.fileurl,
        duration: Number(sound.duration ?? 0),
      }));
      const selected = raw.selectedPictureId as string | undefined;
      target.defaultPicture =
        (selected ? target.pictures.find((picture) => picture.id === selected) : null) ??
        target.pictures[0] ??
        null;
      target.entity = this.makeEntity(target, raw.entity as Record<string, unknown>, raw);
      this.targets.push(target);
      this.targetById.set(target.id, target);
    });

    this.compile(project);
    this.snapshot();
    this.renderer?.attach?.(this.targets, this.scenes);
    for (const target of this.targets) {
      target.entity.measure();
      this.renderer?.addEntity(target.entity);
    }
    this.renderer?.setScene?.(this.currentSceneId);
  }

  private makeEntity(
    target: Target,
    model: Record<string, unknown> | undefined,
    raw: Record<string, unknown>,
  ): Entity {
    const entity = new Entity(target, false);
    const m = model ?? {};
    entity.x = Number(m.x ?? 0);
    entity.y = Number(m.y ?? 0);
    entity.regX = Number(m.regX ?? 0);
    entity.regY = Number(m.regY ?? 0);
    entity.scaleX = Number(m.scaleX ?? 1);
    entity.scaleY = Number(m.scaleY ?? 1);
    entity.scaleOriginX = entity.scaleX;
    entity.scaleOriginY = entity.scaleY;
    entity.rotation = Number(m.rotation ?? 0);
    entity.direction = Number(m.direction ?? 90);
    entity.width = Number(m.width ?? 0);
    entity.height = Number(m.height ?? 0);
    entity.visible = m.visible !== false;
    entity.effect = initialEffects();
    if (target.objectType === 'textBox') {
      entity.text = String(raw.text ?? m.text ?? '');
      entity.colour = String(m.colour ?? '#000000');
      entity.bgColor = String(m.bgColor ?? 'transparent');
      entity.textAlign = Number(m.textAlign ?? 0);
      entity.lineBreak = Boolean(m.lineBreak);
      entity.underLine = Boolean(m.underLine);
      entity.strike = Boolean(m.strike);
      const font = parseFont(String(m.font ?? '20px Nanum Gothic'));
      entity.fontSize = font.size;
      entity.fontFamily = font.family;
      entity.fontBold = font.bold;
      entity.fontItalic = font.italic;
    } else {
      entity.picture = target.defaultPicture;
      if (entity.picture && !entity.width) {
        entity.width = entity.picture.dimension.width;
        entity.height = entity.picture.dimension.height;
      }
    }
    return entity;
  }

  private compile(project: EntryProjectLike): void {
    const input: CompileInput = {
      objects: project.objects.map((raw) => ({
        id: String(raw.id),
        script: raw.script as string | RawBlock[][],
      })),
      variables: this.variables.map((variable) => ({ id: variable.id })),
      functions: project.functions.map((fn) => ({
        id: String(fn.id),
        type: String(fn.type ?? 'normal'),
        localVariables:
          (fn.localVariables as Array<{ id: string; name: string; value: string | number }>) ?? [],
        content: fn.content as string | RawBlock[][],
      })),
      scenes: this.scenes,
      messages: this.messages,
      tables: this.tables,
    };
    const codegen = new Codegen(input);
    const program = codegen.compile();
    this.unknownBlocks = program.unknown;
    const factory = new Function('R', program.source) as (
      runtime: Vm,
    ) => { scripts: CompiledScript['body'][] };
    const built = factory(this);
    this.plans = program.plans;
    this.scripts = program.plans.map((plan) => ({
      event: plan.event,
      filter: plan.filter,
      blockId: plan.blockId,
      body: built.scripts[plan.index]!,
    }));
    for (const target of this.targets) {
      target.scripts = [];
    }
    program.plans.forEach((plan, index) => {
      this.targets[plan.targetIndex]?.scripts.push(this.scripts[index]!);
    });
  }

  /** Generated source, for `tessvm build --emit-js` and for debugging. */
  compiledSource(project: EntryProjectLike): string {
    const input: CompileInput = {
      objects: project.objects.map((raw) => ({
        id: String(raw.id),
        script: raw.script as string | RawBlock[][],
      })),
      variables: this.variables.map((variable) => ({ id: variable.id })),
      functions: project.functions.map((fn) => ({
        id: String(fn.id),
        type: String(fn.type ?? 'normal'),
        localVariables:
          (fn.localVariables as Array<{ id: string; name: string; value: string | number }>) ?? [],
        content: fn.content as string | RawBlock[][],
      })),
      scenes: this.scenes,
      messages: this.messages,
      tables: this.tables,
    };
    return new Codegen(input).compile().source;
  }

  // -------------------------------------------------------------------------
  //  Lookup
  // -------------------------------------------------------------------------
  targetOf(id: string): Target | null {
    return this.targetById.get(id) ?? null;
  }

  entityOf(id: string): Entity | null {
    return this.targetById.get(id)?.entity ?? null;
  }

  /**
   * The entity a press at these stage coordinates lands on, or null.
   *
   * Entry reads the stage's own display list to find what was clicked, so an
   * object that `오브젝트 순서 바꾸기` moved to the front takes the click from
   * whatever it now covers. The renderer holds that list; the order the work
   * declared its objects in stands in only while there is no renderer to ask.
   */
  entityAtPoint(worldX: number, worldY: number): Entity | null {
    const scene = this.currentSceneId;
    const drawn = this.renderer?.drawOrder?.(scene);
    const order = drawn?.length
      ? drawn
      : this.targets
          .filter((target) => target.sceneId === scene)
          .flatMap((target) => [target.entity, ...target.clones]);
    for (const entity of order) {
      if (this.collision.touchingMouse(entity, worldX, worldY)) {
        return entity;
      }
    }
    return null;
  }

  /** Hat blocks that answer a press on the object itself. */
  private static readonly CLICK_EVENTS = ['when_object_click', 'when_object_click_canceled'];

  /**
   * Whether a press at these stage coordinates would start a script. The page
   * shows the reader a pointer over such a spot; a work that is not running has
   * none, since nothing would answer the press.
   */
  clickableAt(worldX: number, worldY: number): boolean {
    if (this.state !== 'run') {
      return false;
    }
    const entity = this.entityAtPoint(worldX, worldY);
    return Boolean(
      entity?.target.scripts.some((script) => Vm.CLICK_EVENTS.includes(script.event)),
    );
  }

  variableAt(index: number, entity: Entity): Variable | null {
    const shared = this.variables[index];
    if (!shared) {
      return null;
    }
    if (shared.objectId && entity.isClone) {
      return entity.localVars?.[index] ?? shared;
    }
    return shared;
  }

  sceneOf(id: string): Scene | null {
    return this.sceneById.get(id) ?? null;
  }

  currentTargets(): Target[] {
    const scene = this.currentSceneId;
    return this.targets.filter((target) => target.sceneId === scene);
  }

  // -------------------------------------------------------------------------
  //  Shared and real-time variables
  // -------------------------------------------------------------------------
  /** Puts back what the store holds, over the values the work was saved with. */
  readStore(): void {
    this.written.clear();
    if (!this.store) {
      return;
    }
    for (const variable of this.storedVars) {
      const saved = this.store.read(variable.id);
      if (saved === undefined) {
        continue;
      }
      if (variable.isList && Array.isArray(saved)) {
        variable.array = saved.map((item) => ({ data: item.data }));
      } else if (!variable.isList && !Array.isArray(saved)) {
        variable.value = saved;
      }
      this.written.set(variable.id, JSON.stringify(saved));
    }
  }

  /**
   * Hands the store every shared or real-time variable that moved since the
   * last write. Called on a beat while the work runs and once more when it
   * stops, so the value that outlives the run is the one the work left.
   */
  flushStore(): void {
    if (!this.store) {
      return;
    }
    for (const variable of this.storedVars) {
      const value = variable.isList
        ? variable.array.map((item) => ({ data: item.data }))
        : variable.value;
      const text = JSON.stringify(value);
      if (this.written.get(variable.id) === text) {
        continue;
      }
      this.written.set(variable.id, text);
      this.store.write(variable.id, value);
    }
  }

  // -------------------------------------------------------------------------
  //  Running
  // -------------------------------------------------------------------------
  private snapshot(): void {
    for (const variable of this.variables) {
      variable.takeSnapshot();
    }
    for (const target of this.targets) {
      takeEntitySnapshot(target.entity);
    }
  }

  start(): void {
    if (this.state === 'run') {
      return;
    }
    if (this.state === 'pause') {
      this.state = 'run';
      this.lastTime = 0;
      // `Entry.Utils.recoverSoundInstances` — what was held goes on from there.
      this.audio?.resume?.();
      this.speech?.resume?.();
      return;
    }
    this.reset();
    this.state = 'run';
    this.clock = 0;
    this.lastStoreFlush = 0;
    this.frame = 0;
    this.lastTime = 0;
    this.accumulator = 0;
    this.clearTimer();
    this.fireEvent('start');
  }

  stop(): void {
    this.state = 'stop';
    this.pendingMessages = [];
    this.flushStore();
    for (const target of this.targets) {
      for (const thread of target.threads) {
        thread.stop();
      }
      target.threads = [];
    }
    this.audio?.stopAll();
    this.audio?.stopBgm();
    this.speech?.stop();
    // Stopping out of a pause has to lift the pause as well: nothing is being
    // held any more, and an audio context left suspended makes the next run
    // silent all the way through.
    this.audio?.resume?.();
    this.speech?.resume?.();
    this.clearQuestion();
  }

  pause(): void {
    if (this.state === 'run') {
      // The clock stops with the engine, so the project timer stops with it too.
      this.state = 'pause';
      // `Entry.engine.togglePause` holds the sounds rather than ending them.
      this.audio?.pause?.();
      this.speech?.pause?.();
    }
  }

  /** Puts every entity, clone and variable back to its saved state. */
  reset(): void {
    for (const target of this.targets) {
      for (const clone of target.clones.slice()) {
        this.renderer?.removeEntity(clone);
      }
      target.clones = [];
      target.threads = [];
      this.resetEntity(target.entity);
    }
    for (const variable of this.variables) {
      variable.loadSnapshot();
    }
    this.answer = '';
    this.errors = [];
    this.pendingMessages = [];
    this.openTable(null);
    this.currentSceneId = this.scenes[0]?.id ?? '';
    this.audio?.setVolume(1);
    this.audio?.setSpeed(1);
    this.clearTimer();
    this.renderer?.setScene?.(this.currentSceneId);
    this.clearQuestion();
  }

  /** Drives the engine from a real timestamp, keeping a fixed 60 Hz tick. */
  advance(timestamp: number): void {
    if (this.state !== 'run') {
      this.lastTime = timestamp;
      return;
    }
    const step = 1000 / this.frameRate;
    if (!this.lastTime) {
      this.lastTime = timestamp - step;
    }
    this.accumulator += Math.min(timestamp - this.lastTime, step * this.maxCatchUp);
    this.lastTime = timestamp;
    let ticks = 0;
    // A throw from outside a script — the renderer, the collision store, a lost
    // webgl context — used to leave the frame driver. The driver queues the next
    // frame before this one runs, so nothing stopped: the work froze on its last
    // painted frame and threw again every frame, with nothing said about it.
    try {
      while (this.accumulator >= step && ticks < this.maxCatchUp) {
        this.accumulator -= step;
        this.tick(step);
        ticks += 1;
        if (this.state !== 'run') {
          break;
        }
      }
      this.renderer?.flush();
    } catch (error) {
      this.fail(error);
    }
  }

  /**
   * Ends the run on a failure that is not one script's — the frame itself could
   * not be finished, so there is nothing to carry on with. Reported the same way
   * a script error is, which is what puts it on screen.
   */
  fail(error: unknown, blockId: string | null = null, targetId: string | null = null): void {
    const record: VmError = {
      message: error instanceof Error ? error.message : String(error),
      blockId,
      targetId,
    };
    this.errors.push(record);
    this.stop();
    // The message alone rarely says where a frame-level throw came from, and the
    // host only gets the message; the console keeps the stack.
    console.error('[tessvm] 프레임을 끝내지 못했습니다', error);
    this.onError?.(record);
  }

  /** One engine frame. */
  tick(deltaMs = 1000 / this.frameRate): void {
    this.clock += deltaMs;
    this.frame += 1;
    // `Entry.engine.setTimeout` — a window opened for so many seconds closes
    // itself, and the engine's own clock is what counts them.
    if (this.tableCloseAt !== null && this.clock >= this.tableCloseAt) {
      this.openTable(null);
    }
    if (this.clock - this.lastStoreFlush >= STORE_FLUSH_MS) {
      this.lastStoreFlush = this.clock;
      this.flushStore();
    }
    this.collision.beginFrame();
    const scene = this.currentSceneId;
    const targets = this.targets;
    for (let i = 0; i < targets.length; i += 1) {
      const target = targets[i]!;
      if (target.sceneId !== scene) {
        continue;
      }
      const threads = target.threads;
      for (let j = 0; j < threads.length; j += 1) {
        const thread = threads[j]!;
        if (thread.done) {
          threads.splice(j, 1);
          j -= 1;
          continue;
        }
        this.runThread(thread);
      }
    }
    this.flushMessages();
  }

  private runThread(thread: Thread): void {
    try {
      thread.step();
    } catch (error) {
      thread.done = true;
      if (error instanceof ThreadStop) {
        // The script asked to end itself; that is not a failure.
        return;
      }
      const record: VmError = {
        message: error instanceof Error ? error.message : String(error),
        blockId: thread.script.blockId,
        targetId: thread.target.id,
      };
      this.errors.push(record);
      this.onError?.(record);
    }
  }

  // -------------------------------------------------------------------------
  //  Events
  // -------------------------------------------------------------------------
  /** Starts every matching script on every entity of the current scene. */
  fireEvent(event: string, filter?: string): Thread[] {
    if (this.state !== 'run' && event !== 'start') {
      return [];
    }
    const started: Thread[] = [];
    for (const target of this.targets) {
      if (target.sceneId !== this.currentSceneId) {
        continue;
      }
      target.forEachEntity((entity) => {
        started.push(...this.startScripts(target, entity, event, filter));
      });
    }
    return started;
  }

  /**
   * `신호 보내기` — `message_cast` hands the raise to `setTimeout`, so entry
   * starts the receivers after the frame that sent it, not inside it. Anything
   * the sender does next in that frame — a scene restart above all — therefore
   * happens before a single receiver exists. `신호 보내고 기다리기` raises on
   * the spot instead, which is why only this one is queued.
   */
  queueMessage(id: string): void {
    this.pendingMessages.push(id);
  }

  /** Raises the frame's queued messages, on the scene the frame ended in. */
  private flushMessages(): void {
    if (!this.pendingMessages.length) {
      return;
    }
    const queued = this.pendingMessages;
    this.pendingMessages = [];
    for (const id of queued) {
      this.fireEvent('when_message_cast', id);
    }
  }

  /** Same, but only for the one entity that the event happened to. */
  fireEventOn(event: string, entity: Entity, filter?: string): Thread[] {
    if (this.state !== 'run') {
      return [];
    }
    return this.startScripts(entity.target, entity, event, filter);
  }

  private startScripts(target: Target, entity: Entity, event: string, filter?: string): Thread[] {
    const started: Thread[] = [];
    for (const script of target.scripts) {
      if (script.event !== event) {
        continue;
      }
      if (filter !== undefined && script.filter !== null && script.filter !== filter) {
        continue;
      }
      const thread = new Thread(target, entity, script);
      target.threads.push(thread);
      started.push(thread);
    }
    return started;
  }

  /**
   * `Entry.Code.clearExecutorsByEntity` — the threads are only marked ended;
   * `tick` drops them on its next pass. Splicing here would pull the threads
   * behind them into slots the running loop has already gone past, so those
   * would sit out the frame — a whole batch of clones deleting themselves
   * would then need one frame per pair instead of one frame in total.
   */
  stopThreadsOf(entity: Entity): void {
    for (const thread of entity.target.threads) {
      if (thread.entity === entity) {
        thread.stop();
      }
    }
  }

  // -------------------------------------------------------------------------
  //  Scenes and clones
  // -------------------------------------------------------------------------
  selectScene(id: string): void {
    const scene = this.sceneById.get(id);
    if (!scene || scene.id === this.currentSceneId) {
      if (scene) {
        this.resetSceneDuringRun(scene.id);
      }
      return;
    }
    this.resetSceneDuringRun(this.currentSceneId);
    this.currentSceneId = scene.id;
    // `Entry.scene.selectScene` — leaving a scene silences the sounds it left
    // running. The scripts that started them are gone with the scene, so
    // nothing is left that could stop them later. Background music carries
    // over: entry files it apart from the sounds this clears.
    if (this.state === 'run') {
      this.audio?.stopAll();
      this.speech?.stop();
    }
    this.renderer?.setScene?.(scene.id);
  }

  /**
   * `Entry.container.resetSceneDuringRun` — leaving a scene puts its objects
   * back the way they started: snapshot restored, effects and pen cleared,
   * clones gone, scripts stopped.
   */
  private resetSceneDuringRun(sceneId: string): void {
    for (const target of this.targets) {
      if (target.sceneId !== sceneId) {
        continue;
      }
      for (const thread of target.threads) {
        thread.stop();
      }
      target.threads = [];
      for (const clone of target.clones.slice()) {
        clone.removeClone();
      }
      this.resetEntity(target.entity);
    }
    // `Entry.stage.hideInputField` — the script that asked is gone with the
    // scene, so the box it was waiting on goes with it.
    this.clearQuestion();
  }

  /**
   * `DataTable.showTable` — puts a table's window up, or takes it down with
   * null. Entry's block does not hold the script while the window stands; a
   * window opened for a number of seconds closes itself when they are up.
   */
  openTable(table: Table | null, seconds?: number): void {
    this.shownTable = table;
    this.tableCloseAt = table && seconds ? this.clock + seconds * 1000 : null;
    this.renderer?.showTable?.(table);
  }

  /** Takes down the `묻고 기다리기` box and the answer it was waiting for. */
  private clearQuestion(): void {
    this.question = null;
    this.pendingAnswer = null;
    this.renderer?.hideQuestion?.();
  }

  /** `Entry.EntityObject.reset` — snapshot back, effects and drawings gone. */
  private resetEntity(entity: Entity): void {
    loadEntitySnapshot(entity);
    entity.effect = initialEffects();
    entity.dialog = null;
    entity.brush = null;
    entity.paint = null;
    entity.stamps = [];
    this.renderer?.syncDialog?.(entity);
    this.renderer?.eraseAll?.(entity);
    entity.touch();
  }

  addClone(target: Target, source: Entity): Entity | null {
    if (target.clones.length > MAX_CLONES) {
      return null;
    }
    const clone = target.addClone(source);
    if (source.localVars) {
      clone.localVars = source.localVars.map((variable) =>
        variable ? cloneVariable(variable) : undefined,
      );
    } else {
      clone.localVars = this.variables.map((variable) =>
        variable.objectId === target.id ? cloneVariable(variable) : undefined,
      );
    }
    this.startScripts(target, clone, 'when_clone_start');
    return clone;
  }

  // -------------------------------------------------------------------------
  //  Timer
  // -------------------------------------------------------------------------
  /** Back to the state a freshly loaded project has: stopped and reading 0. */
  clearTimer(): void {
    this.timerInit = false;
    this.timerPaused = false;
    this.timerBase = 0;
    this.timerStart = 0;
  }

  /** `초시계 시작하기` — starts it the first time, resumes it after a stop. */
  startTimer(): void {
    if (!this.timerInit) {
      this.timerInit = true;
      this.timerPaused = false;
      this.timerBase = 0;
      this.timerStart = this.clock;
      return;
    }
    if (this.timerPaused) {
      this.timerStart = this.clock - this.timerBase;
      this.timerPaused = false;
    }
  }

  /** `초시계 정지하기`. */
  pauseTimer(): void {
    if (this.timerInit && !this.timerPaused) {
      this.timerBase = this.clock - this.timerStart;
      this.timerPaused = true;
    }
  }

  /**
   * `Entry.engine.resetTimer` — does nothing before the timer has been started
   * once, and resetting a stopped timer puts it back to "never started".
   */
  resetTimer(): void {
    if (!this.timerInit) {
      return;
    }
    const wasPaused = this.timerPaused;
    this.timerBase = 0;
    this.timerStart = this.clock;
    if (wasPaused) {
      this.timerInit = false;
    }
  }

  timerValue(): number {
    if (!this.timerInit) {
      return 0;
    }
    const elapsed = this.timerPaused ? this.timerBase : this.clock - this.timerStart;
    return Math.max(elapsed / 1000, 0);
  }
}

interface EntitySnapshot {
  x: number;
  y: number;
  regX: number;
  regY: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  direction: number;
  width: number;
  height: number;
  visible: boolean;
  picture: Picture | null;
  text: string;
  textAlign: number;
  lineBreak: boolean;
  fontSize: number;
  fontBold: boolean;
  fontItalic: boolean;
  underLine: boolean;
  strike: boolean;
}

const snapshots = new WeakMap<Entity, EntitySnapshot>();

function takeEntitySnapshot(entity: Entity): void {
  snapshots.set(entity, {
    x: entity.x,
    y: entity.y,
    regX: entity.regX,
    regY: entity.regY,
    scaleX: entity.scaleX,
    scaleY: entity.scaleY,
    rotation: entity.rotation,
    direction: entity.direction,
    width: entity.width,
    height: entity.height,
    visible: entity.visible,
    picture: entity.picture,
    text: entity.text,
    textAlign: entity.textAlign,
    lineBreak: entity.lineBreak,
    fontSize: entity.fontSize,
    fontBold: entity.fontBold,
    fontItalic: entity.fontItalic,
    underLine: entity.underLine,
    strike: entity.strike,
  });
}

function loadEntitySnapshot(entity: Entity): void {
  const saved = snapshots.get(entity);
  if (!saved) {
    return;
  }
  Object.assign(entity, saved);
  entity.measure();
  entity.scaleOriginX = saved.scaleX;
  entity.scaleOriginY = saved.scaleY;
  entity.effect = initialEffects();
  entity.flip = false;
  entity.collision = 0;
}

function cloneVariable(source: Variable): Variable {
  const copy = new Variable(source.id, source.name, source.objectId, source.kind);
  copy.isCloud = source.isCloud;
  copy.isRealTime = source.isRealTime;
  copy.value = source.value;
  copy.array = source.array.map((item) => ({ data: item.data }));
  copy.visible = source.visible;
  copy.x = source.x;
  copy.y = source.y;
  copy.minValue = source.minValue;
  copy.maxValue = source.maxValue;
  return copy;
}
