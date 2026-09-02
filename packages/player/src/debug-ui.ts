/**
 * 실행 페이지의 디버그 패널 UI 컴포넌트입니다. Preact로 렌더링되며, 서버가 `/debug-ui.js`로 제공합니다.
 *
 * 이 파일은 다음 부분들로 구성됩니다.
 * 1. 상태 (State) - 상태가 변경되면 패널 전체를 다시 렌더링합니다. (Preact가 실제 DOM 차이만 업데이트함)
 * 2. 실행기 브리지 - `window.Entry` 객체 조작 등 엔트리 런타임과의 상호작용
 * 3. 위젯 컴포넌트 - 입력 칸, 선택 칸, 토글 칸, 블록 트리 등의 UI 요소
 * 4. 탭 컴포넌트 - 실행, 자료, 오브젝트, 오류 탭 화면
 * 5. 외부 API - 실행 페이지에서 호출하는 `window.tess*` 훅 연결
 */
// The url the player server serves preact at. TypeScript resolves a rooted
// specifier as a filesystem path, so it cannot find it; `h` and `render` are
// declared in globals.d.ts instead.
// @ts-ignore -- resolved by the browser, not by the type checker
import { h, render } from "/preact/preact.mjs";

const TABS = [
  { id: "run", label: "실행" },
  { id: "data", label: "자료" },
  { id: "objects", label: "오브젝트" },
  { id: "errors", label: "오류" },
];
const STATE_TEXT: Record<string, string> = { run: "실행 중", pause: "일시정지됨", stop: "멈춰 있음" };
const DEFAULT_SECTION_HEIGHT = 200;

// 이 크기 아래로 끌면 창이 딱 붙어서 0 이 되고, 다시 이만큼 끌어내면 딱 하고 펴진다.
// 접혀도 손잡이는 있던 자리에 그대로 남아서 다시 끌 수 있다.
const STICKY = 56;
const sticky = (size: number) => (size < STICKY ? 0 : size);

// ============================================================================
//  1. 상태
// ============================================================================
// The player page always renders the panel shell, so these lookups cannot miss.
const panel = document.getElementById("debug-panel")!;

let scheduled = false;

/**
 * 상태가 변경되면 변경 사항을 모아 한 번만 다시 렌더링하도록 예약합니다.
 *
 * `requestAnimationFrame` 대신 `queueMicrotask` 또는 `setTimeout`을 사용하여,
 * 탭이 숨겨져 있을 때도 업데이트가 멈추지 않도록 합니다.
 * 
 * @example
 * ```typescript
 * state.runState = 'pause';
 * schedule();
 * ```
 */
function schedule() {
  if (scheduled) return;
  scheduled = true;
  const draw = () => {
    scheduled = false;
    render(h(Panel, null), panel);
  };
  if (typeof queueMicrotask === "function") queueMicrotask(draw);
  else setTimeout(draw, 0);
}

const proxies = new WeakMap();

/**
 * 객체의 속성이 변경될 때마다 자동으로 다시 렌더링하도록 만드는 프록시 래퍼입니다.
 *
 * @param target 감시할 원본 객체
 * @returns 반응형으로 감싸진 프록시 객체
 *
 * @example
 * ```typescript
 * const state = observable({ count: 0 });
 * state.count++; // 자동으로 schedule() 이 호출됨
 * ```
 */
function observable(target: any) {
  const cached = proxies.get(target);
  if (cached) return cached;
  const proxy = new Proxy(target, {
    get(object, key) {
      const value = Reflect.get(object, key);
      return value && typeof value === "object" ? observable(value) : value;
    },
    set(object, key, value) {
      if (Reflect.get(object, key) === value) return true;
      Reflect.set(object, key, value);
      schedule();
      return true;
    },
  });
  proxies.set(target, proxy);
  return proxy;
}

const state = observable({
  open: false,
  tab: "run",
  errors: [],
  runState: "",
  env: { boost: "", device: "", touch: "" },
  // 실행기가 실제로 도는 렌더러 (run --boost). 흉내내기 값과 달리 못 바꾼다.
  realBoost: false,
  scenes: [],
  currentId: "",
  currentName: "",
  variables: [],
  messages: [],
  functions: [],
  expanded: "", // 펼쳐 둔 리스트/함수의 키 ('list:<id>' · 'func:<id>')
  editing: "", // 지금 고쳐 쓰고 있는 칸의 키
  heights: {
    "run-control": DEFAULT_SECTION_HEIGHT,
    "data-vars": DEFAULT_SECTION_HEIGHT,
    "data-signals": DEFAULT_SECTION_HEIGHT,
    "objects-tree": DEFAULT_SECTION_HEIGHT,
    "objects-info": DEFAULT_SECTION_HEIGHT,
  },
  tick: 0, // 실행기에서 그때그때 읽는 값들을 다시 읽게 하는 카운터
  picking: false, // Ctrl+Shift 로 무대에서 오브젝트를 고르는 중
});

const touch = () => {
  state.tick += 1;
};

// 반응형 밖에 두는 큰 데이터
let project: any = null;
const blockOwner = new Map<string, any>();
const blockById = new Map<string, any>();
const functionContentById = new Map<string, any>();
let currentThreads: any[] = [];
let highlighted: string[] = [];

// --- 패널 열고 닫기 ---------------------------------------------------------
const syncPanelWidth = () => {
  const width = state.open ? panel.getBoundingClientRect().width : 0;
  document.documentElement.style.setProperty(
    "--debug-panel-width",
    width + "px",
  );
  window.tessLayoutCanvas();
};
const setOpen = (open: boolean, tab?: string) => {
  state.open = open;
  if (tab) state.tab = tab;
  panel.classList.toggle("open", open);
  panel.setAttribute("aria-hidden", open ? "false" : "true");
  syncPanelWidth();
};
const openPanel = (tab?: string) => {
  // 딱 붙여 접어 둔 상태로 다시 열면 아무것도 안 보이므로 폭을 되살린다
  if (panel.style.width === "0px") panel.style.width = "";
  setOpen(true, tab);
};
const closePanel = () => setOpen(false);

// ============================================================================
//  2. 실행기 붙이기
// ============================================================================
const engine = () => (window.Entry && Entry.engine) || null;
const engineState = () => {
  const e = engine();
  if (!e || typeof e.isState !== "function") return "";
  for (const s of ["run", "pause", "stop"]) {
    try {
      if (e.isState(s)) return s;
    } catch (error) {
      /* 다음 상태를 본다 */
    }
  }
  return "";
};

const failed = (what: string, error: any) => window.tessReportError(what, error);

const control = (action: any) => {
  try {
    action(engine());
  } catch (error) {
    failed("실행 제어", error);
  }
  state.runState = engineState();
  setTimeout(() => {
    state.runState = engineState();
  }, 60);
};
const doRun = () =>
  control((e: any) => {
    if (!e) return;
    if (engineState() === "pause") e.togglePause();
    else e.toggleRun();
  });
const doPause = () => control((e: any) => e && e.togglePause());
const doStop = () => control((e: any) => e && e.toggleStop());

// --- 실행 환경 흉내내기 -------------------------------------------------------
// 브라우저에 직접 묻는 판단 블록들이라, func 을 감싸 패널에서 고른 값을 돌려준다.
const choice = (value: any) => (value === "" ? null : value === "true");

/** Renderer entry actually runs on — what "실제 값 그대로" resolves to for boost mode. */
const realBoostLabel = () => (state.realBoost ? "켜짐 (WebGL)" : "꺼짐 (2D)");

window.tessPatchEnvironmentBlocks = function patchEnvironmentBlocks() {
  const blocks = window.Entry && Entry.block;
  if (!blocks) return;
  state.realBoost = Boolean(Entry.options && Entry.options.useWebGL);
  const wrap = (type: string, forced: (args: any[]) => any) => {
    const spec = blocks[type];
    if (!spec || typeof spec.func !== "function" || spec.tessWrapped) return;
    const original = spec.func;
    spec.func = function (this: any, ...args: any[]) {
      const value = forced(args);
      return value === null ? original.apply(this, args) : value;
    };
    spec.tessWrapped = true;
  };
  wrap("is_boost_mode", () => choice(state.env.boost));
  wrap("is_touch_supported", () => choice(state.env.touch));
  wrap("is_current_device_type", (args) => {
    if (state.env.device === "") return null;
    try {
      return args[1].getField("DEVICE", args[1]) === state.env.device;
    } catch (e) {
      return null;
    }
  });
};

// --- 자료 -------------------------------------------------------------------
const preview = (value: any) => {
  if (value === null || value === undefined) return "(없음)";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 80 ? text.slice(0, 80) + "…" : text;
};

const container = () => (window.Entry && Entry.variableContainer) || null;
const liveVariable = (id: string) => {
  const box = container();
  try {
    return box && box.getVariable ? box.getVariable(id) : null;
  } catch (e) {
    return null;
  }
};
const liveList = (id: string) => {
  const box = container();
  try {
    return box && box.getList ? box.getList(id) : null;
  } catch (e) {
    return null;
  }
};

/** 
 * 엔트리 리스트 객체의 항목들을 원본 배열 형태(`[{ data }]`)로 반환합니다. 
 * 실행 전이라면 `project.json`의 초기값을 사용합니다.
 *
 * @param entry 리스트 변수 정보 객체
 * @returns 리스트 항목들의 배열
 *
 * @example
 * ```typescript
 * const items = listArray(myList);
 * ```
 */
const listArray = (entry: any) => {
  const list = liveList(entry.id);
  try {
    if (list && typeof list.getArray === "function") return list.getArray();
  } catch (error) {
    /* 실행기에서 못 읽으면 초기값을 보여 준다 */
  }
  return entry.array || [];
};

/** 
 * 변수의 현재 원시 값을 반환합니다. 실행 전이라면 `project.json`의 초기값을 반환합니다.
 *
 * @param entry 변수 정보 객체
 * @returns 변수의 값
 *
 * @example
 * ```typescript
 * const value = rawValue(myVar);
 * ```
 */
const rawValue = (entry: any) => {
  const variable = liveVariable(entry.id);
  try {
    if (variable && typeof variable.getValue === "function")
      return variable.getValue();
  } catch (error) {
    /* 아래에서 초기값을 쓴다 */
  }
  return entry.value;
};

const liveValue = (entry: any) => {
  if (entry.variableType === "list") {
    const array = listArray(entry);
    return (
      "[" +
      array.length +
      "개] " +
      preview(array.map((item: any) => item && item.data))
    );
  }
  return preview(rawValue(entry));
};

/** 엔트리 변수는 숫자도 글자도 담는다. 숫자로 읽히면 숫자로 넣어야 계산 블록이 제대로 돈다. */
const coerce = (text: string) => {
  const trimmed = String(text).trim();
  if (trimmed === "" || !Number.isFinite(Number(trimmed))) return text;
  return Number(trimmed);
};

const setVariable = (id: string, text: string) => {
  try {
    const variable = liveVariable(id);
    if (variable && typeof variable.setValue === "function")
      variable.setValue(coerce(text));
  } catch (error) {
    failed("변수 값 바꾸기", error);
  }
  touch();
};

const setListItem = (id: string, index: number, text: string) => {
  try {
    const list = liveList(id);
    // 엔트리 리스트 API 는 1 부터 센다
    if (list && typeof list.replaceValue === "function")
      list.replaceValue(index + 1, coerce(text));
  } catch (error) {
    failed("리스트 항목 바꾸기", error);
  }
  touch();
};

const addListItem = (id: string) => {
  try {
    const list = liveList(id);
    if (list && typeof list.appendValue === "function") list.appendValue("");
  } catch (error) {
    failed("리스트 항목 넣기", error);
  }
  touch();
};

const removeListItem = (id: string, index: number) => {
  try {
    const list = liveList(id);
    if (list && typeof list.deleteValue === "function")
      list.deleteValue(index + 1);
  } catch (error) {
    failed("리스트 항목 지우기", error);
  }
  touch();
};

/** 무대에 값이 보이는지 — 변수·리스트 모두 같은 API 를 쓴다 */
const liveEntryOf = (entry: any) =>
  entry.variableType === "list" ? liveList(entry.id) : liveVariable(entry.id);

const entryVisible = (entry: any) => {
  const live = liveEntryOf(entry);
  try {
    if (live && typeof live.isVisible === "function") return live.isVisible();
  } catch (error) {
    /* 실행기가 아직 없으면 선언된 값을 쓴다 */
  }
  return Boolean(entry.visible);
};

const setEntryVisible = (entry: any, visible: boolean) => {
  const live = liveEntryOf(entry);
  try {
    if (live && typeof live.setVisible === "function")
      live.setVisible(Boolean(visible));
  } catch (error) {
    failed("변수 보이기 바꾸기", error);
  }
  touch();
};

const sendSignal = (id: string) => {
  try {
    Entry.engine.fireEvent("when_message_cast", id);
  } catch (error) {
    failed("신호 보내기", error);
  }
};

/** 함수 머리 사슬에서 이름·인자 개수·종류를 읽는다 */
const describeFunction = (fn: any) => {
  let name = fn.id;
  let params = 0;
  let kind = "일반 함수";
  try {
    const create = JSON.parse(fn.content || "[]")[0][0];
    if (create && create.type === "function_create_value") kind = "값 함수";
    let node = create && create.params && create.params[0];
    const labels = [];
    while (node && typeof node === "object") {
      if (node.type === "function_field_label")
        labels.push(String(node.params[0] ?? ""));
      else if (
        node.type === "function_field_string" ||
        node.type === "function_field_boolean"
      )
        params += 1;
      else break;
      node = node.params[1];
    }
    if (labels.length) name = labels.join(" … ");
  } catch (error) {
    /* 못 읽으면 id 를 보여 준다 */
  }
  return { id: fn.id, name, params, kind };
};

// --- 오브젝트 ----------------------------------------------------------------
const liveEntity = (objectId: string) => {
  try {
    const object =
      window.Entry && Entry.container && Entry.container.getObject
        ? Entry.container.getObject(objectId)
        : null;
    return object && object.entity ? { object, entity: object.entity } : null;
  } catch (error) {
    return null;
  }
};

const round = (value: any) =>
  typeof value === "number" ? Math.round(value * 100) / 100 : value;
const call = (target: any, name: string, fallback: any) => {
  try {
    return target && typeof target[name] === "function"
      ? round(target[name]())
      : fallback;
  } catch (error) {
    return fallback;
  }
};

const setEntityNumber = (name: string) => (objectId: string, text: string) => {
  const live = liveEntity(objectId);
  const value = Number(String(text).trim());
  if (!live || !Number.isFinite(value)) {
    touch();
    return;
  }
  try {
    if (typeof live.entity[name] === "function") live.entity[name](value);
    if (window.Entry) Entry.requestUpdate = true;
  } catch (error) {
    failed("오브젝트 값 바꾸기", error);
  }
  touch();
};

// 오브젝트 정보 칸. 숫자 칸은 눌러서 바로 고칠 수 있다 (엔트리 편집기의 그 칸들과 같다).
const ENTITY_FIELDS = [
  {
    key: "x",
    label: "x 좌표",
    get: (e: any) => call(e, "getX", 0),
    set: setEntityNumber("setX"),
  },
  {
    key: "y",
    label: "y 좌표",
    get: (e: any) => call(e, "getY", 0),
    set: setEntityNumber("setY"),
  },
  {
    key: "size",
    label: "크기",
    get: (e: any) => call(e, "getSize", 100),
    set: setEntityNumber("setSize"),
  },
  {
    key: "direction",
    label: "방향",
    get: (e: any) => call(e, "getRotation", 0),
    set: setEntityNumber("setRotation"),
  },
  {
    key: "way",
    label: "이동 방향",
    get: (e: any) => call(e, "getDirection", 90),
    set: setEntityNumber("setDirection"),
  },
  { key: "scaleX", label: "가로 배율", get: (e: any) => call(e, "getScaleX", 1) },
  { key: "scaleY", label: "세로 배율", get: (e: any) => call(e, "getScaleY", 1) },
];

const pictureInfo = (live: any) => {
  const pictures = (live.object && live.object.pictures) || [];
  const current = live.entity.picture;
  if (!current) return { name: "(없음)", index: "-" };
  const at = pictures.findIndex((picture: any) => picture.id === current.id);
  return {
    name: current.name || current.id,
    index: at < 0 ? "-" : String(at + 1) + " / " + pictures.length,
  };
};

const setPicture = (objectId: string, pictureId: any) => {
  const live = liveEntity(objectId);
  try {
    // 엔트리의 "모양으로 바꾸기" 와 같은 길이다 (entryjs block_looks.js)
    const picture =
      live && live.object.getPicture ? live.object.getPicture(pictureId) : null;
    if (picture) live!.entity.setImage(picture);
    if (window.Entry) Entry.requestUpdate = true;
  } catch (error) {
    failed("모양 바꾸기", error);
  }
  touch();
};

const setRotateMethod = (objectId: string, method: any) => {
  const live = liveEntity(objectId);
  try {
    if (live && typeof live.object.setRotateMethod === "function")
      live.object.setRotateMethod(method);
    if (window.Entry) Entry.requestUpdate = true;
  } catch (error) {
    failed("회전 방식 바꾸기", error);
  }
  touch();
};

const setEntityVisible = (objectId: string, visible: boolean) => {
  const live = liveEntity(objectId);
  try {
    if (live && typeof live.entity.setVisible === "function")
      live.entity.setVisible(Boolean(visible));
    if (window.Entry) Entry.requestUpdate = true;
  } catch (error) {
    failed("보이기 바꾸기", error);
  }
  touch();
};

const setEntityText = (objectId: string, text: string) => {
  const live = liveEntity(objectId);
  try {
    if (live && typeof live.entity.setText === "function")
      live.entity.setText(String(text));
    if (window.Entry) Entry.requestUpdate = true;
  } catch (error) {
    failed("글 내용 바꾸기", error);
  }
  touch();
};

const ROTATE_METHODS = [
  { value: "free", label: "자유 회전" },
  { value: "vertical", label: "좌우 회전" },
  { value: "none", label: "회전 안 함" },
];

const showObject = (object: any) => {
  state.currentId = object.id;
  state.currentName = object.name;
  try {
    currentThreads = JSON.parse(object.script);
  } catch (error) {
    currentThreads = [];
  }
  touch();
};

/**
 * Jumps to a scene and runs it, the same way entry's "start scene" block does
 * (`Entry.scene.selectScene` + `Entry.engine.fireEvent('when_scene_start')`).
 *
 * selectScene only swaps what the stage draws: without the event the scene's
 * "when scene starts" scripts never run, so the scene opens frozen. The engine
 * drops every event unless it is running, so it is started or resumed first.
 */
const goToScene = (sceneId: string) => {
  try {
    const scene = Entry.scene.getSceneById(sceneId);
    const runner = engine();
    if (scene) Entry.scene.selectScene(scene);
    if (scene && runner) {
      // Events are dropped while stopped or paused, so run the engine first
      if (engineState() === "pause") runner.togglePause();
      else if (engineState() !== "run") runner.toggleRun();
      runner.fireEvent("when_scene_start");
    }
  } catch (error) {
    failed("장면 바로가기", error);
  }
  state.runState = engineState();
  touch();
};

/** 이름을 눌러 펼치고 접는다. 같은 것을 다시 누르면 접힌다. */
const toggleExpanded = (key: string) => {
  state.expanded = state.expanded === key ? "" : key;
};

// ============================================================================
//  3. 위젯
// ============================================================================

/**
 * 값을 클릭하여 수정할 수 있는 입력 칸 컴포넌트입니다.
 *
 * @param key 현재 편집 중인 항목의 고유 식별자
 * @param value 표시할 현재 값
 * @param commit 사용자가 입력을 완료했을 때 호출할 함수
 * @returns Preact VNode 객체
 *
 * @example
 * ```tsx
 * {editable('var_1', 10, (newVal) => setVariable('var_1', newVal))}
 * ```
 */
function editable(key: string, value: any, commit: any) {
  if (state.editing !== key) {
    const text = preview(value);
    return h(
      "button",
      {
        type: "button",
        title: "눌러서 고치기",
        class: "val debug-edit" + (text === "" ? " empty" : ""),
        onClick: () => {
          state.editing = key;
        },
        // 빈 값도 눌러서 고칠 수 있어야 하므로 자리를 채워 둔다
      },
      text === "" ? "(빈 값)" : text,
    );
  }

  // Enter 로 끝내면 입력칸이 사라지면서 blur 까지 이어 나므로 한 번만 반영한다
  let settled = false;
  const done = (event: any) => {
    if (settled) return;
    settled = true;
    state.editing = "";
    commit(event.target.value);
  };
  return h("input", {
    class: "val debug-edit-input",
    type: "text",
    value: String(value ?? ""),
    // 막 나타난 입력칸에 바로 커서를 둔다
    ref: (node: any) => {
      if (!node || node.dataset.ready) return;
      node.dataset.ready = "1";
      node.value = String(value ?? "");
      node.focus();
      node.select();
    },
    onBlur: done,
    onKeyDown: (event: any) => {
      if (event.key === "Enter") done(event);
      if (event.key === "Escape") {
        settled = true;
        state.editing = "";
      }
    },
  });
}

/** 
 * 주어진 옵션 목록에서 값을 선택할 수 있는 드롭다운 컴포넌트입니다.
 *
 * @param options 선택 가능한 옵션 목록 (`{ label, value }` 형태)
 * @param value 현재 선택된 값
 * @param commit 사용자가 값을 변경했을 때 호출할 함수
 * @returns Preact VNode 객체
 *
 * @example
 * ```tsx
 * {chooser([{label:'켜기', value:'on'}], 'on', (val) => console.log(val))}
 * ```
 */
function chooser(options: any, value: any, commit: any) {
  return h(
    "select",
    {
      class: "val debug-select",
      value: String(value),
      onChange: (event: any) => commit(event.target.value),
    },
    options.map((option: any) =>
      h(
        "option",
        {
          key: option.value,
          value: option.value,
          selected: option.value === String(value),
        },
        option.label,
      ),
    ),
  );
}

/** 
 * 두 가지 상태(켬/끔)를 전환하는 토글 버튼 컴포넌트입니다.
 *
 * @param on 현재 켜짐 여부
 * @param commit 사용자가 버튼을 클릭했을 때 상태를 변경하는 함수
 * @param labels 켜졌을 때와 꺼졌을 때 표시할 텍스트 배열 `[켜짐라벨, 꺼짐라벨]`
 * @returns Preact VNode 객체
 *
 * @example
 * ```tsx
 * {toggle(true, (val) => console.log(val), ['보이기', '숨기기'])}
 * ```
 */
function toggle(on: boolean, commit: any, labels: any) {
  return h(
    "button",
    {
      type: "button",
      class: "val debug-toggle" + (on ? " on" : ""),
      onClick: () => commit(!on),
    },
    on ? labels[0] : labels[1],
  );
}

// --- 블록 트리 --------------------------------------------------------------
const blockLabel = (block: any) => {
  const params = (block.params || [])
    .filter((p: any) => p !== null && p !== undefined && typeof p !== "object")
    .map((p: any) => JSON.stringify(p));
  return block.type + (params.length ? " (" + params.join(", ") + ")" : "");
};

const blockClass = (block: any) => {
  const at = highlighted.indexOf(block.id);
  if (at === 0) return "block-highlight";
  return at > 0 ? "block-highlight-child" : "";
};

function blockNode(block: any) {
  return h(
    "li",
    { key: block.id, "data-block-id": block.id, class: blockClass(block) },
    [
      h("span", { class: "block-type" }, blockLabel(block)),
      ...(block.params || [])
        .filter((param: any) => param && typeof param === "object" && param.type)
        .map((param: any, i: number) =>
          h("ul", { key: "p" + i, class: "block-param" }, blockNode(param)),
        ),
      ...(block.statements || [])
        .filter((branch: any) => Array.isArray(branch) && branch.length > 0)
        .map((branch: any, i: number) =>
          h("ul", { key: "s" + i, class: "block-body" }, branch.map(blockNode)),
        ),
    ],
  );
}

// --- 섹션 (위아래 크기 조절 · 딱 붙이기) ------------------------------------------
const startVerticalResize = (event: any, id: string) => {
  const section = event.currentTarget.closest(".debug-section");
  const startY = event.clientY;
  const startHeight = section.getBoundingClientRect().height;
  event.preventDefault();
  document.body.style.userSelect = "none";

  const move = (e: any) => {
    state.heights[id] = sticky(startHeight + (e.clientY - startY));
  };
  const up = () => {
    window.removeEventListener("mousemove", move);
    window.removeEventListener("mouseup", up);
    document.body.style.userSelect = "";
  };
  window.addEventListener("mousemove", move);
  window.addEventListener("mouseup", up);
};

/** 
 * 섹션 목록을 렌더링하고, 마지막 섹션을 제외한 나머지 섹션 하단에 높이 조절 핸들을 추가합니다.
 *
 * @param list 렌더링할 섹션 데이터 목록
 * @returns Preact VNode 배열
 *
 * @example
 * ```tsx
 * {sections([{ id: 'sec1', title: '섹션 1', body: h('div') }])}
 * ```
 */
function sections(list: any) {
  return list.map((section: any, index: number) => {
    const last = index === list.length - 1;
    const height = state.heights[section.id] ?? DEFAULT_SECTION_HEIGHT;
    let name = "debug-section";
    if (last) name += " debug-section-last";
    else if (height === 0) name += " collapsed";

    return h(
      "section",
      {
        key: section.id,
        class: name,
        style: last ? "" : "height:" + height + "px",
      },
      [
        h("h3", null, section.title),
        h("div", { class: "debug-section-body" }, section.body),
        last
          ? null
          : h("div", {
              class: "debug-vresize",
              title: "드래그해서 높이 조절 (끝까지 줄이면 접힙니다)",
              onMouseDown: (e: any) => startVerticalResize(e, section.id),
            }),
      ],
    );
  });
}

const empty = (text: string) => h("p", { class: "debug-empty" }, text);
const emptyRow = (text: string) =>
  h("li", { key: "empty", class: "debug-empty" }, text);

// ============================================================================
//  4. 탭
// ============================================================================
function RunTab() {
  const field = (id: string, label: string, value: any, options: any) =>
    h("div", { class: "debug-field" }, [
      h("label", { for: id }, label),
      h(
        "select",
        {
          id,
          value,
          onChange: (event: any) => {
            state.env[id.replace("env-", "")] = event.target.value;
          },
        },
        options.map(([v, text]: [string, string]) =>
          h("option", { key: v, value: v, selected: v === value }, text),
        ),
      ),
    ]);

  return sections([
    {
      id: "run-control",
      title: "실행 제어",
      body: [
        h(
          "p",
          {
            class:
              "debug-run-state" +
              (state.runState ? " state-" + state.runState : ""),
          },
          [
            h("span", { class: "dot" }),
            STATE_TEXT[state.runState] || "실행기를 기다리는 중…",
          ],
        ),
        h("div", { class: "debug-run-buttons" }, [
          h(
            "button",
            {
              type: "button",
              id: "run-btn",
              onClick: doRun,
              disabled: !state.runState || state.runState === "run",
            },
            "시작하기",
          ),
          h(
            "button",
            {
              type: "button",
              id: "pause-btn",
              onClick: doPause,
              disabled: !state.runState || state.runState === "stop",
            },
            state.runState === "pause" ? "이어서 하기" : "일시정지",
          ),
          h(
            "button",
            {
              type: "button",
              id: "stop-btn",
              onClick: doStop,
              disabled: !state.runState || state.runState === "stop",
            },
            "정지하기",
          ),
        ]),
        h("p", { class: "debug-note" }, [
          "정지한 뒤에도 ",
          h("b", null, "시작하기"),
          " 로 처음부터 다시 실행할 수 있습니다.",
        ]),
        h(
          "p",
          {
            class:
              "debug-note debug-pick-hint" + (state.picking ? " active" : ""),
            id: "pick-hint",
          },
          state.picking
            ? "오브젝트를 고르는 중… 실행 화면에서 누르세요."
            : "Ctrl+Shift 를 누른 채 실행 화면의 오브젝트를 누르면 오브젝트 탭에서 그 오브젝트가 열립니다.",
        ),
      ],
    },
    {
      id: "run-env",
      title: "실행 환경 흉내내기",
      body: [
        field("env-boost", "부스트 모드", state.env.boost, [
          ["", "실제 값 그대로"],
          ["true", "켜짐 (참)"],
          ["false", "꺼짐 (거짓)"],
        ]),
        h("p", { class: "debug-note" }, [
          "지금 실행기는 부스트 모드 " + realBoostLabel() + " 입니다 (",
          h("code", null, "run --boost"),
          " 로 정합니다). 위에서 고른 값은 '부스트 모드인가?' 블록이 돌려주는 값만 바꾸고," +
            " 실제로 쓰는 렌더러는 그대로입니다.",
        ]),
        field("env-device", "기기 종류", state.env.device, [
          ["", "실제 값 그대로"],
          ["desktop", "컴퓨터"],
          ["tablet", "태블릿"],
          ["mobile", "스마트폰"],
        ]),
        field("env-touch", "터치 지원", state.env.touch, [
          ["", "실제 값 그대로"],
          ["true", "지원함 (참)"],
          ["false", "지원 안 함 (거짓)"],
        ]),
      ],
    },
  ]);
}

/** 무대에 값을 띄울지 말지 (엔트리의 "변수 보이기/숨기기" 와 같은 것) */
const visibleToggle = (entry: any) =>
  toggle(
    entryVisible(entry.source),
    (next: any) => setEntryVisible(entry.source, next),
    ["보임", "숨김"],
  );

const expandClass = (key: string) =>
  "key debug-expand" + (state.expanded === key ? " open" : "");

function variableRow(entry: any) {
  return h("li", { key: entry.id }, [
    h("span", { class: "key" }, entry.name),
    " ",
    h("span", { class: "tag" }, entry.scope + " · " + entry.kind),
    " ",
    editable("var:" + entry.id, rawValue(entry.source), (text: string) =>
      setVariable(entry.id, text),
    ),
    " ",
    visibleToggle(entry),
  ]);
}

function listRow(entry: any) {
  const key = "list:" + entry.id;
  return h("li", { key: entry.id, class: "debug-list-head" }, [
    h(
      "button",
      {
        type: "button",
        class: expandClass(key),
        onClick: () => toggleExpanded(key),
      },
      entry.name,
    ),
    " ",
    h("span", { class: "tag" }, entry.scope + " · " + entry.kind),
    " ",
    h("span", { class: "val" }, liveValue(entry.source)),
    " ",
    visibleToggle(entry),
  ]);
}

/** 펼친 리스트 항목들 — 이름 줄이 아니라 그 다음 줄로 따로 낸다 */
function listItemsRow(entry: any) {
  const key = "list:" + entry.id;
  const array = listArray(entry.source);
  return h(
    "li",
    { key: entry.id + ":items", class: "debug-items-row" },
    h("div", { class: "debug-list-items" }, [
      h(
        "button",
        {
          type: "button",
          class: "debug-mini-btn debug-add-btn",
          onClick: () => addListItem(entry.id),
        },
        "항목 추가",
      ),
      array.length === 0
        ? h("p", { class: "debug-empty" }, "비어 있습니다.")
        : h(
            "ol",
            { class: "debug-list-ol" },
            array.map((item: any, index: number) =>
              h("li", { key: index }, [
                h("span", { class: "debug-list-index" }, index + 1),
                editable(key + ":" + index, (array[index] || {}).data, (text: string) =>
                  setListItem(entry.id, index, text),
                ),
                h(
                  "button",
                  {
                    type: "button",
                    class: "debug-mini-btn",
                    title: "이 항목 지우기",
                    onClick: () => removeListItem(entry.id, index),
                  },
                  "−",
                ),
              ]),
            ),
          ),
    ]),
  );
}

function functionRow(fn: any) {
  const key = "func:" + fn.id;
  return h("li", { key: fn.id, class: "debug-list-head" }, [
    h(
      "button",
      {
        type: "button",
        class: expandClass(key),
        onClick: () => toggleExpanded(key),
      },
      fn.name,
    ),
    " ",
    h("span", { class: "tag" }, fn.params + "개 인자"),
    " ",
    h("span", { class: "val" }, fn.kind),
  ]);
}

function functionCodeRow(fn: any) {
  const content = functionContentById.get(fn.id);
  return h(
    "li",
    { key: fn.id + ":code", class: "debug-items-row" },
    h(
      "div",
      { class: "debug-list-items debug-func-code" },
      !content || content.length === 0
        ? h("p", { class: "debug-empty" }, "블록을 읽지 못했습니다.")
        : h("ul", null, content.map(blockNode)),
    ),
  );
}

function DataTab() {
  const varRows = [];
  if (state.variables.length === 0)
    varRows.push(emptyRow("변수나 리스트가 없습니다."));
  else {
    for (const entry of state.variables) {
      if (entry.source.variableType !== "list") {
        varRows.push(variableRow(entry));
        continue;
      }
      varRows.push(listRow(entry));
      if (state.expanded === "list:" + entry.id)
        varRows.push(listItemsRow(entry));
    }
  }

  const fnRows = [];
  if (state.functions.length === 0) fnRows.push(emptyRow("함수가 없습니다."));
  else {
    for (const fn of state.functions) {
      fnRows.push(functionRow(fn));
      if (state.expanded === "func:" + fn.id) fnRows.push(functionCodeRow(fn));
    }
  }

  return sections([
    {
      id: "data-vars",
      title: "변수 · 리스트",
      body: h(
        "div",
        { id: "var-list" },
        h("ul", { class: "debug-rows" }, varRows),
      ),
    },
    {
      id: "data-signals",
      title: "신호",
      body: h(
        "div",
        { id: "signal-list" },
        state.messages.length === 0
          ? empty("신호가 없습니다.")
          : h(
              "ul",
              { class: "debug-rows" },
              state.messages.map((message: any) =>
                h("li", { key: message.id }, [
                  h("span", { class: "key" }, message.name),
                  h(
                    "button",
                    {
                      type: "button",
                      class: "debug-send-btn",
                      onClick: () => sendSignal(message.id),
                    },
                    "보내기",
                  ),
                ]),
              ),
            ),
      ),
    },
    {
      id: "data-functions",
      title: "함수",
      body: h(
        "div",
        { id: "function-list" },
        h("ul", { class: "debug-rows" }, fnRows),
      ),
    },
  ]);
}

/** 지금 고른 오브젝트의 실행기 쪽 짝 */
const currentLive = () =>
  state.currentId ? liveEntity(state.currentId) : null;

function objectInfoRows() {
  const live = currentLive();
  const infoRow = (label: string, body: any) =>
    h("li", { key: label }, [h("span", { class: "key" }, label), " ", body]);

  if (!live) {
    return [
      infoRow(
        "",
        h(
          "span",
          { class: "debug-empty" },
          state.currentId
            ? "실행기가 이 오브젝트를 아직 만들지 않았습니다. 한 번 실행해 보세요."
            : "위 목록에서 오브젝트를 고르세요.",
        ),
      ),
    ];
  }

  const isText = live.entity.text !== undefined;
  const rows = [];
  for (const field of ENTITY_FIELDS) {
    const value = field.get(live.entity);
    rows.push(
      infoRow(
        field.label,
        field.set
          ? editable("entity:" + field.key, value, (text: string) =>
              field.set(state.currentId, text),
            )
          : h("span", { class: "val" }, String(value)),
      ),
    );
  }

  if (!isText) {
    const pictures = ((live.object && live.object.pictures) || []).map((p: any) => ({
      value: p.id,
      label: p.name || p.id,
    }));
    rows.push(
      infoRow(
        "모양",
        chooser(
          pictures,
          live.entity.picture ? live.entity.picture.id : "",
          (id: string) => setPicture(state.currentId, id),
        ),
      ),
    );
    rows.push(
      infoRow(
        "모양 번호",
        h("span", { class: "val" }, pictureInfo(live).index),
      ),
    );
  }

  rows.push(
    infoRow(
      "보이기",
      toggle(
        call(live.entity, "getVisible", true),
        (next: any) => setEntityVisible(state.currentId, next),
        ["보임", "숨김"],
      ),
    ),
  );

  if (!isText) {
    rows.push(
      infoRow(
        "회전 방식",
        chooser(
          ROTATE_METHODS,
          (live.object && live.object.rotateMethod) || "free",
          (method: any) => setRotateMethod(state.currentId, method),
        ),
      ),
    );
  } else {
    // 글상자는 글 내용도 여기서 바로 고친다
    rows.push(
      infoRow(
        "글 내용",
        editable("entity:text", live.entity.text, (text: string) =>
          setEntityText(state.currentId, text),
        ),
      ),
    );
  }
  return rows;
}

function ObjectsTab() {
  const suffix = state.currentName ? "— " + state.currentName : "";
  return sections([
    {
      id: "objects-tree",
      title: "장면 · 오브젝트",
      body: h(
        "div",
        { id: "scene-tree" },
        state.scenes.length === 0
          ? empty("불러오는 중…")
          : state.scenes.map((scene: any) =>
              h("div", { key: scene.id }, [
                h("div", { class: "debug-scene-title" }, [
                  h("span", null, scene.name),
                  h(
                    "button",
                    {
                      type: "button",
                      class: "debug-mini-btn debug-scene-go",
                      "data-scene-id": scene.id,
                      title: "이 장면으로 넘어가서 바로 실행하기",
                      onClick: () => goToScene(scene.id),
                    },
                    "바로가기",
                  ),
                ]),
                h(
                  "ul",
                  { class: "debug-object-list" },
                  scene.objects.length === 0
                    ? h("li", { class: "debug-empty" }, "(오브젝트 없음)")
                    : scene.objects.map((object: any) =>
                        h(
                          "li",
                          { key: object.id },
                          h(
                            "button",
                            {
                              type: "button",
                              class:
                                "debug-object-btn" +
                                (state.currentId === object.id
                                  ? " active"
                                  : ""),
                              "data-object-id": object.id,
                              onClick: () => showObject(object),
                            },
                            object.name,
                          ),
                        ),
                      ),
                ),
              ]),
            ),
      ),
    },
    {
      id: "objects-info",
      title: ["오브젝트 정보 ", h("span", { id: "object-info-name" }, suffix)],
      body: h(
        "div",
        { id: "object-info" },
        h("ul", { class: "debug-rows" }, objectInfoRows()),
      ),
    },
    {
      id: "objects-blocks",
      title: ["컴파일된 블록 ", h("span", { id: "block-object-name" }, suffix)],
      body: h("div", { id: "block-tree" }, blockTree()),
    },
  ]);
}

function blockTree() {
  if (!state.currentId) return empty("위 목록에서 오브젝트를 고르세요.");
  if (currentThreads.length === 0)
    return empty("이 오브젝트에는 블록이 없습니다.");
  return currentThreads.map((thread, index) =>
    h("div", { key: index, class: "debug-thread" }, [
      h("div", { class: "debug-thread-label" }, "스크립트 " + (index + 1)),
      h("ul", null, thread.map(blockNode)),
    ]),
  );
}

function ErrorsTab() {
  return sections([
    {
      id: "errors-log",
      title: "오류 로그",
      body: h(
        "div",
        { id: "error-log" },
        state.errors.length === 0
          ? empty(
              "아직 오류가 없습니다. entryjs 가 실행 중 panic 을 내면 여기와 이 서버를 띄운 터미널에 같이 찍힙니다.",
            )
          : state.errors.map((error: any, index: number) =>
              h(
                "details",
                {
                  key: error.key,
                  class: "error-item",
                  open: index < 3,
                },
                [
                  h(
                    "summary",
                    null,
                    "[" + error.at + "] " + error.kind + ": " + error.message,
                  ),
                  error.stack ? h("pre", null, error.stack) : null,
                ],
              ),
            ),
      ),
    },
  ]);
}

const TAB_BODY: Record<string, () => any> = {
  run: RunTab,
  data: DataTab,
  objects: ObjectsTab,
  errors: ErrorsTab,
};

// --- 패널 폭 조절 (딱 붙이기) ----------------------------------------------------
const startHorizontalResize = (event: any) => {
  event.preventDefault();
  document.body.style.userSelect = "none";
  const move = (e: any) => {
    const max = Math.max(STICKY, window.innerWidth - 240);
    const width = sticky(Math.min(window.innerWidth - e.clientX, max));
    panel.style.width = width + "px";
    panel.classList.toggle("collapsed", width === 0);
    syncPanelWidth();
  };
  const up = () => {
    window.removeEventListener("mousemove", move);
    window.removeEventListener("mouseup", up);
    document.body.style.userSelect = "";
  };
  window.addEventListener("mousemove", move);
  window.addEventListener("mouseup", up);
};

// --- 패널 전체 ---------------------------------------------------------------
function Panel() {
  return [
    h("div", {
      id: "debug-resize-handle",
      title: "드래그해서 크기 조절 (끝까지 줄이면 접힙니다)",
      onMouseDown: startHorizontalResize,
    }),
    h("div", { class: "debug-header" }, [
      h("h2", null, "디버그"),
      h(
        "button",
        {
          id: "debug-close",
          type: "button",
          "aria-label": "닫기",
          onClick: closePanel,
        },
        "×",
      ),
    ]),
    h(
      "div",
      { class: "debug-tabs", role: "tablist" },
      TABS.map((tab) =>
        h(
          "button",
          {
            key: tab.id,
            type: "button",
            role: "tab",
            class: "debug-tab",
            "data-tab": tab.id,
            "aria-controls": "tab-" + tab.id,
            "aria-selected": state.tab === tab.id ? "true" : "false",
            onClick: () => {
              state.tab = tab.id;
            },
          },
          [
            tab.label,
            tab.id === "errors"
              ? h(
                  "span",
                  {
                    id: "error-count",
                    class: "badge",
                    hidden: state.errors.length === 0,
                  },
                  state.errors.length,
                )
              : null,
          ],
        ),
      ),
    ),
    // 안 보이는 탭은 아예 그리지 않는다 — 블록 트리가 수만 개짜리 작품도 있다.
    ...TABS.map((tab) =>
      h(
        "div",
        {
          key: tab.id,
          class: "debug-panelbody",
          id: "tab-" + tab.id,
          role: "tabpanel",
          hidden: state.tab !== tab.id,
        },
        state.tab === tab.id ? h(TAB_BODY[tab.id], null) : null,
      ),
    ),
  ];
}

render(h(Panel, null), panel);

// ============================================================================
//  5. 바깥 연결
// ============================================================================
const toggleBtn = document.getElementById("debug-toggle")!;
const badge = document.getElementById("debug-badge")!;
toggleBtn.addEventListener("click", () =>
  state.open ? closePanel() : openPanel(),
);

window.tessDebugSink((item) => {
  state.errors.unshift({
    key: item.time + "-" + state.errors.length,
    at: new Date(item.time).toLocaleTimeString("ko-KR", { hour12: false }),
    kind: item.kind,
    message: item.message,
    stack: item.stack,
  });
  badge.hidden = false;
  badge.textContent = String(state.errors.length);
  if (state.errors.length === 1) openPanel("errors");
});

const indexBlocks = (node: any, object: any) => {
  if (Array.isArray(node)) {
    for (const item of node) indexBlocks(item, object);
    return;
  }
  if (!node || typeof node !== "object" || !node.id) return;
  blockOwner.set(node.id, object);
  blockById.set(node.id, node);
  for (const param of node.params || []) indexBlocks(param, object);
  for (const branch of node.statements || []) indexBlocks(branch, object);
};

window.tessRenderProjectDebug = function renderProjectDebug(loaded) {
  project = loaded;
  const nameById = new Map(
    project.objects.map((object: any) => [object.id, object.name]),
  );

  state.scenes = project.scenes.map((scene: any) => ({
    id: scene.id,
    name: scene.name,
    objects: project.objects
      .filter((object: any) => object.scene === scene.id)
      .map((object: any) => ({
        id: object.id,
        name: object.name,
        script: object.script,
      })),
  }));

  state.variables = (project.variables || [])
    .filter(
      (entry: any) =>
        entry.variableType !== "timer" && entry.variableType !== "answer",
    )
    .map((entry: any) => ({
      id: entry.id,
      name: entry.name,
      scope: entry.object ? nameById.get(entry.object) || "오브젝트" : "전역",
      kind: entry.variableType === "list" ? "리스트" : "변수",
      source: entry,
    }));
  state.messages = (project.messages || []).map((message: any) => ({
    id: message.id,
    name: message.name,
  }));
  state.functions = (project.functions || []).map(describeFunction);

  // 함수 코드는 펼쳤을 때 그린다. 블록 트리는 반응형 밖에 둔다(크다).
  functionContentById.clear();
  for (const fn of project.functions || []) {
    try {
      const create = JSON.parse(fn.content || "[]")[0][0];
      functionContentById.set(
        fn.id,
        (create && create.statements && create.statements[0]) || [],
      );
      indexBlocks(create, { id: "func:" + fn.id, name: fn.id });
    } catch (error) {
      /* 못 읽으면 펼쳤을 때 안내만 보여 준다 */
    }
  }

  for (const object of project.objects) {
    try {
      indexBlocks(JSON.parse(object.script), object);
    } catch (e) {
      /* 블록을 못 읽어도 목록은 보여준다 */
    }
  }
  if (project.objects.length > 0) showObject(project.objects[0]);
};

/** 이 블록과 그 안에 값으로 꽂힌 블록들의 id. 실제 원인이 자식 쪽일 수 있다. */
window.tessCollectParamIds = function collectParamIds(node, out) {
  out = out || [];
  if (!node || typeof node !== "object" || !node.id) return out;
  out.push(node.id);
  for (const param of node.params || []) {
    if (param && typeof param === "object" && param.type)
      collectParamIds(param, out);
  }
  return out;
};

window.tessBlockDataById = blockById;

window.tessHighlightBlock = function highlightBlock(blockId) {
  const owner = blockOwner.get(blockId);
  if (!owner) return;
  if (state.currentId !== owner.id) showObject(owner);
  highlighted = window.tessCollectParamIds(blockById.get(blockId), []);
  touch();
  openPanel("objects");
  requestAnimationFrame(() => {
    const target = panel.querySelector('[data-block-id="' + blockId + '"]');
    if (target && target.scrollIntoView)
      target.scrollIntoView({ block: "center" });
  });
};

/** 실행 화면에서 고른 오브젝트를 디버거에서 연다 */
const selectObjectById = (objectId: string) => {
  const found =
    (project &&
      project.objects &&
      project.objects.find((o: any) => o.id === objectId)) ||
    blockOwner.get(objectId);
  if (!found || !found.script) return;
  showObject(found);
  openPanel("objects");
  // 오브젝트가 149개나 되는 작품도 있어서, 고른 줄이 목록 밖에 있으면 안 보인다
  requestAnimationFrame(() => {
    const row = panel.querySelector('[data-object-id="' + objectId + '"]');
    if (row && row.scrollIntoView) row.scrollIntoView({ block: "nearest" });
  });
};

window.tessSelectObjectById = selectObjectById;

/**
 * Ctrl+Shift + 실행 화면 클릭 -> 그 오브젝트를 디버거에서 고른다.
 *
 * 어느 오브젝트를 눌렀는지는 엔트리가 이미 알고 있다 — 오브젝트마다 붙은 마우스
 * 핸들러가 `entityClick` 이벤트를 쏘고, 거기 실린 entity 의 `parent` 가 그 오브젝트다
 * (entryjs class/entity.js). 그림 모양 그대로 맞히므로 우리가 좌표로 다시 계산하는
 * 것보다 정확하고, PIXI/createjs 어느 쪽으로 그리든 똑같이 동작한다.
 *
 * 예전에는 고르는 창을 `setTimeout(…, 0)` 으로 열었는데, 그래서 잘 안 먹었다.
 * `entityClick` 은 우리가 듣는 pointerdown 과 같은 차례에 오지 않는다 — createjs 는
 * 뒤이어 오는 mousedown 에서, PIXI(부스트 모드)는 제 ticker 에서 쏘기 때문에 둘 다
 * 다음 차례로 넘어간다. 0ms 짜리 창은 그 전에 닫혀 버린다. 그래서 창을 넉넉히 열어
 * 두고, 오브젝트를 고르는 순간(또는 시간이 다 되면) 닫는다.
 */
const PICK_WINDOW = 400;

// 엔트리 무대의 논리 크기. 화면에 어떻게 늘어나 있든 좌표는 늘 이 칸으로 센다.
const STAGE_WIDTH = 480;
const STAGE_HEIGHT = 270;

/**
 * 실행 화면을 그리는 캔버스.
 *
 * 그냥 `#workspace canvas` 로 찾으면 안 된다 — 부스트 모드(WebGL)에서는 PIXI 가
 * 글자 따위를 그리려고 눈에 안 보이는 도우미 캔버스를 열 몇 개나 먼저 만들어 둬서,
 * 첫 번째로 걸리는 것이 크기 0 짜리 엉뚱한 캔버스다. 그러면 좌표를 못 재서 무대를
 * 눌러도 고르기가 아예 시작되지 않는다. 엔트리가 붙이는 이름으로 집는다.
 */
function stageCanvas() {
  const named = document.getElementById("entryCanvas");
  if (named) return named;

  // 이름이 바뀌었더라도 화면에서 자리를 가장 많이 차지한 것이 무대다.
  let best = null;
  let bestArea = 0;
  for (const canvas of document.querySelectorAll("#workspace canvas")) {
    const rect = canvas.getBoundingClientRect();
    const area = rect.width * rect.height;
    if (area > bestArea) {
      best = canvas;
      bestArea = area;
    }
  }
  return best;
}

/** 화면 좌표를 무대 좌표로. 무대는 가운데가 (0,0) 이고 y 가 위로 자란다. */
function toStagePoint(clientX: number, clientY: number) {
  const canvas = stageCanvas();
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  return {
    x: ((clientX - rect.left) / rect.width) * STAGE_WIDTH - STAGE_WIDTH / 2,
    y: STAGE_HEIGHT / 2 - ((clientY - rect.top) / rect.height) * STAGE_HEIGHT,
  };
}

/**
 * 누른 자리가 실행 화면 안인가.
 *
 * 눌린 요소가 무대 안에 있는지로 따지면 안 된다 — 작품이 멈춰 있는 동안 엔트리가
 * 덮어 두는 "눌러서 시작" 판은 `#workspace` **바깥**에 붙어서, 정작 오브젝트를
 * 살펴보고 싶은 그때 이 판정이 늘 빗나갔다. 캔버스가 놓인 자리로 따진다.
 */
function insideStage(event: any) {
  const canvas = stageCanvas();
  if (!canvas) {
    // 캔버스가 아직 없으면(또는 테스트라면) 무대 상자 안인지로 본다
    const stage = document.getElementById("workspace");
    return Boolean(stage && stage.contains(event.target));
  }
  const rect = canvas.getBoundingClientRect();
  return (
    event.clientX >= rect.left &&
    event.clientX <= rect.right &&
    event.clientY >= rect.top &&
    event.clientY <= rect.bottom
  );
}

/**
 * 그 자리에 있는 오브젝트를 앞에 있는 것부터 찾는다.
 *
 * 엔트리가 쏘는 `entityClick` 만 기다리면 안 된다 — 그 이벤트는 늘 오지 않는다.
 * 멈춰 있을 때는 "눌러서 시작" 덮개(<div>)가 클릭을 먼저 먹어서 캔버스까지 가지도
 * 않고, 실행 중이어도 렌더러에 따라 다음 차례로 넘어간다. 경계 상자로 직접 맞히면
 * 멈춰 있든 돌고 있든, 2D 든 WebGL 이든 언제나 답이 나온다.
 *
 * `Entry.container.objects_` 는 앞에 있는 것이 먼저다.
 */
/**
 * 지금 장면에 있는 오브젝트만, 앞에 있는 것부터.
 *
 * `Entry.container.objects_` 에는 **모든 장면의** 오브젝트가 다 들어 있고, 다른 장면
 * 것도 `getVisible()` 이 참인 채로 제자리에 남아 있다(마녀 작품 기준 558개 중 지금
 * 장면은 13개, 다른 장면인데 보이는 것으로 잡히는 게 285개). 이걸 그대로 훑으면 화면에
 * 있지도 않은 다른 장면의 배경이 먼저 걸려서, 장면을 한 번 넘긴 뒤로는 엉뚱한
 * 오브젝트만 골라진다.
 */
function stageObjects() {
  const container = window.Entry && Entry.container;
  if (!container) return [];
  try {
    const current = container.getCurrentObjects?.();
    if (Array.isArray(current)) return current;
  } catch (error) {
    /* 아래에서 직접 걸러 낸다 */
  }

  const all = Array.isArray(container.objects_) ? container.objects_ : [];
  const sceneId = window.Entry?.scene?.selectedScene?.id;
  if (!sceneId) return all;
  return all.filter((object: any) => (object.scene?.id ?? object.scene) === sceneId);
}

function objectAtPoint(clientX: number, clientY: number) {
  const point = toStagePoint(clientX, clientY);
  const objects = stageObjects();
  if (!point) return null;

  for (const object of objects) {
    const entity = object && object.entity;
    if (!entity) continue;
    try {
      if (typeof entity.getVisible === "function" && !entity.getVisible())
        continue;
      // 완전히 투명한 오브젝트는 화면에 없는 것과 같다. 무대를 덮는 투명한 판이
      // 하나 있으면 어디를 눌러도 그것만 잡혀서 고르기가 안 되는 것처럼 보인다.
      if (entity.effect && entity.effect.alpha === 0) continue;
      const halfWidth =
        Math.abs(entity.getWidth() * (entity.getScaleX() ?? 1)) / 2;
      const halfHeight =
        Math.abs(entity.getHeight() * (entity.getScaleY() ?? 1)) / 2;
      if (
        Math.abs(point.x - entity.getX()) <= halfWidth &&
        Math.abs(point.y - entity.getY()) <= halfHeight
      )
        return object;
    } catch (error) {
      /* 이 오브젝트는 건너뛴다 */
    }
  }
  return null;
}

/** The stage-pick listeners are installed once, however often this is called. */
let stagePicksArmed = false;

window.tessWatchStagePicks = function watchStagePicks() {
  if (stagePicksArmed) return;
  stagePicksArmed = true;

  /**
   * Ctrl+Shift 로 무대를 누른 것인가.
   *
   * 이 판정에는 남아 있는 상태가 하나도 없다 — 누를 때마다 이벤트만 보고 새로
   * 판단한다. 예전에는 "고르는 중" 플래그와 실행기 함수 바꿔치기를 걸어 뒀는데,
   * 그 중 하나라도 되돌아오지 못하면 그 뒤로는 영영 안 먹었다.
   */
  const isPick = (event: any) =>
    event.ctrlKey && event.shiftKey && event.button === 0 && insideStage(event);

  // 눌렀다는 표시만 잠깐 켠다. 화면에 보이기만 할 뿐 고르는 일에는 관여하지 않는다.
  let hintTimer: ReturnType<typeof setTimeout> | undefined;
  const flashHint = () => {
    state.picking = true;
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => {
      state.picking = false;
    }, PICK_WINDOW);
  };

  const onDown = (event: any) => {
    if (!isPick(event)) return;
    // 이 클릭은 디버깅하려고 누른 것이다. 작품을 시작시키거나 진행시키면 안 되므로
    // 덮개도 캔버스도 이 이벤트를 보지 못하게 여기서 끊는다. 실행기까지 못 가므로
    // "오브젝트를 클릭했을 때" 도 돌지 않는다.
    event.preventDefault();
    event.stopPropagation();
    flashHint();

    const object = objectAtPoint(event.clientX, event.clientY);
    if (object && object.id) selectObjectById(object.id);
  };

  // 누른 뒤에 잇따라 오는 것들도 같은 기준으로 삼킨다. 멈춰 있는 작품 위에 덮인
  // "눌러서 시작" 판은 click 으로 시작하므로, 이걸 막지 않으면 오브젝트를 살펴보려던
  // 클릭이 작품을 시작시켜 버린다.
  const swallow = (event: any) => {
    if (!isPick(event)) return;
    event.preventDefault();
    event.stopPropagation();
  };

  // createjs 는 mousedown, PIXI 는 pointerdown 을 쓴다. 둘 다 듣는다.
  document.addEventListener("pointerdown", onDown, true);
  document.addEventListener("mousedown", onDown, true);
  document.addEventListener("mouseup", swallow, true);
  document.addEventListener("pointerup", swallow, true);
  document.addEventListener("click", swallow, true);
};

/** value_of_index_from_list 의 "can not insert value to array" 를 리스트 이름·길이가 담긴 메시지로 바꾼다 */
window.tessDescribeListIndexError = function describeListIndexError(
  reportedBlockId,
  err,
) {
  if (!err || err.message !== "can not insert value to array") return null;
  const find = (node: any): any => {
    if (!node || typeof node !== "object") return null;
    if (node.type === "value_of_index_from_list") return node;
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
    const indexText =
      indexParam &&
      typeof indexParam === "object" &&
      indexParam.type === "number" &&
      Array.isArray(indexParam.params)
        ? indexParam.params[0]
        : null;

    let listName = listId;
    let count = null;
    const list =
      listId &&
      window.Entry &&
      Entry.variableContainer &&
      Entry.variableContainer.getList
        ? Entry.variableContainer.getList(listId)
        : null;
    if (list) {
      if (typeof list.getName === "function") listName = list.getName();
      if (typeof list.getArray === "function") count = list.getArray().length;
    }

    let message = "'" + (listName || "리스트") + "' 리스트에서 ";
    message += indexText !== null ? indexText + "번째" : "요청한";
    message += " 항목을 찾지 못했습니다";
    message += count === null ? "." : " (지금 " + count + "개 들어 있습니다).";
    return message;
  } catch (e) {
    return "리스트에서 요청한 위치의 항목을 찾지 못했습니다 (범위를 벗어났습니다).";
  }
};

// --- 캔버스 배치 ------------------------------------------------------------
let resolutionFixed = false;

// Buffer size every hard-coded pixel offset inside entryjs assumes.
const ENTRY_BUFFER_WIDTH = 640;
const ENTRY_BUFFER_HEIGHT = 360;

/** Drawing buffer width to aim for: the widest the stage is ever shown at. */
const wantedBufferWidth = () => {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const wanted =
    Math.max(window.screen?.width || window.innerWidth, window.innerWidth) *
    dpr;
  return Math.round(Math.min(Math.max(wanted, 960), 1920));
};

/**
 * Rescales the ask() input box to the canvas buffer we actually use.
 * Entry draws it onto the canvas at raw pixel offsets (x 15, y 275, width 520)
 * that assume a 640x360 buffer, so a bigger buffer leaves it small in the
 * top-left corner. The stage-local submit button and the hit test both stay in
 * entry coordinates, so scaling every length by the same ratio lines them up.
 */
const scaleInputFieldToBuffer = (bufferW: any) => {
  const stage = window.Entry && Entry.stage;
  const ratio = bufferW / ENTRY_BUFFER_WIDTH;
  if (!stage || typeof stage.showInputField !== "function" || ratio === 1)
    return;
  const showInputField = stage.showInputField;
  stage.showInputField = function tessShowInputField(this: any, ...args: any[]) {
    showInputField.apply(this, args);
    const field = this.inputField;
    if (!field || field.tessScaled || typeof field.width !== "function") return;
    field.tessScaled = true;
    // These setters return undefined, so they cannot be chained. Lengths that
    // feed outerW/outerH go before the position so the last call redraws.
    for (const name of [
      "fontSize",
      "borderWidth",
      "borderRadius",
      "padding",
      "width",
      "height",
      "x",
      "y",
    ]) {
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

    const bufferW = wantedBufferWidth();
    // Boost mode draws through PIXI, which owns the canvas: writing to
    // canvasEl.width behind its back would leave it rendering into one corner.
    // Raising the renderer resolution instead keeps the stage in entry's
    // 640x360 space, so every hard-coded offset in entryjs still lands right.
    const renderer = stage._app && stage._app.renderer;
    if (
      renderer &&
      typeof renderer.resize === "function" &&
      typeof renderer.resolution === "number"
    ) {
      renderer.resolution = bufferW / ENTRY_BUFFER_WIDTH;
      renderer.resize(ENTRY_BUFFER_WIDTH, ENTRY_BUFFER_HEIGHT);
      // The interaction plugin keeps its own copy, taken once in setTargetElement,
      // and divides the raw buffer offset by it (mapPositionToPoint). Left at 1 it
      // reports hits at <resolution> times the real distance from the top-left.
      const interaction = renderer.plugins && renderer.plugins.interaction;
      if (interaction) interaction.resolution = renderer.resolution;
    } else {
      const bufferH = Math.round((bufferW * 9) / 16);
      canvasEl.width = bufferW;
      canvasEl.height = bufferH;
      stage.canvas.x = bufferW / 2;
      stage.canvas.y = bufferH / 2;
      stage.canvas.scaleX = bufferW / 480;
      stage.canvas.scaleY = bufferW / 480;
      scaleInputFieldToBuffer(bufferW);
    }
    Entry.requestUpdate = true;
    resolutionFixed = true;
  } catch (e) {
    /* 실패하면 엔트리 기본 해상도를 쓴다 */
  }
};

/**
 * Entry caches the canvas client rect and only refreshes it on window resize,
 * so mouse coordinate blocks read stale positions after the debug panel moves
 * or resizes the stage.
 */
const refreshBoundRect = () => {
  const stage = window.Entry && Entry.stage;
  if (stage && typeof stage.updateBoundRect === "function")
    stage.updateBoundRect();
};

/** 남은 공간에 16:9 로 꽉 차도록 캔버스의 CSS 크기만 맞춘다 */
window.tessLayoutCanvas = function layoutCanvas() {
  const workspace = document.getElementById("workspace");
  const canvas = document.getElementById("entryCanvas");
  if (!workspace || !canvas) return;
  const engineBar = document.querySelector(".entryEngine");
  const engineHeight = engineBar ? engineBar.getBoundingClientRect().height : 0;
  // clientWidth 는 padding(디버그 패널 자리)을 포함하므로 그만큼 뺀다
  const panelWidth =
    parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue(
        "--debug-panel-width",
      ),
    ) || 0;
  const availW = workspace.clientWidth - panelWidth;
  const availH = Math.max(workspace.clientHeight - engineHeight, 60);
  if (availW <= 0 || availH <= 0) return;
  const targetW = Math.min(availW, Math.floor((availH * 16) / 9));
  canvas.style.width = targetW + "px";
  canvas.style.height = Math.floor((targetW * 9) / 16) + "px";
  setCanvasResolution();
  refreshBoundRect();
};
window.addEventListener("resize", () => window.tessLayoutCanvas());

// Opening the panel slides the stage sideways over a CSS transition, so its
// final position is only known once that transition ends.
document
  .getElementById("workspace")
  ?.addEventListener("transitionend", (event) => {
    if (event.propertyName === "padding-right") refreshBoundRect();
  });

setInterval(() => {
  state.runState = engineState();
  if (state.open && (state.tab === "data" || state.tab === "objects"))
    state.tick += 1;
  if (window.Entry && window.tessWatchStagePicks) window.tessWatchStagePicks();
  refreshBoundRect();
}, 400);
