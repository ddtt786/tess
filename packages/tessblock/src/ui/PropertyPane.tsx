/** Properties: variables, lists, signals, tables and functions of the project. */
import { useSignal } from '@preact/signals';
import { useRef } from 'preact/hooks';
import { beginDrag } from './drag.ts';
import {
  addSignal, addTable, project, removeFunction, removeSignal, removeTable,
  removeVariable, selectObject, selectedObjectId, updateFunction, updateSignal, updateTable, updateVariable,
} from '../model/store.ts';
import { newId } from '../model/ids.ts';
import type { FunctionDef, StorageScope, VariableDef } from '../model/types.ts';
import { EyeIcon, EyeOffIcon, GripIcon, PencilIcon, PlusIcon, TrashIcon } from './icons.tsx';
import { InlineName } from './InlineName.tsx';
import { dialog, functionDraft, pickedList, propertyTab, type PropertyTab } from './state.ts';

const TABS: Array<[PropertyTab, string]> = [
  ['variable', '변수'],
  ['list', '리스트'],
  ['signal', '신호'],
  ['table', '테이블'],
  ['function', '함수'],
];

export function PropertyPane() {
  const tab = propertyTab.value;
  return (
    <div class="sheet prop-sheet">
      <div class="seg prop-seg">
        {TABS.map(([key, label]) => (
          <button key={key} class={tab === key ? 'on' : ''} onClick={() => { propertyTab.value = key; }}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'variable' && <VariableTable />}
      {tab === 'list' && <ListEditor />}
      {tab === 'signal' && <SignalTable />}
      {tab === 'table' && <TableEditor />}
      {tab === 'function' && <FunctionTable />}
    </div>
  );
}

// --- variables --------------------------------------------------------------

function VariableTable() {
  const currentObjId = selectedObjectId.value;
  const currentObj = project.value.objects.find((o) => o.id === currentObjId);
  const allVars = project.value.variables.filter((variable) => variable.kind === 'variable');
  const globalVars = allVars.filter((variable) => !variable.owner);
  const localVars = allVars.filter((variable) => variable.owner === currentObjId);
  const picked = useSignal('');

  const row = (variable: VariableDef) => (
    <VariableRow
      key={variable.id}
      variable={variable}
      open={picked.value === variable.id}
      onPick={() => { picked.value = picked.value === variable.id ? '' : variable.id; }}
    />
  );

  return (
    <>
      <div class="sheet-head">
        <div>
          <h3>변수</h3>
          <p class="sub">눌러서 처음 값을 고치고, 두 번 눌러 이름을 바꿉니다.</p>
        </div>
        <span class="spacer" />
        <button class="btn primary" onClick={() => { dialog.value = 'variable'; }}>
          <PlusIcon /> 변수 추가
        </button>
      </div>

      <div class="rec-list">
        <div class="rec-group">전역 변수 <span class="muted">모든 오브젝트</span></div>
        {globalVars.map(row)}
        {!globalVars.length && <div class="rec-empty">전역 변수가 없습니다.</div>}

        <div class="rec-group">지역 변수 <span class="muted">{currentObj ? `${currentObj.name} 전용` : '선택된 오브젝트 없음'}</span></div>
        {localVars.map(row)}
        {!localVars.length && <div class="rec-empty">지역 변수가 없습니다.</div>}

        <OtherLocals kind="variable" row={row} />
      </div>
    </>
  );
}

function VariableRow({ variable, open, onPick }: { variable: VariableDef; open: boolean; onPick: () => void }) {
  return (
    <div class={`rec ${open ? 'on' : ''}`}>
      <div class="rec-row" onClick={(event) => { if (event.detail < 2) onPick(); }}>
        <InlineName
          class="rec-name"
          value={variable.name}
          onCommit={(name) => updateVariable(variable.id, { name })}
        />
        <span class="rec-meta">{String(variable.value)}</span>
        {variable.scope !== 'local' && <span class="tag">{variable.scope === 'shared' ? '공유' : '실시간'}</span>}
        <VisibilityButton variable={variable} />
        <button
          class="iconbtn plain danger"
          title="삭제"
          aria-label="삭제"
          onClick={(event) => { event.stopPropagation(); removeVariable(variable.id); }}
        >
          <TrashIcon size={14} />
        </button>
      </div>
      {open && (
        <div class="rec-editor">
          <label class="f">
            <span>처음 값</span>
            <input
              class="input"
              value={String(variable.value)}
              onInput={(event) => updateVariable(variable.id, { value: (event.target as HTMLInputElement).value })}
            />
          </label>
          {!variable.owner && (
            <label class="f">
              <span>저장 방식</span>
              <ScopeSelect variable={variable} />
            </label>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Variables other objects keep for themselves, under their owner's name. They
 * stay editable here; the button next to the owner jumps to that object.
 */
function OtherLocals({ kind, row }: { kind: 'variable' | 'list'; row: (variable: VariableDef) => preact.JSX.Element }) {
  const current = selectedObjectId.value;
  const model = project.value;
  const owners = model.objects.filter((object) => object.id !== current
    && model.variables.some((variable) => variable.kind === kind && variable.owner === object.id));
  if (!owners.length) return null;
  return (
    <>
      <div class="rec-group">다른 오브젝트의 지역 {kind === 'variable' ? '변수' : '리스트'}</div>
      {owners.map((owner) => (
        <div key={owner.id} class="rec-owner">
          <div class="rec-owner-head">
            <span>{owner.name}</span>
            <button class="rec-jump" title={`${owner.name} 오브젝트로 가기`} onClick={() => selectObject(owner.id)}>
              바로가기 →
            </button>
          </div>
          {model.variables.filter((variable) => variable.kind === kind && variable.owner === owner.id).map(row)}
        </div>
      ))}
    </>
  );
}

/** Whether the variable or list box shows on the stage. */
function VisibilityButton({ variable }: { variable: VariableDef }) {
  return (
    <button
      class={`iconbtn plain ${variable.visible ? 'on' : ''}`}
      title={variable.visible ? '무대에 보임' : '무대에 숨김'}
      aria-label={variable.visible ? '숨기기' : '보이기'}
      aria-pressed={variable.visible}
      onClick={(event) => { event.stopPropagation(); updateVariable(variable.id, { visible: !variable.visible }); }}
    >
      {variable.visible ? <EyeIcon size={15} /> : <EyeOffIcon size={15} />}
    </button>
  );
}

function ScopeSelect({ variable }: { variable: VariableDef }) {
  return (
    <select
      class="select"
      value={variable.scope}
      aria-label="저장 방식"
      onChange={(event) => updateVariable(variable.id, { scope: (event.target as HTMLSelectElement).value as StorageScope })}
    >
      <option value="local">기본</option>
      <option value="shared">공유</option>
      <option value="realtime">실시간</option>
    </select>
  );
}

// --- lists ------------------------------------------------------------------

function ListEditor() {
  const currentObjId = selectedObjectId.value;
  const currentObj = project.value.objects.find((o) => o.id === currentObjId);
  const allLists = project.value.variables.filter((variable) => variable.kind === 'list');
  const visibleLists = allLists.filter((list) => !list.owner || list.owner === currentObjId);
  const globalLists = allLists.filter((list) => !list.owner);
  const localLists = allLists.filter((list) => list.owner === currentObjId);

  const current = allLists.find((list) => list.id === pickedList.value) ?? visibleLists[visibleLists.length - 1];
  const others = project.value.objects.filter((object) => object.id !== currentObjId
    && allLists.some((list) => list.owner === object.id));

  function setItems(items: Array<string | number>) {
    if (current) updateVariable(current.id, { array: items });
  }

  const itemList = useRef<HTMLOListElement>(null);
  const dragFrom = useSignal<number | null>(null);
  const dragTo = useSignal<number | null>(null);

  /** Drags an item by its grip; the row under the pointer is where it lands. */
  function startItemDrag(event: PointerEvent, index: number) {
    event.preventDefault();
    beginDrag(event, {
      onMove(moved) {
        dragFrom.value = index;
        const rows = [...(itemList.current?.children ?? [])] as HTMLElement[];
        const target = rows.findIndex((row) => {
          const box = row.getBoundingClientRect();
          return moved.clientY < box.bottom;
        });
        dragTo.value = target < 0 ? rows.length - 1 : target;
      },
      onEnd() {
        const from = dragFrom.value;
        const to = dragTo.value;
        dragFrom.value = null;
        dragTo.value = null;
        if (!current || from === null || to === null || from === to) return;
        const next = [...current.array];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved!);
        setItems(next);
      },
    });
  }

  return (
    <>
      <div class="sheet-head">
        <div>
          <h3>리스트</h3>
          <p class="sub">항목을 한 줄씩 더하고, 순서를 바꾸고, 지울 수 있습니다.</p>
        </div>
        <span class="spacer" />
        <button class="btn primary" onClick={() => { dialog.value = 'list'; }}>
          <PlusIcon /> 리스트 추가
        </button>
      </div>

      <div class="split">
        <div class="pick-list-container" style="display:flex; flex-direction:column; gap:12px; width:200px; flex:none;">
          <div>
            <div style="font-size:11.5px; font-weight:700; color:var(--muted); padding:4px 8px;">전역 리스트</div>
            <ul class="pick-list">
              {globalLists.map((list) => (
                <li key={list.id}>
                  <button
                    class={`pick ${list.id === current?.id ? 'on' : ''}`}
                    onClick={() => { pickedList.value = list.id; }}
                  >
                    <span class="pick-name">{list.name}</span>
                    <span class="pick-count">{list.array.length}</span>
                  </button>
                </li>
              ))}
              {!globalLists.length && <li class="muted" style="padding:4px 8px; font-size:12px;">없음</li>}
            </ul>
          </div>

          <div>
            <div style="font-size:11.5px; font-weight:700; color:var(--muted); padding:4px 8px;">
              지역 리스트 ({currentObj?.name ?? '오브젝트'})
            </div>
            <ul class="pick-list">
              {localLists.map((list) => (
                <li key={list.id}>
                  <button
                    class={`pick ${list.id === current?.id ? 'on' : ''}`}
                    onClick={() => { pickedList.value = list.id; }}
                  >
                    <span class="pick-name">{list.name}</span>
                    <span class="pick-count">{list.array.length}</span>
                  </button>
                </li>
              ))}
              {!localLists.length && <li class="muted" style="padding:4px 8px; font-size:12px;">없음</li>}
            </ul>
          </div>

          {others.map((owner) => (
            <div key={owner.id}>
              <div class="rec-owner-head" style="padding:4px 8px;">
                <span>{owner.name}</span>
                <button class="rec-jump" title={`${owner.name} 오브젝트로 가기`} onClick={() => selectObject(owner.id)}>
                  바로가기 →
                </button>
              </div>
              <ul class="pick-list">
                {allLists.filter((list) => list.owner === owner.id).map((list) => (
                  <li key={list.id}>
                    <button
                      class={`pick ${list.id === current?.id ? 'on' : ''}`}
                      onClick={() => { pickedList.value = list.id; }}
                    >
                      <span class="pick-name">{list.name}</span>
                      <span class="pick-count">{list.array.length}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {current ? (
          <div class="pick-detail">
            <div class="detail-row">
              <label class="f" style="flex:1">
                <span>리스트 이름</span>
                <input
                  class="input"
                  value={current.name}
                  onInput={(event) => updateVariable(current.id, { name: (event.target as HTMLInputElement).value })}
                />
              </label>
              {!current.owner && (
                <label class="f">
                  <span>저장 방식</span>
                  <ScopeSelect variable={current} />
                </label>
              )}
              <VisibilityButton variable={current} />
              <button class="iconbtn plain danger" title="리스트 삭제" aria-label="리스트 삭제" onClick={() => removeVariable(current.id)}>
                <TrashIcon size={15} />
              </button>
            </div>

            <ol class="item-list" ref={itemList}>
              {current.array.map((item, index) => (
                <li
                  key={index}
                  class={[
                    dragFrom.value === index ? 'dragging' : '',
                    dragTo.value === index && dragFrom.value !== null && dragFrom.value !== index
                      ? (dragTo.value > dragFrom.value ? 'drop-after' : 'drop-before')
                      : '',
                  ].join(' ')}
                >
                  <span
                    class="item-grip"
                    title="끌어서 순서 바꾸기"
                    onPointerDown={(event) => startItemDrag(event, index)}
                  >
                    <GripIcon size={14} />
                  </span>
                  <span class="item-no">{index + 1}</span>
                  <input
                    class="input"
                    value={String(item)}
                    aria-label={`${index + 1}번째 항목`}
                    onInput={(event) => {
                      const next = [...current.array];
                      next[index] = (event.target as HTMLInputElement).value;
                      setItems(next);
                    }}
                  />
                  <button
                    class="iconbtn plain"
                    title="이 항목 삭제"
                    onClick={() => setItems(current.array.filter((_, at) => at !== index))}
                  >
                    <TrashIcon size={14} />
                  </button>
                </li>
              ))}
              {!current.array.length && <li class="muted" style="padding:6px 2px">항목이 없습니다.</li>}
            </ol>

            <button class="btn" onClick={() => setItems([...current.array, ''])}>
              <PlusIcon /> 항목 추가
            </button>
          </div>
        ) : (
          <div class="pick-detail muted">리스트를 만들어 주세요.</div>
        )}
      </div>
    </>
  );
}


// --- signals ----------------------------------------------------------------

function SignalTable() {
  const signals = project.value.signals;
  return (
    <>
      <div class="sheet-head">
        <div>
          <h3>신호</h3>
          <p class="sub">신호를 보내고 받는 블록에서 고릅니다. 두 번 눌러 이름을 바꿉니다.</p>
        </div>
        <span class="spacer" />
        <button class="btn primary" onClick={() => addSignal(`신호${signals.length + 1}`)}>
          <PlusIcon /> 신호 추가
        </button>
      </div>
      <div class="rec-list">
        {signals.map((signal) => (
          <div class="rec" key={signal.id}>
            <div class="rec-row">
              <InlineName class="rec-name" value={signal.name} onCommit={(name) => updateSignal(signal.id, { name })} />
              <button class="iconbtn plain danger" title="삭제" aria-label="삭제" onClick={() => removeSignal(signal.id)}>
                <TrashIcon size={14} />
              </button>
            </div>
          </div>
        ))}
        {!signals.length && <div class="rec-empty">아직 없습니다.</div>}
      </div>
    </>
  );
}

// --- tables -----------------------------------------------------------------

function TableEditor() {
  const tables = project.value.tables;
  const picked = useSignal(tables[0]?.id ?? '');
  const current = tables.find((table) => table.id === picked.value) ?? tables[0];

  function editCell(row: number, column: number, value: string) {
    if (!current) return;
    const rows = current.rows.map((cells, index) => (
      index === row ? cells.map((cell, at) => (at === column ? value : cell)) : cells
    ));
    updateTable(current.id, { rows });
  }

  function addRow() {
    if (!current) return;
    updateTable(current.id, { rows: [...current.rows, current.columns.map(() => '')] });
  }

  function addColumn() {
    if (!current) return;
    updateTable(current.id, {
      columns: [...current.columns, `열${current.columns.length + 1}`],
      rows: current.rows.map((cells) => [...cells, '']),
    });
  }

  return (
    <>
      <div class="sheet-head">
        <div>
          <h3>테이블</h3>
          <p class="sub">자료분석 블록이 읽고 쓰는 표입니다. 칸을 눌러 바로 고칩니다.</p>
        </div>
        <span class="spacer" />
        <button
          class="btn primary"
          onClick={() => {
            addTable(`테이블${tables.length + 1}`);
            picked.value = '';
          }}
        >
          <PlusIcon /> 테이블 추가
        </button>
      </div>

      <div class="split">
        <ul class="pick-list">
          {tables.map((table) => (
            <li key={table.id}>
              <button class={`pick ${table.id === current?.id ? 'on' : ''}`} onClick={() => { picked.value = table.id; }}>
                <span class="pick-name">{table.name}</span>
                <span class="pick-count">{table.rows.length}</span>
              </button>
            </li>
          ))}
          {!tables.length && <li class="muted" style="padding:8px 10px">아직 없습니다.</li>}
        </ul>

        {current ? (
          <div class="pick-detail">
            <div class="detail-row">
              <label class="f" style="flex:1">
                <span>테이블 이름</span>
                <input
                  class="input"
                  value={current.name}
                  onInput={(event) => updateTable(current.id, { name: (event.target as HTMLInputElement).value })}
                />
              </label>
              <button class="btn" onClick={addColumn}>＋ 열</button>
              <button class="btn" onClick={addRow}>＋ 행</button>
              <button class="btn ghost danger" title="테이블 삭제" onClick={() => removeTable(current.id)}>
                <TrashIcon size={14} />
              </button>
            </div>

            <div class="grid-scroll">
              <table class="tbl grid">
                <thead>
                  <tr>
                    <th class="corner" />
                    {current.columns.map((column, index) => (
                      <th key={index}>
                        <input
                          class="input"
                          value={column}
                          aria-label={`${index + 1}번째 열 이름`}
                          onInput={(event) => updateTable(current.id, {
                            columns: current.columns.map((name, at) => (
                              at === index ? (event.target as HTMLInputElement).value : name
                            )),
                          })}
                        />
                      </th>
                    ))}
                    <th class="corner">
                      <button
                        class="iconbtn plain"
                        title="마지막 열 삭제"
                        disabled={current.columns.length <= 1}
                        onClick={() => updateTable(current.id, {
                          columns: current.columns.slice(0, -1),
                          rows: current.rows.map((cells) => cells.slice(0, -1)),
                        })}
                      >
                        <TrashIcon size={13} />
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {current.rows.map((cells, row) => (
                    <tr key={row}>
                      <td class="corner">{row + 1}</td>
                      {cells.map((cell, column) => (
                        <td key={column}>
                          <input
                            class="input"
                            value={cell}
                            aria-label={`${row + 1}행 ${column + 1}열`}
                            onInput={(event) => editCell(row, column, (event.target as HTMLInputElement).value)}
                          />
                        </td>
                      ))}
                      <td class="corner">
                        <button
                          class="iconbtn plain"
                          title="이 행 삭제"
                          onClick={() => updateTable(current.id, {
                            rows: current.rows.filter((_, at) => at !== row),
                          })}
                        >
                          <TrashIcon size={13} />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!current.rows.length && (
                    <tr><td class="muted" colSpan={current.columns.length + 2}>행이 없습니다.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div class="pick-detail muted">테이블을 만들어 주세요.</div>
        )}
      </div>
    </>
  );
}

// --- functions --------------------------------------------------------------

function FunctionTable() {
  const functions = project.value.functions;
  const currentObjId = selectedObjectId.value;
  const currentObj = project.value.objects.find((object) => object.id === currentObjId);
  const objectIds = new Set(project.value.objects.map((object) => object.id));
  const globals = functions.filter((definition) => !definition.owner || !objectIds.has(definition.owner));
  const locals = functions.filter((definition) => definition.owner === currentObjId);
  const others = project.value.objects.filter((object) => object.id !== currentObjId
    && functions.some((definition) => definition.owner === object.id));

  const fnRow = (definition: FunctionDef) => (
    <div class="rec" key={definition.id}>
      <div class="rec-row">
        <InlineName
          class="rec-name"
          value={definition.name}
          onCommit={(name) => updateFunction(definition.id, { name })}
        />
        <span class="rec-meta">
          {definition.params.map((param) => `${param.name}${param.kind === 'boolean' ? '?' : ''}`).join(', ') || '매개변수 없음'}
        </span>
        <button
          class="iconbtn plain"
          title="블록 편집"
          aria-label="블록 편집"
          onClick={() => { functionDraft.value = structuredClone(definition); }}
        >
          <PencilIcon size={15} />
        </button>
        <button class="iconbtn plain danger" title="삭제" aria-label="삭제" onClick={() => removeFunction(definition.id)}>
          <TrashIcon size={14} />
        </button>
      </div>
    </div>
  );
  return (
    <>
      <div class="sheet-head">
        <div>
          <h3>함수</h3>
          <p class="sub">모든 오브젝트의 함수 꾸러미에 나타납니다. 두 번 눌러 이름을 바꿉니다.</p>
        </div>
        <span class="spacer" />
        <button
          class="btn primary"
          onClick={() => {
            functionDraft.value = { id: newId('f'), name: `함수${functions.length + 1}`, owner: null, params: [], blocks: null };
          }}
        >
          <PlusIcon /> 함수 만들기
        </button>
        <button
          class="btn"
          disabled={!currentObj}
          title="선택한 오브젝트만 쓰는 함수"
          onClick={() => {
            functionDraft.value = { id: newId('f'), name: '지역 함수', owner: currentObjId, params: [], blocks: null };
          }}
        >
          <PlusIcon /> 지역 함수
        </button>
      </div>
      <div class="rec-list">
        <div class="rec-group">전역 함수 <span class="muted">모든 오브젝트</span></div>
        {globals.map(fnRow)}
        {!globals.length && <div class="rec-empty">아직 없습니다.</div>}

        <div class="rec-group">지역 함수 <span class="muted">{currentObj ? `${currentObj.name} 전용` : '선택된 오브젝트 없음'}</span></div>
        {locals.map(fnRow)}
        {!locals.length && <div class="rec-empty">아직 없습니다.</div>}

        {others.length > 0 && <div class="rec-group">다른 오브젝트의 지역 함수</div>}
        {others.map((owner) => (
          <div key={owner.id} class="rec-owner">
            <div class="rec-owner-head">
              <span>{owner.name}</span>
              <button class="rec-jump" title={`${owner.name} 오브젝트로 가기`} onClick={() => selectObject(owner.id)}>
                바로가기 →
              </button>
            </div>
            {functions.filter((definition) => definition.owner === owner.id).map(fnRow)}
          </div>
        ))}
      </div>
    </>
  );
}
