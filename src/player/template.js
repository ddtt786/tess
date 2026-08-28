// ============================================================================
//  컴파일한 작품을 브라우저에서 열어 보기 위한 페이지
//
//  엔트리 실행기(entryjs)는 서드파티 라이브러리가 많아서 통째로 담지 않고
//  다음 순서로 찾는다.
//    1. 프로젝트에 설치된 node_modules/@entrylabs/entry  (오프라인)
//    2. unpkg CDN                                          (기본, server.js 의 CDN 상수)
//  @entrylabs/entry 자체는 jsDelivr 로는 못 받는다 — 패키지 전체 크기가 jsDelivr 의
//  150MB 한도를 넘어서 entry.min.js 조차 403 으로 막힌다(server.js CDN 상수 주석 참고).
//  나머지 서드파티 라이브러리(THIRD_PARTY_SCRIPTS)는 각각 크기가 작아 jsDelivr 로도 잘 받아진다.
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
const ENTRY_FONTS_BASE = 'https://entry-cdn.pstatic.net/uploads/fonts';

// 글꼴 CSS 를 하나씩 직접 건다. 묶음 파일 fonts_2023_10.css 는 @import 목록이라
// 글꼴 정의가 한 번 더 왕복한 뒤에야 도착해서, 첫 프레임이 대체 글꼴로 그려진다.
export const ENTRY_FONT_STYLES = [
  'nanum_gothic', 'jejuhallasan_2023', 'kopubbatang_2023', 'nanumgothiccoding_2023',
  'nanummyeongjo_2023', 'nanumpenscript_2023', 'designhouse_2023', 'dunggeunmo_2023',
  'jalnan_2023', 'square_round_2023', 'uhbeemysen_2023', 'SDComicStencil_2023',
  'SDChildfundkorea_2023', 'SDCinemaTheater_2023', 'SDMapssi_2023', 'SDShabang_2023',
  'SDWoodcarving_2023', 'SDYongbi_2023', 'notosans_2023', 'nanumbarunpen_2023',
  'maruburi_2023', 'd2coding_2023',
].map((name) => `${ENTRY_FONTS_BASE}/${name}.css`);

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

// 디버그 패널 UI 와 그것이 쓰는 arrow-js. 둘 다 ESM 이라 서버가 따로 내보낸다.
export const DEBUG_UI_PATH = '/debug-ui.js';
export const ARROW_PATH = '/arrow/';

const escapeHtml = (text) => String(text)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#39;');

/**
 * 값을 `<script>` 안에 넣어도 되는 JS 리터럴로 바꾼다.
 * 스크립트 안에서는 HTML 이스케이프가 통하지 않고, 문자열 속 `</script` 가 스크립트를 끊는다.
 */
const jsValue = (value) => JSON.stringify(value ?? null)
  .replaceAll('<', '\\u003c').replaceAll('>', '\\u003e').replaceAll('&', '\\u0026')
  .replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');

/**
 * @param {{name: string, base: string, summary: object, entName: string, reload?: boolean}} options
 *   base 는 entryjs 파일들을 가져올 곳 (`/lib` 또는 CDN 주소)
 *   reload 가 true 면 서버가 다시 컴파일할 때마다 페이지를 자동으로 새로고침한다
 */
export function playerPage({ name, base, summary, entName, reload = true }) {
  // crossorigin="anonymous" 가 없으면, 실행 중 이 스크립트들(cross-origin CDN 이면)
  // 안에서 던진 오류는 브라우저가 보안상 진짜 메시지·스택을 숨기고 그냥 "Script error."
  // 라고만 알려준다 — 디버그 패널에 그렇게 뜨면 원인을 전혀 알 수 없다. jsDelivr·unpkg
  // 모두 access-control-allow-origin: * 를 보내므로 이 속성을 붙여도 로딩엔 문제없고
  // (같은 origin 인 /lib 로컬 파일에는 애초에 영향이 없다), 진짜 오류 메시지가 보인다.
  // 값을 끼워 넣는 자리는 모두 escapeHtml(속성·본문) 또는 jsValue(`<script>` 안)를 거친다.
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
  .debug-section {
    position: relative; border-bottom: 1px solid #0001; padding: 10px 16px 14px;
    overflow: auto; flex: 0 0 auto; box-sizing: border-box;
  }
  .debug-section-last { flex: 1 1 auto; min-height: 120px; }
  /* 섹션 아래쪽 가장자리를 끌어서 높이를 조절한다 */
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

  /* 정지하기와 일시정지가 붙어 있어 잘못 누르기 쉬우므로 사이를 벌린다 */
  .entryEngineMinimize .entryStopButtonMinimize { margin-right: 20px; }

  /* --- 디버그 패널: 탭 --- */
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


  /* --- 실행 탭 --- */
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

  /* --- 자료 탭 --- */
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
  /* 브라우저는 사용자가 페이지와 아직 상호작용하지 않았으면 소리 재생을 조용히 막는다
     (자동재생 정책 — createjs 가 쓰는 AudioContext 도 예외가 아니다). 실행하기를 페이지가
     뜨자마자 스스로 누르면, 그 시점엔 아직 클릭 한 번 없었으니 when start 에서 바로
     나오는 배경음악 같은 소리가 막혀 버린다(그러다 사용자가 아무 데나 한 번 누르면 그제서야
     풀려서 "좀 있다가 하면 되는" 것처럼 보인다). 그래서 실제로 실행하기 전에 이 화면을
     띄워 눌러 달라고 해서, 그 클릭 자체를 소리가 필요로 하는 "사용자 상호작용"으로 쓴다. */
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
// 디버그 UI 는 모듈이라 defer 로 늦게 뜬다. 그 전에 나는 로딩 오류를 여기서 모아 둔다.
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

  // createjs 가 소리를 미리 불러올 때 종종 던지지만 실제 재생에는 아무 문제가 없는 잡음이다.
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
    if (reason && reason.tessAlreadyReported) return; // stopProjectWithToast 가 이미 보고했다
    if (benign(reason && reason.message)) return;
    window.tessReportError('처리되지 않은 Promise 거부', reason instanceof Error ? reason : new Error(String(reason)));
  });

  // 디버그 UI 가 올라오기 전에 불릴 수 있어서 빈 함수로 채워 둔다.
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
  // 브라우저의 자동재생 정책 때문에, 사용자가 이 페이지와 아직 한 번도 진짜로
  // 상호작용(클릭·키·터치)하지 않았으면 AudioContext 는 'suspended' 로 시작해서
  // 소리가 하나도 안 들린다. createjs(SoundJS) 는 이걸 직접 깨우는 코드
  // (WebAudioPlugin.playEmptySound, 무음 버퍼를 만들어 그 안에서 바로 start() 호출)
  // 를 갖고 있지만 "ontouchstart" in window 일 때만 문서 클릭에 걸어 둔다
  // (createjs.js 안 _unlock 메서드) — 즉 터치 기기(모바일)에서만 자동으로 풀리고,
  // 데스크톱 브라우저에서는 아무도 이걸 불러 주지 않는다. start-gate(위 화면의
  // "클릭하거나 아무 키나 눌러서 시작")를 눌러도 AudioContext 를 실제로 깨우는
  // 코드가 아무 데도 없으면 그 클릭은 그냥 화면만 넘길 뿐 소리는 여전히 막혀
  // 있다가, 나중에 우연히(예: 브라우저 자체의 미디어 참여도 판단으로) 풀리는
  // 것처럼 보일 뿐이다 — 그래서 desktop 에서도 똑같이 직접 걸어서 확실하게 푼다.
  const unlock = () => {
    try {
      const ctx = window.createjs && createjs.WebAudioPlugin && createjs.WebAudioPlugin.context;
      if (!ctx) return; // 아직 안 만들어졌으면 다음 상호작용 때 다시 시도한다
      if (ctx.state !== 'running') {
        const source = ctx.createBufferSource();
        source.buffer = ctx.createBuffer(1, 1, 22050);
        source.connect(ctx.destination);
        source.start(0);
        ctx.resume && ctx.resume();
      }
      if (ctx.state === 'running') detach();
    } catch (e) { /* 실패해도 다음 상호작용 때 다시 시도한다 */ }
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
      // Entry.toast.warning 은 진짜 오류가 아니라 엔트리 자체의 안내성 팝업이다 — 예를
      // 들어 리스트가 5000개를 넘으면(listVariable.js _showListFullWarning) 자동으로
      // 잘라내면서 "리스트에는 최대 5000개까지 넣을 수 있습니다" 를 띄운다. workspace
      // 모드에서나 뜻이 있는 팝업이고, 우리 minimize 뷰어에서는 화면을 가리기만 하니
      // 그냥 띄우지 않는다(진짜 오류는 위 alert/아래 stopProjectWithToast 로 계속 잡힌다).
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

  // ------------------------------------------------------------------
  // 캔버스는 글꼴이 늦게 도착해도 다시 그려 주지 않으므로, 실행 전에 작품이 쓰는 글꼴을
  // 미리 받아 둔다. 글꼴 CSS 가 도착하기 전에는 document.fonts 에 그 글꼴이 없어서
  // load() 가 헛돌기 때문에, CSS 를 먼저 기다린다.
  const waitForFontStyles = () => {
    const links = [...document.querySelectorAll('link[rel="stylesheet"]')]
      .filter((link) => link.href.includes('/uploads/fonts/') && !link.sheet);
    if (links.length === 0) return Promise.resolve();
    return Promise.race([
      Promise.all(links.map((link) => new Promise((resolve) => {
        link.addEventListener('load', resolve, { once: true });
        link.addEventListener('error', resolve, { once: true });
      }))),
      // CDN 이 막힌 곳에서도 실행은 시작되어야 하므로 마냥 기다리지는 않는다
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

  // start-gate 오버레이(위 CSS 주석 참고)를 눌러야 실행을 시작한다 — 그 클릭/키 입력
  // 자체가 브라우저의 자동재생 정책이 요구하는 "사용자 상호작용"이 되어, when start 에서
  // 바로 나오는 소리도 처음부터 정상적으로 들리게 한다. 정작 gate 자체는 여기서 지우지
  // 않는다 — waitForSoundsLoaded 가 끝날 때까지 화면에 남겨 둬야(아래) mp3 가 아직
  // 로딩 중인데도 실행이 이미 시작된 것처럼 보이는 일이 없다.
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

  // Entry.loadProject 는 project.objects 를 훑으면서 소리 파일마다 Entry.initSound 를
  // 불러 Entry.soundQueue(공유 PreloadJS 큐)에 로딩을 등록만 해 두고 기다리지는
  // 않는다(entryjs util/init.js) — 그래서 실행하기(toggleRun)가 곧바로 이어지면,
  // 아직 데이터가 도착하지 않은 소리를 재생하는 블록이 "재생은 됐지만 소리는 안 나는"
  // 상태가 된다(재생 자체는 성공한 것처럼 보여도 재생할 데이터가 없다). Entry.soundQueue
  // 는 등록된 소리가 전부 도착하면 'soundLoaded' 이벤트를 스스로 쏘므로(같은 파일의
  // loadCallback), 그걸 기다렸다가 실행한다. entryjs 자신도 소리 하나당 3초가 지나면
  // 포기하고 넘어가므로(Entry.initSound 의 setTimeout), 우리도 그와 비슷하게 여유를
  // 주고 그래도 안 끝나면 (예: 파일이 404 라서 영영 안 끝나면) 무한정 기다리지 않는다.
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
      // baseUrl 은 일부러 안 정한다 — entryjs 기본값이 location.origin(util/init.js
      // setDefaultPathsFromOptions)이라 tts 읽어주기(block_ai_utilize_tts.js) 같은
      // 'AI 활용' 블록이 우리 서버(/api/expansionBlock/tts/read.mp3)로 요청을 보내는데,
      // 이 서버가 그 경로를 playentry.org 로 그대로 대신 요청해 돌려준다(아래 참고).
      // baseUrl 을 여기서 playentry.org 로 바로 바꾸면 더 간단해 보이지만, 브라우저가
      // 다른 origin(playentry.org)으로 직접 요청을 보내는 순간 그쪽 서버가 CORS 허용
      // 헤더를 안 주기 때문에 그냥 막힌다 — 그래서 꼭 우리 서버를 거쳐야 한다.
      // 엔트리 기본 이미지 (entryDir) 는 서버 응답을 필요로 하지 않는 로컬/CDN 정적
      // 파일이라 이 문제가 없다.
      // entryjs 는 기본값으로 mediaFilePath 를 \`\${libDir}/@entrylabs/entry/images/\` 로 만든다
      // (util/init.js setDefaultPathsFromOptions, entryDir 기본값 '/@entrylabs/entry') — 즉
      // libDir 밑에 '@entrylabs/entry' 폴더가 한 번 더 있다고 가정한다. 그런데 우리 base 는
      // ('/lib' 든 CDN 이든) 이미 그 패키지 폴더 자체를 가리키므로, 그대로 두면
      // '.../lib/@entrylabs/entry/images/...' 처럼 경로가 겹쳐 자를(회전 손잡이, 좌표계,
      // 크기 조절 손잡이 등) 엔트리 자체 기본 이미지가 전부 404 난다. entryDir 를 빈 문자열로
      // 줘서 mediaFilePath 가 우리 base 와 같은 규칙(밑에 바로 images/)을 쓰게 맞춘다.
      entryDir: '',
      fonts: [],
    });
    // Entry.init 은 그 안에서 매번 Entry.toast = new Entry.Toast() 를 새로 만든다
    // (entryjs util/init.js). interceptRuntimeErrors 가 Entry.init 보다 먼저 실행되면
    // 아직 없거나(첫 실행) 곧 버려질 예전 Entry.toast 를 고치는 셈이라 아무 효과가
    // 없다 — 그래서 반드시 Entry.init 이 끝난 다음, 이제부터 계속 쓰일 진짜 Entry.toast
    // 가 만들어진 뒤에 걸어야 한다.
    interceptRuntimeErrors(sourceMap);
    // 부스트 모드·기기·터치 판단 블록을 디버그 패널이 정한 값으로 바꿔 둔다.
    // Entry.init 이 블록 정의(Entry.block)를 채운 뒤에 불러야 한다.
    window.tessPatchEnvironmentBlocks();
    Entry.loadProject(project);
    requestAnimationFrame(() => window.tessLayoutCanvas());
    await waitForStartGate();
    const gate = document.getElementById('start-gate');
    const gateCard = document.getElementById('start-gate-card');
    const soundsReady = waitForSoundsLoaded();
    // 클릭은 이미 받았지만(오디오 잠금 해제엔 그걸로 충분하다) 소리 데이터가 아직
    // 안 왔으면, 실행하기 전까지 게이트를 안내 문구로 바꿔 그대로 띄워 둔다 — 그냥
    // 사라져 버리면 "실행은 됐는데 왜 소리가 하나도 안 나지" 하고 헷갈리게 된다.
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
