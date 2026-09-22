/** Editor shell: stage and objects on the left, the work area on the right. */
import { CodeDrawer } from './CodeDrawer.tsx';
import { Dialogs } from './Dialogs.tsx';
import { EditorTabs } from './EditorTabs.tsx';
import { Topbar } from './Topbar.tsx';
import { ObjectPanel } from './ObjectPanel.tsx';
import { Resizer } from './Resizer.tsx';
import { StagePanel } from './StagePanel.tsx';
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
    </div>
  );
}
