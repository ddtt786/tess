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
  ColorMatrixFilter,
  Container,
  Graphics,
  Sprite,
  Text,
  Texture,
} from 'pixi.js';
import {
  WORLD_HEIGHT,
  WORLD_SCALE,
  WORLD_WIDTH,
  type Entity,
  type Picture,
  type Target,
} from '../runtime/model.ts';
import type { Renderer } from '../runtime/engine.ts';
import { buildMask } from '../collision/mask-image.ts';
import type { AlphaMask } from '../collision/mask.ts';
import { Overlay } from './overlay.ts';

const TEXT_RESOLUTION = 2;

interface EntityView {
  root: Container;
  sprite: Sprite | null;
  background: Graphics | null;
  text: Text | null;
  decoration: Graphics | null;
  filter: ColorMatrixFilter | null;
  pictureId: string | null;
}

interface TargetLayer {
  root: Container;
  pen: Graphics;
  stamps: Container;
  entities: Container;
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
  private readonly targetLayers = new Map<string, TargetLayer>();
  private readonly views = new Map<Entity, EntityView>();
  private readonly textures = new Map<string, Texture>();
  private readonly images = new Map<string, CanvasImageSource>();
  private readonly loading = new Set<string>();
  private overlay: Overlay | null = null;
  private quality: number;
  private ready = false;

  constructor(options: RendererOptions = {}) {
    this.quality = options.quality ?? 1;
    this.options = options;
  }

  private options: RendererOptions;

  async init(): Promise<void> {
    const options = this.options;
    await this.app.init({
      width: WORLD_WIDTH,
      height: WORLD_HEIGHT,
      background: options.background ?? '#ffffff',
      antialias: options.antialias ?? true,
      autoDensity: false,
      resolution: this.pixelRatio(),
      canvas: options.canvas,
      preference: 'webgl',
    });
    this.app.ticker.autoStart = false;
    this.app.ticker.stop();
    this.world.position.set(WORLD_WIDTH / 2, WORLD_HEIGHT / 2);
    this.world.scale.set(WORLD_SCALE);
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

  /** Sizes the canvas to the box it sits in while keeping 16:9 and full sharpness. */
  layout(width: number, height: number): void {
    if (!this.ready) {
      return;
    }
    const scale = Math.min(width / WORLD_WIDTH, height / WORLD_HEIGHT);
    const cssWidth = Math.max(1, Math.floor(WORLD_WIDTH * scale));
    const cssHeight = Math.max(1, Math.floor(WORLD_HEIGHT * scale));
    const resolution = Math.max(1, Math.min(8, (cssWidth / WORLD_WIDTH) * this.pixelRatio()));
    if (this.app.renderer.resolution !== resolution) {
      this.app.renderer.resolution = resolution;
      this.app.renderer.resize(WORLD_WIDTH, WORLD_HEIGHT);
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
  attach(targets: Target[], scenes: Array<{ id: string }>): void {
    this.reset();
    for (const scene of scenes) {
      const layer = new Container();
      layer.visible = false;
      this.sceneLayers.set(scene.id, layer);
      this.world.addChild(layer);
    }
    // Entry draws the first object in the list on top, so lay them out backwards.
    for (const scene of scenes) {
      const layer = this.sceneLayers.get(scene.id)!;
      const own = targets.filter((target) => target.sceneId === scene.id);
      for (let i = own.length - 1; i >= 0; i -= 1) {
        layer.addChild(this.makeTargetLayer(own[i]!).root);
      }
    }
  }

  private makeTargetLayer(target: Target): TargetLayer {
    const root = new Container();
    const pen = new Graphics();
    const stamps = new Container();
    const entities = new Container();
    root.addChild(pen, stamps, entities);
    const layer: TargetLayer = { root, pen, stamps, entities };
    this.targetLayers.set(target.id, layer);
    return layer;
  }

  reset(): void {
    for (const view of this.views.values()) {
      view.root.destroy({ children: true });
    }
    this.views.clear();
    this.targetLayers.clear();
    for (const layer of this.sceneLayers.values()) {
      layer.destroy({ children: true });
    }
    this.sceneLayers.clear();
    this.overlay?.clear();
  }

  setScene(sceneId: string): void {
    for (const [id, layer] of this.sceneLayers) {
      layer.visible = id === sceneId;
    }
  }

  addEntity(entity: Entity): void {
    if (this.views.has(entity)) {
      return;
    }
    const layer = this.targetLayers.get(entity.target.id);
    if (!layer) {
      return;
    }
    const view = this.makeView(entity);
    this.views.set(entity, view);
    layer.entities.addChild(view.root);
    entity.dirty = true;
  }

  removeEntity(entity: Entity): void {
    const view = this.views.get(entity);
    if (!view) {
      return;
    }
    view.root.destroy({ children: true });
    this.views.delete(entity);
  }

  private makeView(entity: Entity): EntityView {
    const root = new Container();
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
        root,
        sprite: null,
        background,
        text,
        decoration,
        filter: null,
        pictureId: null,
      };
    }
    const sprite = new Sprite(Texture.EMPTY);
    root.addChild(sprite);
    return {
      root,
      sprite,
      background: null,
      text: null,
      decoration: null,
      filter: null,
      pictureId: null,
    };
  }

  // -------------------------------------------------------------------------
  //  Textures
  // -------------------------------------------------------------------------
  /** Kicks off loading for every costume the project can show. */
  preload(targets: Target[]): Promise<void[]> {
    const jobs: Array<Promise<void>> = [];
    for (const target of targets) {
      for (const picture of target.pictures) {
        jobs.push(this.loadPicture(picture));
      }
    }
    return Promise.all(jobs);
  }

  async loadPicture(picture: Picture): Promise<void> {
    if (this.textures.has(picture.id) || this.loading.has(picture.id)) {
      return;
    }
    this.loading.add(picture.id);
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

  private syncTextBox(entity: Entity, view: EntityView): void {
    const text = view.text!;
    const background = view.background!;
    const decoration = view.decoration!;
    const style = text.style;
    style.fontFamily = entity.fontFamily;
    style.fontSize = entity.fontSize;
    style.fill = entity.colour;
    style.fontWeight = entity.fontBold ? 'bold' : 'normal';
    style.fontStyle = entity.fontItalic ? 'italic' : 'normal';
    style.align = (['center', 'left', 'right'][entity.textAlign] ?? 'center') as 'center';
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

    background.clear();
    if (entity.bgColor && entity.bgColor.startsWith('#')) {
      background
        .rect(-entity.width / 2, -entity.height / 2, entity.width, entity.height)
        .fill({ color: entity.bgColor });
    }

    decoration.clear();
    if (entity.underLine || entity.strike) {
      const width = text.width;
      const height = text.height;
      const thickness = Math.max(1, entity.fontSize / 14);
      if (entity.underLine) {
        decoration
          .rect(-width / 2, height / 2 - thickness, width, thickness)
          .fill({ color: entity.colour });
      }
      if (entity.strike) {
        decoration
          .rect(-width / 2, -thickness / 2, width, thickness)
          .fill({ color: entity.colour });
      }
    }
  }

  // -------------------------------------------------------------------------
  //  Pen, stamps, layering
  // -------------------------------------------------------------------------
  penChanged(entity: Entity): void {
    const layer = this.targetLayers.get(entity.target.id);
    if (!layer) {
      return;
    }
    const graphics = layer.pen;
    graphics.clear();
    for (const source of [entity.paint, entity.brush]) {
      if (!source) {
        continue;
      }
      const strokes = source.path.length >= 4
        ? [
            ...source.strokes,
            {
              color: source.color,
              thickness: source.thickness,
              opacity: source.opacity,
              points: source.path,
              fill: source === entity.paint,
            },
          ]
        : source.strokes;
      for (const stroke of strokes) {
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
          graphics.stroke({ width: stroke.thickness, color: stroke.color, alpha, cap: 'round', join: 'round' });
        }
      }
    }
  }

  stamp(entity: Entity): void {
    const layer = this.targetLayers.get(entity.target.id);
    const mark = entity.stamps[entity.stamps.length - 1];
    if (!layer || !mark || !mark.picture) {
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
    layer.stamps.addChild(sprite);
  }

  eraseAll(entity: Entity): void {
    const layer = this.targetLayers.get(entity.target.id);
    if (!layer) {
      return;
    }
    layer.pen.clear();
    layer.stamps.removeChildren().forEach((child) => child.destroy());
  }

  moveEntity(entity: Entity, location: string): void {
    const layer = this.targetLayers.get(entity.target.id);
    const scene = this.sceneLayers.get(entity.target.sceneId);
    if (!layer || !scene) {
      return;
    }
    const children = scene.children;
    const index = children.indexOf(layer.root);
    if (index < 0) {
      return;
    }
    const last = children.length - 1;
    let next = index;
    if (location === 'FRONT') {
      next = last;
    } else if (location === 'BACK') {
      next = 0;
    } else if (location === 'FORWARD') {
      next = Math.min(last, index + 1);
    } else {
      next = Math.max(0, index - 1);
    }
    scene.setChildIndex(layer.root, next);
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
