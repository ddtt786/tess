// ============================================================================
//  컴파일 컨텍스트
//
//  블록 생성, 심볼 테이블(오브젝트 · 장면 · 변수 · 신호 · 함수), 진단 수집을
//  한 곳에서 관리한다.
// ============================================================================
import { createIdFactory, seedFrom } from './ids.js';
import { commentKey, makeComment } from './comments.js';
import { lineIndex } from '../validate.js';

/** 엔트리 블록 한 개의 기본 뼈대 */
export function makeBlock(id, type, params = [], statements = []) {
  return {
    id,
    x: 0,
    y: 0,
    type,
    params,
    statements,
    movable: null,
    deletable: 1,
    emphasized: false,
    readOnly: null,
    copyable: true,
    assemble: true,
    extensions: [],
  };
}

export class Context {
  /** 파일별 줄 찾기표. 블록마다 위치를 남기므로 파일당 한 번만 만든다. */
  #lineLookups = new Map();

  constructor(source, options = {}) {
    this.source = source;
    this.sources = options.sources ?? null;
    this.options = options;
    this.assetFiles = [];
    this.comments = options.comments ?? new Map();
    this.newId = createIdFactory(seedFrom(options.seed ?? source));
    this.errors = [];
    this.warnings = [];

    // 블록 id -> 그 블록을 만든 Tess 소스 위치. 실행 중 엔트리가 panic 나면
    // 어느 블록인지(id)는 알 수 있어도 어느 줄인지는 모르니, 디버그 패널이
    // 이 표를 찾아서 "블록 -> 소스 위치" 로 되짚어 보여줄 수 있게 모아 둔다.
    this.sourceMap = {};
    this.currentNode = null; // 지금 컴파일 중인 문장의 AST 노드 (블록 위치 태깅용)
    this.usesTts = false; // read / tts 문을 하나라도 쓰면 project.aiUtilizeBlocks 에 'tts' 를 넣는다
    // costume/sound 선언의 `force id "..."` 로 고정해 둔 진짜 엔트리 id 들 (SPEC-ADDENDUM.md
    // 1.4절). resolvePicture/resolveSound 가 "이 문자열이 이 오브젝트의 이름은 아니어도,
    // 어딘가에 고정해 둔 진짜 id 인가" 를 볼 때 쓴다 — ctx.newId 가 만든 모든 id(장면·
    // 오브젝트·변수·블록 id 전부 포함)를 그대로 쓰면, 코스튬 이름 오타가 우연히 무관한
    // id 와 겹쳐서 조용히 잘못된 걸 가리키게 될 수 있어 따로 둔다.
    this.forcedResourceIds = new Set();

    // 심볼 테이블
    this.scenes = [];           // { id, name }
    this.sceneByName = new Map();
    this.objects = [];          // { id, name, kind, ... }
    this.objectByName = new Map();
    this.variables = [];        // 엔트리 variables 항목
    this.globals = new Map();   // name -> variable 항목
    this.messages = [];
    this.messageByName = new Map();
    this.functions = [];        // { id, name, node, params, isValue, owner }
    this.functionByName = new Map();
    this.runtimeFunctions = new Map(); // 컴파일러가 만들어 넣는 함수 (scale_x/scale_y)

    // 현재 컴파일 중인 위치
    this.object = null;         // 현재 오브젝트
    this.locals = new Map();    // 오브젝트 로컬 변수 name -> 변수 항목
    this.funcScope = null;      // 함수 안이면 { name, params:Set, localVars:Map }
  }

  // --- 진단 ---------------------------------------------------------------
  error(node, message) {
    this.#report(this.errors, node, message);
    return null;
  }

  warn(node, message) {
    this.#report(this.warnings, node, message);
    return null;
  }

  #report(bucket, node, message) {
    const offset = node?.loc?.start ?? 0;
    const file = node?.loc?.file;
    const { line, column } = this.#positionIn(file, offset);
    bucket.push({ line, column, file, offset, message });
  }

  /**
   * Line and column for an offset in one of the compiled files.
   *
   * Every block records where it came from, so this runs once per block. The
   * line table for each file is built the first time that file is asked about.
   */
  #positionIn(file, offset) {
    const key = file ?? '';
    let lookup = this.#lineLookups.get(key);
    if (lookup === undefined) {
      lookup = lineIndex((file && this.sources?.get(file)) ?? this.source);
      this.#lineLookups.set(key, lookup);
    }
    return lookup(offset);
  }

  // --- 블록 만들기 ---------------------------------------------------------
  block(type, params = [], statements = []) {
    const block = makeBlock(this.newId(), type, params, statements);
    this.#recordLocation(block);
    return block;
  }

  /** 지금 만든 블록이 소스의 어디서 왔는지 sourceMap 에 남긴다 */
  #recordLocation(block) {
    const node = this.currentNode;
    if (!node?.loc) return;
    const file = node.loc.file ?? this.options.path ?? null;
    const start = this.#positionIn(file, node.loc.start);
    const end = this.#positionIn(file, node.loc.end ?? node.loc.start);
    this.sourceMap[block.id] = {
      file, line: start.line, column: start.column, endLine: end.line, endColumn: end.column,
    };
  }

  /** 소스에 달린 주석을 엔트리 블록 주석으로 옮긴다 */
  applyComment(node, block) {
    if (!block) return block;
    const text = this.comments.get(commentKey(node));
    if (text) block.comment = makeComment(text);
    return block;
  }

  /** 숫자 리터럴 블록 */
  number(value) {
    return this.block('number', [String(value)]);
  }

  /** 문자열 리터럴 블록 */
  text(value) {
    return this.block('text', [String(value)]);
  }

  /** 각도 리터럴 블록 (회전 계열 블록 전용) */
  angle(value) {
    return this.block('angle', [String(value)]);
  }

  // --- 심볼 조회 -----------------------------------------------------------
  /** 이름으로 변수/리스트 찾기: 함수 지역 -> 오브젝트 로컬 -> 전역 */
  lookupVariable(name) {
    if (this.funcScope) {
      if (this.funcScope.params.has(name)) return { kind: 'param', name };
      // 엔트리 함수 지역 변수는 이름이 아니라 `함수id_해시` 로 가리킨다
      if (this.funcScope.localVars.has(name)) {
        return { kind: 'funcLocal', name, id: this.funcScope.localVars.get(name) };
      }
      const global = this.globals.get(name);
      return global ? { kind: 'variable', entry: global } : null;
    }
    const local = this.locals.get(name);
    if (local) return { kind: 'variable', entry: local };
    const global = this.globals.get(name);
    return global ? { kind: 'variable', entry: global } : null;
  }

  /** 오브젝트 이름 -> 엔트리 오브젝트 id */
  objectId(name) {
    return this.objectByName.get(name)?.id ?? null;
  }

  /** 지금 자리에서 값으로 쓸 수 있는 이름들 — 오타를 짚어 줄 때 후보가 된다 */
  knownNames() {
    const names = [...this.globals.keys(), ...this.locals.keys()];
    if (this.funcScope) {
      names.push(...this.funcScope.params, ...this.funcScope.localVars.keys());
    }
    return names;
  }

  /** 신호 이름 -> 엔트리 메시지 id (없으면 만든다) */
  messageId(name) {
    let message = this.messageByName.get(name);
    if (!message) {
      message = { id: this.newId(), name };
      this.messages.push(message);
      this.messageByName.set(name, message);
    }
    return message.id;
  }
}
