/** Small prompts the palette buttons open. */
import { useSignal } from '@preact/signals';
import { addSignal, addTable, addVariable, selectedObject, selectedObjectId } from '../model/store.ts';
import { refreshPalette } from './blockly-host.ts';
import { dialog, notify, pickedList, type DialogKind } from './state.ts';

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
    else {
      const made = addVariable(label, kind === 'list' ? 'list' : 'variable', owned.value ? selectedObjectId.value : null);
      if (kind === 'list') pickedList.value = made.id;
    }
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
          <>
            {/* Scope is settled here: a variable belongs to one object or to
                the whole work for as long as it lives. */}
            <div class="seg" role="group" aria-label="사용 범위">
              <button class={owned.value ? '' : 'on'} onClick={() => { owned.value = false; }}>
                모든 오브젝트
              </button>
              <button class={owned.value ? 'on' : ''} onClick={() => { owned.value = true; }}>
                {`${selectedObject.value?.name ?? '이 오브젝트'}에서만`}
              </button>
            </div>
            <p class="dialog-note">
              {owned.value
                ? '이 오브젝트의 블록에서만 보입니다.'
                : '모든 오브젝트의 블록에서 쓸 수 있습니다.'}
            </p>
          </>
        )}
        <div class="actions">
          <button class="btn ghost" onClick={close}>취소</button>
          <button class="btn primary" onClick={create}>만들기</button>
        </div>
      </div>
    </div>
  );
}
