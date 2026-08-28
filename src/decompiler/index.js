// ============================================================================
//  .ent(엔트리 작품) -> Tess 소스로 되돌리기
//
//  src/compiler 가 하는 일의 정반대: project.json 의 블록 트리를 걸어 다니며
//  Tess 소스 텍스트를 만든다. 모든 블록을 다 알지는 못하므로, 모르는 블록은
//  `# [decompile] ...` 주석으로 남기고 계속 진행한다 — 하나 때문에 통째로
//  실패하는 것보다, 사람이 나머지를 보고 그 부분만 손보는 편이 낫다.
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

// 엔트리 기본 오브젝트(걷는 엔트리봇 등)의 모양과 소리는 작품 파일 안에 들어 있지
// 않다. project.json 은 엔트리 실행기가 함께 배포하는 파일을
// `./bower_components/entry-js/images/media/entrybot1.svg` 처럼 가리키기만 한다.
// 모양 없이 만든 "새 오브젝트"가 쓰는 `images/_1x1.png` 도 같은 곳에 있으며,
// 폴더 이름은 작품을 만든 엔트리 버전에 따라 entry-js 이거나 entryjs 이다.
// 이 경로를 소스에 그대로 옮기면 가리키는 파일이 없으므로, 다시 컴파일한 작품에는
// 모양이 비어 있게 된다. 그래서 설치된 entryjs(@entrylabs/entry, 실행기와 같은
// 패키지)에서 실제 파일을 꺼내 다른 리소스와 똑같이 assets/ 아래에 담는다.
const BUILTIN_ASSET = /(?:^|\/)bower_components\/[^/]+\/(images\/[^?#]+)$/;

// 그 가운데 _1x1.png 는 모양 없이 만든 "새 오브젝트"에 엔트리가 넣어 두는 1×1 픽셀
// 투명 그림이다. 파일에서 잰 1×1 은 실제 크기가 아니고 project.json 의 dimension
// (예: 960×540)이 실제 크기이므로, 이 그림만은 되돌린 소스에 `size` 를 적어야 한다.
const BLANK_IMAGE = /(?:^|\/)images\/_1x1\.png$/;

/** 엔트리 번들에 들어 있는 기본 리소스의 실제 바이트열. 못 찾으면 null */
function builtinAssetBytes(fileurl, runtimeDir) {
  const match = BUILTIN_ASSET.exec(fileurl ?? '');
  if (!match || !runtimeDir) return null;
  // 다른 사람이 만든 작품에서 온 경로이므로, 패키지 바깥을 가리키는 경로가 섞여
  // 있으면 읽지 않는다.
  if (match[1].split('/').includes('..')) return null;
  const file = path.join(runtimeDir, match[1]);
  return fs.existsSync(file) && fs.statSync(file).isFile() ? fs.readFileSync(file) : null;
}

/**
 * 설치된 entryjs 를 작업 폴더에서 먼저 찾고, 없으면 tess 자신이 설치된 곳에서 찾는다.
 * 다른 폴더에서 `node .../tess/index.js decompile` 로 실행해도 기본 리소스를 꺼낼 수 있다.
 */
function findRuntimeDir() {
  return findLocalRuntime() ?? findLocalRuntime(path.dirname(fileURLToPath(import.meta.url)));
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
  // 선언 묶음과 그 뒤의 코드 사이는 두 줄을 띄운다. 선언은 파일 머리말에 가까워서,
  // 한 줄만 띄우면 바로 아래의 project/scene 블록과 한 덩어리처럼 보인다.
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
//  컨텍스트 준비 — id -> 이름 표들을 미리 다 만들어 둔다
// ---------------------------------------------------------------------------
// 첫 번째 매개변수에 모양·소리 id 가 문자열로 들어 있을 수 있는 블록들이다.
// text/number 는 사람이 id 를 직접 적어 넣은 경우이고, get_pictures/get_sounds 는
// 편집기 목록에서 고른 경우이다. 둘 다 함수 안에서는 id 를 그대로 남겨야 한다.
const ID_HOLDING_BLOCKS = new Set(['text', 'number', 'get_pictures', 'get_sounds']);

/** 블록 트리를 훑으면서, 프로젝트에 실제로 있는 모양·소리 id 와 같은 값을 ctx.forcedIds 에 모은다 */
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
 * 함수 정의 블록(function_create)의 머리 부분을 마디 목록으로 펼친다.
 *
 * 엔트리는 라벨과 매개변수 칸을 `params[1]` 로 이어 붙인 사슬로 저장한다. 라벨이
 * 중간에 끼어들 수도 있고(`스폰 (인수) 체력 (인수)`), 매개변수가 판단 칸
 * (function_field_boolean)일 수도 있다. 예전에는 맨 앞 라벨 뒤의
 * function_field_string 만 세다가 그런 마디를 만나면 멈춰서, 그 뒤의 매개변수를
 * 모두 잃어버렸다.
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
      break; // 알 수 없는 마디가 나오면 거기까지만 읽는다
    }
    node = node.params?.[1];
  }
  return fields;
}

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
    // 장면이 하나뿐이면 objects/이름.tess 로 평평하게, 여러 개면 대부분의 프로젝트가
    // 실제로 장면별로 오브젝트를 나눠 관리하므로 objects/장면이름/이름.tess 로 나눈다.
    multiScene: (project.scenes ?? []).length > 1,
    // 함수 안에 하드코딩된 채로 발견된, 진짜 모양·소리 id 들 (1.4절 참고).
    // objectFragmentLines 가 이 id 를 가진 모양·소리 선언에 `force id "..."` 를 붙인다.
    forcedIds: new Set(),
    // eventLines/resourceExpr 가 "지금 함수 몸통을 옮기는 중인가" 를 보는 플래그 —
    // 함수 안에서는 리터럴 id 를 이름으로 되짚지 않고 그대로 둔다(아래 forcedIds 주석 참고).
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
    // 함수 본문에서 매개변수를 가리키는 블록 타입(stringParam_xxxx / booleanParam_xxxx)
    // -> 그 매개변수의 Tess 이름
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

    // 모양·소리 이름은 오브젝트 안에서만 겹치지 않으면 된다. 다른 오브젝트에도 같은
    // 이름이 있을 수 있으므로, 리소스 파일을 저장할 때 쓸 오브젝트 정보를 같이 담아 둔다.
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
    let fields = [];
    try {
      fields = readFunctionFields(JSON.parse(fn.content ?? '[]')?.[0]?.[0]);
    } catch { /* 머리를 못 읽어도 id 로 대체해서 계속 진행한다 */ }

    // 맨 앞 라벨만 함수 이름이 된다 (src/function-params.js 참고)
    const label = fields[0]?.kind === 'label' ? fields[0].text : fn.id;
    const identifier = safeIdentifier(label, usedNames, 'func');

    const params = [];
    const paramNames = new Set();
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

    ctx.functionsById.set(fn.id, { name: identifier, params, displayLabel: label });
  }

  // 엔트리에서 함수는 전역이라 여러 오브젝트가 함께 부를 수 있지만, 함수 안에 적힌
  // 모양·소리 값은 결국 특정 오브젝트 하나의 id 를 가리킨다. 편집기 목록에서 고른
  // get_pictures/get_sounds 블록이든, "개인 함수"를 흉내 내려고 id 를 문자열로 적어
  // 넣던 예전 방식이든 마찬가지다. 엔트리의 모양·소리 바꾸기 블록은 값을 1) id,
  // 2) 이름, 3) 등록 순번 차례로 찾으므로 id 만 맞으면 어느 오브젝트가 불러도 그
  // 모양·소리를 가리킨다.
  //
  // 오브젝트 자기 스크립트 안의 id 는 resourceExpr 가 그 오브젝트의 이름으로 안전하게
  // 되돌린다. 하지만 함수 안에서는 그 이름이 함수를 부르는 다른 오브젝트에도 있다는
  // 보장이 없다. 그래서 함수 안에서 찾은 id 는 이름으로 바꾸지 않고
  // (resourceExpr 의 ctx.inFunction 분기), 대신 그 모양·소리 선언에 `force id` 를
  // 붙여서 다시 컴파일해도 같은 id 가 나오게 한다(1.4절 참고).
  for (const fn of project.functions ?? []) {
    try { collectHardcodedIds(JSON.parse(fn.content ?? '[]'), ctx); } catch { /* 못 읽으면 건너뛴다 */ }
  }

  // --- 리소스(모양 · 소리) 실제 파일 -----------------------------------------------
  //
  // 모양·소리 이름은 오브젝트마다 따로 붙으므로 서로 다른 오브젝트에 같은 이름
  // ("새그림" 처럼 엔트리가 자동으로 붙여 주는 이름은 특히 자주 겹친다)이 있을 수
  // 있다. 그 이름을 그대로 파일 이름으로 쓰면 나중에 저장한 파일이 앞의 파일을
  // 덮어써서 모양 하나만 남는다. 그래서 두 가지로 나눈다.
  //   1. 파일 이름을 `오브젝트이름_모양이름` 으로 만든다.
  //   2. 장면이 여러 개면 assets/image/<장면이름>/ 처럼 장면별 폴더에 나눠 담는다.
  //      조각 파일(objects/<장면이름>/...)을 나누는 기준과 같다.
  // 그래도 경로가 겹치면 뒤에 번호를 붙여서 반드시 다른 파일이 되게 한다.
  const assetTargets = new Map(); // fileurl -> 저장한 상대 경로
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
    // 같은 파일을 여러 모양이 함께 쓰면 한 번만 저장하고 같은 경로를 돌려준다.
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
  // 엔트리에서 참·거짓을 값으로 쓰면 "TRUE"/"FALSE" 가 된다(compiler/expression.js 참고).
  // 예전 작품에는 소문자로 적혀 있기도 하므로 둘 다 받아들인다.
  if (text === 'TRUE' || text === 'true') return 'true';
  if (text === 'FALSE' || text === 'false') return 'false';
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
function useObjectLine(object, ctx, sceneIdentifier) {
  const info = ctx.objectsById.get(object.id);
  const isText = object.objectType === 'textBox';
  const dir = ctx.multiScene ? `objects/${sceneIdentifier}` : 'objects';
  const relativePath = `${dir}/${info.identifier}.tess`;
  const fragment = objectFragmentLines(object, ctx, isText).join('\n').trimEnd();
  ctx.collectedAssets.push({ path: relativePath, data: Buffer.from(`${fragment}\n`, 'utf-8') });
  return [`  ${isText ? 'usetext' : 'useobject'} ${tessString(relativePath)}`];
}

/** 조각 파일 하나의 내용 — `object`/`text` 로 감싸지 않은, 들여쓰기 0 부터 시작하는 줄들 */
function objectFragmentLines(object, ctx, isText) {
  const info = ctx.objectsById.get(object.id);
  const lines = [];

  if (info.identifier !== info.displayName) lines.push(`name ${tessString(info.displayName)}`);

  for (const picture of object.sprite?.pictures ?? []) {
    const picInfo = ctx.picturesById.get(picture.id);
    if (!picInfo) continue;
    const isDefault = object.selectedPictureId === picture.id;
    // 크기는 적지 않는 것이 기본이다. 컴파일러가 그림 파일에서 크기를 직접 읽으므로,
    // 적어 두면 그림을 바꿀 때마다 숫자까지 함께 고쳐야 한다. 파일이 없을 때와,
    // 파일에서 잰 크기가 실제 크기가 아닌 1×1 빈 그림일 때만 적는다.
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

  // 속성과 변수 선언 묶음, 그리고 그 뒤의 when 블록 사이도 main.tess 와 똑같이 두 줄 띄운다
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
    // 컴파일러의 기본값(src/compiler/index.js buildObject)과 같을 때는 생략한다
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
function eventLines(thread, ctx, indentLevel) {
  if (!thread?.length) return [];
  const [hat, ...rest] = thread;
  const pad = '  '.repeat(indentLevel);
  // 본문은 머리글(when ... do)보다 항상 한 단 더 들여쓴다. 조각 파일에서는 머리글이
  // 0단이라, indentLevel 만큼만 들여쓰던 예전 코드는 본문을 전혀 들여쓰지 않았다.
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

  // 스레드 맨 앞이라고 다 이벤트(hat) 블록은 아니다 — 엔트리 워크스페이스에
  // 그냥 빼놨을 뿐, 어디에도 연결 안 된 블록 뭉치도 똑같이 "스레드 하나"로
  // 저장된다. 그런 건 실제로 실행된 적이 없으니(엔트리도 안 돌린다) 억지로
  // when 으로 감싸 실행되게 만들지 않고, 내용만 주석으로 그대로 남겨서
  // "연결 안 된 상태"를 그대로 지킨다.
  ctx.warnings.add(`연결되지 않은 블록 뭉치(맨 앞이 '${hat?.type}')를 원본처럼 실행되지 않게 주석으로 남겼습니다.`);
  const raw = blocksToLines(thread, ctx); // 맨 앞도 그냥 평범한 블록으로 취급해서 통째로 옮긴다
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
