// ============================================================================
//  .ent(엔트리 작품) -> Tess 소스로 되돌리기
//
//  src/compiler 가 하는 일의 정반대: project.json 의 블록 트리를 걸어 다니며
//  Tess 소스 텍스트를 만든다. 모든 블록을 다 알지는 못하므로, 모르는 블록은
//  `# [decompile] ...` 주석으로 남기고 계속 진행한다 — 하나 때문에 통째로
//  실패하는 것보다, 사람이 나머지를 보고 그 부분만 손보는 편이 낫다.
// ============================================================================
import path from 'node:path';
import { readTar } from './tar.js';
import { safeIdentifier, tessString, tessNumber } from './ident.js';
import { blocksToLines, indent, functionDeclarationLines, colorExpr } from './stmt.js';
import { KEY_CODES } from '../compiler/keycodes.js';

const REVERSE_KEY_NAME = {};
for (const [name, code] of Object.entries(KEY_CODES)) {
  if (!(String(code) in REVERSE_KEY_NAME)) REVERSE_KEY_NAME[String(code)] = name;
}

/**
 * .ent 파일 바이트열을 Tess 소스로 되돌린다.
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
  for (const varInfo of ctx.globalVars) lines.push(...declarationLine(varInfo));
  if (ctx.globalVars.length) lines.push('');

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
//  컨텍스트 준비 — id -> 이름 표들을 미리 다 만들어 둔다
// ---------------------------------------------------------------------------
function buildContext(project, entries) {
  const usedNames = new Set(); // 변수 · 함수 이름은 한 네임스페이스로 합쳐서 절대 안 겹치게 한다
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

  // --- 신호 ------------------------------------------------------------------
  for (const message of project.messages ?? []) ctx.messagesById.set(message.id, message.name);

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

    const localUsed = new Set();
    for (const picture of object.sprite?.pictures ?? []) {
      const picId = safeIdentifier(picture.name, localUsed, 'costume');
      ctx.picturesById.set(picture.id, { identifier: picId, source: picture });
    }
    for (const sound of object.sprite?.sounds ?? []) {
      const sndId = safeIdentifier(sound.name?.replace(/\.[a-z0-9]+$/i, ''), localUsed, 'sound');
      ctx.soundsById.set(sound.id, { identifier: sndId, source: sound });
    }
  }

  // --- 변수 · 리스트 (초시계·대답은 Tess 가 내장 키워드로 이미 제공한다) -----------
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

  // --- 함수 --------------------------------------------------------------------
  for (const fn of project.functions ?? []) {
    let label = fn.id;
    let paramCount = 0;
    try {
      const content = JSON.parse(fn.content ?? '[]');
      const create = content?.[0]?.[0];
      const field = create?.params?.[0];
      if (field?.type === 'function_field_label') {
        label = field.params?.[0] ?? label;
        let node = field.params?.[1];
        while (node && node.type === 'function_field_string') {
          paramCount += 1;
          node = node.params?.[1];
        }
      }
    } catch { /* 이름을 못 읽어도 id 로 대체해서 계속 진행한다 */ }

    const identifier = safeIdentifier(label, usedNames, 'func');
    const params = Array.from({ length: paramCount }, (_, i) => `p${i + 1}`);
    ctx.functionsById.set(fn.id, { name: identifier, params, displayLabel: label });
  }

  // --- 리소스(모양 · 소리) 실제 파일 -----------------------------------------------
  const assetTargets = new Map(); // fileurl -> 저장할 상대 경로
  const registerAsset = (fileurl, kind, safeName, ext) => {
    if (!fileurl || !entriesByPath.has(fileurl)) return null;
    if (assetTargets.has(fileurl)) return assetTargets.get(fileurl);
    const relative = `assets/${kind}/${safeName}${ext}`;
    assetTargets.set(fileurl, relative);
    ctx.collectedAssets.push({ path: relative, data: entriesByPath.get(fileurl) });
    return relative;
  };

  for (const [, info] of ctx.picturesById) {
    const pic = info.source;
    const ext = pic.imageType ? `.${pic.imageType}` : path.extname(pic.fileurl || '') || '.png';
    info.relativePath = registerAsset(pic.fileurl, 'image', info.identifier, ext);
  }
  for (const [, info] of ctx.soundsById) {
    const snd = info.source;
    const ext = snd.ext || path.extname(snd.fileurl || '') || '.mp3';
    info.relativePath = registerAsset(snd.fileurl, 'sound', info.identifier, ext);
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
  if (text === 'true' || text === 'false') return text;
  if (/^-?\d+(\.\d+)?$/.test(text)) return text;
  return tessString(text);
}

// ---------------------------------------------------------------------------
//  장면
// ---------------------------------------------------------------------------
function sceneLines(scene, project, ctx) {
  const info = ctx.scenesById.get(scene.id);
  const lines = [`scene ${tessString(info.identifier)}:`];
  if (info.identifier !== info.displayName) lines.push(`  name ${tessString(info.displayName)}`);

  for (const object of project.objects ?? []) {
    if (object.scene !== scene.id) continue;
    lines.push(...objectLines(object, ctx));
  }
  lines.push('end');
  lines.push('');
  return lines;
}

// ---------------------------------------------------------------------------
//  오브젝트
// ---------------------------------------------------------------------------
function objectLines(object, ctx) {
  const info = ctx.objectsById.get(object.id);
  const isText = object.objectType === 'textBox';
  const lines = [`  ${isText ? 'text' : 'object'} ${tessString(info.identifier)}:`];

  if (info.identifier !== info.displayName) lines.push(`    name ${tessString(info.displayName)}`);

  for (const picture of object.sprite?.pictures ?? []) {
    const picInfo = ctx.picturesById.get(picture.id);
    if (!picInfo) continue;
    const isDefault = object.selectedPictureId === picture.id;
    const sizePart = picInfo.relativePath
      ? ''
      : ` size ${picture.dimension?.width ?? 100} ${picture.dimension?.height ?? 100}`;
    const filePart = picInfo.relativePath ?? (picture.fileurl ?? `${picInfo.identifier}.png`);
    lines.push(`    ${isDefault ? 'default costume' : 'costume'} ${picInfo.identifier} ${tessString(filePart)}${sizePart}`);
  }
  for (const sound of object.sprite?.sounds ?? []) {
    const sndInfo = ctx.soundsById.get(sound.id);
    if (!sndInfo) continue;
    const durationPart = sndInfo.relativePath ? '' : ` for ${sound.duration ?? 1}`;
    const filePart = sndInfo.relativePath ?? (sound.fileurl ?? `${sndInfo.identifier}.mp3`);
    lines.push(`    sound ${sndInfo.identifier} ${tessString(filePart)}${durationPart}`);
  }

  lines.push(...objectPropertyLines(object, isText));

  if (object.rotateMethod && object.rotateMethod !== 'free') {
    lines.push(`    rotation ${object.rotateMethod}`);
  }
  if (object.lock) lines.push('    lock true');
  if (object.entity?.visible === false) lines.push('    visible false');

  for (const varInfo of ctx.localVarsByObject.get(object.id) ?? []) {
    lines.push(...declarationLine(varInfo, 2));
  }

  let threads = [];
  try {
    threads = JSON.parse(object.script ?? '[]');
  } catch (error) {
    ctx.warnings.add(`오브젝트 '${info.displayName}' 의 스크립트를 읽지 못했습니다: ${error.message}`);
  }
  for (const thread of threads) lines.push(...eventLines(thread, ctx));

  lines.push('  end');
  lines.push('');
  return lines;
}

function objectPropertyLines(object, isText) {
  const lines = [];
  const entity = object.entity ?? {};
  if (entity.x) lines.push(`    x = ${tessNumber(entity.x)}`);
  if (entity.y) lines.push(`    y = ${tessNumber(entity.y)}`);
  if (entity.rotation) lines.push(`    angle = ${tessNumber(entity.rotation)}`);
  if (entity.direction !== undefined && entity.direction !== 90) lines.push(`    way = ${tessNumber(entity.direction)}`);
  if (entity.scaleX !== undefined && entity.scaleX !== 1) lines.push(`    scale_x = ${tessNumber(Math.round(entity.scaleX * 100))}`);
  if (entity.scaleY !== undefined && entity.scaleY !== 1) lines.push(`    scale_y = ${tessNumber(Math.round(entity.scaleY * 100))}`);

  if (isText) {
    if (object.text) lines.push(`    text_content = ${tessString(object.text)}`);
    if (entity.fontSize) lines.push(`    font_size = ${tessNumber(entity.fontSize)}`);

    const font = parseFont(entity.font);
    // 컴파일러의 기본값(src/compiler/index.js buildObject)과 같을 때는 생략한다
    if (font.family && font.family !== 'Nanum Gothic') lines.push(`    font = ${tessString(font.family)}`);
    if (font.bold) lines.push('    text_bold = true');
    if (font.italic) lines.push('    text_italic = true');
    if (entity.colour && entity.colour !== '#000000') lines.push(`    font_color = ${colorExpr(entity.colour)}`);
    if (entity.bgColor && entity.bgColor !== '#ffffff') lines.push(`    bg_color = ${colorExpr(entity.bgColor)}`);
    if (entity.underLine) lines.push('    text_underline = true');
    if (entity.strike) lines.push('    text_strikethrough = true');
    if (entity.lineBreak) lines.push('    line_break = true');
    const aligns = { 0: 'center', 1: 'left', 2: 'right' };
    if (entity.textAlign && aligns[entity.textAlign] && entity.textAlign !== 0) {
      lines.push(`    text_align = ${aligns[entity.textAlign]}`);
    }
  }
  return lines;
}

/** entity.font(`"bold italic 24px D2 Coding"` 형태)를 굵기·기울임·글씨체 이름으로 되짚는다 */
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
//  이벤트(hat 블록) -> when ... do
// ---------------------------------------------------------------------------
function eventLines(thread, ctx) {
  if (!thread?.length) return [];
  const [hat, ...rest] = thread;

  const keyUp = matchKeyUpPattern(hat, rest);
  if (keyUp) {
    const body = indent(indent(blocksToLines(keyUp.body, ctx)));
    return [`    when key ${tessString(keyUp.key)} up do`, ...body, '    end', ''];
  }

  const header = eventHeader(hat, ctx);
  if (header) {
    const body = indent(indent(blocksToLines(rest, ctx)));
    return [`    ${header} do`, ...body, '    end', ''];
  }

  // 스레드 맨 앞이라고 다 이벤트(hat) 블록은 아니다 — 엔트리 워크스페이스에
  // 그냥 빼놨을 뿐, 어디에도 연결 안 된 블록 뭉치도 똑같이 "스레드 하나"로
  // 저장된다. 그런 건 실제로 실행된 적이 없으니(엔트리도 안 돌린다) 억지로
  // when 으로 감싸 실행되게 만들지 않고, 내용만 주석으로 그대로 남겨서
  // "연결 안 된 상태"를 그대로 지킨다.
  ctx.warnings.add(`연결되지 않은 블록 뭉치(맨 앞이 '${hat?.type}')를 원본처럼 실행되지 않게 주석으로 남겼습니다.`);
  const raw = blocksToLines(thread, ctx); // 맨 앞도 그냥 평범한 블록으로 취급해서 통째로 옮긴다
  const commented = raw.map((line) => (line.trim() ? `    # ${line}` : ''));
  return [
    '    # [decompile] 아래는 엔트리 원본에서 어디에도 연결돼 있지 않던 블록입니다 (실행되지 않음):',
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

/** 컴파일러가 `when key X up` 을 펼쳐 만드는 감시 스크립트를 되짚어 알아본다 */
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
