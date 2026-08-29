// ============================================================================
//  Tess semantic model
//
//  This file declares the AST the language server works on. Parsing is not
//  generated from it: Tess is whitespace sensitive and nearly every keyword
//  doubles as a name, which an LL parser cannot decide from token shape alone.
//  The executable grammar lives in `src/parser` at the repository root, and
//  `tess-bridge.ts` maps its output onto the types declared here, so the editor
//  and the compiler always agree on what a file means.
//
//  `TessFile` is the generator's entry symbol and is never parsed.
// ============================================================================
grammar Tess

entry TessFile:
    {infer TessFile} 'tess' name=ID?;

// ---------------------------------------------------------------------------
//  Declarations
// ---------------------------------------------------------------------------
interface Program {
    body: TopLevel[];
}

type TopLevel = Project | Scene | ObjectDecl | FunctionDecl | VarDecl | ListDecl | Use | UseObject;
type SceneMember = ObjectDecl | UseObject | Use | Property;
type ObjectMember = VarDecl | ListDecl | FunctionDecl | Event | Use | Property | BoxSize | Center | Costume | Sound;

interface Use {
    path: string;
}

interface UseObject {
    kind: string;
    path: string;
}

interface Project {
    fields: ProjectField[];
}

interface ProjectField {
    field: string;
    value: StringLiteral | NumberLiteral;
}

interface Scene {
    name: string;
    body: SceneMember[];
}

interface ObjectDecl {
    kind: string;
    name: string;
    body: ObjectMember[];
}

interface Property {
    name: string;
    value?: Expression | KeywordValue;
}

interface KeywordValue {
    name: string;
}

interface BoxSize {
    width: number;
    height: number;
}

interface Center {
    x: number;
    y: number;
}

interface Costume {
    id: string;
    file: string;
    isDefault: boolean;
    width?: number;
    height?: number;
    forceId?: string;
}

interface Sound {
    id: string;
    file: string;
    duration?: number;
    forceId?: string;
}

interface FunctionDecl {
    name: string;
    params: string[];
    booleanParams: string[];
    body: Statement[];
}

interface VarDecl {
    name: string;
    value?: Expression;
}

interface ListDecl {
    name: string;
    value?: ListLiteral;
}

interface Event {
    event: string;
    key?: string;
    signal?: string;
    body: Statement[];
}

// ---------------------------------------------------------------------------
//  Statements
// ---------------------------------------------------------------------------
type Statement =
      If | Repeat | While | Until | Forever | Wait
    | Break | Skip | Restart | Return
    | Stop | StopSound | StopDraw | StopFill | StopBgm | StopTimer
    | StartDraw | StartFill | StartTimer | ResetSize | ResetTimer | Clear
    | Send | Clone | DeleteClone | DeleteClones | Jump
    | Forward | Bounce | Move | Go | Turn | Steer | Look
    | Show | Hide | CostumeStep | Say | Think | Flip | Order
    | TextWrite | Stamp | PlayBgm | PlaySound | Read | TtsSetting
    | ListAdd | ListInsert | ListRemove | Ask
    | Assign | ExpressionStatement
    | VarDecl | ListDecl;

interface If {
    test?: Expression;
    consequent: Statement[];
    alternate?: Statement[];
}

interface Repeat {
    count?: Expression;
    body: Statement[];
}

interface While {
    test?: Expression;
    body: Statement[];
}

interface Until {
    test?: Expression;
    body: Statement[];
}

interface Forever {
    body: Statement[];
}

interface Wait {
    value?: Expression;
}

interface Break { }
interface Skip { }
interface Restart { }

interface Return {
    value?: Expression;
}

interface Stop {
    target: string;
}

interface StopSound {
    target: string;
}

interface StopDraw { }
interface StopFill { }
interface StopBgm { }
interface StopTimer { }
interface StartDraw { }
interface StartFill { }
interface StartTimer { }
interface ResetSize { }
interface ResetTimer { }

interface Clear {
    target: string;
}

interface Send {
    signal?: Expression;
    wait: boolean;
}

interface Clone {
    target?: Expression;
}

interface DeleteClone { }
interface DeleteClones { }

interface Jump {
    // `jump next` and `jump back` name a relative scene; anything else is an
    // expression that evaluates to a scene name.
    where?: string;
    target?: Expression;
}

interface Forward {
    distance?: Expression;
    angle?: Expression;
}

interface Bounce { }

interface Move {
    x?: Expression;
    y?: Expression;
    duration?: Expression;
}

interface Go {
    x?: Expression;
    y?: Expression;
    target?: Expression;
    duration?: Expression;
}

interface Turn {
    angle?: Expression;
    duration?: Expression;
}

interface Steer {
    angle?: Expression;
    duration?: Expression;
}

interface Look {
    target?: Expression;
}

interface Show {
    target?: Expression;
}

interface Hide {
    target?: Expression;
}

interface CostumeStep {
    direction: string;
}

interface Say {
    message?: Expression;
    duration?: Expression;
}

interface Think {
    message?: Expression;
    duration?: Expression;
}

interface Flip {
    axis: string;
}

interface Order {
    to: string;
}

interface TextWrite {
    mode: string;
    value?: Expression;
}

interface Stamp { }

interface PlayBgm {
    name?: Expression;
}

interface PlaySound {
    name?: Expression;
    duration?: Expression;
    from?: Expression;
    to?: Expression;
    wait: boolean;
}

interface Read {
    value?: Expression;
    wait: boolean;
}

interface TtsSetting {
    voice?: StringLiteral;
    speed?: StringLiteral;
    pitch?: StringLiteral;
}

interface ListAdd {
    list?: Identifier;
    value?: Expression;
}

interface ListInsert {
    list?: Identifier;
    value?: Expression;
    index?: Expression;
}

interface ListRemove {
    list?: Identifier;
    index?: Expression;
}

interface Ask {
    question?: Expression;
}

interface Assign {
    operator: string;
    target?: Identifier | Index;
    value?: Expression;
}

interface ExpressionStatement {
    expression?: Expression;
}

// ---------------------------------------------------------------------------
//  Expressions
// ---------------------------------------------------------------------------
type Expression =
      Binary | Unary | Identifier | Call | Index | ListLiteral
    | NumberLiteral | StringLiteral | BooleanLiteral | Color | Transparent;

interface Binary {
    operator: string;
    left?: Expression;
    right?: Expression;
}

interface Unary {
    operator: string;
    argument?: Expression;
}

interface Identifier {
    name: string;
}

interface Call {
    callee: string;
    arguments: Expression[];
}

interface Index {
    target?: Expression;
    index?: Expression;
}

interface ListLiteral {
    elements: Expression[];
}

interface NumberLiteral {
    value: number;
}

interface StringLiteral {
    value: string;
}

interface BooleanLiteral {
    value: boolean;
}

interface Color {
    value: string;
}

interface Transparent { }

terminal ID: /[_\p{L}][\p{L}0-9_]*/u;
hidden terminal WS: /\s+/;
hidden terminal COMMENT: /#[^\n\r]*/;
