# Tess — Ohm 문법 구현과 엔트리 컴파일러

[Tess 언어 명세](#)를 [Ohm.js](https://ohmjs.org) 로 구현한 파서와,
그 결과를 **실제 엔트리 작품(`project.json` / `.ent`)으로 컴파일**하는 컴파일러입니다.
`tuto/` 의 한국어 Ohm 튜토리얼에서 배운 기법을 그대로 적용했습니다.

```bash
pnpm install
pnpm test                                              # 161개 테스트

node index.js check examples/tour.tess                 # 문법 · 의미 검사
node index.js build examples/gift_delivery/main.tess -o build/gift.ent
node index.js build examples/all_blocks.tess -o build/project.json
```

`.ent` 파일은 엔트리 오프라인 에디터에서 그대로 열 수 있는 tar 묶음입니다.

```
$ node index.js build examples/gift_delivery/main.tess -o build/gift.ent
main.tess -> build/gift.ent
  장면 3 · 오브젝트 10 · 변수 8 · 신호 3 · 함수 2 · 블록 218
```

## 구성

| 파일 | 역할 |
|---|---|
| `src/tess.ohm` | **문법 정의** — "이 코드가 Tess 로 올바른가" 만 판단 |
| `src/ast.js` | **시맨틱** — 파스 트리(CST) → AST 변환 (`addOperation('ast')`) |
| `src/validate.js` | **의미 검증** — 문법으로 표현할 수 없는 spec 규칙 검사 |
| `src/builtins.js` | spec 의 상태 값 · 내장 함수 · 속성 이름 목록 |
| `src/parse.js` | 파서 공개 API (`parse`, `parseOrThrow`, `check`, `trace`) |
| `src/compiler/` | **엔트리 컴파일러** (아래 표 참고) |
| `index.js` | 라이브러리 재export + CLI |
| `examples/` | spec 예제 · 언어 한 바퀴 · 컴파일되는 작품 |
| `SPEC-ADDENDUM.md` | 컴파일을 위해 더한 문법과 엔트리 블록 대응표 |

| 컴파일러 파일 | 역할 |
|---|---|
| `src/compiler/index.js` | 심볼 수집 → 스크립트 컴파일 → 프로젝트 조립 |
| `src/compiler/statement.js` | Tess 문장 → 엔트리 블록 |
| `src/compiler/expression.js` | Tess 표현식 → 엔트리 값·판단 블록 |
| `src/compiler/include.js` | `use "파일"` 을 그 자리에 펼치기 |
| `src/compiler/assets.js` | 모양·소리 파일 → 엔트리 리소스 경로 |
| `src/compiler/bundle.js` | `.ent` (tar) 묶기 — 의존성 없이 직접 |
| `src/compiler/verify.js` | 만든 프로젝트가 엔트리 구조에 맞는지 검사 |
| `src/compiler/block-params.js` | 엔트리 블록별 파라미터 자리 개수표 |

Ohm 의 철학대로 **문법과 동작을 완전히 분리**했습니다. `tess.ohm` 에는 로직이 한 줄도 없고,
"그래서 이게 무슨 뜻인가" 는 `ast.js`·`validate.js` 가, "엔트리로 어떻게 옮기나" 는
`compiler/` 가 담당합니다.

## 사용법

```js
import { parse, compileProject, makeEntryBundle } from './index.js';

const result = compileProject(source, { path: 'main.tess' });
if (result.ok) {
  fs.writeFileSync('game.ent', makeEntryBundle(result.project, result.assets));
}
```

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
| `compileProject(source, options?)` | `{ ok, project, errors, warnings, assets }` 반환 |
| `makeEntryBundle(project, assets)` | `.ent` (tar) 바이트열 |
| `verifyEntryProject(project)` | 엔트리 구조 검사 결과(문제 목록) |
| `grammar` | Ohm `Grammar` 인스턴스 |

`options.startRule` 로 `Expr`, `Statement` 처럼 특정 규칙부터 파싱할 수 있습니다.
`compileProject` 의 `options.assetDirs` 로 모양·소리 파일을 찾을 폴더를 지정합니다.

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

## 엔트리 컴파일러

### 엔트리 작품의 구조

실제 엔트리 작품 하나(`project.json`, 오브젝트 157개 · 블록 3천여 개)를 뜯어보고 맞췄습니다.

```
project.json
├ scenes[]     { id, name }
├ objects[]    { id, name, objectType, scene, sprite{pictures,sounds}, entity, script }
│               └ script 는 "블록 묶음의 배열" 을 담은 JSON 문자열
├ variables[]  { id, name, variableType: variable|list|slide|timer|answer, object }
├ messages[]   { id, name }
└ functions[]  { id, type: normal|value, localVariables, content }

블록 하나 = { id, x, y, type, params[], statements[][], movable, deletable,
              emphasized, readOnly, copyable, assemble, extensions }
```

`params` 에는 값 블록이 그대로 중첩되고, `statements` 에는 `if`·반복문의 속 블록이 들어갑니다.
id 는 `[a-z0-9]` 4글자입니다.

### 블록 이름을 추측하지 않았습니다

블록 타입 이름과 파라미터 순서는 [entryjs 소스](https://github.com/entrylabs/entryjs)의
`src/playground/blocks/block_*.js` 에서 직접 확인했습니다. 특히 헷갈리는 것들:

- `move_xy_time` · `locate_xy_time` · `rotate_by_time` 은 **첫 번째 파라미터가 시간**입니다
- 엔트리의 `flip_x` 는 상하, `flip_y` 는 좌우 뒤집기입니다 (Tess 의 `flip x` 는 `flip_y` 가 됩니다)
- `substring` · `char_at` · 리스트 인덱스는 모두 **1부터**입니다
- `index_of_string` 은 못 찾으면 `0` 을 돌려줍니다
- 값 함수 정의는 `function_create_value`, 반환식은 그 블록의 **params[3]** 에 붙습니다
- 함수 호출 블록은 `func_<함수id>` 이고, 값을 안 돌려주는 함수만 끝에 아이콘 자리가 하나 더 있습니다

### 만든 결과를 검사합니다 — `verify.js`

컴파일 결과가 엔트리가 읽을 수 있는 모양인지 확인합니다.

- 블록마다 필수 항목(`id`·`x`·`y`·`type`·`params`·`statements`)이 있는지
- **파라미터 자리 개수가 엔트리 블록 스키마와 같은지** (`block-params.js`, 188종)
- 블록 id 가 오브젝트 안에서 겹치지 않는지
- 참조 무결성 — 변수·리스트·신호·장면·모양·소리·함수 id 가 실제로 있는지
- 함수 본문이 정의부에 없는 매개변수 블록을 쓰지 않는지

이 검사기를 **실제 엔트리 작품에 돌려서 0건**이 나오도록 맞춘 뒤 컴파일 결과에 적용했습니다.
(처음에는 "블록 id 는 작품 전체에서 유일" 이라고 검사했는데, 실제 작품에서는 오브젝트를 복제하면
블록 id 까지 복사되기 때문에 "오브젝트 안에서만 유일" 로 고쳤습니다. 실제 데이터로 검사기를
보정한 셈입니다.)

같은 방식으로 파라미터 개수도 실제 작품과 대조해서 `repeat_inf`, `get_nickname`,
`get_project_timer_value`, `value_of_index_from_list`, `is_current_device_type` 다섯 개의
자리 개수 오류를 찾아 고쳤습니다.

### 컴파일하면서 하는 일

| 하는 일 | 설명 |
|---|---|
| `use` 펼치기 | 파일을 그 자리에 통째로 넣고, 에러는 원래 파일 이름·줄 번호로 알려 줍니다 |
| 심볼 수집 | 장면·오브젝트·변수·리스트·신호·함수·모양·소리에 엔트리 id 를 붙입니다 |
| 스코프 해석 | 함수 지역 → 오브젝트 로컬 → 전역 순으로 찾고, 없으면 오브젝트 속성으로 봅니다 |
| 인덱스 보정 | 0부터인 Tess 인덱스를 1부터인 엔트리 인덱스로 (상수는 미리 계산) |
| 없는 블록 펼치기 | `move X Y` → 두 블록, `log2` → `ln/ln2`, `**` → 제곱·제곱근·곱셈 |
| 리소스 처리 | 이미지 헤더에서 원본 크기를 읽고 `temp/xx/yy/image/…` 경로를 만듭니다 |
| 결정적 id | 소스에서 만든 시드로 id 를 뽑아, 같은 소스는 항상 같은 결과가 됩니다 |

자세한 대응표와 엔트리에 없어서 다르게 만드는 것들은 [SPEC-ADDENDUM.md](./SPEC-ADDENDUM.md)에
정리했습니다.

### 컴파일 에러

엔트리에 옮길 수 없는 코드는 조용히 넘어가지 않고 위치와 함께 알려 줍니다.

```
$ node index.js build broken.tess
broken.tess:12:7  에러: 엔트리에는 scale_x 을(를) 정하는 블록이 없습니다. scale_x += 값 으로 바꾸거나 오브젝트 속성으로 선언하세요.
broken.tess:15:12  에러: 'bullet' 이라는 오브젝트가 없습니다.
broken.tess:21:5  에러: 엔트리 함수는 중간에서 값을 돌려줄 수 없습니다. return 은 함수의 마지막 문장에만 쓸 수 있습니다.
```

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
| `test/compile.test.js` | 엔트리 블록 매핑 · 인덱스 보정 · 함수 · `use` · 구조 검증 · `.ent` 묶음 |
| `test/examples.test.js` | `examples/` 의 모든 `.tess` 가 에러 없이 통과 |

`examples/all_blocks.tess` 는 Tess 의 거의 모든 명령을 한 번씩 쓰는 파일입니다.
이걸 컴파일해서 나온 블록 484개를 전부 엔트리 스키마와 대조합니다.

문법을 고칠 때는 [Ohm 온라인 에디터](https://ohmjs.org/editor)에 `src/tess.ohm` 을 붙여넣고
실험하거나, `trace()` 로 파서의 판단 과정을 확인하세요.

```js
import { trace } from './index.js';
console.log(trace('forward 10 at 90', 'Statement'));
```
