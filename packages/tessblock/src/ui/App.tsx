/** Editor shell: stage and objects on the left, the work area on the right. */
import { CodeDrawer } from './CodeDrawer.tsx';
import { Dialogs } from './Dialogs.tsx';
import { EditorTabs } from './EditorTabs.tsx';
import { Topbar } from './Topbar.tsx';
import { ObjectPanel } from './ObjectPanel.tsx';
import { Resizer } from './Resizer.tsx';
import { StagePanel } from './StagePanel.tsx';
import { saveFailed } from '../model/store.ts';
import { codeOpen, toast } from './state.ts';

export function App() {
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
      {saveFailed.value && (
        <div class="toast warn">작품이 너무 커서 자동 저장을 하지 못했습니다. 코드를 .tess 로 저장해 두세요.</div>
      )}
    </div>
  );
}
