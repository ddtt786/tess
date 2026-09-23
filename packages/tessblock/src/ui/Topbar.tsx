/** Title bar: project name, scenes (draggable) and the code drawer toggle. */
import { useSignal } from '@preact/signals';
import { useRef } from 'preact/hooks';
import {
  addScene, currentScene, duplicateScene, project, removeScene, renameScene, reorderScene, selectScene,
  setProjectName,
} from '../model/store.ts';
import { downloadProject, loadProjectFile } from '../model/file-io.ts';
import { loadEntFile } from '../model/ent-import.ts';
import { buildEnt } from '../runtime/ent.ts';
import { currentSource } from './source.ts';
import { beginDrag } from './drag.ts';
import { CodeIcon, CopyIcon, PlusIcon, UploadIcon } from './icons.tsx';
import { InlineName } from './InlineName.tsx';
import { codeOpen, notify } from './state.ts';

export function Topbar() {
  const model = project.value;
  const file = useRef<HTMLInputElement>(null);
  const scene = currentScene.value;
  const drag = useSignal<{ id: string; overId: string; before: boolean } | null>(null);
  const packing = useSignal(false);

  /** Packs the work the way entry stores it, files and all. */
  async function exportEnt() {
    packing.value = true;
    try {
      const built = await buildEnt(currentSource(), model.name);
      if (!built.blob) {
        const first = built.errors[0];
        notify(first ? `${first.line}:${first.column} ${first.message}` : '작품을 만들 수 없습니다.');
        return;
      }
      const link = document.createElement('a');
      link.href = URL.createObjectURL(built.blob);
      link.download = `${model.name || '작품'}.ent`;
      link.click();
      URL.revokeObjectURL(link.href);
      notify('.ent 파일을 저장했습니다.');
    } catch (error) {
      notify(error instanceof Error ? error.message : '.ent 를 만들지 못했습니다.');
    } finally {
      packing.value = false;
    }
  }

  /** Which scene chip the pointer is over, and which half of it. */
  function chipAt(clientX: number): { id: string; before: boolean } | null {
    const chips = [...document.querySelectorAll<HTMLElement>('.scene[data-id]')];
    for (const chip of chips) {
      const rect = chip.getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right) {
        return { id: chip.dataset.id ?? '', before: clientX < rect.left + rect.width / 2 };
      }
    }
    const last = chips[chips.length - 1];
    return last ? { id: last.dataset.id ?? '', before: false } : null;
  }

  function startDrag(event: PointerEvent, id: string) {
    if (event.button !== 0) return;
    beginDrag(event, {
      slop: 4,
      onMove(moved) {
        const target = chipAt(moved.clientX);
        drag.value = { id, overId: target?.id ?? '', before: target?.before ?? true };
      },
      onEnd(_event, moved) {
        const state = drag.value;
        if (moved && state?.overId && state.overId !== id) reorderScene(state.id, state.overId, state.before);
        drag.value = null;
      },
    });
  }

  return (
    <header class="topbar">
      <div class="brand">
        <span class="brand-mark">T</span>
        <span class="brand-name">tessblock</span>
      </div>
      <span class="vr" />
      <input
        class="name-field"
        value={model.name}
        onInput={(event) => setProjectName((event.target as HTMLInputElement).value)}
        aria-label="작품 이름"
      />
      <span class="vr" />
      <nav class="scenes" aria-label="장면">
        {model.scenes.map((candidate) => {
          const drop = drag.value?.overId === candidate.id ? drag.value : null;
          return (
            <div
              key={candidate.id}
              data-id={candidate.id}
              class={[
                'scene',
                candidate.id === scene?.id ? 'on' : '',
                drag.value?.id === candidate.id ? 'dragging' : '',
                drop ? (drop.before ? 'drop-before' : 'drop-after') : '',
              ].join(' ')}
              role="button"
              tabIndex={0}
              aria-pressed={candidate.id === scene?.id}
              onPointerDown={(event) => startDrag(event, candidate.id)}
              onClick={() => selectScene(candidate.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  selectScene(candidate.id);
                }
              }}
            >
              <InlineName value={candidate.name} onCommit={(name) => renameScene(candidate.id, name)} />
              <span
                class="dup"
                title={`${candidate.name} 복제하기`}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  duplicateScene(candidate.id);
                }}
              >
                <CopyIcon />
              </span>
              {model.scenes.length > 1 && (
                <span
                  class="x"
                  title={`${candidate.name} 삭제`}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    removeScene(candidate.id);
                  }}
                >
                  ✕
                </span>
              )}
            </div>
          );
        })}
        <button class="scene-add" title="장면 추가" aria-label="장면 추가" onClick={addScene}>
          <PlusIcon />
        </button>
      </nav>
      <span class="spacer" />
      <button class="btn" title="작품 파일 불러오기" onClick={() => file.current?.click()}>
        <UploadIcon /> 불러오기
      </button>
      <button class="btn" title="작품을 파일로 저장" onClick={downloadProject}>저장</button>
      <button
        class="btn"
        title="엔트리에서 열 수 있는 .ent 파일로 내보내기"
        disabled={packing.value}
        onClick={() => void exportEnt()}
      >
        {packing.value ? '만드는 중…' : '.ent'}
      </button>
      <input
        ref={file}
        type="file"
        accept=".tessproj,.ent,application/json"
        hidden
        onChange={(event) => {
          const picked = (event.target as HTMLInputElement).files?.[0];
          (event.target as HTMLInputElement).value = '';
          if (!picked) return;
          const fail = (error: unknown) => notify(error instanceof Error ? error.message : '불러오지 못했습니다.');
          if (/\.ent$/i.test(picked.name)) {
            notify('엔트리 작품을 옮기는 중…');
            void loadEntFile(picked).then(({ missed }) => notify(entSummary(missed))).catch(fail);
            return;
          }
          void loadProjectFile(picked)
            .then(() => notify('작품을 불러왔습니다.'))
            .catch(fail);
        }}
      />
      <button
        class={`btn ${codeOpen.value ? 'on' : ''}`}
        onClick={() => { codeOpen.value = !codeOpen.value; }}
      >
        <CodeIcon /> 코드
      </button>
    </header>
  );
}

/** What the toast says after an entry work is opened. */
function entSummary(missed: Map<string, number>): string {
  const total = [...missed.values()].reduce((sum, count) => sum + count, 0);
  if (!total) return '엔트리 작품을 불러왔습니다.';
  const kinds = [...missed.keys()].slice(0, 3).join(', ');
  return `엔트리 작품을 불러왔습니다. 블록으로 옮기지 못한 ${total}개는 빠졌습니다 (${kinds}${missed.size > 3 ? ' …' : ''}).`;
}
