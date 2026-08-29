# Tess Ohm 문법 명세서

`src/tess.ohm`에 정의된 [Ohm](https://ohmjs.org/) 문법을 규칙 단위로 정리한 문서다.
"이 텍스트가 Tess 코드로서 올바른가"를 판단하는 층만 다룬다 — 그 코드가 실제로
무슨 뜻인지는 `src/ast.js`(CST → AST)와 `src/validate.js`(의미 검사)가 담당하고,
엔트리 블록으로 바꾸는 일은 `src/compiler/*.js`가 담당한다. 이 문서는 그 앞단,
문법 자체의 구조와 그 안에 쓰인 PEG 기법들을 다룬다.

목차
1. [파이프라인에서 문법의 위치](#1-파이프라인에서-문법의-위치)
2. [표기 규약](#2-표기-규약)
3. [규칙 전체 구조](#3-규칙-전체-구조)
4. [1부 — 프로그램의 뼈대](#4-1부--프로그램의-뼈대)
5. [2부 — 이벤트](#5-2부--이벤트)
6. [3부 — 문장](#6-3부--문장)
7. [4부 — 표현식과 연산자 우선순위](#7-4부--표현식과-연산자-우선순위)
8. [5부 — 어휘 규칙(터미널)](#8-5부--어휘-규칙터미널)
9. [PEG 특이 기법 모음](#9-peg-특이-기법-모음)
10. [문법 규칙 → AST 노드 대응표](#10-문법-규칙--ast-노드-대응표)
11. [문법을 직접 다뤄보기](#11-문법을-직접-다뤄보기)
12. [문법을 확장할 때 체크리스트](#12-문법을-확장할-때-체크리스트)

---

## 1. 파이프라인에서 문법의 위치

```
src/tess.ohm  ─(ohm.grammar)─▶  src/grammar.js  ─(createSemantics)─▶  src/ast.js
     │                                                                    │
     │  PEG 문법: "문법적으로 맞는 코드인가"                                │  CST → AST
     ▼                                                                    ▼
grammar.match(source)                                              src/validate.js
     │  실패하면 match.shortMessage 로 줄·열 오류                          │  의미 검사
     ▼                                                                    ▼
             src/parse.js 의 parse() 가 이 전체를 감싼다        src/compiler/*.js (AST → 엔트리 블록)
```

- `src/grammar.js`는 `tess.ohm` 파일을 문자열로 읽어 `ohm.grammar()`에 넘겨
  `Grammar` 인스턴스 하나(`grammar`)를 만든다. 문법 자체에는 아무 의미 로직도 없다.
- `src/parse.js`의 `parse(source)`가 `grammar.match(source)`로 파스 트리(CST)를 얻고,
  성공하면 `semantics(match).ast()`로 AST를 만든 뒤 `validate()`로 의미 검사를 한다.
- `check(source)`는 `grammar.match(source).succeeded()`만 보는 가장 가벼운 통로이고,
  `trace(source)`는 Ohm의 내장 트레이서로 규칙이 어떻게 시도됐는지 보여준다
  (`node index.js check/ast <파일>`, `test/grammar.test.js` 참고).

## 2. 표기 규약

파일 맨 위 주석에 적힌 규약 두 가지가 문법 전체를 관통한다.

| 규약 | 의미 |
|---|---|
| **대문자로 시작하는 규칙** (`Program`, `Statement`, `Expr` …) | **구문 규칙**(syntactic rule). 규칙 적용 사이의 공백·줄바꿈·주석을 Ohm이 자동으로 건너뛴다. |
| **소문자로 시작하는 규칙** (`identifier`, `stringLiteral`, `if` …) | **어휘 규칙**(lexical rule). 공백을 자동으로 건너뛰지 않는다 — 키워드·리터럴·연산자처럼 "붙어 있어야 의미가 있는" 토큰에 쓴다. |

이 구분 덕분에 `Statement`류 규칙 안에서는 토큰 사이 공백을 신경 쓰지 않고 그냥
나열만 하면 되고, `identifierName = identifierStart identifierPart*`처럼 글자
하나하나가 실제로 붙어 있어야 하는 규칙은 소문자로 시작해서 안전하게 막는다.

`end`는 Ohm 내장 규칙(입력의 끝, end-of-input)이라 같은 이름으로 재정의할 수
없다. 그래서 블록을 닫는 `end` 키워드는 파일 전체에서 `end_`라는 이름으로
정의돼 있다 (`end_ = "end" ~identifierPart`).

## 3. 규칙 전체 구조

문법 파일은 원문 자체가 5부로 나뉘어 있고, 이 문서도 같은 순서를 따른다.

1. **프로그램의 뼈대** — `Program`부터 `object`/`scene`/`function`/`var`/`list` 선언까지
2. **이벤트** — `when ...`
3. **문장(Statement)** — 제어 흐름부터 움직임·모양·소리·자료까지 40여 개 문장 규칙
4. **표현식(Expr)** — 연산자 우선순위 사다리와 내장 함수/인덱스 호출
5. **어휘 규칙(터미널)** — 리터럴, 식별자, 키워드 106개, 대입 연산자

최상위 진입점은 `Program`이다.

```ohm
Program = TopLevelItem*

TopLevelItem
  = ProjectDecl | SceneDecl | ObjectDecl | TextDecl
  | FunctionDecl | UseObjectDecl | UseDecl | VarDecl | ListDecl
```

`use "파일"`은 파일 내용을 그 자리에 그대로 이어붙이는 방식이라, `use`로
불러오는 조각 파일은 `object`/`text` 선언만 담고 있어도 돼야 한다. 그래서
최상위에서도 `object`/`text` 선언을 허용해 뒀다. 조각 파일이 정확히 어떤
모양이어야 하는지는 문맥에 따라 컴파일러가 아래 두 시작 규칙 중 하나로
다시 파싱해서 판단한다 (둘 다 `Program`이 아니라 별도 시작 규칙).

```ohm
SceneFragment  = SceneMember*   // scene 안에 use 로 끼워 넣을 때
ObjectFragment = ObjectMember*  // object/text 안에 use 로 끼워 넣을 때
```

## 4. 1부 — 프로그램의 뼈대

| 규칙 | 정의 | 설명 |
|---|---|---|
| `UseDecl` | `use stringLiteral` | 파일 통째로 포함 |
| `UseObjectDecl` | `useobject S` `--object` \| `usetext S` `--text` | 불러온 파일을 오브젝트/글상자 하나로 감싼다. 이름은 파일 이름이 된다 |
| `ProjectDecl` | `project blockOpen ProjectField* end_` | `project: title "..." description "..." fps 60 end` |
| `ProjectField` | `title S` \| `description S` \| `fps N` | 세 필드 각각 `--title`/`--description`/`--fps` 케이스 |
| `SceneDecl` | `scene S blockOpen SceneMember* end_` | 장면 하나 |
| `SceneMember` | `ObjectDecl \| TextDecl \| UseObjectDecl \| UseDecl` | 장면 안에 올 수 있는 것 |
| `ObjectDecl` / `TextDecl` | `object\|text S blockOpen ObjectMember* end_` | 오브젝트/글상자 선언. 문법 규칙은 거의 동일하고 키워드만 다르다 |
| `ObjectMember` | `PropertyDecl \| VarDecl \| ListDecl \| FunctionDecl \| EventHandler \| UseDecl` | 오브젝트 본문에 올 수 있는 것 |
| `PropertyDecl` | 아래 표 참고 | 오브젝트 속성 한 줄 |
| `propertyName` | `"scale_x" \| "scale_y" \| ... ` (긴 이름 먼저) | `이름 = 값` 형태 속성의 키 |
| `rotateMethod` | `free \| vertical \| none` | 회전 방식 |
| `FunctionDecl` | `function id "(" ListOf<FunctionParam, ","> ")" blockOpen Block end_` | 함수 선언. 매개변수는 콤마로 나열 |
| `FunctionParam` | `identifier "?"?` | 매개변수 하나. 뒤의 `?` 는 "엔트리에서도 판단 칸" (SPEC-ADDENDUM.md 4.6) |
| `VarDecl` | `var id "=" ~"=" Expr` | 변수 선언(대입 연산자 `==`와 헷갈리지 않게 `~"="`로 막음) |
| `ListDecl` | `list id "=" ~"=" ListLiteral` | 리스트 선언. 초기값은 반드시 `[...]` 리터럴 |

`PropertyDecl`의 케이스는 **선언 순서가 그대로 우선순위**다 (PEG의 순서 있는
선택은 처음 성공하는 대안을 채택하므로, 더 긴/더 구체적인 형태를 먼저 둬야
한다).

```ohm
PropertyDecl
  = default costume id S size N N   -- defaultCostumeSized   // size 가 있는 형태 먼저
  | default costume id S            -- defaultCostume
  | costume id S size N N           -- costumeSized
  | costume id S                    -- costume
  | sound id S for N                -- soundLength             // for 가 있는 형태 먼저
  | sound id S                      -- sound
  | name S                          -- name
  | visible B                       -- visible
  | lock B                          -- lock
  | rotation rotateMethod           -- rotation
  | size N N                        -- boxSize                 // 글상자틀 크기
  | center sN sN                    -- center                  // 무게중심(중심점)
  | propertyName "=" ~"=" Expr      -- assign                  // 그 외 전부(`x = 10` 등)
```

`center` 의 두 값은 `signedNumberLiteral`(`"-"? numberLiteral`)이다 — 중심점은 그림
밖으로도 끌어낼 수 있어서 음수가 된다. 렉시컬 규칙이라 붙여 쓴 부호만 받는다
(`- 5` 는 뺄셈으로 남는다).

`boxSize`(`size 65.49 104.65`)와 `assign`의 `size = 150`은 같은 `size` 키워드로
시작하지만 겹치지 않는다 — `boxSize`는 뒤에 `numberLiteral` 두 개를 요구하므로
`size =`를 만나면 실패하고 `assign`으로 넘어간다. 둘은 정하는 것도 다르다:
`size = 150`은 배율(%), `size 65.49 104.65`는 글상자틀의 픽셀 크기다.

글상자틀 크기가 문법에 있는 이유: 엔트리는 이 값을 글자를 실제로 그려 보고 재
두는데, 컴파일러는 글꼴을 그릴 수 없어 `글자수 × fontSize × 0.85`로 어림잡는다.
줄바꿈(`line_break`) 글상자는 폭이 줄 나눔을, 높이가 줄 수를 정하므로 어림값과
크게 어긋난다(실제 작품에서 65×105짜리가 95×15로 납작해졌다). 그래서 되돌리기는
글상자에 한해 이 줄을 늘 적어 둔다.

`propertyName`도 같은 이유로 `"scale_x"`, `"font_color"`처럼 **긴 이름을 접두어인
짧은 이름보다 먼저** 나열해 둔다 — `"font"`가 `"font_color"`보다 먼저 오면 PEG는
`"font_color = ..."`의 `font`까지만 먹고 멈춰버려서 `_color = ...`가 남는 사고가
난다.

## 5. 2부 — 이벤트

`EventHandler` 하나가 스크립트(엔트리의 "실행 스레드") 하나를 만든다. 전부
`when` 으로 시작해서 `blockOpen Block end_`로 몸통을 감싸는 동일한 모양이고,
`when` 다음에 오는 키워드 조합만 다르다.

| 케이스 | 문법 | 대응하는 엔트리 이벤트 |
|---|---|---|
| `-- sceneStart` | `when scene start` | 장면이 시작될 때 |
| `-- start` | `when start` | (오브젝트) 시작하기 버튼을 클릭했을 때 |
| `-- keyUp` | `when key "space" up` | 키를 뗐을 때 |
| `-- key` | `when key "space"` | 키를 눌렀을 때 |
| `-- stageClickUp` / `-- stageClick` | `when stage click [up]` | 마우스 클릭을 뗐을 때 / 클릭했을 때(무대) |
| `-- clickUp` / `-- click` | `when click [up]` | 클릭을 뗐을 때 / 클릭했을 때(오브젝트) |
| `-- signal` | `when signal "이름"` | 신호를 받았을 때 |
| `-- cloned` | `when cloned` | 복제본이 처음 생성됐을 때 |

`up`이 붙은 형태(뗐을 때)를 붙지 않은 형태보다 먼저 시도하는 순서 자체는
`StopStatement`류처럼 필수는 아니지만("클릭했을 때"와 "클릭을 뗐을 때"는
`up` 토큰의 유무로 이미 구분되므로 순서와 무관하게 모호하지 않다), 코드
전체의 "구체적인 형태 먼저" 관례를 따른 것이다.

## 6. 3부 — 문장

```ohm
Block = Statement*
blockOpen = ":" | then | do   // 여는 토큰은 셋 중 아무거나, 닫는 토큰은 항상 end
```

`Statement`는 40여 개 하위 규칙의 순서 있는 선택이다. 키워드로 시작하는
문장을 전부 먼저 시도하고, 식별자로 시작하는 대입/호출 문장(`AssignStatement`,
`CallStatement`)을 맨 마지막에 둔다 — 그래야 `move`, `wait`처럼 키워드로
시작하는 줄이 실수로 "함수 호출"로 잘못 해석되지 않는다.

```ohm
Statement
  = IfStatement | RepeatStatement | WhileStatement | UntilStatement
  | ForeverStatement | WaitStatement | ReturnStatement | FlowStatement
  | StopStatement | StartStatement | ResetStatement | ClearStatement
  | SignalStatement | CloneStatement | DeleteStatement | JumpStatement
  | MoveStatement | RotateStatement | LooksStatement | TextStatement
  | PenStatement | SoundStatement | DataStatement
  | VarDecl | ListDecl | AssignStatement | CallStatement
```

아래는 절 단위로 묶어서 정리한 표다. `S`=`stringLiteral`, `N`=`numberLiteral`,
`E`=`Expr`.

### 6.1 조건·반복 (spec 5.1–5.2)

| 규칙 | 형태 |
|---|---|
| `IfStatement` | `if E blockOpen Block [else blockOpen Block] end_` (`--ifElse` / `--if`) |
| `RepeatStatement` | `repeat E blockOpen Block end_` |
| `WhileStatement` | `while E blockOpen Block end_` |
| `UntilStatement` | `until E blockOpen Block end_` |
| `ForeverStatement` | `forever blockOpen Block end_` |

### 6.2 흐름 제어 (spec 5.3)

| 규칙 | 형태 |
|---|---|
| `WaitStatement` | `wait E` |
| `FlowStatement` | `break` \| `skip` \| `restart` |
| `ReturnStatement` | `return E` |
| `StopStatement` | 아래 참고 |
| `StartStatement` | `start draw\|fill\|timer` |
| `ResetStatement` | `reset size\|timer` |
| `ClearStatement` | `clear effects\|bubble\|draw\|text` |

`StopStatement`는 `stop` 뒤에 오는 키워드에 따라 뜻이 완전히 달라지는
대표적인 예다. **인자가 있는 형태를 전부 먼저 시도하고, 아무 인자도 없는
단독 `stop`을 맨 마지막에 둔다** — 그렇지 않으면 `stop all`이 "단독 `stop`
문장 + 다음 줄의 `all`(존재하지 않는 문장)"로 잘못 잘릴 수 있다.

```ohm
StopStatement
  = stop sound this  -- soundThis
  | stop sound all   -- soundAll
  | stop draw        -- draw
  | stop fill        -- fill
  | stop bgm         -- bgm
  | stop timer       -- timer
  | stop other       -- other
  | stop me          -- me
  | stop them        -- them
  | stop all         -- all
  | stop             -- script   // 반드시 마지막
```

### 6.3 신호·복제·장면 전환 (spec 7)

| 규칙 | 형태 |
|---|---|
| `SignalStatement` | `send E`(신호만 보냄) \| `call E`(신호를 보내고 응답을 기다림) |
| `CloneStatement` | `clone #sameLine E` \| `clone`(자기 자신 복제) |
| `DeleteStatement` | `del clones` \| `del clone` \| `kill` |
| `JumpStatement` | `jump next` \| `jump back` \| `jump E`(장면 이름) |

`CloneStatement`의 `#sameLine`은 인자 없는 `clone` 다음 줄이 식별자로
시작할 때 그 식별자를 인자로 삼켜버리는 걸 막는다 — [9장](#9-peg-특이-기법-모음)에서
자세히 다룬다.

### 6.4 움직임·회전 (spec 8.1–8.2)

```ohm
MoveStatement
  = forward E at E                   -- forwardAt
  | forward E                        -- forward
  | bounce                           -- bounce
  | move PosExpr #sameLine PosExpr in E -- moveIn
  | move PosExpr #sameLine PosExpr      -- move
  | go PosExpr #sameLine PosExpr in E   -- goPointIn
  | go PosExpr #sameLine PosExpr        -- goPoint
  | go E in E                        -- goTargetIn
  | go E                             -- goTarget

RotateStatement
  = turn E in E   -- turnIn  | turn E   -- turn
  | steer E in E  -- steerIn | steer E  -- steer
  | look E        -- look
```

`move`/`go`처럼 **공백으로 인자를 두 개 나열하는 명령**은 각 인자를
`PosExpr`(=`UnaryExpr`, 이항 연산 없는 표현식 한 단계)로 제한한다. 그렇지
않으면 `move 50 -30`이 `move (50 - 30)`이라는 인자 하나로 붙어버린다. 이항
연산이 정말 필요하면 `move (a + b) 10`처럼 괄호로 감싸면 된다.

### 6.5 모양·대화·글상자·붓·소리 (spec 8.3–8.5, 9, 10)

```ohm
LooksStatement
  = show #sameLine id -- showTarget | show -- show
  | hide #sameLine id -- hideTarget | hide -- hide
  | next costume -- nextCostume | prev costume -- prevCostume
  | say E for E -- sayFor | say E -- say
  | think E for E -- thinkFor | think E -- think
  | flip x -- flipX | flip y -- flipY
  | order front -- orderFront | order back -- orderBack

TextStatement = write E -- write | append E -- append | prepend E -- prepend
PenStatement  = stamp
```

`show`/`hide`도 `#sameLine`으로 인자를 같은 줄로 제한한다. 그렇지 않으면

```tess
hide
say "숨었다"
```

가 `hide say`(즉 "say라는 대상을 숨겨라")로 잘못 붙어버린다 — ES5의 후위
`++`/`--`가 자동 세미콜론 삽입 규칙 때문에 줄바꿈을 넘지 못하게 막힌 것과
같은 종류의 문제를, 같은 방식(줄 경계 가드)으로 해결한 것이다.

```ohm
SoundStatement
  = play sound E for E and wait          -- soundForWait   // 가장 긴 형태부터
  | play sound E from E to E and wait    -- soundRangeWait
  | play sound E and wait                -- soundWait
  | play sound E for E                   -- soundFor
  | play sound E from E to E             -- soundRange
  | play sound E                         -- sound
  | play bgm E                           -- bgm
```

`and wait`가 붙은 형태를 반드시 먼저 시도해야, `play sound "a" and wait`가
"`play sound "a"`(재생만) + `and wait`(존재하지 않는 문장)"로 잘리지 않는다.

### 6.6 자료 (spec 13.2–13.3) · 대입 · 호출

```ohm
DataStatement
  = in id add E             -- listAdd
  | in id insert E at E     -- listInsert
  | remove id "[" E "]"     -- listRemove
  | ask E                   -- ask

AssignStatement = LValue assignOperator Expr
LValue = id "[" E "]" -- index | id -- name
CallStatement = CallExpr
```

## 7. 4부 — 표현식과 연산자 우선순위

```ohm
Expr = OrExpr
```

이항 연산자는 **우선순위가 낮은 것을 바깥(위)에, 높은 것을 안쪽(아래)에**
두는 사다리 형태로 인코딩돼 있다 — 전형적인 Ohm/PEG 좌결합 연산자 패턴이다.

```ohm
OrExpr      = OrExpr or AndExpr -- or | AndExpr
AndExpr     = AndExpr and NotExpr -- and | NotExpr
NotExpr     = not NotExpr -- not | CompareExpr
CompareExpr = CompareExpr "==" AddExpr -- eq  | ... (ne/le/ge/lt/gt) | AddExpr
AddExpr     = AddExpr "+" ~"=" MulExpr -- add | AddExpr "-" ~"=" MulExpr -- sub | MulExpr
MulExpr     = MulExpr "//" PowExpr -- intDiv | "*" ~"*" -- mul | "/" ~"=" -- div | "%" ~"=" -- mod | PowExpr
PowExpr     = UnaryExpr "**" ~"=" PowExpr -- pow | UnaryExpr   // 오른쪽만 재귀 = 우결합
UnaryExpr   = "-" UnaryExpr -- neg | PrimaryExpr
PosExpr     = UnaryExpr                    // 공백 나열 인자 전용, 이항 연산 없음
```

| 우선순위(낮음→높음) | 연산자 | 결합 방향 | 규칙 |
|---|---|---|---|
| 1 | `or` | 왼쪽 | `OrExpr` |
| 2 | `and` | 왼쪽 | `AndExpr` |
| 3 | `not`(단항) | — | `NotExpr` |
| 4 | `== != <= >= < >` | 왼쪽 | `CompareExpr` |
| 5 | `+ -`(이항) | 왼쪽 | `AddExpr` |
| 6 | `// * / %` | 왼쪽 | `MulExpr` |
| 7 | `**` | **오른쪽** | `PowExpr` |
| 8 | `-`(단항 음수) | — | `UnaryExpr` |
| 9 | 괄호·호출·인덱스·리터럴·식별자 | — | `PrimaryExpr` |

`PowExpr`만 왼쪽이 아니라 **오른쪽 자식을 재귀**시켜서(`UnaryExpr "**" PowExpr`)
`2 ** 3 ** 2 == 2 ** (3 ** 2)`가 되도록 우결합을 만든다. 나머지는 전부
`X op Y -- case | X`처럼 **왼쪽 자식이 자기 자신을 재귀**하는 표준 좌결합
패턴이다.

`CompareExpr`의 여섯 케이스는 순서가 중요하다 — `<=`가 `<`보다, `>=`가 `>`
보다 앞에 와야 한다. 그렇지 않으면 `<=`를 만났을 때 PEG가 `<`만 먼저 먹고
멈춰버려 `=`가 남는다(뒤이어 나올 `AddExpr`가 `= AddExpr`를 해석하지 못해
전체가 실패한다).

```ohm
PrimaryExpr
  = "(" Expr ")"  -- paren
  | CallExpr | IndexExpr
  | numberLiteral | stringLiteral | booleanLiteral | colorLiteral
  | transparent   -- transparent
  | identifier

CallExpr  = identifier "(" ListOf<Expr, ","> ")"
IndexExpr = identifier "[" Expr "]"
ListLiteral = "[" ListOf<Expr, ","> "]"
```

`CallExpr`은 **식별자 바로 뒤에 공백 없이 이어지는 형태만** 허용한다(1급
함수가 없는 언어라 "표현식을 호출한다"는 개념 자체가 없다). 이렇게 제한해
둔 덕분에, 줄바꿈 뒤에 우연히 `(`로 시작하는 다음 줄이 있어도 앞 표현식에
대한 호출로 오해하지 않는다 — 구문 규칙이라 공백을 자동으로 건너뛰긴
하지만, `CallExpr`이 `PrimaryExpr` 안의 특정 케이스로만 존재하므로 애초에
"표현식 다음에 `(...)`가 오면 호출"이라는 일반 규칙 자체가 없다.

## 8. 5부 — 어휘 규칙(터미널)

### 8.1 공백과 주석

```ohm
space += comment
comment = "#" ~colorBody (~lineTerminator any)*
lineTerminator = "\n" | "\r" | "\u2028" | "\u2029"
spacesNoNL = (~lineTerminator space)*
sameLine = ~(spacesNoNL lineTerminator)
```

- `space += comment`: Ohm 내장 `space` 규칙에 `comment`를 더해서, 구문
  규칙들이 자동으로 건너뛰는 "공백"에 주석도 포함시킨다.
- Tess의 주석은 `#`로 시작하는데, **색상 리터럴도 `#ff0000`처럼 `#`로
  시작**한다. 그래서 `comment`는 `"#" ~colorBody ...`로 "`#` 다음이 색상
  본문(6자리 16진수)이 **아닐 때만** 주석"이라고 부정 lookahead로 구분한다.
- `sameLine`은 "다음 토큰이 아직 같은 줄에 있는가"를 **입력을 소비하지
  않고** 확인하는 가드다. 반드시 `#sameLine`처럼 어휘화해서 써야 하는데,
  그냥 `sameLine`으로 쓰면 그 앞뒤의 구문 규칙이 자동 공백 스킵으로 줄바꿈을
  먼저 먹어버려서 판정 자체가 무의미해지기 때문이다 ([9장](#9-peg-특이-기법-모음) 참고).

### 8.2 리터럴

| 규칙 | 정의 | 비고 |
|---|---|---|
| `numberLiteral` | `digit+ "." digit+ --decimal` \| `digit+ --integer` | `(a number)`로 실패 메시지에 쓸 설명을 붙여 둠 |
| `stringLiteral` | `"\"" stringChar* "\""` | |
| `stringChar` | 유니코드 이스케이프(`\uXXXX`) \| 백슬래시 이스케이프 \| 그 외 문자 | `"`, `\`, 줄바꿈은 이스케이프 없이 못 씀 |
| `booleanLiteral` | `true \| false` | |
| `colorLiteral` | `"#" colorBody` | `(a color)` |
| `colorBody` | `hexDigit hexDigit hexDigit hexDigit hexDigit hexDigit ~identifierPart` | 정확히 6자리(Ohm 문법에는 `{n}` 반복 구문이 없어서 그대로 여섯 번 나열한다), 뒤에 식별자 글자가 이어지면 안 됨 |

### 8.3 식별자

```ohm
identifier (an identifier) = ~keyword identifierName
identifierName  = identifierStart identifierPart*
identifierStart = letter | "_"
identifierPart  = alnum | "_"
```

`~keyword`로 **예약어는 식별자가 될 수 없다**고 막는다. 단, `keyword` 규칙에
들어 있는 건 딱 10개뿐이다.

```ohm
keyword = and | or | not | true | false | end_ | then | do | in | wait
```

`name`, `size`, `costume`처럼 문장/속성 키워드로 쓰이는 나머지 96개 단어는
**여전히 변수명으로 쓸 수 있다** — 각 문맥(예: `PropertyDecl`)에서 이미
정해진 자리에만 그 키워드가 오도록 문법이 짜여 있어서, 굳이 전역으로
예약할 필요가 없기 때문이다. 진짜로 막아야 하는 10개는 표현식·블록
경계·연산자 자리에서 식별자와 자리를 다툴 수 있는 것들이다(`and`/`or`/`not`은
이항·단항 연산자, `end_`/`then`/`do`는 블록 경계, `in`은 `DataStatement`,
`wait`는 `WaitStatement`, `true`/`false`는 리터럴).

### 8.4 키워드 106개

모든 키워드 규칙은 `"문자열" ~identifierPart` 형태다. 뒤에 식별자를 이룰 수
있는 글자(영문자·숫자·`_`)가 이어지면 안 된다는 뜻이라, `forward`가
`for`로, `to_hex`가 `to`로 잘못 매칭되는 걸 막는다.

```
add        all        and        append     ask        at
back       bgm        bounce     break      bubble     call
clear      click      clone      cloned     clones     costume
default    del        description do        draw       effects
else       end_(end)  false      fill       flip       for
forever    forward    fps        free       from       front
function   go         hide       if         in         insert
jump       key        kill       list       lock       look
me         move       name       next       none       not
object     or         order      other      play       prepend
prev       project    remove     repeat     reset      restart
return     rotation   say        scene      send       signal
show       size       skip       sound      stage      stamp
start      steer      stop       text       them       then
think      this       timer      title      to         transparent
true       turn       until      up         use        useobject
usetext    var        vertical   visible    wait       when
while      write      x          y
```

(`end_`는 소스 문자열로는 `"end"`다. 재정의 불가능한 Ohm 내장 규칙 `end`를
피하려고 규칙 이름만 밑줄을 붙였다.)

### 8.5 대입 연산자

```ohm
assignOperator = "+=" | "-=" | "**=" | "*=" | "/=" | "%=" | "=" ~"="
```

복합 대입(`+=` 등)을 단순 대입(`=`)보다 먼저 시도한다. `**=`는 `*=`보다
먼저 와야 `**=`를 `*`(불일치) 취급하지 않는다. 맨 마지막 `"=" ~"="`는 `==`와
헷갈리지 않도록 뒤에 또 `=`가 오면 안 된다는 부정 lookahead다.

## 9. PEG 특이 기법 모음

이 문법 전체에서 반복적으로 쓰이는 기법을 모아 정리한다. 새 규칙을 추가할
때 아래 패턴을 먼저 찾아보면 대부분 재사용할 수 있다.

### 9.1 순서 있는 선택(ordered choice) — "구체적인/긴 것을 먼저"

PEG의 `|`는 정규식의 `|`와 달리 **처음 성공하는 대안을 그 자리에서 채택**하고
역추적하지 않는다(엄밀히는 그 대안 실패 시 다음 대안을 시도하지만, 한
대안이 부분적으로만 맞아도 "성공"으로 채택되면 끝이다). 그래서 겹치는
접두사를 가진 대안들은 **더 길거나 더 구체적인 쪽을 먼저** 둬야 한다.
이 문법에서 그 규칙을 지키는 곳:

- `PropertyDecl`: `size` 붙은 형태 → 안 붙은 형태, `size N N` → `size = Expr`
- `propertyName`: `"scale_x"` → (없음, `"scale"`은 애초에 없음), `"font_color"` → `"font"`
- `StopStatement`: 인자 있는 형태 전부 → 단독 `stop`
- `SoundStatement`: `and wait` 붙은 형태 → 안 붙은 형태
- `CompareExpr`: `<=`/`>=` → `<`/`>`
- `assignOperator`: `**=` → `*=`, `"="~"="` 마지막

### 9.2 부정 lookahead(`~`)로 모호성 해소

| 위치 | 코드 | 막는 것 |
|---|---|---|
| 주석 | `"#" ~colorBody` | 색상 리터럴 `#ff0000`을 주석으로 오인 |
| 대입/비교 | `"=" ~"="`, `"+" ~"="`, `"*" ~"*"` 등 | `=`+`=`(즉 `==`), 복합 대입, `**`를 이항 연산자 하나로 오인 |
| 키워드 경계 | `"forward" ~identifierPart` (전체 키워드 공통) | `forward`를 `for`+`ward`로 오인 |
| 식별자 | `~keyword identifierName` | 예약어를 식별자로 오인 |
| 색상 본문 | `hexDigit`을 여섯 번 나열 `~identifierPart` | `#ff0000abc`처럼 뒤에 글자가 더 붙는 잘못된 색상 |

### 9.3 `#sameLine` — 줄 경계를 넘지 않는 가드

```ohm
sameLine = ~(spacesNoNL lineTerminator)
```

"다음 토큰이 있긴 한데, 그 앞이 (줄바꿈 없는 공백 다음) 줄바꿈으로
끝나버리면 안 된다"는 부정 lookahead다. `clone`, `show`, `hide`, `move`,
`go`처럼 **인자가 있을 수도 없을 수도 있는 명령**에서, "다음 줄의 새
문장"을 "이번 줄 명령의 인자"로 잘못 삼키는 걸 막는 데 쓴다.

```tess
hide
say "숨었다"
```

`hide`(`LooksStatement_hide`, 인자 없음) 시도 → 성공. 만약 `#sameLine`
가드가 없었다면 `LooksStatement_hideTarget`(`hide #sameLine identifier`에서
`#sameLine`을 뺀 `hide identifier`)이 먼저 매칭돼서 `say`를 대상 식별자로
삼켜버렸을 것이다. 반드시 `#sameLine`처럼 `#` 접두사(어휘화 연산자)를 붙여
써야 한다 — 그냥 규칙 이름만 쓰면 그 규칙 앞뒤의 구문 규칙이 자동으로
공백(줄바꿈 포함)을 이미 건너뛴 뒤이므로 판정 시점에는 늦다.

`CloneStatement`도 같은 이유로 `clone #sameLine Expr`처럼 인자 앞에
`#sameLine`을 둔다.

### 9.4 최소 예약어 전략

`keyword` 규칙에는 정말로 다른 자리와 충돌할 수 있는 10개만 넣는다
([8.3절](#83-식별자) 참고). "쓸 수 있는 이름을 최대한 넓게 열어 둔다"는
설계 방향이 문법 수준에서부터 반영돼 있다.

### 9.5 구문 규칙 vs 어휘 규칙의 공백 처리 차이 활용

`PosExpr = UnaryExpr`처럼 **같은 것을 가리키는 규칙을 이름만 다르게 하나
더 만드는 경우**가 있다. `PosExpr`은 문법적으로는 `UnaryExpr`과 완전히
같지만, "공백으로 인자를 나열하는 명령에서 이항 연산 없는 표현식만
허용한다"는 **의도**를 규칙 이름으로 드러내고, `move`/`go` 쪽 문법에서
`Expr` 대신 이 이름을 씀으로써 실수로 `AddExpr` 이상을 끌어오는 걸 원천
차단한다.

## 10. 문법 규칙 → AST 노드 대응표

`src/ast.js`의 `semantics.addOperation('ast', {...})`가 각 문법 규칙(또는
`--caseName`이 붙은 하위 규칙)마다 하나씩 메서드를 정의해서 CST를 AST로
바꾼다. 규칙 이름과 만들어지는 AST `type`은 대부분 이렇게 대응한다
(전체는 `src/ast.js` 참고, 아래는 발췌).

| 문법 규칙 | AST `type` |
|---|---|
| `Program` | `Program` |
| `UseDecl` | `Use` |
| `UseObjectDecl_object` / `_text` | `UseObject` (`kind: 'object'\|'text'`) |
| `ProjectDecl` / `ProjectField_*` | `Project` / `ProjectField` |
| `SceneDecl` | `Scene` |
| `ObjectDecl` / `TextDecl` | `Object` (`kind: 'object'\|'text'`) |
| `PropertyDecl_*costume*` | `Costume` |
| `PropertyDecl_soundLength` / `_sound` | `Sound` |
| `PropertyDecl_name` / `_visible` / `_lock` / `_rotation` / `_assign` | `Property` |
| `PropertyDecl_boxSize` | `BoxSize` (`width`, `height` — 글상자 전용) |
| `PropertyDecl_center` | `Center` (`x`, `y` — 오브젝트 전용) |
| `FunctionDecl` | `FunctionDecl` |
| `VarDecl` / `ListDecl` | `VarDecl` / `ListDecl` |
| `EventHandler_*` | `Event` (`event: 'start'\|'key'\|'signal'\|...`) |
| `IfStatement_if` / `_ifElse` | `If` |
| `RepeatStatement` / `WhileStatement` / `UntilStatement` / `ForeverStatement` | `Repeat` / `While` / `Until` / `Forever` |
| `WaitStatement` | `Wait` |
| `FlowStatement_break` / `_skip` / `_restart` | `Break` / `Skip` / `Restart` |
| `ReturnStatement` | `Return` |
| `StopStatement_*` | `Stop` / `StopSound` / `StopDraw` / `StopFill` / `StopBgm` / `StopTimer` |
| `StartStatement_*` | `StartDraw` / `StartFill` / `StartTimer` |
| `ResetStatement_*` | `ResetSize` / `ResetTimer` |
| `ClearStatement_*` | `Clear` |
| `SignalStatement_send` / `_call` | `Send` (`wait: false\|true`) |
| `CloneStatement_*` | `Clone` |
| `DeleteStatement_*` | `DeleteClones` / `DeleteClone` |
| `JumpStatement_*` | `Jump` |
| `MoveStatement_*` | `Forward` / `Bounce` / `Move` / `Go` |
| `RotateStatement_*` | `Turn` / `Steer` / `Look` |
| `LooksStatement_*` | `Show` / `Hide` / `CostumeStep` / `Say` / `Think` / `Flip` / `Order` |
| `TextStatement_*` | `TextWrite` (`mode: 'write'\|'append'\|'prepend'`) |
| `PenStatement` | `Stamp` |
| `SoundStatement_*` | `PlaySound` / `PlayBgm` |
| `DataStatement_*` | `ListAdd` / `ListInsert` / `ListRemove` / `Ask` |
| `AssignStatement` | `Assign` |
| `LValue_index` | `Index` |
| `CallStatement` | `ExpressionStatement` |
| `OrExpr_or` / `AndExpr_and` / `CompareExpr_*` / `AddExpr_*` / `MulExpr_*` / `PowExpr_pow` | `Binary` (`operator` 필드로 구분) |
| `NotExpr_not` / `UnaryExpr_neg` | `Unary` |
| `PrimaryExpr_paren` | (감싼 표현식을 그대로 반환, 별도 노드 없음) |
| `PrimaryExpr_transparent` | `Transparent` |
| `CallExpr` | `Call` |
| `IndexExpr` | `Index` |
| `ListLiteral` | `ListLiteral` |
| `identifier` | `Identifier` |
| `numberLiteral_*` | `Number` |
| `stringLiteral` | `String` |
| `booleanLiteral` | `Boolean` |
| `colorLiteral` | `Color` |

모든 AST 노드는 `loc: { start, end }` (Ohm의 `node.source.startIdx/endIdx`,
`src/ast.js`의 `at()`)를 갖는다. 이 오프셋은 `src/validate.js`의
`lineAndColumn(source, offset)`으로 줄·열로 변환되어 에러/경고 메시지에
쓰이고, 컴파일러(`src/compiler/context.js`)에서는 컴파일된 각 엔트리 블록의
소스 위치를 기록하는 소스맵(`Context#sourceMap`, `/sourcemap.json`으로
서빙됨 — 디버그 패널이 panic 난 블록을 원본 코드 위치로 되짚을 때 씀)에도
그대로 재사용된다.

## 11. 문법을 직접 다뤄보기

```bash
node index.js check <파일.tess>     # 문법 + 의미 검사, 통과하면 "OK"
node index.js ast   <파일.tess>     # AST 를 JSON 으로 출력
```

라이브러리로 쓸 때:

```js
import { grammar, check, trace, parse } from './index.js';

grammar.match(source).succeeded();   // 문법 검사만, 가장 빠름
check(source);                       // 위와 동일 (src/parse.js 의 헬퍼)
trace(source);                       // Ohm 트레이서 — 어떤 규칙이 어디서 실패했는지 단계별로 보여줌
parse(source);                       // { ok, ast, errors, warnings } — 문법 + 의미 검사
```

문법만 따로 테스트하는 건 `test/grammar.test.js`, AST 변환은
`test/ast.test.js`, 의미 검사는 `test/validate.test.js`에 있다.

## 12. 문법을 확장할 때 체크리스트

새 문장이나 표현식을 추가할 때 이 문법이 이미 쓰고 있는 관례를 따르면
사고가 줄어든다.

1. **어디에 낄지 정한다** — 새 문장이면 `Statement`의 선택지 목록에 추가
   (식별자로 시작하는 문장이 아니면 `AssignStatement`/`CallStatement`보다
   앞에), 새 연산자면 [7장](#7-4부--표현식과-연산자-우선순위)의 우선순위
   사다리에서 알맞은 층을 고른다.
2. **겹치는 접두사가 있는지 확인한다** — 있다면 더 긴/구체적인 대안을 위에
   둔다 (`9.1`).
3. **키워드에는 `~identifierPart`를 붙인다** — 안 그러면 그 키워드가 다른
   긴 식별자의 접두사와 충돌한다.
4. **정말 예약해야 하는 단어인지 따진다** — 다른 문맥과 자리를 다툴 여지가
   없다면 `keyword` 규칙에 넣지 않는다(`8.3`). 대부분의 새 키워드는 넣을
   필요가 없다.
5. **줄 경계를 넘나드는 모호함이 있는지 본다** — "인자가 있을 수도 없을
   수도 있는 명령" 뒤에 식별자/표현식이 곧장 온다면 `#sameLine`을 쓴다
   (`9.3`).
6. **`src/ast.js`에 대응하는 semantics 메서드를 추가한다** — 규칙 이름(또는
   `RuleName_caseName`)과 정확히 같은 이름이어야 하고, 안 그러면 Ohm이
   "missing semantic action" 오류를 던진다.
7. **`src/validate.js`/`src/compiler/*.js`에서 새 AST 타입을 처리한다** —
   문법은 "파싱만" 담당하므로, 의미 검사와 블록 컴파일은 별도로 이어줘야
   한다.
8. **`test/grammar.test.js`(+ `ast.test.js`, `compile.test.js`)에 케이스를
   추가한다.**
