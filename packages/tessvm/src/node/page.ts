/**
 * @fileoverview 실행 페이지의 HTML 을 만듭니다.
 *
 * 번들러 없이 브라우저의 ES 모듈을 그대로 씁니다 — 서버가 `.ts` 에서 타입만 지워
 * 내보내고, 임포트 맵이 `pixi.js` 를 실제 파일로 이어 줍니다. 글꼴은 엔트리가 쓰는
 * 것과 같은 CSS 를 걸어야 글상자가 같은 모양으로 그려집니다.
 */
import { ENTRY_FONT_STYLES } from '@tess/player';

export interface PageOptions {
  name: string;
  quality: number;
  /** Leave undefined to follow the project's own `speed`. */
  fps?: number;
  stats: boolean;
  reload: boolean;
  autoStart: boolean;
  boost: boolean;
  stageWidth: number;
  stageHeight: number;
}

const STYLE = `
:root { color-scheme: dark; }
* { box-sizing: border-box; }
[hidden] { display: none !important; }
html, body { height: 100%; margin: 0; }
body {
  display: flex; flex-direction: column; background: #14161a; color: #e8eaed;
  font: 13px/1.5 system-ui, -apple-system, 'Segoe UI', 'Noto Sans KR', sans-serif;
}
header {
  display: flex; align-items: center; gap: 10px; padding: 8px 12px; flex-wrap: wrap;
  background: #1c1f24; border-bottom: 1px solid #2b2f36;
}
header .title { font-weight: 600; margin-right: auto; }
button {
  font: inherit; padding: 4px 12px; border-radius: 6px; border: 1px solid #3a3f47;
  background: #23272e; color: inherit; cursor: pointer;
}
button:hover { background: #2c313a; }
button.primary { background: #4f80ff; border-color: #4f80ff; color: #fff; }
label { display: flex; align-items: center; gap: 4px; white-space: nowrap; }
select, input[type=number] {
  font: inherit; background: #23272e; color: inherit; border: 1px solid #3a3f47;
  border-radius: 6px; padding: 3px 6px;
}
input[type=number] { width: 64px; }
main { flex: 1; display: grid; place-items: center; padding: 12px; min-height: 0; }
.tessvm-stage { position: relative; width: 100%; height: 100%; display: grid; place-items: center; }
.tessvm-stage canvas { display: block; box-shadow: 0 8px 30px #0008; }
main { padding: 12px 12px 34px; }
.tessvm-ask {
  position: absolute; left: 50%; bottom: 6%; transform: translateX(-50%);
  display: flex; gap: 6px; width: min(70%, 520px);
}
.tessvm-ask input {
  flex: 1; font: inherit; padding: 6px 10px; border-radius: 6px;
  border: 2px solid #4f80ff; background: #fff; color: #111;
}
.tessvm-stats {
  position: absolute; right: 0; bottom: -22px; padding: 0 4px; border-radius: 4px;
  color: #8b93a1; font-size: 11px; font-variant-numeric: tabular-nums; pointer-events: none;
  white-space: nowrap;
}
.tessvm-frame { position: relative; }
#tessvm-error {
  position: absolute; inset: auto 12px 12px 12px; padding: 10px 12px; border-radius: 8px;
  background: #46161a; border: 1px solid #7d2b31; white-space: pre-wrap; display: none;
  max-height: 40vh; overflow: auto; font-family: ui-monospace, monospace;
}
`;

export function playerPage(options: PageOptions): string {
  const config = JSON.stringify({
    quality: options.quality,
    fps: options.fps ?? null,
    showStats: options.stats,
    autoStart: options.autoStart,
    boost: options.boost,
    stageWidth: options.stageWidth,
    stageHeight: options.stageHeight,
  });
  const fonts = ENTRY_FONT_STYLES.map(
    (url) => `<link rel="stylesheet" href="${escapeHtml(url)}">`,
  ).join('\n');
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(options.name)} — tessvm</title>
${fonts}
<style>${STYLE}</style>
<script type="importmap">
{"imports": {"pixi.js": "/vm/pixi.mjs"}}
</script>
</head>
<body>
<header>
  <span class="title">${escapeHtml(options.name)}</span>
  <button id="run" class="primary">시작</button>
  <button id="pause">일시정지</button>
  <button id="stop">정지</button>
  <label>화질
    <select id="quality">
      <option value="1">1×</option>
      <option value="2">2×</option>
      <option value="4">4×</option>
    </select>
  </label>
  <label>무대
    <input id="stage-w" type="number" min="16" max="4096" step="1">
    ×
    <input id="stage-h" type="number" min="16" max="4096" step="1">
    <button id="stage-apply">적용</button>
    <button id="stage-reset">480×270</button>
  </label>
</header>
<main><div id="stage"></div></main>
<div id="tessvm-error"></div>
<script type="module">
import { boot } from '/vm/web/boot.ts';

const config = ${config};
const errorBox = document.getElementById('tessvm-error');
function showError(message) {
  errorBox.style.display = 'block';
  errorBox.textContent = message;
}
window.addEventListener('error', (event) => showError(String(event.message)));
window.addEventListener('unhandledrejection', (event) => showError(String(event.reason)));

try {
  const handle = await boot({
    container: document.getElementById('stage'),
    quality: config.quality,
    fps: config.fps ?? undefined,
    showStats: config.showStats,
    autoStart: config.autoStart,
    boost: config.boost,
    stageWidth: config.stageWidth,
    stageHeight: config.stageHeight,
  });
  document.getElementById('run').onclick = () => handle.start();
  document.getElementById('pause').onclick = () => handle.pause();
  document.getElementById('stop').onclick = () => handle.stop();

  const quality = document.getElementById('quality');
  quality.value = String(config.quality);
  quality.onchange = () => {
    handle.renderer.setQuality(Number(quality.value));
    handle.relayout();
  };

  const widthField = document.getElementById('stage-w');
  const heightField = document.getElementById('stage-h');
  const showStage = () => {
    widthField.value = String(handle.stage.width);
    heightField.value = String(handle.stage.height);
  };
  showStage();
  document.getElementById('stage-apply').onclick = () => {
    handle.setStageSize(Number(widthField.value), Number(heightField.value));
    showStage();
  };
  document.getElementById('stage-reset').onclick = () => {
    handle.setStageSize(480, 270);
    showStage();
  };

  if (handle.vm.unknownBlocks.size) {
    console.warn('[tessvm] 아직 지원하지 않는 블록:', [...handle.vm.unknownBlocks.keys()].join(', '));
  }
} catch (error) {
  showError(error && error.stack ? error.stack : String(error));
}
${options.reload ? RELOAD_SCRIPT : ''}
</script>
</body>
</html>`;
}

const RELOAD_SCRIPT = `
new EventSource('/__reload').onmessage = () => location.reload();
`;

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}
