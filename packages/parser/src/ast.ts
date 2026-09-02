/**
 * Tess AST 노드 구조를 정의합니다.
 * 방문자(visitor)가 이를 생성하고, 유효성 검사기, 컴파일러, 디컴파일러가 이를 읽습니다.
 * `type` 속성을 판별자로 사용하여 `switch` 문으로 안전하게 타입을 좁힐 수 있습니다.
 */

/**
 * 반개구간(half-open) 소스 코드 범위를 나타냅니다. `end` 값은 포함되지 않습니다.
 * 
 * @example
 * const loc: Loc = { start: 0, end: 10 };
 */
export interface Loc {
  start: number;
  end: number;
  /**
   * `use` 구문으로 가져온 파일에서 유래한 노드인 경우 파일 경로가 설정됩니다.
   * 
   * @example
   * loc.file = "other.tess";
   */
  file?: string;
}

interface Base {
  loc: Loc;
}

// ----------------------------------------------------------------------------
//  Expressions
// ----------------------------------------------------------------------------
export interface StringNode extends Base {
  type: 'String';
  value: string;
}

export interface NumberNode extends Base {
  type: 'Number';
  value: number;
}

export interface BooleanNode extends Base {
  type: 'Boolean';
  value: boolean;
}

export interface ColorNode extends Base {
  type: 'Color';
  value: string;
}

export interface TransparentNode extends Base {
  type: 'Transparent';
}

export interface Identifier extends Base {
  type: 'Identifier';
  name: string;
}

/**
 * 회전 방식과 같은 단일 옵션 키워드를 나타냅니다. 소스 범위(span) 없이 기록될 수 있습니다.
 * 
 * @example
 * const kw: KeywordNode = { type: 'Keyword', name: 'left_right' };
 */
export interface KeywordNode {
  type: 'Keyword';
  name: string;
  loc?: Loc;
}

export interface BinaryNode extends Base {
  type: 'Binary';
  operator: string;
  left: Expr;
  right: Expr;
}

export interface UnaryNode extends Base {
  type: 'Unary';
  operator: 'not' | '-';
  argument: Expr;
}

export interface CallNode extends Base {
  type: 'Call';
  callee: string;
  arguments: Expr[];
}

export interface IndexNode extends Base {
  type: 'Index';
  target: Expr;
  index: Expr;
  column: Expr | null;
}

export interface ListLiteralNode extends Base {
  type: 'ListLiteral';
  elements: Expr[];
}

export type Expr =
  | StringNode
  | NumberNode
  | BooleanNode
  | ColorNode
  | TransparentNode
  | Identifier
  | KeywordNode
  | BinaryNode
  | UnaryNode
  | CallNode
  | IndexNode
  | ListLiteralNode;

/**
 * 할당 또는 리스트 연산의 대상이 될 수 있는 좌변값(LValue) 타입입니다.
 */
export type LValue = Identifier | IndexNode;

// ----------------------------------------------------------------------------
//  Declarations
// ----------------------------------------------------------------------------
export interface UseNode extends Base {
  type: 'Use';
  path: string;
}

export interface UseObjectNode extends Base {
  type: 'UseObject';
  kind: 'object' | 'text';
  path: string;
}

export interface ProjectFieldNode extends Base {
  type: 'ProjectField';
  field: string;
  value: StringNode | NumberNode;
}

export interface ProjectNode extends Base {
  type: 'Project';
  fields: ProjectFieldNode[];
}

export interface SceneNode extends Base {
  type: 'Scene';
  name: string;
  body: SceneMember[];
}

export interface ObjectNode extends Base {
  type: 'Object';
  kind: string;
  name: string;
  body: ObjectMember[];
}

export interface PropertyNode extends Base {
  type: 'Property';
  name: string;
  value: Expr;
}

export interface BoxSizeNode extends Base {
  type: 'BoxSize';
  width: number;
  height: number;
}

export interface CenterNode extends Base {
  type: 'Center';
  x: number;
  y: number;
}

export interface CostumeNode extends Base {
  type: 'Costume';
  id: string;
  displayName: string | null;
  file: string;
  isDefault: boolean;
  width: number | null;
  height: number | null;
  forceId: string | null;
}

export interface SoundNode extends Base {
  type: 'Sound';
  id: string;
  displayName: string | null;
  file: string;
  duration: number | null;
  forceId: string | null;
}

export interface FunctionDeclNode extends Base {
  type: 'FunctionDecl';
  name: string;
  params: string[];
  booleanParams: string[];
  body: Stmt[];
}

export interface TableDeclNode extends Base {
  type: 'TableDecl';
  name: string;
  displayName: string | null;
  columns: Expr[];
  rows: Expr[][];
}

/**
 * 일반 지역 스토리지가 아닌 경우, 변수나 리스트가 저장되는 스코프를 나타냅니다.
 */
export type StorageScope = 'shared' | 'realtime';

export interface VarDeclNode extends Base {
  type: 'VarDecl';
  name: string;
  displayName: string | null;
  scope: StorageScope | null;
  value: Expr;
}

export interface ListDeclNode extends Base {
  type: 'ListDecl';
  name: string;
  displayName: string | null;
  scope: StorageScope | null;
  value: Expr;
}

// ----------------------------------------------------------------------------
//  Events
// ----------------------------------------------------------------------------
export type EventName =
  | 'start'
  | 'scene_start'
  | 'key'
  | 'key_up'
  | 'click'
  | 'click_up'
  | 'stage_click'
  | 'stage_click_up'
  | 'signal'
  | 'cloned';

export interface EventNode extends Base {
  type: 'Event';
  event: EventName;
  key?: string;
  signal?: string;
  body: Stmt[];
}

// ----------------------------------------------------------------------------
//  Statements
// ----------------------------------------------------------------------------
export interface IfNode extends Base {
  type: 'If';
  test: Expr;
  consequent: Stmt[];
  alternate: Stmt[] | null;
}

export interface RepeatNode extends Base {
  type: 'Repeat';
  count: Expr;
  body: Stmt[];
}

export interface WhileNode extends Base {
  type: 'While';
  test: Expr;
  body: Stmt[];
}

export interface UntilNode extends Base {
  type: 'Until';
  test: Expr;
  body: Stmt[];
}

export interface ForeverNode extends Base {
  type: 'Forever';
  body: Stmt[];
}

export interface WaitNode extends Base {
  type: 'Wait';
  value: Expr;
}

export interface ReturnNode extends Base {
  type: 'Return';
  value: Expr;
}

/**
 * 추가적인 속성 없이 소스 범위(span)와 타입만을 가지는 문장의 종류입니다.
 */
export type NullaryStatementType =
  | 'Break'
  | 'Skip'
  | 'Restart'
  | 'StopDraw'
  | 'StopFill'
  | 'StopBgm'
  | 'StopTimer'
  | 'StartDraw'
  | 'StartFill'
  | 'StartTimer'
  | 'ResetSize'
  | 'ResetTimer'
  | 'DeleteClone'
  | 'DeleteClones'
  | 'Bounce'
  | 'Stamp';

export interface NullaryNode extends Base {
  type: NullaryStatementType;
}

export interface StopSoundNode extends Base {
  type: 'StopSound';
  target: string;
}

export interface StopNode extends Base {
  type: 'Stop';
  target: string;
}

export interface ClearNode extends Base {
  type: 'Clear';
  target: string;
}

export interface SendNode extends Base {
  type: 'Send';
  signal: Expr;
  wait: boolean;
}

export interface CloneNode extends Base {
  type: 'Clone';
  target: Expr | null;
}

export interface JumpNode extends Base {
  type: 'Jump';
  target: Expr | string;
}

export interface ForwardNode extends Base {
  type: 'Forward';
  distance: Expr;
  angle: Expr | null;
}

export interface MoveNode extends Base {
  type: 'Move';
  x: Expr;
  y: Expr;
  duration: Expr | null;
}

export interface GoNode extends Base {
  type: 'Go';
  x: Expr | null;
  y: Expr | null;
  target: Expr | null;
  duration: Expr | null;
}

export interface TurnNode extends Base {
  type: 'Turn' | 'Steer';
  angle: Expr;
  duration: Expr | null;
}

export interface LookNode extends Base {
  type: 'Look';
  target: Expr;
}

export interface ShowHideNode extends Base {
  type: 'Show' | 'Hide';
  target: Expr | null;
  seconds: Expr | null;
  chart: Expr | null;
}

export interface CostumeStepNode extends Base {
  type: 'CostumeStep';
  direction: string;
}

export interface SayNode extends Base {
  type: 'Say' | 'Think';
  message: Expr;
  duration: Expr | null;
}

export interface FlipNode extends Base {
  type: 'Flip';
  axis: string;
}

export interface OrderNode extends Base {
  type: 'Order';
  to: string;
}

export interface TextWriteNode extends Base {
  type: 'TextWrite';
  mode: string;
  value: Expr;
}

export interface PlayBgmNode extends Base {
  type: 'PlayBgm';
  name: Expr;
}

export interface PlaySoundNode extends Base {
  type: 'PlaySound';
  name: Expr;
  duration: Expr | null;
  from: Expr | null;
  to: Expr | null;
  wait: boolean;
}

export interface ReadNode extends Base {
  type: 'Read';
  value: Expr;
  wait: boolean;
}

export interface TtsSettingNode extends Base {
  type: 'TtsSetting';
  voice: StringNode;
  speed: StringNode;
  pitch: StringNode;
}

export interface ListAddNode extends Base {
  type: 'ListAdd';
  list: LValue;
  value: Expr;
}

export interface ListInsertNode extends Base {
  type: 'ListInsert';
  list: LValue;
  value: Expr;
  index: Expr;
}

export interface ListRemoveNode extends Base {
  type: 'ListRemove';
  list: LValue;
  index: Expr;
}

/**
 * 테이블이 늘어나거나 줄어드는 방향을 나타냅니다.
 */
export type TableLine = 'row' | 'column';

export interface TableAddLineNode extends Base {
  type: 'TableAddLine' | 'TableInsertLine';
  table: LValue;
  line: TableLine;
  index: Expr | null;
}

export interface TableRemoveLineNode extends Base {
  type: 'TableRemoveLine';
  table: LValue;
  line: TableLine;
  index: Expr;
}

export interface TableSaveNode extends Base {
  type: 'TableSave';
  table: Expr;
}

export interface AskNode extends Base {
  type: 'Ask';
  question: Expr;
}

export interface ExpressionStatementNode extends Base {
  type: 'ExpressionStatement';
  expression: CallNode;
}

export interface AssignNode extends Base {
  type: 'Assign';
  operator: string;
  target: LValue;
  value: Expr;
}

export type Stmt =
  | IfNode
  | RepeatNode
  | WhileNode
  | UntilNode
  | ForeverNode
  | WaitNode
  | ReturnNode
  | NullaryNode
  | StopSoundNode
  | StopNode
  | ClearNode
  | SendNode
  | CloneNode
  | JumpNode
  | ForwardNode
  | MoveNode
  | GoNode
  | TurnNode
  | LookNode
  | ShowHideNode
  | CostumeStepNode
  | SayNode
  | FlipNode
  | OrderNode
  | TextWriteNode
  | PlayBgmNode
  | PlaySoundNode
  | ReadNode
  | TtsSettingNode
  | ListAddNode
  | ListInsertNode
  | ListRemoveNode
  | TableAddLineNode
  | TableRemoveLineNode
  | TableSaveNode
  | AskNode
  | ExpressionStatementNode
  | AssignNode
  | VarDeclNode
  | ListDeclNode
  | FunctionDeclNode;

// ----------------------------------------------------------------------------
//  Containers
// ----------------------------------------------------------------------------
export type ObjectMember =
  | VarDeclNode
  | ListDeclNode
  | FunctionDeclNode
  | EventNode
  | UseNode
  | PropertyNode
  | BoxSizeNode
  | CenterNode
  | CostumeNode
  | SoundNode;

export type SceneMember = ObjectNode | UseObjectNode | UseNode | PropertyNode;

export type TopLevelItem =
  | ProjectNode
  | SceneNode
  | ObjectNode
  | FunctionDeclNode
  | UseObjectNode
  | UseNode
  | VarDeclNode
  | ListDeclNode
  | TableDeclNode;

export interface ProgramNode extends Base {
  type: 'Program';
  body: TopLevelItem[];
}

/**
 * 방문자가 생성할 수 있는 모든 위치의 노드 타입입니다.
 */
export type Node =
  | ProgramNode
  | TopLevelItem
  | SceneMember
  | ObjectMember
  | Stmt
  | Expr
  | ProjectFieldNode
  | EventNode;

/**
 * 구문 분석기(`parse`)가 시작 규칙에 따라 반환하는 결과 타입입니다.
 * `Program`은 전체 프로그램을, 단편(fragment) 규칙은 일치하는 멤버들을, 표현식과 문장 규칙은 단일 노드를 반환합니다.
 */
export type ParseRoot = ProgramNode | SceneMember[] | ObjectMember[] | Stmt | Expr;

// ----------------------------------------------------------------------------
//  Diagnostics
// ----------------------------------------------------------------------------
/**
 * 구문 분석 또는 유효성 검사 중에 발견된 소스 파일 내의 문제를 나타냅니다.
 * 
 * @example
 * const diag: Diagnostic = { line: 1, column: 1, offset: 0, message: "에러" };
 */
export interface Diagnostic {
  line: number;
  column: number;
  offset: number;
  message: string;
  file?: string;
  detail?: string | null;
}

/**
 * 단일 프로그램에 대해 `validate`가 보고하는 검사 결과입니다.
 * 
 * @example
 * const result: ValidationResult = { errors: [], warnings: [] };
 */
export interface ValidationResult {
  errors: Diagnostic[];
  warnings: Diagnostic[];
}

/**
 * 구문 분석기(`parse`)의 반환 결과입니다. 성공 시 생성된 트리와 진단 정보를 포함합니다.
 * 
 * @example
 * const result: ParseResult = { ok: true, ast: programNode, errors: [], warnings: [] };
 */
export interface ParseResult<T = ParseRoot> {
  ok: boolean;
  ast: T | null;
  errors: Diagnostic[];
  warnings: Diagnostic[];
}
