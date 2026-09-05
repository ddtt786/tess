/**
 * 엔트리 작품(.ent) 파일을 Tess 소스 코드로 디컴파일합니다.
 * 블록 트리를 분석하여 해당되는 텍스트 코드를 생성합니다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readTar } from './tar.ts';
import { findLocalRuntime } from '@tess/player';
import { safeIdentifier, tessString, tessNumber, tessLiteral, displayNamePart } from './ident.ts';
import { autoParamName } from '@tess/core';
import { blocksToLines, commentLines, indent, functionDeclarationLines, colorExpr } from './stmt.ts';
import { KEY_CODES } from '@tess/core';
import type {
  CollectedAsset, DecompileContext, DecompileOptions, DecompileResult,
  FunctionField, FunctionInfo, FunctionLocal, ObjectInfo, RawBlock, RawEntity,
  ResourceInfo, TableInfo, TarEntry, VarInfo,
} from './types.ts';

const REVERSE_KEY_NAME: Record<string, string> = {};
for (const [name, code] of Object.entries(KEY_CODES)) {
  if (!(String(code) in REVERSE_KEY_NAME)) REVERSE_KEY_NAME[String(code)] = name;
}

// 엔트리 기본 오브젝트의 모양·소리는 작품 파일에 없고, 실행기가 함께 배포하는 파일을
// 가리키기만 한다. 설치된 entryjs 에서 실제 파일을 꺼내 assets/ 에 담는다.
// 폴더 이름은 엔트리 버전에 따라 entry-js 이거나 entryjs 다.
const BUILTIN_ASSET = /(?:^|\/)bower_components\/[^/]+\/(images\/[^?#]+)$/;

// _1x1.png 는 모양 없는 "새 오브젝트"용 1×1 투명 그림이다. 파일에서 잰 1×1 이 실제
// 크기가 아니라 project.json 의 dimension 이 실제 크기라, 이것만 `size` 를 적어 둔다.
const BLANK_IMAGE = /(?:^|\/)images\/_1x1\.png$/;

/**
 * Path of the PNG entry entry.js captured for an SVG costume, or null.
 *
 * The vector paint editor accepts images larger than its canvas and lets the
 * user move them into place. It captures that framing into a sibling PNG on
 * save but re-centres the SVG itself, so the SVG no longer matches either the
 * saved picture or the `dimension` the work renders at.
 */
function capturedPngFor(fileurl: string | undefined, entriesByPath: Map<string, Buffer>): string | null {
  if (!fileurl || !/\.svg$/i.test(fileurl)) return null;
  const png = `${fileurl.slice(0, -4)}.png`;
  return entriesByPath.has(png) ? png : null;
}

/** 엔트리 번들에 들어 있는 기본 리소스의 실제 바이트열. 못 찾으면 null */
function builtinAssetBytes(fileurl: string | undefined, runtimeDir: string | null): Buffer | null {
  const match = BUILTIN_ASSET.exec(fileurl ?? '');
  if (!match || !runtimeDir) return null;
  // 남의 작품에서 온 경로라 패키지 바깥을 가리키면 읽지 않는다
  if (match[1]!.split('/').includes('..')) return null;
  const file = path.join(runtimeDir, match[1]!);
  return fs.existsSync(file) && fs.statSync(file).isFile() ? fs.readFileSync(file) : null;
}

/** entryjs 를 작업 폴더에서 먼저 찾고, 없으면 tess 가 설치된 곳에서 찾는다 */
function findRuntimeDir(): string | null {
  return findLocalRuntime() ?? findLocalRuntime(path.dirname(fileURLToPath(import.meta.url)));
}

/**
 * 주어진 엔트리 파일(.ent) 바이트 배열을 파싱하여 Tess 소스 코드로 디컴파일합니다.
 *
 * @param bytes 엔트리 작품 파일의 바이트 데이터
 * @param options 디컴파일 옵션
 * @returns 디컴파일 결과 객체를 포함하는 Promise
 * @example
 * const result = await decompileEnt(buffer, { sizes: true });
 */
export async function decompileEnt(
  bytes: Buffer,
  options: DecompileOptions = {},
): Promise<DecompileResult> {
  const entries = await readTar(bytes);
  const projectEntry = entries.find((e) => e.name.endsWith('project.json'));
  if (!projectEntry) {
    throw new Error('project.json 을 찾지 못했습니다 — .ent(엔트리 작품) 파일이 맞는지 확인하세요.');
  }
  const project = JSON.parse(projectEntry.data.toString('utf-8'));
  return decompileProject(project, entries, options);
}

export function decompileProject(
  project: RawEntity,
  entries: TarEntry[],
  options: DecompileOptions = {},
): DecompileResult {
  const ctx = buildContext(project, entries, options);

  const lines: string[] = [];
  // 선언 묶음과 그 뒤의 코드 사이는 두 줄을 띄운다. 선언은 파일 머리말에 가까워서,
  // 한 줄만 띄우면 바로 아래의 project/scene 블록과 한 덩어리처럼 보인다.
  for (const varInfo of ctx.globalVars) lines.push(...declarationLine(varInfo));
  if (ctx.globalVars.length) lines.push('', '');

  for (const [, info] of ctx.tablesById) lines.push(...tableLines(info), '');

  lines.push('project:');
  lines.push(`  title ${tessString(project.name ?? 'Tess 작품')}`);
  if (project.description) lines.push(`  description ${tessString(project.description)}`);
  lines.push(`  fps ${tessNumber(project.speed ?? 60)}`);
  lines.push('end');
  lines.push('');

  for (const scene of project.scenes) lines.push(...sceneLines(scene, project, ctx));

  for (const fn of project.functions ?? []) {
    const entry = ctx.functionsById.get(fn.id);
    if (!entry) continue;
    // 한 오브젝트 것만 건드리는 함수는 그 오브젝트 조각 파일에 이미 들어갔다
    if (ctx.functionOwnerById.has(fn.id)) continue;
    try {
      const content = JSON.parse(fn.content ?? '[]');
      const createBlock = functionCreateBlock(content);
      if (!createBlock) continue;
      lines.push(...functionDeclarationLines(entry, createBlock, ctx));
      lines.push('');
    } catch (error) {
      ctx.warnings.add(`함수 '${entry.name}' 을(를) 읽지 못했습니다: ${(error as Error).message}`);
    }
  }

  // Notices are warnings under `strict`, matching compileProject.
  const strict = options.strict === true;
  return {
    source: `${lines.join('\n').trimEnd()}\n`,
    warnings: strict ? [...ctx.warnings, ...ctx.notices] : [...ctx.warnings],
    notices: strict ? [] : [...ctx.notices],
    assets: ctx.collectedAssets,
    name: project.name ?? 'project',
  };
}

// ---------------------------------------------------------------------------
//  컨텍스트 준비 — id -> 이름 표들을 미리 다 만들어 둔다
// ---------------------------------------------------------------------------
// 첫 매개변수에 모양·소리 id 가 들어 있을 수 있는 블록들 (직접 적었거나 목록에서 골랐거나)
const ID_HOLDING_BLOCKS = new Set(['text', 'number', 'get_pictures', 'get_sounds']);

/** 블록 트리를 훑으면서, 프로젝트에 실제로 있는 모양·소리 id 와 같은 값을 ctx.forcedIds 에 모은다 */
function collectHardcodedIds(node: unknown, ctx: DecompileContext) {
  for (const id of resourceIdsIn(node, ctx)) ctx.forcedIds.add(id);
}

/** 블록 트리가 가리키는, 프로젝트에 실제로 있는 모양·소리 id 들 */
function resourceIdsIn(node: unknown, ctx: DecompileContext, found = new Set<string>()): Set<string> {
  if (Array.isArray(node)) {
    node.forEach((child) => resourceIdsIn(child, ctx, found));
    return found;
  }
  if (!node || typeof node !== 'object') return found;
  const block = node as RawBlock;
  if (block.type !== undefined && ID_HOLDING_BLOCKS.has(block.type) && typeof block.params?.[0] === 'string') {
    const raw = block.params[0];
    if (ctx.picturesById.has(raw) || ctx.soundsById.has(raw)) found.add(raw);
  }
  for (const param of block.params ?? []) resourceIdsIn(param, ctx, found);
  for (const branch of block.statements ?? []) resourceIdsIn(branch, ctx, found);
  return found;
}

/** Variable and list ids found in a block tree, split by which kind wants them. */
interface VariableIds {
  variables: Set<string>;
  lists: Set<string>;
}

// Where a block keeps the id of the variable or list it works on. Mirrors the
// VARIABLE/LIST entries of each block's paramsKeyMap in entryjs.
const VARIABLE_SLOTS = new Map([
  ['get_variable', 0], ['set_variable', 0], ['change_variable', 0],
  ['show_variable', 0], ['hide_variable', 0],
]);
const LIST_SLOTS = new Map([
  ['show_list', 0], ['hide_list', 0], ['change_value_list_index', 0],
  ['value_of_index_from_list', 1], ['length_of_list', 1], ['is_included_in_list', 1],
  ['add_value_to_list', 1], ['remove_value_from_list', 1], ['insert_value_to_list', 1],
]);

/** Variable and list ids a block tree reads or writes, split by which kind it wants. */
function variableIdsIn(
  node: unknown,
  found: VariableIds = { variables: new Set(), lists: new Set() },
): VariableIds {
  if (Array.isArray(node)) {
    node.forEach((child) => variableIdsIn(child, found));
    return found;
  }
  if (!node || typeof node !== 'object') return found;
  const block = node as RawBlock;
  const buckets: Array<[Map<string, number>, Set<string>]> = [
    [VARIABLE_SLOTS, found.variables], [LIST_SLOTS, found.lists],
  ];
  for (const [slots, bucket] of buckets) {
    const index = slots.get(block.type ?? '');
    if (index === undefined) continue;
    const id = block.params?.[index];
    if (typeof id === 'string' && id) bucket.add(id);
  }
  for (const param of block.params ?? []) variableIdsIn(param, found);
  for (const branch of block.statements ?? []) variableIdsIn(branch, found);
  return found;
}

/** Tess names of the variables and lists a block tree reads or writes. */
function touchedVariableNames(content: unknown, ctx: DecompileContext): Set<string> {
  const found = variableIdsIn(content);
  const names = new Set<string>();
  for (const id of [...found.variables, ...found.lists]) {
    const info = ctx.varsById.get(id);
    if (info) names.add(info.identifier);
  }
  return names;
}

/**
 * Declares a variable for every id the blocks reference but the project no
 * longer defines. Entry leaves such references behind when a variable is
 * deleted while blocks still point at it; without a declaration the source
 * would not compile at all.
 */
function reviveDanglingVariables(project: RawEntity, ctx: DecompileContext, usedNames: Set<string>) {
  const found: VariableIds = { variables: new Set(), lists: new Set() };
  const scan = (text: string | undefined) => {
    try { variableIdsIn(JSON.parse(text ?? '[]'), found); } catch { /* unreadable script */ }
  };
  for (const object of project.objects ?? []) scan(object.script);
  for (const fn of project.functions ?? []) scan(fn.content);

  const kinds: Array<[Set<string>, boolean]> = [[found.variables, false], [found.lists, true]];
  for (const [ids, isList] of kinds) {
    for (const id of ids) {
      if (ctx.varsById.has(id) || ctx.funcLocalsById.has(id)) continue;
      const identifier = safeIdentifier(`_missing_${isList ? 'list' : 'var'}_${id}`, usedNames, 'missing');
      const source = isList ? { name: identifier, array: [] } : { name: identifier, value: 0 };
      const info = { identifier, isList, objectId: null, source };
      ctx.varsById.set(id, info);
      ctx.globalVars.push(info);
      ctx.warnings.add(`변수/리스트 id '${id}' 가 작품에 없어 '${identifier}' 로 새로 선언했습니다.`);
    }
  }
}

/**
 * The object id when every costume/sound a function names belongs to one object,
 * else null. A function that names none is left global — nothing ties it down.
 */
function soleResourceOwner(content: unknown, ctx: DecompileContext): string | null {
  const owners = new Set<string>();
  for (const id of resourceIdsIn(content, ctx)) {
    const info = (ctx.picturesById.get(id) ?? ctx.soundsById.get(id))!;
    owners.add(info.owner.id);
    if (owners.size > 1) return null;
  }
  return owners.size === 1 ? [...owners][0]! : null;
}

/**
 * The function_create block inside a function's content, or null.
 *
 * A function's workspace holds one thread per stack, and the definition is not
 * always the first: a comment block or a stack the author left detached comes
 * before it whenever it sits higher up in the workspace.
 */
function functionCreateBlock(content: unknown): RawBlock | null {
  for (const thread of (content ?? []) as unknown[]) {
    const block: RawBlock | null = Array.isArray(thread) ? thread[0] : null;
    if (block?.type === 'function_create' || block?.type === 'function_create_value') return block;
  }
  return null;
}

/**
 * 함수 정의 블록(function_create)의 머리를 마디 목록으로 펼친다.
 * 라벨과 매개변수 칸이 `params[1]` 로 이어진 사슬이고, 라벨이 중간에 끼거나
 * 매개변수가 판단 칸(function_field_boolean)일 수도 있다.
 *
 */
function readFunctionFields(create: RawBlock | null): FunctionField[] {
  const fields: FunctionField[] = [];
  let node = create?.params?.[0] as RawBlock | undefined;
  while (node && typeof node === 'object') {
    if (node.type === 'function_field_label') {
      fields.push({ kind: 'label', text: String(node.params?.[0] ?? '') });
    } else if (node.type === 'function_field_string' || node.type === 'function_field_boolean') {
      fields.push({
        kind: 'param',
        blockType: (node.params?.[0] as RawBlock | undefined)?.type ?? null,
        boolean: node.type === 'function_field_boolean',
      });
    } else {
      break; // 알 수 없는 마디가 나오면 거기까지만 읽는다
    }
    node = node.params?.[1] as RawBlock | undefined;
  }
  return fields;
}

function buildContext(
  project: RawEntity,
  entries: TarEntry[],
  options: DecompileOptions = {},
): DecompileContext {
  const usedNames = new Set<string>(); // 변수 · 함수 이름은 한 네임스페이스로 합쳐서 절대 안 겹치게 한다
  const entriesByPath = new Map(entries.map((e) => [e.name, e.data]));

  const ctx: DecompileContext = {
    warnings: new Set(),
    notices: new Set(),
    // Write `size W H` on every costume, not just the ones the compiler cannot measure.
    allSizes: options.sizes === true,
    // Keep SVG costumes as SVG instead of taking the PNG entry captured on save.
    keepSvg: options.keepSvg === true,
    varsById: new Map(),
    globalVars: [],
    localVarsByObject: new Map(),
    messagesById: new Map(),
    tablesById: new Map(),
    objectsById: new Map(),
    scenesById: new Map(),
    functionsById: new Map(),
    picturesById: new Map(),
    soundsById: new Map(),
    collectedAssets: [],
    // 장면이 하나뿐이면 objects/이름.tess 로 평평하게, 여러 개면 대부분의 프로젝트가
    // 실제로 장면별로 오브젝트를 나눠 관리하므로 objects/장면이름/이름.tess 로 나눈다.
    multiScene: (project.scenes ?? []).length > 1,
    // 함수 안에 하드코딩된 채로 발견된, 진짜 모양·소리 id 들 (1.4절 참고).
    // objectFragmentLines 가 이 id 를 가진 모양·소리 선언에 `force id "..."` 를 붙인다.
    forcedIds: new Set(),
    // Functions whose costumes/sounds all belong to one object: the declaration
    // moves into that object's fragment and resources are named, not id'd.
    functionOwnerById: new Map(),
    functionsByOwner: new Map(),
    // eventLines/resourceExpr 가 "지금 함수 몸통을 옮기는 중인가" 를 보는 플래그 —
    // 함수 안에서는 리터럴 id 를 이름으로 되짚지 않고 그대로 둔다(아래 forcedIds 주석 참고).
    inFunction: false,
    // The object that owns the function being written, when it has one.
    functionOwnerId: null,
    varName(id: string) {
      const info = ctx.varsById.get(id);
      if (info) return info.identifier;
      ctx.warnings.add(`변수/리스트 id '${id}' 를 찾지 못했습니다.`);
      return `_missing_var_${id}`;
    },
    funcLocalName(id: string) {
      const info = ctx.funcLocalsById.get(id);
      if (info) return info;
      ctx.warnings.add(`함수 지역변수 id '${id}' 를 찾지 못했습니다.`);
      return `_missing_local_${id}`;
    },
    // 함수 본문에서 매개변수를 가리키는 블록 타입(stringParam_xxxx / booleanParam_xxxx)
    // -> 그 매개변수의 Tess 이름
    funcParamsByBlockType: new Map(),
    funcParamName(blockType: string) {
      return ctx.funcParamsByBlockType.get(blockType) ?? null;
    },
    pictureName(id: string) {
      const info = ctx.picturesById.get(id);
      if (info) return info.identifier;
      // Entry matches the slot by id, then name, then position, so the value is
      // left as it stands and settled when the block runs.
      ctx.notices.add(`모양 id '${id}' 가 작품에 없어 그대로 남겼습니다. 실행할 때 이름으로 찾습니다.`);
      return String(id);
    },
    soundName(id: string) {
      const info = ctx.soundsById.get(id);
      if (info) return info.identifier;
      ctx.notices.add(`소리 id '${id}' 가 작품에 없어 그대로 남겼습니다. 실행할 때 이름으로 찾습니다.`);
      return String(id);
    },
    messageName(id: string) {
      return ctx.messagesById.get(id) ?? String(id);
    },
    tableName(id: string) {
      return ctx.tablesById.get(id)?.identifier ?? String(id);
    },
    funcLocalsById: new Map(),
  };

  // --- 신호 ------------------------------------------------------------------
  for (const message of project.messages ?? []) ctx.messagesById.set(message.id, message.name);

  // --- 테이블 ------------------------------------------------------------------
  for (const table of project.tables ?? []) {
    const identifier = safeIdentifier(table.name, usedNames, 'table');
    ctx.tablesById.set(table.id, { identifier, source: table });
  }

  // --- 장면 --------------------------------------------------------------------
  for (const scene of project.scenes ?? []) {
    const identifier = safeIdentifier(scene.name, usedNames, 'scene');
    ctx.scenesById.set(scene.id, { identifier, displayName: scene.name });
  }

  // --- 오브젝트 ------------------------------------------------------------------
  for (const object of project.objects ?? []) {
    const identifier = safeIdentifier(object.name, usedNames, 'object');
    ctx.objectsById.set(object.id, {
      identifier, displayName: object.name, kind: object.objectType, sceneId: object.scene,
    });

    // 모양·소리 이름은 오브젝트 안에서만 겹치지 않으면 된다. 다른 오브젝트에도 같은
    // 이름이 있을 수 있으므로, 리소스 파일을 저장할 때 쓸 오브젝트 정보를 같이 담아 둔다.
    const localUsed = new Set<string>();
    for (const picture of object.sprite?.pictures ?? []) {
      const picId = safeIdentifier(picture.name, localUsed, 'costume');
      ctx.picturesById.set(picture.id, { identifier: picId, source: picture, owner: object });
    }
    for (const sound of object.sprite?.sounds ?? []) {
      const sndId = safeIdentifier(sound.name?.replace(/\.[a-z0-9]+$/i, ''), localUsed, 'sound');
      ctx.soundsById.set(sound.id, { identifier: sndId, source: sound, owner: object });
    }
  }

  // --- 변수 · 리스트 (초시계·대답은 Tess 가 내장 키워드로 이미 제공한다) -----------
  for (const entry of project.variables ?? []) {
    if (entry.variableType === 'timer' || entry.variableType === 'answer') continue;
    const isList = entry.variableType === 'list';
    const identifier = safeIdentifier(entry.name, usedNames, isList ? 'list' : 'var');
    // A local whose object is gone has nowhere to be declared. Writing it as a
    // global keeps it in the work instead of dropping it without a trace.
    const owned = entry.object && ctx.objectsById.has(entry.object);
    if (entry.object && !owned) {
      ctx.warnings.add(`'${entry.name}' 은(는) 작품에 없는 오브젝트의 지역 변수라 전역으로 옮겼습니다.`);
    }
    const info = { identifier, isList, objectId: owned ? entry.object : null, source: entry };
    ctx.varsById.set(entry.id, info);
    if (owned) {
      if (!ctx.localVarsByObject.has(entry.object)) ctx.localVarsByObject.set(entry.object, []);
      ctx.localVarsByObject.get(entry.object)!.push(info);
    } else {
      ctx.globalVars.push(info);
    }
  }

  // --- 함수 --------------------------------------------------------------------
  for (const fn of project.functions ?? []) {
    let fields: FunctionField[] = [];
    let content: unknown = [];
    try {
      content = JSON.parse(fn.content ?? '[]');
      fields = readFunctionFields(functionCreateBlock(content));
    } catch { /* 머리를 못 읽어도 id 로 대체해서 계속 진행한다 */ }

    // 맨 앞 라벨만 함수 이름이 된다 (src/function-params.ts 참고)
    const first = fields[0];
    const label = first?.kind === 'label' ? first.text : fn.id;
    const identifier = safeIdentifier(label, usedNames, 'func');

    const params: string[] = [];
    // A parameter name hides every variable of the same name inside the body
    // (compiler/context.ts lookupVariable: param -> function local -> object
    // local -> global). Entry has no such shadowing — its body points at a
    // variable by id — so a parameter named after one silently rebinds that
    // variable's reads and turns its writes into a compile error. Only the
    // variables this body actually touches can be hidden, so only those names
    // are off limits; reserving every name in the work would rename parameters
    // that hide nothing, and each rename shows up as a label in the Entry
    // signature (compiler/index.ts isAutoParamName).
    const paramNames = touchedVariableNames(content, ctx);
    fields.forEach((field, index) => {
      if (field.kind !== 'param') return;
      // 바로 앞에 함수 이름이 아닌 라벨이 있으면, 그 라벨이 이 매개변수의 이름이 된다
      const previous = index > 0 ? fields[index - 1] : null;
      const name = previous?.kind === 'label' && index > 1
        ? safeIdentifier(previous.text, paramNames, 'p')
        : safeIdentifier(autoParamName(params.length), paramNames, 'p');
      // 판단 칸은 `이름?` 으로 적어야 다시 컴파일할 때도 판단 칸으로 남는다
      params.push(field.boolean ? `${name}?` : name);
      // 함수 본문에서 이 매개변수를 가리키는 블록(stringParam_xxxx)을 이름으로 되돌릴 때 쓴다
      if (field.blockType) ctx.funcParamsByBlockType.set(field.blockType, name);
    });

    // Function locals are referenced by id in the body. Their names must clash
    // with neither the parameters nor the variables the body can see: inside a
    // function Tess resolves a name as parameter -> function local -> global.
    const localUsed = new Set(paramNames);
    for (const info of ctx.globalVars) localUsed.add(info.identifier);
    const locals: FunctionLocal[] = [];
    for (const local of (fn.localVariables ?? []) as RawEntity[]) {
      const name = safeIdentifier(local.name, localUsed, 'local');
      ctx.funcLocalsById.set(local.id, name);
      locals.push({ name, entryName: String(local.name ?? ''), value: local.value });
    }

    ctx.functionsById.set(fn.id, { name: identifier, params, locals, displayLabel: label });
  }

  reviveDanglingVariables(project, ctx, usedNames);

  // 함수는 전역이라 어느 오브젝트가 부를지 모르므로, 함수 안의 모양·소리 id 는 이름으로
  // 바꾸지 않고 그대로 둔다. 대신 그 선언에 `force id` 를 붙여 다시 컴파일해도 같은
  // id 가 나오게 한다 (SPEC-ADDENDUM.md 1.4절).
  //
  // 다만 함수가 건드리는 모양·소리가 전부 한 오브젝트 것이면 얘기가 다르다. 그런
  // 함수는 사실상 그 오브젝트의 것이므로, 선언을 그 오브젝트 조각 파일로 옮기고
  // 리소스도 이름으로 적는다 — Tess 함수는 오브젝트 안에도 선언할 수 있고, 그 안에서는
  // 이름이 어느 오브젝트 것인지 분명하기 때문이다. 그러면 `force id` 가 아예 필요 없다.
  for (const fn of project.functions ?? []) {
    let content = null;
    try { content = JSON.parse(fn.content ?? '[]'); } catch { /* 못 읽으면 건너뛴다 */ }
    if (!content) continue;

    const ownerId = soleResourceOwner(content, ctx);
    const entry = ctx.functionsById.get(fn.id);
    const createBlock = functionCreateBlock(content);
    if (ownerId && entry && createBlock) {
      ctx.functionOwnerById.set(fn.id, ownerId);
      if (!ctx.functionsByOwner.has(ownerId)) ctx.functionsByOwner.set(ownerId, []);
      ctx.functionsByOwner.get(ownerId)!.push({ id: fn.id, entry, createBlock });
      continue;
    }
    collectHardcodedIds(content, ctx);
  }

  // --- 리소스(모양 · 소리) 실제 파일 -----------------------------------------------
  // 모양·소리 이름은 오브젝트마다 따로 붙어서 서로 겹칠 수 있다(특히 "새그림").
  // 파일 이름은 `오브젝트이름_모양이름`, 장면이 여럿이면 장면별 폴더로 나누고,
  // 그래도 겹치면 뒤에 번호를 붙인다.
  const assetTargets = new Map<string, string | null>(); // fileurl -> 저장한 상대 경로
  const usedAssetPaths = new Set<string>();
  const runtimeDir = findRuntimeDir();

  const uniqueAssetPath = (dir: string, name: string, ext: string) => {
    let candidate = `${dir}/${name}${ext}`;
    for (let n = 2; usedAssetPaths.has(candidate); n += 1) candidate = `${dir}/${name}_${n}${ext}`;
    usedAssetPaths.add(candidate);
    return candidate;
  };

  const registerAsset = (
    info: ResourceInfo,
    kind: string,
    ext: string,
    fileurl: string | undefined = info.source.fileurl,
  ): string | null => {
    if (!fileurl) return null;
    // 같은 파일을 여러 모양이 함께 쓰면 한 번만 저장하고 같은 경로를 돌려준다.
    if (assetTargets.has(fileurl)) return assetTargets.get(fileurl)!;
    const data = entriesByPath.get(fileurl) ?? builtinAssetBytes(fileurl, runtimeDir);
    if (!data) return null;

    const scene = ctx.scenesById.get(info.owner?.scene);
    const dir = ctx.multiScene && scene ? `assets/${kind}/${scene.identifier}` : `assets/${kind}`;
    const owner = ctx.objectsById.get(info.owner?.id);
    const name = owner ? `${owner.identifier}_${info.identifier}` : info.identifier;

    const relative = uniqueAssetPath(dir, name, ext);
    assetTargets.set(fileurl, relative);
    ctx.collectedAssets.push({ path: relative, data });
    return relative;
  };

  for (const [, info] of ctx.picturesById) {
    const pic = info.source;
    const png = ctx.keepSvg ? null : capturedPngFor(pic.fileurl, entriesByPath);
    const ext = png
      ? '.png'
      : (pic.imageType ? `.${pic.imageType}` : path.extname(pic.fileurl || '') || '.png');
    info.relativePath = registerAsset(info, 'image', ext, png ?? pic.fileurl);
    info.blankImage = BLANK_IMAGE.test(pic.fileurl ?? '');
  }
  for (const [, info] of ctx.soundsById) {
    const snd = info.source;
    const ext = snd.ext || path.extname(snd.fileurl || '') || '.mp3';
    info.relativePath = registerAsset(info, 'sound', ext);
  }

  return ctx;
}

/** `table 이름: columns ... row ... end` */
function tableLines(info: TableInfo): string[] {
  const table = info.source;
  const cells = (row: unknown[] | undefined) => (row ?? []).map((cell) => tessLiteral(cell)).join(', ');
  const lines = [`table ${info.identifier}${displayNamePart(info.identifier, table.name)}:`];
  lines.push(`  columns ${cells(table.fields)}`);
  for (const row of table.data ?? []) lines.push(`  row ${cells(row)}`);
  lines.push('end');
  return lines;
}

function declarationLine(info: VarInfo, indentLevel = 0): string[] {
  const pad = '  '.repeat(indentLevel);
  const source = info.source;
  let scope = '';
  if (source.isCloud) scope = 'shared ';
  else if (source.isRealTime) scope = 'realtime ';
  const named = displayNamePart(info.identifier, source.name);
  if (info.isList) {
    const items = (source.array ?? []).map((item: { data: unknown }) => tessLiteral(item.data));
    return [`${pad}${scope}list ${info.identifier}${named} = [${items.join(', ')}]`];
  }
  return [`${pad}${scope}var ${info.identifier}${named} = ${tessLiteral(source.value)}`];
}

// ---------------------------------------------------------------------------
//  장면
// ---------------------------------------------------------------------------
function sceneLines(scene: RawEntity, project: RawEntity, ctx: DecompileContext): string[] {
  const info = ctx.scenesById.get(scene.id)!;
  const lines = [`scene ${tessString(info.identifier)}:`];
  if (info.identifier !== info.displayName) lines.push(`  name ${tessString(info.displayName)}`);

  for (const object of project.objects ?? []) {
    if (object.scene !== scene.id) continue;
    lines.push(...useObjectLine(object, ctx, info.identifier));
  }
  lines.push('end');
  lines.push('');
  return lines;
}

// ---------------------------------------------------------------------------
//  오브젝트 — 기본적으로 오브젝트 하나당 조각 파일 하나(objects/이름.tess)로 따로
//  써 두고, main.tess 쪽에는 useobject/usetext 한 줄만 남긴다(SPEC-ADDENDUM.md 1.2절).
//  손으로 짠 것처럼 오브젝트별로 파일이 나뉘어 있어야 나중에 사람이 고치기 편하기
//  때문이다. 조각 파일은 `object "..." : ... end` 로 감싸지 않고 내용만 담는다 —
//  useobject/usetext 가 불러오면서 파일 이름으로 감싸 준다.
//  장면이 하나뿐인 작품은 objects/이름.tess 로 평평하게 두고, 장면이 여러 개면
//  거의 모든 프로젝트가 실제로 장면별로 오브젝트를 관리하므로
//  objects/장면이름/이름.tess 로 장면마다 폴더를 나눈다(ctx.multiScene).
// ---------------------------------------------------------------------------
function useObjectLine(object: RawEntity, ctx: DecompileContext, sceneIdentifier: string): string[] {
  const info = ctx.objectsById.get(object.id)!;
  const isText = object.objectType === 'textBox';
  const dir = ctx.multiScene ? `objects/${sceneIdentifier}` : 'objects';
  const relativePath = `${dir}/${info.identifier}.tess`;
  const fragment = objectFragmentLines(object, ctx, isText).join('\n').trimEnd();
  ctx.collectedAssets.push({ path: relativePath, data: Buffer.from(`${fragment}\n`, 'utf-8') });
  return [`  ${isText ? 'usetext' : 'useobject'} ${tessString(relativePath)}`];
}

/** 조각 파일 하나의 내용 — `object`/`text` 로 감싸지 않은, 들여쓰기 0 부터 시작하는 줄들 */
function objectFragmentLines(object: RawEntity, ctx: DecompileContext, isText: boolean): string[] {
  const info = ctx.objectsById.get(object.id)!;
  const lines: string[] = [];

  if (info.identifier !== info.displayName) lines.push(`name ${tessString(info.displayName)}`);

  for (const picture of object.sprite?.pictures ?? []) {
    const picInfo = ctx.picturesById.get(picture.id);
    if (!picInfo) continue;
    const isDefault = object.selectedPictureId === picture.id;
    // 크기는 적지 않는 것이 기본이다. 컴파일러가 그림 파일에서 크기를 직접 읽으므로,
    // 적어 두면 그림을 바꿀 때마다 숫자까지 함께 고쳐야 한다. 파일이 없을 때와,
    // 파일에서 잰 크기가 실제 크기가 아닌 1×1 빈 그림일 때만 적는다.
    // (`sizes` 옵션을 켜면 원본 dimension 을 전부 적어 둔다.)
    const measurable = picInfo.relativePath && !picInfo.blankImage && !ctx.allSizes;
    const sizePart = measurable
      ? ''
      : ` size ${tessNumber(picture.dimension?.width ?? 100)} ${tessNumber(picture.dimension?.height ?? 100)}`;
    const filePart = picInfo.relativePath ?? (picture.fileurl ?? `${picInfo.identifier}.png`);
    const namePart = displayNamePart(picInfo.identifier, picture.name);
    const forcePart = ctx.forcedIds.has(picture.id) ? ` force id ${tessString(picture.id)}` : '';
    lines.push(`${isDefault ? 'default costume' : 'costume'} ${picInfo.identifier} ${tessString(filePart)}${sizePart}${namePart}${forcePart}`);
  }
  for (const sound of object.sprite?.sounds ?? []) {
    const sndInfo = ctx.soundsById.get(sound.id);
    if (!sndInfo) continue;
    // Always keep the length Entry measured, for the same reason the text box
    // frame is kept: "play sound and wait" waits `duration * 1000` ms and
    // Entry skips loading a sound whose duration is 0, while the compiler only
    // estimates the length from the mp3 header. Costume sizes are different —
    // the compiler reads those from the image file exactly.
    const durationPart = ` for ${tessNumber(Number.isFinite(sound.duration) ? sound.duration : 1)}`;
    const filePart = sndInfo.relativePath ?? (sound.fileurl ?? `${sndInfo.identifier}.mp3`);
    const namePart = displayNamePart(sndInfo.identifier, sound.name);
    const forcePart = ctx.forcedIds.has(sound.id) ? ` force id ${tessString(sound.id)}` : '';
    lines.push(`sound ${sndInfo.identifier} ${tessString(filePart)}${durationPart}${namePart}${forcePart}`);
  }

  lines.push(...objectPropertyLines(object, isText, 0));

  if (object.rotateMethod && object.rotateMethod !== 'free') {
    lines.push(`rotation ${object.rotateMethod}`);
  }
  if (object.lock) lines.push('lock true');
  if (object.entity?.visible === false) lines.push('visible false');

  // 속성과 변수 선언 묶음, 그리고 그 뒤의 when 블록 사이도 main.tess 와 똑같이 두 줄 띄운다
  for (const varInfo of ctx.localVarsByObject.get(object.id) ?? []) {
    lines.push(...declarationLine(varInfo, 0));
  }
  if (lines.length) lines.push('', '');

  let threads: RawBlock[][] = [];
  try {
    threads = JSON.parse(object.script ?? '[]');
  } catch (error) {
    ctx.warnings.add(`오브젝트 '${info.displayName}' 의 스크립트를 읽지 못했습니다: ${(error as Error).message}`);
  }
  for (const thread of threads) lines.push(...eventLines(thread, ctx, 0));

  // 이 오브젝트 것만 건드리는 함수는 여기, 조각 파일 맨 끝에 선언한다. 그 안에서는
  // 모양·소리를 이름으로 적을 수 있어서 `force id` 가 필요 없다(buildContext 참고).
  for (const owned of ctx.functionsByOwner.get(object.id) ?? []) {
    lines.push('');
    lines.push(...functionDeclarationLines(owned.entry, owned.createBlock, ctx, object.id));
  }

  return lines;
}

/**
 * `center X Y` — the object's registration point (regX/regY), the spot its x/y
 * actually put on the stage. Entry defaults it to the middle of the costume, so
 * the line is only written when the user moved it; the compiler falls back to
 * the same default. Dropping it puts the object somewhere else entirely — in
 * right_leaning.ent the entrybot slides ~200px across the stage.
 */
function centerLine(object: RawEntity, pad: string): string[] {
  const entity = object.entity ?? {};
  if (!Number.isFinite(entity.regX) || !Number.isFinite(entity.regY)) return [];

  const pictures = (object.sprite?.pictures ?? []) as RawEntity[];
  const picture = pictures.find((p) => p.id === object.selectedPictureId) ?? pictures[0];
  const width = picture?.dimension?.width ?? 100;
  const height = picture?.dimension?.height ?? 100;
  if (entity.regX === width / 2 && entity.regY === height / 2) return [];

  return [`${pad}center ${tessNumber(entity.regX)} ${tessNumber(entity.regY)}`];
}

/**
 * Entry keeps scale as a ratio and Tess writes it as a percent, so this rounds
 * only as far as it can while still dividing back to the same ratio (the
 * compiler does `scale_x / 100`). Rounding to a whole percent instead would
 * turn a size of 51.3% into 51%.
 */
function scalePercent(ratio: number): number {
  const exact = ratio * 100;
  for (let digits = 0; digits <= 6; digits += 1) {
    const candidate = Number(exact.toFixed(digits));
    if (candidate / 100 === ratio) return candidate;
  }
  return Number(exact.toPrecision(12));
}

function objectPropertyLines(object: RawEntity, isText: boolean, indentLevel: number): string[] {
  const pad = '  '.repeat(indentLevel);
  const lines: string[] = [];
  const entity = object.entity ?? {};
  if (entity.x) lines.push(`${pad}x = ${tessNumber(entity.x)}`);
  if (entity.y) lines.push(`${pad}y = ${tessNumber(entity.y)}`);
  if (entity.rotation) lines.push(`${pad}angle = ${tessNumber(entity.rotation)}`);
  if (entity.direction !== undefined && entity.direction !== 90) lines.push(`${pad}way = ${tessNumber(entity.direction)}`);
  if (entity.scaleX !== undefined && entity.scaleX !== 1) lines.push(`${pad}scale_x = ${tessNumber(scalePercent(entity.scaleX))}`);
  if (entity.scaleY !== undefined && entity.scaleY !== 1) lines.push(`${pad}scale_y = ${tessNumber(scalePercent(entity.scaleY))}`);
  if (!isText) lines.push(...centerLine(object, pad));

  if (isText) {
    if (object.text) lines.push(`${pad}text_content = ${tessString(object.text)}`);
    if (entity.fontSize) lines.push(`${pad}font_size = ${tessNumber(entity.fontSize)}`);
    // Always keep the frame Entry measured. The compiler can only estimate it
    // from the character count, which is far off for wrapping text boxes.
    if (Number.isFinite(entity.width) && Number.isFinite(entity.height)) {
      lines.push(`${pad}size ${tessNumber(entity.width)} ${tessNumber(entity.height)}`);
    }

    const font = parseFont(entity.font);
    // 컴파일러의 기본값(packages/compiler/src/index.ts buildObject)과 같을 때는 생략한다
    if (font.family && font.family !== 'Nanum Gothic') lines.push(`${pad}font = ${tessString(font.family)}`);
    if (font.bold) lines.push(`${pad}text_bold = true`);
    if (font.italic) lines.push(`${pad}text_italic = true`);
    if (entity.colour && entity.colour !== '#000000') lines.push(`${pad}font_color = ${colorExpr(entity.colour)}`);
    if (entity.bgColor && entity.bgColor !== '#ffffff') lines.push(`${pad}bg_color = ${colorExpr(entity.bgColor)}`);
    if (entity.underLine) lines.push(`${pad}text_underline = true`);
    if (entity.strike) lines.push(`${pad}text_strikethrough = true`);
    if (entity.lineBreak) lines.push(`${pad}line_break = true`);
    const aligns: Record<string, string> = { 0: 'center', 1: 'left', 2: 'right' };
    if (entity.textAlign && aligns[entity.textAlign] && entity.textAlign !== 0) {
      lines.push(`${pad}text_align = ${aligns[entity.textAlign]}`);
    }
  }
  return lines;
}

/** entity.font(`"bold italic 24px D2 Coding"` 형태)를 굵기·기울임·글씨체 이름으로 되짚는다 */
function parseFont(font: unknown) {
  const tokens = String(font ?? '').trim().split(/\s+/);
  let bold = false;
  let italic = false;
  while (tokens[0] === 'bold' || tokens[0] === 'italic') {
    if (tokens.shift() === 'bold') bold = true; else italic = true;
  }
  if (/^[\d.]+px$/.test(tokens[0] ?? '')) tokens.shift();
  return { bold, italic, family: tokens.join(' ') };
}

// ---------------------------------------------------------------------------
//  이벤트(hat 블록) -> when ... do
// ---------------------------------------------------------------------------
/** Rolls a diagnostic set back to what it held before. */
function keepOnly(set: Set<string>, before: Set<string>): void {
  for (const item of [...set]) {
    if (!before.has(item)) set.delete(item);
  }
}

function eventLines(thread: RawBlock[] | undefined, ctx: DecompileContext, indentLevel: number): string[] {
  if (!thread?.length) return [];
  const [hat, ...rest] = thread;
  const pad = '  '.repeat(indentLevel);
  // 본문은 머리글(when ... do)보다 항상 한 단 더 들여쓴다. 조각 파일에서는 머리글이
  // 0단이라, indentLevel 만큼만 들여쓰던 예전 코드는 본문을 전혀 들여쓰지 않았다.
  const indentBody = (lines: string[]) => Array.from({ length: indentLevel + 1 })
    .reduce<string[]>((acc) => indent(acc), lines);

  // 이벤트에 달린 메모는 hat 블록이 들고 있다(compiler/index.ts applyComment).
  const note = commentLines(hat).map((line) => `${pad}${line}`);

  const keyUp = matchKeyUpPattern(hat, rest);
  if (keyUp) {
    const body = indentBody(blocksToLines(keyUp.body, ctx));
    return [...note, `${pad}when key ${tessString(keyUp.key)} up do`, ...body, `${pad}end`, ''];
  }

  const header = eventHeader(hat, ctx);
  if (header) {
    const body = indentBody(blocksToLines(rest, ctx));
    return [...note, `${pad}${header} do`, ...body, `${pad}end`, ''];
  }

  // 'comment' 는 블록이 아니라 워크스페이스에 그냥 떠 있는 메모다. 블록에 붙은
  // 메모는 그 블록의 `comment` 로 들어가고, 아무 데도 안 붙은 것만 이렇게 스레드
  // 하나로 저장된다. 그대로 Tess 주석으로 옮긴다.
  if (hat?.type === 'comment') {
    const text = String((hat as { value?: unknown }).value ?? '').trimEnd();
    if (!text.trim()) return [];
    return [...text.split(/\r?\n/).map((line) => `${pad}# ${line}`.trimEnd()), ''];
  }

  // 스레드 맨 앞이라고 다 이벤트(hat) 블록은 아니다 — 엔트리 워크스페이스에
  // 그냥 빼놨을 뿐, 어디에도 연결 안 된 블록 뭉치도 똑같이 "스레드 하나"로
  // 저장된다. 그런 건 실제로 실행된 적이 없으니(엔트리도 안 돌린다) 억지로
  // when 으로 감싸 실행되게 만들지 않고, 내용만 주석으로 그대로 남겨서
  // "연결 안 된 상태"를 그대로 지킨다.
  // 어차피 주석으로만 남을 코드라, 그걸 옮기다 나온 알림은 알려 줄 것이 못 된다 —
  // 워크스페이스에 떨어져 있던 값 블록 하나까지 "아직 옮길 수 없습니다" 로 새어
  // 나오던 자리다. 이 뭉치가 새로 만든 것만 걷어 내고 원래 있던 것은 남긴다.
  const hadWarnings = new Set(ctx.warnings);
  const hadNotices = new Set(ctx.notices);
  const raw = blocksToLines(thread, ctx); // 맨 앞도 그냥 평범한 블록으로 취급해서 통째로 옮긴다
  keepOnly(ctx.warnings, hadWarnings);
  keepOnly(ctx.notices, hadNotices);
  const commented = raw.map((line: string) => (line.trim() ? `${pad}# ${line}` : ''));
  return [
    `${pad}# [decompile] 아래는 엔트리 원본에서 어디에도 연결돼 있지 않던 블록입니다 (실행되지 않음):`,
    ...commented,
    '',
  ];
}

function eventHeader(hat: RawBlock | undefined, ctx: DecompileContext): string | null {
  const p = (hat?.params ?? []) as any[];
  switch (hat?.type) {
    case 'when_run_button_click': return 'when start';
    case 'when_scene_start': return 'when scene start';
    case 'when_object_click': return 'when click';
    case 'when_object_click_canceled': return 'when click up';
    case 'mouse_clicked': return 'when stage click';
    case 'mouse_click_cancled': return 'when stage click up';
    case 'when_clone_start': return 'when cloned';
    case 'when_message_cast': return `when signal ${tessString(ctx.messageName(p[1]))}`;
    case 'when_some_key_pressed': {
      const name = REVERSE_KEY_NAME[String(p[1])];
      return name ? `when key ${tessString(name)}` : null;
    }
    default: return null;
  }
}

/** 컴파일러가 `when key X up` 을 펼쳐 만드는 감시 스크립트를 되짚어 알아본다 */
function matchKeyUpPattern(hat: RawBlock | undefined, rest: RawBlock[]) {
  if (hat?.type !== 'when_run_button_click') return null;
  if (rest.length !== 1 || rest[0]?.type !== 'repeat_inf') return null;
  const body = rest[0]!.statements?.[0] ?? [];
  if (body.length < 2) return null;
  const [first, second, ...tail] = body as RawBlock[];
  if (first?.type !== 'wait_until_true' || second?.type !== 'wait_until_true') return null;
  const pressed = first.params?.[0] as RawBlock | undefined;
  const pressedCode = pressed?.type === 'is_press_some_key' ? pressed.params?.[0] : null;
  const notPressed = second.params?.[0] as RawBlock | undefined;
  const negated = notPressed?.params?.[1] as RawBlock | undefined;
  const releasedCode = notPressed?.type === 'boolean_not' && negated?.type === 'is_press_some_key'
    ? negated.params?.[0]
    : null;
  if (!pressedCode || pressedCode !== releasedCode) return null;
  const key = REVERSE_KEY_NAME[String(pressedCode)];
  return key ? { key, body: tail } : null;
}
