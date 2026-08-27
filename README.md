# Tess — Ohm 문법 구현

[Tess 언어 명세](#)를 [Ohm.js](https://ohmjs.org) 로 구현한 파서입니다.
`tuto/` 의 한국어 Ohm 튜토리얼에서 배운 기법을 그대로 적용했습니다.

```bash
pnpm install
pnpm test                       # 118개 테스트
node index.js examples/tour.tess        # 문법 · 의미 검사
node index.js examples/tour.tess --ast  # AST 출력
```

## 구성

| 파일 | 역할 |
|---|---|
| `src/tess.ohm` | **문법 정의** — "이 코드가 Tess 로 올바른가" 만 판단 |
| `src/ast.js` | **시맨틱** — 파스 트리(CST) → AST 변환 (`addOperation('ast')`) |
| `src/validate.js` | **의미 검증** — 문법으로 표현할 수 없는 spec 규칙 검사 |
| `src/builtins.js` | spec 의 상태 값 · 내장 함수 · 속성 이름 목록 |
| `src/parse.js` | 공개 API (`parse`, `parseOrThrow`, `check`, `trace`) |
| `index.js` | 라이브러리 재export + CLI |
| `examples/` | spec 예제와 언어 전체를 한 바퀴 도는 샘플 |

Ohm 의 철학대로 **문법과 동작을 완전히 분리**했습니다. `tess.ohm` 에는 로직이 한 줄도 없고,
"그래서 이게 무슨 뜻인가" 는 전부 `ast.js` 와 `validate.js` 가 담당합니다.

## 사용법

```js
import { parse } from './index.js';

const result = parse(`
  var score = 0
  scene "main":
    object "cat":
      when key "space" up do
        forward 10
        score += 1
      end
    end
  end
`);

result.ok        // true
result.ast       // { type: 'Program', body: [...] }
result.errors    // [{ line, column, message }]
result.warnings  // [{ line, column, message }]
```

| 함수 | 설명 |
|---|---|
| `parse(source, options?)` | `{ ok, ast, errors, warnings, match }` 반환 |
| `parseOrThrow(source)` | 실패하면 예외, 성공하면 AST |
| `check(source)` | 문법에 맞는지만 boolean 으로 |
| `trace(source)` | 파서의 판단 과정을 문자열로 (디버깅용) |
| `grammar` | Ohm `Grammar` 인스턴스 |

`options.startRule` 로 `Expr`, `Statement` 처럼 특정 규칙부터 파싱할 수 있습니다.

## 문법 설계 노트

spec 을 Ohm 으로 옮기면서 판단이 필요했던 지점들입니다.

### 1. 구문 규칙 vs 어휘 규칙

프로그램 구조·문장·표현식은 전부 **대문자 규칙(구문 규칙)** 으로 만들어서 공백·줄바꿈·주석을
Ohm 이 알아서 건너뛰게 했습니다. 키워드·리터럴·식별자만 **소문자 규칙(어휘 규칙)** 입니다.

### 2. 주석 `#` 과 색상 리터럴 `#ff0000` 구분

Tess 는 `#` 로 주석을 시작하는데 색상 리터럴도 `#ff0000` 입니다. 공백 스킵은 `space` 규칙으로
일어나므로 이 판단은 어휘 단계에서 끝나야 합니다. **부정 lookahead** 로 갈랐습니다.

```ohm
space += comment
comment = "#" ~colorBody (~lineTerminator any)*
colorLiteral = "#" colorBody
colorBody = hexDigit hexDigit hexDigit hexDigit hexDigit hexDigit ~identifierPart
```

`#` 뒤에 16진수 6자리가 오면 색상, 아니면 주석입니다.
(따라서 `#abcdef 입니다` 처럼 16진수 6자리로 시작하는 주석은 색상으로 읽힙니다 — spec 설계상
불가피한 모호함입니다. 주석은 `# ` 처럼 공백을 두고 쓰면 항상 안전합니다.)

### 3. 연산자 우선순위

좌재귀 규칙을 우선순위별로 계층화했습니다 (낮음 → 높음).

```
OrExpr < AndExpr < NotExpr < CompareExpr < AddExpr < MulExpr < PowExpr < UnaryExpr < PrimaryExpr
```

- 좌결합: `10 - 2 - 3` → `(10 - 2) - 3`
- 거듭제곱만 우결합: `2 ** 3 ** 2` → `2 ** (3 ** 2)`
- PEG 는 "먼저 성공한 것"을 고르므로 접두어가 겹치는 연산자는 **긴 것을 먼저** 뒀습니다.
  (`//` → `/`, `**` → `*`, `<=` → `<`, `**=` → `*=`)
- 단순 대입 `=` 은 `"=" ~"="` 로 `==` 와 갈랐습니다.

### 4. 키워드가 식별자를 잡아먹지 않게

모든 키워드는 `~identifierPart` 로 닫았습니다.

```ohm
for = "for" ~identifierPart   // `forward` 를 `for` 로 읽지 않음
to  = "to"  ~identifierPart   // `to_hex` 를 `to` 로 읽지 않음
in  = "in"  ~identifierPart   // `insert`, `index_of` 를 `in` 으로 읽지 않음
```

반대로 **예약어는 최소한만** 뒀습니다 (`and or not true false end then do in wait`).
표현식이 삼켜버릴 수 있는 것만 막았기 때문에, `name` `size` `costume` `timer` `answer` `x` `y`
같은 속성·상태 이름은 여전히 변수명으로 쓸 수 있습니다. (`var record = timer`, `x("mouse")` 가
동시에 성립해야 하므로 이 이름들을 예약어로 만들 수는 없습니다.)

`wait` 이 예약어인 이유는 `play sound "a" and wait` 때문입니다. 예약어가 아니면
`"a" and wait` 이 논리 연산식으로 먼저 매칭되어 `and wait` 절을 통째로 삼켜버립니다.

### 5. 줄바꿈 경계 — `#sameLine`

Tess 는 문장 구분자가 없고 줄바꿈으로 문장을 나눕니다. 그런데 구문 규칙은 줄바꿈도 공백으로
건너뛰기 때문에, 인자가 **선택적인** 명령은 다음 줄의 문장을 인자로 삼켜버립니다.

```tess
hide
say "숨었다"        # hide 가 `say` 를 대상 식별자로 먹어버림
```

ES5 문법이 후위 `++` 를 처리하던 방식(`#(spacesNoNL "++")`)을 그대로 가져왔습니다.

```ohm
spacesNoNL = (~lineTerminator space)*
sameLine   = ~(spacesNoNL lineTerminator)   // 입력을 소비하지 않는 가드

LooksStatement = show #sameLine identifier -- showTarget
               | show                      -- show
```

`#` 로 어휘화해야 자동 공백 스킵이 줄바꿈을 먼저 먹는 것을 막을 수 있습니다.
`show` / `hide` / `clone` 과 `move` `go` 의 두 번째 좌표 인자에 적용했습니다.

### 6. 공백으로 나열하는 인자 — `PosExpr`

`move 20 20` 처럼 인자를 공백으로 나열하는 명령에서 첫 인자에 전체 표현식을 허용하면
`move 50 -30` 이 `move (50 - 30)` 으로 붙어버립니다. 그래서 이 자리만 **이항 연산이 없는
단항 수준 표현식(`PosExpr = UnaryExpr`)** 으로 제한했습니다.

```tess
move 50 -30       # (50, -30) 으로 읽힘
move (a + b) 10   # 이항 연산이 필요하면 괄호
```

인자가 하나뿐인 `forward`, `wait`, `say` 등은 모호함이 없으므로 전체 표현식을 받습니다.

### 7. `-- caseName` 으로 케이스 쪼개기

`stop` 하나만 해도 11가지(`stop`, `stop me`, `stop sound all`, `stop bgm`, `stop draw` …)입니다.
전부 인라인 규칙으로 이름을 붙여서, 시맨틱 액션이 케이스별로 정확히 대응하게 했습니다.
덕분에 `ast.js` 안에 "이게 어떤 형태였지?" 를 다시 판별하는 코드가 없습니다.

### 8. 문법으로 표현하지 않고 검증으로 넘긴 것

문법을 두 벌로 복제해야 하거나 스코프 분석이 필요한 규칙은 `validate.js` 로 넘겼습니다.

| 검사 | spec | 종류 |
|---|---|---|
| 글상자 전용 명령/속성을 `object` 에서 사용 (`write`, `font_color` …) | 8.5 | 에러 |
| 함수 안에서 오브젝트 로컬 변수 참조 | 14.2 | 에러 |
| 함수 밖의 `return` | 14 | 에러 |
| 반복문 밖의 `break` / `skip` | 5.3 | 에러 |
| `project` 블록 중복 | 3.2 | 에러 |
| 선언되지 않은 이름 · 함수 | — | 경고 |

`use` 가 있는 파일은 다른 파일의 이름을 알 수 없으므로 이름 기반 경고를 끕니다.

```
$ node index.js broken.tess
broken.tess:3:5  에러: 'write' 은(는) 글상자(text) 전용 명령입니다.
broken.tess:4:9  경고: 선언되지 않은 이름 'unknown' 입니다.
```

### 9. 그 밖의 판단

- **`end_` 라는 이름**: `end` 는 Ohm 내장 규칙(입력의 끝)이라 재정의할 수 없어서 블록을 닫는
  `end` 키워드는 `end_` 로 정의했습니다.
- **최상위 `object` 허용**: `use` 는 파일 내용을 그 자리에 통째로 넣는 기능이므로,
  `use "objects/hero.tess"` 가 가리키는 조각 파일은 `object` 하나만 담고 있을 수 있습니다.
  그래서 `object` / `text` 를 scene 안뿐 아니라 최상위에서도 허용했습니다.
- **`kill` 과 `del clone`**: spec 이 같은 기능이라고 명시했으므로 AST 에서 같은 노드
  (`DeleteClone`) 로 합쳤습니다.
- **`send` / `call`**: 형태가 같고 대기 여부만 다르므로 `Send { wait }` 한 노드로 합쳤습니다.

## AST

```
Program        { body }
├ Project      { fields[] }        ├ Scene    { name, body[] }
├ Object       { kind, name, body[] }   kind: 'object' | 'text'
├ FunctionDecl { name, params[], body[] }
├ VarDecl / ListDecl { name, value }    └ Use { path }

Object.body    Property | Costume | Sound | VarDecl | ListDecl | FunctionDecl | Event
Event          { event, key?, signal?, body[] }
               event: start | scene_start | key | key_up | click | click_up
                    | stage_click | stage_click_up | signal | cloned

문장            If Repeat While Until Forever Wait Break Skip Restart Return
               Stop StopSound StopBgm StopDraw StopFill StopTimer
               StartDraw StartFill StartTimer ResetSize ResetTimer Clear
               Send Clone DeleteClone DeleteClones Jump
               Forward Bounce Move Go Turn Steer Look
               Show Hide CostumeStep Say Think Flip Order
               TextWrite Stamp PlaySound PlayBgm
               ListAdd ListInsert ListRemove Ask Assign ExpressionStatement

표현식          Binary { operator, left, right }   Unary { operator, argument }
               Call { callee, arguments[] }       Index { target, index }
               Number String Boolean Color Transparent ListLiteral Identifier
```

모든 노드에 `loc: { start, end }` (입력 오프셋)이 붙습니다.

## 테스트

```bash
pnpm test
```

| 파일 | 내용 |
|---|---|
| `test/grammar.test.js` | spec 각 절의 코드가 파싱되는지 / 잘못된 코드가 거부되는지 |
| `test/ast.test.js` | 연산자 우선순위 · 결합 방향 · 문장 AST 모양 |
| `test/validate.test.js` | 의미 규칙과 에러 위치 |
| `test/examples.test.js` | `examples/` 의 모든 `.tess` 가 에러·경고 없이 통과 |

문법을 고칠 때는 [Ohm 온라인 에디터](https://ohmjs.org/editor)에 `src/tess.ohm` 을 붙여넣고
실험하거나, `trace()` 로 파서의 판단 과정을 확인하세요.

```js
import { trace } from './index.js';
console.log(trace('forward 10 at 90', 'Statement'));
```
