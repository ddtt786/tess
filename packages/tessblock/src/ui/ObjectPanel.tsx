/**
 * Object list.
 *
 * Rows are one line each. The selected object's values sit at the top of the
 * same list, held there by a divider — not in a card of its own, so nothing
 * suggests a second card could appear next to it.
 */
import { useSignal } from '@preact/signals';
import type { ComponentChildren } from 'preact';
import { resolveAsset } from '../model/assets.ts';
import { beginDrag } from './drag.ts';
import { InlineName } from './InlineName.tsx';
import { editorTab } from './state.ts';
import {
  addObject, addObjectFolder, duplicateObject, fileObject, removeObject, removeObjectFolder, renameObject,
  renameObjectFolder, reorderObject, sceneObjects, selectObject, selectedObject, selectedObjectId,
  selectedSceneId, setObjectProps, setTextProps,
} from '../model/store.ts';
import type { RotateMethod, TessObject } from '../model/types.ts';
import {
  CopyIcon, EyeIcon, EyeOffIcon, FolderIcon, GripIcon, LockIcon, PlusIcon, TextIcon, TrashIcon, UnlockIcon,
} from './icons.tsx';

/** Folders folded shut, by scene and name; kept across scene switches. */
const collapsedFolders = new Set<string>();

export function ObjectPanel() {
  const objects = sceneObjects.value;
  const selected = selectedObject.value;
  const drag = useSignal<{ id: string; overId: string; before: boolean; folder?: string } | null>(null);
  const folds = useSignal(0);
  const scene = selectedSceneId.value;
  const foldKey = (folder: string) => `${scene}\u0000${folder}`;

  function toggleFolder(folder: string) {
    if (collapsedFolders.has(foldKey(folder))) collapsedFolders.delete(foldKey(folder));
    else collapsedFolders.add(foldKey(folder));
    folds.value += 1;
  }

  /** Row under the pointer, and which half of it; a folder header files the object into it. */
  function rowAt(clientY: number): { id: string; before: boolean; folder?: string } | null {
    for (const head of document.querySelectorAll<HTMLElement>('.obj-folder[data-folder]')) {
      const rect = head.getBoundingClientRect();
      if (clientY >= rect.top && clientY <= rect.bottom) return { id: '', before: true, folder: head.dataset.folder };
    }
    const rows = [...document.querySelectorAll<HTMLElement>('.obj[data-id]')];
    for (const row of rows) {
      const rect = row.getBoundingClientRect();
      if (clientY >= rect.top && clientY <= rect.bottom) {
        return { id: row.dataset.id ?? '', before: clientY < rect.top + rect.height / 2 };
      }
    }
    const first = rows[0]?.getBoundingClientRect();
    const last = rows[rows.length - 1]?.getBoundingClientRect();
    if (first && clientY < first.top) return { id: rows[0]!.dataset.id ?? '', before: true };
    if (last && clientY > last.bottom) return { id: rows[rows.length - 1]!.dataset.id ?? '', before: false };
    return null;
  }

  function startRowDrag(event: PointerEvent, id: string) {
    if (event.button !== 0) return;
    beginDrag(event, {
      slop: 4,
      onMove(moved) {
        const target = rowAt(moved.clientY);
        drag.value = { id, overId: target?.id ?? '', before: target?.before ?? true, folder: target?.folder };
      },
      onEnd(_event, moved) {
        const state = drag.value;
        if (moved && state?.folder !== undefined) fileObject(state.id, state.folder);
        else if (moved && state?.overId && state.overId !== id) reorderObject(state.id, state.overId, state.before);
        drag.value = null;
      },
    });
  }

  return (
    <section class="objects" aria-label="오브젝트 목록">
      <div class="section-head">
        <h2>오브젝트</h2>
        <span class="count">{objects.length}</span>
        <span class="spacer" />
        <button
          class="iconbtn"
          title="새 그림 오브젝트 추가 (그림판이 열립니다)"
          aria-label="오브젝트 추가"
          onClick={() => {
            addObject('sprite');
            // A new drawing goes straight to the painter.
            editorTab.value = 'costumes';
          }}
        >
          <PlusIcon />
        </button>
        <button class="iconbtn" title="글상자 추가" aria-label="글상자 추가" onClick={() => addObject('text')}>
          <TextIcon />
        </button>
        <button
          class="iconbtn"
          title="선택한 오브젝트를 새 폴더에 넣기"
          aria-label="오브젝트 폴더 만들기"
          disabled={!selected}
          onClick={() => { if (selected) addObjectFolder(selected.id); }}
        >
          <FolderIcon />
        </button>
      </div>

      <div class="obj-list">
        {selected ? <ObjectDetail object={selected} /> : <p class="hint">오브젝트를 추가해 시작하세요.</p>}

        {objects.map((object, index) => {
          void folds.value;
          const folder = object.folder ?? null;
          const opensFolder = folder !== null && objects[index - 1]?.folder !== folder;
          const closed = folder !== null && collapsedFolders.has(foldKey(folder));
          let head: ComponentChildren = null;
          if (opensFolder) {
            head = (
              <div
                key={`folder:${folder}`}
                data-folder={folder}
                class={[
                  'obj-folder',
                  closed ? 'closed' : '',
                  drag.value?.folder === folder ? 'drop-into' : '',
                ].join(' ')}
                role="button"
                tabIndex={0}
                title="눌러서 접기·펴기, 두 번 눌러 이름 바꾸기"
                onClick={() => toggleFolder(folder)}
              >
                <span class="caret" aria-hidden="true">{closed ? '▸' : '▾'}</span>
                <FolderIcon size={14} />
                <InlineName value={folder} onCommit={(name) => renameObjectFolder(scene, folder, name)} />
                <span class="count">{objects.filter((each) => each.folder === folder).length}</span>
                <button
                  class="del"
                  title="폴더 풀기 (오브젝트는 그대로)"
                  aria-label={`${folder} 폴더 풀기`}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    removeObjectFolder(scene, folder);
                  }}
                >
                  ✕
                </button>
              </div>
            );
          }
          // A folded folder still shows the object being edited.
          if (closed && object.id !== selectedObjectId.value) return head;
          const isSelected = object.id === selectedObjectId.value;
          const drop = drag.value?.overId === object.id ? drag.value : null;
          const costume = object.costumes.find((candidate) => candidate.id === object.selectedCostumeId)
            ?? object.costumes[0];
          return [head, (
            <div
              key={object.id}
              data-id={object.id}
              class={[
                'obj',
                folder !== null ? 'in-folder' : '',
                isSelected ? 'on' : '',
                drag.value?.id === object.id ? 'dragging' : '',
                drop ? (drop.before ? 'drop-before' : 'drop-after') : '',
              ].join(' ')}
              role="button"
              tabIndex={0}
              aria-pressed={isSelected}
              onPointerDown={(event) => startRowDrag(event, object.id)}
              onClick={() => selectObject(object.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  selectObject(object.id);
                }
              }}
            >
              <span class="grip" aria-hidden="true"><GripIcon size={14} /></span>
              <span class="avatar row-avatar" aria-hidden="true">
                {object.kind === 'text' ? (
                  <TextIcon size={13} />
                ) : costume ? (
                  <img src={resolveAsset(costume.url)} alt="" />
                ) : (
                  'T'
                )}
              </span>
              <span class="name">{object.name}</span>
              {object.kind === 'text' && <span class="tag">글</span>}
              {!object.props.visible && <span class="tag">숨김</span>}
              <div class="actions">
                <button
                  class="del"
                  title={`${object.name} 복제`}
                  aria-label={`${object.name} 복제`}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    duplicateObject(object.id);
                  }}
                >
                  <CopyIcon size={14} />
                </button>
                <button
                  class="del"
                  title={`${object.name} 삭제`}
                  aria-label={`${object.name} 삭제`}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    removeObject(object.id);
                  }}
                >
                  <TrashIcon size={14} />
                </button>
              </div>
            </div>
          )];
        })}
      </div>
    </section>
  );
}

function ObjectDetail({ object }: { object: TessObject }) {
  const costume = object.costumes.find((candidate) => candidate.id === object.selectedCostumeId)
    ?? object.costumes[0];
  const props = object.props;
  const size = Math.round((props.scaleX + props.scaleY) / 2);

  function setNumber(key: 'x' | 'y' | 'angle' | 'way' | 'scaleX' | 'scaleY', value: string) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) setObjectProps(object.id, { [key]: parsed });
  }

  /** The size field scales both axes and keeps whatever stretch is set. */
  function setSize(value: string) {
    const next = Number(value);
    if (!Number.isFinite(next) || next <= 0) return;
    const ratio = next / (size || 100);
    setObjectProps(object.id, {
      scaleX: Math.round(props.scaleX * ratio * 10) / 10,
      scaleY: Math.round(props.scaleY * ratio * 10) / 10,
    });
  }

  return (
    <div class="obj-detail">
      <div class="detail-head">
        <span class="avatar" aria-hidden="true">
          {object.kind === 'text' ? (
            <TextIcon size={16} />
          ) : costume ? (
            <img src={resolveAsset(costume.url)} alt="" />
          ) : (
            'T'
          )}
        </span>
        <input
          class="input title"
          value={object.name}
          aria-label="오브젝트 이름"
          onInput={(event) => renameObject(object.id, (event.target as HTMLInputElement).value)}
        />
        <button
          class={`iconbtn plain ${props.visible ? 'on' : ''}`}
          title={props.visible ? '무대에서 숨기기' : '무대에 보이기'}
          aria-label={props.visible ? '무대에서 숨기기' : '무대에 보이기'}
          aria-pressed={props.visible}
          onClick={() => setObjectProps(object.id, { visible: !props.visible })}
        >
          {props.visible ? <EyeIcon /> : <EyeOffIcon />}
        </button>
        <button
          class={`iconbtn plain ${props.lock ? 'on' : ''}`}
          title={props.lock ? '잠금 풀기' : '잠그기'}
          aria-label={props.lock ? '잠금 풀기' : '잠그기'}
          aria-pressed={props.lock}
          onClick={() => setObjectProps(object.id, { lock: !props.lock })}
        >
          {props.lock ? <LockIcon /> : <UnlockIcon />}
        </button>
      </div>

      {object.kind === 'text' && object.text && (
        <div class="text-content-field">
          <input
            class="input text-content-input"
            value={object.text.content}
            placeholder="글상자 내용 입력"
            aria-label="글상자 내용"
            onInput={(event) =>
              setTextProps(object.id, { content: (event.target as HTMLInputElement).value })}
          />
        </div>
      )}

      <div class="detail-grid">
        <Field label="X" value={props.x} onChange={(value) => setNumber('x', value)} />
        <Field label="Y" value={props.y} onChange={(value) => setNumber('y', value)} />
        <Field label="크기" value={size} onChange={setSize} />
        <Field label="가로" value={round(props.scaleX)} onChange={(value) => setNumber('scaleX', value)} />
        <Field label="세로" value={round(props.scaleY)} onChange={(value) => setNumber('scaleY', value)} />
        <Field label="방향" value={props.angle} onChange={(value) => setNumber('angle', value)} />
        <Field label="이동 방향" value={props.way} wide onChange={(value) => setNumber('way', value)} />
        <label class="f wide">
          <span>회전</span>
          <select
            class="select"
            value={props.rotation}
            onChange={(event) =>
              setObjectProps(object.id, { rotation: (event.target as HTMLSelectElement).value as RotateMethod })}
          >
            <option value="free">자유</option>
            <option value="vertical">좌우</option>
            <option value="none">없음</option>
          </select>
        </label>
      </div>
    </div>
  );
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function Field(
  { label, value, wide, onChange }:
  { label: string; value: number; wide?: boolean; onChange: (value: string) => void },
) {
  return (
    <label class={`f ${wide ? 'wide' : ''}`}>
      <span>{label}</span>
      <input
        class="input"
        type="number"
        value={value}
        onInput={(event) => onChange((event.target as HTMLInputElement).value)}
      />
    </label>
  );
}
