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
import { SlideReorder, beginDrag, dragGhost, type DragGhost } from './drag.ts';
import { InlineName } from './InlineName.tsx';
import { editorTab } from './state.ts';
import {
  addObject, addObjectFolder, duplicateObject, fileObject, removeObject, removeObjectFolder, renameObject,
  renameObjectFolder, reorderObject, sceneObjects, selectObject, selectedObject, selectedObjectId,
  selectedSceneId, setObjectProps,
} from '../model/store.ts';
import type { RotateMethod, TessObject } from '../model/types.ts';
import {
  CopyIcon, EyeIcon, EyeOffIcon, FolderIcon, GripIcon, LockIcon, PlusIcon, RotateFlipIcon, RotateFreeIcon,
  RotateNoneIcon, TextIcon, TrashIcon, UnlockIcon,
} from './icons.tsx';

/** Rotation methods in the order the header button steps through them. */
const ROTATIONS: Array<{ method: RotateMethod; label: string; icon: typeof RotateFreeIcon }> = [
  { method: 'free', label: '자유', icon: RotateFreeIcon },
  { method: 'vertical', label: '좌우', icon: RotateFlipIcon },
  { method: 'none', label: '없음', icon: RotateNoneIcon },
];

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

  function startRowDrag(event: PointerEvent, id: string) {
    if (event.button !== 0) return;
    const row = event.currentTarget as HTMLElement;
    let ghost: DragGhost | null = null;
    let slide: SlideReorder | null = null;
    let items: HTMLElement[] = [];
    beginDrag(event, {
      slop: 4,
      onMove(moved) {
        if (!slide) {
          items = [...document.querySelectorAll<HTMLElement>('.obj-list > .obj[data-id], .obj-list > .obj-folder[data-folder]')];
          slide = new SlideReorder(items, row);
          ghost = dragGhost(row, event);
        }
        ghost!.follow(moved);
        const target = slide.targetAt(moved.clientY);
        const over = target ? items[target.over] : undefined;
        // Over a folder header: the object goes into that folder.
        if (over?.dataset.folder !== undefined) {
          slide.show(null);
          drag.value = { id, overId: '', before: true, folder: over.dataset.folder };
          return;
        }
        slide.show(target);
        drag.value = { id, overId: over?.dataset.id ?? '', before: target?.before ?? true };
      },
      onEnd(_event, moved) {
        ghost?.remove();
        slide?.clear();
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
        <RotationButton object={object} />
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

      <div class="detail-body">
      <div class="detail-grid">
        <Field label="X" value={props.x} inset onChange={(value) => setNumber('x', value)} />
        <Field label="Y" value={props.y} inset onChange={(value) => setNumber('y', value)} />
        <Field label="크기" value={size} onChange={setSize} />
        <Field label="가로" value={round(props.scaleX)} onChange={(value) => setNumber('scaleX', value)} />
        <Field label="세로" value={round(props.scaleY)} onChange={(value) => setNumber('scaleY', value)} />
        <Field label="방향" value={props.angle} onChange={(value) => setNumber('angle', value)} />
      </div>
      <DirectionDial value={props.way} onChange={(value) => setNumber('way', String(value))} />
      </div>
    </div>
  );
}

/** Steps the object through free, left-right and no rotation. */
function RotationButton({ object }: { object: TessObject }) {
  const at = Math.max(0, ROTATIONS.findIndex((each) => each.method === object.props.rotation));
  const current = ROTATIONS[at]!;
  const next = ROTATIONS[(at + 1) % ROTATIONS.length]!;
  const Glyph = current.icon;
  return (
    <button
      class="rot-toggle"
      title={`회전 방식: ${current.label} (누르면 ${next.label})`}
      aria-label={`회전 방식 ${current.label}`}
      onClick={() => setObjectProps(object.id, { rotation: next.method })}
    >
      <Glyph size={14} />
      <span>{current.label}</span>
    </button>
  );
}

/** Moving direction as a gauge: 0 points up, 90 right. Drag the needle or type the number. */
function DirectionDial({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const turn = ((value % 360) + 360) % 360;

  function pick(event: PointerEvent) {
    const face = (event.currentTarget as SVGSVGElement).getBoundingClientRect();
    const dx = event.clientX - (face.left + face.width / 2);
    const dy = event.clientY - (face.top + face.height / 2);
    const degrees = Math.round((Math.atan2(dx, -dy) * 180) / Math.PI);
    onChange((degrees + 360) % 360);
  }

  return (
    <div class="dial">
      <svg
        viewBox="-32 -32 64 64"
        role="slider"
        aria-label="이동 방향"
        aria-valuemin={0}
        aria-valuemax={359}
        aria-valuenow={turn}
        onPointerDown={(event) => {
          (event.currentTarget as SVGSVGElement).setPointerCapture(event.pointerId);
          pick(event);
        }}
        onPointerMove={(event) => {
          if ((event.currentTarget as SVGSVGElement).hasPointerCapture(event.pointerId)) pick(event);
        }}
      >
        <circle class="dial-face" r="29" />
        {[0, 45, 90, 135, 180, 225, 270, 315].map((tick) => (
          <line class="dial-tick" y1={-29} y2={tick % 90 ? -25 : -23} transform={`rotate(${tick})`} />
        ))}
        <g transform={`rotate(${turn})`}>
          <line class="dial-needle" y1={4} y2={-15} />
          <path class="dial-tip" d="M0 -26 L5 -14 L0 -16.5 L-5 -14 Z" />
        </g>
        <circle class="dial-hub" r="3" />
      </svg>
      <label class="dial-value">
        <span>이동 방향</span>
        <input
          class="input"
          type="number"
          value={value}
          onInput={(event) => {
            const parsed = Number((event.target as HTMLInputElement).value);
            if (Number.isFinite(parsed)) onChange(parsed);
          }}
        />
      </label>
    </div>
  );
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function Field(
  { label, value, inset, onChange }:
  { label: string; value: number; inset?: boolean; onChange: (value: string) => void },
) {
  // A one-letter label sits inside the box.
  if (inset) {
    return (
      <label class="f inset input">
        <span>{label}</span>
        <input
          type="number"
          value={value}
          aria-label={label}
          onInput={(event) => onChange((event.target as HTMLInputElement).value)}
        />
      </label>
    );
  }
  return (
    <label class="f">
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
