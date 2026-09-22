/** Live view of the Tess source the blocks are written to. */
import { useSignal, useSignalEffect } from '@preact/signals';
import { project } from '../model/store.ts';
import { build } from '../runtime/run.ts';
import { currentSource } from './source.ts';
import { codeOpen, notify } from './state.ts';
import type { CompileDiagnostic } from '../../../compiler/src/types.ts';

export function CodeDrawer() {
  const source = useSignal('');
  const errors = useSignal<CompileDiagnostic[]>([]);
  const warnings = useSignal<CompileDiagnostic[]>([]);

  useSignalEffect(() => {
    // Rebuild whenever anything in the project moves.
    project.value;
    const timer = setTimeout(() => {
      const text = currentSource();
      source.value = text;
      const built = build(text, project.peek().name);
      errors.value = built.errors;
      warnings.value = built.warnings;
    }, 120);
    return () => clearTimeout(timer);
  });

  function download() {
    const blob = new Blob([source.value], { type: 'text/plain;charset=utf-8' });
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
        <button class="btn ghost" onClick={download}>.tess 저장</button>
        <button class="btn ghost" onClick={() => { codeOpen.value = false; }}>✕</button>
      </div>
      <pre class="code">{source.value}</pre>
      <div class="diags">
        {!errors.value.length && !warnings.value.length && <div class="diag ok">문제가 없습니다.</div>}
        {errors.value.map((diagnostic, index) => (
          <div class="diag error" key={`e${index}`}>
            <span class="at">{diagnostic.line}:{diagnostic.column}</span>
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
