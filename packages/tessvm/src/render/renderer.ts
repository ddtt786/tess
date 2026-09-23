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
  Color,
  TextStyle,
  ColorMatrixFilter,
  Container,
  Graphics,
  Sprite,
  Text,
  Texture,
} from 'pixi.js';
import { stage, type Entity, type Picture, type Stroke, type Target } from '../runtime/model.ts';
import type { Renderer } from '../runtime/engine.ts';
import { buildMask } from '../collision/mask-image.ts';
import type { AlphaMask } from '../collision/mask.ts';
import { Overlay, type TableLike } from './overlay.ts';
import { fillParts } from './fill.ts';
import { isSegment, SegmentBatch, SEGMENT_FLOOR } from './segments.ts';
import {
  MAX_SHARPNESS,
  svgBudgetScale,
  svgSharpness,
  textSharpness,
} from './sharpness.ts';

/** A colour a work supplied: what to paint with, and how see-through it is. */
interface Ink {
  color: number;
  /** 0–1. `#RRGGBBAA` carries it; everything else is 1. */
  alpha: number;
}

/**
 * Colours a work supplies, remembered by the text they were written as.
 *
 * Entry hands a colour straight to the canvas, which quietly ignores one it
 * cannot read and keeps the colour it had. Pixi throws instead, and a throw in
 * the middle of a frame takes the whole work down — so anything unreadable is
 * turned away here. Works really do carry `#검정` and hexes that lost a digit.
 *
 * The alpha comes back separately because the canvas reads `#RRGGBBAA` and
 * works use it; a number alone would paint that colour solid.
 */
const colorCache = new Map<string, Ink | null>();

/** A stamp, with the rasterisation it is keeping alive. */
type StampSprite = Sprite & { __baked?: string };

/** A vector costume rasterised at one sharpness, and where it was loaded from. */
interface Baked {
  url: string;
  src: string;
  resolution: number;
}

/**
 * How many renderers hold each rasterised vector.
 *
 * PIXI's asset cache is one per page, so two runners showing the same costume
 * are handed the very same texture. A renderer that unloaded its own copy would
 * empty the other's mid-frame, so a source is only let go when the last
 * renderer holding it lets go.
 */
const bakedHolds = new Map<string, number>();

function holdBaked(src: string): void {
  bakedHolds.set(src, (bakedHolds.get(src) ?? 0) + 1);
}

function releaseBaked(src: string): void {
  const held = bakedHolds.get(src) ?? 0;
  if (held > 1) {
    bakedHolds.set(src, held - 1);
    return;
  }
  bakedHolds.delete(src);
  void Assets.unload(src).catch(() => undefined);
}

function usableColor(value: unknown): Ink | null {
  const text = String(value ?? '');
  const known = colorCache.get(text);
  if (known !== undefined) {
    return known;
  }
  let parsed: Ink | null = null;
  try {
    const color = new Color(text);
    parsed = { color: color.toNumber(), alpha: color.alpha };
  } catch {
    parsed = null;
  }
  colorCache.set(text, parsed);
  return parsed;
}

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
  /** 글상자에 마지막으로 넣은 글자색. 같은 색을 다시 넣지 않으려고 들고 있습니다. */
  colour: string | null;
  /** Pen strokes and fills, each drawn just under the entity that made them. */
  brush: PenView | null;
  paint: PenView | null;
  stamps: StampSprite[];
}

/**
 * One pen (the trail or the fill) of one entity.
 *
 * Entry draws into a canvas path and strokes it once per settings group, so a
 * translucent pen keeps one flat colour however often it crosses itself. Each
 * group therefore gets its own node here, and a translucent one is composited
 * from a cached texture — drawing its pieces straight onto the stage would
 * blend every overlap twice.
 */
interface PenView {
  /** Sits in the scene list where entry would put the pen. */
  root: Container;
  groups: PenGroup[];
}

interface PenGroup {
  /** Carries the group's alpha; caches itself while that alpha is below 1. */
  node: Container;
  graphics: Graphics;
  /** Plain two-point lines of this group, drawn as quads instead of a path. */
  segments: SegmentBatch | null;
  /** What was drawn last time, so an unchanged group is left alone. */
  drawn: string;
}

const PAINT_FIRST = ['paint', 'brush'] as const;
const BRUSH_FIRST = ['brush', 'paint'] as const;

/** The entity's two pens, the one it started using first coming first. */
function penOrderOf(entity: Entity): ReadonlyArray<'paint' | 'brush'> {
  const paint = entity.paint?.started ?? Infinity;
  const brush = entity.brush?.started ?? Infinity;
  return paint <= brush ? PAINT_FIRST : BRUSH_FIRST;
}

/**
 * A drawing's own size — `width`/`height` when it has them, else the viewBox.
 * `@tess/decompiler` reads the same two the same way when it unpacks a work.
 */
function svgSize(head: string): { width: number; height: number } | null {
  const width = /\swidth\s*=\s*["']([\d.]+)/.exec(head);
  const height = /\sheight\s*=\s*["']([\d.]+)/.exec(head);
  if (width && height) {
    return { width: Number(width[1]), height: Number(height[1]) };
  }
  const box = /\sviewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(head);
  return box ? { width: Number(box[1]), height: Number(box[2]) } : null;
}

/**
 * 벡터 모양을 구울 때 PIXI 에 넘기는 값. `loadSvg` 는 `data` 의 나머지를 그대로
 * `ImageSource` 로 흘려보내므로 여기서 밉맵을 켤 수 있습니다.
 *
 * 벡터는 이름 크기의 2~4배로 구워지므로 **언제나 축소되어 그려집니다.** 밉맵이 없으면
 * 축소는 원본 픽셀을 띄엄띄엄 집는 일이라 가장자리가 어긋나고, 작게 그리거나 회전하는
 * 동안에는 프레임마다 다른 픽셀을 집어 지글거립니다. png 모양은 제 크기로 그려지므로
 * 이 문제가 없습니다.
 */
function vectorTextureData(
  width: number,
  height: number,
  resolution: number,
): Record<string, unknown> {
  // `width`·`height` 를 함께 주면 `loadSvg` 가 그림 자신의 크기가 아니라 이 크기로
  // 캔버스를 잡습니다 — `sizedVector` 가 마크업에 박아 둔 크기와 짝이 맞아 1:1 이 됩니다.
  return { width, height, resolution, autoGenerateMipmaps: true };
}

/**
 * 뿌리 `<svg>` 에 목표 픽셀 크기를 박은 사본의 주소.
 *
 * PIXI 의 `loadSvg` 는 svg 를 `<img>` 로 불러와 `drawImage` 로 옮겨 그립니다. 그런데
 * `<img>` 는 **그림이 말하는 자기 크기**로 먼저 래스터화되고, 엔트리 벡터에는
 * `width`·`height` 가 없고 `viewBox` 만 있어서 그 크기가 그림의 원래 크기입니다. 그래서
 * 3배로 구우라고 해도 실제로는 원래 크기로 그린 그림을 3배로 늘린 것이 나오고, 가장자리가
 * 계단처럼 남습니다(`play.ent` 의 단추). 크기를 박아 두면 브라우저가 처음부터 그 크기로
 * 그리므로 진짜 벡터 화질이 나옵니다 — `viewBox` 는 그대로라 그림은 달라지지 않습니다.
 */
export function sizedVector(text: string, width: number, height: number): string {
  const open = /<svg\b[^>]*>/i.exec(text);
  if (!open) return '';
  const head = open[0]
    .replace(/\s(width|height)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\/?>$/, '');
  const sized = `${head} width="${Math.round(width)}" height="${Math.round(height)}">`;
  const body = text.slice(open.index + open[0].length);
  const whole = `${text.slice(0, open.index)}${sized}${body}`;
  // 데이터 URL 이어야 합니다 — PIXI 는 확장자나 `data:image/svg+xml` 로만 svg 로더를
  // 고르므로(`loadSvg.test`), blob 주소로 주면 다른 로더로 새서 빈 텍스처가 됩니다.
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(whole)}`;
}

/** Pieces entry would have drawn into one canvas path. */
const sameStyle = (a: Stroke, b: Stroke) =>
  a.color === b.color &&
  a.thickness === b.thickness &&
  a.opacity === b.opacity &&
  a.fill === b.fill;

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
  /** Take the vector costume where one exists. On unless turned off. */
  svg?: boolean;
  /**
   * 부스트 모드 — 엔트리에서 이것은 **WebGL 렌더러를 고르는 스위치**입니다
   * (`Entry.setBasicPaint` 의 `GEHelper.isWebGL`). 켜면 채우기가 PIXI 로 가고,
   * 끄면 캔버스로 가는데 둘은 자기교차 경로를 다르게 칠합니다. VM 과 같이 기본은 켬입니다.
   */
  boost?: boolean;
}

/**
 * Entry's vector paint editor works on a 960×540 canvas. A drawing that fits it
 * was saved as it was drawn, so the vector and the raster entry captured beside
 * it are the same picture. A bigger one was re-framed on save — the raster keeps
 * the framing, the vector does not — so above this only the raster is right.
 */
export const PAINT_CANVAS = { width: 960, height: 540 };

/** A vector is only rasterised again once the canvas asks for this much more. */
const SVG_REBAKE_RATIO = 1.25;
/** How many times the vector budget is walked down before it is taken as it is. */
const BUDGET_PASSES = 8;
/** Only the head of the file is read to decide what is in it. */
const SVG_PEEK = 4096;
/**
 * 벡터의 제 크기와 작품이 그리는 크기가 이만큼까지 어긋나도 같은 그림으로 봅니다.
 * 편집기가 화면을 다시 잡은 그림은 수십~수백 픽셀이 어긋나지만(실제 작품 59개), 한 픽셀
 * 차이는 저장할 때의 반올림입니다(8개) — 그걸 막으면 멀쩡한 벡터가 png 로 떨어집니다
 * (`play.ent` 의 단추는 svg 가 278×109, 작품이 278×110 입니다).
 */
const SIZE_SLACK = 1;

export class PixiRenderer implements Renderer {
  readonly app = new Application();
  readonly world = new Container();
  private readonly sceneLayers = new Map<string, Container>();
  private readonly sceneTargets = new Map<string, Target[]>();
  private readonly views = new Map<Entity, EntityView>();
  /** Entities whose pen layer `flush` still has to redraw. */
  private readonly penDirty = new Set<Entity>();
  private readonly textures = new Map<string, Texture>();
  private readonly images = new Map<string, CanvasImageSource>();
  private readonly loading = new Map<string, Promise<void>>();
  /** Vector costumes that were rasterised, and the sharpness each was given. */
  private readonly svgBaked = new Map<string, Baked>();
  /** 한 번 받은 svg 마크업. 크기를 박은 사본을 만들 때마다 다시 받지 않습니다. */
  private readonly svgTexts = new Map<string, string>();
  /** Every costume a texture was asked for, so one can be baked again. */
  private readonly pictures = new Map<string, Picture>();
  private overlay: Overlay | null = null;
  private quality: number;
  private ready = false;
  private lastResolution = 0;
  /** How far vector sharpness is scaled so the work's textures fit together. */
  private svgBudget = 1;
  /** Nominal size of every vector costume the work carries, for that budget. */
  private svgSizes: Array<{ id: string; width: number; height: number }> = [];
  /** Objects whose draw already failed once; the console is told only then. */
  private readonly syncFailed = new WeakSet<Entity>();
  private fontsWait: Promise<void> | null = null;
  private readonly svgPicks = new Map<string, boolean>();
  /** 작품이 각 벡터 모양을 그리는 가장 큰 배율. 한 번 오른 값은 내리지 않습니다. */
  private readonly svgScales = new Map<string, number>();
  /** 그 배율이 커져서 다시 구울 것이 있는가 — `flush` 끝에서 한 번만 봅니다. */
  private svgScaleGrew = false;
  private readonly measureStyle = new TextStyle();
  /**
   * 이미 그어 끝난 획을 잘라 둔 결과. 한 번 `strokes` 에 들어간 획은 다시 바뀌지 않으므로
   * 프레임마다 다시 자를 이유가 없습니다 — 그리는 중인 획만 매번 새로 잽니다(그 획은
   * `redrawPen` 이 프레임마다 새 객체로 만들므로 여기에 걸리지 않습니다).
   */
  private fillCache = new WeakMap<Stroke, { boost: boolean; parts: number[][] | null }>();

  /** `measureWhole` 이 쓰는 2D 컨텍스트. 처음 필요할 때 만듭니다. */
  private measureCanvas: CanvasRenderingContext2D | null | undefined;

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
    // An opaque WebGL canvas shows black until its first frame; clear it to the
    // stage colour now, since the first real frame waits for every costume.
    this.app.canvas.style.background = options.background ?? '#ffffff';
    this.app.renderer.render(this.app.stage);
    if (options.parent && !options.canvas) {
      options.parent.appendChild(this.app.canvas);
    }
    this.ready = true;
  }

  private pixelRatio(): number {
    const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
    return Math.max(1, Math.min(MAX_SHARPNESS, dpr * this.quality));
  }

  /**
   * Texture pixels the canvas puts on one stage pixel right now. The stage is
   * drawn 4/3 the size of entry's coordinates and the renderer's resolution
   * sits on top of that, so anything baked into a texture — a text box, a
   * rasterised vector costume — needs this much to come out sharp.
   */
  private displayScale(): number {
    const resolution = this.ready ? this.app.renderer.resolution : this.pixelRatio();
    return stage.scale * resolution;
  }

  /** Sharpness for a vector costume: follows the canvas, inside the pixel caps. */
  private svgResolution(picture: Picture): number {
    return svgSharpness(
      this.displayScale(),
      picture.dimension.width,
      picture.dimension.height,
      this.svgBudget,
      this.svgScales.get(picture.id) ?? 1,
    );
  }

  /**
   * 이 모양이 이만큼 크게 그려진다고 적어 둡니다. 텍스처는 모양의 이름 크기에서 구워지므로
   * 키워서 그리는 모양은 그만큼 더 촘촘히 구워야 합니다. 0.5 단위로 올려 두어, 크기가
   * 변하는 오브젝트가 프레임마다 다시 굽게 하지 않습니다.
   */
  private noteSvgScale(entity: Entity): void {
    const id = entity.picture?.id;
    if (!id || !this.svgBaked.has(id)) {
      return;
    }
    const drawn = Math.ceil(Math.max(Math.abs(entity.scaleX), Math.abs(entity.scaleY)) * 2) / 2;
    if (drawn <= (this.svgScales.get(id) ?? 1)) {
      return;
    }
    this.svgScales.set(id, drawn);
    this.svgScaleGrew = true;
  }

  /**
   * Works out how far the work's vector costumes have to come down together.
   *
   * What each one asks for on its own is fine; hundreds of them at once are
   * not, and a card that cannot hold the lot spends its frames swapping
   * textures. `imageType` is what the work says it stored, which is known
   * before anything is fetched.
   */
  private setSvgBudget(targets: Target[]): void {
    const counted = new Set<string>();
    this.svgSizes = [];
    for (const target of targets) {
      for (const picture of target.pictures) {
        if (picture.imageType === 'svg' && !counted.has(picture.id)) {
          counted.add(picture.id);
          this.svgSizes.push({ id: picture.id, ...picture.dimension });
        }
      }
    }
    this.fitSvgBudget();
  }

  /**
   * Walks the scale down until what the vector costumes really take fits the
   * budget. What each one settles on is not the scale it was given — the caps
   * and the rounding to halves both move it — so it takes more than one pass.
   */
  private fitSvgBudget(): void {
    const display = this.displayScale();
    let budget = 1;
    for (let pass = 0; pass < BUDGET_PASSES; pass += 1) {
      let pixels = 0;
      for (const { id, width, height } of this.svgSizes) {
        const one = svgSharpness(display, width, height, budget, this.svgScales.get(id) ?? 1);
        pixels += width * height * one * one;
      }
      const tighter = svgBudgetScale(pixels);
      if (tighter === 1) {
        break;
      }
      budget *= tighter;
    }
    this.svgBudget = budget;
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

  /**
   * Sizes the canvas to the box it sits in, keeping the stage ratio and full
   * sharpness. Answers with the size the canvas actually took, in css pixels.
   */
  layout(width: number, height: number): { width: number; height: number } | null {
    if (!this.ready) {
      return null;
    }
    const fit = Math.min(width / stage.worldWidth, height / stage.worldHeight);
    const cssWidth = Math.max(1, Math.floor(stage.worldWidth * fit));
    const cssHeight = Math.max(1, Math.floor(stage.worldHeight * fit));
    const resolution = Math.max(
      1,
      Math.min(MAX_SHARPNESS, (cssWidth / stage.worldWidth) * this.pixelRatio()),
    );
    if (this.lastResolution !== resolution) {
      this.lastResolution = resolution;
      this.app.renderer.resolution = resolution;
      this.app.renderer.resize(stage.worldWidth, stage.worldHeight);
      // Text and vector costumes are baked at the size they are drawn at, so a
      // canvas that just grew needs them again — and how much of the budget
      // each one may take moved with it.
      this.markTextDirty();
      this.fitSvgBudget();
      void this.rebakeVectors();
    }
    const canvas = this.app.canvas;
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
    return { width: cssWidth, height: cssHeight };
  }

  setQuality(quality: number): void {
    this.quality = quality;
  }

  /** Text boxes carry their sharpness in their own texture; `sync` rewrites it. */
  private markTextDirty(): void {
    for (const [entity, view] of this.views) {
      if (view.text) {
        entity.dirty = true;
      }
    }
  }

  /**
   * Rasterises again every vector costume the canvas outgrew. The picture is
   * loaded under its own url plus the sharpness, so the old texture stays valid
   * until the new one is in place and nothing renders an emptied texture.
   */
  private async rebakeVectors(): Promise<void> {
    const jobs: Array<{ id: string; url: string; resolution: number }> = [];
    for (const [id, baked] of this.svgBaked) {
      const picture = this.pictures.get(id);
      if (!picture) {
        continue;
      }
      const wanted = this.svgResolution(picture);
      if (wanted > baked.resolution * SVG_REBAKE_RATIO) {
        jobs.push({ id, url: baked.url, resolution: wanted });
      }
    }
    // A few at a time, the way the first load goes: a work with hundreds of
    // vectors would otherwise rasterise all of them in one breath and drop
    // every frame until it was done.
    await pool(jobs, LOAD_CONCURRENCY, (job) => this.bakeVector(job.id, job.url, job.resolution));
  }

  private async bakeVector(id: string, url: string, resolution: number): Promise<void> {
    const previous = this.svgBaked.get(id);
    const picture = this.pictures.get(id);
    if (!picture) {
      return;
    }
    let src = url;
    try {
      const loaded = await this.loadVector(picture, url, resolution);
      src = loaded.src;
      this.keepBaked(id, { url, src, resolution });
      const texture = loaded.texture;
      this.textures.set(id, texture);
      // The alpha mask keeps the image it was first built from: collisions must
      // not shift because the window changed size.
      for (const [entity, view] of this.views) {
        if (view.sprite && view.pictureId === id) {
          view.pictureId = null;
          entity.dirty = true;
        }
      }
      // Nothing draws the old one any more, and it is the size of the new one
      // again — left alone, every resize would add another to the card.
      this.dropBaked(previous);
    } catch {
      // Keep the texture that is already on screen.
      const failed = this.svgBaked.get(id);
      if (failed && failed !== previous) {
        this.svgBaked.delete(id);
        this.dropBaked(failed);
      }
      this.svgBaked.set(id, previous ?? { url, src, resolution });
    }
  }

  /** Records a rasterisation and takes a hold on the file it came from. */
  private keepBaked(id: string, baked: Baked): void {
    this.svgBaked.set(id, baked);
    if (baked.src !== baked.url) {
      holdBaked(baked.src);
    }
  }

  /** Lets go of a rasterisation nothing here points at any more. */
  private dropBaked(baked: Baked | undefined): void {
    if (baked && baked.src !== baked.url) {
      releaseBaked(baked.src);
    }
  }

  /** Stage rectangle in page coordinates, for turning pointer events into stage x/y. */
  canvasRect(): DOMRect {
    return this.app.canvas.getBoundingClientRect();
  }

  /** What the pointer looks like over the stage; an empty string gives it back. */
  setCursor(cursor: string): void {
    const canvas = this.app.canvas;
    if (canvas.style.cursor !== cursor) {
      canvas.style.cursor = cursor;
    }
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
        this.dropStamp(stamp);
      }
      view.stamps = [];
      view.brush?.root.destroy({ children: true });
      view.paint?.root.destroy({ children: true });
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

  /**
   * `Entry.stage.getObjectIndex` — the objects of one scene, front-most first.
   * Only an object's own display object carries `__entity`; strokes and stamps
   * share the layer and are left out.
   */
  drawOrder(sceneId: string): Entity[] {
    const layer = this.sceneLayers.get(sceneId);
    if (!layer) {
      return [];
    }
    const children = layer.children as OwnedContainer[];
    const order: Entity[] = [];
    for (let i = children.length - 1; i >= 0; i -= 1) {
      const entity = children[i]?.__entity;
      if (entity) {
        order.push(entity);
      }
    }
    return order;
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
      // The stamps go with the layer they sit in, but what they were holding is
      // let go here — another runner may be showing the same costume.
      for (const stamp of view.stamps) {
        this.dropStamp(stamp);
      }
      view.stamps = [];
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

  /** Tears the renderer down: the WebGL context and the canvas both go. */
  destroy(): void {
    if (!this.ready) {
      return;
    }
    this.ready = false;
    this.reset();
    this.textures.clear();
    this.images.clear();
    this.loading.clear();
    // Another runner may be showing the same work; only the last hold unloads.
    for (const baked of this.svgBaked.values()) {
      this.dropBaked(baked);
    }
    this.svgBaked.clear();
    this.svgScales.clear();
    this.pictures.clear();
    this.app.destroy({ removeView: true }, { children: true });
  }

  /**
   * 부스트 모드를 켜고 끕니다. 엔트리에서 이 스위치는 렌더러를 고르는 것이라, 이미 그려
   * 둔 채우기(감김 규칙)와 글상자(세로 정렬 · 폭)를 다시 그려야 달라집니다.
   */
  setBoost(on: boolean): void {
    if (this.options.boost === on) {
      return;
    }
    this.options.boost = on;
    // 자르는 규칙 자체가 달라지므로 붙들어 둔 결과는 버립니다.
    this.fillCache = new WeakMap();
    for (const [entity, view] of this.views) {
      for (const which of PAINT_FIRST) {
        // 무리가 들고 있는 "이미 이렇게 그렸다" 표시를 지워 다시 그리게 합니다.
        for (const group of view[which]?.groups ?? []) {
          group.drawn = "";
        }
      }
      if (entity.paint || entity.brush) {
        this.penDirty.add(entity);
      }
      if (entity.type === "textBox") {
        entity.measure(false);
        entity.dirty = true;
      }
    }
    this.flush();
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
    this.penDirty.delete(entity);
    // The bubble is the overlay's, not the view's, and it has to go even where
    // the view is already gone.
    this.overlay?.forget(entity);
    if (!view) {
      return;
    }
    for (const stamp of view.stamps) {
      this.dropStamp(stamp);
    }
    view.brush?.root.destroy({ children: true });
    view.paint?.root.destroy({ children: true });
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
          fill: usableColor(entity.colour) ?? { color: 0x000000, alpha: 1 },
          align: 'center',
        },
        resolution: this.textResolution(entity),
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
        colour: null,
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
      colour: null,
      brush: null,
      paint: null,
      stamps: [],
    };
  }

  // -------------------------------------------------------------------------
  //  Textures
  // -------------------------------------------------------------------------
  /**
   * Loads every costume before the work is allowed to run, the way entry holds
   * a work behind its loading bar. The first scene goes first so the opening
   * frame is ready as early as possible, and they are fetched a few at a time —
   * a work can carry two thousand images and asking for all of them at once
   * stalls the page.
   */
  async preload(
    targets: Target[],
    sceneId?: string,
    onLoaded?: () => void,
  ): Promise<void> {
    const inScene: Picture[] = [];
    const rest: Picture[] = [];
    for (const target of targets) {
      const bucket = !sceneId || target.sceneId === sceneId ? inScene : rest;
      bucket.push(...target.pictures);
    }
    this.setSvgBudget(targets);
    const one = async (picture: Picture) => {
      await this.loadPicture(picture);
      onLoaded?.();
    };
    await pool(inScene, LOAD_CONCURRENCY, one);
    await pool(rest, LOAD_CONCURRENCY, one);
  }

  /** How many costumes `preload` will work through. */
  static costumeCount(targets: Target[]): number {
    return targets.reduce((total, target) => total + target.pictures.length, 0);
  }

  /**
   * Which file this costume is loaded from. A vector with no raster twin is
   * loaded as it comes; where both exist the vector is only taken when it is
   * really a drawing — see `vectorIsBetter`.
   */
  private async pickUrl(picture: Picture): Promise<string> {
    if (picture.imageType !== 'svg' || !picture.fileurl.endsWith('.svg')) {
      return picture.fileurl;
    }
    if (!picture.pngurl) {
      // Nothing else to load. Text in it will still come out in a fallback face.
      await this.fontsReady();
      return picture.fileurl;
    }
    if (this.options.svg === false) {
      return picture.pngurl;
    }
    await this.fontsReady();
    return (await this.vectorIsBetter(picture)) ? picture.fileurl : picture.pngurl;
  }

  /**
   * Whether taking the vector over the raster beside it actually gains anything.
   * Most of what entry stores as `.svg` is not a drawing this can use:
   *
   * - **its own size has to be the size the work draws it at.** Entry's paint
   *   editor re-frames a costume on save and only the raster keeps that framing,
   *   so a vector of any other size comes out stretched;
   * - a `<image>` holding a base64 raster — rasterising that resamples a picture
   *   that was already pixels, and the file is many times the size of the twin;
   * - a `<text>` — an svg used as an image is rendered in a document of its own
   *   that cannot reach the page's web fonts, so the letters come out in a
   *   fallback face while entry's raster has them as they were written.
   *
   * Only what is left is worth the vector. The read is cached, and the browser
   * serves the second one from its own cache.
   */
  private async vectorIsBetter(picture: Picture): Promise<boolean> {
    const url = picture.fileurl;
    const known = this.svgPicks.get(url);
    if (known !== undefined) {
      return known;
    }
    let better = false;
    try {
      const svg = await this.svgText(url);
      // 크기는 `<svg>` 여는 태그에 있으니 앞머리로 족하지만, `<image>`·`<text>` 는
      // 파일 어디에나 있을 수 있어 전체를 봅니다 — `ovenpark.ent` 의 무대 크기 모양은
      // `<image>` 가 29955 바이트에서 시작해서, 앞머리만 보면 png 사본을 두고 521KB
      // 껍데기를 골라 버립니다.
      const size = svgSize(svg.slice(0, SVG_PEEK));
      better =
        size !== null &&
        Math.abs(size.width - picture.dimension.width) <= SIZE_SLACK &&
        Math.abs(size.height - picture.dimension.height) <= SIZE_SLACK &&
        size.width <= PAINT_CANVAS.width &&
        size.height <= PAINT_CANVAS.height &&
        !/<image[\s>]/i.test(svg) &&
        !/<text[\s>]/i.test(svg);
    } catch {
      // Unreadable: the raster twin is the safe one.
    }
    this.svgPicks.set(url, better);
    return better;
  }

  /** 이 주소의 svg 마크업. 한 번만 받아 둡니다. */
  private async svgText(url: string): Promise<string> {
    const known = this.svgTexts.get(url);
    if (known !== undefined) {
      return known;
    }
    const text = await (await fetch(url)).text();
    this.svgTexts.set(url, text);
    return text;
  }

  /**
   * 크기를 박은 사본으로 먼저 굽고, 그것이 안 되면 원래 주소로 굽습니다 — 사본 쪽이
   * 어긋나도 모양이 사라지지는 않게.
   */
  private async loadVector(
    picture: Picture,
    url: string,
    resolution: number,
  ): Promise<{ texture: Texture; src: string }> {
    const sized = await this.vectorSource(url, picture, resolution);
    const data = vectorTextureData(picture.dimension.width, picture.dimension.height, resolution);
    if (sized !== url) {
      try {
        return { texture: (await Assets.load({ src: sized, data })) as Texture, src: sized };
      } catch {
        // 아래에서 원래 주소로 다시 해 봅니다.
      }
    }
    return { texture: (await Assets.load({ src: url, data })) as Texture, src: url };
  }

  /** 목표 배율로 크기를 박은 사본의 주소. 못 만들면 원래 주소를 그대로 씁니다. */
  private async vectorSource(
    url: string,
    picture: Picture,
    resolution: number,
  ): Promise<string> {
    try {
      const sized = sizedVector(
        await this.svgText(url),
        picture.dimension.width * resolution,
        picture.dimension.height * resolution,
      );
      return sized || url;
    } catch {
      return url;
    }
  }

  /**
   * An svg is rasterised in a document of its own, and entry's web fonts have
   * to have arrived before that happens or the text in it comes out in a
   * fallback face. Rasters and sounds do not care, so only this waits.
   */
  private fontsReady(): Promise<void> {
    if (!this.fontsWait) {
      const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
      this.fontsWait = fonts ? fonts.ready.then(() => undefined).catch(() => undefined) : Promise.resolve();
    }
    return this.fontsWait;
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
    this.pictures.set(picture.id, picture);
    const job = (async () => {
      try {
        const url = await this.pickUrl(picture);
        const resolution = this.svgResolution(picture);
        const vector = url.endsWith('.svg');
        const loaded = vector
          ? await this.loadVector(picture, url, resolution)
          : { texture: (await Assets.load(url)) as Texture, src: url };
        const texture = loaded.texture;
        if (vector) {
          this.keepBaked(picture.id, { url, src: loaded.src, resolution });
        }
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
        // One object the renderer chokes on is not a reason to end the work.
        // Entry draws on a canvas, which ignores what it cannot use; here the
        // object keeps the last frame it managed and the rest carries on.
        try {
          this.sync(entity, view);
        } catch (error) {
          this.reportSyncFailure(entity, error);
        }
        entity.dirty = false;
      }
    }
    if (this.penDirty.size) {
      for (const entity of this.penDirty) {
        this.redrawPen(entity);
      }
      this.penDirty.clear();
    }
    if (this.svgScaleGrew) {
      this.svgScaleGrew = false;
      this.fitSvgBudget();
      void this.rebakeVectors();
    }
    this.overlay?.flush();
    this.app.renderer.render(this.app.stage);
  }

  /** Says so once per object, so a failing frame does not fill the console. */
  private reportSyncFailure(entity: Entity, error: unknown): void {
    if (this.syncFailed.has(entity)) {
      return;
    }
    this.syncFailed.add(entity);
    console.warn(`[tessvm] '${entity.target.name}' 을(를) 그리지 못했습니다`, error);
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
      this.noteSvgScale(entity);
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
      // PIXI 필터는 대상을 중간 텍스처에 한 번 그린 뒤 거기에 행렬을 씁니다. 그 텍스처의
      // 배율 기본값이 **1** 이라, 캔버스가 3배로 그리고 있어도 효과가 걸린 오브젝트만
      // 1배로 그려져 확대됩니다 — 효과가 켜지는 순간 가장자리가 계단이 되던 자리입니다
      // (`play.ent` 의 단추는 마우스를 대면 밝기 효과가 붙습니다).
      // `'inherit'` 는 캔버스 배율을 그대로 따라가라는 뜻입니다.
      filter = new ColorMatrixFilter({ resolution: 'inherit', antialias: 'inherit' });
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
    // An unreadable colour leaves the letters as they were, the way the canvas
    // does for entry.
    // `style.fill` 은 PIXI 가 **객체 동일성**으로만 거릅니다(`value === this._originalFill`).
    // 다른 속성은 값이 같으면 그냥 넘어가는데 이것만 새 객체를 넣을 때마다 글을 통째로
    // 다시 재고 다시 그립니다 — 글이 길수록 그 값이 커져서, 2만 자짜리 글상자를 여러 벌
    // 복제하는 작품(`dizzy.ent` 의 장면 2)은 프레임마다 그 일을 복제본 수만큼 합니다.
    // 색이 실제로 달라질 때만 넣습니다.
    if (view.colour !== entity.colour) {
      const fill = usableColor(entity.colour);
      if (fill !== null) {
        style.fill = { color: fill.color, alpha: fill.alpha };
      }
      view.colour = entity.colour;
    }
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
    const resolution = this.textResolution(entity, text);
    if (text.resolution !== resolution) {
      text.resolution = resolution;
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
    } else if (this.options.boost === false) {
      // 캔버스로 그리는 엔트리는 글상자를 `textBaseline: middle` 로 `y = 0` 에 놓으므로
      // **첫 줄**이 상자 가운데에 오고 나머지가 아래로 흐릅니다. 줄이 하나면 가운데
      // 정렬과 같은 자리라 보통 글상자는 달라지지 않습니다.
      text.anchor.set(anchorX, 0);
      text.position.set(0, -(entity.fontSize + 2) / 2);
    } else {
      // 부스트 모드(PIXI)는 `anchor.y = 0.5` — 글 덩어리 전체가 가운데에 옵니다.
      text.anchor.set(anchorX, 0.5);
      text.position.set(0, 0);
    }

    background.clear();
    const bg = entity.bgColor?.startsWith('#') ? usableColor(entity.bgColor) : null;
    if (bg !== null) {
      const offset = entity.lineBreak
        ? 0
        : align === 'left'
          ? entity.width / 2
          : align === 'right'
            ? -entity.width / 2
            : 0;
      background
        .rect(offset - entity.width / 2, -entity.height / 2, entity.width, entity.height)
        .fill({ color: bg.color, alpha: bg.alpha });
    }

    decoration.clear();
    const ink = usableColor(entity.colour);
    if ((entity.underLine || entity.strike) && ink !== null) {
      const width = text.width;
      const left = text.x - width * text.anchor.x;
      const top = text.y - text.height * text.anchor.y;
      const thickness = Math.max(1, entity.fontSize / 14);
      if (entity.underLine) {
        decoration
          .rect(left, top + text.height - thickness, width, thickness)
          .fill({ color: ink.color, alpha: ink.alpha });
      }
      if (entity.strike) {
        decoration
          .rect(left, top + text.height / 2 - thickness / 2, width, thickness)
          .fill({ color: ink.color, alpha: ink.alpha });
      }
    }
  }

  /**
   * Sharpness a text box's own texture is drawn with. Entry hands its text to
   * the canvas at the size it appears, so the letters are as sharp as the
   * screen; here the text is a texture, and it is only that sharp when it is
   * baked at the size the canvas draws it — the object's own scale included.
   * Stepping in halves keeps a text box that is animating its size from baking
   * a new texture every frame.
   */
  private textResolution(entity: Entity, drawn?: Text): number {
    const scale = Math.max(Math.abs(entity.scaleX), Math.abs(entity.scaleY));
    const longest = Math.max(drawn?.width ?? entity.width, drawn?.height ?? entity.height);
    return textSharpness(this.displayScale(), scale, longest);
  }

  /** The style a text box is drawn with — also what it is measured with. */
  private styleFor(entity: Entity, style: TextStyle): TextStyle {
    style.fontFamily = entity.fontFamily;
    style.fontSize = entity.fontSize;
    // Only the metrics are read from this style, but an unreadable colour would
    // still throw on the way in.
    style.fill = usableColor(entity.colour)?.color ?? 0x000000;
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
    // 부스트 모드를 끈 엔트리는 createjs 로 재고, 그 `getMeasuredWidth` 는 줄을 쪼개지
    // 않고 글 전체를 한 번에 `measureText` 합니다 — 줄바꿈이 든 한 줄짜리 글상자의 폭이
    // 가장 긴 줄이 아니라 글 전체 폭으로 남는 자리입니다. 부스트 모드(PIXI)는 줄을
    // 쪼개고 가장 긴 줄을 가져갑니다(엔트리가 갈아 끼운 `TextMetrics.measureText`).
    const whole =
      this.options.boost === false && !entity.lineBreak ? this.measureWhole(entity) : null;
    return { width: whole ?? metrics.width, height: metrics.height };
  }

  /**
   * 글 전체를 한 줄로 보고 잰 폭 — 캔버스의 `measureText` 는 줄바꿈을 글자 하나로
   * 셉니다. 잴 곳이 없으면 `null` 이라 부르는 쪽이 PIXI 쪽 값을 씁니다.
   */
  private measureWhole(entity: Entity): number | null {
    const context = (this.measureCanvas ??= document
      .createElement('canvas')
      .getContext('2d'));
    if (!context) {
      return null;
    }
    // 엔트리가 캔버스에 넘기는 그 글꼴 문자열입니다(굵기 · 기울임 · 크기 · 이름).
    context.font = [
      entity.fontBold && 'bold',
      entity.fontItalic && 'italic',
      `${entity.fontSize}px`,
      entity.fontFamily,
    ]
      .filter(Boolean)
      .join(' ');
    return context.measureText(entity.text).width;
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
        // 글꼴이 바뀐 것이 아니라 같은 글을 다시 재는 자리이므로 폭만 고칩니다.
        entity.measure(false);
        entity.dirty = true;
      }
    }
    this.flush();
  }

  // -------------------------------------------------------------------------
  //  Pen, stamps, layering
  // -------------------------------------------------------------------------
  /** A pen layer for this entity, created under it the way entry inserts one. */
  private penLayer(view: EntityView, which: 'brush' | 'paint'): PenView | null {
    const existing = view[which];
    if (existing) {
      return existing;
    }
    const layer = this.layerOf(view.entity);
    if (!layer) {
      return null;
    }
    const root = new Container();
    const index = this.indexUnder(view.entity);
    layer.addChildAt(root, index < 0 ? layer.children.length : index);
    const pen: PenView = { root, groups: [] };
    view[which] = pen;
    return pen;
  }

  /** The group's node, made on first use and reused while the pen keeps drawing. */
  private penGroup(pen: PenView, index: number): PenGroup {
    const existing = pen.groups[index];
    if (existing) {
      return existing;
    }
    const graphics = new Graphics();
    const node = new Container();
    node.addChild(graphics);
    pen.root.addChild(node);
    const group: PenGroup = { node, graphics, segments: null, drawn: '' };
    pen.groups[index] = group;
    return group;
  }

  /** Empties a group's drawing but keeps the nodes and buffers it drew with. */
  private clearGroup(group: PenGroup): void {
    group.graphics.clear();
    group.segments?.hide();
    group.drawn = '';
    if (group.node.isCachedAsTexture) {
      group.node.cacheAsTexture(false);
    }
    group.node.alpha = 1;
  }

  /**
   * The pen moved. Entry redraws its pen layer once a frame, and so does this —
   * the work below walks every stroke the entity has laid down, and the pen is
   * told about **every point**. Rebuilding there made a frame cost O(points²),
   * which is what a work that draws a few thousand vertices a frame feels as a
   * stall. The rebuild waits for `flush`, which runs once a frame anyway.
   */
  penChanged(entity: Entity): void {
    this.penDirty.add(entity);
  }

  private redrawPen(entity: Entity): void {
    const view = this.views.get(entity);
    if (!view) {
      return;
    }
    // A pen's layer is made the first time it is drawn into, and lands right
    // under the entity — so whichever layer is made second sits in front. Entry
    // makes them when the work first reaches for each pen, so they are taken in
    // that order here; a fixed order would bury one work's fills under the
    // lines another work drew first.
    for (const which of penOrderOf(entity)) {
      const state = entity[which];
      if (!state) {
        continue;
      }
      const pen = this.penLayer(view, which);
      if (!pen) {
        continue;
      }
      // The piece being drawn right now is not in `strokes` yet.
      const pieces =
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

      // Entry keeps adding to one canvas path until the colour, thickness or
      // opacity changes, and draws that whole path in one go. Everything in
      // such a group blends as a single shape, so a translucent pen keeps one
      // flat colour where it crosses itself or picks up again after
      // `stop_drawing`. Each group is drawn on its own node here for the same
      // reason — pieces drawn one by one would blend every overlap twice.
      //
      // Groups that are not see-through have nothing to keep apart, though: one
      // node can hold a run of them, a fill or a stroke each, and a work that
      // changes colour every few points then builds one shape a frame instead
      // of a hundred.
      let count = 0;
      let runFrom = -1;
      const closeRun = (to: number): void => {
        if (runFrom >= 0) {
          this.drawPenRun(this.penGroup(pen, count), pieces, runFrom, to);
          count += 1;
          runFrom = -1;
        }
      };
      for (let i = 0; i < pieces.length; ) {
        const style = pieces[i]!;
        let end = i;
        while (end < pieces.length && sameStyle(style, pieces[end]!)) {
          end += 1;
        }
        const from = i;
        i = end;
        // A work that lifts the pen and puts it down again leaves a stroke with
        // one point in it, which draws nothing.
        let drawable = 0;
        let straight = 0;
        for (let at = from; at < end; at += 1) {
          if (pieces[at]!.points.length >= 4) {
            drawable += 1;
            if (isSegment(pieces[at]!)) {
              straight += 1;
            }
          }
        }
        if (drawable === 0) {
          continue;
        }
        // A run of plain lines gets a mesh of its own, and a see-through group
        // gets a node of its own; everything else joins the run being built.
        const alone = style.opacity !== 0 ||
          (!style.fill && straight === drawable && straight >= SEGMENT_FLOOR);
        if (alone) {
          closeRun(from);
          this.drawPenGroup(this.penGroup(pen, count), style, pieces, from, end, drawable);
          count += 1;
        } else if (runFrom < 0) {
          runFrom = from;
        }
      }
      closeRun(pieces.length);
      // Groups the pen no longer has are emptied rather than thrown away: a work
      // that clears and draws again every frame would otherwise build its nodes
      // and its gpu buffers from nothing each time.
      for (let at = count; at < pen.groups.length; at += 1) {
        this.clearGroup(pen.groups[at]!);
      }
    }
  }

  /**
   * Draws a run of settings groups into one node. Every group in it is opaque,
   * so nothing it holds blends with anything else and the order alone decides
   * what covers what — which one `Graphics` keeps, a fill or a stroke per
   * group, in the order they were laid down.
   */
  private drawPenRun(group: PenGroup, pieces: Stroke[], from: number, to: number): void {
    const drawn = `run/${from}/${to}/${pieces[to - 1]!.points.length}/${pieces[from]!.color}`;
    if (group.drawn === drawn) {
      return;
    }
    group.drawn = drawn;
    group.segments?.hide();
    const graphics = group.graphics;
    graphics.clear();
    const boost = this.options.boost !== false;
    for (let at = from; at < to; ) {
      const style = pieces[at]!;
      let end = at;
      while (end < to && sameStyle(style, pieces[end]!)) {
        end += 1;
      }
      this.tracePenGroup(graphics, style, pieces, at, end, boost);
      at = end;
    }
    this.finishPenGroup(group, 1);
  }

  /** Lays one settings group into a path and closes it with its own paint. */
  private tracePenGroup(
    graphics: Graphics,
    style: Stroke,
    pieces: Stroke[],
    from: number,
    to: number,
    boost: boolean,
  ): void {
    const trace = (points: number[]): void => {
      graphics.moveTo(points[0]!, points[1]!);
      for (let at = 2; at < points.length; at += 2) {
        graphics.lineTo(points[at]!, points[at + 1]!);
      }
    };
    const traceFlipped = (points: number[]): void => {
      graphics.moveTo(points[0]!, -points[1]!);
      for (let at = 2; at < points.length; at += 2) {
        graphics.lineTo(points[at]!, -points[at + 1]!);
      }
    };
    let drew = false;
    for (let at = from; at < to; at += 1) {
      const piece = pieces[at]!;
      if (piece.points.length < 4) {
        continue;
      }
      drew = true;
      if (!style.fill) {
        traceFlipped(piece.points);
        continue;
      }
      const known = this.fillCache.get(piece);
      let parts: number[][] | null;
      if (known && known.boost === boost) {
        parts = known.parts;
      } else {
        const points = piece.points.map((value, at2) => (at2 % 2 === 1 ? -value : value));
        parts = fillParts(points, boost);
        this.fillCache.set(piece, { boost, parts });
      }
      if (parts) {
        for (const part of parts) trace(part);
      } else {
        traceFlipped(piece.points);
      }
    }
    if (!drew) {
      return;
    }
    const ink = usableColor(style.color) ?? { color: 0x000000, alpha: 1 };
    if (style.fill) {
      graphics.fill({ color: ink.color, alpha: ink.alpha });
    } else {
      graphics.stroke({
        width: style.thickness,
        color: ink.color,
        alpha: ink.alpha,
        cap: 'butt',
        join: 'miter',
      });
    }
  }

  /** Draws one settings group, and composites it as one shape when translucent. */
  private drawPenGroup(
    group: PenGroup,
    style: Stroke,
    pieces: Stroke[],
    from: number,
    to: number,
    drawable: number,
  ): void {
    const alpha = 1 - style.opacity / 100;
    // Redrawing costs a fresh cached texture, so leave a group that has not moved.
    const drawn = `${style.color}/${style.thickness}/${style.opacity}/${style.fill}/${
      to - from
    }/${pieces[to - 1]!.points.length}`;
    if (group.drawn === drawn) {
      return;
    }
    group.drawn = drawn;

    // A run of plain lines is a run of rectangles, which the mesh lays down
    // without cutting a path into triangles. Anything with a corner to join,
    // or a shape to fill, stays on the path below.
    let straight = 0;
    if (!style.fill) {
      for (let at = from; at < to; at += 1) {
        if (isSegment(pieces[at]!)) {
          straight += 1;
        }
      }
    }
    const ink = usableColor(style.color) ?? { color: 0x000000, alpha: 1 };
    const batched = straight === drawable && straight >= SEGMENT_FLOOR;
    if (batched) {
      if (!group.segments) {
        group.segments = new SegmentBatch(group.node);
      }
      group.segments.set(pieces, from, to, style.thickness, ink.color, ink.alpha);
    } else {
      group.segments?.hide();
    }

    const graphics = group.graphics;
    graphics.clear();
    if (batched) {
      this.finishPenGroup(group, alpha);
      return;
    }
    this.tracePenGroup(graphics, style, pieces, from, to, this.options.boost !== false);
    this.finishPenGroup(group, alpha);
  }

  /**
   * A cached group is drawn once into a texture and then composited with the
   * group's alpha, which is what keeps overlaps inside it from darkening. The
   * cache holds the size it was made at, so a growing path is cached again.
   */
  private finishPenGroup(group: PenGroup, alpha: number): void {
    group.node.alpha = alpha;
    if (group.node.isCachedAsTexture) {
      group.node.cacheAsTexture(false);
    }
    if (alpha < 1) {
      group.node.cacheAsTexture(true);
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
    const sprite = new Sprite(texture) as StampSprite;
    // A stamp outlives the costume it was made from: the same costume drawn
    // bigger is rasterised again, and the copy this one holds must not go with
    // the old one.
    const baked = this.svgBaked.get(mark.picture.id);
    if (baked && baked.src !== baked.url) {
      holdBaked(baked.src);
      sprite.__baked = baked.src;
    }
    // A vector costume is baked into a texture of its own size, not the
    // costume's, so the texture is what says how much of a stage unit one of
    // its pixels is worth. `sync` lets `width` work that out; a stamp carries
    // the entity's own scale as well, so it has to be worked out here and the
    // two multiplied — setting the scale outright dropped the first of them and
    // stamped every vector costume at the size it was baked at.
    const perPixelX = mark.picture.dimension.width / (texture.width || 1);
    const perPixelY = mark.picture.dimension.height / (texture.height || 1);
    sprite.scale.set(perPixelX * mark.scaleX, perPixelY * mark.scaleY);
    // The pivot is read in the sprite's own space, which is texture pixels.
    sprite.pivot.set(mark.regX / (perPixelX || 1), mark.regY / (perPixelY || 1));
    sprite.position.set(mark.x, -mark.y);
    sprite.rotation = (mark.rotation * Math.PI) / 180;
    sprite.alpha = mark.alpha;
    const index = this.indexUnder(entity);
    layer.addChildAt(sprite, index < 0 ? layer.children.length : index);
    view.stamps.push(sprite);
  }

  /** Ends a stamp and lets go of the rasterisation it was holding. */
  private dropStamp(sprite: StampSprite): void {
    if (sprite.__baked) {
      releaseBaked(sprite.__baked);
      sprite.__baked = undefined;
    }
    sprite.destroy();
  }

  eraseAll(entity: Entity): void {
    const view = this.views.get(entity);
    this.penDirty.delete(entity);
    if (!view) {
      return;
    }
    // The nodes and their gpu buffers are kept and emptied. A work that clears
    // its pen and draws it again every frame — a 3D scene redrawn from scratch —
    // would otherwise build every node and buffer from nothing each frame; the
    // entity's own removal takes the whole pen layer with it anyway.
    for (const pen of [view.brush, view.paint]) {
      for (const group of pen?.groups ?? []) {
        this.clearGroup(group);
      }
    }
    for (const stamp of view.stamps) {
      this.dropStamp(stamp);
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

  /** `DataTable.showTable`·`showChart` — the window, or null to take it down. */
  showTable(table: TableLike | null, chart: number | null = null): void {
    this.overlay?.showTable(table, chart);
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
