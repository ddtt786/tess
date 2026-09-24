/**
 * The stage before anything runs.
 *
 * Objects are drawn where they start, and the selected one carries a transform
 * box: corners and edges resize it, the arm above turns it, and the crosshair
 * moves the point x and y refer to.
 */
import { useEffect, useRef } from 'preact/hooks';
import { sceneObjects, selectObject, selectedObjectId, setObjectProps, setTextProps } from '../model/store.ts';
import { centerMode } from './state.ts';
import { resolveAsset } from '../model/assets.ts';
import { beginDrag } from './drag.ts';
import {
  STAGE, angleFromStage, centerFromStage, geometryOf, handleLocal, localToStage, resizeFromHandle,
  rotate, type HandleKind, type Point,
} from './stage-geometry.ts';
import type { TessObject } from '../model/types.ts';
import { PreviewMonitors } from './PreviewMonitors.tsx';

const HANDLES: HandleKind[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
/** How far above the top edge the rotation arm reaches, in screen pixels. */
const ARM = 26;

export function StagePreview() {
  const objects = sceneObjects.value;
  const host = useRef<HTMLDivElement>(null);
  const selected = objects.find((object) => object.id === selectedObjectId.value) ?? null;

  useEffect(() => {
    const element = host.current;
    if (!element) return undefined;
    const fit = () => element.style.setProperty('--stage-scale', String(element.clientWidth / STAGE.width || 1));
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  /** Pointer position in stage pixels. */
  function toStage(event: PointerEvent): Point {
    const frame = host.current?.getBoundingClientRect();
    if (!frame) return { x: 0, y: 0 };
    const scale = frame.width / STAGE.width;
    return { x: (event.clientX - frame.left) / scale, y: (event.clientY - frame.top) / scale };
  }

  return (
    <div class="preview" ref={host}>
      <div class="preview-sheet">
        {[...objects].reverse().map((object) => (
          <PreviewObject key={object.id} object={object} toStage={toStage} />
        ))}
        <PreviewMonitors />
      </div>
      {selected && <TransformBox object={selected} toStage={toStage} />}
    </div>
  );
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

  function drag(event: PointerEvent) {
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

  return (
    <div
      class={`po ${object.props.lock ? 'locked' : ''}`}
      style={{
        left: `${geometry.origin.x - geometry.reg.x}px`,
        top: `${geometry.origin.y - geometry.reg.y}px`,
        width: `${geometry.size.x}px`,
        height: `${geometry.size.y}px`,
        transformOrigin: `${geometry.reg.x}px ${geometry.reg.y}px`,
        transform: `rotate(${geometry.angle}deg) scale(${geometry.scale.x}, ${geometry.scale.y})`,
        opacity: object.props.visible ? 1 : 0.35,
      }}
      onPointerDown={drag}
      title={object.name}
    >
      {object.kind === 'text' && text ? (
        <span
          class="po-text"
          style={{
            color: text.color,
            background: text.bgColor ?? 'transparent',
            fontSize: `${text.fontSize}px`,
            // The runner's canvas falls back on sans-serif for a font it does not have.
            fontFamily: `"${text.font}", sans-serif`,
            fontWeight: text.bold ? 700 : 400,
            fontStyle: text.italic ? 'italic' : 'normal',
            textDecoration: [text.underline ? 'underline' : '', text.strike ? 'line-through' : ''].join(' ').trim(),
            textAlign: text.align,
            whiteSpace: text.lineBreak ? 'pre-wrap' : 'pre',
            overflowWrap: text.lineBreak ? 'anywhere' : 'normal',
            height: text.lineBreak ? '100%' : undefined,
            // The runner sets wrapped lines fontSize + 2 apart, from the top of the box.
            lineHeight: text.lineBreak ? `${text.fontSize + 2}px` : undefined,
            overflow: text.lineBreak ? 'hidden' : undefined,
          }}
        >
          {text.content}
        </span>
      ) : (
        costume && <img src={resolveAsset(costume.url)} alt="" draggable={false} />
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
