// ============================================================================
//  Tess 주석 -> 엔트리 주석
//
//  문법에서 주석은 공백으로 취급되어 AST 에 남지 않는다.
//  그래서 원본 소스를 따로 훑어 주석 위치를 모으고, 소스 위치(loc)를 기준으로
//  "바로 아래 문장" 또는 "같은 줄 문장" 에 붙인다.
//
//  엔트리는 주석을 블록의 comment 필드에 담는다.
//    { x, y, width, height, value, readOnly, visible, display,
//      movable, isOpened, deletable, type: 'comment' }
// ============================================================================

/** 주석이 붙을 수 있는 노드 (블록이 만들어지는 것들) */
const ATTACHABLE = new Set([
  'Event',
  'If', 'Repeat', 'While', 'Until', 'Forever', 'Wait', 'Break', 'Skip', 'Restart', 'Return',
  'Stop', 'StopSound', 'StopBgm', 'StopDraw', 'StopFill', 'StopTimer',
  'StartDraw', 'StartFill', 'StartTimer', 'ResetSize', 'ResetTimer', 'Clear',
  'Send', 'Clone', 'DeleteClone', 'DeleteClones', 'Jump',
  'Forward', 'Bounce', 'Move', 'Go', 'Turn', 'Steer', 'Look',
  'Show', 'Hide', 'CostumeStep', 'Say', 'Think', 'Flip', 'Order',
  'TextWrite', 'Stamp', 'PlaySound', 'PlayBgm',
  'ListAdd', 'ListInsert', 'ListRemove', 'Ask',
  'VarDecl', 'ListDecl', 'Assign', 'ExpressionStatement',
]);

/** 엔트리 주석 한 개 만들기 */
export function makeComment(value) {
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
 * 소스에서 주석을 찾는다. 문자열 안의 `#` 과 색상 리터럴(#ff0000)은 건너뛴다.
 * (문법의 comment 규칙과 같은 판단이다)
 */
export function scanComments(source) {
  const comments = [];
  const isHex = (ch) => ch !== undefined && /[0-9a-fA-F]/.test(ch);
  const isWord = (ch) => ch !== undefined && /[0-9a-zA-Z_]/.test(ch);

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
 * @param {object} ast     use 까지 펼친 Program
 * @param {Map<string,string>} sources  파일 -> 소스
 * @returns {Map<string,string>} `파일 시작오프셋` -> 주석 내용
 */
export function buildCommentMap(ast, sources) {
  const nodesByFile = new Map();
  collectNodes(ast, nodesByFile);

  const map = new Map();
  for (const [file, nodes] of nodesByFile) {
    const source = sources.get(file);
    if (!source) continue;
    attachInFile(source, file, nodes, map);
  }
  return map;
}

/** 주석 찾아보기 열쇠 */
export function commentKey(node) {
  return `${node?.loc?.file ?? ''} ${node?.loc?.start ?? -1}`;
}

function collectNodes(node, out) {
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach((child) => collectNodes(child, out));
    return;
  }
  if (ATTACHABLE.has(node.type) && node.loc?.file) {
    if (!out.has(node.loc.file)) out.set(node.loc.file, []);
    out.get(node.loc.file).push(node);
  }
  for (const [key, value] of Object.entries(node)) {
    if (key !== 'loc') collectNodes(value, out);
  }
}

function attachInFile(source, file, nodes, map) {
  const comments = scanComments(source);
  if (comments.length === 0) return;

  const lineOf = makeLineFinder(source);
  const sorted = [...nodes].sort((a, b) => a.loc.start - b.loc.start);
  const remaining = [];

  // 1) 같은 줄 뒤쪽에 붙은 주석: 그 줄의 문장에 붙인다
  for (const comment of comments) {
    const line = lineOf(comment.start);
    const owner = lastWhere(
      sorted,
      (node) => node.loc.start < comment.start && lineOf(node.loc.start) === line,
    );
    if (owner) append(map, commentKey(owner), comment.text);
    else remaining.push(comment);
  }

  // 2) 문장 바로 위에 있는 주석 묶음: 아래 문장에 붙인다
  for (let i = 0; i < remaining.length; i += 1) {
    const group = [remaining[i]];
    while (
      i + 1 < remaining.length
      && onlySpaceBetween(source, group[group.length - 1].end, remaining[i + 1].start)
    ) {
      group.push(remaining[i + 1]);
      i += 1;
    }
    const last = group[group.length - 1];
    const owner = sorted.find((node) => node.loc.start > last.end);
    if (owner && onlySpaceBetween(source, last.end, owner.loc.start)) {
      append(map, commentKey(owner), group.map((comment) => comment.text).join('\n'));
    }
  }
}

function append(map, key, text) {
  map.set(key, map.has(key) ? `${map.get(key)}\n${text}` : text);
}

function lastWhere(list, predicate) {
  for (let i = list.length - 1; i >= 0; i -= 1) if (predicate(list[i])) return list[i];
  return null;
}

function onlySpaceBetween(source, from, to) {
  return to >= from && /^\s*$/.test(source.slice(from, to));
}

function makeLineFinder(source) {
  const starts = [0];
  for (let i = 0; i < source.length; i += 1) if (source[i] === '\n') starts.push(i + 1);
  return (offset) => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (starts[mid] <= offset) low = mid;
      else high = mid - 1;
    }
    return low + 1;
  };
}
