/**
 * @fileoverview `tessvm run` 이 띄우는 정적 서버입니다.
 *
 * 번들 단계가 없습니다 — 브라우저 쪽 소스는 `.ts` 그대로 두고 내보낼 때 타입만
 * 지웁니다(`stripTypeScriptTypes`). 줄과 열이 그대로라 개발자 도구에서 본 위치가
 * 저장소의 위치와 같습니다.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import { assetRoutes, withServedAssets } from '@tess/player';
import type { AssetFile, EntryProject } from '@tess/compiler';
import { playerPage } from './page.ts';
import { DEFAULT_STAGE_HEIGHT, DEFAULT_STAGE_WIDTH } from '../runtime/model.ts';

export const DEFAULT_PORT = 2014;

export interface ServeOptions {
  project: EntryProject;
  assets: AssetFile[];
  assetDirs: string[];
  name: string;
  port?: number;
  quality?: number;
  /** Leave unset to follow the project's own `speed`. */
  fps?: number;
  stageWidth?: number;
  stageHeight?: number;
  stats?: boolean;
  reload?: boolean;
  autoStart?: boolean;
  boost?: boolean;
}

export interface RunningServer {
  url: string;
  port: number;
  close(): Promise<void>;
  update(next: { project: EntryProject; assets: AssetFile[] }): void;
}

const SRC_DIR = fileURLToPath(new URL('../', import.meta.url));
const PIXI_FILE = fileURLToPath(
  new URL('../../node_modules/pixi.js/dist/pixi.mjs', import.meta.url),
);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
};

export async function serveVm(options: ServeOptions): Promise<RunningServer> {
  let routes = assetRoutes(options.assets, options.assetDirs);
  let served = withServedAssets(options.project, routes.rewrites);
  let projectJson = JSON.stringify(served);
  const listeners = new Set<http.ServerResponse>();

  const server = http.createServer((request, response) => {
    const url = decodeURIComponent((request.url ?? '/').split('?')[0] ?? '/');

    if (url === '/' || url === '/index.html') {
      return send(response, 200, MIME['.html']!, playerPage({
        name: options.name,
        quality: options.quality ?? 1,
        fps: options.fps,
        stats: options.stats ?? true,
        reload: options.reload ?? false,
        autoStart: options.autoStart ?? true,
        boost: options.boost ?? false,
        stageWidth: options.stageWidth ?? DEFAULT_STAGE_WIDTH,
        stageHeight: options.stageHeight ?? DEFAULT_STAGE_HEIGHT,
      }));
    }

    if (url === '/project.json') {
      return send(response, 200, MIME['.json']!, projectJson);
    }

    if (url === '/__reload') {
      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      response.write('\n');
      listeners.add(response);
      request.on('close', () => listeners.delete(response));
      return undefined;
    }

    if (url === '/vm/pixi.mjs') {
      return sendFile(response, PIXI_FILE, MIME['.mjs']!);
    }

    if (url.startsWith('/vm/')) {
      const relative = url.slice('/vm/'.length);
      const file = path.join(SRC_DIR, relative);
      if (!file.startsWith(SRC_DIR) || !fs.existsSync(file)) {
        return send(response, 404, 'text/plain', 'not found');
      }
      const source = fs.readFileSync(file, 'utf-8');
      const code = file.endsWith('.ts') ? stripTypeScriptTypes(source, { mode: 'strip' }) : source;
      return send(response, 200, MIME['.js']!, code);
    }

    const asset = routes.files.get(url);
    if (asset && fs.existsSync(asset)) {
      return sendFile(response, asset, MIME[path.extname(asset).toLowerCase()] ?? 'application/octet-stream');
    }

    return send(response, 404, 'text/plain', 'not found');
  });

  const port = await listen(server, options.port ?? DEFAULT_PORT);
  return {
    url: `http://127.0.0.1:${port}/`,
    port,
    async close() {
      for (const listener of listeners) {
        listener.end();
      }
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
    update(next) {
      routes = assetRoutes(next.assets, options.assetDirs);
      served = withServedAssets(next.project, routes.rewrites);
      projectJson = JSON.stringify(served);
      for (const listener of listeners) {
        listener.write('data: reload\n\n');
      }
    },
  };
}

function send(response: http.ServerResponse, status: number, type: string, body: string): void {
  response.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  response.end(body);
}

function sendFile(response: http.ServerResponse, file: string, type: string): void {
  const stat = fs.statSync(file);
  response.writeHead(200, {
    'content-type': type,
    'content-length': stat.size,
    'cache-control': 'no-cache',
  });
  fs.createReadStream(file).pipe(response);
}

/** Keeps the same port between runs when it is free, so bookmarks survive. */
function listen(server: http.Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        server.removeListener('error', onError);
        server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
        return;
      }
      reject(error);
    };
    server.once('error', onError);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', onError);
      resolve((server.address() as AddressInfo).port);
    });
  });
}
