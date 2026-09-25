/**
 * The stage before anything runs.
 *
 * Objects are drawn where they start, and the selected one carries a transform
 * box: corners and edges resize it, the arm above turns it, and the crosshair
 * moves the point x and y refer to.
 */
import { fontFamily } from '../model/fonts.ts';
import { useEffect, useRef } from 'preact/hooks';
import { sceneObjects, selectObject, selectedObjectId, setObjectProps, setTextProps } from '../model/store.ts';
import { centerMode } from './state.ts';
import { resolveAsset } from '../model/assets.ts';
import { beginDrag } from './drag.ts';
import { paintedAt, preloadMask } from './pixel-hit.ts';
import {
  STAGE, angleFromStage, centerFromStage, geometryOf, handleLocal, localToStage, resizeFromHandle,
  rotate, stageToLocal, type HandleKind, type Point,
} from './stage-geometry.ts';
import type { TessObject, TextProps } from '../model/types.ts';
import { signal } from '@preact/signals';
import { CanvasTextGenerator, CanvasTextMetrics, TextStyle } from 'pixi.js';
import { PreviewMonitors } from './PreviewMonitors.tsx';

const HANDLES: HandleKind[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
/** How far above the top edge the rotation arm reaches, in screen pixels. */
const ARM = 26;

export function StagePreview() {
  const objects = sceneObjects.value;
  const host = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLDivElement>(null);
  const selected = objects.find((object) => object.id === selectedObjectId.value) ?? null;

  useEffect(() => {
    const element = host.current;
    if (!element) return undefined;
    // The runner's own fit (`renderer.layout`): the smaller of the two ratios,
    // with the width rounded down to whole pixels, so both draw the same size.
    const fit = () => {
      const ratio = Math.min(element.clientWidth / STAGE.width, element.clientHeight / STAGE.height);
      const width = Math.max(1, Math.floor(STAGE.width * ratio));
      element.style.setProperty('--stage-scale', String(width / STAGE.width || 1));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  /** Pointer position in stage pixels. */
  function toStage(event: PointerEvent): Point {
    const frame = area.current?.getBoundingClientRect();
    if (!frame) return { x: 0, y: 0 };
    const scale = frame.width / STAGE.width;
    return { x: (event.clientX - frame.left) / scale, y: (event.clientY - frame.top) / scale };
  }

  return (
    <div
      class="preview"
      ref={host}
      // A second click would otherwise start selecting words around the stage.
      onMouseDown={(event) => { if (event.detail > 1) event.preventDefault(); }}
    >
      {/* Exactly the stage's box, sized and centred as the runner fits its canvas. */}
      <div
        class="preview-stage"
        ref={area}
        onPointerDown={(event) => {
          // Handles, boxes and the object under the pointer each take their own presses.
          if ((event.target as Element).closest('.transform-box, .pm-value, .pm-list')) return;
          const hit = objectAt(objects, toStage(event));
          if (hit) dragObject(hit, event, toStage);
        }}
        onPointerMove={(event) => {
          if (event.buttons || !area.current) return;
          const over = (event.target as Element).closest('.transform-box, .pm-value, .pm-list');
          area.current.style.cursor = !over && objectAt(objects, toStage(event)) ? 'grab' : '';
        }}
      >
        <div class="preview-sheet">
          {[...objects].reverse().map((object) => (
            <PreviewObject key={object.id} object={object} toStage={toStage} />
          ))}
          <PreviewMonitors toStage={toStage} />
        </div>
        {selected && <TransformBox object={selected} toStage={toStage} />}
      </div>
    </div>
  );
}

/** Picks an object up and moves it with the pointer, unless it is locked. */
function dragObject(object: TessObject, event: PointerEvent, toStage: (event: PointerEvent) => Point): void {
  event.preventDefault();
  selectObject(object.id);
  if (object.props.lock) return;
  const start = toStage(event);
  const originX = object.props.x;
  const originY = object.props.y;
  beginDrag(event, {
    onMove(moved) {
      const now = toStage(moved);
      setObjectProps(object.id, {
        x: Math.round(originX + (now.x - start.x)),
        y: Math.round(originY - (now.y - start.y)),
      });
    },
  });
}

/**
 * The topmost object painted at a stage point. A picture counts only where it
 * is not see-through, so objects under a big picture's clear parts stay
 * reachable; a text box counts over its whole box.
 */
function objectAt(objects: TessObject[], point: Point): TessObject | null {
  for (const object of objects) {
    const geometry = geometryOf(object);
    const local = stageToLocal(geometry, point);
    if (local.x < 0 || local.y < 0 || local.x >= geometry.size.x || local.y >= geometry.size.y) continue;
    if (object.kind === 'text') return object;
    const costume = object.costumes.find((candidate) => candidate.id === object.selectedCostumeId) ?? object.costumes[0];
    const shown = document.querySelector<HTMLImageElement>(`.po[data-object="${CSS.escape(object.id)}"] img`);
    if (!costume || paintedAt(resolveAsset(costume.url), geometry.size.x, geometry.size.y, local, shown)) return object;
  }
  return null;
}

interface DragProps {
  object: TessObject;
  toStage: (event: PointerEvent) => Point;
}

function PreviewObject({ object, toStage }: DragProps) {
  const geometry = geometryOf(object);
  const costume = object.costumes.find((candidate) => candidate.id === object.selectedCostumeId)
    ?? object.costumes[0];
  const text = object.text;

  return (
    <div
      class={`po ${object.props.lock ? 'locked' : ''}`}
      data-object={object.id}
      style={{
        left: `${geometry.origin.x - geometry.reg.x}px`,
        top: `${geometry.origin.y - geometry.reg.y}px`,
        width: `${geometry.size.x}px`,
        height: `${geometry.size.y}px`,
        transformOrigin: `${geometry.reg.x}px ${geometry.reg.y}px`,
        transform: `rotate(${geometry.angle}deg) scale(${geometry.scale.x}, ${geometry.scale.y})`,
        opacity: object.props.visible ? 1 : 0.15,
      }}
      title={object.name}
    >
      {object.kind === 'text' && text ? (
        <>
          <div class="po-text-bg" style={{ background: text.bgColor ?? 'transparent' }} />
          <RunnerText text={text} size={geometry.size} reg={geometry.reg} scale={Math.max(Math.abs(geometry.scale.x), Math.abs(geometry.scale.y))} />
        </>
      ) : (
        costume && (
          <img
            src={resolveAsset(costume.url)}
            alt=""
            draggable={false}
            // Its alpha is read now, ahead of the first press on it.
            onLoad={() => preloadMask(resolveAsset(costume.url), geometry.size.x, geometry.size.y)}
          />
        )
      )}
    </div>
  );
}

/** Handles live outside the scaled sheet so they keep their size on screen. */
function TransformBox({ object, toStage }: DragProps) {
  const geometry = geometryOf(object);
  const locked = object.props.lock;
  const corners = (['nw', 'ne', 'se', 'sw'] as HandleKind[])
    .map((kind) => localToStage(geometry, handleLocal(geometry, kind)));
  const outline = corners.map((point) => `${percent(point.x, STAGE.width)}% ${percent(point.y, STAGE.height)}%`).join(', ');
  const top = localToStage(geometry, handleLocal(geometry, 'n'));
  const arm = rotate({ x: 0, y: -ARM }, geometry.angle);

  function startResize(event: PointerEvent, kind: HandleKind) {
    event.stopPropagation();
    if (locked) return;
    beginDrag(event, {
      onMove(moved) {
        const text = object.text;
        const frame = object.kind === 'text' && text?.lineBreak;
        const next = resizeFromHandle(geometry, kind, toStage(moved), !frame && kind.length === 2 && !moved.shiftKey);
        if (frame && text) {
          // The handles size the frame the text wraps in; the letters keep their size.
          const width = geometry.size.x * ((next.scaleX ?? 100) / 100) / (geometry.scale.x || 1);
          const height = geometry.size.y * ((next.scaleY ?? 100) / 100) / (geometry.scale.y || 1);
          setTextProps(object.id, { boxWidth: Math.max(8, Math.round(width)), boxHeight: Math.max(8, Math.round(height)) });
          setObjectProps(object.id, { x: next.x, y: next.y });
          return;
        }
        setObjectProps(object.id, next);
      },
    });
  }

  function startRotate(event: PointerEvent) {
    event.stopPropagation();
    if (locked) return;
    beginDrag(event, {
      onMove(moved) {
        const angle = angleFromStage(geometry, toStage(moved), moved.shiftKey);
        setObjectProps(object.id, { angle });
      },
    });
  }

  function startCenter(event: PointerEvent) {
    event.stopPropagation();
    if (locked) return;
    beginDrag(event, {
      onMove(moved) {
        setObjectProps(object.id, centerFromStage(geometry, toStage(moved)));
      },
    });
  }

  return (
    <div class={`transform-box ${locked ? 'locked' : ''}`}>
      <svg class="tb-outline" viewBox={`0 0 ${STAGE.width} ${STAGE.height}`} preserveAspectRatio="none">
        <polygon
          points={corners.map((point) => `${point.x},${point.y}`).join(' ')}
          vector-effect="non-scaling-stroke"
        />
        <line
          x1={top.x}
          y1={top.y}
          x2={top.x + arm.x}
          y2={top.y + arm.y}
          vector-effect="non-scaling-stroke"
        />
      </svg>
      {HANDLES.map((kind) => {
        const point = localToStage(geometry, handleLocal(geometry, kind));
        return (
          <button
            key={kind}
            class={`tb-handle tb-${kind}`}
            style={place(point)}
            title="크기 조절"
            onPointerDown={(event) => startResize(event, kind)}
          />
        );
      })}
      <button
        class="tb-handle tb-rot"
        style={place({ x: top.x + arm.x, y: top.y + arm.y })}
        title="회전하기"
        onPointerDown={startRotate}
      />
      {centerMode.value && (
        <button
          class="tb-handle tb-center"
          style={place(geometry.origin)}
          title="무게중심 옮기기"
          onPointerDown={startCenter}
        />
      )}
      <span class="tb-readout" style={place({ x: geometry.origin.x, y: geometry.origin.y })}>
        {Math.round(object.props.scaleX)}% × {Math.round(object.props.scaleY)}%
      </span>
    </div>
  );
}

function place(point: Point): Record<string, string> {
  return { left: `${percent(point.x, STAGE.width)}%`, top: `${percent(point.y, STAGE.height)}%` };
}

function percent(value: number, total: number): number {
  return Math.round((value / total) * 10000) / 100;
}


/** Bumped as web fonts arrive, so letters measured with a fallback face are drawn again. */
const fontsTick = signal(0);
if (typeof document !== 'undefined' && document.fonts) {
  document.fonts.addEventListener('loadingdone', () => { fontsTick.value += 1; });
  void document.fonts.ready.then(() => { fontsTick.value += 1; });
}

/** `TEXT_BOX_REPOSITION_OFFSET - TEXT_BOX_WEBGL_OFFSET`: a wrapping box's text starts this far below its top. */
const WRAPPED_TOP = 10 - 5.9;

/**
 * A text box's letters drawn the way the runner draws them (`syncTextBox`):
 * PIXI's own measuring and line layout, the same `fillText`, and the same
 * anchor — one line hangs from its middle, a wrapping box from its top.
 */
function RunnerText(
  { text, size, reg, scale }:
  { text: TextProps; size: Point; reg: Point; scale: number },
) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const fonts = fontsTick.value;
  const align = text.align;
  const family = fontFamily(text.font);
  const style = new TextStyle({
    fontFamily: family,
    fontSize: text.fontSize,
    fontWeight: text.bold ? 'bold' : 'normal',
    fontStyle: text.italic ? 'italic' : 'normal',
    align,
    lineHeight: text.fontSize + 2,
    wordWrap: text.lineBreak,
    wordWrapWidth: size.x,
    breakWords: true,
  });
  const measured = CanvasTextMetrics.measureText(text.content || ' ', style);
  const width = Math.max(1, measured.width);
  const height = Math.max(1, measured.height);
  const anchorX = align === 'left' ? 0 : align === 'right' ? 1 : 0.5;
  const left = text.lineBreak
    ? reg.x + (align === 'left' ? -size.x / 2 : align === 'right' ? size.x / 2 : 0) - anchorX * width
    : reg.x - anchorX * width;
  // One line: its first line's middle on the point, as the runner (not in boost mode) places it.
  const top = text.lineBreak ? reg.y - size.y / 2 + WRAPPED_TOP : reg.y - (text.fontSize + 2) / 2;
  // Canvas pixels per stage pixel: sharp through the object's own scale and a fine screen.
  const resolution = Math.min(8, Math.max(2, Math.ceil((window.devicePixelRatio || 1) * 2 * Math.max(1, scale) * 2) / 2));

  // PIXI keeps a margin round the letters' texture and draws it that far out.
  const padding = style._getFinalPadding();

  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext('2d');
    if (!element || !context) return;
    // The very canvas the runner's text is uploaded from.
    style.fill = text.color;
    const { canvasAndContext, frame } = CanvasTextGenerator.getCanvasAndContext({ text: text.content || ' ', style, resolution });
    element.width = frame.width;
    element.height = frame.height;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, element.width, element.height);
    context.drawImage(canvasAndContext.canvas as unknown as CanvasImageSource, frame.x, frame.y, frame.width, frame.height, 0, 0, frame.width, frame.height);
    CanvasTextGenerator.returnCanvasAndContext(canvasAndContext);
    // Underline and strike as `syncTextBox` draws them: over the measured box, not the margin.
    const thickness = Math.max(1, text.fontSize / 14);
    context.setTransform(resolution, 0, 0, resolution, padding * resolution, padding * resolution);
    context.fillStyle = text.color;
    if (text.underline) context.fillRect(0, height - thickness, width, thickness);
    if (text.strike) context.fillRect(0, height / 2 - thickness / 2, width, thickness);
  });
  void fonts;

  return (
    <canvas
      ref={canvas}
      class="po-text"
      style={{
        left: `${left - padding}px`,
        top: `${top - padding}px`,
        width: `${Math.ceil(Math.max(1, width) + padding * 2)}px`,
        height: `${Math.ceil(Math.max(1, height) + padding * 2)}px`,
      }}
    />
  );
}
