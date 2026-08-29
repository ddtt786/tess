// ============================================================================
//  Tess 시맨틱 검증
//
//  문법만으로는 잡을 수 없는 spec 의 의미 규칙을 AST 위에서 검사한다.
//
//   1) 글상자 전용 명령/속성을 일반 object 에서 사용 (spec 8.5)
//   2) 함수 안에서 오브젝트 로컬 변수 참조     (spec 14.2)
//   3) 함수 밖의 return
//   4) 반복문 밖의 break / skip
//   5) project 블록 중복 선언                  (spec 3.2)
// ============================================================================
import {
  BUILTIN_FUNCTIONS,
  OBJECT_PROPERTIES,
  OPTION_KEYWORDS,
  STATE_VALUES,
  TEXT_ONLY_PROPERTIES,
} from './builtins.js';

const LOOP_TYPES = new Set(['Repeat', 'While', 'Until', 'Forever']);

/**
 * 한 파일의 줄 찾기표를 만든다.
 *
 * `lineAndColumn` 은 파일 처음부터 훑기 때문에 한두 번 쓰기에는 괜찮지만 블록마다
 * 부르기에는 안 된다 — 컴파일러는 만드는 블록마다 소스 위치를 남기므로, 그때마다
 * 훑으면 비용이 (블록 수 × 파일 길이)로 늘어난다. 줄 시작 위치를 한 번만 모아 두고
 * 이분 탐색한다.
 *
 * @param {string} source
 * @returns {(offset: number) => {line: number, column: number}}
 */
export function lineIndex(source) {
  const starts = [0];
  for (let i = 0; i < source.length; i += 1) {
    if (source.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return (offset) => {
    const target = Math.min(Math.max(offset, 0), source.length);
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (starts[mid] <= target) low = mid;
      else high = mid - 1;
    }
    return { line: low + 1, column: target - starts[low] + 1 };
  };
}

/** 오프셋을 사람이 읽는 줄/열로 변환 */
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
 * @param {object} program  ast() 로 만든 Program 노드
 * @param {string} source   원본 소스 (에러 위치 계산용)
 * @param {Map<string,string>} [sources] use 로 불러온 파일들의 소스
 * @returns {{errors: Array, warnings: Array}}
 */
export function validate(program, source = '', sources = null) {
  const errors = [];
  const warnings = [];

  const report = (bucket, node, message) => {
    // `use` 로 불러온 노드는 자기 파일 기준으로 위치를 계산해야 한다
    const file = node?.loc?.file;
    const text = (file && sources?.get(file)) ?? source;
    const { line, column } = lineAndColumn(text, node?.loc?.start ?? 0);
    bucket.push({ line, column, file, message, offset: node?.loc?.start ?? 0 });
  };
  const error = (node, message) => report(errors, node, message);
  const warn = (node, message) => report(warnings, node, message);

  // --- 사전 수집 -----------------------------------------------------------
  const globals = declaredNames(program.body);
  const knownFunctions = new Set(collectFunctionNames(program.body));
  // `use` 로 다른 파일을 불러오는 프로그램은 이 파일만 봐서는 알 수 없는 이름이
  // 생기므로, 이름 기반 경고는 끈다.
  const hasUse = containsUse(program);

  let projectCount = 0;

  for (const item of program.body) visitTopLevel(item);

  // --- 방문자 ---------------------------------------------------------------
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
        case 'BoxSize':
          // A sprite takes its size from its costume image; only a text box
          // carries a frame size of its own.
          if (!isText) {
            error(member, `'size 가로 세로' 는 글상자(text) 전용입니다. 모양 크기는 costume 뒤에 적으세요.`);
          }
          break;
        case 'Center':
          // Entry leaves a text box's registration point at 0,0 — only a sprite
          // gets one, taken from its costume.
          if (isText) {
            error(member, `'center 가로 세로' 는 오브젝트(object) 전용입니다. 글상자는 중심점을 옮길 수 없습니다.`);
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
    // spec 14.2: 함수는 자신의 매개변수 · 지역 변수 · 전역 변수만 볼 수 있다.
    walkStatements(fn.body, {
      isText: true, // 함수는 오브젝트 종류와 무관하므로 글상자 검사는 하지 않는다
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

    // 자식 문장 블록
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
    // 상태 값 · 옵션 키워드 · 오브젝트 속성은 선언 없이 쓰는 이름이다.
    if (STATE_VALUES.has(name) || OPTION_KEYWORDS.has(name)) return;
    if (OBJECT_PROPERTIES.has(name) || TEXT_ONLY_PROPERTIES.has(name)) return;

    // spec 14.2: object 로컬 변수는 함수 안에서 참조할 수 없다.
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
//  헬퍼
// ---------------------------------------------------------------------------

/** 블록 목록에서 직접 선언된 var/list 이름 */
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

/** 문장이 품고 있는 하위 문장 블록의 키 이름 */
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
