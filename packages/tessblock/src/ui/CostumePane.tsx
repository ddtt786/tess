/**
 * 모양 tab. A sprite gets the painter; a text box gets its own settings, since
 * there is no costume to draw.
 */
import { useSignal } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';
import {
  addBlankCostume, addCostume, removeCostume, selectCostume, selectedObject,
  setTextProps, updateCostume,
} from '../model/store.ts';
import { COSTUME_LIBRARY } from '../model/defaults.ts';
import { readDataUrl } from '../model/files.ts';
import { flushPainter, measure, mountPainter, unmountPainter } from './painter-host.ts';
import { InlineName } from './InlineName.tsx';
import { PaintTools } from './PaintTools.tsx';
import { PlusIcon, TrashIcon, UploadIcon } from './icons.tsx';
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
      const id = addBlankCostume(object.id, size.width, size.height);
      updateCostume(object.id, id, {
        name: file.name.replace(/\.[^.]+$/, '') || '모양',
        url,
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
              <img src={costume.url} alt="" />
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

const FONTS = ['나눔고딕', '나눔명조', '나눔손글씨', '바탕체', '고딕체', '궁서체', 'DungGeunMo'];

function TextBoxPane({ object }: { object: TessObject }) {
  const text = object.text;
  if (!text) return <div class="sheet"><p class="sub">글상자 정보가 없습니다.</p></div>;

  const set = (patch: Partial<TextProps>) => setTextProps(object.id, patch);

  return (
    <div class="sheet">
      <div class="sheet-head">
        <div>
          <h3>글상자</h3>
          <p class="sub">글상자는 모양 대신 글자 그 자체를 꾸밉니다.</p>
        </div>
      </div>

      <div class="text-editor">
        <div class="f">
          <label>내용</label>
          <textarea
            value={text.content}
            onInput={(event) => set({ content: (event.target as HTMLTextAreaElement).value })}
          />
        </div>

        <div class="text-grid">
          <div class="f">
            <label>글꼴</label>
            <select class="select" value={text.font} onChange={(event) => set({ font: (event.target as HTMLSelectElement).value })}>
              {FONTS.map((font) => <option key={font} value={font}>{font}</option>)}
            </select>
          </div>
          <div class="f">
            <label>글자 크기</label>
            <input
              class="input"
              type="number"
              value={text.fontSize}
              onInput={(event) => set({ fontSize: Number((event.target as HTMLInputElement).value) || 20 })}
            />
          </div>
          <div class="f">
            <label>정렬</label>
            <select
              class="select"
              value={text.align}
              onChange={(event) => set({ align: (event.target as HTMLSelectElement).value as TextAlign })}
            >
              <option value="left">왼쪽</option>
              <option value="center">가운데</option>
              <option value="right">오른쪽</option>
            </select>
          </div>
          <div class="f">
            <label>글자 색</label>
            <input
              class="swatch"
              type="color"
              value={text.color}
              onInput={(event) => set({ color: (event.target as HTMLInputElement).value })}
            />
          </div>
          <div class="f">
            <label>배경색</label>
            <input
              class="swatch"
              type="color"
              value={text.bgColor ?? '#ffffff'}
              onInput={(event) => set({ bgColor: (event.target as HTMLInputElement).value })}
            />
          </div>
          <div class="f">
            <label>배경 없애기</label>
            <button class={`style-btn ${text.bgColor === null ? 'on' : ''}`} onClick={() => set({ bgColor: text.bgColor === null ? '#ffffff' : null })}>
              {text.bgColor === null ? '투명' : '투명으로'}
            </button>
          </div>
        </div>

        <div class="f">
          <label>줄바꿈</label>
          <div class="seg">
            <button class={text.lineBreak ? '' : 'on'} onClick={() => set({ lineBreak: false })}>한 줄로 쓰기</button>
            <button class={text.lineBreak ? 'on' : ''} onClick={() => set({ lineBreak: true })}>여러 줄로 쓰기</button>
          </div>
        </div>

        <div class="f">
          <label>꾸미기</label>
          <div class="style-row">
            <button class={`style-btn ${text.bold ? 'on' : ''}`} title="굵게" onClick={() => set({ bold: !text.bold })} style="font-weight:800">가</button>
            <button class={`style-btn ${text.italic ? 'on' : ''}`} title="기울임" onClick={() => set({ italic: !text.italic })} style="font-style:italic">가</button>
            <button class={`style-btn ${text.underline ? 'on' : ''}`} title="밑줄" onClick={() => set({ underline: !text.underline })} style="text-decoration:underline">가</button>
            <button class={`style-btn ${text.strike ? 'on' : ''}`} title="취소선" onClick={() => set({ strike: !text.strike })} style="text-decoration:line-through">가</button>
          </div>
        </div>

        <div class="f">
          <label>미리 보기</label>
          <div class="text-preview" style={{ background: text.bgColor ?? 'transparent' }}>
            <span
              style={{
                color: text.color,
                fontSize: `${text.fontSize}px`,
                fontFamily: text.font,
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
        </div>
      </div>
    </div>
  );
}
