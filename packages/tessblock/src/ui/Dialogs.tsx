/** Small prompts the palette buttons open. */
import { useSignal } from '@preact/signals';
import { addSignal, addTable, addVariable, selectedObjectId } from '../model/store.ts';
import { refreshPalette } from './blockly-host.ts';
import { dialog, notify, type DialogKind } from './state.ts';

const TITLES: Record<DialogKind, string> = {
  variable: '변수 만들기',
  list: '리스트 만들기',
  signal: '신호 만들기',
  table: '테이블 만들기',
};

export function Dialogs() {
  const kind = dialog.value;
  const name = useSignal('');
  const owned = useSignal(false);
  if (!kind) return null;

  function close() {
    dialog.value = null;
    name.value = '';
    owned.value = false;
  }

  function create() {
    const label = name.value.trim();
    if (!label) {
      notify('이름을 적어주세요.');
      return;
    }
    if (kind === 'signal') addSignal(label);
    else if (kind === 'table') addTable(label);
    else addVariable(label, kind === 'list' ? 'list' : 'variable', owned.value ? selectedObjectId.value : null);
    refreshPalette();
    close();
  }

  return (
    <div class="scrim" onClick={close}>
      <div class="dialog" onClick={(event) => event.stopPropagation()}>
        <h3>{TITLES[kind]}</h3>
        <input
          class="input"
          autoFocus
          placeholder="이름"
          value={name.value}
          onInput={(event) => { name.value = (event.target as HTMLInputElement).value; }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') create();
          }}
        />
        {(kind === 'variable' || kind === 'list') && (
          <label class="check">
            <input
              type="checkbox"
              checked={owned.value}
              onChange={(event) => { owned.value = (event.target as HTMLInputElement).checked; }}
            />
            이 오브젝트에서만 사용
          </label>
        )}
        <div class="actions">
          <button class="btn ghost" onClick={close}>취소</button>
          <button class="btn primary" onClick={create}>만들기</button>
        </div>
      </div>
    </div>
  );
}
