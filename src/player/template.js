// ============================================================================
//  The page used to view a compiled project in a browser.
//
//  entryjs has a lot of third-party dependencies, so instead of bundling
//  them, this looks for them in order:
//    1. node_modules/@entrylabs/entry installed in the project (offline)
//    2. unpkg CDN                       (default, see the CDN constant in server.js)
//  @entrylabs/entry itself can't be fetched from jsDelivr — the package
//  exceeds jsDelivr's 150MB size limit, so even entry.min.js gets a 403
//  (see the CDN constant note in server.js). The other third-party
//  libraries (THIRD_PARTY_SCRIPTS) are each small enough for jsDelivr.
//  If neither source works, the page reports that and points to
//  downloading the project file and opening it on playentry.org instead.
//
//  entry.min.js is not self-contained: it expects the third-party
//  libraries below to already be present as globals (createjs, _,
//  EntryTool, EntryVideoLegacy, React, ...), matching entryjs's webpack
//  externals config. Without them, loading entry.min.js fails silently,
//  `Entry.init` ends up undefined, and only the "failed to load" fallback
//  screen renders.
// ============================================================================

/** Third-party libraries that must be globally available before entry.min.js runs. */
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

// @font-face definitions for the Korean fonts Entry uses (Nanum Gothic
// Coding, DungGeunMo, Jalnan, etc.). entryjs itself doesn't ship this CSS —
// it's added separately by the playentry.org page — so without loading it
// here, a font like `font = "DungGeunMo"` falls back to the default font
// (the player itself is local, but this CSS and its font files are served
// from Entry's public CDN and load fine given internet access). The list
// was taken from https://entry-cdn.pstatic.net/uploads/fonts/fonts_2023_10.css,
// which the playentry.org page loads.
const ENTRY_FONTS_BASE = 'https://entry-cdn.pstatic.net/uploads/fonts';

// Font stylesheets are linked individually. The bundled fonts_2023_10.css
// is a list of @import rules, adding an extra round trip before font
// definitions arrive, so the first frame renders with a fallback font.
export const ENTRY_FONT_STYLES = [
  'nanum_gothic', 'jejuhallasan_2023', 'kopubbatang_2023', 'nanumgothiccoding_2023',
  'nanummyeongjo_2023', 'nanumpenscript_2023', 'designhouse_2023', 'dunggeunmo_2023',
  'jalnan_2023', 'square_round_2023', 'uhbeemysen_2023', 'SDComicStencil_2023',
  'SDChildfundkorea_2023', 'SDCinemaTheater_2023', 'SDMapssi_2023', 'SDShabang_2023',
  'SDWoodcarving_2023', 'SDYongbi_2023', 'notosans_2023', 'nanumbarunpen_2023',
  'maruburi_2023', 'd2coding_2023',
].map((name) => `${ENTRY_FONTS_BASE}/${name}.css`);

/** Files entryjs requires, in the order given by Entry's official docs. */
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

// The debug panel UI and the arrow-js it uses. Both are ESM, served separately.
export const DEBUG_UI_PATH = '/debug-ui.js';
export const ARROW_PATH = '/arrow/';

const escapeHtml = (text) => String(text)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#39;');

/**
 * Encodes a value as a JS literal safe to embed inside a `<script>` tag.
 * HTML escaping doesn't apply inside a script, and `</script` in a string
 * would otherwise close the tag early.
 */
const jsValue = (value) => JSON.stringify(value ?? null)
  .replaceAll('<', '\\u003c').replaceAll('>', '\\u003e').replaceAll('&', '\\u0026')
  .replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');

/**
 * @param {{name: string, base: string, summary: object, entName: string, reload?: boolean}} options
 *   base is where entryjs files are fetched from (`/lib` or the CDN URL)
 *   when reload is true, the page auto-reloads each time the server recompiles
 */
export function playerPage({ name, base, summary, entName, reload = true }) {
  // Without crossorigin="anonymous", an error thrown inside these scripts
  // (when cross-origin, i.e. CDN) is reported by the browser only as the
  // generic "Script error." with no real message or stack — useless in the
  // debug panel. Both jsDelivr and unpkg send
  // access-control-allow-origin: *, so this attribute doesn't break loading
  // (and has no effect on same-origin /lib files), while surfacing the real
  // error message. Every interpolated value below goes through
  // escapeHtml (attributes/body) or jsValue (inside `<script>`).
  const libBase = escapeHtml(base);
  const thirdPartyScripts = THIRD_PARTY_SCRIPTS
    .map((url) => `<script src="${escapeHtml(url)}" crossorigin="anonymous"></script>`)
    .join('\n    ');
  const runtimeScripts = RUNTIME_FILES
    .map((file) => `<script src="${libBase}/${escapeHtml(file)}" crossorigin="anonymous"></script>`)
    .join('\n    ');
  const fontStyles = ENTRY_FONT_STYLES
    .map((url) => `<link rel="stylesheet" href="${escapeHtml(url)}">`)
    .join('\n');

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(name)} — Tess</title>
<link rel="stylesheet" href="${escapeHtml(THIRD_PARTY_STYLE)}">
<link rel="stylesheet" href="${libBase}/${escapeHtml(RUNTIME_STYLE)}">
${fontStyles}
<style>
  :root { color-scheme: light dark; }
  html, body { height: 100%; }
  body {
    margin: 0; font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    background: #f4f5f7; color: #16181d;
    display: flex; flex-direction: column; overflow: hidden;
  }
  @media (prefers-color-scheme: dark) { body { background: #16181d; color: #e8eaee; } }
  /* Pushes the header/workspace in from the right by the open debug panel's
     width, so the panel sits alongside the content instead of covering it
     (JS fills in the value). */
  :root { --debug-panel-width: 0px; }
  header {
    display: flex; align-items: baseline; gap: 12px; padding: 12px 18px; border-bottom: 1px solid #0002;
    flex: none; box-sizing: border-box; padding-right: calc(18px + var(--debug-panel-width));
  }
  header h1 { font-size: 16px; margin: 0; }
  header .summary { font-size: 13px; opacity: .7; }
  header .reload-status { font-size: 12px; opacity: .55; }
  header a { margin-left: auto; font-size: 13px; }
  /* entry.css's .entry.minimize was designed for playentry.org's own
     collapsed-corner preview UI, so it hardcodes
     max-height: 56.25vw, padding-top: calc(100vh + 48px), height: 100%.
     Left as is, the player would be pushed off-viewport or clipped, since
     that 100% height doesn't account for the header. #workspace, an id
     selector, outranks the .entry(.minimize) class selectors, so these
     values are reset here and the remaining vertical space is filled with flex. */
  #workspace {
    flex: 1 1 auto; min-height: 0; height: auto; padding-top: 0; max-height: none;
    box-sizing: border-box; padding-right: var(--debug-panel-width);
    transition: padding-right .15s ease-out;
  }
  /* .entryCanvasWorkspace hardcodes a fixed 268px width for minimize mode
     (independent of viewport/container size, so it always renders small).
     #entryCanvas, an id selector, overrides that 268px. The actual display
     size is computed in pixels by window.tessLayoutCanvas to fill the
     remaining space (letterboxed). */
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
  .debug-section {
    position: relative; border-bottom: 1px solid #0001; padding: 10px 16px 14px;
    overflow: auto; flex: 0 0 auto; box-sizing: border-box;
  }
  .debug-section-last { flex: 1 1 auto; min-height: 120px; }
  /* Drag the section's bottom edge to resize its height. */
  .debug-vresize {
    position: absolute; left: 0; right: 0; bottom: 0; height: 7px; cursor: row-resize;
  }
  .debug-vresize:hover { background: #4f80ff33; }
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

  /* Adds a gap between Stop and Pause, which sit close enough to mis-click. */
  .entryEngineMinimize .entryStopButtonMinimize { margin-right: 20px; }

  /* --- Debug panel: tabs --- */
  .debug-tabs { display: flex; flex: none; border-bottom: 1px solid #0002; padding: 0 8px; gap: 2px; }
  .debug-tab {
    border: none; background: none; color: inherit; cursor: pointer;
    font-size: 13px; padding: 8px 10px; border-bottom: 2px solid transparent; opacity: .6;
  }
  .debug-tab:hover { opacity: .9; }
  .debug-tab[aria-selected="true"] { opacity: 1; font-weight: 600; border-bottom-color: #4f80ff; }
  .debug-tab .badge { margin-left: 4px; }
  .debug-panelbody { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
  .debug-panelbody[hidden] { display: none; }


  /* --- Run tab --- */
  .debug-run-state { font-size: 13px; margin: 0 0 10px; }
  .debug-run-state .dot {
    display: inline-block; width: 8px; height: 8px; border-radius: 50%;
    background: #8a8f98; margin-right: 6px; vertical-align: 1px;
  }
  .debug-run-state.state-run .dot { background: #30a46c; }
  .debug-run-state.state-pause .dot { background: #f5a524; }
  .debug-run-buttons { display: flex; gap: 8px; flex-wrap: wrap; }
  .debug-run-buttons button {
    flex: 1 1 auto; min-width: 84px; font-size: 13px; padding: 7px 10px; cursor: pointer;
    border: 1px solid #0003; border-radius: 6px; background: none; color: inherit;
  }
  .debug-run-buttons button:hover:not(:disabled) { background: #4f80ff22; }
  .debug-run-buttons button:disabled { opacity: .4; cursor: default; }
  .debug-field { display: flex; align-items: center; gap: 8px; margin: 7px 0; font-size: 13px; }
  .debug-field label { flex: 1 1 auto; }
  .debug-field select { font: inherit; font-size: 12px; padding: 3px 6px; border-radius: 5px;
                        border: 1px solid #0003; background: none; color: inherit; }
  .debug-field select option { color: initial; }
  .debug-note { font-size: 12px; opacity: .55; margin: 8px 0 0; line-height: 1.6; }

  /* --- Data tab --- */
  .debug-rows { list-style: none; margin: 0; padding: 0; font-size: 13px; }
  .debug-rows li { display: flex; align-items: baseline; gap: 8px; padding: 3px 0; border-bottom: 1px solid #0001; }
  .debug-rows .key { flex: 0 1 auto; min-width: 0; overflow-wrap: anywhere; }
  .debug-rows .val {
    margin-left: auto; text-align: right; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px; overflow-wrap: anywhere; max-width: 60%;
  }
  .debug-rows .tag { font-size: 11px; opacity: .5; }
  .debug-send-btn {
    margin-left: auto; font-size: 11px; padding: 1px 8px; border-radius: 999px;
    border: 1px solid #0003; background: none; color: inherit; cursor: pointer;
  }
  .debug-send-btn:hover { background: #4f80ff22; }
  /* Browsers silently block audio playback until the user has interacted
     with the page (the autoplay policy — createjs's AudioContext is no
     exception). If the player started running on its own as soon as the
     page loaded, no click would have happened yet, so a "when start" sound
     like background music would stay blocked (until the user happens to
     click something, making it seem to "just work eventually"). This
     screen is shown before the project actually starts, so that click
     itself counts as the "user interaction" audio requires. */
  #start-gate {
    position: fixed; inset: 0; z-index: 900;
    display: flex; align-items: center; justify-content: center;
    background: #10131acc; cursor: pointer;
  }
  #start-gate-card {
    display: flex; align-items: center; gap: 8px;
    color: #fff; font-size: 15px; padding: 14px 24px; border-radius: 999px;
    background: #ffffff22; border: 1px solid #ffffff55; backdrop-filter: blur(2px);
  }
  #start-gate-card .icon { font-size: 13px; }
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

<div id="start-gate" role="button" tabindex="0" aria-label="클릭하거나 아무 키나 눌러서 시작">
  <div id="start-gate-card"><span class="icon">▶</span> 클릭하거나 아무 키나 눌러서 시작</div>
</div>

<aside id="debug-panel" aria-hidden="true"></aside>

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
// The debug UI is a module and loads late (deferred); errors before it's ready are queued here.
(function () {
  const pending = [];
  let sink = null;

  window.tessDebugSink = (fn) => {
    sink = fn;
    for (const item of pending.splice(0)) sink(item);
  };
  window.tessReportError = function reportError(kind, error) {
    const item = {
      kind: String(kind),
      message: (error && error.message) || String(error),
      stack: (error && error.stack) || '',
      time: Date.now(),
    };
    if (sink) sink(item); else pending.push(item);
    fetch('/__log', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(item),
    }).catch(() => {});
  };

  // Noise createjs often throws while preloading sounds; it doesn't affect actual playback.
  const benign = (message) => /setPlaybackResource is not a function/.test(message ?? '');

  window.addEventListener('error', (event) => {
    if (benign(event.message) || benign(event.error?.message)) return;
    if (event.target && event.target !== window && !event.message) {
      const what = event.target.src || event.target.href || '리소스';
      window.tessReportError('로딩 실패', new Error(what + ' 를 불러오지 못했습니다.'));
      return;
    }
    window.tessReportError('실행 오류', event.error || new Error(event.message));
  }, true);

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    if (reason && reason.tessAlreadyReported) return; // Already reported by stopProjectWithToast.
    if (benign(reason && reason.message)) return;
    window.tessReportError('처리되지 않은 Promise 거부', reason instanceof Error ? reason : new Error(String(reason)));
  });

  // Filled with no-ops since these may be called before the debug UI loads.
  window.tessLayoutCanvas = () => {};
  window.tessHighlightBlock = () => {};
  window.tessRenderProjectDebug = () => {};
  window.tessPatchEnvironmentBlocks = () => {};
})();
</script>
${thirdPartyScripts}
<script>
  window.EntrySoundEditor = window.EntrySoundEditor || {};
  window.EntryPaint = window.EntryPaint || {};
</script>
<script>
(function () {
  // Due to the browser autoplay policy, AudioContext starts 'suspended' —
  // and no sound plays — until the user has genuinely interacted with the
  // page (click/key/touch). createjs (SoundJS) has its own unlock code
  // (WebAudioPlugin.playEmptySound: create a silent buffer and start() it
  // immediately), but only wires it to a document click when
  // "ontouchstart" in window (createjs.js's _unlock method) — meaning it
  // self-unlocks only on touch devices, never on desktop. Clicking the
  // start-gate overlay counts as an interaction, but if nothing actually
  // wakes AudioContext, that click just dismisses the overlay while audio
  // stays blocked, appearing to unlock later only by chance (e.g. the
  // browser's own media-engagement heuristics). So this wires the same
  // unlock explicitly on desktop too.
  const unlock = () => {
    try {
      const ctx = window.createjs && createjs.WebAudioPlugin && createjs.WebAudioPlugin.context;
      if (!ctx) return; // Not created yet; retry on the next interaction.
      if (ctx.state !== 'running') {
        const source = ctx.createBufferSource();
        source.buffer = ctx.createBuffer(1, 1, 22050);
        source.connect(ctx.destination);
        source.start(0);
        ctx.resume && ctx.resume();
      }
      if (ctx.state === 'running') detach();
    } catch (e) { /* Retry on the next interaction if this fails. */ }
  };
  const events = ['mousedown', 'click', 'touchstart', 'keydown'];
  const detach = () => events.forEach((type) => document.removeEventListener(type, unlock, true));
  events.forEach((type) => document.addEventListener(type, unlock, true));
})();
</script>
${runtimeScripts}
<script type="module" src="${DEBUG_UI_PATH}"></script>
<script type="module">
(async function () {
  const showFallback = (reason) => {
    document.getElementById('workspace').style.display = 'none';
    document.getElementById('fallback').style.display = 'block';
    document.getElementById('fallback-reason').textContent = reason;
    document.getElementById('start-gate')?.remove();
  };

  if (typeof window.Entry === 'undefined' || typeof window.Entry.init !== 'function') {
    showFallback('entryjs 를 불러오지 못했습니다 (라이브러리 로딩 실패). 인터넷 연결을 확인하세요.');
    return;
  }

  // ------------------------------------------------------------------
  // On a block runtime error, Entry shows its own toast ("check the block
  // highlighted in red") and tries to highlight the block
  // (Entry.Utils.stopProjectWithToast) — meaningful only in workspace mode,
  // where it's just noise in this minimize viewer. This function is
  // replaced entirely so that it:
  //   1) never shows Entry's own popup,
  //   2) routes the error to this debug panel's error log instead, based
  //      on the Runtime Error kind (IncompatibleError/OfflineError/generic),
  //   3) resolves the block's original .tess source location via the
  //      source map (/sourcemap.json), appends it to the message, and
  //      highlights that block directly in the debug panel.
  // ------------------------------------------------------------------
  const interceptRuntimeErrors = (sourceMap) => {
    if (Entry.toast) {
      Entry.toast.alert = function (title, message) {
        const text = Array.isArray(message) ? message.join(' ') : String(message ?? '');
        window.tessReportError(String(title || '알림'), new Error(text));
      };
      // Entry.toast.warning isn't a real error — it's Entry's own advisory
      // popup, e.g. auto-truncating a list past 5000 items
      // (listVariable.js _showListFullWarning) with a "max 5000 items"
      // notice. Meaningful only in workspace mode; in this minimize viewer
      // it just covers the screen, so it's suppressed (a real error is
      // still caught by alert above / stopProjectWithToast below).
      Entry.toast.warning = function () {};
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
      } catch (e) { /* Continue without an object name if it can't be found. */ }

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
      } catch (e) { /* Ignore a failed stop; the error is still thrown below to preserve the original flow. */ }

      throw error; // Rethrown as-is: the entryjs runtime needs this to terminate the thread.
    };
  };

  // ------------------------------------------------------------------
  // The canvas doesn't repaint when a font arrives late, so the project's
  // fonts are preloaded before it runs. document.fonts.load() is a no-op
  // until the font CSS has arrived, so that CSS is awaited first.
  const waitForFontStyles = () => {
    const links = [...document.querySelectorAll('link[rel="stylesheet"]')]
      .filter((link) => link.href.includes('/uploads/fonts/') && !link.sheet);
    if (links.length === 0) return Promise.resolve();
    return Promise.race([
      Promise.all(links.map((link) => new Promise((resolve) => {
        link.addEventListener('load', resolve, { once: true });
        link.addEventListener('error', resolve, { once: true });
      }))),
      // The project should still run when the CDN is unreachable, so this doesn't wait forever.
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ]);
  };

  const preloadTextFonts = async (project) => {
    const fonts = new Set(
      (project.objects ?? [])
        .filter((object) => object.objectType === 'textBox' && object.entity?.font)
        .map((object) => object.entity.font),
    );
    if (fonts.size === 0) return;
    await waitForFontStyles();
    await Promise.all([...fonts].map((font) => document.fonts.load(font).catch(() => {})));
    await document.fonts.ready.catch(() => {});
  };

  // The project only starts once the start-gate overlay (see the CSS note
  // above) is dismissed — that click/keypress is the "user interaction"
  // the autoplay policy requires, so a "when start" sound plays correctly
  // from the start. The gate itself isn't removed here — it stays visible
  // until waitForSoundsLoaded finishes (below), so the project doesn't
  // appear to have started while its mp3s are still loading.
  const waitForStartGate = () => new Promise((resolve) => {
    const gate = document.getElementById('start-gate');
    if (!gate) { resolve(); return; }
    const dismiss = () => {
      gate.removeEventListener('click', dismiss);
      gate.removeEventListener('keydown', dismiss);
      resolve();
    };
    gate.addEventListener('click', dismiss);
    gate.addEventListener('keydown', dismiss);
    gate.focus();
  });

  // Entry.loadProject walks project.objects and calls Entry.initSound for
  // each sound file, which only registers it on Entry.soundQueue (a shared
  // PreloadJS queue) without waiting for it (entryjs util/init.js). So if
  // toggleRun follows immediately, a block that plays a sound whose data
  // hasn't arrived "succeeds" but produces no audio. Entry.soundQueue
  // fires its own 'soundLoaded' event once every registered sound has
  // arrived (see loadCallback in the same file), so that event is awaited
  // before running. entryjs itself gives up on a sound after 3 seconds
  // (the setTimeout in Entry.initSound), so a similar grace period is used
  // here too, without waiting forever if it never resolves (e.g. a 404).
  const waitForSoundsLoaded = () => new Promise((resolve) => {
    const queue = window.Entry && Entry.soundQueue;
    if (!queue || queue.loadComplete || !queue.urls || queue.urls.size === 0) { resolve(); return; }
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      Entry.removeEventListener('soundLoaded', finish);
      clearTimeout(timer);
      resolve();
    };
    Entry.addEventListener('soundLoaded', finish);
    const timer = setTimeout(finish, 8000);
  });

  try {
    const project = await (await fetch('/project.json')).json();
    const sourceMap = await (await fetch('/sourcemap.json')).json().catch(() => ({}));
    window.tessSourceMap = sourceMap;
    window.tessRenderProjectDebug(project);
    await preloadTextFonts(project);
    Entry.init(document.getElementById('workspace'), {
      type: 'minimize',
      libDir: ${jsValue(base)},
      // baseUrl is deliberately left unset — entryjs defaults it to
      // location.origin (util/init.js setDefaultPathsFromOptions), so an
      // 'AI' block like TTS speech (block_ai_utilize_tts.js) requests
      // /api/expansionBlock/tts/read.mp3 on this server, which proxies
      // that path to playentry.org and returns the response (see the note
      // above). Pointing baseUrl straight at playentry.org would seem
      // simpler, but the browser's direct cross-origin request would just
      // be blocked by playentry.org's missing CORS headers — routing
      // through this server is required. Entry's built-in images
      // (entryDir) are static local/CDN files needing no server response,
      // so they're unaffected.
      // entryjs defaults mediaFilePath to \`\${libDir}/@entrylabs/entry/images/\`
      // (util/init.js setDefaultPathsFromOptions, entryDir defaults to
      // '/@entrylabs/entry') — i.e. it assumes another '@entrylabs/entry'
      // folder sits below libDir. But this app's base ('/lib' or the CDN)
      // already points at that package folder itself, so left as is the
      // path would double up as '.../lib/@entrylabs/entry/images/...' and
      // Entry's own built-in images (rotate handle, coordinate grid, resize
      // handle, etc.) would all 404. Setting entryDir to an empty string
      // makes mediaFilePath follow the same convention as this app's base
      // (images/ directly underneath).
      entryDir: '',
      fonts: [],
    });
    // Entry.init creates a fresh Entry.toast = new Entry.Toast() every time
    // it runs (entryjs util/init.js). Calling interceptRuntimeErrors before
    // Entry.init would patch a toast that either doesn't exist yet (first
    // run) or is about to be discarded — so it must run only after
    // Entry.init, once the real Entry.toast that stays in use exists.
    interceptRuntimeErrors(sourceMap);
    // Overrides the boost-mode/device/touch judgment blocks with values set
    // by the debug panel. Must run after Entry.init has populated the
    // block definitions (Entry.block).
    window.tessPatchEnvironmentBlocks();
    Entry.loadProject(project);
    requestAnimationFrame(() => window.tessLayoutCanvas());
    await waitForStartGate();
    const gate = document.getElementById('start-gate');
    const gateCard = document.getElementById('start-gate-card');
    const soundsReady = waitForSoundsLoaded();
    // The click already unlocked audio, but if sound data hasn't arrived yet,
    // keep the gate visible with a loading message instead of removing it —
    // otherwise playback starts silently with no explanation.
    if (gateCard && window.Entry?.soundQueue?.urls?.size > 0 && !Entry.soundQueue.loadComplete) {
      gateCard.textContent = '소리를 불러오는 중…';
    }
    await soundsReady;
    gate && gate.remove();
    Entry.engine && Entry.engine.toggleRun && Entry.engine.toggleRun();
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
