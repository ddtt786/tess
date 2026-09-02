/**
 * `run` 명령어가 리소스를 제공할 주소를 결정합니다.
 *
 * 엔트리 실행기는 내부적으로 리소스를 특정 해시 기반 경로(`temp/...`)에 두지만,
 * `run` 모드에서는 브라우저에서 확인할 수 있도록 직관적인 경로(`/assets/...`)를 함께 제공합니다.
 * 원본 경로와 직관적인 경로 모두로 파일을 제공하며, `project.json`의 URL이 직관적인 경로를 가리키도록 수정합니다.
 * 경로 충돌이나 외부 파일 등 주소를 변환할 수 없는 경우에는 원래 주소를 유지합니다.
 */
import path from 'node:path';
import type { AssetFile, EntryProject } from '@tess/compiler';

/** 
 * 각 리소스가 제공되는 경로 및 `project.json`이 가리켜야 할 URL 정보를 담고 있습니다. 
 *
 * @example
 * ```typescript
 * const routes: AssetRoutes = {
 *   files: new Map([['/assets/image.png', '/path/to/image.png']]),
 *   rewrites: new Map([['temp/12/34/image/1234.png', '/assets/image.png']])
 * };
 * ```
 */
export interface AssetRoutes {
  /** 
   * 서비스되는 URL과 디스크의 실제 파일 경로를 매핑합니다.
   *
   * @example
   * ```typescript
   * files.get('/assets/image.png'); // '/path/to/image.png'
   * ```
   */
  files: Map<string, string>;
  /** 
   * 엔트리의 기존 파일 URL을 새롭게 가리켜야 할 URL로 매핑합니다.
   *
   * @example
   * ```typescript
   * rewrites.get('temp/12/34/image/1234.png'); // '/assets/image.png'
   * ```
   */
  rewrites: Map<string, string>;
}

/** 
 * 서버가 내부적으로 사용하여 리소스 이름으로 쓸 수 없는 예약된 주소 목록입니다.
 *
 * @example
 * ```typescript
 * if (RESERVED.has('/index.html')) { return; }
 * ```
 */
const RESERVED = new Set([
  '/', '/index.html', '/project.json', '/sourcemap.json', '/debug-ui.js',
  '/__reload', '/__log',
]);

/** 
 * 서버가 내부적으로 사용하는 예약된 경로 접두사 목록입니다.
 *
 * @example
 * ```typescript
 * if (RESERVED_PREFIXES.some(prefix => url.startsWith(prefix))) { return; }
 * ```
 */
const RESERVED_PREFIXES = ['/lib/', '/arrow/', '/temp/', '/api/'];

/** 
 * 리소스 폴더를 기준으로 한 상대 경로를 반환합니다. 폴더 외부에 있는 경우 `null`을 반환합니다.
 *
 * @param source 원본 파일 경로
 * @param assetDirs 리소스 폴더 경로 목록
 * @returns 상대 경로 문자열 또는 `null`
 *
 * @example
 * ```typescript
 * const url = publicPath('/dir/file.png', ['/dir']); // '/file.png'
 * ```
 */
function publicPath(source: string, assetDirs: string[]): string | null {
  for (const dir of assetDirs) {
    const relative = path.relative(dir, source);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) continue;
    return `/${relative.split(path.sep).join('/')}`;
  }
  return null;
}

/**
 * 주어진 주소가 예약되어 있거나 이미 사용 중인지 확인합니다.
 *
 * @param url 확인할 주소
 * @param taken 이미 사용 중인 주소 목록
 * @returns 예약되었거나 사용 중이면 `true`
 *
 * @example
 * ```typescript
 * const isTaken = isReserved('/project.json', new Set()); // true
 * ```
 */
const isReserved = (url: string, taken: Set<string>) => RESERVED.has(url)
  || taken.has(url)
  || RESERVED_PREFIXES.some((prefix) => url.startsWith(prefix));

/**
 * 리소스가 제공될 경로 및 재작성 규칙을 생성합니다.
 *
 * @param assets 처리할 리소스 파일 목록
 * @param assetDirs 리소스를 검색한 폴더 목록
 * @param taken 서버가 이미 사용 중인 주소 목록
 * @returns 생성된 라우팅 정보 객체
 *
 * @example
 * ```typescript
 * const routes = assetRoutes(assets, ['/assets'], ['/custom.ent']);
 * ```
 */
export function assetRoutes(
  assets: AssetFile[],
  assetDirs: string[] = [],
  taken: string[] = [],
): AssetRoutes {
  const reserved = new Set(taken);
  const files = new Map<string, string>();
  for (const { source, target } of assets) files.set(`/${target}`, source);

  // 두 폴더가 같은 이름을 주장하면 어느 쪽도 그 주소를 쓰지 않는다.
  const claims = new Map<string, Set<string>>();
  for (const { source } of assets) {
    const url = publicPath(source, assetDirs);
    if (!url || isReserved(url, reserved)) continue;
    if (!claims.has(url)) claims.set(url, new Set());
    claims.get(url)!.add(source);
  }

  const rewrites = new Map<string, string>();
  for (const { source, target } of assets) {
    const url = publicPath(source, assetDirs);
    if (!url || claims.get(url)?.size !== 1) continue;
    files.set(url, source);
    rewrites.set(target, url);
  }
  return { files, rewrites };
}

/** 
 * 작품 사본을 생성하여 내부 파일 URL을 서버 제공 주소로 변경합니다. 원본 객체는 수정하지 않습니다.
 *
 * @param project 원본 작품 객체
 * @param rewrites 경로 재작성 규칙 맵
 * @returns 파일 URL이 수정된 새로운 작품 객체
 *
 * @example
 * ```typescript
 * const newProject = withServedAssets(project, rewrites);
 * ```
 */
export function withServedAssets(project: EntryProject, rewrites: Map<string, string>): EntryProject {
  if (rewrites.size === 0) return project;
  return rewriteUrls(project, rewrites) as EntryProject;
}

/**
 * 객체 내의 모든 파일 URL을 순회하며 재작성 규칙에 따라 변환합니다.
 *
 * @param value 변환할 객체 또는 배열
 * @param rewrites 경로 재작성 규칙 맵
 * @returns 변환된 새로운 객체 또는 배열
 *
 * @example
 * ```typescript
 * const rewritten = rewriteUrls({ fileurl: 'old.png' }, new Map([['old.png', 'new.png']]));
 * ```
 */
function rewriteUrls(value: unknown, rewrites: Map<string, string>): unknown {
  if (Array.isArray(value)) return value.map((item) => rewriteUrls(item, rewrites));
  if (!value || typeof value !== 'object') return value;

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = key === 'fileurl' && typeof item === 'string' && rewrites.has(item)
      ? rewrites.get(item)
      : rewriteUrls(item, rewrites);
  }
  return out;
}
