// Resolves `use "file"`.
//
// Per spec 3.3, use inlines the target file's whole contents at that
// position: after parsing, each Use node is replaced with the loaded
// file's AST. The parse start rule depends on where the Use sits:
//   top level  -> Program
//   in scene   -> SceneFragment
//   in object  -> ObjectFragment
import fs from 'node:fs';
import path from 'node:path';
import { parse } from '../parse.js';

const START_RULES = { top: undefined, scene: 'SceneFragment', object: 'ObjectFragment' };

/**
 * @param {{source: string, path?: string, readFile?: Function}} entry
 * @returns {{ast: object|null, errors: Array, warnings: Array, sources: Map}}
 */
export function loadProgram({ source, path: filePath = '<input>', readFile = defaultReadFile }) {
  const errors = [];
  const warnings = [];
  const sources = new Map([[filePath, source]]);
  const visiting = new Set();

  const load = (text, file, context) => {
    const result = parse(text, { startRule: START_RULES[context], validate: false });
    if (!result.ok) {
      for (const error of result.errors) errors.push({ ...error, file });
      return null;
    }
    stampSource(result.ast, file);
    return result.ast;
  };

  const expand = (items, file, context) => {
    const output = [];
    for (const item of items) {
      if (item.type === 'UseObject') {
        const wrapped = expandUseObject(item, file);
        if (wrapped) output.push(wrapped);
        continue;
      }
      if (item.type !== 'Use') {
        output.push(expandNested(item, file));
        continue;
      }
      const target = path.resolve(path.dirname(file), item.path);
      if (visiting.has(target)) {
        errors.push({ ...position(item), file, message: `use 가 순환합니다: ${item.path}` });
        continue;
      }
      let text;
      try {
        text = readFile(target);
      } catch {
        errors.push({ ...position(item), file, message: `불러올 파일이 없습니다: ${item.path}` });
        continue;
      }
      sources.set(target, text);
      visiting.add(target);
      const included = load(text, target, context);
      if (included) {
        const body = context === 'top' ? included.body : included;
        output.push(...expand(body, target, context));
      }
      visiting.delete(target);
    }
    return output;
  };

  // useobject / usetext: wraps the loaded fragment in an object named after the file.
  const expandUseObject = (item, file) => {
    const target = path.resolve(path.dirname(file), item.path);
    if (visiting.has(target)) {
      errors.push({ ...position(item), file, message: `use 가 순환합니다: ${item.path}` });
      return null;
    }
    let text;
    try {
      text = readFile(target);
    } catch {
      errors.push({ ...position(item), file, message: `불러올 파일이 없습니다: ${item.path}` });
      return null;
    }
    sources.set(target, text);
    visiting.add(target);
    const members = load(text, target, 'object');
    visiting.delete(target);
    if (!members) return null;

    return {
      type: 'Object',
      kind: item.kind,
      name: path.basename(target, path.extname(target)),
      body: expand(members, target, 'object'),
      loc: item.loc,
    };
  };

  const expandNested = (item, file) => {
    if (item.type === 'Scene') return { ...item, body: expand(item.body, file, 'scene') };
    if (item.type === 'Object') return { ...item, body: expand(item.body, file, 'object') };
    return item;
  };

  const program = load(source, filePath, 'top');
  if (!program) return { ast: null, errors, warnings, sources };

  visiting.add(path.resolve(filePath));
  return { ast: { ...program, body: expand(program.body, filePath, 'top') }, errors, warnings, sources };
}

function defaultReadFile(target) {
  return fs.readFileSync(target, 'utf-8');
}

function position(node) {
  return { line: node?.loc?.line ?? 0, column: 0, offset: node?.loc?.start ?? 0 };
}

/** Stamps each node with its source file, for error-location reporting. */
function stampSource(node, file) {
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach((child) => stampSource(child, file));
    return;
  }
  if (node.loc && !node.loc.file) node.loc.file = file;
  for (const [key, value] of Object.entries(node)) {
    if (key !== 'loc') stampSource(value, file);
  }
}
