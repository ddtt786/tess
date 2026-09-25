/**
 * @fileoverview Opening an entry `.ent` as an editor project.
 *
 * The work is decompiled to Tess and compiled back, which leaves one canonical
 * entry block tree with every name resolved. Records carry their compiled ids
 * into the editor model, so the converted blocks can point at them directly.
 */
import { decompileProject, restoreTableRows } from '../../../decompiler/src/index.ts';
import type { TarEntry } from '../../../decompiler/src/types.ts';
import { compileProject } from '../../../compiler/src/index.ts';
import {
  convertStack, convertValue, helperFunctions, warmEntryPatterns, nameHelperCalls, stackHeight, type BlockJson, type ConvertContext, type EntryBlock,
} from '../blocks/entry-blocks.ts';
import { DEFINE_BLOCK, PARAM_BOOLEAN, PARAM_VALUE } from '../blocks/function-ids.ts';
import { safeIdent } from '../codegen/ident.ts';
import { saveAsset } from './assets.ts';
import { yieldToPage } from './yield.ts';
import { replaceProject } from './store.ts';
import type {
  Costume, FunctionDef, FunctionParam, ObjectProps, Scene, Sound, TableDef, TessObject, TessProject, TextProps,
  VariableDef,
} from './types.ts';
import { copyDeep } from './json.ts';

export interface EntImportResult {
  /** Entry block types that have no editor block, with how often they appeared. */
  missed: Map<string, number>;
}

/** Reports how far an import has got: what it is doing and how much is done (0–1). */
export type ImportProgress = (step: string, done: number) => void;

export async function loadEntFile(file: File, onProgress?: ImportProgress): Promise<EntImportResult> {
  const { model, missed } = await readEntFile(file, onProgress);
  replaceProject(model);
  return { missed };
}

/** Lets the page paint between the long steps, so the progress shows and the tab stays alive. */
function breathe(): Promise<void> {
  return yieldToPage();
}

/** Builds the editor project an `.ent` holds, without opening it. */
export async function readEntFile(file: File, onProgress?: ImportProgress): Promise<EntImportResult & { model: TessProject }> {
  const report = async (step: string, done: number) => {
    onProgress?.(step, done);
    await breathe();
  };
  await report('파일을 읽는 중', 0.02);
  const entries = await readTar(new Uint8Array(await file.arrayBuffer()));
  const json = entries.find((entry) => /(^|\/)project\.json$/.test(entry.name));
  if (!json) throw new Error('엔트리 작품 파일이 아닙니다.');
  const work = JSON.parse(new TextDecoder().decode(json.data)) as Record<string, unknown>;

  await report('Tess 로 옮기는 중', 0.1);
  const decompiled = decompileProject(work, entries, { inline: true, sizes: true, tableRows: false });
  await report('블록 구조를 만드는 중', 0.25);
  const compiled = compileProject(decompiled.source, {
    path: 'main.tess',
    name: String(work.name ?? ''),
    assetUrls: true,
  });
  if (!compiled.project) {
    const first = compiled.errors[0];
    throw new Error(
      first ? `작품을 옮기지 못했습니다 (${first.line}:${first.column} ${first.message})` : '작품을 옮기지 못했습니다.',
    );
  }
  restoreTableRows(compiled.project as never, decompiled.tableRows);
  const assets = new Map(decompiled.assets.map((asset) => [asset.path, asset.data]));
  await report('블록 모양을 익히는 중', 0.4);
  await warmEntryPatterns();
  return toModel(compiled.project as unknown as CompiledWork, decompiled.source, assets, report);
}

// --- tar --------------------------------------------------------------------

/** Reads a tar, gzipped or not. Only regular files are returned. */
export async function readTar(bytes: Uint8Array): Promise<TarEntry[]> {
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
    bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  }
  const decoder = new TextDecoder();
  const text = (start: number, length: number) =>
    decoder.decode(bytes.subarray(start, start + length)).replace(/\0.*$/s, '');
  const entries: TarEntry[] = [];
  let longName: string | null = null;
  for (let offset = 0; offset + 512 <= bytes.length;) {
    const name = text(offset, 100);
    if (!name) break;
    const size = parseInt(text(offset + 124, 12).trim() || '0', 8);
    const flag = String.fromCharCode(bytes[offset + 156] ?? 0);
    const prefix = text(offset + 257, 6).startsWith('ustar') ? text(offset + 345, 155) : '';
    const body = bytes.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;

    if (flag === 'L') {
      longName = decoder.decode(body).replace(/\0.*$/s, '');
      continue;
    }
    if (flag === 'x') {
      const path = /\d+ path=([^\n]*)\n/.exec(decoder.decode(body));
      if (path) longName = path[1]!;
      continue;
    }
    const full = longName ?? (prefix ? `${prefix}/${name}` : name);
    longName = null;
    if (flag === '0' || flag === '\0') entries.push({ name: full, data: body.slice() });
  }
  return entries;
}

// --- the model --------------------------------------------------------------

interface CompiledAsset {
  id: string;
  name: string;
  fileurl?: string;
  imageType?: string;
  ext?: string;
  dimension?: { width: number; height: number };
  duration?: number;
}

interface CompiledObject {
  id: string;
  name: string;
  objectType: string;
  rotateMethod: string;
  scene: string;
  lock?: boolean;
  script: string;
  selectedPictureId?: string;
  sprite: { pictures: CompiledAsset[]; sounds: CompiledAsset[] };
  entity: Record<string, unknown>;
}

interface CompiledVariable {
  id: string;
  name: string;
  variableType: string;
  value: unknown;
  visible: boolean;
  isCloud?: boolean;
  isRealTime?: boolean;
  object: string | null;
  array?: Array<{ data: unknown }>;
  minValue?: number;
  maxValue?: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

interface CompiledFunction {
  id: string;
  type: string;
  localVariables?: Array<{ id: string; name: string; value: unknown }>;
  content: string;
}

interface CompiledWork {
  name: string;
  speed?: number;
  scenes: Scene[];
  objects: CompiledObject[];
  variables: CompiledVariable[];
  messages: Array<{ id: string; name: string }>;
  functions: CompiledFunction[];
  tables?: Array<{ id: string; name: string; fields?: string[]; data?: unknown[][] }>;
}

async function toModel(
  work: CompiledWork,
  source: string,
  assets: Map<string, Uint8Array>,
  report: (step: string, done: number) => Promise<void>,
): Promise<{ model: TessProject; missed: Map<string, number> }> {
  const paramNames = functionParamNames(source);
  // The compiler's own helpers come back from the statements that need them.
  const helpers = helperFunctions(work.functions);
  const own = work.functions.filter((fn) => !helpers.has(fn.id));
  const ctx: ConvertContext = {
    helpers,
    functions: new Map(own.map((fn) => [fn.id, {
      value: fn.type === 'value',
      params: readHeader(parseJson<EntryBlock[][]>(fn.content)?.[0]?.[0]?.params?.[0]).params.map((param) => param.kind),
    }])),
    params: new Map(),
    locals: new Map(),
    missed: new Map(),
  };
  const stored = new Map<string, Promise<string>>();
  const keep = (url: string | undefined, kind: 'image' | 'sound', ext: string): Promise<string> => {
    if (!url) return Promise.resolve('');
    const bytes = assets.get(url);
    if (!bytes) return Promise.resolve(url);
    if (!stored.has(url)) stored.set(url, saveAsset(dataUrl(bytes, mimeOf(kind, ext || url))));
    return stored.get(url)!;
  };

  const objects: TessObject[] = [];
  for (const [index, object] of work.objects.entries()) {
    if (index % 20 === 0) await report('블록으로 옮기는 중', 0.45 + 0.45 * (index / Math.max(1, work.objects.length)));
    objects.push(await toObject(object, keep, ctx));
  }
  await report('함수를 옮기는 중', 0.92);

  const variables: VariableDef[] = work.variables
    .filter((variable) => variable.variableType !== 'timer' && variable.variableType !== 'answer')
    .map((variable) => ({
      id: variable.id,
      // A global `@name` is Tess's `store` (Entry Save Manager's naming), written without the mark.
      name: storeName(variable) ?? variable.name,
      kind: variable.variableType === 'list' ? 'list' : 'variable',
      owner: variable.object ?? null,
      value: typeof variable.value === 'number' ? variable.value : String(variable.value ?? 0),
      array: (variable.array ?? []).map((item) => (typeof item.data === 'number' ? item.data : String(item.data ?? ''))),
      visible: Boolean(variable.visible),
      scope: variable.isRealTime ? 'realtime' : variable.isCloud ? 'shared' : storeName(variable) ? 'store' : 'local',
      // Entry reads a zero as "not placed" and lays the box out itself.
      at: variable.x && variable.y ? { x: Number(variable.x), y: Number(variable.y) } : null,
      size: variable.variableType === 'list' && (Number(variable.width ?? 100) !== 100 || Number(variable.height ?? 120) !== 120)
        ? { width: Number(variable.width ?? 100), height: Number(variable.height ?? 120) }
        : null,
      slide: variable.variableType === 'slide'
        ? { min: Number(variable.minValue ?? 0), max: Number(variable.maxValue ?? 100) }
        : null,
    }));

  const tables: TableDef[] = (work.tables ?? []).map((table) => ({
    id: table.id,
    name: table.name,
    columns: (table.fields ?? []).map(String),
    rows: (table.data ?? []).map((row) => row.map((cell) => String(cell ?? ''))),
  }));

  const globals = new Set(work.variables.map((variable) => safeIdent(variable.name)));
  // entry allows two functions of one name; Tess needs them apart, as the decompiler writes them.
  const functionNames = new Set<string>();
  const owners = functionOwners(source);
  const objectIdByName = new Map<string, string>();
  for (const object of work.objects) if (!objectIdByName.has(object.name)) objectIdByName.set(object.name, object.id);
  const functions = own.map((fn) => {
    const definition = toFunction(fn, paramNames, globals, functionNames, ctx);
    const tessName = readHeader(parseJson<EntryBlock[][]>(fn.content)?.[0]?.[0]?.params?.[0]).name;
    const ownerName = owners.get(tessName);
    return { ...definition, owner: ownerName ? objectIdByName.get(ownerName) ?? null : null };
  });

  return {
    model: {
      name: work.name || '작품',
      description: '',
      fps: Number(work.speed ?? 60) || 60,
      scenes: work.scenes.map((scene) => ({ id: scene.id, name: scene.name })),
      objects,
      variables,
      signals: work.messages.map((message) => ({ id: message.id, name: message.name })),
      functions,
      tables,
    },
    missed: ctx.missed,
  };
}

/** The name a global `@name` variable or list has as a `store` record, or null for any other. */
function storeName(variable: CompiledVariable): string | null {
  if (variable.object || variable.isCloud || variable.isRealTime) return null;
  const name = variable.name;
  return name.length > 1 && name.startsWith('@') && name !== '@확장프로그램' ? name.slice(1) : null;
}

async function toObject(
  object: CompiledObject,
  keep: (url: string | undefined, kind: 'image' | 'sound', ext: string) => Promise<string>,
  ctx: ConvertContext,
): Promise<TessObject> {
  const entity = object.entity;
  const costumes: Costume[] = [];
  // Entry lets two costumes share a name; here each is told apart with `_2`, `_3`…
  const names = new Set<string>();
  const unique = (name: string) => {
    let next = name;
    for (let index = 2; names.has(next); index += 1) next = `${name}_${index}`;
    names.add(next);
    return next;
  };
  for (const picture of object.sprite.pictures ?? []) {
    costumes.push({
      id: picture.id,
      name: unique(picture.name),
      url: await keep(picture.fileurl, 'image', picture.imageType ?? ''),
      width: picture.dimension?.width ?? 100,
      height: picture.dimension?.height ?? 100,
    });
  }
  const sounds: Sound[] = [];
  for (const sound of object.sprite.sounds ?? []) {
    sounds.push({
      id: sound.id,
      name: sound.name,
      url: await keep(sound.fileurl, 'sound', sound.ext ?? ''),
      duration: Number(sound.duration ?? 1),
    });
  }
  const isText = object.objectType === 'textBox';
  const width = Number(entity.width ?? 0);
  const height = Number(entity.height ?? 0);
  const regX = Number(entity.regX ?? width / 2);
  const regY = Number(entity.regY ?? height / 2);
  const props: ObjectProps = {
    x: Number(entity.x ?? 0),
    y: Number(entity.y ?? 0),
    scaleX: round(Number(entity.scaleX ?? 1) * 100),
    scaleY: round(Number(entity.scaleY ?? 1) * 100),
    angle: Number(entity.rotation ?? 0),
    way: Number(entity.direction ?? 90),
    rotation: object.rotateMethod === 'vertical' || object.rotateMethod === 'none' ? object.rotateMethod : 'free',
    visible: entity.visible !== false,
    lock: Boolean(object.lock),
    center: !isText && (Math.abs(regX - width / 2) > 0.01 || Math.abs(regY - height / 2) > 0.01)
      ? { x: regX, y: regY }
      : null,
  };
  return {
    id: object.id,
    name: object.name,
    kind: isText ? 'text' : 'sprite',
    sceneId: object.scene,
    costumes,
    selectedCostumeId: object.selectedPictureId ?? costumes[0]?.id ?? '',
    sounds,
    props,
    text: isText ? toText(entity) : null,
    blocks: scriptsState(nameHelperCalls(parseJson<EntryBlock[][]>(object.script) ?? [], ctx.helpers), ctx),
  };
}

function toText(entity: Record<string, unknown>): TextProps {
  const font = String(entity.font ?? '');
  const family = /\d+(?:\.\d+)?px\s+(.*)$/.exec(font)?.[1]?.trim();
  const align = Number(entity.textAlign ?? 0);
  return {
    content: String(entity.text ?? ''),
    font: family || 'NanumGothic',
    fontSize: Number(entity.fontSize ?? 20) || 20,
    color: String(entity.colour ?? '#000000'),
    bgColor: !entity.bgColor || entity.bgColor === 'transparent' ? null : String(entity.bgColor),
    align: align === 1 ? 'left' : align === 2 ? 'right' : 'center',
    lineBreak: Boolean(entity.lineBreak),
    bold: /\bbold\b/.test(font),
    italic: /\bitalic\b/.test(font),
    underline: Boolean(entity.underLine),
    strike: Boolean(entity.strike),
    boxWidth: Number(entity.width ?? 100),
    boxHeight: Number(entity.height ?? 40),
  };
}

/** Scripts one under another, each starting with its hat. */
function scriptsState(scripts: EntryBlock[][], ctx: ConvertContext): Record<string, unknown> | null {
  const blocks: BlockJson[] = [];
  let y = 40;
  for (const script of scripts) {
    const stack = convertStack(script, ctx);
    if (!stack) continue;
    blocks.push({ ...stack, x: 40, y });
    y += stackHeight(stack) + 48;
  }
  return blocks.length ? { blocks: { languageVersion: 0, blocks } } : null;
}

// --- functions --------------------------------------------------------------

/**
 * Functions the decompiler declared inside an object — the ones only that
 * object uses — by Tess name, with the object's name as the work shows it.
 */
function functionOwners(source: string): Map<string, string> {
  const owners = new Map<string, string>();
  let current: { indent: number; key: string; display: string | null } | null = null;
  for (const line of source.split('\n')) {
    const indent = line.length - line.trimStart().length;
    const header = /^(\s*)(?:object|text)\s+("(?:[^"\\]|\\.)*")\s*:\s*$/.exec(line);
    if (header) {
      current = { indent, key: JSON.parse(header[2]!) as string, display: null };
      continue;
    }
    if (!current || !line.trim()) continue;
    if (indent <= current.indent) {
      current = null;
      continue;
    }
    const named = /^\s*name\s+("(?:[^"\\]|\\.)*")\s*$/.exec(line);
    if (named && current.display === null && indent === current.indent + 2) {
      current.display = JSON.parse(named[1]!) as string;
      continue;
    }
    const fn = /^\s*function\s+([^\s(]+)\s*\(/.exec(line);
    if (fn) owners.set(fn[1]!, current.display ?? current.key);
  }
  return owners;
}

/** `function name(a, b?)` headers in the decompiled source, by function name. */
function functionParamNames(source: string): Map<string, string[]> {
  const names = new Map<string, string[]>();
  for (const line of source.split('\n')) {
    const header = /^\s*function\s+([^\s(]+)\s*\(([^)]*)\)\s*:/.exec(line);
    if (!header) continue;
    const params = header[2]!.split(',').map((param) => param.trim().replace(/\?$/, '')).filter(Boolean);
    names.set(header[1]!, params);
  }
  return names;
}

function toFunction(
  fn: CompiledFunction,
  paramNames: Map<string, string[]>,
  globals: Set<string>,
  functionNames: Set<string>,
  ctx: ConvertContext,
): FunctionDef {
  const script = nameHelperCalls(parseJson<EntryBlock[][]>(fn.content)?.[0] ?? [], ctx.helpers);
  const define = script[0];
  const header = readHeader(define?.params?.[0]);
  const params = header.params;
  let name = header.name;
  for (let index = 2; functionNames.has(safeIdent(name)); index += 1) name = `${header.name}_${index}`;
  functionNames.add(safeIdent(name));
  const names = paramNames.get(name) ?? paramNames.get(safeIdent(name)) ?? [];
  const functionParams: FunctionParam[] = params.map((param, index) => ({
    id: param.id,
    name: names[index] || (param.kind === 'boolean' ? `판단${index + 1}` : `값${index + 1}`),
    kind: param.kind,
  }));
  for (const param of functionParams) ctx.params.set(param.id, param.name);
  // A local may share a name with a parameter, another local or a variable it would hide.
  const taken = new Set([...globals, ...functionParams.map((param) => safeIdent(param.name))]);
  const localNames = new Map<string, string>();
  for (const local of fn.localVariables ?? []) {
    let name = local.name;
    for (let index = 2; taken.has(safeIdent(name)); index += 1) name = `${local.name}_${index}`;
    taken.add(safeIdent(name));
    localNames.set(local.id, name);
    ctx.locals.set(local.id, name);
  }

  // entry keeps the body in the define block's statements; a value function
  // adds its result in the fourth slot.
  const bodyBlocks = define?.statements?.[0] ?? script.slice(1);
  // The first top-level assignment of a local is its declaration.
  const declared = new Set<string>();
  const body: BlockJson[] = [];
  for (const block of bodyBlocks) {
    const local = block?.type === 'set_func_variable' ? String(block.params?.[0] ?? '') : '';
    if (local && ctx.locals.has(local) && !declared.has(local)) {
      declared.add(local);
      const value = convertValue(block.params?.[1], ctx);
      body.push({
        type: 'func_local_var',
        fields: { NAME: ctx.locals.get(local)! },
        inputs: { VALUE: value && value.type === 'calc_number' ? { shadow: value } : { shadow: literalShadow(0), ...(value ? { block: value } : {}) } },
      });
      continue;
    }
    const converted = convertStack([block], ctx);
    if (converted) body.push(converted);
  }
  const undeclared = (fn.localVariables ?? []).filter((local) => !declared.has(local.id)).map((local) => ({
    type: 'func_local_var',
    fields: { NAME: localNames.get(local.id)! },
    inputs: { VALUE: { shadow: literalShadow(local.value) } },
  }));
  body.unshift(...undeclared);
  if (fn.type === 'value') {
    const result = convertValue(define?.params?.[3], ctx);
    body.push({
      type: 'func_return',
      inputs: { VALUE: result ? { shadow: { type: 'calc_number', fields: { NUM: 0 } }, block: result } : { shadow: { type: 'calc_number', fields: { NUM: 0 } } } },
    });
  }
  // `chain` links only flat lists; the converted rest is already a stack.
  const bodyStack = linkStacks(body);

  const inputs: Record<string, unknown> = {};
  functionParams.forEach((param, index) => {
    inputs[`ARG${index}`] = {
      block: {
        type: param.kind === 'boolean' ? PARAM_BOOLEAN : PARAM_VALUE,
        fields: { NAME: param.name },
        extraState: { param: param.id },
      },
    };
  });
  if (bodyStack) inputs.BODY = { block: bodyStack };
  const slots = [...functionParams.map((_, index) => `ARG${index}`), `ARG${functionParams.length}`];
  return {
    id: fn.id,
    name,
    params: functionParams,
    blocks: {
      blocks: {
        languageVersion: 0,
        blocks: [{ type: DEFINE_BLOCK, x: 40, y: 40, fields: { NAME: name }, extraState: { slots }, inputs }],
      },
    },
  };
}

/** The name and parameters a `function_field_*` chain spells out. */
function readHeader(node: unknown): { name: string; params: Array<{ id: string; kind: 'value' | 'boolean' }> } {
  const labels: string[] = [];
  const params: Array<{ id: string; kind: 'value' | 'boolean' }> = [];
  let current = node as EntryBlock | null | undefined;
  while (current && typeof current === 'object') {
    const [first, next] = current.params ?? [];
    if (current.type === 'function_field_label') labels.push(String(first ?? ''));
    else if (current.type === 'function_field_string' || current.type === 'function_field_boolean') {
      const param = first as EntryBlock | undefined;
      const id = param?.type?.replace(/^(string|boolean)Param_/, '') ?? '';
      if (id) params.push({ id, kind: current.type === 'function_field_boolean' ? 'boolean' : 'value' });
    }
    current = next as EntryBlock | null | undefined;
  }
  // Tess names a function by its first label; later labels come from parameter names.
  return { name: labels[0] || '함수', params };
}

/** Joins stacks end to end. */
function linkStacks(stacks: BlockJson[]): BlockJson | null {
  let head: BlockJson | null = null;
  for (let index = stacks.length - 1; index >= 0; index -= 1) {
    const top = copyDeep(stacks[index]!);
    if (head) {
      let tail = top;
      while ((tail.next as { block?: BlockJson } | undefined)?.block) tail = (tail.next as { block: BlockJson }).block;
      tail.next = { block: head };
    }
    head = top;
  }
  return head;
}

function literalShadow(value: unknown): Record<string, unknown> {
  const text = String(value ?? 0);
  return text.trim() !== '' && Number.isFinite(Number(text))
    ? { type: 'calc_number', fields: { NUM: Number(text) } }
    : { type: 'calc_text', fields: { TEXT: text } };
}

// --- helpers ----------------------------------------------------------------

function parseJson<T>(text: string | undefined): T | null {
  try {
    return text ? (JSON.parse(text) as T) : null;
  } catch {
    return null;
  }
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml',
  webp: 'image/webp', bmp: 'image/bmp', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg',
};

function mimeOf(kind: 'image' | 'sound', hint: string): string {
  const ext = hint.replace(/^.*\./, '').toLowerCase();
  return MIME[ext] ?? (kind === 'image' ? 'image/png' : 'audio/mpeg');
}

function dataUrl(bytes: Uint8Array, mime: string): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}
