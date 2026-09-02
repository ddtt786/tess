/**
 * 엔트리 블록 팔레트를 분석하여 지원해야 할 카테고리의 블록 누락 여부를 확인합니다.
 * 
 * 엔트리가 새로운 블록을 추가할 때 누락되는 것을 방지하기 위해, 수동 작성된 목록 대신
 * 설치된 entryjs의 EntryStatic.getAllBlocks()를 동적으로 읽어옵니다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATIC_FILE = path.join(root, 'node_modules/@entrylabs/entry/extern/util/static.js');

/**
 * 팔레트 내에서 실제 블록이 아닌 항목(예: '만들기' 버튼, 확장/인공지능 묶음 제목)을 
 * 필터링하기 위한 정규표현식입니다.
 */
const NOT_A_BLOCK = /AddButton$|Button$|_title$|^learning_title/;

/**
 * 일반적인 작품 제작에 사용되지 않는 에디터 전용 블록들을 정의합니다.
 * - 'checker': 학습(강의) 편집기 전용 채점용 블록
 * - 'functionEdit': 함수 편집 화면의 머리말 전용 블록 (컴파일러가 자동 생성)
 */
const EDITOR_ONLY_CLASSES = new Set(['checker']);
const EDITOR_ONLY_TARGETS = new Set(['functionEdit']);

const BLOCK_DIR = path.join(root, 'node_modules/@entrylabs/entry/src/playground/blocks');

/**
 * 파일 시스템에서 블록 정의를 읽어들여, 블록 타입에 따른 class와 isNotFor 속성을 추출합니다.
 */
function loadBlockTraits() {
  const traits = new Map();
  const files = fs.readdirSync(BLOCK_DIR).filter((f) => f.endsWith('.js'));
  for (const file of files) {
    const text = fs.readFileSync(path.join(BLOCK_DIR, file), 'utf8');
    for (const match of text.matchAll(/^ +([A-Za-z_][A-Za-z0-9_]*): \{$/gm)) {
      const body = text.slice(match.index, match.index + 4000);
      traits.set(match[1], {
        blockClass: /^ +class: '([^']*)'/m.exec(body)?.[1] ?? '',
        notFor: [...(/^ +isNotFor: \[([^\]]*)\]/m.exec(body)?.[1] ?? '').matchAll(/'([^']*)'/g)]
          .map((m) => m[1]),
      });
    }
  }
  return traits;
}

const traits = loadBlockTraits();

/**
 * 주어진 블록 타입이 에디터 전용 블록(작품에 사용 불가)인지 확인합니다.
 * 
 * @param type 검사할 블록 타입
 * @returns 에디터 전용 블록이면 true, 그렇지 않으면 false
 */
function editorOnly(type: string) {
  const trait = traits.get(type);
  if (!trait) return false;
  return EDITOR_ONLY_CLASSES.has(trait.blockClass)
    || trait.notFor.some((target: any) => EDITOR_ONLY_TARGETS.has(target));
}

/**
 * 설치된 entryjs 환경 내에서 실제 사용되는 블록 팔레트 목록을 동적으로 로드합니다.
 */
function loadPalette(): Array<{ category: string; blocks?: string[] }> {
  // The palette script runs in its own realm, so the sandbox is shaped by what
  // that script reaches for rather than by anything declared here.
  const sandbox: Record<string, any> = {
    console,
    Lang: new Proxy({}, { get: () => new Proxy({}, { get: () => '' }) }),
  };
  sandbox.window = sandbox;
  sandbox.global = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(STATIC_FILE, 'utf8'), sandbox);
  return sandbox.EntryStatic.getAllBlocks();
}

/**
 * packages/ 디렉토리 내의 모든 소스 코드를 하나의 문자열로 결합하여 반환합니다.
 * 주로 특정 블록 타입이 소스 코드 내에서 지원/구현되었는지 텍스트 매칭으로 확인할 때 사용됩니다.
 */
function toolSource(dir = path.join(root, 'packages'), text = { value: '' }): string {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) toolSource(full, text);
    else if (entry.name.endsWith('.ts')) text.value += fs.readFileSync(full, 'utf8');
  }
  return text.value;
}

const source = toolSource();
const mentions = (type: string) => new RegExp(`["'\`]${type}["'\`]|^ {2}${type}: \\{`, 'm').test(source);

/**
 * 검증해야 할 엔트리의 필수 카테고리 목록입니다.
 * 시작, 흐름, 움직임, 생김새, 붓, 글상자, 소리, 판단, 계산, 자료, 함수, 분석(테이블), 확장을 포함합니다.
 */
const REQUIRED = [
  'start', 'flow', 'moving', 'looks', 'brush', 'text', 'sound',
  'judgement', 'calc', 'variable', 'func', 'analysis', 'expansion',
];

const palette = new Map(loadPalette().map(({ category, blocks }) => [category, blocks ?? []]));

for (const category of REQUIRED) {
  test(`엔트리 '${category}' 카테고리의 블록을 전부 지원한다`, () => {
    const blocks = palette.get(category);
    assert.ok(blocks?.length, `엔트리 팔레트에 '${category}' 카테고리가 없습니다.`);
    // 팔레트는 다른 realm 에서 만든 배열이라 deepEqual 이 프로토타입부터 다르게 본다
    const missing = [...blocks]
      .filter((type) => !NOT_A_BLOCK.test(type) && !editorOnly(type) && !mentions(type));
    assert.equal(missing.join(', '), '', `옮기지 못하는 블록: ${missing.join(', ')}`);
  });
}
