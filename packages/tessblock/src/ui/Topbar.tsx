/** Title bar: project name, scenes (draggable) and the code drawer toggle. */
import { useSignal } from '@preact/signals';
import {
  addScene, currentScene, project, removeScene, renameScene, reorderScene, selectScene, setProjectName,
} from '../model/store.ts';
import { beginDrag } from './drag.ts';
import { CodeIcon, PlusIcon } from './icons.tsx';
import { InlineName } from './InlineName.tsx';
import { codeOpen } from './state.ts';

export function Topbar() {
  const model = project.value;
  const scene = currentScene.value;
  const drag = useSignal<{ id: string; overId: string; before: boolean } | null>(null);

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
      <button
        class={`btn ${codeOpen.value ? 'on' : ''}`}
        onClick={() => { codeOpen.value = !codeOpen.value; }}
      >
        <CodeIcon /> 코드
      </button>
    </header>
  );
}
