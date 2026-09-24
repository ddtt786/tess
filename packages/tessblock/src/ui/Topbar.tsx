/** Title bar: project name, scenes (draggable) and the code drawer toggle. */
import { useSignal } from '@preact/signals';
import { useRef } from 'preact/hooks';
import {
  addScene, currentScene, duplicateScene, project, removeScene, renameScene, reorderScene, selectScene,
  newProject, setProjectName,
} from '../model/store.ts';
import {
  canUseFolders, detachFolder, folderState, openFolder, reconnectFolder, saveFolderNow, saveIntoFolder, type FolderResult,
} from '../model/folder.ts';
import { downloadProject, loadProjectFile } from '../model/file-io.ts';
import { loadEntFile } from '../model/ent-import.ts';
import { buildEnt } from '../runtime/ent.ts';
import { currentSource } from './source.ts';
import { beginDrag } from './drag.ts';
import { CodeIcon, CopyIcon, FilePlusIcon, FolderIcon, PlusIcon, UploadIcon } from './icons.tsx';
import { InlineName } from './InlineName.tsx';
import { busy, codeOpen, notify } from './state.ts';

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

  const strip = useRef<HTMLElement>(null);

  /** A mouse wheel scrolls the strip sideways; it has no scrollbar of its own to grab. */
  function scrollStrip(event: WheelEvent) {
    const nav = strip.current;
    if (!nav || Math.abs(event.deltaY) < Math.abs(event.deltaX)) return;
    nav.scrollLeft += event.deltaY;
  }

  function addSceneAndShow() {
    addScene();
    requestAnimationFrame(() => {
      strip.current?.querySelector('.scene.on')?.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' });
    });
  }

  function startNew() {
    detachFolder();
    newProject();
    notify('새 작품을 만들었습니다. Ctrl+Z 로 되돌릴 수 있습니다.');
  }

  /** An entry work, with the progress shown over the editor while it is turned into blocks. */
  async function importEnt(picked: File) {
    busy.value = { step: '엔트리 작품을 여는 중', done: 0 };
    try {
      const { missed } = await loadEntFile(picked, (step, done) => { busy.value = { step, done }; });
      notify(entSummary(missed));
    } finally {
      busy.value = null;
    }
  }

  async function pickFolder() {
    try {
      busy.value = { step: '폴더를 여는 중', done: 0.3 };
      const result = await openFolder();
      notify(FOLDER_MESSAGES[result]);
    } catch (error) {
      if ((error as DOMException)?.name !== 'AbortError') {
        notify(error instanceof Error ? error.message : '폴더를 열지 못했습니다.');
      }
    } finally {
      busy.value = null;
    }
  }

  async function saveToFolder() {
    try {
      await saveFolderNow();
      notify(`${folderState.value?.name ?? '폴더'} 에 저장했습니다.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : '폴더에 저장하지 못했습니다.');
    }
  }

  async function saveAsFolder() {
    try {
      busy.value = { step: '폴더에 저장하는 중', done: 0.5 };
      await saveIntoFolder();
      notify(`${folderState.value?.name ?? '폴더'} 에 저장했습니다. 이제 이 폴더에 바로 저장됩니다.`);
    } catch (error) {
      if ((error as DOMException)?.name !== 'AbortError') {
        notify(error instanceof Error ? error.message : '폴더에 저장하지 못했습니다.');
      }
    } finally {
      busy.value = null;
    }
  }

  async function reconnect() {
    try {
      busy.value = { step: '폴더에 다시 연결하는 중', done: 0.3 };
      const result = await reconnectFolder();
      if (result) notify(FOLDER_MESSAGES[result]);
    } catch (error) {
      notify(error instanceof Error ? error.message : '폴더에 연결하지 못했습니다.');
    } finally {
      busy.value = null;
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
      <nav class="scenes" aria-label="장면" ref={strip} onWheel={scrollStrip}>
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
      </nav>
      <div class="scene-tools">
        <button class="scene-add" title="장면 추가" aria-label="장면 추가" onClick={addSceneAndShow}>
          <PlusIcon />
        </button>
      </div>
      <span class="spacer" />
      <button class="btn" title="새 작품 만들기 (Ctrl+Z 로 되돌릴 수 있습니다)" onClick={startNew}>
        <FilePlusIcon /> 새로 만들기
      </button>
      {canUseFolders && (
        folderState.value ? (
          <button
            class={`btn folder-chip ${folderState.value.connected ? 'on' : 'off'}`}
            title={folderState.value.connected ? '이 폴더에 바로 저장하고 있습니다. 누르면 다른 폴더를 엽니다.' : '다시 연결하기'}
            onClick={() => void (folderState.value?.connected ? pickFolder() : reconnect())}
          >
            <FolderIcon /> {folderState.value.name}
            {!folderState.value.connected && <span class="chip-note">다시 연결</span>}
          </button>
        ) : (
          <button class="btn" title="폴더를 열어 그 안에서 바로 작업하기" onClick={() => void pickFolder()}>
            <FolderIcon /> 폴더 열기
          </button>
        )
      )}
      <button class="btn" title="작품 파일 불러오기" onClick={() => file.current?.click()}>
        <UploadIcon /> 불러오기
      </button>
      {folderState.value?.connected ? (
        <button class="btn" title={`${folderState.value.name} 폴더에 지금 저장`} onClick={() => void saveToFolder()}>저장</button>
      ) : (
        <button class="btn" title="작품을 파일로 내려받기" onClick={downloadProject}>저장</button>
      )}
      {canUseFolders && !folderState.value?.connected && (
        <button class="btn" title="폴더를 골라 그 안에 작품을 저장하고, 앞으로 거기서 작업하기" onClick={() => void saveAsFolder()}>
          폴더에 저장
        </button>
      )}
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
          // With a folder open, the opened work moves into that folder (and is saved there).
          if (/\.ent$/i.test(picked.name)) {
            void importEnt(picked).catch(fail);
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

const FOLDER_MESSAGES: Record<FolderResult, string> = {
  loaded: '폴더의 작품을 열었습니다. 고치면 폴더에 바로 저장됩니다.',
  imported: '폴더의 엔트리 작품을 옮겼습니다. 이제 이 폴더에 바로 저장됩니다.',
  created: '지금 작품을 폴더에 저장했습니다. 고치면 폴더에 바로 저장됩니다.',
};
