// Tess -> Entry project (project.json) compiler.
//
// Stages
//   1. resolve use + parse         (include.js, parse.js)
//   2. semantic validation         (validate.js)
//   3. symbol collection — scenes, objects, variables, messages, functions
//   4. script compilation          (statement.js, expression.js)
//   5. Entry project assembly
import path from 'node:path';
import { Context } from './context.js';
import { loadProgram } from './include.js';
import { buildCommentMap } from './comments.js';
import { makeAsset } from './assets.js';
import { compileStatements, compileStatement } from './statement.js';
import { compileValue, BOOLEAN_TEXT } from './expression.js';
import { keyCodeOf } from './keycodes.js';
import { validate } from '../validate.js';
import { isAutoParamName } from '../function-params.js';

const DEFAULT_SCENE_NAME = '장면 1';
// Entry's actual default text-box font is the CSS font-family name 'Nanum
// Gothic' (entryjs src/class/entity.js). Using the Korean name '나눔고딕'
// verbatim has no matching @font-face, so the browser falls back to a
// generic default font instead.
const DEFAULT_FONT = 'Nanum Gothic';
// project.json has no "default" slot for brush properties (draw_color
// etc.) — Entry always starts a new object with a red brush (#ff0000,
// thickness 1) (entryjs Entry.setBasicBrush). So when an object
// declaration sets these values, the compiler synthesizes a `when start`
// script that sets them first.
const BRUSH_DEFAULT_PROPERTIES = ['draw_color', 'fill_color', 'draw_width', 'draw_alpha'];

/**
 * Compiles Tess source into an Entry project object.
 *
 * `project` is null if there are errors. With `force: true`, returns the
 * project with only the failed statements omitted (`ok` is still false).
 *
 * @param {string} source
 * @param {{path?: string, assetDirs?: string[], name?: string, readFile?: Function, force?: boolean}} [options]
 * @returns {{ok: boolean, project: object|null, errors: Array, warnings: Array, assets: Array, sourceMap: object}}
 */
export function compileProject(source, options = {}) {
  const filePath = options.path ?? '<input>';
  const loaded = loadProgram({ source, path: filePath, readFile: options.readFile });
  if (!loaded.ast) {
    return { ok: false, project: null, errors: loaded.errors, warnings: loaded.warnings, assets: [] };
  }

  const semantic = validate(loaded.ast, source, loaded.sources);
  const ctx = new Context(source, {
    ...options,
    sources: loaded.sources,
    comments: buildCommentMap(loaded.ast, loaded.sources),
    assetDirs: options.assetDirs ?? [path.dirname(path.resolve(filePath))],
  });
  ctx.errors.push(...semantic.errors);
  ctx.warnings.push(...semantic.warnings);

  const program = loaded.ast;
  collectScenes(program, ctx);
  collectGlobals(program, ctx);
  collectObjects(program, ctx);
  collectFunctions(program, ctx);
  collectMessages(program, ctx);

  compileFunctions(ctx);
  compileObjects(ctx);

  const project = assemble(program, ctx, options);
  const ok = ctx.errors.length === 0;
  return {
    ok,
    project: ok || options.force ? project : null,
    errors: ctx.errors,
    warnings: ctx.warnings,
    assets: ctx.assetFiles,
    sourceMap: ctx.sourceMap,
  };
}

// ---------------------------------------------------------------------------
//  1. scenes
// ---------------------------------------------------------------------------
function collectScenes(program, ctx) {
  for (const item of program.body) {
    if (item.type !== 'Scene') continue;
    if (ctx.sceneByName.has(item.name)) {
      ctx.error(item, `'${item.name}' 장면이 이미 있습니다.`);
      continue;
    }
    // The "id" in `scene "id":` is the identifier used by jump etc. A
    // `name "..."` in the body overrides the display name in the compiled
    // project instead (same as an object's name property).
    const scene = { id: ctx.newId(), name: sceneDisplayName(item, ctx) ?? item.name };
    ctx.scenes.push(scene);
    ctx.sceneByName.set(item.name, scene);
  }

  // synthesizes a default scene so a file with only objects (no scene) can still compile
  const hasLooseObject = program.body.some((item) => item.type === 'Object');
  if (ctx.scenes.length === 0 || (hasLooseObject && ctx.scenes.length === 0)) {
    const scene = { id: ctx.newId(), name: DEFAULT_SCENE_NAME };
    ctx.scenes.unshift(scene);
    ctx.sceneByName.set(scene.name, scene);
  }
}

/** Returns the string from a `name "..."` in the scene body, or null if absent. */
function sceneDisplayName(item, ctx) {
  let value = null;
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
//  2. global variables, lists
// ---------------------------------------------------------------------------
function collectGlobals(program, ctx) {
  for (const item of program.body) {
    if (item.type === 'VarDecl' || item.type === 'ListDecl') {
      const entry = makeVariable(item, ctx, null);
      if (entry) {
        ctx.variables.push(entry);
        ctx.globals.set(item.name, entry);
      }
    }
  }
}

/** var/list declaration -> Entry variables entry. */
function makeVariable(node, ctx, objectId) {
  const base = {
    name: node.name,
    id: ctx.newId(),
    visible: false,
    value: 0,
    variableType: 'variable',
    isCloud: false,
    isRealTime: false,
    cloudDate: false,
    object: objectId,
    x: 0,
    y: 0,
  };

  if (node.type === 'ListDecl') {
    const items = node.value.elements.map((element) => constantOf(element, ctx));
    if (items.some((item) => item === null)) return null;
    return {
      ...base,
      value: 0,
      variableType: 'list',
      array: items.map((data) => ({ data })),
      width: 100,
      height: 120,
    };
  }

  const value = constantOf(node.value, ctx);
  if (value === null) return null;
  return { ...base, value };
}

/** Confirms the node is a valid declaration initializer and converts it to a raw value. */
function constantOf(node, ctx) {
  switch (node.type) {
    case 'Number': return node.value;
    case 'String': return node.value;
    // uses the same encoding as assignment: Entry's true is the string "TRUE" (see expression.js)
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
//  3. objects
// ---------------------------------------------------------------------------
function collectObjects(program, ctx) {
  const register = (node, scene) => {
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
      script: [],
    };
    ctx.objects.push(object);
    ctx.objectByName.set(node.name, object);
  };

  for (const item of program.body) {
    if (item.type === 'Object') register(item, ctx.scenes[0]);
    if (item.type === 'Scene') {
      const scene = ctx.sceneByName.get(item.name);
      for (const member of item.body) {
        if (member.type === 'Object') register(member, scene);
      }
    }
  }

  for (const object of ctx.objects) collectObjectMembers(object, ctx);
}

/**
 * Entry id for a costume/sound — without `force id "..."`, generated
 * normally from the seed; with it, the given string is used verbatim (see
 * SPEC-ADDENDUM.md). `force id` exists to re-assign the original id when
 * decompiling a project whose functions hardcoded another object's
 * costume/sound id. A collision with an already-used id would make two
 * different resources share one id in project.json, pointing Entry at the
 * wrong resource — so it's rejected as a compile error instead.
 */
function resourceId(member, ctx) {
  if (!member.forceId) return ctx.newId();
  if (ctx.newId.has(member.forceId)) {
    return ctx.error(member, `force id "${member.forceId}" 는 이미 다른 모양·소리·오브젝트가 쓰고 있습니다.`);
  }
  ctx.newId.reserve(member.forceId);
  ctx.forcedResourceIds.add(member.forceId);
  return member.forceId;
}

function collectObjectMembers(object, ctx) {
  ctx.object = object;

  for (const member of object.node.body) {
    switch (member.type) {
      case 'Costume': {
        const asset = makeAsset('image', {
          id: resourceId(member, ctx), file: member.file, name: member.id,
          width: member.width, height: member.height,
        }, ctx, member);
        object.pictures.set(member.id, asset);
        if (member.isDefault || !object.defaultPicture) object.defaultPicture = asset;
        break;
      }
      case 'Sound': {
        const asset = makeAsset('sound', {
          id: resourceId(member, ctx), file: member.file, name: member.id, duration: member.duration,
        }, ctx, member);
        object.sounds.set(member.id, asset);
        break;
      }
      case 'Property':
        object.properties.set(member.name, member.value);
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

  // also registers var/list first introduced inside an event handler as this object's variable
  for (const member of object.node.body) {
    if (member.type === 'Event') collectHandlerVariables(member.body, object, ctx);
  }
  ctx.object = null;
}

function collectHandlerVariables(statements, object, ctx) {
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
    for (const key of ['consequent', 'alternate', 'body']) {
      if (Array.isArray(statement[key])) collectHandlerVariables(statement[key], object, ctx);
    }
  }
}

// ---------------------------------------------------------------------------
//  4. functions
// ---------------------------------------------------------------------------
function collectFunctions(program, ctx) {
  const register = (node, owner) => {
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

    // a parameter written `name?` also becomes a boolean slot in Entry (SPEC-ADDENDUM.md 4.6)
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

function findReturns(statements, found = []) {
  for (const statement of statements) {
    if (statement.type === 'Return') found.push(statement);
    for (const key of ['consequent', 'alternate', 'body']) {
      if (Array.isArray(statement[key])) findReturns(statement[key], found);
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
//  5. messages
// ---------------------------------------------------------------------------
function collectMessages(node, ctx) {
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach((child) => collectMessages(child, ctx));
    return;
  }
  if (node.type === 'Send' && node.signal?.type === 'String') ctx.messageId(node.signal.value);
  if (node.type === 'Event' && node.event === 'signal') ctx.messageId(node.signal);
  for (const [key, value] of Object.entries(node)) {
    if (key !== 'loc') collectMessages(value, ctx);
  }
}

// ---------------------------------------------------------------------------
//  6. function body compilation
// ---------------------------------------------------------------------------
function compileFunctions(ctx) {
  for (const fn of ctx.functions) {
    if (fn.generated) continue; // runtime function the compiler already built
    ctx.object = fn.owner ? ctx.objectByName.get(fn.owner) : null;
    ctx.locals = ctx.object?.locals ?? new Map();
    ctx.funcScope = {
      name: fn.name,
      params: fn.paramTypes,
      localVars: new Map(),
    };

    // var declared inside a function becomes an Entry function-local variable
    collectFunctionLocals(fn.node.body, ctx.funcScope, ctx, fn);

    const body = fn.isValue ? fn.node.body.slice(0, -1) : fn.node.body;
    const statements = compileStatements(body, ctx);
    const returnValue = fn.isValue
      ? compileValue(fn.node.body[fn.node.body.length - 1].value, ctx)
      : null;

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

function collectFunctionLocals(statements, scope, ctx, fn) {
  for (const statement of statements) {
    if (statement.type === 'VarDecl' && !scope.localVars.has(statement.name)) {
      scope.localVars.set(statement.name, `${fn.id}_${ctx.newId()}`);
    }
    if (statement.type === 'ListDecl') {
      ctx.error(statement, '함수 안에서는 리스트를 선언할 수 없습니다. 전역 리스트를 쓰세요.');
    }
    for (const key of ['consequent', 'alternate', 'body']) {
      if (Array.isArray(statement[key])) collectFunctionLocals(statement[key], scope, ctx, fn);
    }
  }
}

/**
 * Builds the function header (a chain of labels and parameter slots). An
 * auto-generated name (a, b, c, ...) gets no label; any other name does —
 * the reverse of what the decompiler does (src/function-params.js).
 */
function buildFunctionFields(fn, ctx) {
  let next = null;
  for (let i = fn.params.length - 1; i >= 0; i -= 1) {
    const name = fn.params[i];
    next = fn.booleanParams?.has(name)
      ? ctx.block('function_field_boolean', [ctx.block(fn.paramTypes.get(name), [null]), next])
      : ctx.block('function_field_string', [ctx.block(fn.paramTypes.get(name), []), next]);
    if (!isAutoParamName(name, i)) next = ctx.block('function_field_label', [name, next]);
  }
  return ctx.block('function_field_label', [fn.name, next]);
}

// ---------------------------------------------------------------------------
//  7. object script compilation
// ---------------------------------------------------------------------------
function compileObjects(ctx) {
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

function compileEvent(event, ctx) {
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
      return [ctx.block('when_message_cast', [null, ctx.messageId(event.signal)]), ...body()];

    case 'key': {
      const code = keyCodeOf(event.key);
      if (!code) return [ctx.error(event, `알 수 없는 키 이름 "${event.key}" 입니다.`)] && null;
      return [ctx.block('when_some_key_pressed', [null, code]), ...body()];
    }

    case 'key_up': {
      // Entry has no "key released" event, so this expands into a polling script:
      //   start -> repeat forever: wait until pressed -> wait until released -> body
      // (a fixed transformation documented in SPEC-ADDENDUM 4)
      const code = keyCodeOf(event.key);
      if (!code) return [ctx.error(event, `알 수 없는 키 이름 "${event.key}" 입니다.`)] && null;
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
 * When draw_color etc. are set at the top of an object declaration,
 * synthesizes a `when start` script that sets them first (see the
 * BRUSH_DEFAULT_PROPERTIES declaration).
 */
function compileBrushDefaults(object, ctx) {
  const present = BRUSH_DEFAULT_PROPERTIES.filter((name) => object.properties.has(name));
  if (present.length === 0) return null;

  const blocks = [ctx.block('when_run_button_click', [null])];
  for (const name of present) {
    const value = object.properties.get(name);
    const assign = {
      type: 'Assign', operator: '=', target: { type: 'Identifier', name, loc: value.loc }, value, loc: value.loc,
    };
    blocks.push(...compileStatement(assign, ctx));
  }
  return blocks;
}

// ---------------------------------------------------------------------------
//  8. project assembly
// ---------------------------------------------------------------------------
function assemble(program, ctx, options) {
  const projectDecl = program.body.find((item) => item.type === 'Project');
  const fields = new Map((projectDecl?.fields ?? []).map((field) => [field.field, field.value]));

  const objects = ctx.objects.map((object) => buildObject(object, ctx));
  addSystemVariables(ctx);

  const project = {
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
    tables: [],
    speed: fields.get('fps')?.value ?? 60,
    interface: { menuWidth: 280, canvasWidth: 480, object: objects[0]?.id ?? null },
    expansionBlocks: [],
    // enables Entry's TTS (read-aloud) extension block if a read/tts statement is used
    // (entryjs only calls Entry.AI_UTILIZE_BLOCK[type].init() for names listed in project.aiUtilizeBlocks)
    aiUtilizeBlocks: ctx.usesTts ? ['tts'] : [],
    hardwareLiteBlocks: [],
    externalModules: [],
    externalModulesLite: [],
    name: options.name ?? fields.get('title')?.value ?? 'Tess 작품',
    isPracticalCourse: false,
  };

  const description = fields.get('description')?.value;
  if (description) project.description = description;
  return project;
}

function buildObject(object, ctx) {
  const properties = object.properties;
  const number = (name, fallback) => {
    const value = properties.get(name);
    if (value === undefined) return fallback;
    if (value.type === 'Number') return value.value;
    if (value.type === 'Unary' && value.operator === '-' && value.argument.type === 'Number') {
      return -value.argument.value;
    }
    ctx.error(value, `속성 '${name}' 에는 숫자만 쓸 수 있습니다.`);
    return fallback;
  };
  const string = (name, fallback) => {
    const value = properties.get(name);
    if (value === undefined) return fallback;
    if (value.type === 'String') return value.value;
    if (value.type === 'Color') return value.value;
    if (value.type === 'Transparent') return 'transparent';
    if (value.type === 'Keyword' || value.type === 'Identifier') return value.name;
    ctx.error(value, `속성 '${name}' 에는 문자열만 쓸 수 있습니다.`);
    return fallback;
  };
  const boolean = (name, fallback) => {
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

  const entity = {
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
    const width = picture?.dimension.width ?? 100;
    const height = picture?.dimension.height ?? 100;
    Object.assign(entity, { regX: width / 2, regY: height / 2, width, height });
  }

  const result = {
    id: object.id,
    name: string('name', object.key),
    script: JSON.stringify(object.script),
    objectType: isText ? 'textBox' : 'sprite',
    rotateMethod: string('rotation', 'free'),
    scene: object.scene.id,
    sprite: {
      pictures: [...object.pictures.values()],
      sounds: [...object.sounds.values()],
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
    const aligns = { center: 0, left: 1, right: 2 };
    const align = aligns[string('text_align', 'center')] ?? 0;

    Object.assign(entity, {
      font: [bold && 'bold', italic && 'italic', `${fontSize}px`, family].filter(Boolean).join(' '),
      colour: string('font_color', '#000000'),
      text,
      textAlign: align,
      lineBreak: boolean('line_break', false),
      // Entry's default background for a new text box is white (entryjs
      // src/class/object.js `json.bgColor = '#ffffff'`). Defaulting to
      // 'transparent' would combine with the default black text color to
      // make text nearly invisible on a background-less screen.
      bgColor: string('bg_color', '#ffffff'),
      underLine: boolean('text_underline', false),
      strike: boolean('text_strikethrough', false),
      fontSize,
      width: Math.max(text.length * fontSize * 0.85, fontSize),
      height: Math.round(fontSize * 1.1),
    });
    result.text = text;
  } else {
    result.selectedPictureId = picture?.id ?? null;
    if (!picture) ctx.warn(object.node, `오브젝트 '${object.key}' 에 모양(costume)이 없습니다.`);
  }

  return result;
}

/** Entry projects keep the stopwatch and answer entries in the variables list too. */
function addSystemVariables(ctx) {
  ctx.variables.push({
    name: '초시계', id: ctx.newId(), visible: false, value: 0, variableType: 'timer',
    isCloud: false, isRealTime: false, cloudDate: false, object: null, x: 232, y: -144,
  });
  ctx.variables.push({
    name: '대답', id: ctx.newId(), visible: false, value: 0, variableType: 'answer',
    isCloud: false, isRealTime: false, cloudDate: false, object: null, x: 150, y: -100,
  });
}
