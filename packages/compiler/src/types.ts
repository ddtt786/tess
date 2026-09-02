/**
 * @fileoverview 엔트리 작품(project.json)의 핵심 자료 구조 및 컴파일러 내부 타입 정의입니다.
 * 
 * 엔트리 엔진이 직접 읽어들이는 형태를 따르며, 
 * 컴파일 과정에서만 사용되는 데이터들은 하단의 "컴파일러 내부 타입" 섹션에 정의되어 있습니다.
 */
import type { Expr, FunctionDeclNode, ObjectNode, ParseRoot } from '@tess/parser';

/** 
 * 블록의 매개변수 슬롯에 들어갈 수 있는 값의 타입입니다. 
 * @example
 * const param: EntryParam = "문자열 값";
 */
export type EntryParam = EntryBlock | string | number | boolean | null;

/** 
 * 엔트리 블록 하나의 데이터 구조입니다.
 * `statements` 속성은 C형 블록(예: 반복문) 안에 중첩된 블록 리스트를 보관합니다.
 * @example
 * const block: EntryBlock = { id: "ab12", type: "move_direction", params: [10], ... };
 */
export interface EntryBlock {
  id: string;
  x: number;
  y: number;
  type: string;
  params: EntryParam[];
  statements: EntryBlock[][];
  movable: number | null;
  deletable: number;
  emphasized: boolean;
  readOnly: number | null;
  copyable: boolean;
  assemble: boolean;
  extensions: unknown[];
  comment?: EntryComment;
}

/** 
 * 특정 블록에 첨부된 메모(주석) 정보입니다. 
 * @example
 * const comment: EntryComment = { value: "이 블록은 이동을 담당합니다.", visible: true, ... };
 */
export interface EntryComment {
  x: number;
  y: number;
  width: number;
  height: number;
  value: string;
  readOnly: boolean;
  visible: boolean;
  display: boolean;
  movable: boolean;
  isOpened: boolean;
  deletable: number;
  type: string;
}

export interface EntryScene {
  id: string;
  name: string;
}

export interface EntryMessage {
  id: string;
  name: string;
}

/** 엔트리에서 변수, 리스트, 타이머, 대답을 구분하기 위해 내부적으로 사용하는 식별 타입입니다. */
export type VariableType = 'variable' | 'list' | 'timer' | 'answer';

export interface EntryVariable {
  id: string;
  name: string;
  visible: boolean;
  value: string | number;
  variableType: VariableType;
  isCloud: boolean;
  isRealTime: boolean;
  cloudDate: boolean;
  object: string | null;
  x: number;
  y: number;
  /** Lists only. */
  array?: Array<{ data: string | number }>;
  width?: number;
  height?: number;
}

export interface EntryTable {
  id: string;
  name: string;
  object: string | null;
  fields: string[];
  data: string[][];
  chart: unknown[];
}

/** 
 * 함수 호출 시 할당되고 종료 시 소멸하는 지역 변수입니다. 
 * @example
 * const local: FuncLocalVariable = { id: "loc1", name: "임시변수", value: 0 };
 */
export interface FuncLocalVariable {
  id: string;
  name: string;
  value: string | number;
}

export interface EntryFunction {
  id: string;
  type: string;
  localVariables: FuncLocalVariable[];
  useLocalVariables: boolean;
  content: string;
}

export interface EntryPicture {
  id: string;
  name: string;
  filename: string;
  fileurl: string;
  imageType?: string;
  dimension?: { width: number; height: number };
  ext?: string;
}

export interface EntrySound {
  id: string;
  name: string;
  filename: string;
  fileurl: string;
  duration?: number;
  ext?: string;
}

/** 그림이나 소리 리소스를 모두 포함할 수 있는 공통 에셋 타입입니다. */
export type EntryAsset = EntryPicture & EntrySound;

/** 
 * 오브젝트가 화면에 그려지는 위치, 크기, 회전 등의 속성 정보입니다. 
 * @example
 * const entity: EntryEntity = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 90, ... };
 */
export interface EntryEntity {
  x: number;
  y: number;
  regX: number;
  regY: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  direction: number;
  width: number;
  height: number;
  font: string;
  visible: boolean;
  /** Text boxes only. */
  colour?: string;
  text?: string;
  textAlign?: number;
  lineBreak?: boolean;
  bgColor?: string;
  underLine?: boolean;
  strike?: boolean;
  fontSize?: number;
}

export interface EntryObject {
  id: string;
  name: string;
  script: string;
  objectType: 'sprite' | 'textBox';
  rotateMethod: string;
  scene: string;
  sprite: { pictures: EntryPicture[]; sounds: EntrySound[] };
  lock: boolean;
  entity: EntryEntity;
  text?: string;
  selectedPictureId?: string | null;
}

export interface EntryProject {
  objects: EntryObject[];
  scenes: EntryScene[];
  variables: EntryVariable[];
  messages: EntryMessage[];
  functions: EntryFunction[];
  tables: EntryTable[];
  speed: number;
  interface: { menuWidth: number; canvasWidth: number; object: string | null };
  expansionBlocks: string[];
  aiUtilizeBlocks: string[];
  hardwareLiteBlocks: unknown[];
  externalModules: unknown[];
  externalModulesLite: unknown[];
  name: string;
  isPracticalCourse: boolean;
  description?: string;
}

// ============================================================================
//  컴파일러 내부 타입
// ============================================================================

/** 
 * 컴파일 중 발견된 소스 코드 내의 문제(오류 또는 경고) 정보입니다.
 * @example
 * const diag: CompileDiagnostic = { line: 10, column: 5, offset: 150, message: "구문 오류" };
 */
export interface CompileDiagnostic {
  line: number;
  column: number;
  offset: number;
  message: string;
  file?: string;
  detail?: string | null;
}

/** 
 * 생성된 블록이 원본 소스 코드의 어느 부분을 가리키는지 추적하기 위한 위치 정보입니다. 
 * @example
 * const span: SourceSpan = { file: "main.tess", line: 1, column: 0, endLine: 1, endColumn: 10 };
 */
export interface SourceSpan {
  file: string | null;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
}

export type SourceMap = Record<string, SourceSpan>;

/** 
 * 빌드 결과물에 함께 포함되어 복사될 외부 에셋(그림, 소리 등) 파일의 경로 정보입니다.
 * @example
 * const asset: AssetFile = { source: "./image.png", target: "temp/image/image.png" };
 */
export interface AssetFile {
  source: string;
  target: string;
}

/** 컴파일 파이프라인의 각 단계별 소요 시간입니다. */
export interface PhaseTiming {
  label: string;
  ms: number;
}

/** 
 * 최종 오브젝트로 조립되기 전, 컴파일 진행 중 상태의 오브젝트 정보입니다. 
 */
export interface CompiledObject {
  id: string;
  key: string;
  name: string;
  kind: string;
  scene: EntryScene;
  node: ObjectNode;
  pictures: Map<string, EntryPicture>;
  sounds: Map<string, EntrySound>;
  locals: Map<string, EntryVariable>;
  defaultPicture: EntryPicture | null;
  properties: Map<string, Expr>;
  boxSize: { width: number; height: number } | null;
  center: { x: number; y: number } | null;
  script: EntryBlock[][];
}

/** 컴파일이 진행 중인 상태의 사용자 정의 함수 정보입니다. */
export interface CompiledFunction {
  id: string;
  name: string;
  /** The declaration it came from; absent for the ones the compiler generates. */
  node?: FunctionDeclNode;
  /** Name of the object that declared it, or null for a global function. */
  owner?: string | null;
  params: string[];
  booleanParams?: Set<string>;
  /** Parameter name -> the entry block type that reads it. */
  paramTypes: Map<string, string>;
  isValue: boolean;
  localVariables: FuncLocalVariable[];
  /** Set on the functions the compiler writes itself (scale setters, power). */
  generated?: boolean;
  type?: string;
  content?: EntryBlock[][];
}

/** 특정 식별자 이름이 사용된 시점에 어떤 종류의 변수로 해석되는지 나타냅니다. */
export type VariableRef =
  | { kind: 'param'; name: string }
  | { kind: 'funcLocal'; name: string; id: string }
  | { kind: 'variable'; entry: EntryVariable; owner?: CompiledObject }
  | { kind: 'ambiguousLocal'; name: string; owners: string[] };

/** 외부에서 특정 모양이나 소리 이름을 참조할 때의 탐색 결과입니다. */
export type ResourceRef =
  | { kind: 'found'; asset: EntryPicture | EntrySound }
  | { kind: 'ambiguous'; owners: string[] };

/** 함수 본문을 컴파일할 때 필요한 매개변수와 지역 변수의 스코프 정보입니다. */
export interface FunctionScope {
  name: string;
  /** Parameter name -> the entry block type that reads it. */
  params: Map<string, string>;
  /** Local variable name -> its entry id. */
  localVars: Map<string, string>;
}

/** `compileProject` 실행 시 주입하는 컴파일 옵션 설정입니다. */
export interface CompileOptions {
  path?: string;
  assetDirs?: string[];
  name?: string;
  readFile?: (file: string) => string;
  force?: boolean;
  cache?: CompileCache;
  seed?: string;
  sources?: Map<string, string> | null;
  comments?: Map<string, string>;
  onPhase?: (phase: PhaseTiming) => void;
}

/** 파일 감시 모드(watch)에서 이미 분석된 구문 트리를 재사용하기 위한 캐시 상태입니다. */
export interface CompileCache {
  asts: Map<string, { text: string; ast: ParseRoot }>;
  reused: number;
  parsed: number;
}

/** 
 * 단일 컴파일 실행 후 생성된 결과물 및 오류, 경고 내역입니다.
 * @example
 * const result: CompileResult = { ok: true, project: myProject, errors: [], warnings: [], assets: [], timings: [] };
 */
export interface CompileResult {
  ok: boolean;
  project: EntryProject | null;
  errors: CompileDiagnostic[];
  warnings: CompileDiagnostic[];
  assets: AssetFile[];
  sourceMap?: SourceMap;
  timings: PhaseTiming[];
}
