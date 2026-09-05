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
  syncDialog?(entity: Entity): void;
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
  setVolume(volume: number): void;
  getVolume(): number;
  setSpeed(speed: number): void;
  getSpeed(): number;
}

export interface VmOptions {
  renderer?: Renderer | null;
  audio?: AudioEngine | null;
  speech?: SpeechEngine | null;
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
  /** Ticks per frame ceiling when catching up on lost time. */
  maxCatchUp?: number;
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
  errors: VmError[] = [];
  /** Called right after an error is recorded, for the debug panel to report it. */
  onError: ((error: VmError) => void) | null = null;

  /** `Entry.engine.projectTimer` — off until a `초시계 시작하기` block runs. */
  private timerInit = false;
  private timerPaused = false;
  private timerStart = 0;
  private timerBase = 0;
  timerVisible = false;

  private scripts: CompiledScript[] = [];
  private plans: ScriptPlan[] = [];
  private targetById = new Map<string, Target>();
  private variableById = new Map<string, number>();
  private sceneById = new Map<string, Scene>();
  private lastTime = 0;
  private accumulator = 0;
  private readonly maxCatchUp: number;
  private readonly requestedFps: number | undefined;
  unknownBlocks = new Map<string, number>();

  constructor(options: VmOptions = {}) {
    this.renderer = options.renderer ?? null;
    this.audio = options.audio ?? null;
    this.speech = options.speech ?? null;
    this.requestedFps = options.fps;
    this.frameRate = options.fps ?? DEFAULT_FPS;
    if (options.stageWidth && options.stageHeight) {
      setStageSize(options.stageWidth, options.stageHeight);
    }
    this.boost = options.boost ?? true;
    this.deviceType = options.deviceType ?? 'desktop';
    this.touch = options.touch ?? false;
    this.maxCatchUp = options.maxCatchUp ?? 4;
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
    this.tables = (project.tables ?? []).map(
      (raw) =>
        new Table(
          String(raw.id),
          String(raw.name ?? ''),
          (raw.fields as string[]) ?? [],
          (raw.data as Array<Array<string | number>>) ?? [],
        ),
    );

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
      return;
    }
    this.reset();
    this.state = 'run';
    this.clock = 0;
    this.frame = 0;
    this.lastTime = 0;
    this.accumulator = 0;
    this.clearTimer();
    this.fireEvent('start');
  }

  stop(): void {
    this.state = 'stop';
    for (const target of this.targets) {
      for (const thread of target.threads) {
        thread.stop();
      }
      target.threads = [];
    }
    this.audio?.stopAll();
    this.audio?.stopBgm();
  }

  pause(): void {
    if (this.state === 'run') {
      // The clock stops with the engine, so the project timer stops with it too.
      this.state = 'pause';
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
    this.question = null;
    this.pendingAnswer = null;
    this.errors = [];
    this.currentSceneId = this.scenes[0]?.id ?? '';
    this.audio?.setVolume(1);
    this.audio?.setSpeed(1);
    this.clearTimer();
    this.renderer?.setScene?.(this.currentSceneId);
    this.renderer?.hideQuestion?.();
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
    while (this.accumulator >= step && ticks < this.maxCatchUp) {
      this.accumulator -= step;
      this.tick(step);
      ticks += 1;
      if (this.state !== 'run') {
        break;
      }
    }
    this.renderer?.flush();
  }

  /** One engine frame. */
  tick(deltaMs = 1000 / this.frameRate): void {
    this.clock += deltaMs;
    this.frame += 1;
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
  copy.value = source.value;
  copy.array = source.array.map((item) => ({ data: item.data }));
  copy.visible = source.visible;
  copy.x = source.x;
  copy.y = source.y;
  copy.minValue = source.minValue;
  copy.maxValue = source.maxValue;
  return copy;
}
