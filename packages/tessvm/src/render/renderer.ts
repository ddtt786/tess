/**
 * @fileoverview PixiJS 로 무대를 그리는 렌더러입니다.
 *
 * 무대 좌표계는 엔트리와 같습니다 — 640×360 컨테이너를 (320,180) 에 두고 4/3 배로
 * 키운 것이라, 엔트리가 픽셀 값으로 박아 둔 위치들이 그대로 맞습니다. 화질은 그 위에
 * `renderer.resolution` 으로만 올리므로 좌표는 건드리지 않고 선명해집니다.
 *
 * 상태 반영은 프레임 끝에 한 번만 합니다. VM 은 좌표를 바꿀 때 `entity.dirty` 만
 * 세우고, `flush()` 가 그 프레임에 실제로 달라진 것만 PIXI 에 옮깁니다.
 */
import {
  Application,
  Assets,
  CanvasTextMetrics,
  TextStyle,
  ColorMatrixFilter,
  Container,
  Graphics,
  Sprite,
  Text,
  Texture,
} from 'pixi.js';
import { stage, type Entity, type Picture, type Target } from '../runtime/model.ts';
import type { Renderer } from '../runtime/engine.ts';
import { buildMask } from '../collision/mask-image.ts';
import type { AlphaMask } from '../collision/mask.ts';
import { Overlay } from './overlay.ts';

const TEXT_RESOLUTION = 2;
/** How many costume files to fetch at the same time. */
const LOAD_CONCURRENCY = 12;
/** `TEXT_BOX_REPOSITION_OFFSET - TEXT_BOX_WEBGL_OFFSET` in entryjs. */
const TEXT_BOX_TOP_OFFSET = 10 - 5.9;

interface EntityView {
  entity: Entity;
  root: Container;
  sprite: Sprite | null;
  background: Graphics | null;
  text: Text | null;
  decoration: Graphics | null;
  filter: ColorMatrixFilter | null;
  pictureId: string | null;
  /** Pen strokes and fills, each drawn just under the entity that made them. */
  brush: Graphics | null;
  paint: Graphics | null;
  stamps: Sprite[];
}

/** Back-reference so the scene list can answer "whose display object is this?". */
interface OwnedContainer extends Container {
  __entity?: Entity;
}

export interface RendererOptions {
  canvas?: HTMLCanvasElement;
  parent?: HTMLElement;
  /** Extra sharpness on top of the device pixel ratio. */
  quality?: number;
  background?: string;
  antialias?: boolean;
}

export class PixiRenderer implements Renderer {
  readonly app = new Application();
  readonly world = new Container();
  private readonly sceneLayers = new Map<string, Container>();
  private readonly sceneTargets = new Map<string, Target[]>();
  private readonly views = new Map<Entity, EntityView>();
  private readonly textures = new Map<string, Texture>();
  private readonly images = new Map<string, CanvasImageSource>();
  private readonly loading = new Map<string, Promise<void>>();
  private overlay: Overlay | null = null;
  private quality: number;
  private ready = false;
  private lastResolution = 0;
  private readonly measureStyle = new TextStyle();

  constructor(options: RendererOptions = {}) {
    this.quality = options.quality ?? 1;
    this.options = options;
  }

  private options: RendererOptions;

  async init(): Promise<void> {
    const options = this.options;
    await this.app.init({
      width: stage.worldWidth,
      height: stage.worldHeight,
      background: options.background ?? '#ffffff',
      antialias: options.antialias ?? true,
      autoDensity: false,
      resolution: this.pixelRatio(),
      canvas: options.canvas,
      preference: 'webgl',
    });
    this.app.ticker.autoStart = false;
    this.app.ticker.stop();
    this.applyStageSize();
    this.app.stage.addChild(this.world);
    this.overlay = new Overlay(this.app.stage);
    if (options.parent && !options.canvas) {
      options.parent.appendChild(this.app.canvas);
    }
    this.ready = true;
  }

  private pixelRatio(): number {
    const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
    return Math.max(1, Math.min(8, dpr * this.quality));
  }

  /** Moves the world container onto the stage as it is sized right now. */
  applyStageSize(): void {
    this.world.position.set(stage.worldWidth / 2, stage.worldHeight / 2);
    this.world.scale.set(stage.scale);
    this.overlay?.applyStageSize();
    if (this.ready) {
      this.lastResolution = 0;
      this.app.renderer.resize(stage.worldWidth, stage.worldHeight);
    }
  }

  /** Sizes the canvas to the box it sits in, keeping the stage ratio and full sharpness. */
  layout(width: number, height: number): void {
    if (!this.ready) {
      return;
    }
    const fit = Math.min(width / stage.worldWidth, height / stage.worldHeight);
    const cssWidth = Math.max(1, Math.floor(stage.worldWidth * fit));
    const cssHeight = Math.max(1, Math.floor(stage.worldHeight * fit));
    const resolution = Math.max(
      1,
      Math.min(8, (cssWidth / stage.worldWidth) * this.pixelRatio()),
    );
    if (this.lastResolution !== resolution) {
      this.lastResolution = resolution;
      this.app.renderer.resolution = resolution;
      this.app.renderer.resize(stage.worldWidth, stage.worldHeight);
    }
    const canvas = this.app.canvas;
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
  }

  setQuality(quality: number): void {
    this.quality = quality;
  }

  /** Stage rectangle in page coordinates, for turning pointer events into stage x/y. */
  canvasRect(): DOMRect {
    return this.app.canvas.getBoundingClientRect();
  }

  // -------------------------------------------------------------------------
  //  Project wiring
  // -------------------------------------------------------------------------
  /**
   * Entry keeps one flat list of display objects per scene — every entity,
   * every clone, every pen stroke and stamp sits in it at its own depth, and
   * `sortZorder` puts the first object of the list on top. Grouping a target's
   * clones into one layer would be simpler, but works place clones above and
   * below other objects on purpose, so the list has to stay flat.
   */
  attach(targets: Target[], scenes: Array<{ id: string }>): void {
    this.reset();
    for (const scene of scenes) {
      const layer = new Container();
      layer.visible = false;
      layer.sortableChildren = false;
      this.sceneLayers.set(scene.id, layer);
      this.world.addChild(layer);
    }
    for (const scene of scenes) {
      const layer = this.sceneLayers.get(scene.id)!;
      const own = targets.filter((target) => target.sceneId === scene.id);
      this.sceneTargets.set(scene.id, own);
      // The last object in the list is furthest back.
      for (let i = own.length - 1; i >= 0; i -= 1) {
        const view = this.makeView(own[i]!.entity);
        this.views.set(own[i]!.entity, view);
        layer.addChild(view.root);
      }
    }
  }

  /**
   * `Entry.stage.sortZorder` — entering a scene puts its objects back in list
   * order (the first object on top) and drops whatever else was left in the
   * list, so `오브젝트 순서 바꾸기` from a previous visit does not linger.
   */
  private sortScene(sceneId: string): void {
    const layer = this.sceneLayers.get(sceneId);
    const targets = this.sceneTargets.get(sceneId);
    if (!layer || !targets) {
      return;
    }
    for (const target of targets) {
      const view = this.views.get(target.entity);
      if (!view) {
        continue;
      }
      for (const stamp of view.stamps) {
        stamp.destroy();
      }
      view.stamps = [];
      view.brush?.destroy();
      view.paint?.destroy();
      view.brush = null;
      view.paint = null;
    }
    // Anything that is not an object's own display object goes.
    for (const child of [...layer.children] as OwnedContainer[]) {
      if (!child.__entity || child.__entity.isClone) {
        layer.removeChild(child);
        child.destroy();
      }
    }
    let index = 0;
    for (let i = targets.length - 1; i >= 0; i -= 1) {
      const view = this.views.get(targets[i]!.entity);
      if (view && layer.getChildIndex(view.root) >= 0) {
        layer.setChildIndex(view.root, index);
        index += 1;
      }
    }
  }

  private layerOf(entity: Entity): Container | null {
    return this.sceneLayers.get(entity.target.sceneId) ?? null;
  }

  /** Where entry would put a new clone, stamp or stroke of this entity. */
  private indexUnder(entity: Entity): number {
    const layer = this.layerOf(entity);
    const view = this.views.get(entity);
    if (!layer || !view) {
      return -1;
    }
    const index = layer.getChildIndex(view.root);
    return index < 0 ? -1 : index;
  }

  reset(): void {
    for (const view of this.views.values()) {
      view.root.destroy({ children: true });
    }
    this.views.clear();
    for (const layer of this.sceneLayers.values()) {
      layer.destroy({ children: true });
    }
    this.sceneLayers.clear();
    this.sceneTargets.clear();
    this.overlay?.clear();
  }

  setScene(sceneId: string): void {
    this.sortScene(sceneId);
    for (const [id, layer] of this.sceneLayers) {
      layer.visible = id === sceneId;
    }
  }

  /**
   * `Entry.EntryObject.addCloneEntity` slots a clone straight under the entity
   * it was copied from, skipping that entity's own strokes and stamps.
   */
  addEntity(entity: Entity, source?: Entity): void {
    if (this.views.has(entity)) {
      return;
    }
    const layer = this.layerOf(entity);
    if (!layer) {
      return;
    }
    const view = this.makeView(entity);
    this.views.set(entity, view);
    if (source) {
      const sourceView = this.views.get(source);
      const base = this.indexUnder(source);
      const offset =
        (sourceView?.brush ? 1 : 0) + (sourceView?.paint ? 1 : 0) + (sourceView?.stamps.length ?? 0);
      const index = base < 0 ? -1 : Math.max(0, base - offset);
      if (index >= 0) {
        layer.addChildAt(view.root, Math.min(index, layer.children.length));
      } else {
        layer.addChild(view.root);
      }
    } else {
      layer.addChild(view.root);
    }
    entity.dirty = true;
  }

  removeEntity(entity: Entity): void {
    const view = this.views.get(entity);
    if (!view) {
      return;
    }
    for (const stamp of view.stamps) {
      stamp.destroy();
    }
    view.brush?.destroy();
    view.paint?.destroy();
    view.root.destroy({ children: true });
    this.views.delete(entity);
  }

  private makeView(entity: Entity): EntityView {
    const root: OwnedContainer = new Container();
    root.__entity = entity;
    if (entity.type === 'textBox') {
      const background = new Graphics();
      const text = new Text({
        text: entity.text,
        style: {
          fontFamily: entity.fontFamily,
          fontSize: entity.fontSize,
          fill: entity.colour,
          align: 'center',
        },
        resolution: TEXT_RESOLUTION,
      });
      text.anchor.set(0.5, 0.5);
      const decoration = new Graphics();
      root.addChild(background, text, decoration);
      return {
        entity,
        root,
        sprite: null,
        background,
        text,
        decoration,
        filter: null,
        pictureId: null,
        brush: null,
        paint: null,
        stamps: [],
      };
    }
    const sprite = new Sprite(Texture.EMPTY);
    root.addChild(sprite);
    return {
      entity,
      root,
      sprite,
      background: null,
      text: null,
      decoration: null,
      filter: null,
      pictureId: null,
      brush: null,
      paint: null,
      stamps: [],
    };
  }

  // -------------------------------------------------------------------------
  //  Textures
  // -------------------------------------------------------------------------
  /**
   * Loads the costumes the first scene needs and waits only for those; the
   * rest stream in behind it. A big work can carry two thousand images, and
   * asking the browser for all of them at once stalls the whole page.
   */
  async preload(targets: Target[], sceneId?: string): Promise<void> {
    const inScene: Picture[] = [];
    const rest: Picture[] = [];
    for (const target of targets) {
      const bucket = !sceneId || target.sceneId === sceneId ? inScene : rest;
      bucket.push(...target.pictures);
    }
    await pool(inScene, LOAD_CONCURRENCY, (picture) => this.loadPicture(picture));
    void pool(rest, LOAD_CONCURRENCY, (picture) => this.loadPicture(picture));
  }

  async loadPicture(picture: Picture): Promise<void> {
    if (this.textures.has(picture.id)) {
      return;
    }
    const inFlight = this.loading.get(picture.id);
    if (inFlight) {
      await inFlight;
      return;
    }
    const job = (async () => {
      try {
        const texture = (await Assets.load(picture.fileurl)) as Texture;
        this.textures.set(picture.id, texture);
        const resource = texture.source?.resource as CanvasImageSource | undefined;
        if (resource) {
          this.images.set(picture.id, resource);
        }
      } catch {
        this.textures.set(picture.id, Texture.EMPTY);
      } finally {
        this.loading.delete(picture.id);
      }
    })();
    this.loading.set(picture.id, job);
    await job;
  }

  /** Alpha mask of one costume, built the first time a collision needs it. */
  maskFor(pictureId: string, width: number, height: number): AlphaMask | null {
    const source = this.images.get(pictureId);
    return source ? buildMask(source, width, height) : null;
  }

  // -------------------------------------------------------------------------
  //  Per-frame sync
  // -------------------------------------------------------------------------
  flush(): void {
    if (!this.ready) {
      return;
    }
    for (const [entity, view] of this.views) {
      if (entity.dirty) {
        this.sync(entity, view);
        entity.dirty = false;
      }
    }
    this.overlay?.flush();
    this.app.renderer.render(this.app.stage);
  }

  private sync(entity: Entity, view: EntityView): void {
    const root = view.root;
    root.visible = entity.visible;
    root.position.set(entity.x, -entity.y);
    root.rotation = (entity.rotation * Math.PI) / 180;
    root.scale.set(entity.scaleX, entity.scaleY);
    root.alpha = entity.effect.alpha;

    if (view.sprite) {
      const picture = entity.picture;
      if (picture && view.pictureId !== picture.id) {
        const texture = this.textures.get(picture.id);
        if (texture) {
          view.sprite.texture = texture;
          view.pictureId = picture.id;
        } else {
          void this.loadPicture(picture).then(() => {
            entity.dirty = true;
          });
        }
      }
      view.sprite.width = entity.width;
      view.sprite.height = entity.height;
      root.pivot.set(entity.regX, entity.regY);
      this.applyEffects(entity, view);
    } else {
      this.syncTextBox(entity, view);
    }
  }

  private applyEffects(entity: Entity, view: EntityView): void {
    const effect = entity.effect;
    const needsFilter = effect.brightness !== 0 || effect.hsv !== 0 || effect.hue !== 0;
    if (!needsFilter) {
      if (view.filter) {
        view.root.filters = [];
        view.filter = null;
      }
      return;
    }
    let filter = view.filter;
    if (!filter) {
      filter = new ColorMatrixFilter();
      view.filter = filter;
      view.root.filters = [filter];
    }
    filter.matrix = colorMatrix(effect.brightness, effect.hsv, effect.hue) as never;
  }

  /**
   * Entry keeps a text box's own width and height in step with the text it
   * holds (`updateTextbox` -> `setWidth(getMeasuredWidth())`); only a
   * line-breaking box keeps the size the author gave it. Those sizes feed
   * collisions and dialog placement, so they are written back onto the entity.
   */
  private syncTextBox(entity: Entity, view: EntityView): void {
    const text = view.text!;
    const background = view.background!;
    const decoration = view.decoration!;
    const style = text.style;
    const align: 'center' | 'left' | 'right' =
      entity.textAlign === 1 ? 'left' : entity.textAlign === 2 ? 'right' : 'center';
    // Entry hands the canvas one family name (`20px DungGeunMo`) and lets the
    // browser fall back on its own. Adding a fallback list here changes the
    // measured line height, and text box sizes are read by other blocks.
    style.fontFamily = entity.fontFamily;
    style.fontSize = entity.fontSize;
    style.fill = entity.colour;
    style.fontWeight = entity.fontBold ? 'bold' : 'normal';
    style.fontStyle = entity.fontItalic ? 'italic' : 'normal';
    style.align = align;
    style.lineHeight = entity.fontSize + 2;
    if (entity.lineBreak) {
      style.wordWrap = true;
      style.wordWrapWidth = entity.width;
      style.breakWords = true;
    } else {
      style.wordWrap = false;
    }
    if (text.text !== entity.text) {
      text.text = entity.text;
    }

    // `setTextAlign` moves the anchor, not the text: left-aligned text grows
    // to the right of the object's own x, centred text grows both ways.
    const anchorX = align === 'left' ? 0 : align === 'right' ? 1 : 0.5;
    if (entity.lineBreak) {
      // The block sits inside the author's box, pinned to its top edge.
      text.anchor.set(anchorX, 0);
      text.position.set(
        align === 'left' ? -entity.width / 2 : align === 'right' ? entity.width / 2 : 0,
        -entity.height / 2 + TEXT_BOX_TOP_OFFSET,
      );
    } else {
      text.anchor.set(anchorX, 0.5);
      text.position.set(0, 0);
    }

    background.clear();
    if (entity.bgColor && entity.bgColor.startsWith('#')) {
      const offset = entity.lineBreak
        ? 0
        : align === 'left'
          ? entity.width / 2
          : align === 'right'
            ? -entity.width / 2
            : 0;
      background
        .rect(offset - entity.width / 2, -entity.height / 2, entity.width, entity.height)
        .fill({ color: entity.bgColor });
    }

    decoration.clear();
    if (entity.underLine || entity.strike) {
      const width = text.width;
      const left = text.x - width * text.anchor.x;
      const top = text.y - text.height * text.anchor.y;
      const thickness = Math.max(1, entity.fontSize / 14);
      if (entity.underLine) {
        decoration
          .rect(left, top + text.height - thickness, width, thickness)
          .fill({ color: entity.colour });
      }
      if (entity.strike) {
        decoration
          .rect(left, top + text.height / 2 - thickness / 2, width, thickness)
          .fill({ color: entity.colour });
      }
    }
  }

  /** The style a text box is drawn with — also what it is measured with. */
  private styleFor(entity: Entity, style: TextStyle): TextStyle {
    style.fontFamily = entity.fontFamily;
    style.fontSize = entity.fontSize;
    style.fill = entity.colour;
    style.fontWeight = entity.fontBold ? 'bold' : 'normal';
    style.fontStyle = entity.fontItalic ? 'italic' : 'normal';
    style.align = entity.textAlign === 1 ? 'left' : entity.textAlign === 2 ? 'right' : 'center';
    style.lineHeight = entity.fontSize + 2;
    if (entity.lineBreak) {
      style.wordWrap = true;
      style.wordWrapWidth = entity.width;
      style.breakWords = true;
    } else {
      style.wordWrap = false;
    }
    return style;
  }

  /**
   * Measures a text box the way entry does inside `setText`, so a script that
   * writes text and immediately reads `크기` sees the new size in that frame.
   */
  measureTextBox(entity: Entity): { width: number; height: number } | null {
    if (entity.type !== 'textBox') {
      return null;
    }
    const metrics = CanvasTextMetrics.measureText(
      entity.text,
      this.styleFor(entity, this.measureStyle),
    );
    return { width: metrics.width, height: metrics.height };
  }

  /**
   * Re-measures every text box once the web fonts have actually arrived. PIXI
   * caches font metrics the first time it sees a font string, so anything
   * measured before the download finished has to be thrown away too.
   */
  async waitForFonts(): Promise<void> {
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    if (!fonts) {
      return;
    }
    try {
      await fonts.ready;
    } catch {
      return;
    }
    CanvasTextMetrics.clearMetrics();
    for (const [entity, view] of this.views) {
      if (entity.type === 'textBox' && view.text) {
        // Nudge the family so the style really changes; `syncTextBox` puts the
        // right one back and PIXI measures again from scratch.
        view.text.style.fontFamily = 'sans-serif';
        entity.measure();
        entity.dirty = true;
      }
    }
    this.flush();
  }

  // -------------------------------------------------------------------------
  //  Pen, stamps, layering
  // -------------------------------------------------------------------------
  /** A pen layer for this entity, created under it the way entry inserts one. */
  private penLayer(view: EntityView, which: 'brush' | 'paint'): Graphics | null {
    const existing = view[which];
    if (existing) {
      return existing;
    }
    const layer = this.layerOf(view.entity);
    if (!layer) {
      return null;
    }
    const graphics = new Graphics();
    const index = this.indexUnder(view.entity);
    layer.addChildAt(graphics, index < 0 ? layer.children.length : index);
    view[which] = graphics;
    return graphics;
  }

  penChanged(entity: Entity): void {
    const view = this.views.get(entity);
    if (!view) {
      return;
    }
    for (const which of ['paint', 'brush'] as const) {
      const state = entity[which];
      if (!state) {
        continue;
      }
      const graphics = this.penLayer(view, which);
      if (!graphics) {
        continue;
      }
      graphics.clear();
      const live =
        state.path.length >= 4
          ? [
              ...state.strokes,
              {
                color: state.color,
                thickness: state.thickness,
                opacity: state.opacity,
                points: state.path,
                fill: which === 'paint',
              },
            ]
          : state.strokes;
      for (const stroke of live) {
        const points = stroke.points;
        if (points.length < 4) {
          continue;
        }
        graphics.moveTo(points[0]!, -points[1]!);
        for (let i = 2; i < points.length; i += 2) {
          graphics.lineTo(points[i]!, -points[i + 1]!);
        }
        const alpha = 1 - stroke.opacity / 100;
        if (stroke.fill) {
          graphics.fill({ color: stroke.color, alpha });
        } else {
          graphics.stroke({
            width: stroke.thickness,
            color: stroke.color,
            alpha,
            cap: 'round',
            join: 'round',
          });
        }
      }
    }
  }

  stamp(entity: Entity): void {
    const view = this.views.get(entity);
    const layer = this.layerOf(entity);
    const mark = entity.stamps[entity.stamps.length - 1];
    if (!view || !layer || !mark || !mark.picture) {
      return;
    }
    const texture = this.textures.get(mark.picture.id);
    if (!texture) {
      return;
    }
    const sprite = new Sprite(texture);
    sprite.width = mark.picture.dimension.width;
    sprite.height = mark.picture.dimension.height;
    sprite.pivot.set(mark.regX, mark.regY);
    sprite.position.set(mark.x, -mark.y);
    sprite.rotation = (mark.rotation * Math.PI) / 180;
    sprite.scale.set(mark.scaleX, mark.scaleY);
    sprite.alpha = mark.alpha;
    const index = this.indexUnder(entity);
    layer.addChildAt(sprite, index < 0 ? layer.children.length : index);
    view.stamps.push(sprite);
  }

  eraseAll(entity: Entity): void {
    const view = this.views.get(entity);
    if (!view) {
      return;
    }
    view.brush?.clear();
    view.paint?.clear();
    for (const stamp of view.stamps) {
      stamp.destroy();
    }
    view.stamps = [];
  }

  /**
   * `change_object_index` — entry moves the entity itself inside the scene's
   * flat list, hopping over the strokes and stamps that belong to whatever is
   * next to it so a step really lands one object away.
   */
  moveEntity(entity: Entity, location: string): void {
    const layer = this.layerOf(entity);
    const view = this.views.get(entity);
    if (!layer || !view) {
      return;
    }
    const children = layer.children as OwnedContainer[];
    const current = layer.getChildIndex(view.root);
    if (current < 0) {
      return;
    }
    const max = children.length - 1;
    const own = 1 + (view.brush ? 1 : 0) + (view.paint ? 1 : 0);
    let target = current;
    switch (location) {
      case 'FRONT':
        target = max;
        break;
      case 'BACK':
        target = 0;
        break;
      case 'FORWARD': {
        if (current === max) {
          return;
        }
        const front = this.views.get(children[current + 1]?.__entity as Entity);
        target += own + (front?.stamps.length ?? 0);
        break;
      }
      default: {
        const backIndex = current - own + view.stamps.length;
        const back = this.views.get(children[backIndex]?.__entity as Entity);
        target = back ? current - own - back.stamps.length : 0;
        break;
      }
    }
    target = Math.max(0, Math.min(max, target));
    if (target !== current) {
      layer.setChildIndex(view.root, target);
    }
  }

  // -------------------------------------------------------------------------
  //  Overlay pass-through
  // -------------------------------------------------------------------------
  syncDialog(entity: Entity): void {
    this.overlay?.setDialog(entity);
  }

  /** The ask box is HTML, not canvas — the page hooks these. */
  showQuestion(_text: string): void {}

  hideQuestion(): void {}

  get overlayView(): Overlay | null {
    return this.overlay;
  }
}

/** Runs `work` over `items`, never more than `limit` of them at once. */
async function pool<T>(items: T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const runners = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      if (item !== undefined) {
        await work(item);
      }
    }
  });
  await Promise.all(runners);
}

/**
 * `GEHelper.colorFilter` — brightness is an offset in 0…1 space and the colour
 * effect rotates channels, exactly as entry builds them.
 */
export function colorMatrix(brightness: number, hsv: number, hue: number): number[] {
  let matrix = identityMatrix();
  if (brightness !== 0) {
    const offset = Math.max(-100, Math.min(100, brightness)) / 255;
    matrix = multiply(matrix, [
      1, 0, 0, 0, offset,
      0, 1, 0, 0, offset,
      0, 0, 1, 0, offset,
      0, 0, 0, 1, 0,
    ]);
  }
  if (hsv !== 0) {
    matrix = multiply(matrix, hsvMatrix(hsv));
  }
  if (hue !== 0) {
    matrix = multiply(matrix, hueMatrix(((hue % 360) + 360) % 360));
  }
  return matrix;
}

function identityMatrix(): number[] {
  return [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0];
}

/** The channel-rotation matrix entry uses for the `색깔` effect. */
function hsvMatrix(hsv: number): number[] {
  const radians = ((hsv * 3.6 * 3) / 180) * Math.PI;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  let v = Math.abs(hsv / 100);
  if (v > 1) {
    v -= Math.floor(v);
  }
  if (v > 0 && v <= 0.33) {
    return [1, 0, 0, 0, 0, 0, cos, sin, 0, 0, 0, -sin, cos, 0, 0, 0, 0, 0, 1, 0];
  }
  if (v <= 0.66) {
    return [cos, 0, sin, 0, 0, 0, 1, 0, 0, 0, sin, 0, cos, 0, 0, 0, 0, 0, 1, 0];
  }
  if (v <= 0.99) {
    return [cos, sin, 0, 0, 0, -sin, cos, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0];
  }
  return identityMatrix();
}

function hueMatrix(degrees: number): number[] {
  const rotation = (degrees / 180) * Math.PI;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const w = 1 / 3;
  const sqrtW = Math.sqrt(w);
  const a00 = cos + (1 - cos) * w;
  const a01 = w * (1 - cos) - sqrtW * sin;
  const a02 = w * (1 - cos) + sqrtW * sin;
  const a10 = w * (1 - cos) + sqrtW * sin;
  const a11 = cos + w * (1 - cos);
  const a12 = w * (1 - cos) - sqrtW * sin;
  const a20 = w * (1 - cos) - sqrtW * sin;
  const a21 = w * (1 - cos) + sqrtW * sin;
  const a22 = cos + w * (1 - cos);
  return [a00, a01, a02, 0, 0, a10, a11, a12, 0, 0, a20, a21, a22, 0, 0, 0, 0, 0, 1, 0];
}

function multiply(a: number[], b: number[]): number[] {
  const out = new Array<number>(20);
  for (let row = 0; row < 4; row += 1) {
    const base = row * 5;
    for (let column = 0; column < 4; column += 1) {
      out[base + column] =
        a[base]! * b[column]! +
        a[base + 1]! * b[column + 5]! +
        a[base + 2]! * b[column + 10]! +
        a[base + 3]! * b[column + 15]!;
    }
    out[base + 4] =
      a[base]! * b[4]! +
      a[base + 1]! * b[9]! +
      a[base + 2]! * b[14]! +
      a[base + 3]! * b[19]! +
      a[base + 4]!;
  }
  return out;
}
