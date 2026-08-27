// ============================================================================
//  컴파일한 작품을 브라우저에서 열어 보기 위한 페이지
//
//  엔트리 실행기(entryjs)는 서드파티 라이브러리가 많아서 통째로 담지 않고
//  다음 순서로 찾는다.
//    1. 프로젝트에 설치된 node_modules/@entrylabs/entry  (오프라인)
//    2. jsDelivr / unpkg CDN                              (기본)
//  둘 다 못 쓰면 페이지가 그 사실을 알려 주고, 작품 파일을 내려받아
//  playentry.org 에서 여는 길을 안내한다.
// ============================================================================

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
 * @param {{name: string, base: string, summary: object, entName: string}} options
 *   base 는 entryjs 파일들을 가져올 곳 (`/lib` 또는 CDN 주소)
 */
export function playerPage({ name, base, summary, entName }) {
  const scripts = RUNTIME_FILES
    .map((file) => `<script src="${base}/${file}"></script>`)
    .join('\n    ');

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(name)} — Tess</title>
<link rel="stylesheet" href="${base}/${RUNTIME_STYLE}">
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; background: #f4f5f7; color: #16181d; }
  @media (prefers-color-scheme: dark) { body { background: #16181d; color: #e8eaee; } }
  header { display: flex; align-items: baseline; gap: 12px; padding: 12px 18px; border-bottom: 1px solid #0002; }
  header h1 { font-size: 16px; margin: 0; }
  header .summary { font-size: 13px; opacity: .7; }
  header a { margin-left: auto; font-size: 13px; }
  #workspace { min-height: 70vh; }
  #fallback { display: none; max-width: 640px; margin: 40px auto; padding: 24px 28px; border-radius: 12px;
              background: #fff; box-shadow: 0 1px 3px #0002; line-height: 1.7; }
  @media (prefers-color-scheme: dark) { #fallback { background: #21242b; } }
  #fallback h2 { margin-top: 0; font-size: 17px; }
  #fallback code { background: #0001; padding: 1px 5px; border-radius: 4px; }
  #fallback ol { padding-left: 20px; }
</style>
</head>
<body>
<header>
  <h1>${escapeHtml(name)}</h1>
  <span class="summary">장면 ${summary.scenes} · 오브젝트 ${summary.objects} · 블록 ${summary.blocks}</span>
  <a href="/${escapeHtml(entName)}" download>작품 파일(.ent) 내려받기</a>
</header>

<div id="workspace"></div>

<section id="fallback">
  <h2>엔트리 실행기를 불러오지 못했습니다</h2>
  <p>작품은 정상적으로 컴파일됐습니다. 실행기(entryjs)만 못 가져왔습니다.</p>
  <ol>
    <li>인터넷이 막혀 있다면 <code>pnpm add -D @entrylabs/entry</code> 로 설치한 뒤 다시 <code>run</code> 하세요.
        설치돼 있으면 그 파일을 씁니다.</li>
    <li>또는 위의 <b>작품 파일(.ent) 내려받기</b> 를 눌러 받은 뒤,
        <a href="https://playentry.org/ws/new" target="_blank" rel="noreferrer">playentry.org</a> 에서
        <b>불러오기 → 오프라인 작품 불러오기</b> 로 열면 됩니다.</li>
  </ol>
  <p id="fallback-reason" style="opacity:.7; font-size:13px"></p>
</section>

<script src="https://cdn.jsdelivr.net/npm/jquery@3.7.1/dist/jquery.min.js"></script>
${scripts}
<script>
(async function () {
  const showFallback = (reason) => {
    document.getElementById('workspace').style.display = 'none';
    document.getElementById('fallback').style.display = 'block';
    document.getElementById('fallback-reason').textContent = reason;
  };

  if (typeof window.Entry === 'undefined') {
    showFallback('entryjs 를 불러오지 못했습니다: ${escapeHtml(base)}');
    return;
  }

  try {
    const project = await (await fetch('/project.json')).json();
    Entry.init(document.getElementById('workspace'), {
      type: 'minimize',
      libDir: '${escapeHtml(base)}',
      fonts: [],
    });
    Entry.loadProject(project);
    Entry.engine && Entry.engine.toggleRun && Entry.engine.toggleRun();
  } catch (error) {
    showFallback('작품을 실행하는 중 문제가 생겼습니다: ' + error.message);
  }
})();
</script>
</body>
</html>
`;
}
