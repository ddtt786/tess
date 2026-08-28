// ============================================================================
//  Decompiles a .ent (Entry project) back into Tess source.
//
//  The inverse of src/compiler: walks project.json's block tree and emits
//  Tess source text. Not every block is known; an unknown block is left as
//  a `# [decompile] ...` comment rather than failing the whole conversion,
//  so the rest can still be reviewed and fixed up by hand.
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readTar } from './tar.js';
import { findLocalRuntime } from '../player/server.js';
import { safeIdentifier, tessString, tessNumber } from './ident.js';
import { autoParamName } from '../function-params.js';
import { blocksToLines, indent, functionDeclarationLines, colorExpr } from './stmt.js';
import { KEY_CODES } from '../compiler/keycodes.js';

const REVERSE_KEY_NAME = {};
for (const [name, code] of Object.entries(KEY_CODES)) {
  if (!(String(code) in REVERSE_KEY_NAME)) REVERSE_KEY_NAME[String(code)] = name;
}

// A built-in Entry object's costume/sound is not stored in the project file;
// it just references a file shipped with the runtime. The actual bytes are
// pulled from an installed entryjs into assets/. The folder is named
// entry-js or entryjs depending on the Entry version.
const BUILTIN_ASSET = /(?:^|\/)bower_components\/[^/]+\/(images\/[^?#]+)$/;

// _1x1.png is the 1x1 transparent placeholder image for a costume-less "new
// object". Its measured size isn't the real size — project.json's
// `dimension` is — so only this image gets an explicit `size`.
const BLANK_IMAGE = /(?:^|\/)images\/_1x1\.png$/;

/** Raw bytes of a built-in resource bundled with Entry, or null if not found. */
function builtinAssetBytes(fileurl, runtimeDir) {
  const match = BUILTIN_ASSET.exec(fileurl ?? '');
  if (!match || !runtimeDir) return null;
  // The path comes from someone else's project; don't read outside the package.
  if (match[1].split('/').includes('..')) return null;
  const file = path.join(runtimeDir, match[1]);
  return fs.existsSync(file) && fs.statSync(file).isFile() ? fs.readFileSync(file) : null;
}

/** Looks for entryjs in the working directory first, then wherever tess is installed. */
function findRuntimeDir() {
  return findLocalRuntime() ?? findLocalRuntime(path.dirname(fileURLToPath(import.meta.url)));
}

/**
 * Decompiles the raw bytes of a .ent file into Tess source.
 * @returns {Promise<{source: string, warnings: string[], assets: Array<{path:string, data:Buffer}>, name: string}>}
 */
export async function decompileEnt(bytes) {
  const entries = await readTar(bytes);
  const projectEntry = entries.find((e) => e.name.endsWith('project.json'));
  if (!projectEntry) {
    throw new Error('project.json 을 찾지 못했습니다 — .ent(엔트리 작품) 파일이 맞는지 확인하세요.');
  }
  const project = JSON.parse(projectEntry.data.toString('utf-8'));
  return decompileProject(project, entries);
}

export function decompileProject(project, entries) {
  const ctx = buildContext(project, entries);

  const lines = [];
  // Two blank lines separate the declaration block from what follows —
  // declarations read like a file header, and one blank line would make
  // them look part of the same block as the project/scene declaration below.
  for (const varInfo of ctx.globalVars) lines.push(...declarationLine(varInfo));
  if (ctx.globalVars.length) lines.push('', '');

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
    try {
      const content = JSON.parse(fn.content ?? '[]');
      const createBlock = content?.[0]?.[0];
      if (!createBlock) continue;
      lines.push(...functionDeclarationLines(entry, createBlock, ctx));
      lines.push('');
    } catch (error) {
      ctx.warnings.add(`함수 '${entry.name}' 을(를) 읽지 못했습니다: ${error.message}`);
    }
  }

  return {
    source: `${lines.join('\n').trimEnd()}\n`,
    warnings: [...ctx.warnings],
    assets: ctx.collectedAssets,
    name: project.name ?? 'project',
  };
}

// ---------------------------------------------------------------------------
//  Context setup — builds all the id -> name lookup tables up front.
// ---------------------------------------------------------------------------
// Blocks whose first parameter may hold a costume/sound id (typed literally or picked from a list).
const ID_HOLDING_BLOCKS = new Set(['text', 'number', 'get_pictures', 'get_sounds']);

/** Walks the block tree, collecting values matching a real costume/sound id into ctx.forcedIds. */
function collectHardcodedIds(node, ctx) {
  if (Array.isArray(node)) { node.forEach((child) => collectHardcodedIds(child, ctx)); return; }
  if (!node || typeof node !== 'object') return;
  if (ID_HOLDING_BLOCKS.has(node.type) && typeof node.params?.[0] === 'string') {
    const raw = node.params[0];
    if (ctx.picturesById.has(raw) || ctx.soundsById.has(raw)) ctx.forcedIds.add(raw);
  }
  for (const param of node.params ?? []) collectHardcodedIds(param, ctx);
  for (const branch of node.statements ?? []) collectHardcodedIds(branch, ctx);
}

/**
 * Flattens a function definition block's (function_create) header into a
 * list of nodes. Labels and parameter slots form a chain linked through
 * `params[1]`; a label may appear mid-chain, and a parameter slot may be a
 * boolean field (function_field_boolean).
 *
 * @returns {Array<{kind:'label', text:string}|{kind:'param', blockType:string|null, boolean:boolean}>}
 */
function readFunctionFields(create) {
  const fields = [];
  let node = create?.params?.[0];
  while (node && typeof node === 'object') {
    if (node.type === 'function_field_label') {
      fields.push({ kind: 'label', text: String(node.params?.[0] ?? '') });
    } else if (node.type === 'function_field_string' || node.type === 'function_field_boolean') {
      fields.push({
        kind: 'param',
        blockType: node.params?.[0]?.type ?? null,
        boolean: node.type === 'function_field_boolean',
      });
    } else {
      break; // Stop reading at the first unrecognized node.
    }
    node = node.params?.[1];
  }
  return fields;
}

function buildContext(project, entries) {
  const usedNames = new Set(); // Variable and function names share one namespace so they never collide.
  const entriesByPath = new Map(entries.map((e) => [e.name, e.data]));

  const ctx = {
    warnings: new Set(),
    varsById: new Map(),
    globalVars: [],
    localVarsByObject: new Map(),
    messagesById: new Map(),
    objectsById: new Map(),
    scenesById: new Map(),
    functionsById: new Map(),
    picturesById: new Map(),
    soundsById: new Map(),
    collectedAssets: [],
    // A single scene is laid out flat as objects/name.tess; with multiple
    // scenes, most projects genuinely organize objects per scene, so use
    // objects/sceneName/name.tess instead.
    multiScene: (project.scenes ?? []).length > 1,
    // Real costume/sound ids found hardcoded inside a function (see spec addendum 1.4).
    // objectFragmentLines attaches `force id "..."` to the matching declaration.
    forcedIds: new Set(),
    // Whether a function body is currently being rendered, checked by
    // eventLines/resourceExpr — inside a function, a literal id is kept as
    // is instead of being resolved to a name (see the forcedIds note above).
    inFunction: false,
    varName(id) {
      const info = ctx.varsById.get(id);
      if (info) return info.identifier;
      ctx.warnings.add(`변수/리스트 id '${id}' 를 찾지 못했습니다.`);
      return `_missing_var_${id}`;
    },
    funcLocalName(id) {
      const info = ctx.funcLocalsById.get(id);
      if (info) return info;
      ctx.warnings.add(`함수 지역변수 id '${id}' 를 찾지 못했습니다.`);
      return `_missing_local_${id}`;
    },
    // Maps a block type referencing a parameter inside a function body
    // (stringParam_xxxx / booleanParam_xxxx) to that parameter's Tess name.
    funcParamsByBlockType: new Map(),
    funcParamName(blockType) {
      return ctx.funcParamsByBlockType.get(blockType) ?? null;
    },
    pictureName(id) {
      const info = ctx.picturesById.get(id);
      return info ? info.identifier : String(id);
    },
    soundName(id) {
      const info = ctx.soundsById.get(id);
      return info ? info.identifier : String(id);
    },
    messageName(id) {
      return ctx.messagesById.get(id) ?? String(id);
    },
    funcLocalsById: new Map(),
  };

  // --- Signals -----------------------------------------------------------------
  for (const message of project.messages ?? []) ctx.messagesById.set(message.id, message.name);

  // --- Scenes --------------------------------------------------------------------
  for (const scene of project.scenes ?? []) {
    const identifier = safeIdentifier(scene.name, usedNames, 'scene');
    ctx.scenesById.set(scene.id, { identifier, displayName: scene.name });
  }

  // --- Objects -------------------------------------------------------------------
  for (const object of project.objects ?? []) {
    const identifier = safeIdentifier(object.name, usedNames, 'object');
    ctx.objectsById.set(object.id, {
      identifier, displayName: object.name, kind: object.objectType, sceneId: object.scene,
    });

    // Costume/sound names only need to be unique within their own object —
    // another object can reuse the same name — so keep the owning object
    // alongside for use when saving the resource file.
    const localUsed = new Set();
    for (const picture of object.sprite?.pictures ?? []) {
      const picId = safeIdentifier(picture.name, localUsed, 'costume');
      ctx.picturesById.set(picture.id, { identifier: picId, source: picture, owner: object });
    }
    for (const sound of object.sprite?.sounds ?? []) {
      const sndId = safeIdentifier(sound.name?.replace(/\.[a-z0-9]+$/i, ''), localUsed, 'sound');
      ctx.soundsById.set(sound.id, { identifier: sndId, source: sound, owner: object });
    }
  }

  // --- Variables · lists (timer/answer are already built-in Tess keywords) -------
  for (const entry of project.variables ?? []) {
    if (entry.variableType === 'timer' || entry.variableType === 'answer') continue;
    const isList = entry.variableType === 'list';
    const identifier = safeIdentifier(entry.name, usedNames, isList ? 'list' : 'var');
    const info = { identifier, isList, objectId: entry.object, source: entry };
    ctx.varsById.set(entry.id, info);
    if (entry.object) {
      if (!ctx.localVarsByObject.has(entry.object)) ctx.localVarsByObject.set(entry.object, []);
      ctx.localVarsByObject.get(entry.object).push(info);
    } else {
      ctx.globalVars.push(info);
    }
  }

  // --- Functions -----------------------------------------------------------------
  for (const fn of project.functions ?? []) {
    let fields = [];
    try {
      fields = readFunctionFields(JSON.parse(fn.content ?? '[]')?.[0]?.[0]);
    } catch { /* Fall back to the raw id if the header can't be read. */ }

    // Only the leading label becomes the function name (see src/function-params.js).
    const label = fields[0]?.kind === 'label' ? fields[0].text : fn.id;
    const identifier = safeIdentifier(label, usedNames, 'func');

    const params = [];
    const paramNames = new Set();
    fields.forEach((field, index) => {
      if (field.kind !== 'param') return;
      // A label immediately preceding this slot (other than the function
      // name) becomes the parameter's name.
      const previous = index > 0 ? fields[index - 1] : null;
      const name = previous?.kind === 'label' && index > 1
        ? safeIdentifier(previous.text, paramNames, 'p')
        : safeIdentifier(autoParamName(params.length), paramNames, 'p');
      // A boolean slot must be written as `name?` to stay boolean on recompile.
      params.push(field.boolean ? `${name}?` : name);
      // Used to resolve a block referencing this parameter (stringParam_xxxx) back to its name.
      if (field.blockType) ctx.funcParamsByBlockType.set(field.blockType, name);
    });

    ctx.functionsById.set(fn.id, { name: identifier, params, displayLabel: label });
  }

  // A function is global in Entry, so its caller object is unknown; costume/
  // sound ids inside it are left as ids instead of being resolved to names.
  // Their declaration gets `force id` so recompiling still produces the
  // same id (SPEC-ADDENDUM.md 1.4).
  for (const fn of project.functions ?? []) {
    try { collectHardcodedIds(JSON.parse(fn.content ?? '[]'), ctx); } catch { /* Skip if unreadable. */ }
  }

  // --- Resource (costume · sound) files -------------------------------------------
  // Costume/sound names are scoped per object and can collide across objects
  // (especially the default "new picture" name). Files are named
  // `objectName_costumeName`, split into per-scene folders when there are
  // multiple scenes, with a numeric suffix on any remaining collision.
  const assetTargets = new Map(); // fileurl -> saved relative path
  const usedAssetPaths = new Set();
  const runtimeDir = findRuntimeDir();

  const uniqueAssetPath = (dir, name, ext) => {
    let candidate = `${dir}/${name}${ext}`;
    for (let n = 2; usedAssetPaths.has(candidate); n += 1) candidate = `${dir}/${name}_${n}${ext}`;
    usedAssetPaths.add(candidate);
    return candidate;
  };

  const registerAsset = (info, kind, ext) => {
    const fileurl = info.source.fileurl;
    if (!fileurl) return null;
    // Multiple costumes sharing the same file are saved once and reuse the same path.
    if (assetTargets.has(fileurl)) return assetTargets.get(fileurl);
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
    const ext = pic.imageType ? `.${pic.imageType}` : path.extname(pic.fileurl || '') || '.png';
    info.relativePath = registerAsset(info, 'image', ext);
    info.blankImage = BLANK_IMAGE.test(pic.fileurl ?? '');
  }
  for (const [, info] of ctx.soundsById) {
    const snd = info.source;
    const ext = snd.ext || path.extname(snd.fileurl || '') || '.mp3';
    info.relativePath = registerAsset(info, 'sound', ext);
  }

  return ctx;
}

function declarationLine(info, indentLevel = 0) {
  const pad = '  '.repeat(indentLevel);
  if (info.isList) {
    const items = (info.source.array ?? []).map((item) => literalOf(item.data));
    return [`${pad}list ${info.identifier} = [${items.join(', ')}]`];
  }
  return [`${pad}var ${info.identifier} = ${literalOf(info.source.value)}`];
}

function literalOf(value) {
  if (typeof value === 'number') return tessNumber(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  const text = String(value ?? '');
  // Entry stores a boolean value as "TRUE"/"FALSE" (see compiler/expression.js);
  // older projects may use lowercase, so both forms are accepted.
  if (text === 'TRUE' || text === 'true') return 'true';
  if (text === 'FALSE' || text === 'false') return 'false';
  if (/^-?\d+(\.\d+)?$/.test(text)) return text;
  return tessString(text);
}

// ---------------------------------------------------------------------------
//  Scenes
// ---------------------------------------------------------------------------
function sceneLines(scene, project, ctx) {
  const info = ctx.scenesById.get(scene.id);
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
//  Objects — each object is written to its own fragment file
//  (objects/name.tess), with only a `useobject`/`usetext` line left in
//  main.tess (SPEC-ADDENDUM.md 1.2). This keeps the output editable like a
//  hand-written project, split by object. A fragment holds only the body,
//  not wrapped in `object "..." : ... end` — the useobject/usetext line
//  supplies that wrapper on load. A single-scene project is laid out flat
//  as objects/name.tess; with multiple scenes, files are split into
//  per-scene folders as objects/sceneName/name.tess (ctx.multiScene), since
//  most projects manage objects per scene in practice.
// ---------------------------------------------------------------------------
function useObjectLine(object, ctx, sceneIdentifier) {
  const info = ctx.objectsById.get(object.id);
  const isText = object.objectType === 'textBox';
  const dir = ctx.multiScene ? `objects/${sceneIdentifier}` : 'objects';
  const relativePath = `${dir}/${info.identifier}.tess`;
  const fragment = objectFragmentLines(object, ctx, isText).join('\n').trimEnd();
  ctx.collectedAssets.push({ path: relativePath, data: Buffer.from(`${fragment}\n`, 'utf-8') });
  return [`  ${isText ? 'usetext' : 'useobject'} ${tessString(relativePath)}`];
}

/** Contents of a single fragment file — unwrapped by `object`/`text`, indented at level 0. */
function objectFragmentLines(object, ctx, isText) {
  const info = ctx.objectsById.get(object.id);
  const lines = [];

  if (info.identifier !== info.displayName) lines.push(`name ${tessString(info.displayName)}`);

  for (const picture of object.sprite?.pictures ?? []) {
    const picInfo = ctx.picturesById.get(picture.id);
    if (!picInfo) continue;
    const isDefault = object.selectedPictureId === picture.id;
    // Size is omitted by default, since the compiler reads it directly from
    // the image file — writing it out would need updating whenever the
    // image changes. It's written only when there's no file, or for the
    // 1x1 blank image whose measured size isn't the real size.
    const sizePart = picInfo.relativePath && !picInfo.blankImage
      ? ''
      : ` size ${tessNumber(picture.dimension?.width ?? 100)} ${tessNumber(picture.dimension?.height ?? 100)}`;
    const filePart = picInfo.relativePath ?? (picture.fileurl ?? `${picInfo.identifier}.png`);
    const forcePart = ctx.forcedIds.has(picture.id) ? ` force id ${tessString(picture.id)}` : '';
    lines.push(`${isDefault ? 'default costume' : 'costume'} ${picInfo.identifier} ${tessString(filePart)}${sizePart}${forcePart}`);
  }
  for (const sound of object.sprite?.sounds ?? []) {
    const sndInfo = ctx.soundsById.get(sound.id);
    if (!sndInfo) continue;
    const durationPart = sndInfo.relativePath ? '' : ` for ${tessNumber(sound.duration ?? 1)}`;
    const filePart = sndInfo.relativePath ?? (sound.fileurl ?? `${sndInfo.identifier}.mp3`);
    const forcePart = ctx.forcedIds.has(sound.id) ? ` force id ${tessString(sound.id)}` : '';
    lines.push(`sound ${sndInfo.identifier} ${tessString(filePart)}${durationPart}${forcePart}`);
  }

  lines.push(...objectPropertyLines(object, isText, 0));

  if (object.rotateMethod && object.rotateMethod !== 'free') {
    lines.push(`rotation ${object.rotateMethod}`);
  }
  if (object.lock) lines.push('lock true');
  if (object.entity?.visible === false) lines.push('visible false');

  // As in main.tess, leave two blank lines between the property/variable
  // declaration block and the `when` blocks that follow.
  for (const varInfo of ctx.localVarsByObject.get(object.id) ?? []) {
    lines.push(...declarationLine(varInfo, 0));
  }
  if (lines.length) lines.push('', '');

  let threads = [];
  try {
    threads = JSON.parse(object.script ?? '[]');
  } catch (error) {
    ctx.warnings.add(`오브젝트 '${info.displayName}' 의 스크립트를 읽지 못했습니다: ${error.message}`);
  }
  for (const thread of threads) lines.push(...eventLines(thread, ctx, 0));

  return lines;
}

function objectPropertyLines(object, isText, indentLevel) {
  const pad = '  '.repeat(indentLevel);
  const lines = [];
  const entity = object.entity ?? {};
  if (entity.x) lines.push(`${pad}x = ${tessNumber(entity.x)}`);
  if (entity.y) lines.push(`${pad}y = ${tessNumber(entity.y)}`);
  if (entity.rotation) lines.push(`${pad}angle = ${tessNumber(entity.rotation)}`);
  if (entity.direction !== undefined && entity.direction !== 90) lines.push(`${pad}way = ${tessNumber(entity.direction)}`);
  if (entity.scaleX !== undefined && entity.scaleX !== 1) lines.push(`${pad}scale_x = ${tessNumber(Math.round(entity.scaleX * 100))}`);
  if (entity.scaleY !== undefined && entity.scaleY !== 1) lines.push(`${pad}scale_y = ${tessNumber(Math.round(entity.scaleY * 100))}`);

  if (isText) {
    if (object.text) lines.push(`${pad}text_content = ${tessString(object.text)}`);
    if (entity.fontSize) lines.push(`${pad}font_size = ${tessNumber(entity.fontSize)}`);

    const font = parseFont(entity.font);
    // Omitted when it matches the compiler's default (src/compiler/index.js buildObject).
    if (font.family && font.family !== 'Nanum Gothic') lines.push(`${pad}font = ${tessString(font.family)}`);
    if (font.bold) lines.push(`${pad}text_bold = true`);
    if (font.italic) lines.push(`${pad}text_italic = true`);
    if (entity.colour && entity.colour !== '#000000') lines.push(`${pad}font_color = ${colorExpr(entity.colour)}`);
    if (entity.bgColor && entity.bgColor !== '#ffffff') lines.push(`${pad}bg_color = ${colorExpr(entity.bgColor)}`);
    if (entity.underLine) lines.push(`${pad}text_underline = true`);
    if (entity.strike) lines.push(`${pad}text_strikethrough = true`);
    if (entity.lineBreak) lines.push(`${pad}line_break = true`);
    const aligns = { 0: 'center', 1: 'left', 2: 'right' };
    if (entity.textAlign && aligns[entity.textAlign] && entity.textAlign !== 0) {
      lines.push(`${pad}text_align = ${aligns[entity.textAlign]}`);
    }
  }
  return lines;
}

/** Parses entity.font (e.g. `"bold italic 24px D2 Coding"`) into bold/italic/family. */
function parseFont(font) {
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
//  Events (hat blocks) -> when ... do
// ---------------------------------------------------------------------------
function eventLines(thread, ctx, indentLevel) {
  if (!thread?.length) return [];
  const [hat, ...rest] = thread;
  const pad = '  '.repeat(indentLevel);
  // The body is always indented one level deeper than its `when ... do` header.
  const indentBody = (lines) => Array.from({ length: indentLevel + 1 }).reduce((acc) => indent(acc), lines);

  const keyUp = matchKeyUpPattern(hat, rest);
  if (keyUp) {
    const body = indentBody(blocksToLines(keyUp.body, ctx));
    return [`${pad}when key ${tessString(keyUp.key)} up do`, ...body, `${pad}end`, ''];
  }

  const header = eventHeader(hat, ctx);
  if (header) {
    const body = indentBody(blocksToLines(rest, ctx));
    return [`${pad}${header} do`, ...body, `${pad}end`, ''];
  }

  // Not every leading block in a thread is an event (hat) block — a stray
  // block group left disconnected in the Entry workspace is stored as its
  // own "thread" too. Since Entry never executes it either, it's kept as a
  // comment rather than being forced into a `when` wrapper that would run it.
  ctx.warnings.add(`연결되지 않은 블록 뭉치(맨 앞이 '${hat?.type}')를 원본처럼 실행되지 않게 주석으로 남겼습니다.`);
  const raw = blocksToLines(thread, ctx); // Treat the leading block as an ordinary block too.
  const commented = raw.map((line) => (line.trim() ? `${pad}# ${line}` : ''));
  return [
    `${pad}# [decompile] 아래는 엔트리 원본에서 어디에도 연결돼 있지 않던 블록입니다 (실행되지 않음):`,
    ...commented,
    '',
  ];
}

function eventHeader(hat, ctx) {
  const p = hat?.params ?? [];
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

/** Recognizes the watcher script the compiler expands `when key X up` into. */
function matchKeyUpPattern(hat, rest) {
  if (hat?.type !== 'when_run_button_click') return null;
  if (rest.length !== 1 || rest[0]?.type !== 'repeat_inf') return null;
  const body = rest[0].statements?.[0] ?? [];
  if (body.length < 2) return null;
  const [first, second, ...tail] = body;
  if (first?.type !== 'wait_until_true' || second?.type !== 'wait_until_true') return null;
  const pressedCode = first.params?.[0]?.type === 'is_press_some_key' ? first.params[0].params?.[0] : null;
  const notPressed = second.params?.[0];
  const releasedCode = notPressed?.type === 'boolean_not' && notPressed.params?.[1]?.type === 'is_press_some_key'
    ? notPressed.params[1].params?.[0]
    : null;
  if (!pressedCode || pressedCode !== releasedCode) return null;
  const key = REVERSE_KEY_NAME[String(pressedCode)];
  return key ? { key, body: tail } : null;
}
