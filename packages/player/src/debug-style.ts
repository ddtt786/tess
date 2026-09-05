/**
 * 디버그 패널의 스타일입니다. 실행 페이지가 자기 스타일과 함께 붙입니다.
 *
 * 엔트리 실행기 페이지와 tessvm 실행 페이지가 같은 패널을 쓰므로, 패널 스타일은
 * 어느 페이지에도 속하지 않는 여기 한 곳에만 둡니다.
 */

/** 디버그 패널이 쓰는 CSS 규칙 전부. `<style>` 안에 그대로 넣습니다. */
export const DEBUG_PANEL_STYLE = `
  /* 패널이 차지한 폭. 패널이 열리고 닫힐 때 디버그 UI 가 값을 채운다. */
  :root { --debug-panel-width: 0px; }

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
  /* 패널도 끝까지 줄이면 딱 붙어서 폭이 0 이 된다. 손잡이만 화면 오른쪽 가장자리에
     남아 있어서 다시 끌어내면 펴진다 (닫기 × 와 달리 사라지지는 않는다). */
  #debug-panel.collapsed { box-shadow: none; overflow: visible; }
  #debug-panel.collapsed > :not(#debug-resize-handle) { display: none; }
  #debug-panel.collapsed > #debug-resize-handle { width: 11px; left: -11px; background: #4f80ff33; }
  .debug-header { display: flex; align-items: center; padding: 12px 16px; border-bottom: 1px solid #0002; flex: none; }
  .debug-header h2 { font-size: 15px; margin: 0; }
  .debug-header button { margin-left: auto; border: none; background: none; font-size: 18px; cursor: pointer; color: inherit; line-height: 1; }
  .debug-section {
    position: relative; border-bottom: 1px solid #0001; padding: 10px 16px 14px;
    flex: 0 0 auto; box-sizing: border-box;
    display: flex; flex-direction: column; overflow: hidden;
  }
  /* 내용만 스크롤한다 — 섹션 자체가 스크롤하면 접었을 때 손잡이까지 잘려 나간다 */
  .debug-section-body { flex: 1 1 auto; min-height: 0; overflow: auto; }
  .debug-section-last { flex: 1 1 auto; min-height: 120px; }
  /* 끝까지 줄이면 창이 딱 붙어서 높이가 0 이 된다. 손잡이는 있던 자리에 그대로
     남아서, 다시 끌어내면 딱 하고 펴진다. */
  .debug-section.collapsed { padding: 0; overflow: visible; border-bottom-color: #4f80ff66; }
  .debug-section.collapsed > h3, .debug-section.collapsed > .debug-section-body { display: none; }
  /* 접히면 손잡이를 아래로 내건다. 위로 두면 접힌 섹션 위쪽 상자 밖으로 나가서
     .debug-panelbody 의 overflow:hidden 에 잘려 다시 잡을 수 없다. */
  .debug-section.collapsed > .debug-vresize {
    top: 0; bottom: auto; height: 9px; background: #4f80ff26;
  }
  .debug-section.collapsed > .debug-vresize:hover { background: #4f80ff55; }
  /* 섹션 아래쪽 가장자리를 끌어서 높이를 조절한다 */
  .debug-vresize {
    position: absolute; left: 0; right: 0; bottom: 0; height: 7px; cursor: row-resize; z-index: 2;
  }
  .debug-vresize:hover { background: #4f80ff33; }
  .debug-section h3 { font-size: 12px; margin: 0 0 8px; text-transform: uppercase; letter-spacing: .03em; opacity: .6; }
  .debug-empty { opacity: .5; font-size: 13px; margin: 4px 0; }
  .error-item { font-size: 12px; margin-bottom: 6px; border: 1px solid #e5484d55; border-radius: 6px; padding: 4px 8px; }
  .error-item summary { cursor: pointer; color: #e5484d; word-break: break-word; }
  .error-item pre { white-space: pre-wrap; word-break: break-word; font-size: 11px; opacity: .8; margin: 6px 0 0; }
  .debug-scene-title {
    display: flex; align-items: center; gap: 8px;
    font-size: 13px; font-weight: 600; margin: 8px 0 2px;
  }
  .debug-scene-go { margin-left: auto; font-weight: 400; }
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
  /* Ctrl+Shift 로 무대에서 오브젝트를 고르는 중이라는 표시 */
  .debug-pick-hint {
    border-left: 2px solid transparent; padding-left: 8px; margin-left: -10px;
    transition: opacity .12s, border-color .12s, color .12s;
  }
  .debug-pick-hint.active {
    opacity: 1; color: #4f80ff; border-left-color: #4f80ff; font-weight: 600;
  }

  /* --- 자료 탭 --- */
  .debug-rows { list-style: none; margin: 0; padding: 0; font-size: 13px; }
  /* 바로 아래 줄에만 건다 — 펼친 리스트 항목과 함수 블록 트리에도 flex 가 걸리면
     항목이 이름 오른쪽으로 눕고 블록이 가로로 늘어선다. */
  .debug-rows > li { display: flex; align-items: baseline; gap: 8px; padding: 3px 0; border-bottom: 1px solid #0001; }
  /* display 를 정해 두면 브라우저 기본 스타일의 hidden(=display:none)을 이겨 버린다 */
  .debug-rows > li[hidden] { display: none; }
  /* 펼친 내용은 이름 줄 다음 줄로 따로 나온다 — 가로로 눕으면 안 된다 */
  .debug-rows > li.debug-items-row { display: block; border-bottom: none; padding: 0; }
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

  /* 값을 눌러서 바로 고쳐 쓰는 칸 (변수 · 리스트 항목 · 오브젝트 좌표) */
  .debug-edit {
    margin-left: auto; text-align: right; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px; overflow-wrap: anywhere; max-width: 60%;
    border: 1px solid transparent; border-radius: 4px; background: none; color: inherit;
    cursor: text; padding: 1px 5px;
    /* 빈 값이어도 누를 수 있어야 한다 — 글자가 없으면 폭이 0 이 돼 버린다 */
    min-width: 3.5em; min-height: 18px;
  }
  .debug-edit:hover { border-color: #0003; background: #4f80ff11; }
  .debug-edit.empty { opacity: .4; font-style: italic; }
  .debug-edit-input {
    margin-left: auto; width: 55%; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px; text-align: right; padding: 1px 5px; border-radius: 4px;
    border: 1px solid #4f80ff; background: none; color: inherit;
  }

  /* 골라 쓰는 칸 (모양 · 회전 방식) */
  .debug-select {
    margin-left: auto; flex: none; font: inherit; font-size: 12px; max-width: 60%;
    padding: 1px 4px; border-radius: 4px; border: 1px solid #0003; background: none; color: inherit;
  }
  .debug-select option { color: initial; }
  /* 켜고 끄는 칸 (보이기 · 변수 보이기) */
  .debug-toggle {
    flex: none; margin-left: 8px; font-size: 11px; line-height: 1; padding: 3px 9px;
    border-radius: 999px; border: 1px solid #0003; background: none; color: inherit;
    cursor: pointer; opacity: .45;
  }
  .debug-toggle.on { opacity: 1; border-color: #4f80ff88; background: #4f80ff1a; }
  .debug-toggle:hover { background: #4f80ff22; }

  /* 펼치는 줄 (리스트 · 함수) */
  .debug-list-head { display: flex; align-items: baseline; gap: 8px; }
  .debug-expand {
    border: none; background: none; color: inherit; font: inherit; cursor: pointer;
    padding: 0; text-align: left;
  }
  .debug-expand::before { content: '▸'; display: inline-block; width: 12px; opacity: .5; }
  .debug-expand.open::before { content: '▾'; }
  .debug-expand:hover { color: #4f80ff; }
  /* 항목이 100개여도 패널을 다 잡아먹지 않도록 여기서 스크롤한다 */
  .debug-list-items { max-height: 190px; overflow: auto; margin: 4px 0 8px 12px; }
  .debug-list-ol { list-style: none; margin: 0; padding: 0; }
  .debug-list-ol > li { display: flex; align-items: center; gap: 6px; padding: 1px 0; }
  .debug-list-index { flex: none; font-size: 11px; opacity: .45; min-width: 22px; text-align: right; }
  /* 항목 값은 남는 폭을 다 쓴다. 오른쪽으로 밀어 놓으면 글이 긴 항목이 몇 글자만 보인다. */
  .debug-list-ol .debug-edit,
  .debug-list-ol .debug-edit-input {
    flex: 1 1 auto; width: auto; max-width: none; margin-left: 0; text-align: left; min-width: 0;
  }
  .debug-list-ol .debug-mini-btn { flex: none; }
  .debug-mini-btn {
    font-size: 11px; line-height: 1; padding: 3px 7px; border-radius: 5px;
    border: 1px solid #0003; background: none; color: inherit; cursor: pointer;
  }
  .debug-mini-btn:hover { background: #4f80ff22; }
  .debug-add-btn { margin: 0 0 6px; }
  .debug-func-code { font-size: 12px; }
  .debug-func-code ul { list-style: none; margin: 0; padding-left: 12px; border-left: 1px dashed #0002; }
  .debug-func-code > ul { padding-left: 0; border-left: none; }

  /* --- 오브젝트 정보 --- */
  #object-info .key { opacity: .7; }
  #object-info .val { margin-left: auto; text-align: right; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
`;
