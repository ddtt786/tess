// ============================================================================
//  Tess -> 엔트리 프로젝트(project.json) 컴파일러
//
//  단계
//   1. use 해석 + 파싱          (include.ts, parse.ts)
//   2. 시맨틱 검증               (validate.ts)
//   3. 심볼 수집 — 장면 · 오브젝트 · 변수 · 신호 · 함수
//   4. 스크립트 컴파일           (statement.ts, expression.ts)
//   5. 엔트리 프로젝트 조립
// ============================================================================
import path from 'node:path';
import { Context } from './context.ts';
import { loadProgram, createCompileCache } from './include.ts';
import { buildCommentMap } from './comments.ts';
import { makeAsset } from './assets.ts';
import { compileStatements, compileStatement } from './statement.ts';
import { compileValue, BOOLEAN_TEXT } from './expression.ts';
import { KEY_CODES, keyCodeOf } from '@tess/core';
import { didYouMean } from '@tess/core';
import { validate } from '@tess/parser';
import { isAutoParamName } from '@tess/core';
import type {
  AssignNode, CostumeNode, EventNode, FunctionDeclNode, Expr, ListDeclNode, Node, ObjectNode,
  ProgramNode, ReturnNode, SceneMember, SoundNode, Stmt, TableDeclNode,
  TopLevelItem, VarDeclNode,
} from '@tess/parser';
import type {
  CompiledFunction, CompiledObject, CompileDiagnostic, CompileOptions,
  CompileResult, EntryBlock, EntryEntity, EntryObject, EntryParam, EntryProject,
  EntryScene, EntryTable, EntryVariable, FunctionScope, PhaseTiming,
} from './types.ts';

/** A node reached by the generic walk, which reads fields it cannot name ahead. */
type AnyNode = Record<string, unknown>;

export { createCompileCache };

const DEFAULT_SCENE_NAME = '장면 1';
// 엔트리 글상자의 실제 기본 글씨체는 CSS font-family 이름 'Nanum Gothic'이다(entryjs
// src/class/entity.js). 한글 이름 '나눔고딕'을 그대로 쓰면 그 이름의 @font-face 가
// 없어서 브라우저가 아무 특징 없는 기본 글꼴로 대체해 버린다.
const DEFAULT_FONT = 'Nanum Gothic';
// 붓 속성(draw_color 등)은 project.json 에 "기본값" 자리가 없다 — 엔트리는 오브젝트를
// 만들 때마다 항상 빨간 붓(#ff0000, 두께 1)으로 시작한다(entryjs Entry.setBasicBrush).
// 그래서 오브젝트 선언에 이 값들을 적으면, 컴파일러가 `when start` 스크립트를 만들어
// 넣어서 그 값을 제일 먼저 정하게 한다.
const BRUSH_DEFAULT_PROPERTIES = ['draw_color', 'fill_color', 'draw_width', 'draw_alpha'];

/**
 * Tess 소스를 엔트리 프로젝트 객체로 컴파일한다.
 *
 * 에러가 있으면 `project` 는 null 이다. `force: true` 면 에러가 난 문장만 빠진 작품을
 * 그대로 돌려준다 (`ok` 는 여전히 false).
 *
 * With a `cache` from createCompileCache, unchanged files are not re-parsed.
 *
 */
export function compileProject(source: string, options: CompileOptions = {}): CompileResult {
  const filePath = options.path ?? '<input>';
  const timer = createTimer(options.onPhase);
  const loaded = loadProgram({
    source, path: filePath, readFile: options.readFile, cache: options.cache,
  });
  timer.mark('불러오기 · 파싱');
  if (!loaded.ast) {
    return {
      ok: false,
      project: null,
      errors: loaded.errors,
      warnings: loaded.warnings,
      assets: [],
      timings: timer.timings,
    };
  }

  const semantic = validate(loaded.ast, source, loaded.sources);
  timer.mark('의미 검증');
  const comments = buildCommentMap(loaded.ast, loaded.sources);
  timer.mark('주석 모으기');
  const ctx = new Context(source, {
    ...options,
    sources: loaded.sources,
    comments,
    assetDirs: options.assetDirs ?? [path.dirname(path.resolve(filePath))],
  });
  // Include errors (a fragment that will not parse, a `use` path that is not
  // there) only reach the caller through here — the top-level file still parsed,
  // so `loaded.ast` is set and the early return above does not fire. Without
  // this the object is dropped and the build reports success with nothing in it.
  ctx.errors.push(...loaded.errors, ...semantic.errors);
  ctx.warnings.push(...loaded.warnings, ...semantic.warnings);

  const program = loaded.ast;
  collectScenes(program, ctx);
  collectGlobals(program, ctx);
  // 모양·소리 파일을 실제로 읽어 크기와 길이를 재는 것이 여기다.
  collectObjects(program, ctx);
  collectFunctions(program, ctx);
  collectMessages(program, ctx);
  timer.mark('심볼 · 리소스 수집');

  compileFunctions(ctx);
  compileObjects(ctx);
  timer.mark('스크립트 컴파일');

  const project = assemble(program, ctx, options);
  timer.mark('작품 조립');

  const ok = ctx.errors.length === 0;
  return {
    ok,
    project: ok || options.force ? project : null,
    errors: ctx.errors,
    warnings: withoutDuplicates(ctx.warnings, ctx.errors),
    assets: ctx.assetFiles,
    sourceMap: ctx.sourceMap,
    timings: timer.timings,
  };
}

/** 진단 하나가 가리키는 자리 */
const spotOf = (item: CompileDiagnostic) => `${item.file ?? ''}:${item.offset}`;

/**
 * 컴파일러가 이미 에러를 낸 자리의 검증 경고는 접는다.
 *
 * 검증기는 컴파일 전에 이름을 훑어서 "선언되지 않은 이름" 을 미리 알려 주는데,
 * 컴파일까지 갔으면 같은 자리에서 더 자세한 에러가 이미 나온다. 둘 다 내면 같은
 * 오타를 두 번 읽게 된다.
 */
function withoutDuplicates(warnings: CompileDiagnostic[], errors: CompileDiagnostic[]): CompileDiagnostic[] {
  if (errors.length === 0) return warnings;
  const spots = new Set(errors.map(spotOf));
  return warnings.filter((warning) => !spots.has(spotOf(warning)));
}

/**
 * 단계마다 걸린 시간을 잰다.
 *
 * 끝나는 즉시 `onPhase` 로 알려 준다 — CLI 는 그걸 그때그때 한 줄씩 찍어서, 큰
 * 작품을 컴파일하는 동안에도 어디까지 갔는지 보이게 한다.
 */
function createTimer(onPhase?: (phase: PhaseTiming) => void) {
  const timings: PhaseTiming[] = [];
  let last = performance.now();
  return {
    timings,
    mark(label: string) {
      const now = performance.now();
      const phase = { label, ms: now - last };
      timings.push(phase);
      onPhase?.(phase);
      last = now;
    },
  };
}

// ---------------------------------------------------------------------------
//  1. 장면
// ---------------------------------------------------------------------------
function collectScenes(program: ProgramNode, ctx: Context) {
  for (const item of program.body) {
    if (item.type !== 'Scene') continue;
    if (ctx.sceneByName.has(item.name)) {
      ctx.error(item, `'${item.name}' 장면이 이미 있습니다.`);
      continue;
    }
    // `scene "id":` 의 "id" 는 jump 등에서 쓰는 식별자다. 본문에 `name "..."` 이
    // 있으면 컴파일된 작품에는 그 이름이 대신 찍힌다(오브젝트의 name 속성과 동일).
    const scene = { id: ctx.newId(), name: sceneDisplayName(item, ctx) ?? item.name };
    ctx.scenes.push(scene);
    ctx.sceneByName.set(item.name, scene);
  }

  // scene 없이 object 만 있는 파일도 컴파일할 수 있게 기본 장면을 만든다
  const hasLooseObject = program.body.some((item) => item.type === 'Object');
  if (ctx.scenes.length === 0 || (hasLooseObject && ctx.scenes.length === 0)) {
    const scene = { id: ctx.newId(), name: DEFAULT_SCENE_NAME };
    ctx.scenes.unshift(scene);
    ctx.sceneByName.set(scene.name, scene);
  }
}

/** 장면 본문에 `name "..."` 이 있으면 그 문자열을, 없으면 null 을 돌려준다 */
function sceneDisplayName(item: { body: SceneMember[] }, ctx: Context): string | null {
  let value: Expr | null = null;
  for (const member of item.body) {
    if (member.type === 'Property' && member.name === 'name') value = member.value;
  }
  if (value === null) return null;
  if (value.type !== 'String') {
    ctx.error(value, `장면 이름(name)에는 문자열만 쓸 수 있습니다.`);
    return null;
  }
  return value.value;
}

// ---------------------------------------------------------------------------
//  2. 전역 변수 · 리스트
// ---------------------------------------------------------------------------
function collectGlobals(program: ProgramNode, ctx: Context) {
  for (const item of program.body) {
    if (item.type === 'VarDecl' || item.type === 'ListDecl') {
      const entry = makeVariable(item, ctx, null);
      if (entry) {
        ctx.variables.push(entry);
        ctx.globals.set(item.name, entry);
      }
    }
    if (item.type === 'TableDecl') collectTable(item, ctx);
  }
}

/** table 선언 -> 엔트리 project.tables 항목 */
function collectTable(node: TableDeclNode, ctx: Context): EntryTable | null {
  if (ctx.tableByName.has(node.name)) {
    return ctx.error(node, `'${node.name}' 테이블이 이미 있습니다.`);
  }
  const cells = (row: Expr[]) => {
    const values = row.map((cell) => constantOf(cell, ctx));
    return values.some((value) => value === null) ? null : values.map((value) => String(value));
  };

  const fields = cells(node.columns);
  if (!fields) return null;
  const data = [];
  for (const row of node.rows) {
    const values = cells(row);
    if (!values) return null;
    if (values.length !== fields.length) {
      return ctx.error(node, `테이블 '${node.name}' 의 줄은 열 개수(${fields.length})와 같아야 합니다. 이 줄은 ${values.length}개입니다.`);
    }
    data.push(values);
  }

  const entry = {
    id: ctx.newId(),
    name: node.displayName ?? node.name,
    object: null,
    fields,
    data,
    chart: [],
  };
  ctx.tables.push(entry);
  ctx.tableByName.set(node.name, entry);
  return entry;
}

/** var/list 선언 -> 엔트리 variables 항목 */
function makeVariable(
  node: VarDeclNode | ListDeclNode,
  ctx: Context,
  objectId: string | null,
): EntryVariable | null {
  // Entry offers cloud/real-time storage on global variables only.
  if (node.scope && objectId) {
    ctx.error(node, `'${node.scope}' 는 오브젝트 안의 변수·리스트에는 쓸 수 없습니다. 전역 선언에만 붙일 수 있습니다.`);
  }
  const base: EntryVariable = {
    name: node.displayName ?? node.name,
    id: ctx.newId(),
    visible: false,
    value: 0,
    variableType: 'variable',
    isCloud: node.scope === 'shared',
    isRealTime: node.scope === 'realtime',
    cloudDate: false,
    object: objectId,
    x: 0,
    y: 0,
  };

  if (node.type === 'ListDecl') {
    const elements = node.value.type === 'ListLiteral' ? node.value.elements : [];
    const items = elements.map((element) => constantOf(element, ctx));
    if (items.some((item) => item === null)) return null;
    return {
      ...base,
      value: 0,
      variableType: 'list',
      array: (items as Array<string | number>).map((data) => ({ data })),
      width: 100,
      height: 120,
    };
  }

  const value = constantOf(node.value, ctx);
  if (value === null) return null;
  return { ...base, value };
}

/** 선언 초기값으로 쓸 수 있는 상수인지 확인하고 원시값으로 바꾼다 */
function constantOf(node: Expr, ctx: Context): string | number | null {
  switch (node.type) {
    case 'Number': return node.value;
    case 'String': return node.value;
    // 초기값도 대입할 때와 같은 글자를 쓴다. 엔트리에서 true 는 "TRUE" 이다(expression.ts 참고).
    case 'Boolean': return BOOLEAN_TEXT[String(node.value)];
    case 'Color': return node.value;
    case 'Transparent': return 'transparent';
    case 'Unary':
      if (node.operator === '-' && node.argument.type === 'Number') return -node.argument.value;
      break;
    default: break;
  }
  return ctx.error(node, '변수·리스트의 초기값은 상수여야 합니다. 계산이 필요하면 when start 안에서 대입하세요.');
}

// ---------------------------------------------------------------------------
//  3. 오브젝트
// ---------------------------------------------------------------------------
function collectObjects(program: ProgramNode, ctx: Context) {
  const register = (node: ObjectNode, scene: EntryScene) => {
    if (ctx.objectByName.has(node.name)) {
      ctx.error(node, `'${node.name}' 오브젝트가 이미 있습니다.`);
      return;
    }
    const object = {
      id: ctx.newId(),
      key: node.name,
      name: node.name,
      kind: node.kind,
      scene,
      node,
      pictures: new Map(),
      sounds: new Map(),
      locals: new Map(),
      defaultPicture: null,
      properties: new Map(),
      boxSize: null,
      center: null,
      script: [],
    };
    ctx.objects.push(object);
    ctx.objectByName.set(node.name, object);
  };

  for (const item of program.body) {
    if (item.type === 'Object') register(item, ctx.scenes[0]!);
    if (item.type === 'Scene') {
      const scene = ctx.sceneByName.get(item.name);
      for (const member of item.body) {
        if (member.type === 'Object') register(member, scene!);
      }
    }
  }

  for (const object of ctx.objects) collectObjectMembers(object, ctx);
}

/**
 * 모양/소리의 엔트리 id — `force id "..."` 를 안 적었으면 평소처럼 시드로 새로 뽑고,
 * 적었으면 그 문자열을 그대로 쓴다(addendum, SPEC-ADDENDUM.md 참고). `force id` 는
 * 예전에 함수 안에 특정 오브젝트의 모양·소리 id 를 그대로 박아 넣던 작품을 되돌릴 때,
 * 되돌리기가 그 id 를 다시 그대로 배정해 살리는 용도다 — 자동 생성 id 와 겹치면
 * project.json 안에서 서로 다른 리소스가 같은 id 를 갖게 되어 엔트리가 엉뚱한 것을
 * 가리키게 되므로, 이미 쓰인 id 와 겹치면 컴파일 에러로 막는다.
 */
function resourceId(member: CostumeNode | SoundNode, ctx: Context): string | null {
  if (!member.forceId) return ctx.newId();
  if (ctx.newId.has(member.forceId)) {
    return ctx.error(member, `force id "${member.forceId}" 는 이미 다른 모양·소리·오브젝트가 쓰고 있습니다.`);
  }
  ctx.newId.reserve(member.forceId);
  ctx.forcedResourceIds.add(member.forceId);
  return member.forceId;
}

function collectObjectMembers(object: CompiledObject, ctx: Context) {
  ctx.object = object;

  for (const member of object.node.body) {
    switch (member.type) {
      case 'Costume': {
        const asset = makeAsset('image', {
          id: resourceId(member, ctx) ?? ctx.newId(), file: member.file, name: member.displayName ?? member.id,
          width: member.width, height: member.height,
        }, ctx, member);
        object.pictures.set(member.id, asset);
        if (member.isDefault || !object.defaultPicture) object.defaultPicture = asset;
        break;
      }
      case 'Sound': {
        const asset = makeAsset('sound', {
          id: resourceId(member, ctx) ?? ctx.newId(),
          file: member.file,
          name: member.displayName ?? member.id,
          duration: member.duration,
        }, ctx, member);
        object.sounds.set(member.id, asset);
        break;
      }
      case 'Property':
        object.properties.set(member.name, member.value);
        break;
      case 'BoxSize':
        object.boxSize = member;
        break;
      case 'Center':
        object.center = member;
        break;
      case 'VarDecl': case 'ListDecl': {
        const entry = makeVariable(member, ctx, object.id);
        if (entry) {
          ctx.variables.push(entry);
          object.locals.set(member.name, entry);
        }
        break;
      }
      default: break;
    }
  }

  // A costume/sound whose Entry name is not a Tess identifier answers to both
  // spellings, because Entry resolves a name written into a block against the
  // name the work carries, not the identifier the source uses.
  for (const member of object.node.body) {
    if (member.type !== 'Costume' && member.type !== 'Sound') continue;
    if (!member.displayName || member.displayName === member.id) continue;
    const shelf = member.type === 'Costume' ? object.pictures : object.sounds;
    if (!shelf.has(member.displayName)) shelf.set(member.displayName, shelf.get(member.id)!);
  }

  // 이벤트 핸들러 안에서 처음 나오는 var/list 도 이 오브젝트의 변수로 등록한다
  for (const member of object.node.body) {
    if (member.type === 'Event') collectHandlerVariables(member.body, object, ctx);
  }
  ctx.object = null;
}

function collectHandlerVariables(statements: Stmt[], object: CompiledObject, ctx: Context) {
  for (const statement of statements) {
    if (statement.type === 'VarDecl' || statement.type === 'ListDecl') {
      if (!object.locals.has(statement.name) && !ctx.globals.has(statement.name)) {
        const entry = makeVariable(
          statement.type === 'VarDecl'
            ? { ...statement, value: { type: 'Number', value: 0, loc: statement.loc } }
            : statement,
          ctx,
          object.id,
        );
        if (entry) {
          ctx.variables.push(entry);
          object.locals.set(statement.name, entry);
        }
      }
    }
    const fields = statement as unknown as AnyNode;
    for (const key of ['consequent', 'alternate', 'body']) {
      const block = fields[key];
      if (Array.isArray(block)) collectHandlerVariables(block as Stmt[], object, ctx);
    }
  }
}

// ---------------------------------------------------------------------------
//  4. 함수
// ---------------------------------------------------------------------------
function collectFunctions(program: ProgramNode, ctx: Context) {
  const register = (node: FunctionDeclNode, owner: string | null) => {
    if (ctx.functionByName.has(node.name)) {
      ctx.error(node, `'${node.name}' 함수가 이미 있습니다. 엔트리 함수는 작품 전체에서 이름이 하나여야 합니다.`);
      return;
    }
    const returns = findReturns(node.body);
    const tail = node.body[node.body.length - 1];
    const isTailReturn = tail?.type === 'Return' && returns.length === 1;

    if (returns.length > 0 && !isTailReturn) {
      ctx.error(returns[0], '엔트리 함수는 중간에서 값을 돌려줄 수 없습니다. return 은 함수의 마지막 문장에만 쓸 수 있습니다.');
    }

    // `이름?` 으로 적은 매개변수는 엔트리에서도 판단 칸이 된다 (SPEC-ADDENDUM.md 4.6)
    const booleanParams = new Set(node.booleanParams ?? []);
    const fn = {
      id: ctx.newId(),
      name: node.name,
      node,
      owner,
      params: node.params,
      booleanParams,
      paramTypes: new Map(node.params.map((param) => [
        param,
        `${booleanParams.has(param) ? 'booleanParam' : 'stringParam'}_${ctx.newId()}`,
      ])),
      isValue: isTailReturn,
      localVariables: [],
    };
    ctx.functions.push(fn);
    ctx.functionByName.set(node.name, fn);
  };

  for (const item of program.body) {
    if (item.type === 'FunctionDecl') register(item, null);
    if (item.type === 'Object') {
      for (const member of item.body) if (member.type === 'FunctionDecl') register(member, item.name);
    }
    if (item.type === 'Scene') {
      for (const object of item.body) {
        if (object.type !== 'Object') continue;
        for (const member of object.body) if (member.type === 'FunctionDecl') register(member, object.name);
      }
    }
  }
}

function findReturns(statements: Stmt[], found: ReturnNode[] = []): ReturnNode[] {
  for (const statement of statements) {
    if (statement.type === 'Return') found.push(statement);
    const fields = statement as unknown as AnyNode;
    for (const key of ['consequent', 'alternate', 'body']) {
      const block = fields[key];
      if (Array.isArray(block)) findReturns(block as Stmt[], found);
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
//  5. 신호
// ---------------------------------------------------------------------------
function collectMessages(node: unknown, ctx: Context) {
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach((child) => collectMessages(child, ctx));
    return;
  }
  const item = node as AnyNode;
  if (item.type === 'Send' && (item.signal as AnyNode | undefined)?.type === 'String') {
    ctx.messageId((item.signal as { value: string }).value);
  }
  if (item.type === 'Event' && item.event === 'signal') ctx.messageId(item.signal as string);
  for (const [key, value] of Object.entries(item)) {
    if (key !== 'loc') collectMessages(value, ctx);
  }
}

// ---------------------------------------------------------------------------
//  6. 함수 본문 컴파일
// ---------------------------------------------------------------------------
function compileFunctions(ctx: Context) {
  for (const fn of ctx.functions) {
    if (fn.generated) continue; // 컴파일러가 이미 완성해 둔 런타임 함수
    ctx.object = (fn.owner ? ctx.objectByName.get(fn.owner) : null) ?? null;
    ctx.locals = ctx.object?.locals ?? new Map();
    ctx.funcScope = {
      name: fn.name,
      params: fn.paramTypes,
      localVars: new Map(),
    };

    // 함수 안에서 선언한 var 는 엔트리 함수의 지역 변수로
    const declared = fn.node!;
    collectFunctionLocals(declared.body, ctx.funcScope, ctx, fn);

    const body = fn.isValue ? declared.body.slice(0, -1) : declared.body;
    const statements = compileStatements(body, ctx);
    const tail = declared.body[declared.body.length - 1] as ReturnNode | undefined;
    const returnValue = fn.isValue && tail ? compileValue(tail.value, ctx) : null;

    const field = buildFunctionFields(fn, ctx);
    const params = fn.isValue ? [field, null, null, returnValue] : [field, null];
    const create = ctx.block(fn.isValue ? 'function_create_value' : 'function_create', params, [statements]);
    create.x = 50;
    create.y = 30;

    fn.localVariables = [...ctx.funcScope.localVars].map(([name, id]) => ({ id, name, value: 0 }));
    fn.content = [[create]];
    fn.type = fn.isValue ? 'value' : 'normal';

    ctx.funcScope = null;
    ctx.locals = new Map();
    ctx.object = null;
  }
}

function collectFunctionLocals(
  statements: Stmt[],
  scope: FunctionScope,
  ctx: Context,
  fn: CompiledFunction,
) {
  for (const statement of statements) {
    if (statement.type === 'VarDecl' && !scope.localVars.has(statement.name)) {
      scope.localVars.set(statement.name, `${fn.id}_${ctx.newId()}`);
    }
    if (statement.type === 'ListDecl') {
      ctx.error(statement, '함수 안에서는 리스트를 선언할 수 없습니다. 전역 리스트를 쓰세요.');
    }
    const fields = statement as unknown as AnyNode;
    for (const key of ['consequent', 'alternate', 'body']) {
      const block = fields[key];
      if (Array.isArray(block)) collectFunctionLocals(block as Stmt[], scope, ctx, fn);
    }
  }
}

/**
 * 함수 머리(라벨과 매개변수 칸의 사슬)를 만든다. 자동 이름(a, b, c …)은 라벨 없이,
 * 그 밖의 이름은 라벨을 달고 나간다 — 되돌리기의 반대다 (src/function-params.ts).
 */
function buildFunctionFields(fn: CompiledFunction, ctx: Context): EntryBlock {
  let next: EntryParam = null;
  for (let i = fn.params.length - 1; i >= 0; i -= 1) {
    const name = fn.params[i]!;
    next = fn.booleanParams?.has(name)
      ? ctx.block('function_field_boolean', [ctx.block(fn.paramTypes.get(name)!, [null]), next])
      : ctx.block('function_field_string', [ctx.block(fn.paramTypes.get(name)!, []), next]);
    if (!isAutoParamName(name, i)) next = ctx.block('function_field_label', [name, next]);
  }
  return ctx.block('function_field_label', [fn.name, next]);
}

// ---------------------------------------------------------------------------
//  7. 오브젝트 스크립트 컴파일
// ---------------------------------------------------------------------------
function compileObjects(ctx: Context) {
  for (const object of ctx.objects) {
    ctx.object = object;
    ctx.locals = object.locals;
    ctx.funcScope = null;

    let row = 0;
    const defaults = compileBrushDefaults(object, ctx);
    if (defaults) {
      defaults[0].x = 50;
      defaults[0].y = 30;
      row += 1;
      object.script.push(defaults);
    }
    for (const member of object.node.body) {
      if (member.type !== 'Event') continue;
      const thread = compileEvent(member, ctx);
      if (!thread) continue;
      ctx.applyComment(member, thread[0]);
      thread[0].x = 50;
      thread[0].y = 30 + row * 260;
      row += 1;
      object.script.push(thread);
    }
    ctx.object = null;
    ctx.locals = new Map();
  }
}

function compileEvent(event: EventNode, ctx: Context): EntryBlock[] | null {
  const body = () => compileStatements(event.body, ctx);

  switch (event.event) {
    case 'start': return [ctx.block('when_run_button_click', [null]), ...body()];
    case 'scene_start': return [ctx.block('when_scene_start', [null]), ...body()];
    case 'click': return [ctx.block('when_object_click', [null]), ...body()];
    case 'click_up': return [ctx.block('when_object_click_canceled', [null]), ...body()];
    case 'stage_click': return [ctx.block('mouse_clicked', [null]), ...body()];
    case 'stage_click_up': return [ctx.block('mouse_click_cancled', [null]), ...body()];
    case 'cloned': return [ctx.block('when_clone_start', [null]), ...body()];

    case 'signal':
      return [ctx.block('when_message_cast', [null, ctx.messageId(event.signal!)]), ...body()];

    case 'key': {
      const code = keyCodeOf(event.key);
      if (!code) return ctx.error(event, `알 수 없는 키 이름 "${event.key}" 입니다.${didYouMean(event.key!, Object.keys(KEY_CODES))}`);
      return [ctx.block('when_some_key_pressed', [null, code]), ...body()];
    }

    case 'key_up': {
      // 엔트리에는 "키를 뗐을 때" 이벤트가 없어서 감시 스크립트로 바꾼다.
      //   시작하기 -> 계속 반복: 키가 눌릴 때까지 기다림 -> 떼질 때까지 기다림 -> 본문
      // (SPEC-ADDENDUM 4 에 적어 둔 정해진 변환이라 따로 알리지 않는다)
      const code = keyCodeOf(event.key);
      if (!code) return ctx.error(event, `알 수 없는 키 이름 "${event.key}" 입니다.${didYouMean(event.key!, Object.keys(KEY_CODES))}`);
      const pressed = () => ctx.block('is_press_some_key', [code, null]);
      const loop = ctx.block('repeat_inf', [null, null], [[
        ctx.block('wait_until_true', [pressed(), null]),
        ctx.block('wait_until_true', [ctx.block('boolean_not', [null, pressed(), null]), null]),
        ...body(),
      ]]);
      return [ctx.block('when_run_button_click', [null]), loop];
    }

    default:
      ctx.error(event, `'${event.event}' 이벤트는 엔트리 블록으로 바꿀 수 없습니다.`);
      return null;
  }
}

/**
 * draw_color 등을 오브젝트 선언 맨 위에 썼으면, `when start` 스크립트를 만들어서
 * 그 값을 제일 먼저 정하게 한다 (BRUSH_DEFAULT_PROPERTIES 선언부 참고).
 */
function compileBrushDefaults(object: CompiledObject, ctx: Context): EntryBlock[] | null {
  const present = BRUSH_DEFAULT_PROPERTIES.filter((name) => object.properties.has(name));
  if (present.length === 0) return null;

  const blocks = [ctx.block('when_run_button_click', [null])];
  for (const name of present) {
    const value = object.properties.get(name)!;
    const assign: AssignNode = {
      type: 'Assign',
      operator: '=',
      target: { type: 'Identifier', name, loc: value.loc! },
      value,
      loc: value.loc!,
    };
    blocks.push(...compileStatement(assign, ctx));
  }
  return blocks;
}

// ---------------------------------------------------------------------------
//  8. 프로젝트 조립
// ---------------------------------------------------------------------------
function assemble(program: ProgramNode, ctx: Context, options: CompileOptions): EntryProject {
  const projectDecl = program.body.find((item) => item.type === 'Project');
  const fields = new Map((projectDecl?.fields ?? []).map((field) => [field.field, field.value]));

  // The grammar fixes each field's literal type: title and description take a
  // string, fps a number.
  const textField = (name: string) => {
    const value = fields.get(name);
    return value?.type === 'String' ? value.value : undefined;
  };
  const numberField = (name: string) => {
    const value = fields.get(name);
    return value?.type === 'Number' ? value.value : undefined;
  };

  const objects = ctx.objects.map((object) => buildObject(object, ctx));
  addSystemVariables(ctx);

  const project: EntryProject = {
    objects,
    scenes: ctx.scenes.map(({ id, name }) => ({ id, name })),
    variables: ctx.variables,
    messages: ctx.messages,
    functions: ctx.functions.map((fn) => ({
      id: fn.id,
      type: fn.type ?? 'normal',
      localVariables: fn.localVariables ?? [],
      useLocalVariables: (fn.localVariables ?? []).length > 0,
      content: JSON.stringify(fn.content ?? []),
    })),
    tables: ctx.tables,
    speed: numberField('fps') ?? 60,
    interface: { menuWidth: 280, canvasWidth: 480, object: objects[0]?.id ?? null },
    expansionBlocks: [...ctx.expansionBlocks],
    // read / tts 문을 쓰면 엔트리가 '읽어주기(TTS)' 확장 블록을 실행할 수 있게 켠다
    // (entryjs 는 project.aiUtilizeBlocks 에 이름이 있어야 Entry.AI_UTILIZE_BLOCK[type].init() 을 부른다)
    aiUtilizeBlocks: ctx.usesTts ? ['tts'] : [],
    hardwareLiteBlocks: [],
    externalModules: [],
    externalModulesLite: [],
    name: options.name ?? textField('title') ?? 'Tess 작품',
    isPracticalCourse: false,
  };

  const description = textField('description');
  if (description) project.description = description;
  return project;
}

function buildObject(object: CompiledObject, ctx: Context): EntryObject {
  const properties = object.properties;
  const number = <T extends number | null>(name: string, fallback: T): number | T => {
    const value = properties.get(name);
    if (value === undefined) return fallback;
    if (value.type === 'Number') return value.value;
    if (value.type === 'Unary' && value.operator === '-' && value.argument.type === 'Number') {
      return -value.argument.value;
    }
    ctx.error(value, `속성 '${name}' 에는 숫자만 쓸 수 있습니다.`);
    return fallback;
  };
  const string = (name: string, fallback: string) => {
    const value = properties.get(name);
    if (value === undefined) return fallback;
    if (value.type === 'String') return value.value;
    if (value.type === 'Color') return value.value;
    if (value.type === 'Transparent') return 'transparent';
    if (value.type === 'Keyword' || value.type === 'Identifier') return value.name;
    ctx.error(value, `속성 '${name}' 에는 문자열만 쓸 수 있습니다.`);
    return fallback;
  };
  const boolean = (name: string, fallback: boolean) => {
    const value = properties.get(name);
    if (value === undefined) return fallback;
    if (value.type === 'Boolean') return value.value;
    ctx.error(value, `속성 '${name}' 에는 true 또는 false 만 쓸 수 있습니다.`);
    return fallback;
  };

  const isText = object.kind === 'text';
  const picture = object.defaultPicture;
  const size = number('size', null);
  const scaleX = number('scale_x', size ?? 100) / 100;
  const scaleY = number('scale_y', size ?? 100) / 100;

  const entity: EntryEntity = {
    x: number('x', 0),
    y: number('y', 0),
    regX: 0,
    regY: 0,
    scaleX,
    scaleY,
    rotation: number('angle', 0),
    direction: number('way', 90),
    width: 100,
    height: 100,
    font: 'undefinedpx ',
    visible: boolean('visible', true),
  };

  if (!isText) {
    const width = picture?.dimension?.width ?? 100;
    const height = picture?.dimension?.height ?? 100;
    // regX/regY is the registration point: the spot the object's x/y actually
    // put on the stage. Entry fixes it when the object is made and never moves
    // it again, and it defaults to the middle of the costume — but the user can
    // drag it anywhere, even outside the image, and then x/y mean something
    // else entirely. Without `center` the object lands in the wrong place.
    Object.assign(entity, {
      regX: object.center?.x ?? width / 2,
      regY: object.center?.y ?? height / 2,
      width,
      height,
    });
  }

  const result: EntryObject = {
    id: object.id,
    name: string('name', object.key),
    script: JSON.stringify(object.script),
    objectType: isText ? 'textBox' : 'sprite',
    rotateMethod: string('rotation', 'free'),
    scene: object.scene.id,
    sprite: {
      // Both spellings of a renamed resource share one asset, so drop the repeat.
      pictures: [...new Set(object.pictures.values())],
      sounds: [...new Set(object.sounds.values())],
    },
    lock: boolean('lock', false),
    entity,
  };

  if (isText) {
    const text = string('text_content', '');
    const fontSize = number('font_size', 20);
    const family = string('font', DEFAULT_FONT);
    const bold = boolean('text_bold', false);
    const italic = boolean('text_italic', false);
    const aligns: Record<string, number> = { center: 0, left: 1, right: 2 };
    const align = aligns[string('text_align', 'center')] ?? 0;

    Object.assign(entity, {
      font: [bold && 'bold', italic && 'italic', `${fontSize}px`, family].filter(Boolean).join(' '),
      colour: string('font_color', '#000000'),
      text,
      textAlign: align,
      lineBreak: boolean('line_break', false),
      // 엔트리가 글상자를 새로 만들 때의 기본 배경은 흰색이다(entryjs src/class/object.js
      // `json.bgColor = '#ffffff'`). 'transparent' 를 기본값으로 쓰면 검은 기본 글자색과
      // 겹쳐 배경이 없는 화면에서는 글자가 거의 안 보이는 것처럼 보인다.
      bgColor: string('bg_color', '#ffffff'),
      underLine: boolean('text_underline', false),
      strike: boolean('text_strikethrough', false),
      fontSize,
      // Entry measures the frame by laying the text out; with no font to draw
      // the compiler can only estimate it from the character count. `size W H`
      // overrides that — a wrapping text box takes its line breaks from the
      // width and its line count from the height, so the estimate is far off.
      width: object.boxSize?.width ?? Math.max(text.length * fontSize * 0.85, fontSize),
      height: object.boxSize?.height ?? Math.round(fontSize * 1.1),
    });
    result.text = text;
  } else {
    result.selectedPictureId = picture?.id ?? null;
    if (!picture) ctx.warn(object.node, `오브젝트 '${object.key}' 에 모양(costume)이 없습니다.`);
  }

  return result;
}

/** 엔트리 프로젝트는 초시계와 대답 항목을 변수 목록에 함께 담는다 */
function addSystemVariables(ctx: Context) {
  ctx.variables.push({
    name: '초시계', id: ctx.newId(), visible: false, value: 0, variableType: 'timer',
    isCloud: false, isRealTime: false, cloudDate: false, object: null, x: 232, y: -144,
  });
  ctx.variables.push({
    name: '대답', id: ctx.newId(), visible: false, value: 0, variableType: 'answer',
    isCloud: false, isRealTime: false, cloudDate: false, object: null, x: 150, y: -100,
  });
}
