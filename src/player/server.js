// ============================================================================
//  `tess run` 이 띄우는 작은 정적 서버
//
//  주는 것
//    /                 실행 페이지
//    /project.json     컴파일한 작품 (리소스 링크는 아래 실제 경로를 가리킨다)
//    /assets/...       모양·소리 파일을 디스크에 있는 그대로
//    /temp/...         같은 파일을 엔트리가 쓰는 주소로도 (asset-routes.js 참고)
//    /<이름>.ent        내려받기용 묶음 — 요청받은 그때 처음 묶는다
//    /lib/...          @entrylabs/entry 가 설치돼 있으면 그 파일들
//    /debug-ui.js      디버그 패널 UI (모듈)
//    /arrow/...        디버그 패널 UI 가 쓰는 arrow-js
//    /api/expansionBlock/tts/read.mp3   tts 읽어주기 — playentry.org 로 대신 요청해 준다
//
//  `run` 은 작품을 묶지 않는다. 리소스는 있는 자리에서 그대로 내보내고, .ent 는
//  내려받기를 눌렀을 때만 만든다. 묶는 일은 `build` 가 한다.
// ============================================================================
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { playerPage, DEBUG_UI_PATH, ARROW_PATH } from './template.js';
import { assetRoutes, withServedAssets } from './asset-routes.js';
import { makeEntryBundle } from '../compiler/bundle.js';

// entryjs 의 tts 읽어주기(block_ai_utilize_tts.js)는 `${Entry.baseUrl}/api/expansionBlock/tts/read.mp3?...`
// 로 브라우저에서 직접 요청한다. Entry.baseUrl 기본값은 location.origin(우리 서버)이라
// 이 경로가 여기로 들어오는데, playentry.org 로 바로 요청하게 바꾸면(baseUrl 을 그렇게
// 정하면) playentry.org 가 CORS 허용 헤더를 안 줘서 브라우저가 그냥 막아 버린다(서버
// 쪽 요청은 CORS 대상이 아니다). 그래서 이 서버가 대신 playentry.org 로 요청해서
// 그 응답(mp3)을 그대로 돌려준다 — 브라우저 입장에서는 항상 같은 origin(우리 서버)
// 이라 CORS 문제가 없다.
const TTS_PROXY_PATH = '/api/expansionBlock/tts/read.mp3';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.bmp': 'image/bmp',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4',
  '.ent': 'application/octet-stream',
};

// jsDelivr 는 npm 패키지 전체 크기가 150MB 를 넘으면 그 패키지의 어떤 파일이든 403 으로
// 거부한다(`Package size exceeded the configured limit of 150 MB.`) — @entrylabs/entry 는
// 그 한도를 넘어서 jsDelivr 로는 아예 못 받아 온다(entry.min.js 조차 403). 같은 파일을
// unpkg 는 문제없이 준다(같은 npm 레지스트리에서 직접 서빙하며 패키지 전체 크기 제한이 없다).
const CDN = 'https://unpkg.com/@entrylabs/entry@4.0.22';

const DEBUG_UI_FILE = fileURLToPath(new URL('./debug-ui.js', import.meta.url));

/** `run` 이 기본으로 쓰는 포트 */
export const DEFAULT_PORT = 2013;

// arrow-js 는 dist/index.mjs 를 그대로 쓴다. 같은 패키지의 index.min.mjs 는 1.0.6 기준
// 목록 렌더가 깨져서(내부 함수를 글자로 찍는다) 못 쓴다.
/** 디버그 패널이 쓰는 arrow-js 의 dist 폴더. 못 찾으면 null */
export function findArrowDir() {
  try {
    return path.dirname(fileURLToPath(import.meta.resolve('@arrow-js/core')));
  } catch {
    return null;
  }
}

/** 프로젝트에 entryjs 가 설치돼 있으면 그 폴더를 돌려준다 */
export function findLocalRuntime(from = process.cwd()) {
  let dir = path.resolve(from);
  for (;;) {
    const candidate = path.join(dir, 'node_modules', '@entrylabs', 'entry');
    if (fs.existsSync(path.join(candidate, 'dist', 'entry.min.js'))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * 작품을 실행할 수 있는 서버를 띄운다.
 *
 * 리소스는 디스크에 있는 파일을 그대로 내보낸다 — `run` 은 작품을 묶지 않는다.
 * .ent 는 내려받기를 눌렀을 때만 만든다.
 *
 * @param {{project: object, assets: Array, assetDirs?: string[], name: string, port?: number, reload?: boolean, sourceMap?: object, boost?: boolean}} options
 * @returns {Promise<{url: string, close: Function, runtime: string, update: Function}>}
 */
export function serveProject({
  project, assets = [], assetDirs = [], name, port = DEFAULT_PORT, cwd = process.cwd(),
  reload = true, sourceMap = {}, boost = false,
}) {
  const localRuntime = findLocalRuntime(cwd);
  const arrowDir = findArrowDir();
  const base = localRuntime ? '/lib' : CDN;
  // 엔트리 기본 그림(확인 단추 · 좌표계 …)을 가져올 곳. 부스트 모드는 WebGL 이라
  // 다른 origin 의 그림을 텍스처로 못 올리므로(entryjs 가 crossOrigin 없이 Image 를
  // 만든다) 늘 우리 서버를 거치게 하고, 파일이 없으면 아래에서 CDN 으로 대신 받아 준다.
  const mediaBase = localRuntime || boost ? '/lib' : CDN;
  const entName = `${safeName(name)}.ent`;

  let currentProject = project;
  let currentAssets = assets;
  let currentSourceMap = sourceMap;
  // 주소 -> 실제 파일. 엔트리의 temp/… 주소와 디스크 그대로의 주소를 함께 담는다.
  let assetFiles = new Map();
  // fileurl 을 서빙 주소로 바꾼 사본. 내려받는 .ent 는 원본 쪽으로 만든다.
  let servedProject = project;
  // .ent 는 실제로 요청받기 전까지 만들지 않는다.
  let cachedBundle = null;
  const reloadClients = new Set();

  const useAssets = (nextProject, nextAssets) => {
    const { files, rewrites } = assetRoutes(nextAssets, assetDirs, [`/${entName}`]);
    assetFiles = files;
    servedProject = withServedAssets(nextProject, rewrites);
    cachedBundle = null;
  };
  useAssets(project, assets);

  const renderPage = () => {
    const summary = {
      scenes: currentProject.scenes.length,
      objects: currentProject.objects.length,
      blocks: currentProject.objects.reduce((sum, object) => sum + countBlocks(JSON.parse(object.script)), 0),
    };
    return playerPage({ name, base, mediaBase, summary, entName, reload, boost });
  };

  const server = http.createServer((request, response) => {
    const url = decodeURIComponent((request.url ?? '/').split('?')[0]);

    if (reload && url === '/__reload') {
      response.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      response.write(':ok\n\n');
      reloadClients.add(response);
      request.on('close', () => reloadClients.delete(response));
      return;
    }

    if (request.method === 'POST' && url === '/__log') return receiveLog(request, response);
    if (url === TTS_PROXY_PATH) return proxyTts(request, response);

    if (url === '/' || url === '/index.html') return send(response, 200, '.html', renderPage());
    if (url === '/project.json') return send(response, 200, '.json', JSON.stringify(servedProject));
    if (url === '/sourcemap.json') return send(response, 200, '.json', JSON.stringify(currentSourceMap));
    if (url === `/${entName}`) {
      // 여기서 처음으로 작품을 묶는다 — 내려받기를 누르지 않으면 묶을 일이 없다.
      cachedBundle ??= makeEntryBundle(currentProject, currentAssets);
      return send(response, 200, '.ent', cachedBundle);
    }

    if (assetFiles.has(url)) return sendFile(response, assetFiles.get(url));

    if (localRuntime && url.startsWith('/lib/')) {
      const target = path.join(localRuntime, url.slice('/lib/'.length));
      if (target.startsWith(localRuntime) && fs.existsSync(target)) return sendFile(response, target);
    }
    if (!localRuntime && boost && url.startsWith('/lib/')) return proxyRuntimeFile(url, response);

    if (url === DEBUG_UI_PATH) return sendFile(response, DEBUG_UI_FILE);

    // 디버그 패널 UI 가 import 하는 arrow-js
    if (arrowDir && url.startsWith(ARROW_PATH)) {
      const target = path.join(arrowDir, url.slice(ARROW_PATH.length));
      if (target.startsWith(arrowDir) && fs.existsSync(target)) return sendFile(response, target);
    }

    return send(response, 404, '.html', '<h1>404</h1>');
  });

  return new Promise((resolve, reject) => {
    // The default port is a fixed one so the debugger keeps the same origin
    // between runs (devtools state, bookmarks). Fall back to any free port when
    // it is taken rather than refusing to start.
    let retried = port === DEFAULT_PORT;
    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE' && retried) {
        retried = false;
        console.error(`포트 ${port} 가 이미 쓰이고 있어 비어 있는 포트로 대신 엽니다.`);
        server.listen(0, '127.0.0.1');
        return;
      }
      reject(error);
    });
    server.listen(port, '127.0.0.1', () => {
      const { port: actual } = server.address();
      resolve({
        url: `http://127.0.0.1:${actual}/`,
        runtime: localRuntime ? `설치된 @entrylabs/entry (${localRuntime})` : `CDN (${CDN})`,
        // /__reload 의 SSE 연결은 브라우저가 열려 있는 한 계속 붙어 있어서,
        // 그냥 server.close() 만 부르면 콜백이 영영 안 불려 Ctrl+C 로도 못 끝난다
        // (Node 는 켜져 있는 커넥션이 다 끝나야 close 콜백을 부른다). 그래서
        // SSE 응답을 먼저 끝내고, 혹시 남은 커넥션까지 강제로 닫아 준다.
        close: () => {
          for (const client of reloadClients) client.end();
          reloadClients.clear();
          server.closeAllConnections?.();
          return new Promise((done) => server.close(done));
        },
        /** 다시 컴파일한 작품으로 갈아 끼우고, 열려 있는 브라우저를 새로고침한다 */
        update({ project: nextProject, assets: nextAssets = [], sourceMap: nextSourceMap = {} }) {
          currentProject = nextProject;
          currentAssets = nextAssets;
          currentSourceMap = nextSourceMap;
          useAssets(nextProject, nextAssets);
          for (const client of reloadClients) client.write('event: reload\ndata: ok\n\n');
        },
      });
    });
  });
}

/** 브라우저에서 실행하다 난 panic 을 받아서 이 서버를 띄운 터미널에 그대로 찍는다 */
function receiveLog(request, response) {
  let body = '';
  request.on('data', (chunk) => {
    body += chunk;
    if (body.length > 1_000_000) request.destroy();
  });
  request.on('end', () => {
    try {
      const { kind, message, stack, time } = JSON.parse(body);
      const when = new Date(time ?? Date.now()).toLocaleTimeString('ko-KR', { hour12: false });
      console.error(`\n[${when}] 엔트리 실행 중 ${kind ?? '오류'}: ${message ?? '(메시지 없음)'}`);
      if (stack) console.error(stack);
    } catch {
      // 로그 본문을 못 읽어도 서버는 계속 돈다
    }
    response.writeHead(204).end();
  });
}

/** tts 읽어주기 요청을 playentry.org 로 대신 보내고 mp3 응답을 그대로 돌려준다 (TTS_PROXY_PATH 주석 참고) */
async function proxyTts(request, response) {
  const target = `https://playentry.org${request.url}`;
  try {
    const upstream = await fetch(target);
    if (!upstream.ok || !upstream.body) {
      send(response, upstream.status || 502, '.html', '<h1>tts 요청이 playentry.org 에서 실패했습니다</h1>');
      return;
    }
    response.writeHead(200, { 'content-type': upstream.headers.get('content-type') ?? 'audio/mpeg' });
    Readable.fromWeb(upstream.body).pipe(response);
  } catch (error) {
    send(response, 502, '.html', `<h1>tts 요청을 playentry.org 로 보내지 못했습니다: ${error.message}</h1>`);
  }
}

/**
 * 실행기 파일 하나를 CDN 에서 대신 받아 우리 origin 으로 내보낸다.
 *
 * 부스트 모드는 WebGL 로 그리는데, entryjs 는 기본 그림을 `crossOrigin` 없이
 * `new Image()` 로 받아서(GEHelper.newSpriteWithCallback) CDN 에서 온 그림이면
 * 캔버스가 오염된 것으로 취급돼 `texImage2D` 가 SecurityError 로 막힌다 — 확인
 * 단추 같은 기본 그림이 통째로 안 보이고 그 프레임 렌더가 끊긴다.
 */
async function proxyRuntimeFile(url, response) {
  const rest = url.slice('/lib/'.length);
  // 남의 경로로 새어 나가지 않게 한다 — 이 프록시는 그 패키지 안만 내보낸다
  if (rest.split('/').includes('..')) return send(response, 404, '.html', '<h1>404</h1>');
  try {
    const upstream = await fetch(`${CDN}/${rest}`);
    if (!upstream.ok) return send(response, upstream.status, '.html', '<h1>404</h1>');
    const body = Buffer.from(await upstream.arrayBuffer());
    return send(response, 200, path.extname(rest).toLowerCase(), body);
  } catch (error) {
    return send(response, 502, '.html', `<h1>실행기 파일을 CDN 에서 받지 못했습니다: ${error.message}</h1>`);
  }
}

function send(response, status, ext, body) {
  response.writeHead(status, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    // 이 서버는 고칠 때마다 다시 띄우는 개발용이다. 브라우저가 한 번 받아 둔
    // project.json 이나 debug-ui.js 를 계속 쓰면, 고친 게 새로고침해도 안 나온다.
    'cache-control': 'no-store',
  });
  response.end(body);
}

function sendFile(response, file) {
  try {
    send(response, 200, path.extname(file).toLowerCase(), fs.readFileSync(file));
  } catch {
    send(response, 404, '.html', '<h1>404</h1>');
  }
}

function safeName(name) {
  return String(name).replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(0, 60) || 'project';
}

function countBlocks(node) {
  if (Array.isArray(node)) return node.reduce((sum, item) => sum + countBlocks(item), 0);
  if (!node || typeof node !== 'object' || !node.type) return 0;
  return 1 + countBlocks(node.params ?? []) + countBlocks(node.statements ?? []);
}

export { fileURLToPath };
