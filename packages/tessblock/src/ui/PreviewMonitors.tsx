/**
 * Variable and list boxes on the stage before anything runs, placed and shaped
 * the way the runner draws them (`tessvm/src/render/overlay.ts`). A box sits
 * where its variable says (`at`), or else at entry's own place — values and
 * lists each stacked down columns, counted among the work's variables of their
 * kind. Dragging a box sets its place.
 */
import { signal } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';
import { Application, CanvasTextMetrics } from 'pixi.js';
import { Overlay } from '../../../tessvm/src/render/overlay.ts';
import { Variable, stage } from '../../../tessvm/src/runtime/model.ts';
import { currentScene, project, updateVariable } from '../model/store.ts';
import { STAGE } from './stage-geometry.ts';
import type { VariableDef } from '../model/types.ts';

type Point = { x: number; y: number };

/** Set once the runner's own drawing of the boxes is on screen; the boxes below then only take the pointer. */
const drawn = signal(false);

/** The list being resized and its size now, before it is let go. */
const resizing = signal<{ id: string; size: { width: number; height: number } } | null>(null);

/** `LIST_MIN_SIZE` — entry keeps a list box at least this big either way. */
const LIST_MIN = 100;

/** Resizes a list box from its corner; letting go stores the size, rounded. */
function startResize(event: PointerEvent, variable: VariableDef, from: { width: number; height: number }, toStage: (event: PointerEvent) => Point) {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  const element = event.currentTarget as HTMLElement;
  element.setPointerCapture(event.pointerId);
  const start = toStage(event);
  const follow = (move: PointerEvent) => {
    const now = toStage(move);
    resizing.value = {
      id: variable.id,
      size: {
        width: Math.max(LIST_MIN, from.width + now.x - start.x),
        height: Math.max(LIST_MIN, from.height + now.y - start.y),
      },
    };
  };
  const drop = () => {
    element.removeEventListener('pointermove', follow);
    element.removeEventListener('pointerup', drop);
    element.removeEventListener('pointercancel', drop);
    const size = resizing.value?.id === variable.id ? resizing.value.size : null;
    resizing.value = null;
    if (size && (size.width !== from.width || size.height !== from.height)) {
      updateVariable(variable.id, { size: { width: Math.round(size.width), height: Math.round(size.height) } });
    }
  };
  element.addEventListener('pointermove', follow);
  element.addEventListener('pointerup', drop);
  element.addEventListener('pointercancel', drop);
}

/** The box being dragged and where it is now, before it is let go. */
const moving = signal<{ id: string; at: Point } | null>(null);

/** Where a box sits: while dragged, under the pointer; else its own place or entry's. */
function placeOf(variable: VariableDef, index: number): Point {
  if (moving.value?.id === variable.id) return moving.value.at;
  return variable.at ?? homeOf(index, variable.kind === 'list');
}

/** Drags a box by its top left; letting go stores the place, rounded. */
function startMove(event: PointerEvent, variable: VariableDef, from: Point, toStage: (event: PointerEvent) => Point) {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  const element = event.currentTarget as HTMLElement;
  element.setPointerCapture(event.pointerId);
  const start = toStage(event);
  const follow = (move: PointerEvent) => {
    const now = toStage(move);
    moving.value = { id: variable.id, at: { x: from.x + now.x - start.x, y: from.y + now.y - start.y } };
  };
  const drop = () => {
    element.removeEventListener('pointermove', follow);
    element.removeEventListener('pointerup', drop);
    element.removeEventListener('pointercancel', drop);
    const at = moving.value?.id === variable.id ? moving.value.at : null;
    moving.value = null;
    // Entry takes a zero as "not placed", so a box never lands exactly on one.
    const round = (value: number) => Math.round(value) || 1;
    if (at && (at.x !== from.x || at.y !== from.y)) updateVariable(variable.id, { at: { x: round(at.x), y: round(at.y) } });
  };
  element.addEventListener('pointermove', follow);
  element.addEventListener('pointerup', drop);
  element.addEventListener('pointercancel', drop);
}

/** `Overlay.homeOf`: entry's place for the index-th box of its kind; top left, y down from the stage middle. */
function homeOf(index: number, list: boolean): { x: number; y: number } {
  if (list) {
    return {
      x: -Math.floor((index % 24) / 6) * 110 + 120,
      y: index * 24 + 20 - 135 - Math.floor(index / 6) * 145,
    };
  }
  const column = Math.floor(index / 11);
  return { x: 10 - 240 + column * 80, y: index * 24 + 20 - 135 - column * 264 };
}

/** The runner's box height leaves room for this many list rows. */
const LIST_ROW_HEIGHT = 20;
const LIST_TITLE_HEIGHT = 23;
const LIST_WIDTH = 100;
const LIST_HEIGHT = 120;

export function PreviewMonitors({ toStage }: { toStage: (event: PointerEvent) => Point }) {
  const model = project.value;
  const scene = currentScene.value?.id ?? '';
  // Written order: globals first, then each object's own, as the compiler lists them.
  const ordered = [
    ...model.variables.filter((variable) => !variable.owner),
    ...model.objects.flatMap((object) => model.variables.filter((variable) => variable.owner === object.id)),
  ];
  const sceneOf = new Map(model.objects.map((object) => [object.id, object.sceneId]));
  const values = ordered.filter((variable) => variable.kind !== 'list');
  const lists = ordered.filter((variable) => variable.kind === 'list');
  // An object's box shows only while that object's scene is on, as when running.
  const shows = (variable: VariableDef) => variable.visible && (!variable.owner || sceneOf.get(variable.owner) === scene);

  return (
    <>
      <MonitorCanvas ordered={ordered} scene={scene} />
      {values.map((variable, index) => {
        if (!shows(variable)) return null;
        const at = placeOf(variable, index);
        return (
          <div
            key={variable.id}
            class={`pm-value${moving.value?.id === variable.id ? ' moving' : ''}${drawn.value ? ' hit' : ''}`}
            onPointerDown={(event) => startMove(event, variable, at, toStage)}
            style={{ left: `${at.x + STAGE.width / 2}px`, top: `${at.y + STAGE.height / 2 - 14}px` }}
          >
            <span class="pm-name">{variable.name}</span>
            <span class="pm-pill">{String(variable.value)}</span>
          </div>
        );
      })}
      {lists.map((variable, index) => {
        if (!shows(variable)) return null;
        const at = placeOf(variable, index);
        const size = resizing.value?.id === variable.id ? resizing.value.size : variable.size ?? { width: LIST_WIDTH, height: LIST_HEIGHT };
        const seats = Math.floor((size.height - 15) / LIST_ROW_HEIGHT);
        return (
          <div
            key={variable.id}
            class={`pm-list${moving.value?.id === variable.id ? ' moving' : ''}${drawn.value ? ' hit' : ''}`}
            onPointerDown={(event) => startMove(event, variable, at, toStage)}
            style={{
              left: `${at.x + STAGE.width / 2}px`,
              top: `${at.y + STAGE.height / 2}px`,
              // The runner strokes its outline on the box's edge, half of it outside.
              width: `${size.width + 8}px`,
              height: `${size.height + 23}px`,
            }}
          >
            <div class="pm-list-title">{variable.name}</div>
            {/* Rows at the runner's own spots (`Overlay.drawRow`): a strip from 24, 4 below the row's top. */}
            {variable.array.slice(0, seats).map((item, row) => (
              <div class="pm-row" key={row} style={{ top: `${LIST_TITLE_HEIGHT + row * LIST_ROW_HEIGHT}px` }}>
                <span class="pm-row-no">{row + 1}</span>
                <span class="pm-row-value" style={{ width: `${size.width - 24}px` }}>{String(item)}</span>
              </div>
            ))}
            {/* The corner the runner draws its resize handle in. */}
            <span
              class="pm-resize"
              title="크기 바꾸기"
              onPointerDown={(event) => startResize(event, variable, size, toStage)}
            />
          </div>
        );
      })}
    </>
  );
}

/**
 * The boxes drawn by the runner's own overlay (`tessvm/src/render/overlay.ts`)
 * on a see-through canvas the size of the stage, so they look exactly as they
 * will once the work runs. The DOM boxes stay underneath for dragging.
 */
function MonitorCanvas({ ordered, scene }: { ordered: VariableDef[]; scene: string }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<{ app: Application; overlay: Overlay; fresh: () => void } | null>(null);
  /**
   * One runner variable per editor variable, kept across draws: the overlay
   * keeps a box per variable object, so a new object each draw would leave the
   * old box behind (a trail while dragging).
   */
  const kept = useRef(new Map<string, Variable>());
  const keptIds = useRef('');
  // What the latest render asked for; the canvas's own callbacks read it here.
  const latest = useRef({ ordered, scene });
  latest.current = { ordered, scene };
  const idsOf = (list: VariableDef[]) => list.map((def) => `${def.id}:${def.name}:${def.kind}:${def.slide ? 1 : 0}:${def.owner ?? ''}`).join('|');

  function draw(): void {
    const current = view.current;
    if (!current) return;
    const { ordered, scene } = latest.current;
    const model = project.peek();
    const names = new Map(model.objects.map((object) => [object.id, object.name]));
    const scenes = new Map(model.objects.map((object) => [object.id, object.sceneId]));
    // A variable added, removed, renamed or retyped starts the overlay afresh.
    const ids = idsOf(ordered);
    if (ids !== keptIds.current) {
      keptIds.current = ids;
      kept.current.clear();
      current.fresh();
      return;
    }
    const variables = ordered.map((def) => {
      const kind = def.kind === 'list' ? 'list' : def.slide ? 'slide' : 'variable';
      let variable = kept.current.get(def.id);
      if (!variable) {
        variable = new Variable(def.id, def.name, def.owner, kind);
        kept.current.set(def.id, variable);
      }
      variable.visible = def.visible;
      variable.value = def.value;
      variable.array = def.array.map((data) => ({ data }));
      if (def.slide) {
        variable.minValue = def.slide.min;
        variable.maxValue = def.slide.max;
      }
      const at = moving.value?.id === def.id ? moving.value.at : def.at;
      variable.x = at ? at.x : 0;
      variable.y = at ? at.y : 0;
      const size = resizing.value?.id === def.id ? resizing.value.size : def.size;
      variable.width = size?.width ?? LIST_WIDTH;
      variable.height = size?.height ?? LIST_HEIGHT;
      return variable;
    });
    current.overlay.bind({
      variables,
      ownerName: (id) => names.get(id) ?? null,
      ownerScene: (id) => scenes.get(id) ?? null,
      answer: () => '',
      answerVisible: () => false,
      timer: () => 0,
      timerVisible: () => false,
      scene: () => scene,
    });
    current.overlay.flush();
    current.app.renderer.render(current.app.stage);
  }

  useEffect(() => {
    let disposed = false;
    const app = new Application();
    const element = host.current;
    // Canvas pixels per stage pixel: the sheet's own scale, the screen's, and a
    // margin so the letters stay crisp; the runner's text follows the same idea.
    const sheetScale = Number(getComputedStyle(element?.closest('.preview') ?? document.body).getPropertyValue('--stage-scale')) || 1;
    const resolution = Math.min(6, Math.max(2, Math.ceil(sheetScale * (window.devicePixelRatio || 1) * 0.75 * 2 * 2) / 2));
    void app.init({
      width: stage.worldWidth,
      height: stage.worldHeight,
      backgroundAlpha: 0,
      antialias: true,
      resolution,
      autoStart: false,
      preference: 'webgl',
    }).then(() => {
      if (disposed || !element) {
        app.destroy({ removeView: true }, { children: true });
        return;
      }
      app.ticker.stop();
      app.canvas.classList.add('pm-canvas');
      element.appendChild(app.canvas);
      const textResolution = Math.min(8, Math.max(2, Math.ceil(resolution * stage.scale * 2) / 2));
      const fresh = () => {
        for (const child of app.stage.removeChildren()) child.destroy({ children: true });
        const overlay = new Overlay(app.stage);
        overlay.setTextResolution(textResolution);
        view.current = { app, overlay, fresh };
        keptIds.current = idsOf(latest.current.ordered);
        kept.current.clear();
        draw();
      };
      fresh();
      drawn.value = true;
      // Letters measured before the web font arrived are measured again, as the runner does.
      void document.fonts?.ready.then(() => {
        if (disposed) return;
        CanvasTextMetrics.clearMetrics();
        fresh();
      });
    }).catch(() => {
      drawn.value = false;
    });
    return () => {
      disposed = true;
      drawn.value = false;
      // Only this canvas goes; the textures and caches PIXI shares with the runner stay.
      view.current?.app.destroy({ removeView: true }, { children: true });
      view.current = null;
    };
  }, []);

  useEffect(draw);

  return <div class="pm-canvas-host" ref={host} />;
}
