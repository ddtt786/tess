/**
 * Tess 주석을 엔트리 블록 주석으로 변환하는 모듈입니다.
 * 
 * 원본 소스에서 주석의 위치를 찾아내어 소스 위치(loc)를 기준으로 
 * "바로 아래 문장" 또는 "같은 줄 문장" 에 해당하는 AST 노드와 연결합니다.
 */

import type { Node } from '@tess/parser';
import type { EntryComment } from './types.ts';

/**
 * 소스 코드에서 발견된 단일 주석과 그 위치 정보를 나타냅니다.
 *
 * @example
 * ```typescript
 * const comment: ScannedComment = {
 *   start: 10,
 *   end: 25,
 *   text: "이것은 주석입니다"
 * };
 * ```
 */
interface ScannedComment {
  start: number;
  end: number;
  text: string;
}

/**
 * AST 순회 중 접근할 수 있는 일반적인 노드 타입입니다.
 * 
 * @example
 * ```typescript
 * const node: AnyNode = {
 *   type: 'If',
 *   loc: { file: 'main.tess', start: 100 }
 * };
 * ```
 */
type AnyNode = Record<string, unknown> & { type?: string; loc?: { file?: string; start: number } };

/**
 * 주석을 첨부할 수 있는 AST 노드 타입의 집합입니다.
 * 주로 엔트리 블록으로 변환되는 노드들이 포함됩니다.
 * 
 * @example
 * ```typescript
 * if (ATTACHABLE.has(node.type)) {
 *   // 주석 첨부 가능
 * }
 * ```
 */
const ATTACHABLE = new Set([
  'Event',
  'If', 'Repeat', 'While', 'Until', 'Forever', 'Wait', 'Break', 'Continue', 'Skip', 'Restart', 'Return',
  'Stop', 'StopSound', 'StopBgm', 'StopDraw', 'StopFill', 'StopTimer',
  'StartDraw', 'StartFill', 'StartTimer', 'ResetSize', 'ResetTimer', 'Clear',
  'Send', 'Clone', 'DeleteClone', 'DeleteClones', 'Jump',
  'Forward', 'Bounce', 'Move', 'Go', 'Turn', 'Steer', 'Look',
  'Show', 'Hide', 'CostumeStep', 'Say', 'Think', 'Flip', 'Order',
  'TextWrite', 'Stamp', 'PlaySound', 'PlayBgm',
  'ListAdd', 'ListInsert', 'ListRemove', 'Ask',
  'VarDecl', 'ListDecl', 'Assign', 'ExpressionStatement',
]);

/**
 * 엔트리 블록에 붙일 주석 객체를 생성합니다.
 *
 * @param value - 주석 내용
 * @returns 엔트리 블록 주석 객체
 * 
 * @example
 * ```typescript
 * const comment = makeComment("반복문 시작");
 * ```
 */
export function makeComment(value: string): EntryComment {
  return {
    x: 240,
    y: -10,
    width: 160,
    height: 100,
    value,
    readOnly: false,
    visible: true,
    display: true,
    movable: true,
    isOpened: true,
    deletable: 1,
    type: 'comment',
  };
}

/**
 * 소스 코드에서 주석을 찾아냅니다. 
 * 문자열 내부의 `#` 기호나 색상 리터럴은 주석으로 처리하지 않습니다.
 *
 * @param source - 분석할 소스 코드 문자열
 * @returns 추출된 주석들의 배열
 * 
 * @example
 * ```typescript
 * const comments = scanComments("a = 10 # 변수 선언");
 * ```
 */
export function scanComments(source: string): ScannedComment[] {
  const comments: ScannedComment[] = [];
  const isHex = (ch: string | undefined) => ch !== undefined && /[0-9a-fA-F]/.test(ch);
  const isWord = (ch: string | undefined) => ch !== undefined && /[0-9a-zA-Z_]/.test(ch);

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];

    if (ch === '"') {
      i += 1;
      while (i < source.length && source[i] !== '"') {
        if (source[i] === '\\') i += 1;
        i += 1;
      }
      continue;
    }

    if (ch !== '#') continue;

    // #rrggbb 는 색상 리터럴이지 주석이 아니다
    const body = source.slice(i + 1, i + 7);
    if (body.length === 6 && [...body].every(isHex) && !isWord(source[i + 7])) {
      i += 6;
      continue;
    }

    let end = i;
    while (end < source.length && source[end] !== '\n' && source[end] !== '\r') end += 1;
    comments.push({ start: i, end, text: source.slice(i + 1, end).trim() });
    i = end;
  }
  return comments;
}

/**
 * AST 의 노드와 주석을 이어 준다.
 *
 * @param ast     use 까지 펼친 Program
 * @param sources 파일 -> 소스
 * @returns `파일 시작오프셋` -> 주석 내용
 */
export function buildCommentMap(ast: Node, sources: Map<string, string>): Map<string, string> {
  const nodesByFile = new Map<string, AnyNode[]>();
  collectNodes(ast, nodesByFile);

  const map = new Map<string, string>();
  for (const [file, nodes] of nodesByFile) {
    const source = sources.get(file);
    if (!source) continue;
    attachInFile(source, file, nodes, map);
  }
  return map;
}

/** 주석 찾아보기 열쇠 */
export function commentKey(node: Node | AnyNode | null | undefined): string {
  const loc = (node as AnyNode | null | undefined)?.loc;
  return `${loc?.file ?? ''} ${loc?.start ?? -1}`;
}

function collectNodes(node: unknown, out: Map<string, AnyNode[]>) {
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach((child) => collectNodes(child, out));
    return;
  }
  const item = node as AnyNode;
  const file = item.loc?.file;
  if (item.type !== undefined && ATTACHABLE.has(item.type) && file) {
    if (!out.has(file)) out.set(file, []);
    out.get(file)!.push(item);
  }
  for (const [key, value] of Object.entries(item)) {
    if (key !== 'loc') collectNodes(value, out);
  }
}

function attachInFile(source: string, file: string, nodes: AnyNode[], map: Map<string, string>) {
  const comments = scanComments(source);
  if (comments.length === 0) return;

  const lineOf = makeLineFinder(source);
  const sorted = [...nodes].sort((a, b) => a.loc!.start - b.loc!.start);
  const remaining: ScannedComment[] = [];

  // 1) 같은 줄 뒤쪽에 붙은 주석: 그 줄의 문장에 붙인다
  for (const comment of comments) {
    const line = lineOf(comment.start);
    const owner = lastWhere(
      sorted,
      (node) => node.loc!.start < comment.start && lineOf(node.loc!.start) === line,
    );
    if (owner) append(map, commentKey(owner), comment.text);
    else remaining.push(comment);
  }

  // 2) 문장 바로 위에 있는 주석 묶음: 아래 문장에 붙인다
  for (let i = 0; i < remaining.length; i += 1) {
    const group = [remaining[i]!];
    while (
      i + 1 < remaining.length
      && onlySpaceBetween(source, group[group.length - 1]!.end, remaining[i + 1]!.start)
    ) {
      group.push(remaining[i + 1]!);
      i += 1;
    }
    const last = group[group.length - 1]!;
    const owner = sorted.find((node) => node.loc!.start > last.end);
    if (owner && onlySpaceBetween(source, last.end, owner.loc!.start)) {
      append(map, commentKey(owner), group.map((comment) => comment.text).join('\n'));
    }
  }
}

function append(map: Map<string, string>, key: string, text: string) {
  map.set(key, map.has(key) ? `${map.get(key)}\n${text}` : text);
}

function lastWhere<T>(list: T[], predicate: (item: T) => boolean): T | null {
  for (let i = list.length - 1; i >= 0; i -= 1) if (predicate(list[i]!)) return list[i]!;
  return null;
}

function onlySpaceBetween(source: string, from: number, to: number) {
  return to >= from && /^\s*$/.test(source.slice(from, to));
}

function makeLineFinder(source: string) {
  const starts = [0];
  for (let i = 0; i < source.length; i += 1) if (source[i] === '\n') starts.push(i + 1);
  return (offset: number) => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (starts[mid]! <= offset) low = mid;
      else high = mid - 1;
    }
    return low + 1;
  };
}
