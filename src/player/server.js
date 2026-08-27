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
 * @param {{project: object, bundle: Buffer, assets: Array, name: string, port?: number}} options
 * @returns {Promise<{url: string, close: Function, runtime: string}>}
 */
export function serveProject({ project, bundle, assets = [], name, port = 0, cwd = process.cwd() }) {
  const localRuntime = findLocalRuntime(cwd);
  const base = localRuntime ? '/lib' : CDN;
  const entName = `${safeName(name)}.ent`;

  const summary = {
    scenes: project.scenes.length,
    objects: project.objects.length,
    blocks: project.objects.reduce((sum, object) => sum + countBlocks(JSON.parse(object.script)), 0),
  };
  const page = playerPage({ name, base, summary, entName });

  // temp/... 경로 -> 실제 파일
  const assetFiles = new Map(assets.map((asset) => [`/${asset.target}`, asset.source]));

  const server = http.createServer((request, response) => {
    const url = decodeURIComponent((request.url ?? '/').split('?')[0]);

    if (url === '/' || url === '/index.html') return send(response, 200, '.html', page);
    if (url === '/project.json') return send(response, 200, '.json', JSON.stringify(project));
    if (url === `/${entName}`) return send(response, 200, '.ent', bundle);

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
        close: () => new Promise((done) => server.close(done)),
      });
    });
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
