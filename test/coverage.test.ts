// 엔트리 블록 팔레트를 실제로 읽어서, Tess 가 지원해야 할 카테고리의 블록이
// 하나도 빠지지 않았는지 확인한다.
//
// 지원 목록을 손으로 적어 두면 엔트리가 블록을 늘렸을 때 조용히 뒤처진다. 그래서
// 목록을 적는 대신 설치된 entryjs 의 EntryStatic.getAllBlocks() 를 그대로 읽는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATIC_FILE = path.join(root, 'node_modules/@entrylabs/entry/extern/util/static.js');

// 팔레트에는 블록이 아닌 것도 섞여 있다 — 블록 목록 아래의 "만들기" 버튼과,
// 확장·인공지능 묶음을 나누는 제목 줄이다. 둘 다 코드로 옮길 대상이 아니다.
const NOT_A_BLOCK = /AddButton$|Button$|_title$|^learning_title/;

// 작품에는 들어갈 수 없는 블록들. 'checker' 는 엔트리 학습(강의) 편집기에서만
// 꺼내 쓰는 채점용 블록이고, 'functionEdit' 전용 블록은 함수 편집 화면의 머리말
// 자체다 (컴파일러가 function_field_label 로 직접 만든다).
const EDITOR_ONLY_CLASSES = new Set(['checker']);
const EDITOR_ONLY_TARGETS = new Set(['functionEdit']);

const BLOCK_DIR = path.join(root, 'node_modules/@entrylabs/entry/src/playground/blocks');

/** 블록 타입 -> 그 정의에 적힌 class 와 isNotFor */
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

/** 작품 안에 나올 수 없는 블록인가 */
function editorOnly(type: string) {
  const trait = traits.get(type);
  if (!trait) return false;
  return EDITOR_ONLY_CLASSES.has(trait.blockClass)
    || trait.notFor.some((target: any) => EDITOR_ONLY_TARGETS.has(target));
}

/** 설치된 entryjs 가 쓰는 실제 블록 팔레트 */
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

/** packages/ 아래 소스에 적힌 글자 전부 — 블록 타입이 어딘가에 나오는지 볼 용도다 */
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

// 사진에 있는 카테고리(시작 · 흐름 · 움직임 · 생김새 · 붓 · 소리 · 판단 · 계산 ·
// 자료 · 함수)와 글상자 · 테이블 · 확장까지.
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
