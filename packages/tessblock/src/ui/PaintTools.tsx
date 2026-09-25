/**
 * The paint chrome: tools, arrange actions and style fields.
 *
 * The painter package draws the canvas; everything around it is built here so
 * it matches the rest of the editor.
 */
import { beginDrag, dragGhost, SlideReorder, type DragGhost } from './drag.ts';
import { FONTS } from '../model/fonts.ts';
import { useSignal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { getPainter, painterVersion, fitStage } from './painter-host.ts';
import {
  BrushIcon, CircleIcon, CursorIcon, EraserIcon, FillIcon, FitIcon, FlipHIcon, FlipVIcon,
  FrontIcon, BackIcon, GroupIcon, LineIcon, NodeIcon, RectIcon, RedoIcon, TextIcon, TrashIcon,
  UndoIcon, UngroupIcon, ZoomInIcon, ZoomOutIcon, PlusIcon, EyeIcon, EyeOffIcon,
} from './icons.tsx';
import { InlineName } from './InlineName.tsx';

type ToolName = 'select' | 'reshape' | 'brush' | 'eraser' | 'fill' | 'text' | 'line' | 'ellipse' | 'rect';

const VECTOR_TOOLS: Array<[ToolName, string, typeof CursorIcon]> = [
  ['select', '선택', CursorIcon],
  ['reshape', '모양 다듬기', NodeIcon],
  ['brush', '붓', BrushIcon],
  ['eraser', '지우개', EraserIcon],
  ['fill', '채우기', FillIcon],
  ['text', '글자', TextIcon],
  ['line', '선', LineIcon],
  ['rect', '사각형', RectIcon],
  ['ellipse', '원', CircleIcon],
];

const BITMAP_TOOLS: Array<[ToolName, string, typeof CursorIcon]> = [
  ['select', '선택', CursorIcon],
  ['brush', '붓', BrushIcon],
  ['eraser', '지우개', EraserIcon],
  ['fill', '채우기', FillIcon],
  ['text', '글자', TextIcon],
  ['line', '선', LineIcon],
  ['rect', '사각형', RectIcon],
  ['ellipse', '원', CircleIcon],
];


/** Redraws this component whenever the painter reports anything. */
function usePainterState(): number {
  const tick = useSignal(0);
  const version = painterVersion.value;
  useEffect(() => {
    const painter = getPainter();
    if (!painter) return undefined;
    const bump = () => { tick.value += 1; };
    const offs = (['change', 'selectionchange', 'toolchange', 'stylechange', 'historychange', 'modechange', 'viewchange', 'layerchange'] as const)
      .map((type) => painter.on(type, bump));
    return () => offs.forEach((off) => off());
  }, [version]);
  return tick.value + version;
}

export function PaintTools() {
  usePainterState();
  const painter = getPainter();
  if (!painter) return <div class="paint-bar" />;

  const vector = painter.isVector;
  const tools = vector ? VECTOR_TOOLS : BITMAP_TOOLS;
  const style = painter.style;
  const brush = painter.brush;
  const text = painter.textStyle;

  return (
    <>
      <div class="paint-bar">
        <div class="seg">
          <button class={vector ? 'on' : ''} onClick={() => void painter.setMode('vector')}>벡터</button>
          <button class={vector ? '' : 'on'} onClick={() => void painter.setMode('bitmap')}>비트맵</button>
        </div>
        <span class="vr" />
        <button class="iconbtn" title="실행 취소" disabled={!painter.canUndo} onClick={() => painter.undo()}>
          <UndoIcon />
        </button>
        <button class="iconbtn" title="다시 실행" disabled={!painter.canRedo} onClick={() => painter.redo()}>
          <RedoIcon />
        </button>
        <span class="vr" />
        {vector && (
          <>
            <button class="iconbtn" title="그룹 만들기" onClick={() => painter.group()}><GroupIcon /></button>
            <button class="iconbtn" title="그룹 풀기" onClick={() => painter.ungroup()}><UngroupIcon /></button>
            <button class="iconbtn" title="맨 앞으로" onClick={() => painter.bringToFront()}><FrontIcon /></button>
            <button class="iconbtn" title="맨 뒤로" onClick={() => painter.sendToBack()}><BackIcon /></button>
            <span class="vr" />
          </>
        )}
        <button class="iconbtn" title="좌우 뒤집기" onClick={() => painter.flipHorizontal()}><FlipHIcon /></button>
        <button class="iconbtn" title="상하 뒤집기" onClick={() => painter.flipVertical()}><FlipVIcon /></button>
        <button class="iconbtn" title="선택한 것 지우기" onClick={() => painter.delete()}><TrashIcon /></button>

        <span class="spacer" />
        <button class="iconbtn" title="축소" onClick={() => painter.zoomOut()}><ZoomOutIcon /></button>
        <span class="zoom">{Math.round(painter.zoom * 100)}%</span>
        <button class="iconbtn" title="확대" onClick={() => painter.zoomIn()}><ZoomInIcon /></button>
        <button class="iconbtn" title="실행 화면에 맞추기" onClick={fitStage}><FitIcon /></button>
      </div>

      <div class="paint-rail">
        {tools.map(([name, label, Glyph]) => (
          <button
            key={name}
            class={`tool ${painter.tool === name ? 'on' : ''}`}
            title={label}
            aria-label={label}
            aria-pressed={painter.tool === name}
            onClick={() => painter.setTool(name)}
          >
            <Glyph size={18} />
          </button>
        ))}
      </div>

      <aside class="paint-side">
        <SideSettings />
        {vector && <LayerList />}
      </aside>
    </>
  );
}

/** What each tool draws with; the side shows only those settings. */
type Setting = 'fill' | 'stroke' | 'width' | 'dash' | 'brush' | 'font' | 'effects';

const TOOL_SETTINGS: Record<string, Setting[]> = {
  brush: ['fill', 'brush'],
  eraser: ['brush'],
  fill: ['fill'],
  text: ['fill', 'font'],
  line: ['stroke', 'width', 'dash'],
  rect: ['fill', 'stroke', 'width'],
  ellipse: ['fill', 'stroke', 'width'],
};

/** The settings the current tool (or, when selecting, the current selection) uses. */
function SideSettings() {
  const painter = getPainter()!;
  const vector = painter.vector;
  const style = painter.style;
  const brush = painter.brush;
  const text = painter.textStyle;
  const selecting = painter.tool === 'select' || painter.tool === 'reshape';
  const selection = vector?.selection ?? [];

  let settings: Setting[];
  if (selecting) {
    settings = vector && selection.length ? ['fill', 'stroke', 'width', 'effects'] : [];
    // A line's dash shows only while a line is picked.
    if (vector?.selectionHasLine) settings.push('dash');
    if (selection.some((node) => node.tagName.toLowerCase() === 'text')) settings.push('font');
  } else {
    settings = TOOL_SETTINGS[painter.tool] ?? [];
  }
  if (!settings.length) {
    return <p class="paint-hint">{selecting ? '도형을 고르면 색과 효과를 바꿀 수 있습니다.' : '이 도구는 설정이 없습니다.'}</p>;
  }
  const fillLabel = painter.tool === 'brush' ? '붓 색' : painter.tool === 'text' ? '글자 색' : '채우기';
  const gradient = settings.includes('effects') ? vector?.selectionGradient ?? null : null;

  return (
    <>
      {settings.includes('fill') && (
        <div class="f">
          <span>{fillLabel}</span>
          {settings.includes('effects') && (
            <div class="seg small">
              <button class={gradient ? '' : 'on'} onClick={() => vector?.setFillGradient(null)}>단색</button>
              <button
                class={gradient?.kind === 'linear' ? 'on' : ''}
                onClick={() => vector?.setFillGradient({ kind: 'linear', from: gradient?.from ?? style.fill ?? '#4f46e5', to: gradient?.to ?? '#ffffff', angle: gradient?.angle ?? 90 })}
              >
                선형
              </button>
              <button
                class={gradient?.kind === 'radial' ? 'on' : ''}
                onClick={() => vector?.setFillGradient({ kind: 'radial', from: gradient?.from ?? style.fill ?? '#4f46e5', to: gradient?.to ?? '#ffffff', angle: 0 })}
              >
                원형
              </button>
            </div>
          )}
          {gradient ? (
            <div class="colour-row">
              <input class="swatch" type="color" title="시작 색" value={gradient.from}
                onInput={(event) => vector?.setFillGradient({ ...gradient, from: (event.target as HTMLInputElement).value })} />
              <input class="swatch" type="color" title="끝 색" value={gradient.to}
                onInput={(event) => vector?.setFillGradient({ ...gradient, to: (event.target as HTMLInputElement).value })} />
            </div>
          ) : (
            <div class="colour-row">
              <input
                class="swatch"
                type="color"
                value={style.fill && style.fill.startsWith('#') ? style.fill : '#000000'}
                onInput={(event) => painter.setFill((event.target as HTMLInputElement).value)}
              />
              {painter.tool !== 'brush' && painter.tool !== 'text' && (
                <button
                  class={`style-btn ${style.fill === null ? 'on' : ''}`}
                  title="채우기 없음"
                  onClick={() => painter.setFill(style.fill === null ? '#4f46e5' : null)}
                >
                  없음
                </button>
              )}
            </div>
          )}
          {gradient?.kind === 'linear' && (
            <Slider label="방향" value={gradient.angle} min={0} max={360}
              onChange={(angle) => vector?.setFillGradient({ ...gradient, angle })} />
          )}
        </div>
      )}

      {settings.includes('stroke') && (
        <div class="f">
          <span>선</span>
          <div class="colour-row">
            <input
              class="swatch"
              type="color"
              value={style.stroke ?? '#000000'}
              onInput={(event) => painter.setStroke((event.target as HTMLInputElement).value)}
            />
            <button
              class={`style-btn ${style.stroke === null ? 'on' : ''}`}
              title="선 없음"
              onClick={() => painter.setStroke(style.stroke === null ? '#16181d' : null)}
            >
              없음
            </button>
          </div>
        </div>
      )}
      {settings.includes('width') && (
        <Slider label="선 굵기" value={style.strokeWidth} min={0} max={40} onChange={(value) => painter.setStrokeWidth(value)} />
      )}
      {settings.includes('dash') && vector && (
        <div class="f">
          <span>선 모양</span>
          <div class="seg small">
            {([['solid', '실선'], ['dashed', '점선'], ['dotted', '점']] as const).map(([dash, label]) => (
              <button
                class={(selecting ? vector.selectionDash : vector.lineDash) === dash ? 'on' : ''}
                onClick={() => vector.setDash(dash)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
      {settings.includes('effects') && vector && (
        <>
          <Slider label="투명도" value={Math.round((1 - vector.selectionOpacity) * 100)} min={0} max={100}
            onChange={(value) => vector.setOpacity(1 - value / 100)} />
        </>
      )}
      {settings.includes('brush') && (
        <Slider label={painter.tool === 'eraser' ? '지우개 크기' : '붓 크기'} value={brush.size} min={1} max={80}
          onChange={(value) => painter.setBrushOptions({ size: value })} />
      )}
      {settings.includes('font') && (
        <>
          <div class="f">
            <span>글꼴</span>
            <select
              class="select"
              value={text.fontFamily}
              onChange={(event) => painter.setTextStyle({ fontFamily: (event.target as HTMLSelectElement).value })}
            >
              {FONTS.map((font) => (
                <option key={font.family} value={font.family} style={{ fontFamily: font.family }}>{font.label}</option>
              ))}
            </select>
          </div>
          <Slider label="글자 크기" value={text.fontSize} min={8} max={160} onChange={(value) => painter.setTextStyle({ fontSize: value })} />
        </>
      )}
    </>
  );
}

/** The drawing's layers, top first: pick one to draw on, hide, rename, reorder. */
function LayerList() {
  const vector = getPainter()?.vector;
  if (!vector) return null;
  const layers = vector.layers;
  const count = layers.length;
  const active = layers.findIndex((layer) => layer.active);

  /** Press on a row: a click picks the layer; a drag moves it to where it is let go. */
  function pressRow(event: PointerEvent, index: number) {
    if (event.button !== 0 || (event.target as Element).closest('button, input')) return;
    const row = event.currentTarget as HTMLElement;
    const list = row.parentElement;
    let ghost: DragGhost | null = null;
    let slide: SlideReorder | null = null;
    let insertAt: number | null = null;
    // Rows run top first; layer indices run bottom first.
    const shownAt = count - 1 - index;
    beginDrag(event, {
      onMove(moved) {
        if (!slide) {
          slide = new SlideReorder([...(list?.children ?? [])] as HTMLElement[], row);
          ghost = dragGhost(row, event);
        }
        ghost!.follow(moved);
        const target = slide.targetAt(moved.clientY);
        slide.show(target);
        insertAt = target ? (target.before ? target.over : target.over + 1) : null;
      },
      onEnd(_up, moved) {
        ghost?.remove();
        slide?.clear();
        if (!moved) {
          vector!.selectLayer(index);
          return;
        }
        if (insertAt === null) return;
        const shownTo = insertAt > shownAt ? insertAt - 1 : insertAt;
        if (shownTo !== shownAt) vector!.moveLayerTo(index, count - 1 - shownTo);
      },
    });
  }
  return (
    <div class="f layers">
      <div class="layers-head">
        <span>레이어</span>
        <span class="spacer" />
        <button class="iconbtn plain" title="레이어 추가" aria-label="레이어 추가" onClick={() => vector.addLayer()}><PlusIcon size={14} /></button>
        <button class="iconbtn plain" title="위로" aria-label="위로" disabled={active >= count - 1} onClick={() => vector.moveLayer(active, 1)}>▲</button>
        <button class="iconbtn plain" title="아래로" aria-label="아래로" disabled={active <= 0} onClick={() => vector.moveLayer(active, -1)}>▼</button>
        <button class="iconbtn plain danger" title="레이어 지우기" aria-label="레이어 지우기" disabled={count < 2} onClick={() => vector.removeLayer(active)}><TrashIcon size={14} /></button>
      </div>
      <ul class="layer-list">
        {layers.map((layer, index) => ({ layer, index })).reverse().map(({ layer, index }) => (
          <li key={index} class={`layer-row ${layer.active ? 'on' : ''}`} onPointerDown={(event) => pressRow(event, index)}>
            <button
              class={`iconbtn plain ${layer.visible ? '' : 'off'}`}
              title={layer.visible ? '숨기기' : '보이기'}
              aria-label={layer.visible ? '숨기기' : '보이기'}
              onClick={(event) => { event.stopPropagation(); vector.setLayerVisible(index, !layer.visible); }}
            >
              {layer.visible ? <EyeIcon size={14} /> : <EyeOffIcon size={14} />}
            </button>
            <InlineName class="layer-name" value={layer.name} onCommit={(name) => vector.renameLayer(index, name)} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function Slider(
  { label, value, min, max, onChange }:
  { label: string; value: number; min: number; max: number; onChange: (value: number) => void },
) {
  return (
    <div class="f">
      <span>{label}</span>
      <div class="slider-row">
        <input
          class="paint-range"
          type="range"
          min={min}
          max={max}
          value={value}
          // How far along the track is filled.
          style={{ '--fill': `${((Math.min(max, Math.max(min, value)) - min) / (max - min || 1)) * 100}%` }}
          onInput={(event) => onChange(Number((event.target as HTMLInputElement).value))}
        />
        <input
          class="input tiny"
          type="number"
          min={min}
          max={max}
          value={Math.round(value)}
          onInput={(event) => onChange(Number((event.target as HTMLInputElement).value))}
        />
      </div>
    </div>
  );
}
