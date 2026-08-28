// Tess comments -> Entry comments.
//
// The grammar treats comments as whitespace, so they never reach the AST.
// This module rescans the raw source for comment positions and, using
// node source locations (loc), attaches each comment to the statement
// directly below it or on the same line.
//
// Entry stores a comment as a block's comment field:
//   { x, y, width, height, value, readOnly, visible, display,
//     movable, isOpened, deletable, type: 'comment' }

/** Node types a comment can attach to (ones that become blocks). */
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

/** Builds one Entry comment object. */
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
 * Scans the source for comments, skipping `#` inside strings and color
 * literals (#ff0000) — matching the grammar's comment rule.
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

    // #rrggbb is a color literal, not a comment
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
 * Links AST nodes to their comments.
 *
 * @param {object} ast     Program with `use` already expanded
 * @param {Map<string,string>} sources  file -> source text
 * @returns {Map<string,string>} `file startOffset` -> comment text
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

/** Lookup key for a node's comment. */
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

  // 1) trailing same-line comments attach to that line's statement
  for (const comment of comments) {
    const line = lineOf(comment.start);
    const owner = lastWhere(
      sorted,
      (node) => node.loc.start < comment.start && lineOf(node.loc.start) === line,
    );
    if (owner) append(map, commentKey(owner), comment.text);
    else remaining.push(comment);
  }

  // 2) a comment block directly above attaches to the statement below it
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
