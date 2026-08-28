// ============================================================================
//  Small static server started by `tess run`.
//
//  Serves:
//    /                 player page
//    /project.json     compiled project
//    /<name>.ent       downloadable bundle
//    /temp/...         costume/sound resources
//    /lib/...          @entrylabs/entry files, if installed
//    /debug-ui.js      debug panel UI (module)
//    /arrow/...        arrow-js used by the debug panel UI
//    /api/expansionBlock/tts/read.mp3   TTS speech, proxied to playentry.org
// ============================================================================
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { playerPage, DEBUG_UI_PATH, ARROW_PATH } from './template.js';

// entryjs's TTS block (block_ai_utilize_tts.js) requests
// `${Entry.baseUrl}/api/expansionBlock/tts/read.mp3?...` directly from the
// browser. Entry.baseUrl defaults to location.origin (this server), which
// routes the request here; pointing it at playentry.org directly would hit
// its missing CORS headers and get blocked by the browser. So this server
// proxies the request to playentry.org server-side (not subject to CORS)
// and streams the mp3 response back — the browser always sees the same
// origin (this server), so there's no CORS issue.
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

// jsDelivr rejects any file from an npm package with 403 once the package
// exceeds 150MB total (`Package size exceeded the configured limit of 150 MB.`).
// @entrylabs/entry exceeds that limit, so even entry.min.js 403s there.
// unpkg serves the same file fine, with no such package-size cap.
const CDN = 'https://unpkg.com/@entrylabs/entry@4.0.22';

const DEBUG_UI_FILE = fileURLToPath(new URL('./debug-ui.js', import.meta.url));

// Uses arrow-js's dist/index.mjs as-is. The package's index.min.mjs (as of
// 1.0.6) breaks list rendering — it prints internal functions as text.
/** The dist folder of the arrow-js used by the debug panel, or null if not found. */
export function findArrowDir() {
  try {
    return path.dirname(fileURLToPath(import.meta.resolve('@arrow-js/core')));
  } catch {
    return null;
  }
}

/** Returns the entryjs directory if it's installed in the project, else null. */
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
 * Starts a server that can run the project.
 *
 * @param {{project: object, bundle: Buffer, assets: Array, name: string, port?: number, reload?: boolean, sourceMap?: object}} options
 * @returns {Promise<{url: string, close: Function, runtime: string, update: Function}>}
 */
export function serveProject({
  project, bundle, assets = [], name, port = 0, cwd = process.cwd(), reload = true, sourceMap = {},
}) {
  const localRuntime = findLocalRuntime(cwd);
  const arrowDir = findArrowDir();
  const base = localRuntime ? '/lib' : CDN;
  const entName = `${safeName(name)}.ent`;

  let currentProject = project;
  let currentBundle = bundle;
  let currentSourceMap = sourceMap;
  // temp/... path -> actual file
  let assetFiles = new Map(assets.map((asset) => [`/${asset.target}`, asset.source]));
  const reloadClients = new Set();

  const renderPage = () => {
    const summary = {
      scenes: currentProject.scenes.length,
      objects: currentProject.objects.length,
      blocks: currentProject.objects.reduce((sum, object) => sum + countBlocks(JSON.parse(object.script)), 0),
    };
    return playerPage({ name, base, summary, entName, reload });
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
    if (url === '/project.json') return send(response, 200, '.json', JSON.stringify(currentProject));
    if (url === '/sourcemap.json') return send(response, 200, '.json', JSON.stringify(currentSourceMap));
    if (url === `/${entName}`) return send(response, 200, '.ent', currentBundle);

    if (assetFiles.has(url)) return sendFile(response, assetFiles.get(url));

    if (localRuntime && url.startsWith('/lib/')) {
      const target = path.join(localRuntime, url.slice('/lib/'.length));
      if (target.startsWith(localRuntime) && fs.existsSync(target)) return sendFile(response, target);
    }

    if (url === DEBUG_UI_PATH) return sendFile(response, DEBUG_UI_FILE);

    // arrow-js, imported by the debug panel UI.
    if (arrowDir && url.startsWith(ARROW_PATH)) {
      const target = path.join(arrowDir, url.slice(ARROW_PATH.length));
      if (target.startsWith(arrowDir) && fs.existsSync(target)) return sendFile(response, target);
    }

    return send(response, 404, '.html', '<h1>404</h1>');
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const { port: actual } = server.address();
      resolve({
        url: `http://127.0.0.1:${actual}/`,
        runtime: localRuntime ? `설치된 @entrylabs/entry (${localRuntime})` : `CDN (${CDN})`,
        // The /__reload SSE connection stays open as long as the browser tab
        // is open, so calling server.close() alone never fires its callback
        // (Node waits for all open connections to end). End the SSE
        // responses first, then force-close any remaining connections.
        close: () => {
          for (const client of reloadClients) client.end();
          reloadClients.clear();
          server.closeAllConnections?.();
          return new Promise((done) => server.close(done));
        },
        /** Swaps in a freshly recompiled project and reloads any open browser tabs. */
        update({ project: nextProject, bundle: nextBundle, assets: nextAssets = [], sourceMap: nextSourceMap = {} }) {
          currentProject = nextProject;
          currentBundle = nextBundle;
          currentSourceMap = nextSourceMap;
          assetFiles = new Map(nextAssets.map((asset) => [`/${asset.target}`, asset.source]));
          for (const client of reloadClients) client.write('event: reload\ndata: ok\n\n');
        },
      });
    });
  });
}

/** Receives a browser-side runtime panic and prints it to the terminal running this server. */
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
      // The server keeps running even if the log body can't be parsed.
    }
    response.writeHead(204).end();
  });
}

/** Proxies a TTS request to playentry.org and streams back its mp3 response (see the TTS_PROXY_PATH note above). */
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

function send(response, status, ext, body) {
  response.writeHead(status, { 'content-type': MIME[ext] ?? 'application/octet-stream' });
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
