// ============================================================================
//  `run` 이 리소스를 내보내는 주소 정하기
//
//  엔트리는 리소스를 temp/<앞2자>/<다음2자>/image|sound/<32자>.png 에 두고
//  project.json 의 fileurl 이 그 주소를 가리킨다. `build` 는 이 규칙을 그대로
//  지켜야 하지만, `run` 은 브라우저에서 들여다보는 용도라 주소가 읽히는 편이 낫다.
//
//  그래서 같은 파일을 두 주소로 내보낸다.
//    /temp/2f/68/image/2f68258c….png   엔트리가 쓰는 주소 (그대로 둔다)
//    /assets/image/주인공.png            디스크에 있는 그대로의 주소
//
//  그리고 project.json 의 fileurl 만 뒤쪽을 가리키게 바꾼다. 깨끗한 주소를 만들
//  수 없는 파일(리소스 폴더 밖에 있거나, 두 폴더가 같은 이름을 주장하거나,
//  서버가 이미 쓰는 주소와 겹치는 경우)은 엔트리의 원래 주소를 그대로 쓴다.
// ============================================================================
import path from 'node:path';

/** 서버가 직접 답하는 주소 — 리소스가 가져가면 안 된다 */
const RESERVED = new Set([
  '/', '/index.html', '/project.json', '/sourcemap.json', '/debug-ui.js',
  '/__reload', '/__log',
]);

const RESERVED_PREFIXES = ['/lib/', '/arrow/', '/temp/', '/api/'];

/** 리소스 폴더 기준의 상대 경로. 폴더 밖이면 null */
function publicPath(source, assetDirs) {
  for (const dir of assetDirs) {
    const relative = path.relative(dir, source);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) continue;
    return `/${relative.split(path.sep).join('/')}`;
  }
  return null;
}

const isReserved = (url, taken) => RESERVED.has(url)
  || taken.has(url)
  || RESERVED_PREFIXES.some((prefix) => url.startsWith(prefix));

/**
 * @param {Array<{source: string, target: string}>} assets
 * @param {string[]} assetDirs 리소스를 찾은 폴더들
 * @param {string[]} taken 서버가 이미 쓰고 있는 주소 (작품 파일 이름 등)
 * @returns {{files: Map<string, string>, rewrites: Map<string, string>}}
 *   files    주소 -> 실제 파일
 *   rewrites 엔트리 fileurl -> project.json 이 대신 가리킬 주소
 */
export function assetRoutes(assets, assetDirs = [], taken = []) {
  const reserved = new Set(taken);
  const files = new Map();
  for (const { source, target } of assets) files.set(`/${target}`, source);

  // 두 폴더가 같은 이름을 주장하면 어느 쪽도 그 주소를 쓰지 않는다.
  const claims = new Map();
  for (const { source } of assets) {
    const url = publicPath(source, assetDirs);
    if (!url || isReserved(url, reserved)) continue;
    if (!claims.has(url)) claims.set(url, new Set());
    claims.get(url).add(source);
  }

  const rewrites = new Map();
  for (const { source, target } of assets) {
    const url = publicPath(source, assetDirs);
    if (!url || claims.get(url)?.size !== 1) continue;
    files.set(url, source);
    rewrites.set(target, url);
  }
  return { files, rewrites };
}

/** fileurl 을 서빙 주소로 바꾼 작품 사본을 만든다. 원본은 건드리지 않는다. */
export function withServedAssets(project, rewrites) {
  if (rewrites.size === 0) return project;
  return rewriteUrls(project, rewrites);
}

function rewriteUrls(value, rewrites) {
  if (Array.isArray(value)) return value.map((item) => rewriteUrls(item, rewrites));
  if (!value || typeof value !== 'object') return value;

  const out = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = key === 'fileurl' && typeof item === 'string' && rewrites.has(item)
      ? rewrites.get(item)
      : rewriteUrls(item, rewrites);
  }
  return out;
}
