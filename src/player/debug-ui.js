// 실행 페이지의 디버그 패널 UI. arrow-js 로 그리고, 서버가 /debug-ui.js 로 내보낸다.
import { reactive, html } from '/arrow/index.mjs';

const TABS = [
  { id: 'run', label: '실행' },
  { id: 'data', label: '자료' },
  { id: 'objects', label: '오브젝트' },
  { id: 'errors', label: '오류' },
];
const STATE_TEXT = { run: '실행 중', pause: '일시정지됨', stop: '멈춰 있음' };
const DEFAULT_SECTION_HEIGHT = 200;

// 이 크기 아래로 끌면 창이 딱 붙어서 0 이 되고, 다시 이만큼 끌어내면 딱 하고 펴진다.
// 접혀도 손잡이는 있던 자리에 그대로 남아서 다시 끌 수 있다.
const STICKY = 56;
const sticky = (size) => (size < STICKY ? 0 : size);

// 펼친 리스트·함수 코드가 패널을 다 잡아먹지 않게 막는 높이. 항목이 100개여도 여기서 스크롤된다.
const state = reactive({
  open: false,
  tab: 'run',
  errors: [],
  runState: '',
  env: { boost: '', device: '', touch: '' },
  scenes: [],
  currentId: '',
  currentName: '',
  variables: [],
  messages: [],
  functions: [],
  expanded: '',   // 펼쳐 둔 리스트/함수의 키 ('list:<id>' · 'func:<id>')
  editing: '',    // 지금 고쳐 쓰고 있는 칸의 키
  // 섹션 높이. arrow 가 변화를 따라가려면 키가 미리 있어야 한다. 0 은 접힌 상태다.
  heights: {
    'run-control': 200, 'data-vars': 200, 'data-signals': 200,
    'objects-tree': 200, 'objects-info': 200,
  },
  tick: 0,        // 반응형 밖 데이터(블록 트리·변수 값)를 다시 그리게 하는 카운터
});

// 반응형 프록시에 넣으면 느려지는 큰 데이터
let project = null;
const blockOwner = new Map();
const blockById = new Map();
const functionContentById = new Map();
let currentThreads = [];
let highlighted = [];

// --- 패널 열고 닫기 ---------------------------------------------------------
const panel = document.getElementById('debug-panel');

const syncPanelWidth = () => {
  const width = state.open ? panel.getBoundingClientRect().width : 0;
  document.documentElement.style.setProperty('--debug-panel-width', width + 'px');
  window.tessLayoutCanvas();
};
const setOpen = (open, tab) => {
  state.open = open;
  if (tab) state.tab = tab;
  panel.classList.toggle('open', open);
  panel.setAttribute('aria-hidden', open ? 'false' : 'true');
  syncPanelWidth();
};
const openPanel = (tab) => {
  // 딱 붙여 접어 둔 상태로 다시 열면 아무것도 안 보이므로 폭을 되살린다
  if (panel.style.width === '0px') panel.style.width = '';
  setOpen(true, tab);
};
const closePanel = () => setOpen(false);

// --- 실행 제어 --------------------------------------------------------------
const engine = () => (window.Entry && Entry.engine) || null;
const engineState = () => {
  const e = engine();
  if (!e || typeof e.isState !== 'function') return '';
  for (const s of ['run', 'pause', 'stop']) {
    try { if (e.isState(s)) return s; } catch (error) { /* 다음 상태를 본다 */ }
  }
  return '';
};

const control = (action) => {
  try { action(engine()); } catch (error) { window.tessReportError('실행 제어', error); }
  state.runState = engineState();
  setTimeout(() => { state.runState = engineState(); }, 60);
};
const doRun = () => control((e) => {
  if (!e) return;
  if (engineState() === 'pause') e.togglePause(); else e.toggleRun();
});
const doPause = () => control((e) => e && e.togglePause());
const doStop = () => control((e) => e && e.toggleStop());

// --- 실행 환경 흉내내기 -------------------------------------------------------
// 브라우저에 직접 묻는 판단 블록들이라, func 을 감싸 패널에서 고른 값을 돌려준다.
const choice = (value) => (value === '' ? null : value === 'true');

window.tessPatchEnvironmentBlocks = function patchEnvironmentBlocks() {
  const blocks = window.Entry && Entry.block;
  if (!blocks) return;
  const wrap = (type, forced) => {
    const spec = blocks[type];
    if (!spec || typeof spec.func !== 'function' || spec.tessWrapped) return;
    const original = spec.func;
    spec.func = function (...args) {
      const value = forced(args);
      return value === null ? original.apply(this, args) : value;
    };
    spec.tessWrapped = true;
  };
  wrap('is_boost_mode', () => choice(state.env.boost));
  wrap('is_touch_supported', () => choice(state.env.touch));
  wrap('is_current_device_type', (args) => {
    if (state.env.device === '') return null;
    try { return args[1].getField('DEVICE', args[1]) === state.env.device; } catch (e) { return null; }
  });
};

// --- 자료 -------------------------------------------------------------------
const preview = (value) => {
  if (value === null || value === undefined) return '(없음)';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > 80 ? text.slice(0, 80) + '…' : text;
};

const container = () => (window.Entry && Entry.variableContainer) || null;
const liveVariable = (id) => {
  const box = container();
  try { return box && box.getVariable ? box.getVariable(id) : null; } catch (e) { return null; }
};
const liveList = (id) => {
  const box = container();
  try { return box && box.getList ? box.getList(id) : null; } catch (e) { return null; }
};

/** 리스트 항목들을 [{data}] 모양 그대로. 실행 전이면 project.json 의 초기값 */
const listArray = (entry) => {
  const list = liveList(entry.id);
  try {
    if (list && typeof list.getArray === 'function') return list.getArray();
  } catch (error) { /* 실행기에서 못 읽으면 초기값을 보여 준다 */ }
  return entry.array || [];
};

/** 실행 중이면 지금 값을, 아니면 project.json 의 초기값을 돌려준다 */
const rawValue = (entry) => {
  const variable = liveVariable(entry.id);
  try {
    if (variable && typeof variable.getValue === 'function') return variable.getValue();
  } catch (error) { /* 아래에서 초기값을 쓴다 */ }
  return entry.value;
};

const liveValue = (entry) => {
  if (entry.variableType === 'list') {
    const array = listArray(entry);
    return '[' + array.length + '개] ' + preview(array.map((item) => item && item.data));
  }
  return preview(rawValue(entry));
};

/** 엔트리 변수는 숫자도 글자도 담는다. 숫자로 읽히면 숫자로 넣어야 계산 블록이 제대로 돈다. */
const coerce = (text) => {
  const trimmed = String(text).trim();
  if (trimmed === '' || !Number.isFinite(Number(trimmed))) return text;
  return Number(trimmed);
};

const failed = (what, error) => window.tessReportError(what, error);

const setVariable = (id, text) => {
  try {
    const variable = liveVariable(id);
    if (variable && typeof variable.setValue === 'function') variable.setValue(coerce(text));
  } catch (error) { failed('변수 값 바꾸기', error); }
  state.tick += 1;
};

const setListItem = (id, index, text) => {
  try {
    const list = liveList(id);
    // 엔트리 리스트 API 는 1 부터 센다
    if (list && typeof list.replaceValue === 'function') list.replaceValue(index + 1, coerce(text));
  } catch (error) { failed('리스트 항목 바꾸기', error); }
  state.tick += 1;
};

const addListItem = (id) => {
  try {
    const list = liveList(id);
    if (list && typeof list.appendValue === 'function') list.appendValue('');
  } catch (error) { failed('리스트 항목 넣기', error); }
  state.tick += 1;
};

/** 무대에 값이 보이는지 — 변수·리스트 모두 같은 API 를 쓴다 */
const liveEntryOf = (entry) => (entry.variableType === 'list' ? liveList(entry.id) : liveVariable(entry.id));

const entryVisible = (entry) => {
  const live = liveEntryOf(entry);
  try {
    if (live && typeof live.isVisible === 'function') return live.isVisible();
  } catch (error) { /* 실행기가 아직 없으면 선언된 값을 쓴다 */ }
  return Boolean(entry.visible);
};

const setEntryVisible = (entry, visible) => {
  const live = liveEntryOf(entry);
  try {
    if (live && typeof live.setVisible === 'function') live.setVisible(Boolean(visible));
  } catch (error) { failed('변수 보이기 바꾸기', error); }
  state.tick += 1;
};

const removeListItem = (id, index) => {
  try {
    const list = liveList(id);
    if (list && typeof list.deleteValue === 'function') list.deleteValue(index + 1);
  } catch (error) { failed('리스트 항목 지우기', error); }
  state.tick += 1;
};

const sendSignal = (id) => {
  try { Entry.engine.fireEvent('when_message_cast', id); } catch (error) {
    window.tessReportError('신호 보내기', error);
  }
};

/** 함수 머리 사슬에서 이름·인자 개수·종류를 읽는다 */
const describeFunction = (fn) => {
  let name = fn.id;
  let params = 0;
  let kind = '일반 함수';
  try {
    const create = JSON.parse(fn.content || '[]')[0][0];
    if (create && create.type === 'function_create_value') kind = '값 함수';
    let node = create && create.params && create.params[0];
    const labels = [];
    while (node && typeof node === 'object') {
      if (node.type === 'function_field_label') labels.push(String(node.params[0] ?? ''));
      else if (node.type === 'function_field_string' || node.type === 'function_field_boolean') params += 1;
      else break;
      node = node.params[1];
    }
    if (labels.length) name = labels.join(' … ');
  } catch (error) { /* 못 읽으면 id 를 보여 준다 */ }
  return { id: fn.id, name, params, kind };
};

// --- 고쳐 쓰기 칸 -------------------------------------------------------------
// 값을 늘 <input> 으로 두면 0.4초마다 도는 새로고침이 타이핑을 덮어써 버린다.
// 그래서 평소엔 글자만 보여 주고, 누른 칸 하나만 잠깐 입력칸으로 바꾼다.
const beginEdit = (key, current) => {
  state.editing = key;
  requestAnimationFrame(() => {
    const input = panel.querySelector('.debug-edit-input');
    if (!input) return;
    // arrow 가 앞서 고치던 칸의 <input> 을 그대로 다시 쓸 수 있는데, 사람이 한 번
    // 건드린 입력칸은 value 속성을 다시 써도 화면 값이 안 따라온다. 여기서 직접 넣는다.
    input.value = String(current ?? '');
    input.focus();
    input.select();
  });
};

// getValue 는 값이 아니라 함수로 받는다 — arrow 는 키가 같은 줄의 DOM 을 다시 쓰고
// 그 안에서는 함수로 넣은 것만 다시 평가하므로, 값을 미리 꺼내 두면 그 줄만 얼어붙는다.
const editable = (key, getValue, commit) => () => {
  state.tick;
  const value = getValue();
  if (state.editing !== key) {
    // 빈 값도 눌러서 고칠 수 있어야 하므로 자리를 채워 둔다 (글자가 없으면 폭이 0 이다)
    const text = preview(value);
    return html`<button type="button" title="눌러서 고치기"
      class="${'val debug-edit' + (text === '' ? ' empty' : '')}"
      @click="${() => beginEdit(key, value)}">${text === '' ? '(빈 값)' : text}</button>`;
  }
  // Enter 로 끝내면 입력칸이 사라지면서 blur 까지 이어 나므로 한 번만 반영한다
  let settled = false;
  const done = (event) => {
    if (settled) return;
    settled = true;
    state.editing = '';
    commit(event.target.value);
  };
  return html`<input class="val debug-edit-input" type="text" value="${String(value ?? '')}"
    @blur="${done}"
    @keydown="${(event) => {
    if (event.key === 'Enter') done(event);
    if (event.key === 'Escape') { settled = true; state.editing = ''; }
  }}">`;
};

/**
 * 골라 쓰는 칸. 목록도 지금 고른 값도 함수로 받는다 — 줄 DOM 은 다시 쓰이므로
 * 만들 때 값을 붙잡아 두면 오브젝트를 바꿔도 옛 목록이 그대로 남는다.
 * `value` 는 arrow 가 속성이 아니라 프로퍼티로 넣어 주므로(setAttr) 실제로 선택이
 * 따라 움직인다 — 작품이 실행 중에 모양을 바꿔도 여기에 그대로 비친다.
 */
const chooser = (getOptions, getValue, commit) => html`
  <select class="val debug-select" value="${() => { state.tick; return String(getValue()); }}"
    @change="${(event) => commit(event.target.value)}">
    ${() => {
    state.tick;
    // <option> 안에는 반응형 표현식(함수)을 두지 않는다. 목록이 통째로 갈릴 때
    // (오브젝트를 바꾸면 모양 목록이 달라진다) arrow 가 그 조각들을 떼어내는데,
    // 그 안에 큐로 올라간 갱신이 남아 있으면 이미 반납된 자리를 불러 터진다
    // (`expressionPool[effect] is not a function`). `selected` 는 함수가 아니라
    // 지금 값으로 계산해 둔 상수라서 처음 그릴 때의 선택만 정하고, 그 뒤로 값이
    // 바뀌는 것은 위의 `value` 가 프로퍼티로 직접 넣어 준다.
    const current = String(getValue());
    return getOptions().map((option) => html`<option value="${option.value}"
        selected="${option.value === current}">${option.label}</option>`.key(option.value));
  }}
  </select>`;

/** 켜고 끄는 칸 */
const toggle = (getValue, commit, labels) => () => {
  state.tick;
  const on = Boolean(getValue());
  return html`<button type="button" class="${'val debug-toggle' + (on ? ' on' : '')}"
    @click="${() => commit(!on)}">${on ? labels[0] : labels[1]}</button>`;
};

// --- 블록 트리 --------------------------------------------------------------
const blockLabel = (block) => {
  const params = (block.params || [])
    .filter((p) => p !== null && p !== undefined && typeof p !== 'object')
    .map((p) => JSON.stringify(p));
  return block.type + (params.length ? ' (' + params.join(', ') + ')' : '');
};

const blockClass = (block) => {
  const at = highlighted.indexOf(block.id);
  if (at === 0) return 'block-highlight';
  return at > 0 ? 'block-highlight-child' : '';
};

const blockNode = (block) => html`
  <li data-block-id="${block.id}" class="${blockClass(block)}">
    <span class="block-type">${blockLabel(block)}</span>
    ${(block.params || [])
    .filter((param) => param && typeof param === 'object' && param.type)
    .map((param, i) => html`<ul class="block-param">${blockNode(param)}</ul>`.key('p' + i))}
    ${(block.statements || [])
    .filter((branch) => Array.isArray(branch) && branch.length > 0)
    .map((branch, i) => html`
        <ul class="block-body">${branch.map((child, j) => blockNode(child).key(j))}</ul>
      `.key('s' + i))}
  </li>
`.key(block.id);

const showObject = (object) => {
  state.currentId = object.id;
  state.currentName = object.name;
  try {
    currentThreads = JSON.parse(object.script);
  } catch (error) {
    currentThreads = [];
  }
  state.tick += 1;
};

/**
 * 그 장면으로 바로 넘어간다 — 엔트리의 "장면 시작하기" 와 같은 길이다.
 * 뒤쪽 장면을 고쳐 보려고 앞 장면을 처음부터 다시 깨는 수고를 덜어 준다.
 */
const goToScene = (sceneId) => {
  try {
    const scene = Entry.scene.getSceneById(sceneId);
    if (scene) Entry.scene.selectScene(scene);
  } catch (error) { failed('장면 바로가기', error); }
  state.tick += 1;
};

/** 이름을 눌러 펼치고 접는다. 같은 것을 다시 누르면 접힌다. */
const toggleExpanded = (key) => { state.expanded = state.expanded === key ? '' : key; };

// --- 오브젝트 정보 -----------------------------------------------------------
const liveEntity = (objectId) => {
  try {
    const object = window.Entry && Entry.container && Entry.container.getObject
      ? Entry.container.getObject(objectId)
      : null;
    return object && object.entity ? { object, entity: object.entity } : null;
  } catch (error) { return null; }
};

const round = (value) => (typeof value === 'number' ? Math.round(value * 100) / 100 : value);
const call = (target, name, fallback) => {
  try {
    return target && typeof target[name] === 'function' ? round(target[name]()) : fallback;
  } catch (error) { return fallback; }
};

const setEntityNumber = (name) => (objectId, text) => {
  const live = liveEntity(objectId);
  const value = Number(String(text).trim());
  if (!live || !Number.isFinite(value)) { state.tick += 1; return; }
  try {
    if (typeof live.entity[name] === 'function') live.entity[name](value);
    if (window.Entry) Entry.requestUpdate = true;
  } catch (error) { failed('오브젝트 값 바꾸기', error); }
  state.tick += 1;
};

// 오브젝트 정보 칸. 숫자 칸은 눌러서 바로 고칠 수 있다 (엔트리 편집기의 그 칸들과 같다).
const ENTITY_FIELDS = [
  { key: 'x', label: 'x 좌표', get: (e) => call(e, 'getX', 0), set: setEntityNumber('setX') },
  { key: 'y', label: 'y 좌표', get: (e) => call(e, 'getY', 0), set: setEntityNumber('setY') },
  { key: 'size', label: '크기', get: (e) => call(e, 'getSize', 100), set: setEntityNumber('setSize') },
  { key: 'direction', label: '방향', get: (e) => call(e, 'getRotation', 0), set: setEntityNumber('setRotation') },
  { key: 'way', label: '이동 방향', get: (e) => call(e, 'getDirection', 90), set: setEntityNumber('setDirection') },
  { key: 'scaleX', label: '가로 배율', get: (e) => call(e, 'getScaleX', 1) },
  { key: 'scaleY', label: '세로 배율', get: (e) => call(e, 'getScaleY', 1) },
];

const pictureInfo = (live) => {
  const pictures = (live.object && live.object.pictures) || [];
  const current = live.entity.picture;
  if (!current) return { name: '(없음)', index: '-' };
  const at = pictures.findIndex((picture) => picture.id === current.id);
  return { name: current.name || current.id, index: at < 0 ? '-' : String(at + 1) + ' / ' + pictures.length };
};

const setPicture = (objectId, pictureId) => {
  const live = liveEntity(objectId);
  try {
    // 엔트리의 "모양으로 바꾸기" 와 같은 길이다 (entryjs block_looks.js)
    const picture = live && live.object.getPicture ? live.object.getPicture(pictureId) : null;
    if (picture) live.entity.setImage(picture);
    if (window.Entry) Entry.requestUpdate = true;
  } catch (error) { failed('모양 바꾸기', error); }
  state.tick += 1;
};

const setRotateMethod = (objectId, method) => {
  const live = liveEntity(objectId);
  try {
    if (live && typeof live.object.setRotateMethod === 'function') live.object.setRotateMethod(method);
    if (window.Entry) Entry.requestUpdate = true;
  } catch (error) { failed('회전 방식 바꾸기', error); }
  state.tick += 1;
};

const setEntityVisible = (objectId, visible) => {
  const live = liveEntity(objectId);
  try {
    if (live && typeof live.entity.setVisible === 'function') live.entity.setVisible(Boolean(visible));
    if (window.Entry) Entry.requestUpdate = true;
  } catch (error) { failed('보이기 바꾸기', error); }
  state.tick += 1;
};

const setEntityText = (objectId, text) => {
  const live = liveEntity(objectId);
  try {
    if (live && typeof live.entity.setText === 'function') live.entity.setText(String(text));
    if (window.Entry) Entry.requestUpdate = true;
  } catch (error) { failed('글 내용 바꾸기', error); }
  state.tick += 1;
};

const ROTATE_METHODS = [
  { value: 'free', label: '자유 회전' },
  { value: 'vertical', label: '좌우 회전' },
  { value: 'none', label: '회전 안 함' },
];

/**
 * body 는 함수로 받는다 — 키가 같은 줄은 DOM 이 다시 쓰이고, 그 안에서 함수로 넣은
 * 것만 다시 평가되기 때문이다 (editable 의 같은 주석 참고).
 *
 * 키에는 오브젝트를 넣지 않는다. 오브젝트를 바꿀 때마다 열두 줄의 키가 한꺼번에
 * 달라지면 arrow 가 그 줄들의 표현식 자리를 반납하는데(releaseExpressions), 같은
 * 순간 state.tick 이 큐에 올려 둔 그 줄들의 갱신이 뒤늦게 돌면서 이미 반납된 자리를
 * 부른다 — `expressionPool[effect] is not a function` 이 그것이다. 줄은 그대로 두고
 * 안쪽 함수들이 그때그때 지금 오브젝트를 찾아보게 한다.
 */
const infoRow = (label, body, visible) => html`
  <li hidden="${() => { state.tick; return visible ? !visible() : false; }}"
    ><span class="key">${label}</span>${body}</li>`.key(label);

/** 지금 고른 오브젝트의 실행기 쪽 짝. 줄마다 그때그때 찾는다 (infoRow 주석 참고) */
const currentLive = () => (state.currentId ? liveEntity(state.currentId) : null);
const currentEntity = (get, fallback = '') => {
  const live = currentLive();
  return live ? get(live) : fallback;
};

/**
 * 목록은 배열만 돌려준다 (varRows 의 주석 참고).
 *
 * 그리고 **줄 구성은 언제나 똑같다.** 오브젝트를 바꿀 때 줄이 생기거나 없어지면
 * arrow 가 그 줄의 표현식 자리를 반납하는데(releaseExpressions), 이미 큐에 올라가
 * 있던 그 줄의 갱신이 뒤늦게 돌면서 반납된 자리를 불러 터진다
 * (`expressionPool[effect] is not a function`). arrow 1.0.6 은 조각을 떼어낼 때
 * 큐에 남은 갱신을 걷어내지 않는다. 그래서 안내 문구도, 글상자 전용 줄도 줄을
 * 없애는 대신 `hidden` 으로만 감춘다 — 속성만 바뀌지 구조는 그대로다.
 */
const objectInfoRows = () => {
  state.tick;
  state.editing;

  const shown = (get) => () => { state.tick; return html`<span class="val">${String(get())}</span>`; };
  const ready = () => Boolean(currentLive());
  const isText = () => currentEntity((l) => l.entity.text !== undefined, false);
  const rows = [
    infoRow('', () => html`<span class="debug-empty">${() => (state.currentId
      ? '실행기가 이 오브젝트를 아직 만들지 않았습니다. 한 번 실행해 보세요.'
      : '위 목록에서 오브젝트를 고르세요.')}</span>`, () => !ready()),
  ];
  for (const field of ENTITY_FIELDS) {
    rows.push(infoRow(field.label, field.set
      ? editable('entity:' + field.key, () => currentEntity((l) => field.get(l.entity)),
        (text) => field.set(state.currentId, text))
      : shown(() => currentEntity((l) => field.get(l.entity))), ready));
  }

  const costumes = () => currentEntity(
    (l) => ((l.object && l.object.pictures) || []).map((p) => ({ value: p.id, label: p.name || p.id })),
    [],
  );

  rows.push(infoRow('모양', chooser(costumes,
    () => currentEntity((l) => (l.entity.picture ? l.entity.picture.id : '')),
    (id) => setPicture(state.currentId, id)), () => ready() && !isText()));
  rows.push(infoRow('모양 번호', shown(() => currentEntity((l) => pictureInfo(l).index)),
    () => ready() && !isText()));
  rows.push(infoRow('보이기', toggle(() => currentEntity((l) => call(l.entity, 'getVisible', true), true),
    (next) => setEntityVisible(state.currentId, next), ['보임', '숨김']), ready));
  rows.push(infoRow('회전 방식', chooser(() => ROTATE_METHODS,
    () => currentEntity((l) => (l.object && l.object.rotateMethod) || 'free', 'free'),
    (method) => setRotateMethod(state.currentId, method)), () => ready() && !isText()));
  // 글상자는 글 내용도 여기서 바로 고친다
  rows.push(infoRow('글 내용', editable('entity:text',
    () => currentEntity((l) => l.entity.text),
    (text) => setEntityText(state.currentId, text)), () => ready() && isText()));
  return rows;
};

// --- 섹션 (위아래 크기 조절 · 딱 붙이기) ------------------------------------------
const startVerticalResize = (event, id) => {
  const section = event.currentTarget.closest('.debug-section');
  const startY = event.clientY;
  const startHeight = section.getBoundingClientRect().height;
  event.preventDefault();
  document.body.style.userSelect = 'none';

  const move = (e) => { state.heights[id] = sticky(startHeight + (e.clientY - startY)); };
  const up = () => {
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
    document.body.style.userSelect = '';
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
};

/** 마지막을 뺀 섹션마다 아래쪽에 높이 조절 손잡이를 붙인다 */
const sections = (list) => list.map((section, index) => {
  const last = index === list.length - 1;
  const height = () => {
    if (last) return '';
    return 'height:' + (state.heights[section.id] ?? DEFAULT_SECTION_HEIGHT) + 'px';
  };
  const classes = () => {
    let name = 'debug-section';
    if (last) name += ' debug-section-last';
    else if ((state.heights[section.id] ?? DEFAULT_SECTION_HEIGHT) === 0) name += ' collapsed';
    return name;
  };
  return html`
    <section class="${classes}" style="${height}">
      <h3>${section.title}</h3>
      <div class="debug-section-body">${section.body}</div>
      ${last ? '' : html`<div class="debug-vresize" title="드래그해서 높이 조절 (끝까지 줄이면 접힙니다)"
        @mousedown="${(e) => startVerticalResize(e, section.id)}"></div>`}
    </section>
  `.key(section.id);
});

const empty = (text) => html`<p class="debug-empty">${text}</p>`;

// --- 탭 내용 ----------------------------------------------------------------
const runTab = () => sections([
  {
    id: 'run-control',
    title: '실행 제어',
    body: html`
      <p class="${() => 'debug-run-state' + (state.runState ? ' state-' + state.runState : '')}">
        <span class="dot"></span>${() => STATE_TEXT[state.runState] || '실행기를 기다리는 중…'}
      </p>
      <div class="debug-run-buttons">
        <button type="button" id="run-btn" @click="${doRun}"
          disabled="${() => !state.runState || state.runState === 'run'}">시작하기</button>
        <button type="button" id="pause-btn" @click="${doPause}"
          disabled="${() => !state.runState || state.runState === 'stop'}">${() => (state.runState === 'pause' ? '이어서 하기' : '일시정지')}</button>
        <button type="button" id="stop-btn" @click="${doStop}"
          disabled="${() => !state.runState || state.runState === 'stop'}">정지하기</button>
      </div>
      <p class="debug-note">정지한 뒤에도 <b>시작하기</b> 로 처음부터 다시 실행할 수 있습니다.</p>
      <p class="debug-note">Ctrl+Shift 를 누른 채 실행 화면의 오브젝트를 누르면 오브젝트 탭에서 그 오브젝트가 열립니다.</p>
    `,
  },
  {
    id: 'run-env',
    title: '실행 환경 흉내내기',
    body: html`
      <div class="debug-field">
        <label for="env-boost">부스트 모드</label>
        <select id="env-boost" @change="${(e) => { state.env.boost = e.target.value; }}">
          <option value="">실제 값 그대로</option>
          <option value="true">켜짐 (참)</option>
          <option value="false">꺼짐 (거짓)</option>
        </select>
      </div>
      <div class="debug-field">
        <label for="env-device">기기 종류</label>
        <select id="env-device" @change="${(e) => { state.env.device = e.target.value; }}">
          <option value="">실제 값 그대로</option>
          <option value="desktop">컴퓨터</option>
          <option value="tablet">태블릿</option>
          <option value="mobile">스마트폰</option>
        </select>
      </div>
      <div class="debug-field">
        <label for="env-touch">터치 지원</label>
        <select id="env-touch" @change="${(e) => { state.env.touch = e.target.value; }}">
          <option value="">실제 값 그대로</option>
          <option value="true">지원함 (참)</option>
          <option value="false">지원 안 함 (거짓)</option>
        </select>
      </div>
    `,
  },
]);

/** 펼침 단추의 클래스 — 함수로 넘겨야 줄이 다시 쓰일 때도 화살표가 따라 바뀐다 */
const expandClass = (key) => () => 'key debug-expand' + (state.expanded === key ? ' open' : '');

/** 리스트 한 줄 — 이름을 누르면 항목이 펼쳐지고, 다시 누르면 접힌다 */
const listRow = (entry) => {
  const key = 'list:' + entry.id;
  return html`
    <li class="debug-list-head">
      <button type="button" class="${expandClass(key)}"
        @click="${() => toggleExpanded(key)}">${entry.name}</button>
      <span class="tag">${entry.scope} · ${entry.kind}</span>
      <span class="val">${() => { state.tick; return liveValue(entry.source); }}</span>
      ${visibleToggle(entry)}
    </li>`.key(entry.id);
};

/**
 * 펼친 리스트 항목들 — 이름 줄 안이 아니라 그 다음 줄로 따로 낸다.
 *
 * arrow 는 키가 같은 줄의 DOM 을 다시 쓰면서 새로 넘긴 함수를 다시 묶지 않는다.
 * 그래서 이름 줄 안에 넣어 두면 처음 묶인 함수가 그대로 남아, 항목을 넣거나 지워도
 * 화면이 안 바뀐다. 목록의 한 줄로 따로 내고 키에 항목 수를 넣으면, 개수가 달라질
 * 때 arrow 가 키가 다른 새 줄로 보고 제대로 다시 만든다.
 */
const listItemsRow = (entry) => {
  const key = 'list:' + entry.id;
  const array = listArray(entry.source);
  return html`
    <li class="debug-items-row">
      <div class="debug-list-items">
        <button type="button" class="debug-mini-btn debug-add-btn"
          @click="${() => addListItem(entry.id)}">항목 추가</button>
        ${array.length === 0
    ? html`<p class="debug-empty">비어 있습니다.</p>`
    : html`<ol class="debug-list-ol">${array.map((item, index) => html`
            <li>
              <span class="debug-list-index">${index + 1}</span>
              ${editable(key + ':' + index, () => (listArray(entry.source)[index] || {}).data,
      (text) => setListItem(entry.id, index, text))}
              <button type="button" class="debug-mini-btn" title="이 항목 지우기"
                @click="${() => removeListItem(entry.id, index)}">−</button>
            </li>`.key(index))}</ol>`}
      </div>
    </li>`.key(entry.id + ':items:' + array.length);
};

/** 무대에 값을 띄울지 말지 (엔트리의 "변수 보이기/숨기기" 와 같은 것) */
const visibleToggle = (entry) => toggle(
  () => entryVisible(entry.source),
  (next) => setEntryVisible(entry.source, next),
  ['보임', '숨김'],
);

const variableRow = (entry) => html`
  <li>
    <span class="key">${entry.name}</span>
    <span class="tag">${entry.scope} · ${entry.kind}</span>
    ${editable('var:' + entry.id, () => rawValue(entry.source), (text) => setVariable(entry.id, text))}
    ${visibleToggle(entry)}
  </li>`.key(entry.id);

/** 함수 한 줄 — 이름을 누르면 그 함수의 블록이 펼쳐진다 */
const functionRow = (fn) => {
  const key = 'func:' + fn.id;
  return html`
    <li class="debug-list-head">
      <button type="button" class="${expandClass(key)}"
        @click="${() => toggleExpanded(key)}">${fn.name}</button>
      <span class="tag">${fn.params}개 인자</span>
      <span class="val">${fn.kind}</span>
    </li>`.key(fn.id);
};

/** 펼친 함수 코드 — 리스트 항목과 같은 이유로 이름 줄 다음에 따로 낸다 */
const functionCodeRow = (fn) => {
  const content = functionContentById.get(fn.id);
  return html`
    <li class="debug-items-row">
      <div class="debug-list-items debug-func-code">
        ${!content || content.length === 0
    ? html`<p class="debug-empty">블록을 읽지 못했습니다.</p>`
    : html`<ul>${content.map((block) => blockNode(block))}</ul>`}
      </div>
    </li>`.key(fn.id + ':code');
};

const emptyRow = (text) => html`<li class="debug-empty">${text}</li>`.key('empty');

/**
 * 목록은 "배열을 그대로 돌려주는" 꼴로만 만든다.
 *
 * arrow 1.0.6 은 `${() => 배열}` 은 키를 보고 제대로 다시 맞춰 주지만,
 * `${() => html`<ul>${배열}</ul>`}` 처럼 템플릿으로 한 번 감싸면 처음 한 번만 그리고
 * 그 뒤로는 항목이 늘거나 줄어도 화면이 안 바뀐다 (클로저는 다시 도는데 DOM 만
 * 그대로다). 그래서 <ul> 은 바깥 템플릿에 붙박이로 두고, 함수는 <li> 배열만 돌려준다.
 */
const varRows = () => {
  state.tick;
  state.editing;
  state.expanded;
  if (state.variables.length === 0) return [emptyRow('변수나 리스트가 없습니다.')];
  // 펼친 항목은 이름 줄 "다음 줄" 로 낸다 (listItemsRow 주석 참고)
  const rows = [];
  for (const entry of state.variables) {
    if (entry.source.variableType !== 'list') { rows.push(variableRow(entry)); continue; }
    rows.push(listRow(entry));
    if (state.expanded === 'list:' + entry.id) rows.push(listItemsRow(entry));
  }
  return rows;
};

const functionRows = () => {
  state.expanded;
  state.tick;
  if (state.functions.length === 0) return [emptyRow('함수가 없습니다.')];
  const rows = [];
  for (const fn of state.functions) {
    rows.push(functionRow(fn));
    if (state.expanded === 'func:' + fn.id) rows.push(functionCodeRow(fn));
  }
  return rows;
};

const dataTab = () => sections([
  {
    id: 'data-vars',
    title: '변수 · 리스트',
    body: html`<div id="var-list"><ul class="debug-rows">${varRows}</ul></div>`,
  },
  {
    id: 'data-signals',
    title: '신호',
    body: html`<div id="signal-list">${() => (state.messages.length === 0
    ? empty('신호가 없습니다.')
    : html`<ul class="debug-rows">${state.messages.map((message) => html`
        <li>
          <span class="key">${message.name}</span>
          <button type="button" class="debug-send-btn" @click="${() => sendSignal(message.id)}">보내기</button>
        </li>`.key(message.id))}</ul>`)}</div>`,
  },
  {
    id: 'data-functions',
    title: '함수',
    body: html`<div id="function-list"><ul class="debug-rows">${functionRows}</ul></div>`,
  },
]);

const objectsTab = () => sections([
  {
    id: 'objects-tree',
    title: '장면 · 오브젝트',
    body: html`<div id="scene-tree">${() => (state.scenes.length === 0
    ? empty('불러오는 중…')
    : state.scenes.map((scene) => html`
        <div>
          <div class="debug-scene-title">
            <span>${scene.name}</span>
            <button type="button" class="debug-mini-btn debug-scene-go" data-scene-id="${scene.id}"
              title="이 장면으로 바로 넘어가기" @click="${() => goToScene(scene.id)}">바로가기</button>
          </div>
          <ul class="debug-object-list">${scene.objects.length === 0
    ? html`<li class="debug-empty">(오브젝트 없음)</li>`
    : scene.objects.map((object) => html`
              <li>
                <button type="button" class="${() => 'debug-object-btn' + (state.currentId === object.id ? ' active' : '')}"
                  data-object-id="${object.id}" @click="${() => showObject(object)}">${object.name}</button>
              </li>`.key(object.id))}
          </ul>
        </div>`.key(scene.id)))}</div>`,
  },
  {
    id: 'objects-info',
    title: html`오브젝트 정보 <span id="object-info-name">${() => (state.currentName ? '— ' + state.currentName : '')}</span>`,
    body: html`<div id="object-info"><ul class="debug-rows">${objectInfoRows}</ul></div>`,
  },
  {
    id: 'objects-blocks',
    title: html`컴파일된 블록 <span id="block-object-name">${() => (state.currentName ? '— ' + state.currentName : '')}</span>`,
    body: html`<div id="block-tree">${() => {
      state.tick;
      if (!state.currentId) return empty('위 목록에서 오브젝트를 고르세요.');
      if (currentThreads.length === 0) return empty('이 오브젝트에는 블록이 없습니다.');
      return currentThreads.map((thread, index) => html`
        <div class="debug-thread">
          <div class="debug-thread-label">스크립트 ${index + 1}</div>
          <ul>${thread.map((block) => blockNode(block))}</ul>
        </div>`.key(index));
    }}</div>`,
  },
]);

const errorsTab = () => sections([
  {
    id: 'errors-log',
    title: '오류 로그',
    body: html`<div id="error-log">${() => (state.errors.length === 0
    ? empty('아직 오류가 없습니다. entryjs 가 실행 중 panic 을 내면 여기와 이 서버를 띄운 터미널에 같이 찍힙니다.')
    : state.errors.map((error, index) => html`
        <details class="error-item" open="${index < 3}">
          <summary>[${error.at}] ${error.kind}: ${error.message}</summary>
          ${error.stack ? html`<pre>${error.stack}</pre>` : ''}
        </details>`.key(error.key)))}</div>`,
  },
]);

const TAB_BODY = { run: runTab, data: dataTab, objects: objectsTab, errors: errorsTab };

// --- 패널 폭 조절 (딱 붙이기) ----------------------------------------------------
const startHorizontalResize = (event) => {
  event.preventDefault();
  document.body.style.userSelect = 'none';
  const move = (e) => {
    const max = Math.max(STICKY, window.innerWidth - 240);
    const width = sticky(Math.min(window.innerWidth - e.clientX, max));
    panel.style.width = width + 'px';
    panel.classList.toggle('collapsed', width === 0);
    syncPanelWidth();
  };
  const up = () => {
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
    document.body.style.userSelect = '';
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
};

// --- 패널 전체 ---------------------------------------------------------------
html`
  <div id="debug-resize-handle" title="드래그해서 크기 조절 (끝까지 줄이면 접힙니다)" @mousedown="${startHorizontalResize}"></div>
  <div class="debug-header">
    <h2>디버그</h2>
    <button id="debug-close" type="button" aria-label="닫기" @click="${closePanel}">×</button>
  </div>
  <div class="debug-tabs" role="tablist">
    ${TABS.map((tab) => html`
      <button type="button" role="tab" class="debug-tab" data-tab="${tab.id}"
        aria-controls="${'tab-' + tab.id}"
        aria-selected="${() => (state.tab === tab.id ? 'true' : 'false')}"
        @click="${() => { state.tab = tab.id; }}">${tab.label}${tab.id === 'errors'
    ? html`<span id="error-count" class="badge" hidden="${() => state.errors.length === 0}">${() => state.errors.length}</span>`
    : ''}</button>`.key(tab.id))}
  </div>
  ${TABS.map((tab) => html`
    <div class="debug-panelbody" id="${'tab-' + tab.id}" role="tabpanel"
      hidden="${() => state.tab !== tab.id}">${TAB_BODY[tab.id]()}</div>`.key(tab.id))}
`(panel);

// --- 바깥에서 부르는 것들 -------------------------------------------------------
const toggleBtn = document.getElementById('debug-toggle');
const badge = document.getElementById('debug-badge');
toggleBtn.addEventListener('click', () => (state.open ? closePanel() : openPanel()));

window.tessDebugSink((item) => {
  state.errors.unshift({
    key: item.time + '-' + state.errors.length,
    at: new Date(item.time).toLocaleTimeString('ko-KR', { hour12: false }),
    kind: item.kind,
    message: item.message,
    stack: item.stack,
  });
  badge.hidden = false;
  badge.textContent = String(state.errors.length);
  if (state.errors.length === 1) openPanel('errors');
});

const indexBlocks = (node, object) => {
  if (Array.isArray(node)) { for (const item of node) indexBlocks(item, object); return; }
  if (!node || typeof node !== 'object' || !node.id) return;
  blockOwner.set(node.id, object);
  blockById.set(node.id, node);
  for (const param of node.params || []) indexBlocks(param, object);
  for (const branch of node.statements || []) indexBlocks(branch, object);
};

window.tessRenderProjectDebug = function renderProjectDebug(loaded) {
  project = loaded;
  const nameById = new Map(project.objects.map((object) => [object.id, object.name]));

  state.scenes = project.scenes.map((scene) => ({
    id: scene.id,
    name: scene.name,
    objects: project.objects
      .filter((object) => object.scene === scene.id)
      .map((object) => ({ id: object.id, name: object.name, script: object.script })),
  }));

  state.variables = (project.variables || [])
    .filter((entry) => entry.variableType !== 'timer' && entry.variableType !== 'answer')
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      scope: entry.object ? (nameById.get(entry.object) || '오브젝트') : '전역',
      kind: entry.variableType === 'list' ? '리스트' : '변수',
      source: entry,
    }));
  state.messages = (project.messages || []).map((message) => ({ id: message.id, name: message.name }));
  state.functions = (project.functions || []).map(describeFunction);

  // 함수 코드는 펼쳤을 때 그린다. 블록 트리는 반응형 밖에 둔다(크다).
  functionContentById.clear();
  for (const fn of project.functions || []) {
    try {
      const create = JSON.parse(fn.content || '[]')[0][0];
      functionContentById.set(fn.id, (create && create.statements && create.statements[0]) || []);
      indexBlocks(create, { id: 'func:' + fn.id, name: fn.id });
    } catch (error) { /* 못 읽으면 펼쳤을 때 안내만 보여 준다 */ }
  }

  for (const object of project.objects) {
    try { indexBlocks(JSON.parse(object.script), object); } catch (e) { /* 블록을 못 읽어도 목록은 보여준다 */ }
  }
  if (project.objects.length > 0) showObject(project.objects[0]);
};

/** 이 블록과 그 안에 값으로 꽂힌 블록들의 id. 실제 원인이 자식 쪽일 수 있다. */
window.tessCollectParamIds = function collectParamIds(node, out) {
  out = out || [];
  if (!node || typeof node !== 'object' || !node.id) return out;
  out.push(node.id);
  for (const param of node.params || []) {
    if (param && typeof param === 'object' && param.type) collectParamIds(param, out);
  }
  return out;
};

window.tessBlockDataById = blockById;

window.tessHighlightBlock = function highlightBlock(blockId) {
  const owner = blockOwner.get(blockId);
  if (!owner) return;
  if (state.currentId !== owner.id) showObject(owner);
  highlighted = window.tessCollectParamIds(blockById.get(blockId), []);
  state.tick += 1;
  openPanel('objects');
  requestAnimationFrame(() => {
    const target = panel.querySelector('[data-block-id="' + blockId + '"]');
    if (target && target.scrollIntoView) target.scrollIntoView({ block: 'center' });
  });
};

/** 실행 화면에서 고른 오브젝트를 디버거에서 연다 */
const selectObjectById = (objectId) => {
  const found = (project && project.objects && project.objects.find((o) => o.id === objectId))
    || blockOwner.get(objectId);
  if (!found || !found.script) return;
  showObject(found);
  openPanel('objects');
  // 오브젝트가 149개나 되는 작품도 있어서, 고른 줄이 목록 밖에 있으면 안 보인다
  requestAnimationFrame(() => {
    const row = panel.querySelector('[data-object-id="' + objectId + '"]');
    if (row && row.scrollIntoView) row.scrollIntoView({ block: 'nearest' });
  });
};

/**
 * Ctrl+Shift + 실행 화면 클릭 -> 그 오브젝트를 디버거에서 고른다.
 *
 * 어느 오브젝트를 눌렀는지는 엔트리가 이미 알고 있다 — 오브젝트마다 붙은 마우스
 * 핸들러가 `entityClick` 이벤트를 쏘고, 거기 실린 entity 의 `parent` 가 그 오브젝트다
 * (entryjs class/entity.js). 그림 모양 그대로 맞히므로 우리가 좌표로 다시 계산하는
 * 것보다 정확하고, PIXI/createjs 어느 쪽으로 그리든 똑같이 동작한다.
 *
 * 다만 같은 이벤트로 작품의 "오브젝트를 클릭했을 때" 도 함께 돌아 버리므로, 고르는
 * 동안만 엔진의 이벤트 발사를 잠깐 막아 둔다 — 디버깅하려고 누른 것이지 작품을
 * 진행시키려고 누른 게 아니기 때문이다.
 */
window.tessWatchStagePicks = function watchStagePicks() {
  const entry = window.Entry;
  if (!entry || !entry.addEventListener || watchStagePicks.armed) return;
  watchStagePicks.armed = true;

  let picking = false;

  document.addEventListener('pointerdown', (event) => {
    if (!(event.ctrlKey && event.shiftKey) || event.button !== 0) return;
    // 실행 화면(무대)을 누른 것만 고르기로 친다. 캔버스는 실행기가 나중에 만들므로
    // 늘 있는 바깥 상자로 확인한다.
    const stage = document.getElementById('workspace');
    if (!stage || !stage.contains(event.target)) return;

    picking = true;
    const engineRef = entry.engine;
    const fire = engineRef && engineRef.fireEventOnEntity;
    if (fire) engineRef.fireEventOnEntity = () => {};
    setTimeout(() => {
      picking = false;
      if (fire) engineRef.fireEventOnEntity = fire;
    }, 0);
  }, true);

  entry.addEventListener('entityClick', (entity) => {
    if (!picking) return;
    const object = entity && entity.parent;
    if (object && object.id) selectObjectById(object.id);
  });
};

/** value_of_index_from_list 의 "can not insert value to array" 를 리스트 이름·길이가 담긴 메시지로 바꾼다 */
window.tessDescribeListIndexError = function describeListIndexError(reportedBlockId, err) {
  if (!err || err.message !== 'can not insert value to array') return null;
  const find = (node) => {
    if (!node || typeof node !== 'object') return null;
    if (node.type === 'value_of_index_from_list') return node;
    for (const param of node.params || []) {
      const found = find(param);
      if (found) return found;
    }
    return null;
  };
  const culprit = find(blockById.get(reportedBlockId));
  if (!culprit) return null;
  try {
    const listId = culprit.params && culprit.params[1];
    const indexParam = culprit.params && culprit.params[3];
    const indexText = indexParam && typeof indexParam === 'object'
      && indexParam.type === 'number' && Array.isArray(indexParam.params)
      ? indexParam.params[0]
      : null;

    let listName = listId;
    let count = null;
    const list = listId && window.Entry && Entry.variableContainer && Entry.variableContainer.getList
      ? Entry.variableContainer.getList(listId)
      : null;
    if (list) {
      if (typeof list.getName === 'function') listName = list.getName();
      if (typeof list.getArray === 'function') count = list.getArray().length;
    }

    let message = "'" + (listName || '리스트') + "' 리스트에서 ";
    message += indexText !== null ? indexText + '번째' : '요청한';
    message += ' 항목을 찾지 못했습니다';
    message += count === null ? '.' : ' (지금 ' + count + '개 들어 있습니다).';
    return message;
  } catch (e) {
    return '리스트에서 요청한 위치의 항목을 찾지 못했습니다 (범위를 벗어났습니다).';
  }
};

// --- 캔버스 배치 ------------------------------------------------------------
let resolutionFixed = false;

// Buffer size every hard-coded pixel offset inside entryjs assumes.
const ENTRY_BUFFER_WIDTH = 640;

/**
 * Rescales the ask() input box to the canvas buffer we actually use.
 * Entry draws it onto the canvas at raw pixel offsets (x 15, y 275, width 520)
 * that assume a 640x360 buffer, so a bigger buffer leaves it small in the
 * top-left corner. The stage-local submit button and the hit test both stay in
 * entry coordinates, so scaling every length by the same ratio lines them up.
 */
const scaleInputFieldToBuffer = (bufferW) => {
  const stage = window.Entry && Entry.stage;
  const ratio = bufferW / ENTRY_BUFFER_WIDTH;
  if (!stage || typeof stage.showInputField !== 'function' || ratio === 1) return;
  const showInputField = stage.showInputField;
  stage.showInputField = function tessShowInputField(...args) {
    showInputField.apply(this, args);
    const field = this.inputField;
    if (!field || field.tessScaled || typeof field.width !== 'function') return;
    field.tessScaled = true;
    // These setters return undefined, so they cannot be chained. Lengths that
    // feed outerW/outerH go before the position so the last call redraws.
    for (const name of ['fontSize', 'borderWidth', 'borderRadius', 'padding',
      'width', 'height', 'x', 'y']) {
      field[name](field[name]() * ratio);
    }
    Entry.requestUpdateTwice = true;
  };
};

/** 그리기 해상도는 처음 한 번만 정한다. 바꿀 때마다 캔버스가 지워지고 화면이 깜빡인다. */
const setCanvasResolution = () => {
  if (resolutionFixed) return;
  try {
    const stage = window.Entry && Entry.stage;
    const canvasEl = stage && stage.canvas && stage.canvas.canvas;
    if (!canvasEl) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const wanted = Math.max(window.screen?.width || window.innerWidth, window.innerWidth) * dpr;
    const bufferW = Math.round(Math.min(Math.max(wanted, 960), 1920));
    const bufferH = Math.round((bufferW * 9) / 16);

    canvasEl.width = bufferW;
    canvasEl.height = bufferH;
    stage.canvas.x = bufferW / 2;
    stage.canvas.y = bufferH / 2;
    stage.canvas.scaleX = bufferW / 480;
    stage.canvas.scaleY = bufferW / 480;
    scaleInputFieldToBuffer(bufferW);
    Entry.requestUpdate = true;
    resolutionFixed = true;
  } catch (e) { /* 실패하면 엔트리 기본 해상도를 쓴다 */ }
};

/**
 * Entry caches the canvas client rect and only refreshes it on window resize,
 * so mouse coordinate blocks read stale positions after the debug panel moves
 * or resizes the stage.
 */
const refreshBoundRect = () => {
  const stage = window.Entry && Entry.stage;
  if (stage && typeof stage.updateBoundRect === 'function') stage.updateBoundRect();
};

/** 남은 공간에 16:9 로 꽉 차도록 캔버스의 CSS 크기만 맞춘다 */
window.tessLayoutCanvas = function layoutCanvas() {
  const workspace = document.getElementById('workspace');
  const canvas = document.getElementById('entryCanvas');
  if (!workspace || !canvas) return;
  const engineBar = document.querySelector('.entryEngine');
  const engineHeight = engineBar ? engineBar.getBoundingClientRect().height : 0;
  // clientWidth 는 padding(디버그 패널 자리)을 포함하므로 그만큼 뺀다
  const panelWidth = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--debug-panel-width')) || 0;
  const availW = workspace.clientWidth - panelWidth;
  const availH = Math.max(workspace.clientHeight - engineHeight, 60);
  if (availW <= 0 || availH <= 0) return;
  const targetW = Math.min(availW, Math.floor((availH * 16) / 9));
  canvas.style.width = targetW + 'px';
  canvas.style.height = Math.floor((targetW * 9) / 16) + 'px';
  setCanvasResolution();
  refreshBoundRect();
};
window.addEventListener('resize', () => window.tessLayoutCanvas());

// Opening the panel slides the stage sideways over a CSS transition, so its
// final position is only known once that transition ends.
document.getElementById('workspace')?.addEventListener('transitionend', (event) => {
  if (event.propertyName === 'padding-right') refreshBoundRect();
});

setInterval(() => {
  state.runState = engineState();
  if (state.open && (state.tab === 'data' || state.tab === 'objects')) state.tick += 1;
  if (window.Entry && window.tessWatchStagePicks) window.tessWatchStagePicks();
  refreshBoundRect();
}, 400);
