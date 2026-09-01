// ============================================================================
//  엔트리 작품(project.json) 의 자료 구조
//
//  The names and shapes here are entry's, not ours — they are what entryjs
//  reads back. Anything the compiler needs only while building lives further
//  down, under "컴파일러 내부".
// ============================================================================
import type { Expr, FunctionDeclNode, ObjectNode, ParseRoot } from '@tess/parser';

/** What may sit in a block's parameter slot. */
export type EntryParam = EntryBlock | string | number | boolean | null;

/** One entry block. `statements` holds the nested block lists of a C-block. */
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

/** A note pinned to a block. */
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

/** A variable, a list, or one of the two entry keeps for itself. */
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

/** A variable that lives for one call of a function. */
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

/** A picture or a sound, before `makeAsset` decides which fields it keeps. */
export type EntryAsset = EntryPicture & EntrySound;

/** Where the object sits on the stage and how it is drawn. */
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
//  컴파일러 내부
// ============================================================================

/** One problem the compiler found, located in a source file. */
export interface CompileDiagnostic {
  line: number;
  column: number;
  offset: number;
  message: string;
  file?: string;
  detail?: string | null;
}

/** Where one block came from, so the debugger can point back at the source. */
export interface SourceSpan {
  file: string | null;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
}

export type SourceMap = Record<string, SourceSpan>;

/** A file the build copies next to the project. */
export interface AssetFile {
  source: string;
  target: string;
}

/** How long one compile phase took. */
export interface PhaseTiming {
  label: string;
  ms: number;
}

/** An object while it is being compiled, before `buildObject` finishes it. */
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

/** A function while it is being compiled. */
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

/** What a name resolves to at the point it is used. */
export type VariableRef =
  | { kind: 'param'; name: string }
  | { kind: 'funcLocal'; name: string; id: string }
  | { kind: 'variable'; entry: EntryVariable; owner?: CompiledObject }
  | { kind: 'ambiguousLocal'; name: string; owners: string[] };

/** What a costume or sound name resolves to from outside any object. */
export type ResourceRef =
  | { kind: 'found'; asset: EntryPicture | EntrySound }
  | { kind: 'ambiguous'; owners: string[] };

/** The scope a function body compiles in. */
export interface FunctionScope {
  name: string;
  /** Parameter name -> the entry block type that reads it. */
  params: Map<string, string>;
  /** Local variable name -> its entry id. */
  localVars: Map<string, string>;
}

/** How `compileProject` should read and build the source. */
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

/** Parsed files kept between builds, so a watch does not re-parse what it has. */
export interface CompileCache {
  asts: Map<string, { text: string; ast: ParseRoot }>;
  reused: number;
  parsed: number;
}

/** What one compile produced. */
export interface CompileResult {
  ok: boolean;
  project: EntryProject | null;
  errors: CompileDiagnostic[];
  warnings: CompileDiagnostic[];
  assets: AssetFile[];
  sourceMap?: SourceMap;
  timings: PhaseTiming[];
}
