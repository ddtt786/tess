/**
 * The paint chrome: tools, arrange actions and style fields.
 *
 * The painter package draws the canvas; everything around it is built here so
 * it matches the rest of the editor.
 */
import { beginDrag, dragGhost, SlideReorder, type DragGhost } from './drag.ts';
import { fontChoices } from '../model/fonts.ts';
import { useSignal } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';
import { getPainter, painterVersion, fitStage, onionSkin, pickColour, toggleOnionSkin } from './painter-host.ts';
import {
  BrushIcon, CircleIcon, DropperIcon, OnionIcon, SwapIcon, CursorIcon, EraserIcon, FillIcon, FitIcon, FlipHIcon, FlipVIcon,
  FrontIcon, ForwardIcon, BackwardIcon, BackIcon, GroupIcon, LineIcon, NodeIcon, RectIcon, RedoIcon, TextIcon, TrashIcon,
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
            <button class="iconbtn" title="앞으로" onClick={() => painter.bringForward()}><ForwardIcon /></button>
            <button class="iconbtn" title="뒤로" onClick={() => painter.sendBackward()}><BackwardIcon /></button>
            <button class="iconbtn" title="맨 뒤로" onClick={() => painter.sendToBack()}><BackIcon /></button>
            <span class="vr" />
          </>
        )}
        <button class="iconbtn" title="좌우 뒤집기" onClick={() => painter.flipHorizontal()}><FlipHIcon /></button>
        <button class="iconbtn" title="상하 뒤집기" onClick={() => painter.flipVertical()}><FlipVIcon /></button>
        <button class="iconbtn" title="선택한 것 지우기" onClick={() => painter.delete()}><TrashIcon /></button>

        <span class="spacer" />
        <button
          class={`iconbtn ${onionSkin.value ? 'on' : ''}`}
          title={onionSkin.value ? '이전 모양 겹쳐 보기 끄기' : '이전 모양 겹쳐 보기 (어니언 스킨)'}
          aria-pressed={onionSkin.value}
          onClick={toggleOnionSkin}
        >
          <OnionIcon />
        </button>
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
  const brush = painter.brush;
  const text = painter.textStyle;
  const selecting = painter.tool === 'select' || painter.tool === 'reshape';
  const selection = vector?.selection ?? [];
  // With shapes picked, the colours shown are theirs; changing one changes them.
  const style = (selecting && vector?.selectionStyle) || painter.style;

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
            <>
              <ColourField label="시작" value={gradient.from} clearTo="transparent"
                onChange={(from) => vector?.setFillGradient({ ...gradient, from: from ?? '#00000000' })} />
              <ColourField label="끝" value={gradient.to} clearTo="transparent"
                onChange={(to) => vector?.setFillGradient({ ...gradient, to: to ?? '#00000000' })} />
            </>
          ) : (
            <ColourField
              value={style.fill}
              clearTo={painter.tool !== 'brush' && painter.tool !== 'text' ? 'none' : undefined}
              onChange={(colour) => painter.setFill(colour)}
            />
          )}
          {gradient?.kind === 'linear' && (
            <Slider label="방향" value={gradient.angle} min={0} max={360}
              onChange={(angle) => vector?.setFillGradient({ ...gradient, angle })} />
          )}
        </div>
      )}

      {settings.includes('fill') && settings.includes('stroke') && !gradient && (
        <button
          class="swap-colours"
          title="채우기 색과 선 색 바꾸기"
          onClick={() => {
            const { fill, stroke } = style;
            painter.setFill(stroke);
            painter.setStroke(fill);
          }}
        >
          <SwapIcon size={14} /> 색 바꾸기
        </button>
      )}

      {settings.includes('stroke') && (
        <div class="f">
          <span>선</span>
          <ColourField value={style.stroke} clearTo="none" onChange={(colour) => painter.setStroke(colour)} />
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
              {fontChoices(text.fontFamily).map((font) => (
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

/** `#rrggbb` and an opacity (0–1) from a colour; anything but hex reads as black. */
function splitAlpha(colour: string | null): { hex: string; alpha: number } {
  const value = (colour ?? '').trim().toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])([0-9a-f])?$/.exec(value);
  if (short) {
    const [, r, g, b, a] = short;
    return { hex: `#${r}${r}${g}${g}${b}${b}`, alpha: a ? parseInt(a + a, 16) / 255 : 1 };
  }
  const long = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(value);
  if (long) return { hex: `#${long[1]}`, alpha: long[2] ? parseInt(long[2], 16) / 255 : 1 };
  return { hex: '#000000', alpha: 1 };
}

/** A colour with its opacity; fully opaque stays plain `#rrggbb`. */
function joinAlpha(hex: string, alpha: number): string {
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255);
  return a === 255 ? hex : `${hex}${a.toString(16).padStart(2, '0')}`;
}

// --- colour field -----------------------------------------------------------

interface Hsva {
  h: number;
  s: number;
  v: number;
  a: number;
}

function toHsva(colour: string | null): Hsva {
  const { hex, alpha } = splitAlpha(colour);
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  return { h: (h * 60 + 360) % 360, s: max ? d / max : 0, v: max, a: alpha };
}

function hsvHex(h: number, s: number, v: number): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return Math.round((v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255).toString(16).padStart(2, '0');
  };
  return `#${f(5)}${f(3)}${f(1)}`;
}

/**
 * One colour setting: a swatch with its code, which opens an editor under it.
 * Each slider's track shows what it changes (hue, saturation, brightness,
 * opacity); the eyedropper and "none" sit with them.
 * `clearTo`: what "none" means here — no paint (`none`), or a see-through
 * colour (`transparent`, for a gradient's end); left out, there is no "none".
 */
function ColourField({ value, onChange, label, clearTo }: {
  value: string | null;
  onChange: (colour: string | null) => void;
  label?: string;
  clearTo?: 'none' | 'transparent';
}) {
  const open = useSignal(false);
  const box = useRef<HTMLDivElement>(null);
  // Kept while editing, so hue survives a trip through grey or black.
  const hsva = useSignal<Hsva>(toHsva(value));
  const shownHex = hsvHex(hsva.value.h, hsva.value.s, hsva.value.v);
  const current = joinAlpha(shownHex, hsva.value.a);
  const none = value === null || (clearTo === 'transparent' && splitAlpha(value).alpha === 0);

  // A colour set from elsewhere (another shape picked, the eyedropper) is shown as it is.
  useEffect(() => {
    if (value !== null && value.toLowerCase() !== current) hsva.value = toHsva(value);
  }, [value]);

  useEffect(() => {
    if (!open.value) return undefined;
    const away = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) open.value = false;
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') open.value = false;
    };
    window.addEventListener('pointerdown', away, true);
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('pointerdown', away, true);
      window.removeEventListener('keydown', key, true);
    };
  }, [open.value]);

  const set = (patch: Partial<Hsva>) => {
    const next = { ...hsva.value, ...patch };
    hsva.value = next;
    onChange(joinAlpha(hsvHex(next.h, next.s, next.v), next.a));
  };
  const { h, s: sat, v, a } = hsva.value;
  const opaque = hsvHex(h, sat, v);

  return (
    <div class={`colour-field ${open.value ? 'open' : ''}`} ref={box}>
      <button class="colour-chip" onClick={() => { open.value = !open.value; }} aria-expanded={open.value}>
        {label && <span class="colour-chip-label">{label}</span>}
        <span class={`colour-chip-swatch ${none ? 'none' : ''}`}>
          {!none && <span style={{ background: current }} />}
        </span>
        <span class="colour-chip-code">{none ? '없음' : a < 1 ? `${shownHex} · ${Math.round(a * 100)}%` : shownHex}</span>
      </button>
      {open.value && (
        <div class="colour-editor">
          <Channel label="색상" value={Math.round(h)} max={360} unit="°"
            track="linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)"
            onInput={(value) => set({ h: value })} />
          <Channel label="채도" value={Math.round(sat * 100)} max={100} unit="%"
            track={`linear-gradient(to right, ${hsvHex(h, 0, v)}, ${hsvHex(h, 1, v)})`}
            onInput={(value) => set({ s: value / 100 })} />
          <Channel label="밝기" value={Math.round(v * 100)} max={100} unit="%"
            track={`linear-gradient(to right, #000, ${hsvHex(h, sat, 1)})`}
            onInput={(value) => set({ v: value / 100 })} />
          <Channel label="불투명도" value={Math.round(a * 100)} max={100} unit="%" checker
            track={`linear-gradient(to right, transparent, ${opaque})`}
            onInput={(value) => set({ a: value / 100 })} />
          <div class="colour-editor-foot">
            <input
              class="input colour-hex"
              value={shownHex}
              aria-label="색 코드"
              maxLength={7}
              onChange={(event) => {
                const text = (event.target as HTMLInputElement).value.trim();
                const hex = text.startsWith('#') ? text : `#${text}`;
                if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex)) {
                  const read = toHsva(hex);
                  set({ h: read.s ? read.h : h, s: read.s, v: read.v });
                }
              }}
            />
            <Dropper onPick={(colour) => { const read = toHsva(colour); set({ ...read, a: 1 }); }} />
            {clearTo && (
              <button
                class={`style-btn ${none ? 'on' : ''}`}
                onClick={() => {
                  if (clearTo === 'none') onChange(none ? opaque : null);
                  else set({ a: none ? 1 : 0 });
                }}
              >
                없음
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** One labelled slider whose track shows the colours it runs through. */
function Channel({ label, value, max, unit, track, checker = false, onInput }: {
  label: string;
  value: number;
  max: number;
  unit: string;
  track: string;
  checker?: boolean;
  onInput: (value: number) => void;
}) {
  return (
    <label class="channel">
      <span class="channel-name">{label}</span>
      <input
        class={`channel-range ${checker ? 'checker' : ''}`}
        type="range"
        min={0}
        max={max}
        value={value}
        style={{ '--track': track }}
        onInput={(event) => onInput(Number((event.target as HTMLInputElement).value))}
      />
      <span class="channel-value">{value}{unit}</span>
    </label>
  );
}

/** Picks a colour off the screen (or the sheet) for one colour setting. */
function Dropper({ onPick, title = '스포이드' }: { onPick: (colour: string) => void; title?: string }) {
  const picking = useSignal(false);
  return (
    <button
      class={`style-btn dropper ${picking.value ? 'on' : ''}`}
      title={title}
      aria-label={title}
      onClick={async () => {
        if (picking.value) return;
        picking.value = true;
        // Listening starts at once: this press is over (a click comes last), and the next one is the pick's.
        try {
          const colour = await pickColour();
          if (colour) onPick(colour);
        } finally {
          picking.value = false;
        }
      }}
    >
      <DropperIcon size={15} />
    </button>
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
