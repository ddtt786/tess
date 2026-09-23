/** Properties: variables, lists, signals, tables and functions of the project. */
import { useSignal } from '@preact/signals';
import {
  addSignal, addTable, project, removeFunction, removeSignal, removeTable,
  removeVariable, selectedObjectId, updateFunction, updateSignal, updateTable, updateVariable,
} from '../model/store.ts';
import { newId } from '../model/ids.ts';
import type { StorageScope, VariableDef } from '../model/types.ts';
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, TrashIcon } from './icons.tsx';
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

  return (
    <>
      <div class="sheet-head">
        <div>
          <h3>변수</h3>
          <p class="sub">전역 변수와 현재 오브젝트의 지역 변수를 관리합니다.</p>
        </div>
        <span class="spacer" />
        <button class="btn primary" onClick={() => { dialog.value = 'variable'; }}>
          <PlusIcon /> 변수 추가
        </button>
      </div>

      <div class="var-sections" style="display:flex; flex-direction:column; gap:24px;">
        <div>
          <div class="sub-head" style="margin-bottom:8px;">
            <strong style="font-size:13px; color:var(--text);">전역 변수</strong>
            <span class="muted" style="font-size:12px; margin-left:8px;">모든 오브젝트에서 사용 가능</span>
          </div>
          <table class="tbl">
            <thead>
              <tr>
                <th style="width:34%">이름</th>
                <th>처음 값</th>
                <th style="width:20%">저장 방식</th>
                <th style="width:130px" />
              </tr>
            </thead>
            <tbody>
              {globalVars.map((variable) => <GlobalVariableRow key={variable.id} variable={variable} />)}
              {!globalVars.length && <tr><td colSpan={4} class="muted">전역 변수가 없습니다.</td></tr>}
            </tbody>
          </table>
        </div>

        <div>
          <div class="sub-head" style="margin-bottom:8px;">
            <strong style="font-size:13px; color:var(--text);">지역 변수</strong>
            <span class="muted" style="font-size:12px; margin-left:8px;">
              {currentObj ? `${currentObj.name} 오브젝트 전용` : '선택된 오브젝트 없음'}
            </span>
          </div>
          <table class="tbl">
            <thead>
              <tr>
                <th style="width:40%">이름</th>
                <th>처음 값</th>
                <th style="width:130px" />
              </tr>
            </thead>
            <tbody>
              {localVars.map((variable) => <LocalVariableRow key={variable.id} variable={variable} />)}
              {!localVars.length && <tr><td colSpan={3} class="muted">지역 변수가 없습니다.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function GlobalVariableRow({ variable }: { variable: VariableDef }) {
  return (
    <tr>
      <td>
        <input
          class="input"
          value={variable.name}
          aria-label="변수 이름"
          onInput={(event) => updateVariable(variable.id, { name: (event.target as HTMLInputElement).value })}
        />
      </td>
      <td>
        <input
          class="input"
          value={String(variable.value)}
          aria-label="처음 값"
          onInput={(event) => updateVariable(variable.id, { value: (event.target as HTMLInputElement).value })}
        />
      </td>
      <td>
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
      </td>
      <td>
        <div class="actions">
          <button class="btn ghost" onClick={() => updateVariable(variable.id, { visible: !variable.visible })}>
            {variable.visible ? '보임' : '숨김'}
          </button>
          <button class="btn ghost danger" title="삭제" onClick={() => removeVariable(variable.id)}>
            <TrashIcon size={14} />
          </button>
        </div>
      </td>
    </tr>
  );
}

function LocalVariableRow({ variable }: { variable: VariableDef }) {
  return (
    <tr>
      <td>
        <input
          class="input"
          value={variable.name}
          aria-label="변수 이름"
          onInput={(event) => updateVariable(variable.id, { name: (event.target as HTMLInputElement).value })}
        />
      </td>
      <td>
        <input
          class="input"
          value={String(variable.value)}
          aria-label="처음 값"
          onInput={(event) => updateVariable(variable.id, { value: (event.target as HTMLInputElement).value })}
        />
      </td>
      <td>
        <div class="actions">
          <button class="btn ghost" onClick={() => updateVariable(variable.id, { visible: !variable.visible })}>
            {variable.visible ? '보임' : '숨김'}
          </button>
          <button class="btn ghost danger" title="삭제" onClick={() => removeVariable(variable.id)}>
            <TrashIcon size={14} />
          </button>
        </div>
      </td>
    </tr>
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

  const current = visibleLists.find((list) => list.id === pickedList.value) ?? visibleLists[visibleLists.length - 1];

  function setItems(items: Array<string | number>) {
    if (current) updateVariable(current.id, { array: items });
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
              <button class="btn ghost danger" title="리스트 삭제" onClick={() => removeVariable(current.id)}>
                <TrashIcon size={14} /> 삭제
              </button>
            </div>

            <ol class="item-list">
              {current.array.map((item, index) => (
                <li key={index}>
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
                    title="위로"
                    disabled={index === 0}
                    onClick={() => setItems(swap(current.array, index, index - 1))}
                  >
                    <ArrowUpIcon size={14} />
                  </button>
                  <button
                    class="iconbtn plain"
                    title="아래로"
                    disabled={index === current.array.length - 1}
                    onClick={() => setItems(swap(current.array, index, index + 1))}
                  >
                    <ArrowDownIcon size={14} />
                  </button>
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

function swap(items: Array<string | number>, from: number, to: number): Array<string | number> {
  const next = [...items];
  const moved = next[from]!;
  next[from] = next[to]!;
  next[to] = moved;
  return next;
}

// --- signals ----------------------------------------------------------------

function SignalTable() {
  const signals = project.value.signals;
  return (
    <>
      <div class="sheet-head">
        <div>
          <h3>신호</h3>
          <p class="sub">신호를 보내고 받는 블록에서 고를 수 있습니다. 이름을 직접 수정할 수 있습니다.</p>
        </div>
        <span class="spacer" />
        <button class="btn primary" onClick={() => addSignal(`신호${signals.length + 1}`)}>
          <PlusIcon /> 신호 추가
        </button>
      </div>
      <table class="tbl">
        <thead><tr><th>이름</th><th style="width:80px" /></tr></thead>
        <tbody>
          {signals.map((signal) => (
            <tr key={signal.id}>
              <td>
                <input
                  class="input"
                  value={signal.name}
                  aria-label="신호 이름"
                  onInput={(event) => updateSignal(signal.id, { name: (event.target as HTMLInputElement).value })}
                />
              </td>
              <td>
                <div class="actions">
                  <button class="btn ghost danger" title="삭제" onClick={() => removeSignal(signal.id)}>
                    <TrashIcon size={14} />
                  </button>
                </div>
              </td>
            </tr>
          ))}
          {!signals.length && <tr><td colSpan={2} class="muted">아직 없습니다.</td></tr>}
        </tbody>
      </table>
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
  return (
    <>
      <div class="sheet-head">
        <div>
          <h3>함수</h3>
          <p class="sub">매개변수를 붙여 만들면 모든 오브젝트의 함수 꾸러미에 나타납니다. 이름을 직접 수정할 수 있습니다.</p>
        </div>
        <span class="spacer" />
        <button
          class="btn primary"
          onClick={() => {
            functionDraft.value = { id: newId('f'), name: `함수${functions.length + 1}`, params: [], blocks: null };
          }}
        >
          <PlusIcon /> 함수 만들기
        </button>
      </div>
      <table class="tbl">
        <thead><tr><th style="width:32%">이름</th><th>매개변수</th><th style="width:130px" /></tr></thead>
        <tbody>
          {functions.map((definition) => (
            <tr key={definition.id}>
              <td>
                <input
                  class="input"
                  value={definition.name}
                  aria-label="함수 이름"
                  onInput={(event) => updateFunction(definition.id, { name: (event.target as HTMLInputElement).value })}
                />
              </td>
              <td class="muted">
                {definition.params.map((param) => `${param.name}${param.kind === 'boolean' ? '?' : ''}`).join(', ') || '없음'}
              </td>
              <td>
                <div class="actions">
                  <button class="btn ghost" onClick={() => { functionDraft.value = structuredClone(definition); }}>블록 편집</button>
                  <button class="btn ghost danger" title="삭제" onClick={() => removeFunction(definition.id)}>
                    <TrashIcon size={14} />
                  </button>
                </div>
              </td>
            </tr>
          ))}
          {!functions.length && <tr><td colSpan={3} class="muted">아직 없습니다.</td></tr>}
        </tbody>
      </table>
    </>
  );
}
