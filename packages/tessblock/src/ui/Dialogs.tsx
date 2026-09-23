/** Small prompts the palette buttons open. */
import { useSignal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { addSignal, addTable, addVariable, project, selectedObject, selectedObjectId, updateVariable } from '../model/store.ts';
import { refreshPalette } from './blockly-host.ts';
import { dialog, notify, pickedList, type DialogKind } from './state.ts';
import { SignalIcon } from './icons.tsx';

const TITLES: Record<DialogKind, { title: string; subtitle: string }> = {
  variable: { title: '변수 만들기', subtitle: '값을 저장하고 계산에 활용할 새 변수를 생성합니다.' },
  list: { title: '리스트 만들기', subtitle: '여러 개의 값을 순서대로 보관하는 리스트를 생성합니다.' },
  signal: { title: '신호 만들기', subtitle: '오브젝트 간에 메시지를 주고받아 이벤트를 동기화합니다.' },
  table: { title: '테이블 만들기', subtitle: '행과 열로 구성된 표 형태의 데이터 테이블을 생성합니다.' },
};

export function Dialogs() {
  const kind = dialog.value;
  const name = useSignal('');
  const initialValue = useSignal('0');
  const owned = useSignal(false);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && dialog.value) {
        close();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  if (!kind) return null;

  function close() {
    dialog.value = null;
    name.value = '';
    initialValue.value = '0';
    owned.value = false;
  }

  function create() {
    const label = name.value.trim();
    if (!label) {
      notify('이름을 적어주세요.');
      return;
    }
    if (kind === 'signal') {
      const existing = project.value.signals.find((s) => s.name === label);
      if (existing) {
        notify('이미 같은 이름의 신호가 있습니다.');
        return;
      }
      addSignal(label);
    } else if (kind === 'table') {
      addTable(label);
    } else {
      const made = addVariable(label, kind === 'list' ? 'list' : 'variable', owned.value ? selectedObjectId.value : null);
      if (kind === 'variable' && initialValue.value.trim() !== '') {
        const parsed = Number(initialValue.value);
        updateVariable(made.id, { value: Number.isFinite(parsed) ? parsed : initialValue.value });
      }
      if (kind === 'list') pickedList.value = made.id;
    }
    refreshPalette();
    close();
  }

  const existingSignals = project.value.signals;

  return (
    <div class="scrim" onClick={close}>
      <div class="dialog modern-dialog" onClick={(event) => event.stopPropagation()}>
        <div class="dialog-header">
          <div class="dialog-icon-badge">
            {kind === 'signal' ? <SignalIcon size={18} /> : <span>{kind === 'variable' ? 'V' : kind === 'list' ? 'L' : 'T'}</span>}
          </div>
          <div>
            <h3>{TITLES[kind].title}</h3>
            <p class="dialog-sub">{TITLES[kind].subtitle}</p>
          </div>
        </div>

        <div class="dialog-form">
          <label class="dialog-field">
            <span class="field-label">이름</span>
            <input
              class="input dialog-input"
              autoFocus
              placeholder={`${kind === 'variable' ? '변수' : kind === 'signal' ? '신호' : kind === 'list' ? '리스트' : '테이블'} 이름 입력`}
              value={name.value}
              onInput={(event) => { name.value = (event.target as HTMLInputElement).value; }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') create();
              }}
            />
          </label>

          {kind === 'variable' && (
            <label class="dialog-field">
              <span class="field-label">기본값 (처음 값)</span>
              <input
                class="input dialog-input"
                placeholder="0"
                value={initialValue.value}
                onInput={(event) => { initialValue.value = (event.target as HTMLInputElement).value; }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') create();
                }}
              />
            </label>
          )}

          {kind === 'signal' && existingSignals.length > 0 && (
            <div class="existing-signals">
              <span class="field-label">기존 신호 목록</span>
              <div class="signal-chips">
                {existingSignals.map((s) => (
                  <span key={s.id} class="signal-chip">{s.name}</span>
                ))}
              </div>
            </div>
          )}

          {(kind === 'variable' || kind === 'list') && (
            <div class="scope-section">
              <span class="field-label">사용 범위</span>
              <div class="scope-cards">
                <div
                  class={`scope-card ${!owned.value ? 'on' : ''}`}
                  onClick={() => { owned.value = false; }}
                >
                  <div class="scope-radio" />
                  <div>
                    <strong class="scope-title">모든 오브젝트</strong>
                    <p class="scope-desc">작품 전체의 모든 블록에서 이 {kind === 'variable' ? '변수' : '리스트'}를 사용할 수 있습니다.</p>
                  </div>
                </div>
                <div
                  class={`scope-card ${owned.value ? 'on' : ''}`}
                  onClick={() => { owned.value = true; }}
                >
                  <div class="scope-radio" />
                  <div>
                    <strong class="scope-title">{selectedObject.value?.name ?? '이 오브젝트'} 전용</strong>
                    <p class="scope-desc">현재 오브젝트의 블록에서만 보이고 사용됩니다.</p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div class="actions dialog-actions">
          <button class="btn ghost" onClick={close}>취소</button>
          <button class="btn primary dialog-submit" onClick={create}>만들기</button>
        </div>
      </div>
    </div>
  );
}

