/**
 * examples 디렉터리 내의 .tess 파일을 검사합니다.
 * - use 또는 useobject를 통해 포함되는 조각 파일은 문법적 유효성만 확인합니다.
 *   (단독으로 존재할 경우 다른 파일의 전역 변수 및 함수를 참조할 수 없으며, object 블록 내에 존재하지 않기 때문입니다.)
 * - 진입점 역할을 하는 나머지 파일은 오류나 경고가 발생하지 않아야 합니다.
 * 
 * @example
 * // 조각 파일 검사 시에는 문법만 검증합니다.
 * // 진입점 파일은 전체 프로젝트 컴파일을 통해 무결성을 검증합니다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@tess/parser';
import { compileProject } from '@tess/compiler';
import type { StartRule } from '@tess/parser';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'examples');
const FRAGMENT_RULES: Array<StartRule | undefined> = [undefined, 'SceneFragment', 'ObjectFragment'];

function tessFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return tessFiles(full);
    return entry.name.endsWith('.tess') ? [full] : [];
  });
}

/**
 * AST 내의 use 및 useobject 선언 경로를 추출하여 절대 경로 집합으로 반환합니다.
 *
 * @example
 * // node가 Use({ path: 'a.tess' }) 일 경우, base 경로를 기준으로 절대 경로를 생성하여 반환합니다.
 */
function usedFiles(node: any, base: string, found = new Set<string>()): Set<string> {
  if (node === null || typeof node !== 'object') return found;
  if (Array.isArray(node)) {
    node.forEach((child) => usedFiles(child, base, found));
    return found;
  }
  if (node.type === 'Use' || node.type === 'UseObject') {
    found.add(path.resolve(path.dirname(base), node.path));
  }
  for (const [key, value] of Object.entries(node)) {
    if (key !== 'loc') usedFiles(value, base, found);
  }
  return found;
}

const files = tessFiles(root);
const fragments = new Set<string>();
for (const file of files) {
  const result = parse(fs.readFileSync(file, 'utf-8'));
  if (result.ast) usedFiles(result.ast, file, fragments);
}

test('예제 파일이 있다', () => {
  assert.ok(files.length > 0);
});

const show = (list: any) => list.map((d: any) => `${d.line}:${d.column} ${d.message}`).join('\n');

for (const file of files) {
  const label = path.relative(root, file);
  const source = fs.readFileSync(file, 'utf-8');

  if (fragments.has(file)) {
    test(`예제(조각): ${label}`, () => {
      /**
       * 조각 파일은 포함되는 위치에 따라 적용되는 시작 규칙이 달라지므로,
       * 가능한 규칙 중 하나라도 만족하면 유효한 것으로 간주합니다.
       * 
       * @example
       * // SceneFragment 또는 ObjectFragment 규칙 중 하나로 파싱에 성공하면 통과합니다.
       */
      const ok = FRAGMENT_RULES.some((startRule) => parse(source, { startRule, validate: false }).ok);
      assert.ok(ok, `${label} 을(를) 어떤 자리의 조각으로도 읽을 수 없습니다.`);
    });
    continue;
  }

  /**
   * 조각 파일을 포함하는 진입점 파일은 모든 조각이 로드된 후에만 의미를 가집니다.
   * 진입점 단독으로는 함수가 참조하는 지역 변수를 소유한 객체를 식별할 수 없으므로,
   * 단순 파싱 대신 전체 컴파일을 수행합니다. 이를 위해 조각 파일들이 실제로 디스크에 존재해야 합니다.
   * 문법만을 보여주기 위한 예제 파일은 파싱만 진행합니다.
   *
   * @example
   * // 조각 파일이 디스크에 있는 경우 컴파일(compileProject)을 수행하고,
   * // 그렇지 않은 구문 예제 파일은 파싱(parse)만 수행합니다.
   */
  const parsed = parse(source, { validate: false });
  const included = parsed.ast ? [...usedFiles(parsed.ast, file)] : [];
  const buildable = included.length > 0 && included.every((used) => fs.existsSync(used));

  test(`예제: ${label}`, () => {
    if (buildable) {
      const result = compileProject(source, { path: file });
      const errors = result.errors.map((e) => ({ ...e, message: `${e.file ?? label} ${e.message}` }));
      assert.deepEqual(errors, [], `\n${show(errors)}`);
      return;
    }
    const result = parse(source);
    assert.deepEqual(result.errors, [], `\n${show(result.errors)}`);
    assert.deepEqual(result.warnings, [], `\n${show(result.warnings)}`);
  });
}
