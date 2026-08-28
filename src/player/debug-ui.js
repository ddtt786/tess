// Debug panel UI for the player page. Rendered with arrow-js, served by the server at /debug-ui.js.
import { reactive, html } from '/arrow/index.mjs';

const TABS = [
  { id: 'run', label: '실행' },
  { id: 'data', label: '자료' },
  { id: 'objects', label: '오브젝트' },
  { id: 'errors', label: '오류' },
];
const STATE_TEXT = { run: '실행 중', pause: '일시정지됨', stop: '멈춰 있음' };
const DEFAULT_SECTION_HEIGHT = 200;

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
  // Section heights. Keys must exist up front for arrow to track changes.
  heights: { 'run-control': 200, 'data-vars': 200, 'data-signals': 200, 'objects-tree': 200 },
  tick: 0,        // Counter that forces a re-render of data outside the reactive proxy (block tree, variable values)
});

// Large data that would be slow to wrap in the reactive proxy.
let project = null;
const blockOwner = new Map();
const blockById = new Map();
let currentThreads = [];
let highlighted = [];

// --- Panel open/close --------------------------------------------------------
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
const openPanel = (tab) => setOpen(true, tab);
const closePanel = () => setOpen(false);

// --- Run controls --------------------------------------------------------------
const engine = () => (window.Entry && Entry.engine) || null;
const engineState = () => {
  const e = engine();
  if (!e || typeof e.isState !== 'function') return '';
  for (const s of ['run', 'pause', 'stop']) {
    try { if (e.isState(s)) return s; } catch (error) { /* Check the next state. */ }
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

// --- Simulated environment -----------------------------------------------------
// These judgment blocks query the browser directly, so their func is
// wrapped to return the value chosen in the panel instead.
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

// --- Data ------------------------------------------------------------------
const preview = (value) => {
  if (value === null || value === undefined) return '(없음)';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > 80 ? text.slice(0, 80) + '…' : text;
};

/** Returns the live value while running, else the initial value from project.json. */
const liveValue = (entry) => {
  const container = window.Entry && Entry.variableContainer;
  try {
    if (entry.variableType === 'list') {
      const list = container && container.getList && container.getList(entry.id);
      const array = list && typeof list.getArray === 'function' ? list.getArray() : (entry.array || []);
      return '[' + array.length + '개] ' + preview(array.map((item) => item && item.data));
    }
    const variable = container && container.getVariable && container.getVariable(entry.id);
    if (variable && typeof variable.getValue === 'function') return preview(variable.getValue());
  } catch (error) { /* Fall back to the initial value if the runtime can't be read. */ }
  return preview(entry.value);
};

const sendSignal = (id) => {
  try { Entry.engine.fireEvent('when_message_cast', id); } catch (error) {
    window.tessReportError('신호 보내기', error);
  }
};

/** Reads a function's name, parameter count, and kind from its header chain. */
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
  } catch (error) { /* Fall back to showing the id if unreadable. */ }
  return { id: fn.id, name, params, kind };
};

// --- Block tree --------------------------------------------------------------
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

// --- Sections (vertical resize) -------------------------------------------------
const startVerticalResize = (event, id) => {
  const section = event.currentTarget.closest('.debug-section');
  const startY = event.clientY;
  const startHeight = section.getBoundingClientRect().height;
  event.preventDefault();
  document.body.style.userSelect = 'none';

  const move = (e) => { state.heights[id] = Math.max(60, startHeight + (e.clientY - startY)); };
  const up = () => {
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
    document.body.style.userSelect = '';
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
};

/** Adds a resize handle to the bottom of every section except the last. */
const sections = (list) => list.map((section, index) => {
  const last = index === list.length - 1;
  const height = () => (last ? '' : 'height:' + (state.heights[section.id] ?? DEFAULT_SECTION_HEIGHT) + 'px');
  return html`
    <section class="${'debug-section' + (last ? ' debug-section-last' : '')}" style="${height}">
      <h3>${section.title}</h3>
      ${section.body}
      ${last ? '' : html`<div class="debug-vresize" title="드래그해서 높이 조절"
        @mousedown="${(e) => startVerticalResize(e, section.id)}"></div>`}
    </section>
  `.key(section.id);
});

const empty = (text) => html`<p class="debug-empty">${text}</p>`;

// --- Tab content ----------------------------------------------------------------
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

const dataTab = () => sections([
  {
    id: 'data-vars',
    title: '변수 · 리스트',
    body: html`<div id="var-list">${() => {
      state.tick;
      if (state.variables.length === 0) return empty('변수나 리스트가 없습니다.');
      return html`<ul class="debug-rows">${state.variables.map((entry) => html`
        <li>
          <span class="key">${entry.name}</span>
          <span class="tag">${entry.scope} · ${entry.kind}</span>
          <span class="val">${liveValue(entry.source)}</span>
        </li>`.key(entry.id))}</ul>`;
    }}</div>`,
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
    body: html`<div id="function-list">${() => (state.functions.length === 0
      ? empty('함수가 없습니다.')
      : html`<ul class="debug-rows">${state.functions.map((fn) => html`
        <li>
          <span class="key">${fn.name}</span>
          <span class="tag">${fn.params}개 인자</span>
          <span class="val">${fn.kind}</span>
        </li>`.key(fn.id))}</ul>`)}</div>`,
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
          <div class="debug-scene-title">${scene.name}</div>
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

// --- Panel width resize -------------------------------------------------------------
const startHorizontalResize = (event) => {
  event.preventDefault();
  document.body.style.userSelect = 'none';
  const move = (e) => {
    const min = 260;
    const max = Math.max(min, window.innerWidth - 240);
    panel.style.width = Math.min(Math.max(window.innerWidth - e.clientX, min), max) + 'px';
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

// --- Panel root ---------------------------------------------------------------
html`
  <div id="debug-resize-handle" title="드래그해서 크기 조절" @mousedown="${startHorizontalResize}"></div>
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

// --- Externally-called entry points -------------------------------------------------
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

  for (const object of project.objects) {
    try { indexBlocks(JSON.parse(object.script), object); } catch (e) { /* Still show the list if blocks can't be parsed. */ }
  }
  if (project.objects.length > 0) showObject(project.objects[0]);
};

/** Ids of this block and any value blocks plugged into it — the real cause may be a child block. */
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
    if (target) target.scrollIntoView({ block: 'center' });
  });
};

/** Rewrites value_of_index_from_list's "can not insert value to array" into a message with the list's name and length. */
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

// --- Canvas layout ------------------------------------------------------------
let resolutionFixed = false;

/** Sets the drawing resolution only once — changing it clears the canvas and flashes the screen. */
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
    Entry.requestUpdate = true;
    resolutionFixed = true;
  } catch (e) { /* Fall back to Entry's default resolution on failure. */ }
};

/** Fits the canvas's CSS size to fill the remaining space at 16:9, without touching its resolution. */
window.tessLayoutCanvas = function layoutCanvas() {
  const workspace = document.getElementById('workspace');
  const canvas = document.getElementById('entryCanvas');
  if (!workspace || !canvas) return;
  const engineBar = document.querySelector('.entryEngine');
  const engineHeight = engineBar ? engineBar.getBoundingClientRect().height : 0;
  // clientWidth includes padding (reserved for the debug panel), so that amount is subtracted.
  const panelWidth = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--debug-panel-width')) || 0;
  const availW = workspace.clientWidth - panelWidth;
  const availH = Math.max(workspace.clientHeight - engineHeight, 60);
  if (availW <= 0 || availH <= 0) return;
  const targetW = Math.min(availW, Math.floor((availH * 16) / 9));
  canvas.style.width = targetW + 'px';
  canvas.style.height = Math.floor((targetW * 9) / 16) + 'px';
  setCanvasResolution();
};
window.addEventListener('resize', () => window.tessLayoutCanvas());

setInterval(() => {
  state.runState = engineState();
  if (state.open && state.tab === 'data') state.tick += 1;
}, 400);
