/**
 * @fileoverview Writes the whole project as one Tess source file.
 *
 * Block workspaces are loaded headless, one object at a time, so every script
 * is written from the same generator the live editor uses.
 */
import { fontFamily } from '../model/fonts.ts';
import * as Blockly from 'blockly/core';
import { DEFINE_BLOCK } from '../blocks/functions.ts';
import { tess, workspaceScripts } from './generator.ts';
import { safeIdent, uniqueIdent } from './ident.ts';
import { num, quote } from './quote.ts';
import { resolveAsset } from '../model/assets.ts';
import { namesModel, useIdents } from './refs.ts';
import type { BlocklyState, FunctionDef, TessObject, TessProject, VariableDef } from '../model/types.ts';

export interface WriteOptions {
  /** Workspaces to read instead of the stored state, keyed by object id. */
  live?: Map<string, Blockly.Workspace>;
  /** The live workspaces were saved into their objects right before this write. */
  liveSaved?: boolean;
}

const INDENT = '  ';

/**
 * Code written from a saved workspace state, by state. Writing a script only
 * reads the state and the names blocks refer to, so the code is reused while
 * both are the same: a run then writes only the objects that changed.
 */
const written = new WeakMap<object, { context: string; value: unknown }>();

/** The names the current write resolves ids to, as one string. */
let context = '';

function namesContext(idents: Map<string, string>, objectKeys: Map<string, string>): string {
  const names = namesModel();
  const pairs = (list: Array<{ id: string; name: string }>) => list.map((each) => [each.id, each.name]);
  return JSON.stringify([
    [...idents],
    [...objectKeys],
    names.objects.map((object) => [object.id, object.name, pairs(object.costumes), pairs(object.sounds)]),
    pairs(names.signals),
    pairs(names.scenes),
    pairs(names.variables),
    pairs(names.tables),
    names.functions.map((definition) => [definition.id, definition.name, definition.params]),
  ]);
}

/** `read(state)`, or the value it gave for this state and these names before. */
function cached<T>(state: BlocklyState | null, read: () => T): T {
  if (!state || typeof state !== 'object') return read();
  const hit = written.get(state);
  if (hit && hit.context === context) return hit.value as T;
  const value = read();
  written.set(state, { context, value });
  return value;
}

export function buildSource(model: TessProject, options: WriteOptions = {}): string {
  const idents = nameTable(model);
  // Object keys are unique across the whole work, not just inside a scene, and
  // blocks naming an object must use the same key the object is declared with.
  const objectKeys = new Map<string, string>();
  const keys = new Set<string>();
  for (const scene of model.scenes) {
    for (const object of model.objects.filter((each) => each.sceneId === scene.id)) {
      objectKeys.set(object.id, uniqueKey(object.name, keys));
    }
  }
  useIdents(idents, objectKeys);
  context = namesContext(idents, objectKeys);

  const lines: string[] = [];
  lines.push('project:');
  lines.push(`${INDENT}title ${quote(model.name || '새 작품')}`);
  if (model.description) lines.push(`${INDENT}description ${quote(model.description)}`);
  lines.push(`${INDENT}fps ${num(model.fps || 60)}`);
  lines.push('end', '');

  for (const variable of model.variables.filter((candidate) => !candidate.owner)) {
    lines.push(variableLine(variable, idents));
  }
  for (const table of model.tables) {
    lines.push(...tableLines(table.name, idents.get(table.id) ?? safeIdent(table.name), table.columns, table.rows));
  }
  if (model.variables.some((variable) => !variable.owner) || model.tables.length) lines.push('');

  // A function whose object is gone is written as a global one rather than lost.
  const objectIds = new Set(model.objects.map((object) => object.id));
  for (const definition of model.functions.filter((each) => !each.inline && (!each.owner || !objectIds.has(each.owner)))) {
    lines.push(...functionLines(definition));
    lines.push('');
  }

  for (const scene of model.scenes) {
    lines.push(`scene ${quote(scene.name)}:`);
    const objects = model.objects.filter((object) => object.sceneId === scene.id);
    for (const object of objects) {
      lines.push(...indent(objectLines(object, model, idents, objectKeys.get(object.id) ?? object.name, options), 1));
      lines.push('');
    }
    if (!objects.length) lines.push(`${INDENT}# 오브젝트가 없습니다`);
    lines.push('end', '');
  }

  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

/** One identifier per record, kept apart even when names sanitise alike. */
function nameTable(model: TessProject): Map<string, string> {
  // A variable named like an object or a function would be read as that instead.
  const taken = new Set<string>([
    ...model.objects.map((object) => safeIdent(object.name)),
    ...model.functions.map((definition) => safeIdent(definition.name)),
  ]);
  const table = new Map<string, string>();
  for (const variable of model.variables) table.set(variable.id, uniqueIdent(variable.name, taken));
  for (const tableDef of model.tables) table.set(tableDef.id, uniqueIdent(tableDef.name, taken));
  return table;
}

function variableLine(variable: VariableDef, idents: Map<string, string>): string {
  const ident = idents.get(variable.id) ?? safeIdent(variable.name);
  const scope = variable.scope === 'local' ? '' : `${variable.scope} `;
  const display = ident === variable.name.trim() ? '' : ` as ${quote(variable.name)}`;
  const place = variable.at ? ` at ${num(variable.at.x)} ${num(variable.at.y)}` : '';
  if (variable.kind === 'list') {
    const items = variable.array.map((item) => literal(item)).join(', ');
    return `${scope}list ${ident}${display} = [${items}]${variable.visible ? ' visible' : ''}${place}`;
  }
  const slide = variable.slide ? ` from ${num(variable.slide.min)} to ${num(variable.slide.max)}` : '';
  return `${scope}var ${ident}${display} = ${literal(variable.value)}${slide}${variable.visible ? ' visible' : ''}${place}`;
}

function literal(value: string | number): string {
  if (typeof value === 'number') return num(value);
  const trimmed = value.trim();
  if (trimmed !== '' && Number.isFinite(Number(trimmed))) return num(Number(trimmed));
  return quote(value);
}

function tableLines(name: string, ident: string, columns: string[], rows: string[][]): string[] {
  const display = ident === name.trim() ? '' : ` as ${quote(name)}`;
  const lines = [`table ${ident}${display}:`];
  lines.push(`${INDENT}columns ${columns.map((column) => quote(column)).join(', ')}`);
  for (const row of rows) lines.push(`${INDENT}row ${row.map((cell) => literal(cell)).join(', ')}`);
  lines.push('end');
  return lines;
}

function functionLines(definition: FunctionDef): string[] {
  const params = definition.params
    .map((param) => `${safeIdent(param.name)}${param.kind === 'boolean' ? '?' : ''}`)
    .join(', ');
  const body = cached(definition.blocks, () => readWorkspace(definition.blocks, (workspace) => {
    const define = workspace.getTopBlocks(false).find((block) => block.type === DEFINE_BLOCK);
    return define ? tess.statementToCode(define, 'BODY') : '';
  }));
  const lines = [`function ${safeIdent(definition.name)}(${params}):`];
  if (body.trim()) lines.push(body.replace(/\n+$/, ''));
  lines.push('end');
  return lines;
}

function objectLines(
  object: TessObject,
  model: TessProject,
  idents: Map<string, string>,
  key: string,
  options: WriteOptions,
): string[] {
  const lines = [`${object.kind === 'text' ? 'text' : 'object'} ${quote(key)}:`];
  const body: string[] = [];
  if (key !== object.name) body.push(`name ${quote(object.name)}`);

  const costumeNames = new Set<string>();
  for (const costume of object.costumes) {
    const ident = uniqueIdent(costume.name, costumeNames);
    const isDefault = costume.id === object.selectedCostumeId;
    const display = ident === costume.name.trim() ? '' : ` as ${quote(costume.name)}`;
    body.push(
      `${isDefault ? 'default ' : ''}costume ${ident} ${quote(resolveAsset(costume.url))} `
      + `size ${num(costume.width)} ${num(costume.height)}${display}`,
    );
  }
  const soundNames = new Set<string>();
  for (const sound of object.sounds) {
    const ident = uniqueIdent(sound.name, soundNames);
    const display = ident === sound.name.trim() ? '' : ` as ${quote(sound.name)}`;
    body.push(`sound ${ident} ${quote(resolveAsset(sound.url))} for ${num(sound.duration)}${display}`);
  }

  const props = object.props;
  body.push(`x = ${num(props.x)}`);
  body.push(`y = ${num(props.y)}`);
  body.push(`scale_x = ${num(props.scaleX)}`);
  body.push(`scale_y = ${num(props.scaleY)}`);
  body.push(`angle = ${num(props.angle)}`);
  body.push(`way = ${num(props.way)}`);
  body.push(`rotation ${props.rotation}`);
  body.push(`visible ${props.visible}`);
  if (props.lock) body.push('lock true');
  // The registration point only needs writing when it was moved off centre.
  if (props.center) body.push(`center ${num(props.center.x)} ${num(props.center.y)}`);

  if (object.kind === 'text' && object.text) {
    const text = object.text;
    body.push(`text_content = ${quote(text.content)}`);
    body.push(`font = ${quote(fontFamily(text.font))}`);
    body.push(`font_size = ${num(text.fontSize)}`);
    body.push(`font_color = ${text.color}`);
    body.push(`bg_color = ${text.bgColor ?? 'transparent'}`);
    body.push(`text_align = ${text.align}`);
    body.push(`line_break = ${text.lineBreak}`);
    body.push(`text_bold = ${text.bold}`);
    body.push(`text_italic = ${text.italic}`);
    body.push(`text_underline = ${text.underline}`);
    body.push(`text_strikethrough = ${text.strike}`);
    body.push(`size ${num(text.boxWidth)} ${num(text.boxHeight)}`);
  }

  for (const variable of model.variables.filter((candidate) => candidate.owner === object.id)) {
    body.push(variableLine({ ...variable, scope: 'local' }, idents));
  }

  const scripts = objectScripts(object, options);
  for (const script of scripts) body.push('', script);

  // Local functions are declared inside their object, as the decompiler writes them.
  // Inline ones are among the scripts already.
  for (const definition of model.functions.filter((each) => each.owner === object.id && !each.inline)) {
    body.push('', functionLines(definition).join('\n'));
  }

  lines.push(...indent(body, 1));
  lines.push('end');
  return lines;
}

function objectScripts(object: TessObject, options: WriteOptions): string[] {
  const live = options.live?.get(object.id);
  // A live workspace just saved into the object reads the same as its state.
  if (live && !options.liveSaved) return workspaceScripts(live);
  return cached(object.blocks, () =>
    live ? workspaceScripts(live) : readWorkspace(object.blocks, (workspace) => workspaceScripts(workspace)));
}

/** Runs a reader over a headless copy of a saved workspace. */
function readWorkspace<T>(state: BlocklyState | null, read: (workspace: Blockly.Workspace) => T): T {
  const workspace = new Blockly.Workspace();
  try {
    if (state) Blockly.serialization.workspaces.load(state as never, workspace, { recordUndo: false });
    return read(workspace);
  } finally {
    workspace.dispose();
  }
}

function uniqueKey(name: string, taken: Set<string>): string {
  let key = name.trim() || '오브젝트';
  let index = 2;
  while (taken.has(key)) {
    key = `${name.trim()} ${index}`;
    index += 1;
  }
  taken.add(key);
  return key;
}

/** Indents every line, including the inner lines of a multi-line entry. */
function indent(lines: string[], depth: number): string[] {
  const prefix = INDENT.repeat(depth);
  return lines.map((line) =>
    line
      ? line.split('\n').map((part) => (part ? `${prefix}${part}` : part)).join('\n')
      : line);
}
