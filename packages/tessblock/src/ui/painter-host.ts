/**
 * @fileoverview The costume editor, backed by the painter package.
 *
 * The canvas is a fixed drawing sheet, larger than the stage — a costume is
 * whatever was drawn on it, not the sheet itself. Saving crops the artwork to
 * its own bounds, so a small drawing stays a small costume.
 */
import { signal } from '@preact/signals';
import { Painter } from '../../../painter/dist/index.js';
import { resolveAsset, saveAsset } from '../model/assets.ts';
import { project, selectedObjectId, setObjectProps, updateCostume } from '../model/store.ts';
import { imageSize } from '../model/files.ts';
import type { Costume } from '../model/types.ts';

/** Drawing sheet: full HD, far more room than the stage shows. */
export const SHEET = { width: 1920, height: 1080 };
/**
 * The stage, in costume pixels: a costume at full size in the middle of the
 * stage shows this much of the sheet around it. Marked on the sheet as a
 * guide only; it says nothing about where the object stands.
 */
const STAGE_VIEW = { width: 480, height: 270 };

let ui: Painter | null = null;
let objectId = '';
let costume: Costume | null = null;
let saveTimer: number | undefined;
let loading = false;
let watches: Array<() => void> = [];
let shownKey = '';
/** Bumped when the painter is created or thrown away, so the chrome redraws. */
export const painterVersion = signal(0);
/** Set when the artwork was edited, so viewing a costume never rewrites it. */
let dirty = false;

export function mountPainter(host: HTMLElement): void {
  if (ui) unmountPainter();
  ui = new Painter(host, {
    width: SHEET.width,
    height: SHEET.height,
    mode: 'vector',
    tool: 'select',
  });
  // Text starts in entry's own default font, which the font menu lists.
  ui.setTextStyle({ fontFamily: 'Nanum Gothic' });
  ui.on('change', scheduleSave);
  // A mode switch builds a new sheet, which needs the guide again.
  ui.on('modechange', markStage);
  markStage();
  // The canvas follows the selection straight from the store, the same way the
  // block workspace does.
  watches = [project.subscribe(syncFromStore), selectedObjectId.subscribe(syncFromStore)];
  painterVersion.value += 1;
}

/** Loads whatever costume the selected object is showing, once per change. */
function syncFromStore(): void {
  if (!ui) return;
  const objectId = selectedObjectId.peek();
  const object = project.peek().objects.find((candidate) => candidate.id === objectId);
  if (!object || object.kind === 'text') return;
  const costume = object.costumes.find((candidate) => candidate.id === object.selectedCostumeId)
    ?? object.costumes[0];
  if (!costume) return;
  const key = `${object.id}:${costume.id}`;
  if (key === shownKey) return;
  shownKey = key;
  void loadCostume(object.id, costume);
}

/** What the canvas is holding right now, for debugging from the console. */
export function painterDebug(): Record<string, unknown> {
  return { hasUi: ui !== null, objectId, costume: costume?.id ?? null, loading, dirty, shownKey };
}

/** The live painter, for the editor's own tool bar to drive. */
export function getPainter(): Painter | null {
  return ui;
}

export function unmountPainter(): void {
  flushPainter();
  for (const stop of watches) stop();
  watches = [];
  shownKey = '';
  ui?.destroy();
  ui = null;
  objectId = '';
  costume = null;
  painterVersion.value += 1;
}

/** Puts a costume on the sheet, saving whatever was there before. */
export async function loadCostume(nextObjectId: string, next: Costume): Promise<void> {
  if (!ui) return;
  if (costume && (costume.id !== next.id || objectId !== nextObjectId)) flushPainter();
  loading = true;
  dirty = false;
  objectId = nextObjectId;
  costume = next;
  try {
    const markup = await svgMarkup(resolveAsset(next.url));
    if (markup) {
      if (ui.mode !== 'vector') await ui.setMode('vector');
      ui.clear();
      ui.vector?.loadSVG(centred(markup, next), { resize: false });
    } else {
      if (ui.mode !== 'bitmap') await ui.setMode('bitmap');
      await ui.bitmap?.loadImage(resolveAsset(next.url), { fit: true, clear: true });
    }
    markStage();
    fitStage();
  } finally {
    loading = false;
  }
}

/** Draws the stage guide in the middle of the sheet, sized in percent so it follows the zoom. */
function markStage(): void {
  const frame = ui?.surface.viewport.querySelector<HTMLElement>('.pt-frame');
  if (!frame || frame.querySelector('.stage-guide')) return;
  const left = ((SHEET.width - STAGE_VIEW.width) / 2 / SHEET.width) * 100;
  const top = ((SHEET.height - STAGE_VIEW.height) / 2 / SHEET.height) * 100;
  const right = 100 - left;
  const bottom = 100 - top;
  // The sheet past the guide is softly veiled: a sheet-sized veil with the guide cut out.
  const veil = document.createElement('div');
  veil.className = 'stage-veil';
  veil.style.clipPath = `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, `
    + `${left}% ${top}%, ${right}% ${top}%, ${right}% ${bottom}%, ${left}% ${bottom}%, ${left}% ${top}%)`;
  const guide = document.createElement('div');
  guide.className = 'stage-guide';
  guide.style.inset = `${top}% ${left}%`;
  const label = document.createElement('span');
  label.textContent = '실행 화면';
  guide.appendChild(label);
  frame.append(veil, guide);
}

/** Zooms so the stage guide fills most of the view, and centres it. */
export function fitStage(): void {
  const surface = ui?.surface;
  if (!surface) return;
  const view = surface.viewport;
  if (!view.clientWidth || !view.clientHeight) return;
  surface.setZoom(Math.min(view.clientWidth / STAGE_VIEW.width, view.clientHeight / STAGE_VIEW.height) * 0.8);
  const frame = view.querySelector<HTMLElement>('.pt-frame');
  if (!frame) return;
  view.scrollLeft = frame.offsetLeft + frame.offsetWidth / 2 - view.clientWidth / 2;
  view.scrollTop = frame.offsetTop + frame.offsetHeight / 2 - view.clientHeight / 2;
}

function scheduleSave(): void {
  if (loading) return;
  dirty = true;
  if (saveTimer !== undefined) clearTimeout(saveTimer);
  saveTimer = setTimeout(flushPainter, 500) as unknown as number;
}

/** Writes the artwork back into the costume it came from, cropped to itself. */
export function flushPainter(): void {
  if (saveTimer !== undefined) {
    clearTimeout(saveTimer);
    saveTimer = undefined;
  }
  if (!ui || !costume || !objectId || loading || !dirty) return;
  dirty = false;
  const exported = ui.export();
  const cropped = exported.startsWith('data:') ? cropRaster(exported) : cropVector(exported);
  if (!cropped) return;
  if (cropped.width === costume.width && cropped.height === costume.height
    && cropped.url === resolveAsset(costume.url)) return;
  keepCentre(costume, cropped);
  const target = costume.id;
  const owner = objectId;
  costume = { ...costume, width: cropped.width, height: cropped.height };
  // The picture goes to the asset store; the project keeps the reference.
  void saveAsset(cropped.url).then((reference) => {
    updateCostume(owner, target, { url: reference, width: cropped.width, height: cropped.height });
    if (costume?.id === target) costume = { ...costume, url: reference };
  });
}

/**
 * A costume drawn on the sheet is cropped around the sheet's middle, so the
 * middle of the picture does not move. An object whose registration point was
 * dragged elsewhere has that point moved by the same amount, so nothing on the
 * stage shifts when a costume is edited.
 */
function keepCentre(before: Costume, after: Artwork): void {
  const object = project.peek().objects.find((candidate) => candidate.id === objectId);
  const centre = object?.props.center;
  if (!centre) return;
  setObjectProps(object!.id, {
    center: {
      x: Math.round(centre.x + (after.width - before.width) / 2),
      y: Math.round(centre.y + (after.height - before.height) / 2),
    },
  });
}

interface Artwork {
  url: string;
  width: number;
  height: number;
}

/**
 * Moves costume markup to the middle of the sheet.
 *
 * Each shape is shifted on its own. Wrapping them in one `<g>` would land on
 * the canvas as a single grouped item, which nobody asked for.
 */
function centred(markup: string, source: Costume): string {
  const document_ = new DOMParser().parseFromString(markup, 'image/svg+xml');
  const root = document_.documentElement;
  if (root.nodeName === 'parsererror') return markup;

  const box = (root.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number);
  const sized = box.length === 4 && box.every(Number.isFinite);
  const minX = sized ? box[0]! : 0;
  const minY = sized ? box[1]! : 0;
  const width = sized ? box[2]! : (Number(root.getAttribute('width')) || source.width);
  const height = sized ? box[3]! : (Number(root.getAttribute('height')) || source.height);
  const dx = Math.round(SHEET.width / 2 - width / 2 - minX);
  const dy = Math.round(SHEET.height / 2 - height / 2 - minY);

  for (const child of Array.from(root.children)) {
    const own = child.getAttribute('transform');
    child.setAttribute('transform', `translate(${dx} ${dy})${own ? ` ${own}` : ''}`);
  }
  root.setAttribute('width', String(SHEET.width));
  root.setAttribute('height', String(SHEET.height));
  root.setAttribute('viewBox', `0 0 ${SHEET.width} ${SHEET.height}`);
  return new XMLSerializer().serializeToString(root);
}

/** Measures the drawing inside the sheet and keeps only that part. */
function cropVector(markup: string): Artwork | null {
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-99999px;top:0;width:0;height:0;overflow:hidden;';
  holder.innerHTML = markup;
  document.body.appendChild(holder);
  try {
    const root = holder.querySelector('svg');
    if (!root) return null;
    const drawn = (root as SVGGraphicsElement).getBBox();
    if (!Number.isFinite(drawn.width) || drawn.width < 0.5 || drawn.height < 0.5) {
      return { url: emptyCostume(), width: 48, height: 48 };
    }
    const { x, y, width, height } = middleBox(drawn);
    const open = /<svg\b[^>]*>/i.exec(markup)?.[0] ?? '';
    const cropped = markup.replace(
      open,
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" `
      + `width="${width}" height="${height}" viewBox="${x} ${y} ${width} ${height}">`,
    );
    return { url: svgUrl(cropped), width, height };
  } finally {
    holder.remove();
  }
}

/** Same for a bitmap: the opaque pixels decide the costume's size. */
function cropRaster(dataUrl: string): Artwork | null {
  const image = new Image();
  image.src = dataUrl;
  if (!image.complete || !image.naturalWidth) return { url: dataUrl, width: SHEET.width, height: SHEET.height };
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d');
  if (!context) return { url: dataUrl, width: canvas.width, height: canvas.height };
  context.drawImage(image, 0, 0);
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  let minX = canvas.width;
  let minY = canvas.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      if (data[(y * canvas.width + x) * 4 + 3]! < 8) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return { url: emptyCostume(), width: 48, height: 48 };
  const box = middleBox({ x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 });
  const cut = document.createElement('canvas');
  cut.width = box.width;
  cut.height = box.height;
  cut.getContext('2d')?.drawImage(canvas, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height);
  return { url: cut.toDataURL('image/png'), width: box.width, height: box.height };
}

/**
 * The smallest box around the artwork that still has the sheet's middle at its
 * middle. Cropping tight to the drawing instead would slide the costume's
 * centre — and with it the object — every time the picture is edited.
 */
function middleBox(drawn: { x: number; y: number; width: number; height: number }): {
  x: number; y: number; width: number; height: number;
} {
  const centreX = SHEET.width / 2;
  const centreY = SHEET.height / 2;
  const reachX = Math.max(Math.abs(drawn.x - centreX), Math.abs(drawn.x + drawn.width - centreX));
  const reachY = Math.max(Math.abs(drawn.y - centreY), Math.abs(drawn.y + drawn.height - centreY));
  const width = Math.max(1, Math.ceil(reachX * 2));
  const height = Math.max(1, Math.ceil(reachY * 2));
  return { x: Math.round(centreX - width / 2), y: Math.round(centreY - height / 2), width, height };
}

function svgUrl(markup: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
}

function emptyCostume(): string {
  return svgUrl('<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48"></svg>');
}

/** Measures an uploaded image so the costume declares its real size. */
export async function measure(url: string): Promise<{ width: number; height: number }> {
  const markup = await svgMarkup(url);
  if (markup) {
    const open = /<svg\b[^>]*>/i.exec(markup)?.[0] ?? '';
    const width = Number(/width="([\d.]+)/i.exec(open)?.[1]);
    const height = Number(/height="([\d.]+)/i.exec(open)?.[1]);
    if (Number.isFinite(width) && Number.isFinite(height)) return { width, height };
    const box = /viewBox="([-\d.\s]+)"/i.exec(open)?.[1]?.trim().split(/[\s,]+/).map(Number);
    if (box?.length === 4) return { width: box[2]!, height: box[3]! };
  }
  return imageSize(url);
}

/** The svg text behind a url, or null when it is a raster image. */
async function svgMarkup(url: string): Promise<string | null> {
  if (url.startsWith('data:image/svg+xml')) {
    const payload = url.slice(url.indexOf(',') + 1);
    return url.slice(0, url.indexOf(',')).includes(';base64') ? atob(payload) : decodeURIComponent(payload);
  }
  if (/\.svg($|\?)/i.test(url)) {
    try {
      const response = await fetch(url);
      return response.ok ? await response.text() : null;
    } catch {
      return null;
    }
  }
  return null;
}
