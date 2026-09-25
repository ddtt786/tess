/**
 * Live view of the Tess source the selected object's blocks are written to.
 * The whole work is still compiled, so problems are found as a run finds them;
 * only the object's own lines, and their problems, are shown.
 */
import { useSignal, useSignalEffect } from '@preact/signals';
import { objectRange } from '../codegen/project.ts';
import { project, selectedObject, selectedObjectId } from '../model/store.ts';
import { build } from '../runtime/run.ts';
import { currentSource } from './source.ts';
import { codeOpen, notify } from './state.ts';
import type { CompileDiagnostic } from '../../../compiler/src/types.ts';

export function CodeDrawer() {
  /** The whole work's source, for saving. */
  const whole = useSignal('');
  /** The selected object's lines only. */
  const source = useSignal('');
  const errors = useSignal<Array<CompileDiagnostic & { elsewhere?: boolean }>>([]);
  const warnings = useSignal<CompileDiagnostic[]>([]);

  useSignalEffect(() => {
    // Rebuild whenever anything in the project, or the selection, moves.
    project.value;
    const objectId = selectedObjectId.value;
    const timer = setTimeout(() => {
      const text = currentSource(false);
      whole.value = text;
      const range = objectRange(text, project.peek(), objectId);
      const lines = text.split('\n');
      // Lines numbered from the object's header; indentation of the scene around it dropped.
      source.value = range
        ? lines.slice(range.from - 1, range.to).map((line) => line.replace(/^ {2}/, '')).join('\n')
        : '';
      const built = build(text, project.peek().name);
      const own = (diagnostic: CompileDiagnostic) => !range || (diagnostic.line >= range.from && diagnostic.line <= range.to);
      const local = (diagnostic: CompileDiagnostic) => (range ? { ...diagnostic, line: diagnostic.line - range.from + 1 } : diagnostic);
      // Problems elsewhere still show (a run stops on them), marked as lines of the whole work.
      const place = (diagnostic: CompileDiagnostic) => (own(diagnostic) ? local(diagnostic) : { ...diagnostic, elsewhere: true });
      errors.value = [...built.errors.filter(own), ...built.errors.filter((d) => !own(d))].map(place);
      warnings.value = built.warnings.filter(own).map(local);
    }, 120);
    return () => clearTimeout(timer);
  });

  function download() {
    const blob = new Blob([whole.value], { type: 'text/plain;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${project.peek().name || 'project'}.tess`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  return (
    <aside class="drawer">
      <div class="drawer-head">
        <strong>Tess 코드</strong>
        <span class="drawer-sub">{selectedObject.value?.name ?? '오브젝트 없음'}</span>
        <span class="spacer" />
        <button
          class="btn ghost"
          onClick={() => {
            navigator.clipboard?.writeText(source.value);
            notify('코드를 복사했습니다.');
          }}
        >
          복사
        </button>
        <button class="btn ghost" title="작품 전체를 저장합니다" onClick={download}>.tess 저장</button>
        <button class="btn ghost" onClick={() => { codeOpen.value = false; }}>✕</button>
      </div>
      <pre class="code">{source.value}</pre>
      <div class="diags">
        {!errors.value.length && !warnings.value.length && <div class="diag ok">문제가 없습니다.</div>}
        {errors.value.map((diagnostic, index) => (
          <div class="diag error" key={`e${index}`}>
            <span class="at">{diagnostic.elsewhere ? `전체 ${diagnostic.line}` : diagnostic.line}:{diagnostic.column}</span>
            <span class="msg">{diagnostic.message}</span>
          </div>
        ))}
        {warnings.value.map((diagnostic, index) => (
          <div class="diag warn" key={`w${index}`}>
            <span class="at">{diagnostic.line}:{diagnostic.column}</span>
            <span class="msg">{diagnostic.message}</span>
          </div>
        ))}
      </div>
    </aside>
  );
}
