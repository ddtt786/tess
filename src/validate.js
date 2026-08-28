// ============================================================================
//  Tess semantic validation.
//
//  Checks spec rules on the AST that the grammar alone cannot enforce:
//
//   1) text-only commands/properties used on a plain object (spec 8.5)
//   2) object-local variable referenced inside a function     (spec 14.2)
//   3) return outside a function
//   4) break / skip outside a loop
//   5) duplicate project block                                (spec 3.2)
// ============================================================================
import {
  BUILTIN_FUNCTIONS,
  OBJECT_PROPERTIES,
  OPTION_KEYWORDS,
  STATE_VALUES,
  TEXT_ONLY_PROPERTIES,
} from './builtins.js';

const LOOP_TYPES = new Set(['Repeat', 'While', 'Until', 'Forever']);

/** Converts a source offset to a human-readable line/column. */
export function lineAndColumn(source, offset) {
  let line = 1;
  let column = 1;
  for (let i = 0; i < offset && i < source.length; i += 1) {
    if (source[i] === '\n') {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return { line, column };
}

/**
 * @param {object} program  Program node produced by ast()
 * @param {string} source   original source (for error position lookup)
 * @param {Map<string,string>} [sources] sources of files pulled in via `use`
 * @returns {{errors: Array, warnings: Array}}
 */
export function validate(program, source = '', sources = null) {
  const errors = [];
  const warnings = [];

  const report = (bucket, node, message) => {
    // A node pulled in via `use` needs its position resolved against its own file.
    const file = node?.loc?.file;
    const text = (file && sources?.get(file)) ?? source;
    const { line, column } = lineAndColumn(text, node?.loc?.start ?? 0);
    bucket.push({ line, column, file, message, offset: node?.loc?.start ?? 0 });
  };
  const error = (node, message) => report(errors, node, message);
  const warn = (node, message) => report(warnings, node, message);

  // --- pre-collection --------------------------------------------------------
  const globals = declaredNames(program.body);
  const knownFunctions = new Set(collectFunctionNames(program.body));
  // A program that pulls in other files via `use` may reference names this
  // file alone can't see, so name-based warnings are disabled in that case.
  const hasUse = containsUse(program);

  let projectCount = 0;

  for (const item of program.body) visitTopLevel(item);

  // --- visitors ----------------------------------------------------------
  function visitTopLevel(item) {
    switch (item.type) {
      case 'Project':
        projectCount += 1;
        if (projectCount === 2) {
          error(item, 'project 블록은 작품 전체에 하나만 선언할 수 있습니다.');
        }
        break;
      case 'Scene':
        item.body.forEach(visitTopLevel);
        break;
      case 'Object':
        visitObject(item);
        break;
      case 'FunctionDecl':
        visitFunction(item, new Set());
        break;
      default:
        break;
    }
  }

  function visitObject(object) {
    const isText = object.kind === 'text';
    const locals = declaredNames(object.body);
    const objectFunctions = new Set(collectFunctionNames(object.body));

    for (const member of object.body) {
      switch (member.type) {
        case 'Property':
          if (!isText && TEXT_ONLY_PROPERTIES.has(member.name)) {
            error(member, `'${member.name}' 은(는) 글상자(text) 전용 속성입니다. object 에서는 쓸 수 없습니다.`);
          }
          break;
        case 'FunctionDecl':
          visitFunction(member, locals);
          break;
        case 'Event':
          walkStatements(member.body, {
            isText,
            inFunction: false,
            loopDepth: 0,
            scope: new Set([...globals, ...locals]),
            objectLocals: locals,
            functions: new Set([...knownFunctions, ...objectFunctions]),
          });
          break;
        default:
          break;
      }
    }
  }

  function visitFunction(fn, objectLocals) {
    // spec 14.2: a function can only see its own params, locals, and globals.
    walkStatements(fn.body, {
      isText: true, // Functions are independent of object kind, so skip text-only checks.
      inFunction: true,
      loopDepth: 0,
      scope: new Set([...globals, ...fn.params]),
      objectLocals,
      functions: knownFunctions,
    });
  }

  function walkStatements(statements, ctx) {
    for (const statement of statements) walkStatement(statement, ctx);
  }

  function walkStatement(statement, ctx) {
    switch (statement.type) {
      case 'VarDecl':
      case 'ListDecl':
        walkExpressions(statement.value, ctx);
        ctx.scope.add(statement.name);
        return;

      case 'Return':
        if (!ctx.inFunction) {
          error(statement, 'return 은 function 블록 안에서만 쓸 수 있습니다.');
        }
        break;

      case 'Break':
      case 'Skip':
        if (ctx.loopDepth === 0) {
          const word = statement.type === 'Break' ? 'break' : 'skip';
          error(statement, `${word} 은(는) 반복문(repeat/while/until/forever) 안에서만 쓸 수 있습니다.`);
        }
        break;

      case 'TextWrite':
        if (!ctx.isText) {
          error(statement, `'${statement.mode}' 은(는) 글상자(text) 전용 명령입니다.`);
        }
        break;

      case 'Clear':
        if (statement.target === 'text' && !ctx.isText) {
          error(statement, "'clear text' 는 글상자(text) 전용 명령입니다.");
        }
        break;

      case 'Assign':
        if (
          !ctx.isText &&
          statement.target.type === 'Identifier' &&
          TEXT_ONLY_PROPERTIES.has(statement.target.name) &&
          !ctx.scope.has(statement.target.name)
        ) {
          error(statement, `'${statement.target.name}' 은(는) 글상자(text) 전용 속성입니다.`);
        }
        break;

      default:
        break;
    }

    // Child statement blocks.
    const blocks = childBlocks(statement);
    const innerCtx = LOOP_TYPES.has(statement.type)
      ? { ...ctx, loopDepth: ctx.loopDepth + 1 }
      : ctx;

    for (const [key, value] of Object.entries(statement)) {
      if (key === 'loc' || key === 'type') continue;
      if (blocks.includes(key)) continue;
      walkExpressions(value, ctx);
    }
    for (const key of blocks) {
      if (Array.isArray(statement[key])) walkStatements(statement[key], innerCtx);
    }
  }

  function walkExpressions(value, ctx) {
    if (value === null || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach((v) => walkExpressions(v, ctx));
      return;
    }

    if (value.type === 'Identifier') checkIdentifier(value, ctx);
    if (value.type === 'Call') checkCall(value, ctx);

    for (const [key, child] of Object.entries(value)) {
      if (key === 'loc' || key === 'type') continue;
      walkExpressions(child, ctx);
    }
  }

  function checkIdentifier(identifier, ctx) {
    const { name } = identifier;
    if (ctx.scope.has(name)) return;
    // State values, option keywords, and object properties are used without declaration.
    if (STATE_VALUES.has(name) || OPTION_KEYWORDS.has(name)) return;
    if (OBJECT_PROPERTIES.has(name) || TEXT_ONLY_PROPERTIES.has(name)) return;

    // spec 14.2: an object-local variable can't be referenced inside a function.
    if (ctx.inFunction && ctx.objectLocals.has(name)) {
      error(
        identifier,
        `함수 안에서는 오브젝트의 로컬 변수 '${name}' 을(를) 참조할 수 없습니다. 매개변수로 전달하세요.`,
      );
      return;
    }

    if (!hasUse && !ctx.objectLocals.has(name)) {
      warn(identifier, `선언되지 않은 이름 '${name}' 입니다.`);
    }
  }

  function checkCall(call, ctx) {
    if (BUILTIN_FUNCTIONS.has(call.callee)) return;
    if (ctx.functions.has(call.callee)) return;
    if (!hasUse) warn(call, `선언되지 않은 함수 '${call.callee}' 를 호출했습니다.`);
  }

  return { errors, warnings };
}

// ---------------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------------

/** var/list names declared directly in a block list. */
function declaredNames(body) {
  const names = new Set();
  for (const member of body) {
    if (member.type === 'VarDecl' || member.type === 'ListDecl') names.add(member.name);
  }
  return names;
}

function collectFunctionNames(body) {
  const names = [];
  for (const member of body) {
    if (member.type === 'FunctionDecl') names.push(member.name);
    if (member.type === 'Scene' || member.type === 'Object') {
      names.push(...collectFunctionNames(member.body));
    }
  }
  return names;
}

/** Key names of the child statement blocks a statement holds. */
function childBlocks(statement) {
  switch (statement.type) {
    case 'If':
      return statement.alternate ? ['consequent', 'alternate'] : ['consequent'];
    case 'Repeat':
    case 'While':
    case 'Until':
    case 'Forever':
      return ['body'];
    default:
      return [];
  }
}

function containsUse(node) {
  if (node === null || typeof node !== 'object') return false;
  if (Array.isArray(node)) return node.some(containsUse);
  if (node.type === 'Use') return true;
  return Object.entries(node).some(([key, value]) => key !== 'loc' && containsUse(value));
}
