/**
 * `use "파일"` 구문을 해석하고 처리합니다.
 *
 * `use` 구문은 지정된 파일을 그 위치에 통째로 불러와 포함합니다.
 * 파싱 후 `Use` 노드는 불러온 파일의 AST(추상 구문 트리)로 완전히 교체됩니다.
 * 불러온 조각은 놓인 위치에 따라 다음과 같이 다른 시작 규칙이 적용됩니다:
 * - 최상위 레벨: Program
 * - scene 내부: SceneFragment
 * - object 내부: ObjectFragment
 *
 * @example
 * // utils.tess 파일의 내용을 현재 위치에 포함
 * use "utils.tess"
 */
import fs from 'node:fs';
import path from 'node:path';
import { parse } from '@tess/parser';
import { lineAndColumn } from '@tess/parser';
import type {
  Node, ObjectMember, ObjectNode, ParseRoot, ProgramNode, SceneMember, StartRule,
  TopLevelItem, UseObjectNode,
} from '@tess/parser';
import type { CompileCache, CompileDiagnostic } from './types.ts';

/** 
 * 불러온 조각이 위치한 컨텍스트를 나타냅니다. 파싱 시 적용될 규칙을 결정하는 데 사용됩니다.
 */
type IncludeContext = 'top' | 'scene' | 'object';

/** 
 * 호출된 위치에 관계없이 `expand` 함수가 반환할 수 있는 모든 항목의 타입입니다.
 */
type Member = TopLevelItem | SceneMember | ObjectMember;

/** 
 * 모든 `use` 구문이 포함되어 처리가 완료된 후 `loadProgram` 함수가 반환하는 결과 객체입니다. 
 */
export interface LoadedProgram {
  ast: ProgramNode | null;
  errors: CompileDiagnostic[];
  warnings: CompileDiagnostic[];
  sources: Map<string, string>;
}

const START_RULES: Record<IncludeContext, StartRule | undefined> = {
  top: undefined, scene: 'SceneFragment', object: 'ObjectFragment',
};

/**
 * 증분 컴파일을 위한 캐시 저장소를 생성합니다.
 * 
 * 파싱된 모든 파일의 AST를 유지하여, 텍스트가 변경된 파일만 다시 파싱하도록 최적화합니다.
 * 파싱은 가장 비용이 많이 드는 컴파일 단계이며, `use` 의존성 그래프는 편집 중에도 대부분 변경되지 않으므로 컴파일 속도를 크게 향상시킵니다.
 * 동일한 저장소 객체를 여러 `compileProject` 또는 `loadProgram` 호출에 전달하여 캐시를 재사용하세요.
 *
 * @returns 초기화된 컴파일 캐시 객체
 *
 * @example
 * const cache = createCompileCache();
 * const program1 = loadProgram({ source: code1, cache });
 * // 변경된 부분만 다시 파싱하여 성능 최적화
 * const program2 = loadProgram({ source: code2, cache });
 */
export function createCompileCache(): CompileCache {
  return { asts: new Map(), reused: 0, parsed: 0 };
}

/**
 * 파일 경로와 컨텍스트를 기반으로 캐시 키를 생성합니다.
 * 
 * 파일의 AST는 텍스트 내용뿐만 아니라 불러올 때 사용된 시작 규칙(컨텍스트)에도 의존합니다.
 * 따라서 동일한 파일이 다른 위치(예: 최상위와 object 내부)에서 포함되면 각각 별도의 캐시 항목으로 관리됩니다.
 *
 * @param file 캐싱할 대상 파일의 경로
 * @param context 파일이 포함된 위치의 컨텍스트
 * @returns 캐시 키로 사용할 문자열
 *
 * @example
 * const key = cacheKey("math.tess", "top"); // "top\nmath.tess"
 */
function cacheKey(file: string, context: IncludeContext): string {
  return `${context}\n${file}`;
}

export function loadProgram({
  source, path: filePath = '<input>', readFile = defaultReadFile, cache = null,
}: {
  source: string;
  path?: string;
  readFile?: (target: string) => string;
  cache?: CompileCache | null;
}): LoadedProgram {
  const errors: CompileDiagnostic[] = [];
  const warnings: CompileDiagnostic[] = [];
  const sources = new Map([[filePath, source]]);
  const visiting = new Set();

  /** 
   * 실패한 `use` 구문의 위치를 CLI에서 출력하기 위해 줄(line)과 칸(column) 정보로 변환합니다. 
   * 
   * @param item 위치를 찾을 구문 노드
   * @param file 해당 노드가 포함된 파일 경로
   * @returns 위치 정보 객체
   */
  const where = (item: Node, file: string) => ({
    ...position(item, sources.get(file) ?? ''),
    file,
  });

  const load = (text: string, file: string, context: IncludeContext): ParseRoot | null => {
    const key = cacheKey(file, context);
    const hit = cache?.asts.get(key);
    if (cache && hit && hit.text === text) {
      cache.reused += 1;
      return hit.ast;
    }

    const result = parse(text, { startRule: START_RULES[context], validate: false });
    if (cache) cache.parsed += 1;
    if (!result.ok) {
      /**
       * 오류가 발생한 파싱 결과는 캐시하지 않습니다.
       * 
       * 컴파일 시마다 오류를 다시 보고하기 위해, 성공적으로 파싱된 결과만 캐시에 저장합니다.
       * 문법 오류가 있는 파일은 수정될 때까지 매번 다시 파싱됩니다.
       */
      if (cache) cache.asts.delete(key);
      for (const error of result.errors) errors.push({ ...error, file });
      return null;
    }
    stampSource(result.ast, file);
    if (cache) cache.asts.set(key, { text, ast: result.ast! });
    return result.ast;
  };

  const expand = (items: Member[], file: string, context: IncludeContext): Member[] => {
    const output: Member[] = [];
    for (const item of items) {
      if (item.type === 'UseObject') {
        const wrapped = expandUseObject(item, file);
        if (wrapped) output.push(wrapped);
        continue;
      }
      if (item.type !== 'Use') {
        output.push(expandNested(item, file));
        continue;
      }
      const target = path.resolve(path.dirname(file), item.path);
      if (visiting.has(target)) {
        errors.push({ ...where(item, file), message: `use 가 순환합니다: ${item.path}` });
        continue;
      }
      let text;
      try {
        text = readFile(target);
      } catch {
        errors.push({ ...where(item, file), message: `불러올 파일이 없습니다: ${item.path}` });
        continue;
      }
      sources.set(target, text);
      visiting.add(target);
      const included = load(text, target, context);
      if (included) {
        const body = context === 'top'
          ? (included as ProgramNode).body
          : (included as Member[]);
        output.push(...expand(body, target, context));
      }
      visiting.delete(target);
    }
    return output;
  };

  /**
   * 불러온 파일 조각을 오브젝트로 감싸서 반환합니다. 오브젝트의 이름은 파일 이름으로 설정됩니다.
   * 
   * @param item 오브젝트 형태로 포함할 `UseObject` 노드
   * @param file 현재 처리 중인 파일 경로
   * @returns 생성된 오브젝트 노드 또는 실패 시 null
   */
  const expandUseObject = (item: UseObjectNode, file: string): ObjectNode | null => {
    const target = path.resolve(path.dirname(file), item.path);
    if (visiting.has(target)) {
      errors.push({ ...where(item, file), message: `use 가 순환합니다: ${item.path}` });
      return null;
    }
    let text;
    try {
      text = readFile(target);
    } catch {
      errors.push({ ...where(item, file), message: `불러올 파일이 없습니다: ${item.path}` });
      return null;
    }
    sources.set(target, text);
    visiting.add(target);
    const members = load(text, target, 'object');
    visiting.delete(target);
    if (!members) return null;

    return {
      type: 'Object',
      kind: item.kind,
      name: path.basename(target, path.extname(target)),
      body: expand(members as ObjectMember[], target, 'object') as ObjectMember[],
      loc: item.loc,
    };
  };

  const expandNested = (item: Member, file: string): Member => {
    if (item.type === 'Scene') {
      return { ...item, body: expand(item.body, file, 'scene') as SceneMember[] };
    }
    if (item.type === 'Object') {
      return { ...item, body: expand(item.body, file, 'object') as ObjectMember[] };
    }
    return item;
  };

  const program = load(source, filePath, 'top') as ProgramNode | null;
  if (!program) return { ast: null, errors, warnings, sources };

  visiting.add(path.resolve(filePath));
  const body = expand(program.body, filePath, 'top') as TopLevelItem[];
  return { ast: { ...program, body }, errors, warnings, sources };
}

function defaultReadFile(target: string): string {
  return fs.readFileSync(target, 'utf-8');
}

function position(node: Node, text: string) {
  const offset = node?.loc?.start ?? 0;
  return { ...lineAndColumn(text, offset), offset };
}

/** 
 * 불러온 파일의 노드에 원래 어느 파일에서 왔는지 출처를 표시합니다. 
 * 이는 컴파일 에러 발생 시 정확한 위치를 추적하고 계산하는 데 사용됩니다.
 * 
 * @param node 출처를 표시할 AST 노드
 * @param file 원래 파일의 경로
 * 
 * @example
 * stampSource(astNode, "utils.tess");
 */
function stampSource(node: unknown, file: string) {
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach((child) => stampSource(child, file));
    return;
  }
  const { loc } = node as { loc?: { file?: string } };
  if (loc && !loc.file) loc.file = file;
  for (const [key, value] of Object.entries(node)) {
    if (key !== 'loc') stampSource(value, file);
  }
}
