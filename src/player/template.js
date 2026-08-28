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
  .replaceAll('"', '&quot;').replaceAll("'", '&#39;');

/**
 * 값을 `<script>` 안에 그대로 넣어도 되는 자바스크립트 리터럴로 바꾼다.
 *
 * 스크립트 안에서는 HTML 이스케이프(escapeHtml)가 소용없다. 브라우저는 `<script>`
 * 본문을 HTML 로 해석하지 않으므로 `&quot;` 가 글자 그대로 남고, 반대로 문자열 안의
 * `</script`(대소문자 무관)를 만나면 거기서 스크립트를 끝내고 그 뒤를 마크업으로 읽는다.
 * 그래서 JSON 으로 만든 뒤 `<`, `>`, `&` 와 자바스크립트가 줄바꿈으로 취급하는
 * U+2028, U+2029 까지 유니코드 이스케이프로 바꾼다.
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
  // base 는 서버가 정하는 값이지만(로컬 '/lib' 또는 CDN 주소) 속성 자리에 그대로
  // 이어 붙이지 않는다. 따옴표 하나만 섞여 들어가도 속성이 거기서 끝나고 그 뒤가 새
  // 속성으로 읽히기 때문이다. 이 페이지에서 값을 끼워 넣는 자리는 모두 escapeHtml
  // (속성과 본문) 이나 jsValue(`<script>` 안)를 거친다.
  const libBase = escapeHtml(base);
  const thirdPartyScripts = THIRD_PARTY_SCRIPTS
    .map((url) => `<script src="${escapeHtml(url)}" crossorigin="anonymous"></script>`)
    .join('\n    ');
  const runtimeScripts = RUNTIME_FILES
    .map((file) => `<script src="${libBase}/${escapeHtml(file)}" crossorigin="anonymous"></script>`)
    .join('\n    ');

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(name)} — Tess</title>
<link rel="stylesheet" href="${escapeHtml(THIRD_PARTY_STYLE)}">
<link rel="stylesheet" href="${libBase}/${escapeHtml(RUNTIME_STYLE)}">
<link rel="stylesheet" href="${escapeHtml(ENTRY_FONTS_STYLE)}">
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

  /* 엔트리 minimize 실행기 바는 정지하기와 일시정지 버튼을 바로 붙여서 그린다
     (entry.min.js 가 stopButton 다음에 pauseButton 을 붙인다). 멈추려다 일시정지를
     누르는 일이 잦으므로 사이를 벌려 둔다. */
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
  .debug-panelbody > .debug-section:last-child { flex: 1 1 auto; min-height: 120px; }

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

<aside id="debug-panel" aria-hidden="true">
  <div id="debug-resize-handle" title="드래그해서 크기 조절"></div>
  <div class="debug-header">
    <h2>디버그</h2>
    <button id="debug-close" type="button" aria-label="닫기">×</button>
  </div>

  <div class="debug-tabs" role="tablist">
    <button class="debug-tab" type="button" role="tab" data-tab="run" aria-selected="true" aria-controls="tab-run">실행</button>
    <button class="debug-tab" type="button" role="tab" data-tab="data" aria-selected="false" aria-controls="tab-data">자료</button>
    <button class="debug-tab" type="button" role="tab" data-tab="objects" aria-selected="false" aria-controls="tab-objects">오브젝트</button>
    <button class="debug-tab" type="button" role="tab" data-tab="errors" aria-selected="false" aria-controls="tab-errors">
      오류 <span id="error-count" class="badge" hidden>0</span>
    </button>
  </div>

  <div class="debug-panelbody" id="tab-run" role="tabpanel">
    <section class="debug-section">
      <h3>실행 제어</h3>
      <p class="debug-run-state" id="run-state"><span class="dot"></span><span id="run-state-text">준비 중…</span></p>
      <div class="debug-run-buttons">
        <button id="run-btn" type="button">시작하기</button>
        <button id="pause-btn" type="button">일시정지</button>
        <button id="stop-btn" type="button">정지하기</button>
      </div>
      <p class="debug-note">정지한 뒤에도 <b>시작하기</b> 로 처음부터 다시 실행할 수 있습니다.</p>
    </section>
    <section class="debug-section">
      <h3>실행 환경 흉내내기</h3>
      <div class="debug-field">
        <label for="env-boost">부스트 모드</label>
        <select id="env-boost">
          <option value="">실제 값 그대로</option>
          <option value="true">켜짐 (참)</option>
          <option value="false">꺼짐 (거짓)</option>
        </select>
      </div>
      <div class="debug-field">
        <label for="env-device">기기 종류</label>
        <select id="env-device">
          <option value="">실제 값 그대로</option>
          <option value="desktop">컴퓨터</option>
          <option value="tablet">태블릿</option>
          <option value="mobile">스마트폰</option>
        </select>
      </div>
      <div class="debug-field">
        <label for="env-touch">터치 지원</label>
        <select id="env-touch">
          <option value="">실제 값 그대로</option>
          <option value="true">지원함 (참)</option>
          <option value="false">지원 안 함 (거짓)</option>
        </select>
      </div>
      <p class="debug-note">Tess 의 <code>boost_mode</code> · <code>device == "..."</code> ·
      <code>touchable</code> 이 여기서 정한 값을 그대로 돌려줍니다. 브라우저를 바꾸지 않고도
      다른 기기에서만 도는 분기를 확인할 수 있습니다.</p>
    </section>
  </div>

  <div class="debug-panelbody" id="tab-data" role="tabpanel" hidden>
    <section class="debug-section">
      <h3>변수 · 리스트 <span id="var-note" class="debug-empty"></span></h3>
      <div id="var-list"><p class="debug-empty">불러오는 중…</p></div>
    </section>
    <section class="debug-section">
      <h3>신호</h3>
      <div id="signal-list"><p class="debug-empty">불러오는 중…</p></div>
    </section>
    <section class="debug-section">
      <h3>함수</h3>
      <div id="function-list"><p class="debug-empty">불러오는 중…</p></div>
    </section>
  </div>

  <div class="debug-panelbody" id="tab-objects" role="tabpanel" hidden>
    <section class="debug-section">
      <h3>장면 · 오브젝트</h3>
      <div id="scene-tree"><p class="debug-empty">불러오는 중…</p></div>
    </section>
    <section class="debug-section">
      <h3>컴파일된 블록 <span id="block-object-name"></span></h3>
      <div id="block-tree"><p class="debug-empty">위 목록에서 오브젝트를 고르세요.</p></div>
    </section>
  </div>

  <div class="debug-panelbody" id="tab-errors" role="tabpanel" hidden>
    <section class="debug-section">
      <h3>오류 로그</h3>
      <div id="error-log"></div>
    </section>
  </div>
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

  // --------------------------------------------------------------------
  // DOM 을 만드는 도우미들.
  //
  // 이 패널이 보여 주는 이름(오브젝트, 장면, 변수, 신호, 함수)은 모두 작품에서 온
  // 값이고, 그 작품은 다른 사람이 만든 .ent 를 되돌린 것일 수도 있다. innerHTML 로
  // 문자열을 이어 붙이면 이름 안에 들어 있는 <img onerror=...> 가 그대로 실행되므로,
  // 디버그 UI 는 innerHTML 을 쓰지 않고 textContent 로만 글자를 넣는다.
  // --------------------------------------------------------------------
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  };
  const clear = (node) => { while (node.firstChild) node.removeChild(node.firstChild); };
  const setEmpty = (node, text) => { clear(node); node.appendChild(el('p', 'debug-empty', text)); };

  // --------------------------------------------------------------------
  // 탭
  // --------------------------------------------------------------------
  setEmpty(errorLogEl, '아직 오류가 없습니다. entryjs 가 실행 중 panic 을 내면 여기와 '
    + '이 서버를 띄운 터미널에 같이 찍힙니다.');

  const tabButtons = Array.from(document.querySelectorAll('.debug-tab'));
  const tabPanels = {};
  for (const button of tabButtons) tabPanels[button.dataset.tab] = document.getElementById('tab-' + button.dataset.tab);
  let activeTab = 'run';

  const showTab = (name) => {
    if (!tabPanels[name]) return;
    activeTab = name;
    for (const button of tabButtons) {
      const on = button.dataset.tab === name;
      button.setAttribute('aria-selected', on ? 'true' : 'false');
      tabPanels[button.dataset.tab].hidden = !on;
    }
    if (name === 'data') refreshData();
  };
  for (const button of tabButtons) button.addEventListener('click', () => showTab(button.dataset.tab));

  // 패널이 지금 차지하는 폭을 --debug-panel-width 로 내보내서 header·#workspace 가
  // 그만큼 밀리게 하고, 엔트리 화면도 남은 공간에 맞춰 다시 배치한다.
  const syncPanelWidth = () => {
    const width = panel.classList.contains('open') ? panel.getBoundingClientRect().width : 0;
    document.documentElement.style.setProperty('--debug-panel-width', width + 'px');
    window.tessLayoutCanvas();
  };

  const openPanel = (tab) => {
    panel.classList.add('open');
    panel.setAttribute('aria-hidden', 'false');
    if (tab) showTab(tab);
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

  // --------------------------------------------------------------------
  // 실행 제어 — 시작 / 일시정지 / 정지
  //
  // 엔트리 실행기 바에도 같은 버튼이 있다. 다만 minimize 모드에서는 정지한 뒤 다시
  // 시작하려면 화면을 덮는 큰 재생 버튼을 눌러야 하는데, 그 버튼이 디버그 패널이나
  // 캔버스 배치에 가려지기도 한다. 그래서 여기에서 직접 부른다.
  // --------------------------------------------------------------------
  const runStateEl = document.getElementById('run-state');
  const runStateTextEl = document.getElementById('run-state-text');
  const runBtn = document.getElementById('run-btn');
  const pauseBtn = document.getElementById('pause-btn');
  const stopBtn = document.getElementById('stop-btn');

  const engine = () => (window.Entry && Entry.engine) || null;
  /** 'run', 'pause', 'stop' 중 하나. 실행기가 아직 없으면 null. */
  const engineState = () => {
    const e = engine();
    if (!e || typeof e.isState !== 'function') return null;
    for (const state of ['run', 'pause', 'stop']) {
      try { if (e.isState(state)) return state; } catch (err) { /* 상태를 못 읽으면 다음 것 */ }
    }
    return null;
  };

  const STATE_TEXT = { run: '실행 중', pause: '일시정지됨', stop: '멈춰 있음' };
  const syncRunButtons = () => {
    const state = engineState();
    runStateEl.className = 'debug-run-state' + (state ? ' state-' + state : '');
    runStateTextEl.textContent = state ? STATE_TEXT[state] : '실행기를 기다리는 중…';
    runBtn.disabled = !state || state === 'run';
    pauseBtn.disabled = !state || state === 'stop';
    stopBtn.disabled = !state || state === 'stop';
    pauseBtn.textContent = state === 'pause' ? '이어서 하기' : '일시정지';
  };

  const guard = (action) => {
    try { action(); } catch (error) { window.tessReportError('실행 제어', error); }
    // 엔트리는 상태를 비동기로 바꾸므로 잠시 뒤에 한 번 더 맞춰 준다
    syncRunButtons();
    setTimeout(syncRunButtons, 60);
  };

  runBtn.addEventListener('click', () => guard(() => {
    const e = engine();
    if (!e) return;
    // 일시정지 상태에서 시작하기를 누르면 이어서 하기로 본다. 멈춰 있으면
    // toggleRun 이 처음부터 다시 실행한다. 정지한 뒤의 재실행이 여기에서 이루어진다.
    if (engineState() === 'pause') e.togglePause();
    else e.toggleRun();
  }));
  pauseBtn.addEventListener('click', () => guard(() => engine() && engine().togglePause()));
  stopBtn.addEventListener('click', () => guard(() => engine() && engine().toggleStop()));
  setInterval(() => {
    syncRunButtons();
    // 자료 탭이 열려 있을 때만 변수 값을 다시 읽는다. 닫혀 있으면 읽어도 소용이 없다.
    if (activeTab === 'data' && panel.classList.contains('open')) refreshData();
  }, 400);

  // --------------------------------------------------------------------
  // 실행 환경 흉내내기 — 부스트 모드 · 기기 종류 · 터치 지원
  //
  // 이 세 가지는 엔트리 판단 블록이 브라우저에게 직접 물어보는 값이다(각각
  // Entry.options.useWebGL, Entry.Utils.getDeviceType(), 'ontouchstart' in window).
  // 그래서 데스크톱 브라우저 하나로는 다른 갈래를 확인할 방법이 없다. 블록의 func 을
  // 감싸서, 여기에서 정한 값이 있으면 그 값을 대신 돌려주게 한다.
  // --------------------------------------------------------------------
  const env = { boost: null, device: null, touch: null };
  window.tessEnv = env;

  const readChoice = (value) => (value === '' ? null : value === 'true');
  document.getElementById('env-boost').addEventListener('change', (event) => {
    env.boost = readChoice(event.target.value);
  });
  document.getElementById('env-touch').addEventListener('change', (event) => {
    env.touch = readChoice(event.target.value);
  });
  document.getElementById('env-device').addEventListener('change', (event) => {
    env.device = event.target.value === '' ? null : event.target.value;
  });

  /** Entry.init 이 블록 정의(Entry.block)를 만든 뒤에 불러야 한다 */
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
    wrap('is_boost_mode', () => env.boost);
    wrap('is_touch_supported', () => env.touch);
    wrap('is_current_device_type', (args) => {
      if (env.device === null) return null;
      // func(sprite, script) 형태이고, 어떤 기기를 묻는지는 DEVICE 필드에 들어 있다
      const script = args[1];
      try { return script.getField('DEVICE', script) === env.device; } catch (e) { return null; }
    });
  };

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
    const time = new Date().toLocaleTimeString('ko-KR', { hour12: false });
    item.appendChild(el('summary', null, '[' + time + '] ' + kind + ': ' + message));
    if (stack) item.appendChild(el('pre', null, stack));
    errorLogEl.prepend(item);
    if (errorCount === 1) openPanel('errors');

    fetch('/__log', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind, message, stack, time: Date.now() }),
    }).catch(() => {});
  };

  // createjs(SoundJS)의 AbstractPlugin._handlePreloadComplete 는 소리를 미리 불러올 때
  // (project.json 의 일반 소리든 tts 읽어주기든 다 해당) 내부적으로 PreloadJS 의 LoadQueue
  // 완료 이벤트와 자기 자신의 재생 목록(_soundInstances) 갱신 시점이 어긋나는 경우가 있어,
  // 'e.setPlaybackResource is not a function' 을 종종 붙잡지 못한 채로 던진다 — 실제로는
  // 그 뒤에도 소리가 정상적으로 만들어지고 재생된다(직접 확인함: AudioContext 는 계속
  // 'running' 상태고 해당 소리의 재생 인스턴스도 만들어진다), 즉 겉보기엔 무섭지만 아무
  // 기능도 막지 않는 순전히 시각적인 소음이다. createjs.min.js 는 CDN 에서 통째로 받아
  // 오는 서드파티 파일이라 이 라이브러리 자체의 버그를 여기서 고칠 수는 없으니, 이
  // 정확한 메시지만 걸러서 디버그 패널의 오류 로그로는 올리지 않는다(그 외 오류는 계속
  // 다 잡는다).
  const isBenignCreatejsPreloadNoise = (message) => /setPlaybackResource is not a function/.test(message ?? '');

  window.addEventListener('error', (event) => {
    if (isBenignCreatejsPreloadNoise(event.message) || isBenignCreatejsPreloadNoise(event.error?.message)) return;
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
    if (isBenignCreatejsPreloadNoise(reason && reason.message)) return;
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
    clear(blockTreeEl);
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
      setEmpty(blockTreeEl, '이 오브젝트에는 블록이 없습니다.');
      return;
    }
    threads.forEach((thread, index) => {
      const wrap = el('div', 'debug-thread');
      wrap.appendChild(el('div', 'debug-thread-label', '스크립트 ' + (index + 1)));
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

  // --------------------------------------------------------------------
  // 자료 탭 — 변수·리스트의 지금 값, 신호, 함수
  //
  // 이름과 구성은 project.json 에서 읽고, 값은 실행 중인 Entry.variableContainer 에서
  // 읽는다. 아직 실행하지 않았거나 실행기가 없으면 컴파일할 때의 초기값을 보여 준다.
  // --------------------------------------------------------------------
  const varListEl = document.getElementById('var-list');
  const varNoteEl = document.getElementById('var-note');
  const signalListEl = document.getElementById('signal-list');
  const functionListEl = document.getElementById('function-list');
  let projectData = null;

  const preview = (value) => {
    if (value === null || value === undefined) return '(없음)';
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    return text.length > 80 ? text.slice(0, 80) + '…' : text;
  };

  /** 실행 중이면 지금 값을, 그렇지 않으면 project.json 의 초기값을 돌려준다 */
  const liveValue = (entry) => {
    const container = window.Entry && Entry.variableContainer;
    try {
      if (entry.variableType === 'list') {
        const list = container && container.getList && container.getList(entry.id);
        const array = list && typeof list.getArray === 'function'
          ? list.getArray()
          : (entry.array || []);
        return '[' + array.length + '개] ' + preview(array.map((item) => item && item.data));
      }
      const variable = container && container.getVariable && container.getVariable(entry.id);
      if (variable && typeof variable.getValue === 'function') return preview(variable.getValue());
    } catch (error) { /* 실행기에서 읽지 못하면 초기값을 보여 준다 */ }
    return preview(entry.value);
  };

  const row = (name, tag, valueText) => {
    const li = document.createElement('li');
    const key = el('span', 'key', name);
    li.appendChild(key);
    if (tag) li.appendChild(el('span', 'tag', tag));
    li.appendChild(el('span', 'val', valueText));
    return li;
  };

  function refreshData() {
    if (!projectData) return;

    const variables = (projectData.variables || [])
      .filter((entry) => entry.variableType !== 'timer' && entry.variableType !== 'answer');
    if (variables.length === 0) {
      setEmpty(varListEl, '변수나 리스트가 없습니다.');
    } else {
      const list = el('ul', 'debug-rows');
      for (const entry of variables) {
        const scope = entry.object ? (objectNameById[entry.object] || '오브젝트') : '전역';
        const kind = entry.variableType === 'list' ? '리스트' : '변수';
        list.appendChild(row(entry.name, scope + ' · ' + kind, liveValue(entry)));
      }
      clear(varListEl);
      varListEl.appendChild(list);
    }
    varNoteEl.textContent = engineState() === 'run' ? '(실행 중 · 실시간)' : '';

    const messages = projectData.messages || [];
    if (messages.length === 0) {
      setEmpty(signalListEl, '신호가 없습니다.');
    } else {
      const list = el('ul', 'debug-rows');
      for (const message of messages) {
        const li = document.createElement('li');
        li.appendChild(el('span', 'key', message.name));
        const send = el('button', 'debug-send-btn', '보내기');
        send.type = 'button';
        send.addEventListener('click', () => {
          try {
            Entry.engine.fireEvent('when_message_cast', message.id);
          } catch (error) { window.tessReportError('신호 보내기', error); }
        });
        li.appendChild(send);
        list.appendChild(li);
      }
      clear(signalListEl);
      signalListEl.appendChild(list);
    }

    const functions = projectData.functions || [];
    if (functions.length === 0) {
      setEmpty(functionListEl, '함수가 없습니다.');
    } else {
      const list = el('ul', 'debug-rows');
      for (const fn of functions) {
        const head = describeFunction(fn);
        list.appendChild(row(head.name, head.params + '개 인자', head.kind));
      }
      clear(functionListEl);
      functionListEl.appendChild(list);
    }
  }

  /** 함수 정의 블록의 머리에서 이름과 인자 개수, 종류를 읽는다 (컴파일러가 만드는 사슬과 같은 구조다) */
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
    } catch (error) { /* 읽지 못하면 id 를 대신 보여 준다 */ }
    return { name, params, kind };
  };

  const objectNameById = {};

  window.tessRenderProjectDebug = function renderProjectDebug(project) {
    projectData = project;
    for (const object of project.objects) objectNameById[object.id] = object.name;
    clear(sceneTreeEl);
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
    for (const node of blockTreeEl.querySelectorAll('.block-highlight, .block-highlight-child')) {
      node.classList.remove('block-highlight', 'block-highlight-child');
    }
    const ids = window.tessCollectParamIds(blockDataById[blockId], []);
    ids.forEach((id, index) => {
      const target = blockTreeEl.querySelector('[data-block-id="' + id + '"]');
      if (!target) return;
      target.classList.add(index === 0 ? 'block-highlight' : 'block-highlight-child');
      if (index === 0) target.scrollIntoView({ block: 'center' });
    });
    openPanel('objects');
  };
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
<script>
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
  // 글상자에 쓰는 커스텀 폰트(나눔고딕 · DungGeunMo · SDChildfundkorea ...)는
  // @font-face 로 "선언"만 돼 있을 뿐(ENTRY_FONTS_STYLE), 실제 폰트 파일은
  // 그 폰트가 처음 쓰일 때(캔버스에 그 글꼴로 글자를 그릴 때) 브라우저가 그제서야
  // 내려받기 시작한다 — 그런데 캔버스는 DOM 과 달리 폰트가 늦게 도착해도 알아서
  // 다시 그려주지 않는다. 그래서 when start 에서 곧바로 보이는 글상자(이 프로젝트의
  // 인트로 화면처럼)는 폰트가 아직 준비되기 전에 첫 프레임이 그려져 버리면, 그
  // 대체 글꼴 모습 그대로 남아 버릴 수 있다. 실행하기 전에 프로젝트가 쓰는 글꼴을
  // 전부 미리 내려받아 둬서, 첫 프레임부터 올바른 글꼴로 그려지게 한다.
  const preloadTextFonts = async (project) => {
    const fonts = new Set(
      (project.objects ?? [])
        .filter((object) => object.objectType === 'textBox' && object.entity?.font)
        .map((object) => object.entity.font),
    );
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
