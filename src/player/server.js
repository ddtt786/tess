// ============================================================================
//  `tess run` 이 띄우는 작은 정적 서버
//
//  주는 것
//    /                 실행 페이지
//    /project.json     컴파일한 작품
//    /<이름>.ent        내려받기용 묶음
//    /temp/...         모양·소리 리소스
//    /lib/...          @entrylabs/entry 가 설치돼 있으면 그 파일들
// ============================================================================
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { playerPage } from './template.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.bmp': 'image/bmp',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4',
  '.ent': 'application/octet-stream',
};

const CDN = 'https://cdn.jsdelivr.net/npm/@entrylabs/entry@4';

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
 * @param {{project: object, bundle: Buffer, assets: Array, name: string, port?: number, reload?: boolean, sourceMap?: object}} options
 * @returns {Promise<{url: string, close: Function, runtime: string, update: Function}>}
 */
export function serveProject({
  project, bundle, assets = [], name, port = 0, cwd = process.cwd(), reload = true, sourceMap = {},
}) {
  const localRuntime = findLocalRuntime(cwd);
  const base = localRuntime ? '/lib' : CDN;
  const entName = `${safeName(name)}.ent`;

  let currentProject = project;
  let currentBundle = bundle;
  let currentSourceMap = sourceMap;
  // temp/... 경로 -> 실제 파일
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

    if (url === '/' || url === '/index.html') return send(response, 200, '.html', renderPage());
    if (url === '/project.json') return send(response, 200, '.json', JSON.stringify(currentProject));
    if (url === '/sourcemap.json') return send(response, 200, '.json', JSON.stringify(currentSourceMap));
    if (url === `/${entName}`) return send(response, 200, '.ent', currentBundle);

    if (assetFiles.has(url)) return sendFile(response, assetFiles.get(url));

    if (localRuntime && url.startsWith('/lib/')) {
      const target = path.join(localRuntime, url.slice('/lib/'.length));
      if (target.startsWith(localRuntime) && fs.existsSync(target)) return sendFile(response, target);
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
