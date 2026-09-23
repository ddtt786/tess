/** Editor shell: stage and objects on the left, the work area on the right. */
import { CodeDrawer } from './CodeDrawer.tsx';
import { Dialogs } from './Dialogs.tsx';
import { EditorTabs } from './EditorTabs.tsx';
import { Topbar } from './Topbar.tsx';
import { ObjectPanel } from './ObjectPanel.tsx';
import { Resizer } from './Resizer.tsx';
import { StagePanel } from './StagePanel.tsx';
import { useEffect } from 'preact/hooks';
import { redo, saveFailed, undo } from '../model/store.ts';
import { busy, codeOpen, toast } from './state.ts';

/** Places that keep their own undo: text fields, the block canvas, the painter, a running work. */
const OWN_UNDO = 'input, textarea, select, [contenteditable="true"], .injectionDiv, .costume-pane, .stage-host';

export function App() {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || !(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      const isUndo = key === 'z' && !event.shiftKey;
      const isRedo = key === 'y' || (key === 'z' && event.shiftKey);
      if (!isUndo && !isRedo) return;
      const focused = document.activeElement;
      if (focused instanceof Element && focused.closest(OWN_UNDO)) return;
      if (event.target instanceof Element && event.target.closest(OWN_UNDO)) return;
      // Blockly listens on the whole document; outside its canvas the key is the editor's alone.
      event.preventDefault();
      event.stopImmediatePropagation();
      if (isUndo) undo();
      else redo();
    }
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, []);

  return (
    <div class="app">
      <Topbar />
      <div class="workarea">
        <aside class="side">
          <StagePanel />
          <ObjectPanel />
        </aside>
        <Resizer />
        <section class="work">
          <EditorTabs />
        </section>
      </div>
      {codeOpen.value && <CodeDrawer />}
      <Dialogs />
      {toast.value && <div class="toast">{toast.value}</div>}
      {busy.value && (
        <div class="busy-overlay" role="status" aria-live="polite">
          <div class="busy-card">
            <div class="busy-spinner" aria-hidden="true" />
            <div class="busy-step">{busy.value.step}</div>
            <div class="busy-bar"><i style={{ width: `${Math.round(busy.value.done * 100)}%` }} /></div>
          </div>
        </div>
      )}
      {saveFailed.value && (
        <div class="toast warn">작품이 너무 커서 자동 저장을 하지 못했습니다. 코드를 .tess 로 저장해 두세요.</div>
      )}
    </div>
  );
}
