/**
 * The paint chrome: tools, arrange actions and style fields.
 *
 * The painter package draws the canvas; everything around it is built here so
 * it matches the rest of the editor.
 */
import { useSignal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { getPainter, painterVersion } from './painter-host.ts';
import {
  BrushIcon, CircleIcon, CursorIcon, EraserIcon, FillIcon, FitIcon, FlipHIcon, FlipVIcon,
  FrontIcon, BackIcon, GroupIcon, LineIcon, NodeIcon, RectIcon, RedoIcon, TextIcon, TrashIcon,
  UndoIcon, UngroupIcon, ZoomInIcon, ZoomOutIcon,
} from './icons.tsx';

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

const FONTS = ['나눔고딕', 'Pretendard', '나눔명조', 'DungGeunMo', 'Helvetica, Arial, sans-serif'];

/** Redraws this component whenever the painter reports anything. */
function usePainterState(): number {
  const tick = useSignal(0);
  const version = painterVersion.value;
  useEffect(() => {
    const painter = getPainter();
    if (!painter) return undefined;
    const bump = () => { tick.value += 1; };
    const offs = (['change', 'selectionchange', 'toolchange', 'stylechange', 'historychange', 'modechange', 'viewchange'] as const)
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
        <button class="iconbtn" title="화면에 맞추기" onClick={() => painter.zoomToFit()}><FitIcon /></button>
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
        <div class="f">
          <span>채우기</span>
          <div class="colour-row">
            <input
              class="swatch"
              type="color"
              value={style.fill ?? '#000000'}
              onInput={(event) => painter.setFill((event.target as HTMLInputElement).value)}
            />
            <button
              class={`style-btn ${style.fill === null ? 'on' : ''}`}
              title="채우기 없음"
              onClick={() => painter.setFill(style.fill === null ? '#4f46e5' : null)}
            >
              없음
            </button>
          </div>
        </div>

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

        <Slider
          label="선 굵기"
          value={style.strokeWidth}
          min={0}
          max={40}
          onChange={(value) => painter.setStrokeWidth(value)}
        />
        <Slider
          label="붓 크기"
          value={brush.size}
          min={1}
          max={80}
          onChange={(value) => painter.setBrushOptions({ size: value })}
        />

        <div class="f">
          <span>글꼴</span>
          <select
            class="select"
            value={text.fontFamily}
            onChange={(event) => painter.setTextStyle({ fontFamily: (event.target as HTMLSelectElement).value })}
          >
            {FONTS.map((font) => <option key={font} value={font}>{font.split(',')[0]}</option>)}
          </select>
        </div>
        <Slider
          label="글자 크기"
          value={text.fontSize}
          min={8}
          max={160}
          onChange={(value) => painter.setTextStyle({ fontSize: value })}
        />
      </aside>
    </>
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
          type="range"
          min={min}
          max={max}
          value={value}
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
