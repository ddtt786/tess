// ============================================================================
//  컴파일 컨텍스트
//
//  블록 생성, 심볼 테이블(오브젝트 · 장면 · 변수 · 신호 · 함수), 진단 수집을
//  한 곳에서 관리한다.
// ============================================================================
import { createIdFactory, seedFrom } from './ids.js';
import { commentKey, makeComment } from './comments.js';
import { lineAndColumn } from '../validate.js';

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
  constructor(source, options = {}) {
    this.source = source;
    this.sources = options.sources ?? null;
    this.options = options;
    this.assetFiles = [];
    this.comments = options.comments ?? new Map();
    this.newId = createIdFactory(seedFrom(options.seed ?? source));
    this.errors = [];
    this.warnings = [];

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
    const text = (file && this.sources?.get(file)) ?? this.source;
    const { line, column } = lineAndColumn(text, offset);
    bucket.push({ line, column, file, offset, message });
  }

  // --- 블록 만들기 ---------------------------------------------------------
  block(type, params = [], statements = []) {
    return makeBlock(this.newId(), type, params, statements);
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
