// ============================================================================
//  컴파일한 작품을 브라우저에서 열어 보기 위한 페이지
//
//  엔트리 실행기(entryjs)는 서드파티 라이브러리가 많아서 통째로 담지 않고
//  다음 순서로 찾는다.
//    1. 프로젝트에 설치된 node_modules/@entrylabs/entry  (오프라인)
//    2. jsDelivr / unpkg CDN                              (기본)
//  둘 다 못 쓰면 페이지가 그 사실을 알려 주고, 작품 파일을 내려받아
//  playentry.org 에서 여는 길을 안내한다.
//
//  entry.min.js 는 그 자체로 완결된 파일이 아니라, 아래 서드파티 라이브러리들이
//  전역 변수(createjs, _, EntryTool, EntryVideoLegacy, React, ...)로 먼저
//  준비돼 있어야 한다 (entryjs 의 webpack externals 설정과 동일).
//  이 라이브러리들이 없으면 entry.min.js 를 불러오는 도중 조용히 실패해서
//  `Entry.init` 이 함수가 아니게 되고, 결국 "엔트리를 불러오지 못했습니다"
//  화면만 뜨게 된다 — 이게 이 파일에서 고친 로딩 오류의 원인이었다.
// ============================================================================

/** entry.min.js 가 실행되기 전에 전역으로 준비돼 있어야 하는 서드파티 라이브러리 */
export const THIRD_PARTY_SCRIPTS = [
  'https://cdn.jsdelivr.net/npm/jquery@3.7.1/dist/jquery.min.js',
  'https://cdn.jsdelivr.net/npm/createjs@1.0.1/builds/1.0.0/createjs.min.js',
  'https://cdn.jsdelivr.net/npm/lodash@4.17.21/lodash.min.js',
  'https://cdn.jsdelivr.net/npm/jquery-ui-dist@1.13.2/jquery-ui.min.js',
  'https://cdn.jsdelivr.net/npm/velocity-animate@1.5.2/velocity.min.js',
  'https://cdn.jsdelivr.net/npm/react@16.14.0/umd/react.production.min.js',
  'https://cdn.jsdelivr.net/npm/react-dom@16.14.0/umd/react-dom.production.min.js',
  'https://cdn.jsdelivr.net/npm/@entrylabs/tool@2.0.9/dist/entry-tool.js',
  'https://cdn.jsdelivr.net/npm/@entrylabs/legacy-video@1.0.1/dist/index.js',
];

export const THIRD_PARTY_STYLE = 'https://cdn.jsdelivr.net/npm/@entrylabs/tool@2.0.9/dist/entry-tool.css';

// 엔트리가 쓰는 한글 글꼴(나눔고딕코딩·둥근모꼴·잘난체 …)의 @font-face 정의.
// entryjs 자체에는 없고 playentry.org 페이지가 따로 붙이는 스타일이라, 우리 플레이어도
// 이 CSS 를 불러오지 않으면 `font = "DungGeunMo"` 같은 글씨체가 전부 기본 글꼴로
// 대체돼 보인다(플레이어 자체는 로컬이라도, 이 CSS 와 그 안의 폰트 파일은 엔트리의
// 공개 CDN 이라 인터넷이 되면 그대로 받아 쓸 수 있다). 실제 목록은
// https://playentry.org 페이지가 불러오는 https://entry-cdn.pstatic.net/uploads/fonts/fonts_2023_10.css 에서 확인했다.
export const ENTRY_FONTS_STYLE = 'https://entry-cdn.pstatic.net/uploads/fonts/fonts_2023_10.css';

/** entryjs 가 필요로 하는 파일들 (엔트리 공식 문서의 순서 그대로) */
export const RUNTIME_FILES = [
  'extern/util/filbert.js',
  'extern/util/CanvasInput.js',
  'extern/util/ndgmr.Collision.js',
  'extern/util/handle.js',
  'extern/util/bignumber.min.js',
  'extern/lang/ko.js',
  'extern/util/static.js',
  'dist/entry.min.js',
];

export const RUNTIME_STYLE = 'dist/entry.css';

const escapeHtml = (text) => String(text)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

/**
 * @param {{name: string, base: string, summary: object, entName: string, reload?: boolean}} options
 *   base 는 entryjs 파일들을 가져올 곳 (`/lib` 또는 CDN 주소)
 *   reload 가 true 면 서버가 다시 컴파일할 때마다 페이지를 자동으로 새로고침한다
 */
export function playerPage({ name, base, summary, entName, reload = true }) {
  const thirdPartyScripts = THIRD_PARTY_SCRIPTS
    .map((url) => `<script src="${url}"></script>`)
    .join('\n    ');
  const runtimeScripts = RUNTIME_FILES
    .map((file) => `<script src="${base}/${file}"></script>`)
    .join('\n    ');

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(name)} — Tess</title>
<link rel="stylesheet" href="${THIRD_PARTY_STYLE}">
<link rel="stylesheet" href="${base}/${RUNTIME_STYLE}">
<link rel="stylesheet" href="${ENTRY_FONTS_STYLE}">
<style>
  :root { color-scheme: light dark; }
  html, body { height: 100%; }
  body {
    margin: 0; font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    background: #f4f5f7; color: #16181d;
    display: flex; flex-direction: column; overflow: hidden;
  }
  @media (prefers-color-scheme: dark) { body { background: #16181d; color: #e8eaee; } }
  /* 디버그 패널이 열려 있는 만큼 헤더·작업 공간을 오른쪽에서 밀어내서,
     패널이 항상 옆에 나란히 붙고 내용을 가리지 않게 한다 (JS 가 값을 채운다). */
  :root { --debug-panel-width: 0px; }
  header {
    display: flex; align-items: baseline; gap: 12px; padding: 12px 18px; border-bottom: 1px solid #0002;
    flex: none; box-sizing: border-box; padding-right: calc(18px + var(--debug-panel-width));
  }
  header h1 { font-size: 16px; margin: 0; }
  header .summary { font-size: 13px; opacity: .7; }
  header .reload-status { font-size: 12px; opacity: .55; }
  header a { margin-left: auto; font-size: 13px; }
  /* entry.css 의 .entry.minimize 는 원래 playentry.org 자체의 "화면 구석에 접힌 미리보기"
     UI 용으로 만들어져 있어서 max-height: 56.25vw, padding-top: calc(100vh + 48px),
     height: 100% 을 그냥 박아 넣는다. 그대로 두면 실행기 화면이 페이지 저 아래
     (뷰포트 밖)로 밀려나거나, 헤더 높이를 빼지 않은 100% 높이 때문에 아래쪽이 잘린다.
     #workspace 는 id 선택자라 .entry(.minimize) 클래스 선택자보다 우선하므로
     여기서 그 값들을 되돌리고, 남은 세로 공간을 flex 로 정확히 채운다. */
  #workspace {
    flex: 1 1 auto; min-height: 0; height: auto; padding-top: 0; max-height: none;
    box-sizing: border-box; padding-right: var(--debug-panel-width);
    transition: padding-right .15s ease-out;
  }
  /* .entryCanvasWorkspace 는 minimize 모드용으로 268px 짜리 고정 폭을 박아 넣는다
     (뷰포트·컨테이너 크기와 무관한 값이라 늘 똑같이 작게 뜬다). entryCanvas 는
     id 선택자라 그 268px 를 이긴다. 실제 표시 크기는 window.tessLayoutCanvas 가
     남은 가로·세로 공간에 맞춰 픽셀 단위로 직접 계산해 채운다 (letterbox). */
  #entryCanvas { display: block; margin: 0 auto; }
  #fallback { display: none; max-width: 640px; margin: 40px auto; padding: 24px 28px; border-radius: 12px;
              background: #fff; box-shadow: 0 1px 3px #0002; line-height: 1.7; }
  @media (prefers-color-scheme: dark) { #fallback { background: #21242b; } }
  #fallback h2 { margin-top: 0; font-size: 17px; }
  #fallback code { background: #0001; padding: 1px 5px; border-radius: 4px; }
  #fallback ol { padding-left: 20px; }
  .debug-toggle-btn {
    font-size: 13px; border: 1px solid #0003; background: none; border-radius: 6px;
    padding: 3px 9px; cursor: pointer; color: inherit;
  }
  .debug-toggle-btn .badge { margin-left: 4px; }
  .badge {
    display: inline-block; min-width: 15px; padding: 0 4px; border-radius: 8px;
    background: #e5484d; color: #fff; font-size: 11px; line-height: 16px; text-align: center;
  }
  #debug-panel {
    position: fixed; top: 0; right: 0; bottom: 0; width: min(420px, 90vw);
    background: #fff; color: #16181d; box-shadow: -2px 0 12px #0003;
    transform: translateX(100%); transition: transform .15s ease-out;
    display: flex; flex-direction: column; z-index: 1000;
  }
  #debug-panel.open { transform: translateX(0); }
  @media (prefers-color-scheme: dark) { #debug-panel { background: #1c1f26; color: #e8eaee; } }
  #debug-resize-handle {
    position: absolute; top: 0; left: -5px; width: 9px; height: 100%; cursor: col-resize; z-index: 1001;
  }
  #debug-resize-handle:hover, #debug-resize-handle.dragging { background: #4f80ff33; }
  .debug-header { display: flex; align-items: center; padding: 12px 16px; border-bottom: 1px solid #0002; flex: none; }
  .debug-header h2 { font-size: 15px; margin: 0; }
  .debug-header button { margin-left: auto; border: none; background: none; font-size: 18px; cursor: pointer; color: inherit; line-height: 1; }
  .debug-section { border-bottom: 1px solid #0001; padding: 10px 16px; overflow: auto; }
  .debug-section:last-child { flex: 1 1 auto; min-height: 120px; }
  .debug-section h3 { font-size: 12px; margin: 0 0 8px; text-transform: uppercase; letter-spacing: .03em; opacity: .6; }
  .debug-empty { opacity: .5; font-size: 13px; margin: 4px 0; }
  .error-item { font-size: 12px; margin-bottom: 6px; border: 1px solid #e5484d55; border-radius: 6px; padding: 4px 8px; }
  .error-item summary { cursor: pointer; color: #e5484d; word-break: break-word; }
  .error-item pre { white-space: pre-wrap; word-break: break-word; font-size: 11px; opacity: .8; margin: 6px 0 0; }
  .debug-scene-title { font-size: 13px; font-weight: 600; margin: 8px 0 2px; }
  .debug-object-list { list-style: none; margin: 0; padding: 0; }
  .debug-object-btn {
    display: block; width: 100%; text-align: left; padding: 3px 6px; margin: 1px 0; border-radius: 4px;
    border: none; background: none; color: inherit; font-size: 13px; cursor: pointer;
  }
  .debug-object-btn:hover, .debug-object-btn.active { background: #4f80ff22; }
  #block-tree ul { list-style: none; margin: 0; padding-left: 14px; border-left: 1px dashed #0002; }
  #block-tree > .debug-thread > ul { padding-left: 0; border-left: none; }
  .debug-thread-label { font-size: 11px; opacity: .55; margin: 10px 0 2px; }
  .block-type { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
  .block-param { margin-left: 4px; }
  .block-highlight > .block-type { background: #e5484d; color: #fff; padding: 1px 5px; border-radius: 4px; }
  .block-highlight-child > .block-type { background: #e5484d33; padding: 1px 5px; border-radius: 4px; }
</style>
</head>
<body>
<header>
  <h1>${escapeHtml(name)}</h1>
  <span class="summary">장면 ${summary.scenes} · 오브젝트 ${summary.objects} · 블록 ${summary.blocks}</span>
  ${reload ? '<span class="reload-status" id="reload-status">자동 새로고침 켜짐</span>' : ''}
  <button id="debug-toggle" class="debug-toggle-btn" type="button">
    디버그 <span id="debug-badge" class="badge" hidden>0</span>
  </button>
  <a href="/${escapeHtml(entName)}" download>작품 파일(.ent) 내려받기</a>
</header>

<div id="workspace"></div>

<aside id="debug-panel" aria-hidden="true">
  <div id="debug-resize-handle" title="드래그해서 크기 조절"></div>
  <div class="debug-header">
    <h2>디버그</h2>
    <button id="debug-close" type="button" aria-label="닫기">×</button>
  </div>
  <section class="debug-section">
    <h3>오류 로그 <span id="error-count" class="badge" hidden>0</span></h3>
    <div id="error-log"><p class="debug-empty">아직 오류가 없습니다. entryjs 가 실행 중 panic 을 내면 여기와
    이 서버를 띄운 터미널에 같이 찍힙니다.</p></div>
  </section>
  <section class="debug-section">
    <h3>장면 · 오브젝트</h3>
    <div id="scene-tree"><p class="debug-empty">불러오는 중…</p></div>
  </section>
  <section class="debug-section">
    <h3>컴파일된 블록 <span id="block-object-name"></span></h3>
    <div id="block-tree"><p class="debug-empty">왼쪽 목록에서 오브젝트를 고르세요.</p></div>
  </section>
</aside>

<section id="fallback">
  <h2>엔트리 실행기를 불러오지 못했습니다</h2>
  <p>작품은 정상적으로 컴파일됐습니다. 실행기(entryjs)만 못 가져왔습니다.</p>
  <ol>
    <li>인터넷이 막혀 있다면 <code>pnpm add -D @entrylabs/entry</code> 로 설치한 뒤 다시 <code>run</code> 하세요.
        entryjs 본체는 설치돼 있으면 그 파일을 쓰지만, 서드파티 라이브러리(createjs 등)는
        여전히 인터넷에서 받아야 한다.</li>
    <li>또는 위의 <b>작품 파일(.ent) 내려받기</b> 를 눌러 받은 뒤,
        <a href="https://playentry.org/ws/new" target="_blank" rel="noreferrer">playentry.org</a> 에서
        <b>불러오기 → 오프라인 작품 불러오기</b> 로 열면 됩니다.</li>
  </ol>
  <p id="fallback-reason" style="opacity:.7; font-size:13px"></p>
</section>


<script>
// ----------------------------------------------------------------------
// 디버그 패널: entryjs 가 실행 중 panic 을 내도(스크립트 로딩 실패부터
// 블록 실행 중 던지는 예외, 처리 안 된 Promise 거부까지) 놓치지 않고
// 화면과 이 서버를 띄운 터미널 양쪽에 남긴다. 또 지금 실행 중인 장면·
// 오브젝트·컴파일된 블록의 실제 모습을 옆 패널에서 바로 들여다볼 수 있다.
// entry.min.js 보다 먼저 실행되어야 로딩 단계의 오류도 잡을 수 있다.
// ----------------------------------------------------------------------
(function () {
  const panel = document.getElementById('debug-panel');
  const toggleBtn = document.getElementById('debug-toggle');
  const badge = document.getElementById('debug-badge');
  const errorCountEl = document.getElementById('error-count');
  const errorLogEl = document.getElementById('error-log');
  const sceneTreeEl = document.getElementById('scene-tree');
  const blockTreeEl = document.getElementById('block-tree');
  const blockObjectNameEl = document.getElementById('block-object-name');

  let errorCount = 0;

  // 패널이 지금 차지하는 폭을 --debug-panel-width 로 내보내서 header·#workspace 가
  // 그만큼 밀리게 하고, 엔트리 화면도 남은 공간에 맞춰 다시 배치한다.
  const syncPanelWidth = () => {
    const width = panel.classList.contains('open') ? panel.getBoundingClientRect().width : 0;
    document.documentElement.style.setProperty('--debug-panel-width', width + 'px');
    window.tessLayoutCanvas();
  };

  const openPanel = () => {
    panel.classList.add('open');
    panel.setAttribute('aria-hidden', 'false');
    syncPanelWidth();
  };
  const closePanel = () => {
    panel.classList.remove('open');
    panel.setAttribute('aria-hidden', 'true');
    syncPanelWidth();
  };
  toggleBtn.addEventListener('click', () => {
    if (panel.classList.contains('open')) closePanel(); else openPanel();
  });
  document.getElementById('debug-close').addEventListener('click', closePanel);

  // 패널 왼쪽 가장자리를 드래그해서 폭을 조절한다.
  const resizeHandle = document.getElementById('debug-resize-handle');
  let resizing = false;
  resizeHandle.addEventListener('mousedown', (event) => {
    resizing = true;
    resizeHandle.classList.add('dragging');
    document.body.style.userSelect = 'none';
    event.preventDefault();
  });
  window.addEventListener('mousemove', (event) => {
    if (!resizing) return;
    const min = 260;
    const max = Math.max(min, window.innerWidth - 240); // 엔트리 화면이 최소한 남을 만큼은 남긴다
    const width = Math.min(Math.max(window.innerWidth - event.clientX, min), max);
    panel.style.width = width + 'px';
    syncPanelWidth();
  });
  window.addEventListener('mouseup', () => {
    if (!resizing) return;
    resizing = false;
    resizeHandle.classList.remove('dragging');
    document.body.style.userSelect = '';
  });

  /**
   * 남은 가로·세로 공간에 엔트리 화면이 최대한 크게, 잘리지 않게 들어가도록
   * 캔버스의 실제 표시 크기(px)를 직접 계산해 채운다 — 디버그 패널이 열리거나
   * 크기가 바뀌거나, 창 크기가 바뀔 때마다 다시 불린다. 엔트리 무대는 항상
   * 480x270 세계 좌표(16:9)로 고정이라 그 비율을 그대로 쓴다.
   */
  window.tessLayoutCanvas = function layoutCanvas() {
    const workspace = document.getElementById('workspace');
    const canvas = document.getElementById('entryCanvas');
    if (!workspace || !canvas) return;
    const engineBar = document.querySelector('.entryEngine');
    const engineHeight = engineBar ? engineBar.getBoundingClientRect().height : 0;
    // clientWidth 는 padding 을 포함해서 재기 때문에(padding-right 로 디버그
    // 패널 자리를 밀어냈다) 그만큼을 다시 빼야 실제로 쓸 수 있는 너비가 나온다.
    const panelWidth = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--debug-panel-width')) || 0;
    const availW = workspace.clientWidth - panelWidth;
    const availH = Math.max(workspace.clientHeight - engineHeight, 60);
    if (availW <= 0 || availH <= 0) return;
    const targetW = Math.min(availW, Math.floor(availH * 16 / 9));
    const targetH = Math.floor(targetW * 9 / 16);
    canvas.style.width = targetW + 'px';
    canvas.style.height = targetH + 'px';

    // entry.min.js 가 실제로 그리는 해상도(캔버스 버퍼)도 표시 크기에 맞춰 올려서
    // 브라우저가 늘려 그리며 흐려지지 않게 한다 (엔트리 자체 해상도 개선과 같은 원리).
    try {
      const Entry = window.Entry;
      const stage = Entry && Entry.stage;
      if (!stage || !stage.canvas || !stage.canvas.canvas) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const bufferW = Math.round(targetW * dpr);
      const bufferH = Math.round(targetH * dpr);
      const canvasEl = stage.canvas.canvas;
      if (canvasEl.width === bufferW && canvasEl.height === bufferH) return;
      canvasEl.width = bufferW;
      canvasEl.height = bufferH;
      stage.canvas.x = bufferW / 2;
      stage.canvas.y = bufferH / 2;
      stage.canvas.scaleX = stage.canvas.scaleY = bufferW / 480;
      Entry.requestUpdate = true;
    } catch (e) { /* 실패해도 기본 해상도로 계속 보여준다 */ }
  };
  window.addEventListener('resize', () => window.tessLayoutCanvas());

  window.tessReportError = function reportError(kind, error) {
    const message = (error && error.message) || String(error);
    const stack = (error && error.stack) || '';

    errorCount += 1;
    errorCountEl.hidden = false;
    errorCountEl.textContent = String(errorCount);
    badge.hidden = false;
    badge.textContent = String(errorCount);

    const empty = errorLogEl.querySelector('.debug-empty');
    if (empty) empty.remove();
    const item = document.createElement('details');
    item.className = 'error-item';
    item.open = errorCount <= 3;
    const summary = document.createElement('summary');
    const time = new Date().toLocaleTimeString('ko-KR', { hour12: false });
    summary.textContent = '[' + time + '] ' + kind + ': ' + message;
    item.appendChild(summary);
    if (stack) {
      const pre = document.createElement('pre');
      pre.textContent = stack;
      item.appendChild(pre);
    }
    errorLogEl.prepend(item);
    if (errorCount === 1) openPanel();

    fetch('/__log', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind, message, stack, time: Date.now() }),
    }).catch(() => {});
  };

  window.addEventListener('error', (event) => {
    // <script src> 로딩 실패(예: CDN 이 막힘)는 별도 target 이 있고 message 가 없다
    if (event.target && event.target !== window && !event.message) {
      window.tessReportError('로딩 실패', new Error((event.target.src || event.target.href || '리소스') + ' 를 불러오지 못했습니다.'));
      return;
    }
    window.tessReportError('실행 오류', event.error || new Error(event.message));
  }, true);

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    // Entry.Utils.stopProjectWithToast 오버라이드가 이미 tessReportError 로 보고하고
    // 나서 원래 동작대로 예외를 던지는데, 그 예외는 비동기 함수 안이라 다시 여기
    // (처리 안 된 Promise 거부)로 들어온다. 두 번 보고하지 않으려고 표시를 본다.
    if (reason && reason.tessAlreadyReported) return;
    window.tessReportError('처리되지 않은 Promise 거부', reason instanceof Error ? reason : new Error(String(reason)));
  });

  const blockLabel = (block) => {
    const params = (block.params || [])
      .filter((p) => p === null || typeof p !== 'object')
      .filter((p) => p !== null && p !== undefined)
      .map((p) => JSON.stringify(p));
    return block.type + (params.length ? ' (' + params.join(', ') + ')' : '');
  };

  const renderBlockNode = (block) => {
    const li = document.createElement('li');
    li.dataset.blockId = block.id;
    const label = document.createElement('span');
    label.className = 'block-type';
    label.textContent = blockLabel(block);
    li.appendChild(label);

    for (const param of block.params || []) {
      if (param && typeof param === 'object' && param.type) {
        const sub = document.createElement('ul');
        sub.className = 'block-param';
        sub.appendChild(renderBlockNode(param));
        li.appendChild(sub);
      }
    }
    for (const branch of block.statements || []) {
      if (Array.isArray(branch) && branch.length > 0) {
        const sub = document.createElement('ul');
        sub.className = 'block-body';
        for (const child of branch) sub.appendChild(renderBlockNode(child));
        li.appendChild(sub);
      }
    }
    return li;
  };

  let currentObject = null;

  const showBlocks = (object) => {
    currentObject = object;
    blockObjectNameEl.textContent = '— ' + object.name;
    blockTreeEl.innerHTML = '';
    for (const btn of sceneTreeEl.querySelectorAll('.debug-object-btn')) {
      btn.classList.toggle('active', btn.dataset.objectId === object.id);
    }
    let threads;
    try {
      threads = JSON.parse(object.script);
    } catch (error) {
      blockTreeEl.textContent = '블록 스크립트를 읽지 못했습니다: ' + error.message;
      return;
    }
    if (!threads.length) {
      blockTreeEl.innerHTML = '<p class="debug-empty">이 오브젝트에는 블록이 없습니다.</p>';
      return;
    }
    threads.forEach((thread, index) => {
      const wrap = document.createElement('div');
      wrap.className = 'debug-thread';
      const label = document.createElement('div');
      label.className = 'debug-thread-label';
      label.textContent = '스크립트 ' + (index + 1);
      wrap.appendChild(label);
      const ul = document.createElement('ul');
      thread.forEach((block) => ul.appendChild(renderBlockNode(block)));
      wrap.appendChild(ul);
      blockTreeEl.appendChild(wrap);
    });
  };

  // 블록 id -> 그 블록을 담고 있는 오브젝트, 그리고 블록 id -> 그 블록의 원본 데이터.
  // 실행 중 panic 난 블록을 눌러서 바로 옆 패널로 되짚어 볼 때 쓴다.
  const blockOwners = {};
  const blockDataById = {};
  const indexBlocks = (node, object) => {
    if (Array.isArray(node)) { for (const item of node) indexBlocks(item, object); return; }
    if (!node || typeof node !== 'object' || !node.id) return;
    blockOwners[node.id] = object;
    blockDataById[node.id] = node;
    for (const param of node.params || []) indexBlocks(param, object);
    for (const branch of node.statements || []) indexBlocks(branch, object);
  };
  window.tessBlockDataById = blockDataById;

  /**
   * 엔트리는 panic 난 블록으로 지금 실행 중이던 블록(예: say)을 알려주는데,
   * 실제 원인은 그 블록에 꽂힌 값 블록(예: list[332])일 수도 있다 — 값 블록은
   * 먼저 계산되고 나서야 바깥 블록이 실행되기 때문이다. 그래서 이 블록 자체
   * 뿐 아니라, 값으로 꽂힌 자식 블록들(statements 로 갈라지는 실행 흐름 말고,
   * params 로 물려 들어가는 값 블록만)까지 id 를 전부 모은다 — 첫 번째가
   * 진짜 패닉이 보고된 블록이고 나머지가 의심 가는 자식들이다.
   */
  window.tessCollectParamIds = function collectParamIds(node, out) {
    out = out || [];
    if (!node || typeof node !== 'object' || !node.id) return out;
    out.push(node.id);
    for (const param of node.params || []) {
      if (param && typeof param === 'object' && param.type) collectParamIds(param, out);
    }
    return out;
  };

  /** 자식 블록들 중에서 특정 타입을 찾는다 (예: value_of_index_from_list) */
  const findParamBlockByType = (node, type) => {
    if (!node || typeof node !== 'object') return null;
    if (node.type === type) return node;
    for (const param of node.params || []) {
      const found = findParamBlockByType(param, type);
      if (found) return found;
    }
    return null;
  };

  /**
   * 엔트리 내부의 value_of_index_from_list 블록은 인덱스가 리스트 범위를
   * 벗어나면 (심지어 리스트 자체가 없어도) "can not insert value to array" 라는,
   * 원래 다른 함수(항목 삽입)에서 쓰던 것으로 보이는 오해의 소지가 큰 메시지를
   * 그대로 던진다. panic 난 블록(대개 이 블록을 값으로 물고 있는 say 같은
   * 바깥 블록) 밑에서 실제 value_of_index_from_list 블록을 찾아, 지금 그 리스트에
   * 항목이 몇 개 있는지를 Entry.variableContainer 에서 직접 읽어와 정확한
   * 메시지로 바꿔 준다.
   */
  window.tessDescribeListIndexError = function describeListIndexError(reportedBlockId, err) {
    if (!err || err.message !== 'can not insert value to array') return null;
    const reportedBlock = blockDataById[reportedBlockId];
    const culprit = findParamBlockByType(reportedBlock, 'value_of_index_from_list');
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
      const Entry = window.Entry;
      const list = listId && Entry && Entry.variableContainer && Entry.variableContainer.getList
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
      return "리스트에서 요청한 위치의 항목을 찾지 못했습니다 (범위를 벗어났습니다).";
    }
  };

  window.tessRenderProjectDebug = function renderProjectDebug(project) {
    sceneTreeEl.innerHTML = '';
    for (const scene of project.scenes) {
      const sceneEl = document.createElement('div');
      const title = document.createElement('div');
      title.className = 'debug-scene-title';
      title.textContent = scene.name;
      sceneEl.appendChild(title);

      const list = document.createElement('ul');
      list.className = 'debug-object-list';
      const objects = project.objects.filter((object) => object.scene === scene.id);
      if (objects.length === 0) {
        const li = document.createElement('li');
        li.className = 'debug-empty';
        li.textContent = '(오브젝트 없음)';
        list.appendChild(li);
      }
      for (const object of objects) {
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'debug-object-btn';
        btn.dataset.objectId = object.id;
        btn.textContent = object.name;
        btn.addEventListener('click', () => showBlocks(object));
        li.appendChild(btn);
        list.appendChild(li);
        try { indexBlocks(JSON.parse(object.script), object); } catch (e) { /* 블록을 못 읽어도 목록은 보여준다 */ }
      }
      sceneEl.appendChild(list);
      sceneTreeEl.appendChild(sceneEl);
    }
    if (project.objects.length > 0) showBlocks(project.objects[0]);
  };

  /**
   * panic 난 블록을 디버그 패널에서 열어서 눈에 띄게 보여준다.
   * 보고된 블록 자신은 진하게, 그 안에 값으로 꽂힌 자식 블록들은 옅게 —
   * 실제 원인이 자식 쪽일 수도 있다는 걸 놓치지 않게.
   */
  window.tessHighlightBlock = function highlightBlock(blockId) {
    const owner = blockOwners[blockId];
    if (!owner) return;
    if (!currentObject || currentObject.id !== owner.id) showBlocks(owner);
    for (const el of blockTreeEl.querySelectorAll('.block-highlight, .block-highlight-child')) {
      el.classList.remove('block-highlight', 'block-highlight-child');
    }
    const ids = window.tessCollectParamIds(blockDataById[blockId], []);
    ids.forEach((id, index) => {
      const target = blockTreeEl.querySelector('[data-block-id="' + id + '"]');
      if (!target) return;
      target.classList.add(index === 0 ? 'block-highlight' : 'block-highlight-child');
      if (index === 0) target.scrollIntoView({ block: 'center' });
    });
    openPanel();
  };
})();
</script>
${thirdPartyScripts}
<script>
  window.EntrySoundEditor = window.EntrySoundEditor || {};
  window.EntryPaint = window.EntryPaint || {};
</script>
${runtimeScripts}
<script>
(async function () {
  const showFallback = (reason) => {
    document.getElementById('workspace').style.display = 'none';
    document.getElementById('fallback').style.display = 'block';
    document.getElementById('fallback-reason').textContent = reason;
  };

  if (typeof window.Entry === 'undefined' || typeof window.Entry.init !== 'function') {
    showFallback('entryjs 를 불러오지 못했습니다 (라이브러리 로딩 실패). 인터넷 연결을 확인하세요.');
    return;
  }

  // ------------------------------------------------------------------
  // 엔트리는 블록 실행 중 오류가 나면 자기 자신의 토스트로
  // "빨간색으로 표시된 블록을 확인해 주세요." 를 띄우고(Entry.Utils.stopProjectWithToast),
  // workspace 모드에서만 뜻이 있는 블록 강조를 시도한다 — 우리 minimize 뷰어에서는
  // 그 팝업이 오히려 방해만 된다. 여기서 그 함수를 완전히 갈아 끼워서:
  //   1) 엔트리 자체 팝업은 절대 띄우지 않고
  //   2) 어떤 종류의 Runtime Error 인지(IncompatibleError/OfflineError/일반)에 따라
  //      우리 디버그 패널 오류 로그로 대신 띄우고
  //   3) 소스맵(/sourcemap.json)으로 그 블록을 만든 .tess 원본 위치까지 찾아서
  //      메시지에 붙이고, 디버그 패널에서 그 블록을 바로 강조해 보여준다.
  // ------------------------------------------------------------------
  const interceptRuntimeErrors = (sourceMap) => {
    if (Entry.toast) {
      Entry.toast.alert = function (title, message) {
        const text = Array.isArray(message) ? message.join(' ') : String(message ?? '');
        window.tessReportError(String(title || '알림'), new Error(text));
      };
    }
    if (!Entry.Utils) return;
    Entry.Utils.stopProjectWithToast = async function (scope, type, err) {
      const kind = type || 'Runtime Error';
      const block = scope && scope.block;
      const blockId = block && (block.id || (typeof block.getId === 'function' && block.getId()));

      let objectName = '';
      try {
        const code = block && typeof block.getCode === 'function' && block.getCode();
        if (code && code.object) objectName = code.object.name || code.object.id || '';
      } catch (e) { /* 오브젝트 이름을 못 찾아도 계속 진행한다 */ }

      const loc = (blockId && sourceMap[blockId]) || null;
      const where = loc
        ? (loc.file ? loc.file + ':' : '') + loc.line + ':' + loc.column
        : (blockId ? '컴파일된 블록 ' + blockId : '위치를 알 수 없음');
      const label = [objectName, block && block.type].filter(Boolean).join(' / ');
      const friendlyMessage = blockId && window.tessDescribeListIndexError
        ? window.tessDescribeListIndexError(blockId, err)
        : null;
      const baseMessage = friendlyMessage || (err && err.message) || kind;

      const error = new Error((label ? label + ' — ' : '') + baseMessage + ' (' + where + ')');
      if (err && err.stack) error.stack = err.stack;
      error.tessAlreadyReported = true;

      window.tessReportError(kind, error);
      if (blockId) window.tessHighlightBlock(blockId);

      try {
        if (Entry.engine && Entry.engine.isState && Entry.engine.isState('run') && Entry.engine.toggleStop) {
          await Entry.engine.toggleStop();
        }
      } catch (e) { /* 멈추기 실패해도 아래에서 계속 오류를 던져 원래 흐름을 지킨다 */ }

      throw error; // entryjs 실행기가 이 스레드를 끝내는 데 필요한 신호라 그대로 던진다
    };
  };

  try {
    const project = await (await fetch('/project.json')).json();
    const sourceMap = await (await fetch('/sourcemap.json')).json().catch(() => ({}));
    window.tessSourceMap = sourceMap;
    window.tessRenderProjectDebug(project);
    interceptRuntimeErrors(sourceMap);
    Entry.init(document.getElementById('workspace'), {
      type: 'minimize',
      libDir: '${escapeHtml(base)}',
      fonts: [],
    });
    Entry.loadProject(project);
    Entry.engine && Entry.engine.toggleRun && Entry.engine.toggleRun();
    requestAnimationFrame(() => window.tessLayoutCanvas());
  } catch (error) {
    showFallback('작품을 실행하는 중 문제가 생겼습니다: ' + error.message);
    window.tessReportError('초기화 오류', error);
  }
})();
${reload ? `
(function () {
  const status = document.getElementById('reload-status');
  const source = new EventSource('/__reload');
  source.addEventListener('reload', () => location.reload());
  source.addEventListener('open', () => { if (status) status.textContent = '자동 새로고침 켜짐'; });
  source.addEventListener('error', () => { if (status) status.textContent = '자동 새로고침 연결 끊김'; });
})();` : ''}
</script>
</body>
</html>
`;
}
