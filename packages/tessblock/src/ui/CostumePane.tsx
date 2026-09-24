/**
 * 모양 tab. A sprite gets the painter; a text box gets its own settings, since
 * there is no costume to draw.
 */
import { FONTS, fontFamily } from '../model/fonts.ts';
import { useSignal } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';
import {
  addBlankCostume, addCostume, removeCostume, selectCostume, selectedObject,
  setTextProps, updateCostume,
} from '../model/store.ts';
import { COSTUME_LIBRARY } from '../model/defaults.ts';
import { resolveAsset, saveAsset } from '../model/assets.ts';
import { readDataUrl } from '../model/files.ts';
import { flushPainter, measure, mountPainter, unmountPainter } from './painter-host.ts';
import { InlineName } from './InlineName.tsx';
import { PaintTools } from './PaintTools.tsx';
import { AlignCenterIcon, AlignLeftIcon, AlignRightIcon, PlusIcon, TrashIcon, UploadIcon, WrapIcon } from './icons.tsx';
import { notify } from './state.ts';
import type { TessObject, TextAlign, TextProps } from '../model/types.ts';

export function CostumePane() {
  const object = selectedObject.value;
  if (!object) return <div class="sheet"><p class="sub">오브젝트를 먼저 선택하세요.</p></div>;
  return object.kind === 'text'
    ? <TextBoxPane object={object} />
    : <PainterPane key="painter" />;
}

function PainterPane() {
  const host = useRef<HTMLDivElement>(null);
  const upload = useRef<HTMLInputElement>(null);
  const library = useSignal(false);
  const object = selectedObject.value;

  useEffect(() => {
    if (!host.current) return undefined;
    mountPainter(host.current);
    return () => unmountPainter();
  }, []);

  async function addFiles(files: FileList | null) {
    if (!object || !files?.length) return;
    for (const file of Array.from(files)) {
      const url = await readDataUrl(file);
      const size = await measure(url);
      const reference = await saveAsset(url);
      const id = addBlankCostume(object.id, size.width, size.height);
      updateCostume(object.id, id, {
        name: file.name.replace(/\.[^.]+$/, '') || '모양',
        url: reference,
        ...size,
      });
    }
    notify('모양을 불러왔습니다.');
  }

  if (!object) return <div class="sheet"><p class="sub">오브젝트를 먼저 선택하세요.</p></div>;

  return (
    <div class="costume-pane">
      <div class="costume-bar">
        <div class="costume-strip">
          {object.costumes.map((costume) => (
            <button
              key={costume.id}
              class={`shot ${costume.id === object.selectedCostumeId ? 'on' : ''}`}
              onClick={() => {
                flushPainter();
                selectCostume(object.id, costume.id);
              }}
            >
              <img src={resolveAsset(costume.url)} alt="" />
              <InlineName
                class="shot-name"
                value={costume.name}
                onCommit={(name) => updateCostume(object.id, costume.id, { name })}
              />
              {object.costumes.length > 1 && (
                <span
                  class="shot-del"
                  title="모양 삭제"
                  onClick={(event) => {
                    event.stopPropagation();
                    flushPainter();
                    removeCostume(object.id, costume.id);
                  }}
                >
                  <TrashIcon size={13} />
                </span>
              )}
            </button>
          ))}

          <button
            class="shot add"
            title="빈 모양 추가"
            onClick={() => {
              flushPainter();
              addBlankCostume(object.id);
            }}
          >
            <PlusIcon />
            <span class="shot-name">새 모양</span>
          </button>
          <button class="shot add" title="파일 올리기" onClick={() => upload.current?.click()}>
            <UploadIcon />
            <span class="shot-name">올리기</span>
          </button>
          <button class="shot add" onClick={() => { library.value = !library.value; }}>
            <span class="shot-name">기본 모양</span>
          </button>
          <input
            ref={upload}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(event) => {
              void addFiles((event.target as HTMLInputElement).files);
              (event.target as HTMLInputElement).value = '';
            }}
          />
        </div>

        {library.value && (
          <div class="costume-library">
            {COSTUME_LIBRARY.map((template, index) => (
              <button
                key={template.name}
                class="shot"
                onClick={() => {
                  flushPainter();
                  addCostume(object.id, index);
                  library.value = false;
                }}
              >
                <img src={template.url} alt="" />
                <span class="shot-name">{template.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div class="paint-area">
        <PaintTools />
        <div class="painter-host" ref={host} />
      </div>
    </div>
  );
}


function TextBoxPane({ object }: { object: TessObject }) {
  const text = object.text;
  if (!text) return <div class="sheet"><p class="sub">글상자 정보가 없습니다.</p></div>;

  const set = (patch: Partial<TextProps>) => setTextProps(object.id, patch);
  const aligns: Array<[TextAlign, string, typeof AlignLeftIcon]> = [
    ['left', '왼쪽 정렬', AlignLeftIcon],
    ['center', '가운데 정렬', AlignCenterIcon],
    ['right', '오른쪽 정렬', AlignRightIcon],
  ];
  const decorations: Array<[keyof Pick<TextProps, 'bold' | 'italic' | 'underline' | 'strike'>, string, string]> = [
    ['bold', '굵게', 'font-weight:800'],
    ['italic', '기울임', 'font-style:italic'],
    ['underline', '밑줄', 'text-decoration:underline'],
    ['strike', '취소선', 'text-decoration:line-through'],
  ];

  return (
    <div class="sheet">
      <div class="text-card">
        <div class="text-preview" style={{ background: text.bgColor ?? 'transparent' }}>
          <span
            style={{
              color: text.color,
              fontSize: `${text.fontSize}px`,
              fontFamily: fontFamily(text.font),
              fontWeight: text.bold ? 800 : 400,
              fontStyle: text.italic ? 'italic' : 'normal',
              textDecoration: [text.underline ? 'underline' : '', text.strike ? 'line-through' : ''].join(' ').trim(),
              textAlign: text.align,
              whiteSpace: text.lineBreak ? 'pre-wrap' : 'pre',
            }}
          >
            {text.content || '글상자'}
          </span>
        </div>


        <div class="text-bar">
          <select
            class="select text-font"
            aria-label="글꼴"
            value={fontFamily(text.font)}
            onChange={(event) => set({ font: (event.target as HTMLSelectElement).value })}
          >
            {FONTS.map((font) => (
              <option key={font.family} value={font.family} style={{ fontFamily: font.family }}>{font.label}</option>
            ))}
          </select>
          <input
            class="input text-size"
            type="number"
            title="글자 크기"
            aria-label="글자 크기"
            value={text.fontSize}
            onInput={(event) => set({ fontSize: Number((event.target as HTMLInputElement).value) || 20 })}
          />
          <div class="seg icons">
            {aligns.map(([align, label, Glyph]) => (
              <button class={text.align === align ? 'on' : ''} title={label} aria-label={label} onClick={() => set({ align })}>
                <Glyph size={14} />
              </button>
            ))}
          </div>
          <div class="seg icons">
            {decorations.map(([key, label, look]) => (
              <button class={text[key] ? 'on' : ''} title={label} aria-label={label} style={look} onClick={() => set({ [key]: !text[key] })}>
                가
              </button>
            ))}
          </div>
          <button
            class={`chip-toggle ${text.lineBreak ? 'on' : ''}`}
            title={text.lineBreak ? '여러 줄로 쓰기 (누르면 한 줄)' : '한 줄로 쓰기 (누르면 여러 줄)'}
            aria-pressed={text.lineBreak}
            onClick={() => set({ lineBreak: !text.lineBreak })}
          >
            <WrapIcon size={14} />
          </button>
          <ColourChip label="글자 색" value={text.color} onPick={(color) => set({ color })} />
          <ColourChip
            label="배경색"
            value={text.bgColor}
            onPick={(bgColor) => set({ bgColor })}
            onClear={() => set({ bgColor: null })}
          />
        </div>

        <textarea
          class="text-content"
          rows={2}
          placeholder="글상자에 쓸 내용"
          aria-label="내용"
          value={text.content}
          onInput={(event) => set({ content: (event.target as HTMLTextAreaElement).value })}
        />
      </div>
    </div>
  );
}

/** A round colour chip; a clearable one shows a slashed chip while it has no colour. */
function ColourChip(
  { label, value, onPick, onClear }:
  { label: string; value: string | null; onPick: (colour: string) => void; onClear?: () => void },
) {
  return (
    <span class="chip-colour-wrap">
      <label class={`chip-colour ${value === null ? 'none' : ''}`} title={label} style={{ background: value ?? undefined }}>
        <input
          type="color"
          aria-label={label}
          value={value ?? '#ffffff'}
          onInput={(event) => onPick((event.target as HTMLInputElement).value)}
        />
      </label>
      {onClear && value !== null && (
        <button class="chip-clear" title={`${label} 없애기`} aria-label={`${label} 없애기`} onClick={onClear}>×</button>
      )}
    </span>
  );
}
