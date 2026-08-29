# Tess — 문법 구현과 엔트리 컴파일러

[Tess 언어](./SPEC.md)를 [Ohm.js](https://ohmjs.org) 로 구현한 파서와,
그 결과를 **실제 엔트리 작품(`project.json` / `.ent`)으로 컴파일**하는 컴파일러입니다.
`tuto/` 의 한국어 Ohm 튜토리얼에서 배운 기법을 그대로 적용했습니다.

Tess 로 뭘, 어떻게 쓰는지 알고 싶다면 **[SPEC.md](./SPEC.md)** (언어 가이드) 를 먼저
읽으세요 — 이 README 는 프로젝트 구조와 컴파일러 내부, CLI 사용법을 다룹니다.

```bash
pnpm install
pnpm test                                              # 279개 테스트

node index.js check examples/tour.tess                 # 문법 · 의미 검사 (컴파일까지)
node index.js build examples/all_blocks.tess -o build/blocks.ent
node index.js run   examples/all_blocks.tess   # 컴파일해서 브라우저로 열기
```

`.ent` 파일은 엔트리 오프라인 에디터에서 그대로 열 수 있는 tar 묶음입니다.

```
$ node index.js build examples/all_blocks.tess -o build/blocks.ent
all_blocks.tess -> build/blocks.ent
  장면 2 · 오브젝트 4 · 변수 8 · 신호 2 · 함수 5 · 블록 609
```

## 구성

| 파일               | 역할                                                                                            |
| ------------------ | ----------------------------------------------------------------------------------------------- |
| `src/tess.ohm`     | **문법 정의** — "이 코드가 Tess 로 올바른가" 만 판단 (규칙별 상세는 [GRAMMAR.md](./GRAMMAR.md)) |
| `src/ast.js`       | **시맨틱** — 파스 트리(CST) → AST 변환 (`addOperation('ast')`)                                  |
| `src/validate.js`  | **의미 검증** — 문법으로 표현할 수 없는 spec 규칙 검사                                          |
| `src/builtins.js`  | spec 의 상태 값 · 내장 함수 · 속성 이름 목록                                                    |
| `src/parse.js`     | 파서 공개 API (`parse`, `parseOrThrow`, `check`, `trace`)                                       |
| `src/compiler/`    | **엔트리 컴파일러** (아래 표 참고)                                                              |
| `index.js`         | 라이브러리 재export + CLI                                                                       |
| `examples/`        | spec 예제 · 언어 한 바퀴 · 컴파일되는 작품                                                      |
| `SPEC.md`          | **Tess 언어 가이드** — 문법·문장·표현식·내장 함수를 처음부터 설명(일반 사용자용)                |
| `SPEC-ADDENDUM.md` | 엔트리에는 없는 Tess 전용 문법과, 컴파일러가 알아서 다르게 만드는 부분                          |
| `GRAMMAR.md`       | Ohm 문법(`tess.ohm`) 규칙별 상세 명세 — 우선순위, PEG 기법, AST 대응표(파서/컴파일러 기여자용)  |

| 컴파일러 파일                  | 역할                                                                                                            |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `src/compiler/index.js`        | 심볼 수집 → 스크립트 컴파일 → 프로젝트 조립                                                                     |
| `src/compiler/statement.js`    | Tess 문장 → 엔트리 블록                                                                                         |
| `src/compiler/expression.js`   | Tess 표현식 → 엔트리 값·판단 블록                                                                               |
| `src/compiler/include.js`      | `use` · `useobject` · `usetext` 를 그 자리에 펼치기                                                             |
| `src/compiler/comments.js`     | Tess 주석 → 엔트리 블록 주석                                                                                    |
| `src/compiler/runtime.js`      | 엔트리에 없는 동작을 대신할 함수 만들어 넣기                                                                    |
| `src/player/`                  | `run` 이 띄우는 미리보기 서버와 실행 페이지                                                                     |
| `src/player/debug-ui.js`       | 디버그 패널 UI ([arrow-js](https://github.com/standardagents/arrow-js) 로 만든 브라우저 모듈)                   |
| `src/decompiler/`              | `decompile` — `.ent` → Tess 소스(기본적으로 오브젝트마다 `objects/이름.tess` 조각 파일 + `useobject`/`usetext`) |
| `editors/vscode/`              | VS Code 문법 강조 (설치법은 그 폴더의 README)                                                                   |
| `src/compiler/assets.js`       | 모양·소리 파일 → 엔트리 리소스 경로, 그림 원본 크기 재기                                                        |
| `src/compiler/audio.js`        | 소리 파일 헤더에서 재생 길이 재기 (mp3 · wav · ogg · m4a)                                                       |
| `src/compiler/bundle.js`       | `.ent` (tar) 묶기 — 의존성 없이 직접                                                                            |
| `src/compiler/verify.js`       | 만든 프로젝트가 엔트리 구조에 맞는지 검사                                                                       |
| `src/compiler/block-params.js` | 엔트리 블록별 파라미터 자리 개수표                                                                              |

Ohm 의 철학대로 **문법과 동작을 완전히 분리**했습니다. `tess.ohm` 에는 로직이 한 줄도 없고,
"그래서 이게 무슨 뜻인가" 는 `ast.js`·`validate.js` 가, "엔트리로 어떻게 옮기나" 는
`compiler/` 가 담당합니다.

## 사용법

```js
import { parse, compileProject, makeEntryBundle } from "./index.js";

const result = compileProject(source, { path: "main.tess" });
if (result.ok) {
  fs.writeFileSync("game.ent", makeEntryBundle(result.project, result.assets));
}
```

```js
import { parse } from "./index.js";

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

result.ok; // true
result.ast; // { type: 'Program', body: [...] }
result.errors; // [{ line, column, message }]
result.warnings; // [{ line, column, message }]
```

| 함수                               | 설명                                             |
| ---------------------------------- | ------------------------------------------------ |
| `parse(source, options?)`          | `{ ok, ast, errors, warnings, match }` 반환      |
| `parseOrThrow(source)`             | 실패하면 예외, 성공하면 AST                      |
| `check(source)`                    | 문법에 맞는지만 boolean 으로                     |
| `trace(source)`                    | 파서의 판단 과정을 문자열로 (디버깅용)           |
| `compileProject(source, options?)` | `{ ok, project, errors, warnings, assets }` 반환 |
| `makeEntryBundle(project, assets)` | `.ent` (tar) 바이트열                            |
| `verifyEntryProject(project)`      | 엔트리 구조 검사 결과(문제 목록)                 |
| `grammar`                          | Ohm `Grammar` 인스턴스                           |

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
불가피한 모호함입니다. 주석은 `#` 처럼 공백을 두고 쓰면 항상 안전합니다.)

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

| 검사                                                                 | spec | 종류 |
| -------------------------------------------------------------------- | ---- | ---- |
| 글상자 전용 명령/속성을 `object` 에서 사용 (`write`, `font_color` …) | 8.5  | 에러 |
| 함수 안에서 오브젝트 로컬 변수 참조                                  | 14.2 | 에러 |
| 함수 밖의 `return`                                                   | 14   | 에러 |
| 반복문 밖의 `break` / `skip`                                         | 5.3  | 에러 |
| `project` 블록 중복                                                  | 3.2  | 에러 |
| 선언되지 않은 이름 · 함수                                            | —    | 경고 |

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

### 편의 문법

| 쓰는 법                                                                 | 하는 일                                                                                                                                                         |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `# 주석`                                                                | 버려지지 않고 **엔트리 블록의 주석**이 됩니다. 문장 위에 쓰면 그 블록에, 줄 끝에 쓰면 같은 줄 블록에 붙습니다                                                   |
| `useobject "objects/치로.tess"`                                         | 파일을 불러오면서 **오브젝트로 감싸 줍니다**. 파일에 `object "..." : … end` 를 쓰지 않아도 됩니다. 오브젝트 이름은 파일 이름이 됩니다 (`usetext` 는 글상자로)   |
| `scale_x = 50`                                                          | 엔트리에 없는 "가로 비율 정하기" 를 컴파일러가 만든 함수로 해냅니다 (아래)                                                                                      |
| `27 ** (1/3)` · `root(27, 3)`                                           | 엔트리에 없는 일반 거듭제곱·n제곱근을 제곱·제곱근·자연로그로 펼칩니다 (아래)                                                                                    |
| `costume 기본 "a.png" size 200 100`<br>`sound 딸깍 "click.mp3" for 0.3` | 그림·소리 파일이 아직 없어도 필요한 정보를 적어 두면 조용히 넘어갑니다                                                                                          |
| `if "살아있음":` · `깃발 = (x > 3)`                                     | 엔트리는 판단 칸과 값 칸이 엄격히 나뉘어 있는데 Tess 는 타입이 없습니다. 어긋나는 자리는 참/거짓 블록과 `(<판단>의 값)` 으로 이어 줍니다 (SPEC-ADDENDUM.md 4절) |
| `function 스폰(a, 체력)`                                                | 자동 이름(`a`, `b`, …)이 아닌 매개변수는 엔트리에서 이름표를 달고 `스폰 (인수) 체력 (인수)` 로 보입니다 (SPEC-ADDENDUM.md 4.6)                                  |
| `function 스폰(살았나?)`                                                | 이름 뒤 `?` 는 그 자리를 엔트리의 **판단 칸**으로 만듭니다 — 판단을 그대로 넘겨받습니다                                                                         |

### 엔트리에 없는 블록 만들어 내기 — `가로 비율 정하기`

엔트리에는 한 축의 크기를 **정하는** 블록이 없고 늘리는 블록만 있습니다. 게다가 읽을 수
있는 값은 가로·세로가 섞인 "크기" 하나뿐입니다.

```
크기 = (원본가로 × |가로배율| + 원본세로 × |세로배율|) / 2
```

그래서 `scale_x = 50` 을 만나면 컴파일러가 **한 축만 크게 늘려 보고 크기가 얼마나
변했는지로 그 축의 길이를 되짚는** 엔트리 함수를 만들어 넣습니다.

```
세로를 100000 만큼 늘린 뒤   2 × 크기 × (새 크기 − 크기) × 0.00001  =  세로 길이
```

지금 상태와 "원래 크기로 되돌린" 상태에서 각각 재면, 건드리지 않을 축은 그대로 되살리고
목표 축만 원하는 비율로 맞출 수 있습니다. 함수는 이 문법을 쓴 작품에서만 만들어지고,
지역 변수를 쓰기 때문에 복제본이 동시에 불러도 서로 섞이지 않습니다.

이 함수가 정말로 맞게 계산하는지는 **엔트리의 크기 규칙을 그대로 흉내 낸 시뮬레이터**로
확인합니다(`test/runtime-scale.test.js`). 시작 배율이 100%가 아닐 때, 모양이 바뀌어 원본
크기가 달라졌을 때, 두 번 이어서 정할 때까지 실제 배율을 계산해서 비교합니다.

### 엔트리에 없는 계산 만들어 내기 — 거듭제곱과 n제곱근

엔트리에 있는 것은 제곱(`square`)과 제곱근(`root`)뿐입니다. 그런데 이 둘만으로 모든 실수
지수를 만들 수 있습니다.

```
정수부   x^13 = ((x^2)^2 · x)^2 · x                 (자릿수만큼만)
소수부   x^0.b₁b₂b₃… = √(x^b₁ · √(x^b₂ · √(x^b₃ · …)))
```

소수부는 지수를 2배씩 하며 1을 넘는지 보는 이진 전개입니다. `0.5`, `0.75`, `2.5` 처럼 2의
거듭제곱으로 떨어지는 지수는 **오차 없이 정확**하고, `1/3` 같은 무한소수는 20자리에서 끊습니다.

여기서 한 걸음 더 갑니다. 엔트리에는 자연로그(`ln`)가 있으므로 **뉴턴 보정을 한 번** 하면
끊어서 생긴 오차가 제곱으로 줄어듭니다.

```
y ≈ x^p 일 때   y ← y × (1 + p·ln x − ln y)      오차 ε → ε²/2
```

그래서 무한소수 지수도 상대오차 10⁻¹¹~10⁻¹³ 까지 내려갑니다.

| 식            | 블록 수 | 결과               | 상대오차 |
| ------------- | ------- | ------------------ | -------- |
| `2 ** 10`     | 6       | 1024               | 0        |
| `16 ** 0.5`   | 2       | 4                  | 0        |
| `7 ** 2.5`    | 5       | 129.64181424216494 | 0        |
| `root(16, 4)` | 3       | 2                  | 0        |
| `27 ** (1/3)` | 42      | 2.9999999999983533 | 5.5e-13  |
| `1000 ** 0.3` | 38      | 7.9432823471325005 | 1.4e-11  |

반복 블록을 쓰지 않는 이유가 있습니다. **엔트리 반복은 한 번 돌 때마다 프레임을 넘깁니다.**
값을 구하는 식이 여러 프레임에 걸치면 안 되므로 컴파일할 때 펼쳐 둡니다.
계산이 맞는지는 블록 트리를 그대로 계산해서 `Math.pow` 와 비교합니다(`test/power.test.js`).

### 브라우저에서 바로 실행 — `run`

```
$ node index.js run examples/all_blocks.tess
all_blocks.tess -> http://127.0.0.1:41234/
  실행기: CDN (https://unpkg.com/@entrylabs/entry@4.0.22)
  자동 새로고침: 켜짐 (--no-reload 로 끌 수 있습니다)
  Ctrl+C 로 끕니다.
```

컴파일한 작품을 그 자리에서 띄우고 브라우저를 엽니다. 서버가 주는 것은

| 주소                       | 내용                                          |
| -------------------------- | --------------------------------------------- |
| `/`                        | 엔트리 실행기를 붙인 실행 페이지              |
| `/project.json`            | 컴파일한 작품                                 |
| `/assets/…`                | 모양·소리 파일을 디스크에 있는 그대로         |
| `/temp/…`                  | 같은 파일을 엔트리가 쓰는 주소로도            |
| `/<작품이름>.ent`          | 내려받기용 묶음 — 누를 때 처음 묶는다         |
| `/lib/…`                   | `@entrylabs/entry` 가 설치돼 있으면 그 파일들 |
| `/debug-ui.js`, `/arrow/…` | 디버그 패널 UI 와 그것이 쓰는 arrow-js        |

#### `run` 은 작품을 묶지 않는다

`build` 는 리소스를 전부 읽어 미리보기까지 만들고 tar 로 묶어야 하지만, `run` 은
그럴 이유가 없습니다. 리소스는 디스크에 있는 자리에서 그대로 내보내고, `.ent` 는
내려받기를 눌렀을 때 처음 만듭니다. 리소스가 1,719개인 예제(`examples/ent/witch_tess`)
기준으로 서버가 뜨는 데 드는 시간이 **8,978ms → 28ms** 로 줄고, 매번 쌓이던 272MB
버퍼가 사라집니다. 이 비용은 파일을 고칠 때마다(자동 새로고침) 다시 들던 것입니다.

그리고 `project.json` 의 `fileurl` 은 엔트리의 `temp/<해시>` 대신 **파일이 실제로
있는 경로**(`/assets/image/주인공.png`)를 가리킵니다 — 개발자 도구 네트워크 탭에서
어느 파일인지 바로 읽힙니다. entryjs 는 `fileurl` 이 있으면 그대로 쓰기 때문에
(`fileurl?o.src=e.fileurl:…`) 이렇게 해도 실행 결과는 같습니다.

깨끗한 주소를 만들 수 없을 때 — 리소스 폴더 밖의 파일, 두 폴더가 같은 이름을
주장할 때, 서버가 이미 쓰는 주소와 겹칠 때 — 는 그 파일만 엔트리의 원래
`temp/<해시>` 주소를 그대로 씁니다 (`src/player/asset-routes.js`). 두 주소 모두
항상 답하므로 어느 쪽을 참조해도 깨지지 않습니다.

`build` 가 내보내는 `.ent` 의 `fileurl` 은 손대지 않습니다 — playentry.org 에
올리려면 엔트리의 경로 규칙을 그대로 지켜야 하기 때문입니다.

엔트리 실행기(entryjs)는 서드파티 라이브러리가 많아 저장소에 담지 않고, **설치돼 있으면
그것을, 없으면 CDN 을** 씁니다. 인터넷이 막힌 곳에서는 `pnpm add -D @entrylabs/entry` 로
설치하면 그 파일을 씁니다. 둘 다 안 되면 페이지가 그 사실과 함께 `.ent` 를 받아
playentry.org 에서 여는 방법을 안내합니다.

#### 디버그 패널

실행 페이지 오른쪽 위 **디버그** 버튼으로 엽니다. 네 개의 탭이 있습니다.

| 탭           | 하는 일                                                                                                                                                                                                                                           |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **실행**     | 시작 · 일시정지 · 정지. **정지한 뒤에도 다시 시작할 수 있습니다** — 엔트리 minimize 실행기 바의 큰 재생 버튼은 캔버스 레이아웃에 가려지기도 해서 여기에 따로 뒀습니다. 아래에서 **부스트 모드 · 기기 종류 · 터치 지원**을 골라 흉내낼 수 있습니다 |
| **자료**     | 변수·리스트의 **지금 값**(실행 중이면 실시간)과 **고쳐 쓰기**, 신호(눌러서 바로 보내기), 함수(이름·인자 수·값 함수 여부, 눌러서 코드 열기)                                                                                                       |
| **오브젝트** | 장면 **바로가기**, 오브젝트 목록, 고른 오브젝트의 **정보**(좌표·크기·방향·모양·보이기·글 내용…)와 컴파일된 블록 트리                                                                                                                              |
| **오류**     | 실행 중 난 오류. 블록을 만든 `.tess` 원본 줄·열까지 찾아서 알려 주고, 그 블록을 블록 트리에서 강조합니다                                                                                                                                          |

**값 고쳐 쓰기.** 변수 값, 리스트 항목, 오브젝트의 좌표·크기·방향은 눌러서 그 자리에서
고칩니다. 숫자로 읽히는 값은 숫자로 넣습니다 — 엔트리 변수는 글자도 숫자도 담는데,
글자로 넣으면 계산 블록이 다르게 돌기 때문입니다. 리스트는 **이름을 눌러 펼치고 다시 눌러
접습니다**. 펼친 항목은 이름 줄 다음 줄에 나오고, 항목이 100개여도 정해진 높이 안에서
스크롤되며, 항목마다 고치기·지우기와 맨 아래에 넣기가 있습니다. 값이 빈 항목은 `(빈 값)`
으로 자리를 채웁니다 — 글자가 없으면 누를 칸의 폭이 0 이 되기 때문입니다.

**모양·회전 방식은 드롭다운, 보이기는 토글**입니다. 모양은 엔트리의 "모양으로 바꾸기" 와
같은 길(`object.getPicture` → `entity.setImage`)로 바꾸고, 회전 방식은
`object.setRotateMethod`, 보이기는 `entity.setVisible`, 글상자의 글 내용은
`entity.setText` 입니다. 변수·리스트도 줄마다 **무대에 보이기/숨기기** 토글이
있습니다(`variable.setVisible`).

**장면 바로가기.** 장면 이름 옆의 단추로 그 장면으로 바로 넘어갑니다
(`Entry.scene.selectScene`) — 뒤쪽 장면을 고쳐 보려고 앞 장면을 처음부터 다시 깨는 수고를
덜어 줍니다.

**Ctrl+Shift + 실행 화면 클릭** 이면 그 자리의 오브젝트가 오브젝트 탭에서 열립니다. 어느
오브젝트를 눌렀는지는 엔트리가 이미 알고 있습니다 — 오브젝트마다 붙은 마우스 핸들러가
`entityClick` 을 쏘고 거기 실린 `entity.parent` 가 그 오브젝트입니다(entryjs
`class/entity.js`). 그림 모양 그대로 맞히므로 좌표로 다시 계산하는 것보다 정확하고,
PIXI/createjs 어느 쪽으로 그리든 똑같이 동작합니다. 고르는 동안에는 작품의 "오브젝트를
클릭했을 때" 가 돌지 않도록 엔진의 이벤트 발사를 잠깐 막습니다 — 디버깅하려고 누른 것이지
작품을 진행시키려고 누른 게 아니기 때문입니다.

**딱 붙이기(sticky).** 패널 왼쪽 가장자리를 끌어서 **폭**을, 각 탭 안 섹션의 아래쪽
가장자리를 끌어서 **높이**를 조절합니다. 최소 크기는 없습니다 — 일정 크기(56px) 아래로
끌면 딱 붙어서 크기가 0 이 되고, 손잡이만 있던 자리에 남습니다. 거기서 다시 끌어내면 그
크기를 넘는 순간 딱 하고 펴집니다. 접힌 섹션의 손잡이는 아래로 내겁니다 — 위로 두면 접힌
섹션의 상자 밖이라 `.debug-panelbody` 의 `overflow: hidden` 에 잘려서 다시 잡을 수
없습니다. 패널을 접는 것과 닫기(×)는 다릅니다: 접으면 손잡이가 남고, 닫으면 사라집니다.

UI 는 [arrow-js](https://github.com/standardagents/arrow-js) 로 만든
브라우저 모듈(`src/player/debug-ui.js`)이고, 서버가 `/debug-ui.js` 와 `/arrow/…` 로 내보냅니다.
arrow-js 는 `dist/index.mjs` 를 씁니다 — 같은 패키지의 `index.min.mjs` 는 1.0.6 기준
목록 렌더가 깨져서(내부 함수를 글자로 찍습니다) 못 씁니다.

**arrow-js 1.0.6 을 쓸 때 반드시 지켜야 하는 두 가지**가 있습니다. 둘 다 어겨도 에러가
안 나고 화면만 조용히 안 바뀌므로, 이 UI 를 고칠 때 제일 먼저 의심할 곳입니다.

1. **목록 줄 안의 값은 함수로 넣습니다.** `.key()` 로 키를 준 줄은 다시 그릴 때 DOM 을
   그대로 다시 쓰고, 그 안에서는 **함수로 넣은 것만** 다시 평가합니다. `${liveValue(entry)}`
   처럼 값을 미리 꺼내 두면 그 줄만 첫 값에 얼어붙습니다 — `${() => liveValue(entry)}` 로
   넣어야 합니다 (`editable` 이 값 대신 게터를 받는 이유).
2. **목록은 배열을 그대로 돌려주는 꼴로만 만듭니다.** `${() => 배열}` 은 키를 보고 제대로
   다시 맞춰 주지만, `${() => html`<ul>${배열}</ul>`}` 처럼 템플릿으로 한 번 감싸면 처음
   한 번만 그리고 그 뒤로는 **항목이 늘거나 줄어도 화면이 안 바뀝니다** (클로저는 다시
   도는데 DOM 만 그대로입니다). 그래서 `<ul>` 은 바깥 템플릿에 붙박이로 두고, 함수
   (`varRows`·`functionRows`·`objectInfoRows`)는 `<li>` 배열만 돌려줍니다.

2번 때문에 펼친 리스트 항목과 함수 코드는 이름 줄 **안**이 아니라 목록의 **다음 줄**로
따로 냅니다 — 이름 줄 안에 넣으면 그 줄의 DOM 이 재사용되면서 항목을 넣고 지워도 화면이
안 바뀝니다.

3. **떼어낼 수 있는 조각 안에는 반응형 표현식을 두지 않습니다.** arrow 는 조각을 떼어낼
   때 그 표현식 자리를 반납하는데(`releaseExpressions`), 이미 큐에 올라가 있던 그 조각의
   갱신은 걷어내지 않습니다. 그 갱신이 뒤늦게 돌면 반납된 자리를 불러서
   **`expressionPool[effect] is not a function`** 으로 터집니다. 실제로 오브젝트를 바꿀
   때마다 이 오류가 났습니다 — 모양 드롭다운의 `<option>` 마다 `selected` 를 함수로 넣어
   뒀는데, 오브젝트가 바뀌면 모양 목록이 통째로 갈리면서 그 option 조각들이 떨어져
   나갔기 때문입니다. 그래서
   - `<option>` 의 `selected` 는 함수가 아니라 **그 자리에서 계산한 상수**로 두고, 값이
     바뀌는 것은 `<select>` 의 `value` 가 맡습니다 (arrow 의 `setAttr` 은 `value` 를
     속성이 아니라 프로퍼티로 넣어 주므로 선택이 실제로 따라 움직입니다).
   - 오브젝트 정보는 **줄 구성을 절대 바꾸지 않습니다.** 안내 문구도, 글상자 전용 줄도
     줄을 없애는 대신 `hidden` 으로만 감춥니다. (`.debug-rows > li` 에 `display: flex` 가
     걸려 있어서 `hidden` 이 안 먹으므로 `li[hidden] { display: none }` 을 같이 둡니다.)

서버가 쓰는 기본 포트는 **2013** 입니다. 매번 같은 주소여야 브라우저 개발자 도구 설정과
북마크가 유지되기 때문입니다. 이미 쓰이고 있으면 비어 있는 포트로 대신 열고 알려 줍니다.

`boost_mode` · `device == "mobile"` · `touchable` 은 엔트리 판단 블록이 브라우저에게 직접
물어보는 값이라(각각 `Entry.options.useWebGL`, `Entry.Utils.getDeviceType()`,
`'ontouchstart' in window`) 데스크톱 브라우저 하나로는 다른 갈래를 볼 방법이 없습니다.
디버그 패널은 그 블록들을 감싸서 여기서 고른 값을 대신 돌려주게 합니다 — 브라우저를
바꾸지 않고도 모바일에서만 도는 분기를 확인할 수 있습니다.

#### 진짜 부스트 모드 — `run --boost`

부스트 모드는 엔트리 **만들기 화면에서는 못 켜지만**, 실행기 자체는 `Entry.init` 의
`useWebGL` 옵션 하나로 그 모드로 돕니다(`GEHelper.INIT` → PIXI 렌더러, 아니면 createjs).
우리는 실행기를 통째로 불러오므로 그 옵션을 그냥 켜 주면 됩니다.

**패널의 '부스트 모드' 흉내내기는 그대로 남습니다.** 둘은 서로 다른 것을 정합니다 —
`--boost` 는 **실제로 쓰는 렌더러**를, 패널은 **`boost_mode` 블록이 돌려주는 값**을
정합니다. 부스트로 띄운 채 안 켠 것처럼(또는 그 반대로) 도는 분기를 봐야 할 때가 있어서
따로 둡니다. 패널은 실제 렌더러를 `state.realBoost` 로 함께 보여 줍니다(반응형 상태에
담아 둬야 arrow 가 따라옵니다 — 값을 그때그때 읽는 함수는 반응형 값을 안 건드려서 처음
한 번만 평가되고 굳습니다).

부스트 모드가 되면 두 가지가 함께 달라집니다.

**1. 캔버스는 PIXI 것이 됩니다.** `setCanvasResolution` 이 하던 대로
`canvasEl.width` 를 바꾸면 PIXI 는 그 사실을 몰라서(뷰포트·투영은 그대로) 화면 한 구석에만
그립니다. 대신 `renderer.resolution` 을 올리고 `resize(640, 360)` 을 부릅니다 — 그리기
버퍼는 똑같이 커지지만 무대는 엔트리의 640×360 좌표계에 그대로 남으므로, entryjs 안에
박혀 있는 픽셀 값(물어보기 입력창의 `x:15, y:275` 등)이 전부 그대로 맞습니다. 그래서
부스트 모드에서는 `scaleInputFieldToBuffer` 도 필요 없습니다.

**해상도를 올릴 때는 클릭 판정도 같이 맞춰야 합니다.** PIXI 의 `InteractionManager` 는
`setTargetElement(view, resolution)` 때 받은 해상도를 **자기 것으로 따로 들고 있고**,
나중에 `renderer.resolution` 이 바뀌어도 따라오지 않습니다. 판정은

```js
point.x = (clientX - rect.left) * (view.width / rect.width) / this.resolution;
```

이라서, `view.width` 만 1920 이 되고 `this.resolution` 이 1 로 남으면 좌표가 무대 공간
(0…640)이 아니라 버퍼 공간(0…1920)으로 나옵니다 — 마우스 좌표 표시는
`Entry.stage.getBoundRect()` 로 따로 계산하므로 멀쩡한데, **클릭·터치만 배율만큼 왼쪽 위를
눌러야 맞는** 모양이 됩니다(`touch.ent` 로 재현). 그래서 해상도를 올린 직후
`renderer.plugins.interaction.resolution` 도 같은 값으로 맞춥니다.

**2. 기본 그림은 반드시 같은 origin 이어야 합니다.** entryjs 는 기본 그림을
`crossOrigin` 없이 `new Image()` 로 받아서 `PIXI.Texture.from` 에 넘깁니다
(`GEHelper.newSpriteWithCallback`). 이미지가 다른 origin 에서 왔으면 WebGL 은 그것을
텍스처로 못 올리고 `texImage2D` 가 `SecurityError` 로 막히는데, 그 예외가 렌더 도중에
나므로 **그 프레임이 통째로 안 그려집니다**(확인 단추 하나 때문에 화면 전체가 멈춘 것처럼
보입니다). playentry.org 에서는 기본 그림도 같은 origin 이라 이 문제가 안 납니다. 그래서
부스트 모드에서는 `libDir` 을 늘 `/lib` 로 주고, 설치된 entryjs 가 없으면 서버가 그 경로를
CDN 으로 대신 받아 우리 origin 으로 내보냅니다(`proxyRuntimeFile`). `<script>` 는 텍스처가
아니므로 그대로 CDN 에서 받습니다.

패널이 보여 주는 이름(오브젝트·장면·변수·신호)은 전부 작품에서 온 값이고, 작품은 남이
만든 `.ent` 를 되돌린 것일 수도 있습니다. 그래서 이 UI 는 `innerHTML` 을 아예 쓰지 않고
`textContent` 로만 글자를 넣습니다 (`test/player-debug.test.js` 가 jsdom 으로 확인합니다).

#### 캔버스 좌표계 — 640×360 가정과 그 여파

엔트리는 캔버스를 **`width=640 height=360` 으로 만들고**(`util/init.js`), 무대 컨테이너를
`x=320, y=180, scale=640/480` 으로 놓습니다(`class/stage.js` `initStage`). 즉 무대 좌표
(−240…240, −135…135)는 컨테이너 변환이 처리하지만, **일부 UI 는 그 변환을 거치지 않고
캔버스 픽셀에 직접 그립니다.** 우리는 큰 화면에서 선명하게 보이도록
`setCanvasResolution` 이 그리기 버퍼를 960~1920px 로 키우므로, 그 두 갈래가 어긋납니다.

**물어보기 입력창.** `Entry.stage.showInputField` 는 `CanvasInput` 을
`x:15, y:275, width:520, height:24, padding:13, borderWidth:2, fontSize:20` 으로 만들고,
`CanvasInput.render` 는 그것을 `_ctx.drawImage(_renderCanvas, _x, _y)` 로 캔버스에 **원본
픽셀 그대로** 붙입니다. 버퍼가 1920 이면 640 기준으로 그린 입력창이 화면의 27% 자리에
1/3 크기로 남습니다 — 왼쪽 위 구석에 작게 뜨는 증상이 이것입니다. `scaleInputFieldToBuffer`
가 `showInputField` 를 감싸서 길이·위치를 전부 `버퍼폭/640` 배로 키웁니다. 배율이 하나뿐
이므로 캔버스 안에서 차지하는 **비율**은 640 기준일 때와 같고, 따라서

- 무대 컨테이너에 붙는 확인 단추(`inputSubmitButton`, `x=190, y=71.5`)는 컨테이너 좌표라
  손댈 필요 없이 그대로 오른쪽 끝에 붙고,
- 입력창 판정(`CanvasInput._overInput` 의 `x∈[−226,183], y∈[−110,−73]`)은 무대 좌표로
  박혀 있으므로 그대로 맞습니다.

`width`·`height`·`padding`·`borderWidth` setter 만 `_calcWH`/`_updateCanvasWH` 를 다시
부르므로 길이를 먼저 맞추고 `x`/`y` 를 마지막에 넣습니다. setter 들은 `render()` 를 돌려
주는데 그 `render()` 는 아무것도 반환하지 않으므로(콜백 안에서 `return self` 합니다) 체이닝은
쓸 수 없습니다.

**마우스 좌표.** 엔트리는 마우스 위치를 `Entry.stage.getBoundRect()` 로 잰 캔버스 사각형에
대고 `x = 480*(l/width − 0.5)`, `y = −270*(c/height − 0.5)` 로 환산합니다. 그런데 그
사각형은 `_boundRect` 에 캐시되고 **`Entry.windowResized` 때만** 다시 잽니다. 디버그 패널을
열면 `--debug-panel-width` 가 `#workspace` 의 `padding-right` 를 밀어 캔버스가 옮겨 가는데,
창 크기는 그대로라 엔트리는 옛날 사각형을 계속 씁니다 — 실제 마우스와 작품이 읽는 좌표가
어긋나는 원인입니다. `refreshBoundRect` 가 `updateBoundRect()` 를 직접 불러서 맞춥니다.
부르는 곳은 세 군데입니다: `tessLayoutCanvas` 끝(크기를 바꾼 직후), `#workspace` 의
`padding-right` `transitionend`(패널은 0.15s 동안 밀려나므로 그때가 최종 위치), 그리고
400ms 주기 타이머(그 밖의 이유로 배치가 움직인 경우).

### 엔트리 작품을 Tess 로 되돌리기 — `decompile`

```
$ node index.js decompile temp/dd.ent -o temp/dd_tess
dd.ent -> temp/dd_tess/main.tess
  오브젝트 조각 파일 11개, 에셋(모양·소리) 36개 옮김
  되돌린 소스가 다시 정상적으로 컴파일됩니다.
```

이미 있는 `.ent`(엔트리 작품)를 Tess 소스로 되돌립니다. **오브젝트/글상자 하나마다 조각
파일 하나(`objects/이름.tess`)로 따로 써 두고, `main.tess` 에는 `useobject`/`usetext`
한 줄만 남기는 것이 기본 동작입니다** — 한 파일에 모든 오브젝트가 인라인으로 들어간
거대한 `main.tess` 하나가 아니라, 손으로 짠 것처럼 오브젝트별로 파일이 나뉘어 있어야
나중에 사람이 찾아 고치기 쉽기 때문입니다.

```
temp/dd_tess/
  main.tess                        # scene 마다 useobject/usetext 만 나열
  objects/
    들꽃_연보라.tess                 # useobject 로 감싸질 오브젝트
    질문.tess                        # usetext 로 감싸질 글상자
    ...
  assets/
    image/들꽃_연보라_새그림.png       # <오브젝트이름>_<모양이름>
    sound/들꽃_연보라_딸깍.mp3
    ...
```

모양·소리 이름은 오브젝트마다 따로 붙습니다. 엔트리가 자동으로 붙여 주는 "새그림"
같은 이름은 여러 오브젝트에 그대로 남아 있기 마련이라, 그 이름을 그대로 파일 이름으로
쓰면 **나중에 저장한 파일이 앞의 파일을 덮어써서** 모양 하나만 남습니다(실제로
`bounce.ent` 는 모양·소리 910개 중 824개를 그렇게 잃었습니다). 그래서 파일 이름을
`<오브젝트이름>_<모양이름>` 으로 만들고, 장면이 여러 개면 조각 파일과 같은 기준으로
장면별 폴더에 나눠 담습니다.

```
temp/rider_tess/
  objects/장면_1/새_오브젝트7.tess
  assets/image/장면_1/새_오브젝트7_새그림.png
  assets/sound/장면_2/배경_배경음.mp3
```

그래도 경로가 겹치면 뒤에 번호를 붙여서(`..._2.png`) 반드시 다른 파일이 되게 합니다.
같은 파일을 여러 모양이 함께 쓰면 한 번만 저장하고 모두 그 경로를 가리킵니다.

**SVG 모양은 엔트리가 함께 저장해 둔 PNG 로 가져옵니다** (`--keep-svg` 로 끕니다).
엔트리 벡터 그림판은 그림판 크기를 넘는 이미지도 모양으로 받아 주고, 사용자는 그것을
옮겨서 화면에 맞춰 놓고 저장합니다. 엔트리는 그때 화면을 **PNG 로 캡처해 두지만 SVG 는
저장한 뒤 다시 가운데로 옮겨 버려서**, 맞춰 놓은 위치가 SVG 에는 남지 않습니다. 그래서
`.ent` 안의 `image/<이름>.svg` 옆에는 늘 같은 이름의 `.png` 가 함께 들어 있고, 둘의 내용이
다릅니다 — 되돌릴 때 그 PNG 를 대신 씁니다(`capturedPngFor`).

`examples/ent/image.ent` 가 그 예입니다. 모양의 `dimension` 은 960×540 인데 SVG 는
`viewBox="0 0 1100 670"` 이고 그 안의 `<image>` 가 `x=139.8 y=129.2` 로 밀려 있습니다.
SVG 를 그대로 쓰면 두 가지가 함께 어긋납니다.

1. 컴파일러는 그림 파일에서 크기를 직접 재므로(`assets.js` `svgSize`) `dimension` 이
   1100×670 이 되고, 되돌린 `scale_x 51%` 가 그 위에 곱해져 무대 밖으로 넘칩니다.
2. `<image>` 가 밀려 있어서 화면 왼쪽·위가 비고 그림이 오른쪽 아래로 쏠립니다.

PNG(960×540)는 저장 당시 화면 그대로라 두 문제가 같이 없어집니다. 엔트리 기본 오브젝트의
SVG(`bower_components/…/images/…`)는 `.ent` 안이 아니라 실행기 번들에서 꺼내 오고 캡처
PNG 도 없으므로 그대로 둡니다 — 그림판을 거친 적이 없어 어긋날 일도 없습니다. PNG 는
`dimension` 해상도로 굳은 래스터라 크게 확대하면 SVG 보다 흐릿해집니다. 그것이 문제일 때
`--keep-svg` 를 씁니다.

```tess
# main.tess
scene "장면_1":
  useobject "objects/들꽃_연보라.tess"
  usetext "objects/질문.tess"
end
```

```tess
# objects/질문.tess — object/text 로 감싸지 않은, 오브젝트 속성과 when 블록만
name "질문"
font_color = #00ffff
bg_color = transparent

when start do
  ...
end
```

조각 파일 이름은 항상 그 오브젝트의 **되돌린 식별자**(파일 이름 → 다시 불러올 때
`touching(...)` 등이 가리키는 이름)와 같아서, 되돌린 결과를 그대로 다시 컴파일해도
참조가 어긋나지 않습니다(`decompile` 명령은 되돌린 뒤 바로 다시 컴파일해 보고 그 결과를
알려 줍니다). `useobject`/`usetext` 자체의 문법은 [SPEC-ADDENDUM.md 1.2절](./SPEC-ADDENDUM.md)에
있습니다.

아직 옮기지 못하는 블록이나, 엔트리 워크스페이스에서 어디에도 안 연결된 채 남아 있던
블록 뭉치는 실패로 끝내지 않고 `# [decompile] ...` 주석으로 표시한 뒤 계속 진행합니다 —
명령이 끝나면 몇 개가 그렇게 남았는지만 알려 주고, 하나하나 무엇인지는 `--warnings` 를
붙여야 보여 줍니다.

**함수 머리**도 그대로 살립니다. 엔트리 함수는 `스폰 (인수) 체력 (인수)` 처럼 이름이
중간에 끼어들 수 있고 판단 칸도 받는데, 그 정보를 매개변수 **이름**에 담아
`function 스폰(a, 체력)` 으로 되돌립니다 — 다시 컴파일하면 원래 사슬로 돌아갑니다
(SPEC-ADDENDUM.md 4.6). 자동 이름은 `a`, `b`, … `z`, `a1`, `a2` … 순입니다.

**엔트리 기본 오브젝트**(걷는 엔트리봇 등)의 모양·소리는 작품 파일 안에 안 들어 있습니다 —
`project.json` 이 엔트리 실행기가 자기 번들에 들고 다니는 파일을
`./bower_components/entry-js/images/media/entrybot1.svg` 처럼 가리킬 뿐입니다. 이 경로를
그대로 옮겨 두면 그런 파일이 없어서 다시 컴파일했을 때 모양이 통째로 비어 버리므로,
되돌리기는 설치된 entryjs(`@entrylabs/entry` — `run` 이 쓰는 그 실행기)에서 진짜 파일을
꺼내 와 다른 리소스와 똑같이 `assets/` 밑에 담습니다. 그래서 되돌린 폴더만으로 그림이
살아 있는 작품을 다시 만들 수 있습니다.

엔트리 사용자들이 흔히 쓰는 트릭도 알아봅니다 — "OO 모양으로 바꾸기"/"소리 OO
재생하기" 값 칸에 목록에서 고르는 대신 그 모양·소리의 **진짜 엔트리 id 를 문자열로
직접 적어 넣어도** 엔트리는 그 모양·소리로 바꿔 줍니다(값을 1) id 2) 이름 3) 등록
순번 순으로 찾기 때문). 되돌리기는 이런 리터럴 id 를 프로젝트에 있는 진짜 id 와
맞춰 보고, 맞으면 (다시 컴파일할 때 id 가 새로 배정돼도 안 깨지도록) 그 모양·소리의
Tess 이름으로 바꿔 둡니다. 숫자를 직접 적어 넣는 "n번째 모양으로 바꾸기"도 그대로
숫자로 옮깁니다(`costume = 3`처럼 — Tess 컴파일러도 이 숫자 형태를 그대로 받습니다).

#### 한 오브젝트 것만 쓰는 함수는 그 오브젝트로 옮깁니다

엔트리 함수는 전역이라 어느 오브젝트가 부를지 알 수 없고, 그래서 함수 안의 리소스는
이름 대신 id 로 남기고 그 선언에 `force id` 를 붙여 왔습니다. 하지만 **함수가 건드리는
모양·소리가 전부 한 오브젝트 것이면 그 함수는 사실상 그 오브젝트의 것입니다.** Tess
함수는 오브젝트 안에도 선언할 수 있으므로(`ObjectMember`), 그런 함수는 선언을 그
오브젝트 조각 파일 **맨 끝**으로 옮기고 리소스도 이름으로 적습니다.

```tess
# objects/게임/보스.tess — 이벤트 블록들 뒤, 파일 맨 끝
function 기_모으기():
  costume = "E9A414E1_A5DF_4170_99F8_C048C16C87DE_png"   # id "jalm" 이 아니라 이름으로
  wait 0.05
  ...
end
```

두 오브젝트 이상을 건드리는 함수와, 모양·소리를 아예 안 쓰는 함수만 `main.tess` 의
전역 함수로 남습니다 — 전자는 이름이 어느 오브젝트 것인지 알 수 없어 예전처럼 id 와
`force id` 를 씁니다. 실제 작품에서는 이것만으로 `force id` 가 전부 사라집니다
(`boss.ent`: 함수 9개 중 3개가 오브젝트로 옮겨가고 `force id` 0개, `gamok.ent` 도 0개).

#### 무게중심(중심점)

오브젝트의 `x`/`y` 는 그림 한가운데가 아니라 **중심점**(엔트리 `regX`/`regY`)을 무대의
그 자리에 놓습니다. 엔트리는 오브젝트를 만들 때 이 점을 정하고 그 뒤로는 바꾸지
않으며, 기본값은 모양 한가운데입니다. 사람이 이 점을 옮겨 두면 `x`/`y` 의 뜻 자체가
달라지므로, 되돌릴 때 빠뜨리면 오브젝트가 엉뚱한 곳에 놓입니다.

```tess
center 461.84 116.7
```

한가운데 그대로면 적지 않습니다(컴파일러도 같은 기본값을 씁니다). `examples/ent/right_leaning.ent`
는 스크립트가 `go 0 0` 하나뿐인데, 중심점이 461.84 라서 그림이 무대 맨 왼쪽
(−236 ~ −163, 무대는 −240 ~ 240)에 그려집니다 — 중심점을 빠뜨리면 기본값 72 가 쓰여
한가운데에 서 버립니다. 실제 작품에서도 흔합니다(`gamok.ent` 13개, `boss.ent` 6개).

글상자는 중심점을 갖지 않습니다(엔트리가 `regX` 를 0 으로 고정합니다) — `text` 안에
`center` 를 적으면 컴파일 에러입니다.

#### 숫자는 숫자로 되돌립니다

엔트리의 **`number` 블록과 `text` 블록은 같은 원시 블록**입니다 — 둘 다 적어 둔 글자를
그대로 돌려줄 뿐이고(`block_entry.js`: 각각 `script.getField('NUM'|'NAME')` 하나뿐),
어느 쪽에 담겼는지는 사람이 어느 칸에 입력했느냐일 뿐입니다. 판단 블록도 비교하기 전에
숫자로 읽히는 문자열을 숫자로 바꿉니다(`block_judgement.js`). 그래서 담긴 글자가 같으면
어느 쪽으로 옮겨도 실행 결과가 똑같습니다.

되돌리기는 이 점을 이용해 **숫자로 읽히는 리터럴은 담긴 블록 종류와 상관없이 숫자로**
옮깁니다. 예전에는 `text` 블록을 무조건 문자열로 옮겨서 판단문·계산식·함수 인수의
숫자가 `if (단계 == "14")` 처럼 따옴표를 뒤집어썼습니다.

```
gamok.ent  따옴표 친 숫자 441개 -> 8개
boss.ent                1156개 -> 27개
```

남는 것은 **다시 적으면 글자가 달라지는 값**입니다(`"00.05"`, `"007"` 처럼). 이런 값은
숫자로 바꾸면 `join` 이나 화면 표시에서 달라지므로 글자 그대로 둡니다 —
`isExactNumber`(`String(Number(x)) === x`)가 그 판단을 합니다. 리스트·글자 순번도
`text` 블록에 담겨 있을 수 있어서, 그것까지 알아봐야 `("3" - 1)` 같은 게 안 남습니다.

#### 모양 크기와 글상자틀 크기

**모양 크기는 적지 않는 것이 기본입니다.** 컴파일러가 그림 파일을 열어 직접 재기
때문에(`assets.js`), 적어 두면 그림을 바꿔 넣을 때마다 사람이 숫자까지 함께 고쳐야
합니다. 파일을 담지 못했을 때와, 파일에서 잰 1×1 이 실제 크기가 아닌 빈 그림
(`_1x1.png`)일 때만 적습니다. `--sizes` 를 붙이면 원본 `dimension` 을 **모든 모양에**
`size 가로 세로` 로 적어 둡니다 — 그림 파일을 못 구했거나 원본과 픽셀까지 맞춰야
할 때 씁니다.

**글상자틀 크기(`size 가로 세로`)는 옵션과 상관없이 늘 적습니다.** 엔트리는 이 값을
글자를 실제로 그려 보고 재 두는데, 컴파일러는 글꼴을 그릴 수 없어 `글자수 × fontSize
× 0.85` 로 어림잡습니다. 줄바꿈(`line_break`) 글상자는 폭이 줄 나눔을, 높이가 줄 수를
정하기 때문에 어림값과 크게 어긋납니다 — `gamok.ent` 의 한 글상자는 실제 65×105 인데
어림값은 95×15 로, 세 줄짜리가 한 줄 높이로 납작해졌습니다. 그래서 글상자에 한해
원본 크기를 그대로 남깁니다(문법은 AI_GRAMMAR.md 의 `PropertyDecl_boxSize`).

### 컴파일하면서 하는 일

| 하는 일          | 설명                                                                                                                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `use` 펼치기     | 파일을 그 자리에 통째로 넣고, 에러는 원래 파일 이름·줄 번호로 알려 줍니다                                                                                                                                     |
| 심볼 수집        | 장면·오브젝트·변수·리스트·신호·함수·모양·소리에 엔트리 id 를 붙입니다                                                                                                                                         |
| 스코프 해석      | 함수 지역 → 오브젝트 로컬 → 전역 순으로 찾고, 없으면 오브젝트 속성으로 봅니다                                                                                                                                 |
| 인덱스 보정      | 0부터인 Tess 인덱스를 1부터인 엔트리 인덱스로 (상수는 미리 계산)                                                                                                                                              |
| 없는 블록 펼치기 | `move X Y` → 두 블록, `log2` → `ln/ln2`, `**` → 제곱·제곱근·곱셈                                                                                                                                              |
| 주석 옮기기      | `#` 주석을 블록의 `comment` 로 (문자열 안의 `#` 과 색상은 건드리지 않습니다)                                                                                                                                  |
| 리소스 처리      | 그림에서 원본 크기를, 소리에서 재생 길이를 헤더만 읽어 재고(`assets.js`·`audio.js`) `temp/xx/yy/image/…` 경로를 만듭니다 — 엔트리는 `project.json` 에 적힌 값을 그대로 믿어서, 안 재면 100×100·1초로 굳습니다. 이 단계는 동기라 헤더를 직접 읽습니다 (아래 '라이브러리' 참고) |
| 결정적 id        | 소스에서 만든 시드로 id 를 뽑아, 같은 소스는 항상 같은 결과가 됩니다                                                                                                                                          |

엔트리에 없어서 다르게 만드는 것들(그리고 `use`/`useobject`/`usetext` 같은, 엔트리에는
없는 Tess 만의 문법)은 [SPEC-ADDENDUM.md](./SPEC-ADDENDUM.md)에 정리했습니다.

#### 단계별 시간

`run` 과 `build` 는 단계마다 걸린 시간을 그냥 찍습니다. 어디가 느린지 재 보지 않고
짐작하지 않기 위해서입니다 (`compileProject` 의 `result.timings`).

```
  단계별 시간
    불러오기 · 파싱       514 ms
    의미 검증              81 ms
    주석 모으기            33 ms
    심볼 · 리소스 수집    212 ms
    스크립트 컴파일       101 ms
    작품 조립              42 ms
    서버 준비              28 ms
    합계                 1012 ms
```

#### 줄 번호를 세느라 느렸던 것 (회귀 주의)

`Context#recordLocation` 은 **블록을 만들 때마다** 소스 위치를 `sourceMap` 에 남깁니다.
그런데 `lineAndColumn` 은 파일 처음부터 한 글자씩 세는 O(오프셋) 함수라, 블록 하나당
두 번씩 부르면 전체 비용이 (블록 수 × 파일 길이)로 늘어납니다.

리소스 1,719개·블록 35,416개짜리 예제에서 이 한 함수가 컴파일 시간의 **63%**
(4,192ms 중 2,627ms)를 쓰고 있었습니다. 파일마다 줄 시작 위치를 한 번만 모아 두고
이분 탐색하도록 바꿔서(`lineIndex`, `src/validate.js`) **4,089ms → 700ms** 가 됐습니다.

`lineAndColumn` 자체는 에러 하나를 찍을 때처럼 가끔 부르는 자리에 그대로 남아 있습니다.
**반복문 안에서 부르지 마세요** — 부를 일이 생기면 `lineIndex` 로 표를 만들어 쓰세요.

### 컴파일 에러

`check` 는 **`build` 와 똑같이 끝까지 컴파일해 보고 결과만 버립니다.** 파싱만 해서는
실제로 컴파일되는지 알 수 없기 때문입니다 — `use`·`useobject` 로 불러오는 파일은 펼쳐
봐야 검사할 수 있고, "이 오브젝트에 없는 모양" 같은 문제는 블록으로 옮겨 보는 단계에서야
드러납니다. 에러 위치는 그 코드가 실제로 있는 조각 파일 이름과 줄·열로 알려 줍니다.

엔트리에 옮길 수 없는 코드는 조용히 넘어가지 않고 위치와 함께 알려 줍니다.

```
$ node index.js build broken.tess
broken.tess:12:7  에러: 엔트리에는 scale_x 을(를) 정하는 블록이 없습니다. scale_x += 값 으로 바꾸거나 오브젝트 속성으로 선언하세요.
broken.tess:15:12  에러: 'bullet' 이라는 오브젝트가 없습니다.
broken.tess:21:5  에러: 엔트리 함수는 중간에서 값을 돌려줄 수 없습니다. return 은 함수의 마지막 문장에만 쓸 수 있습니다.
```

컴파일러는 에러를 만나도 거기서 멈추지 않고 그 문장만 빼고 끝까지 갑니다 — 한
번에 에러를 다 보여 주기 위해서입니다. 그래서 만들다 만 작품이 이미 손에 있고,
`--force` 를 붙이면 그걸 그대로 내보냅니다(`compileProject` 의 `options.force`).
큰 작품을 되돌려 놓고 아직 안 고친 부분이 남았을 때, 나머지가 제대로 도는지 먼저
실행해 보는 용도입니다.

```
$ node index.js run broken.tess --force
broken.tess:12:7  에러: 엔트리에는 scale_x 을(를) 정하는 블록이 없습니다. ...
broken.tess: --force — 에러 1개를 무시하고 그대로 실행합니다.
```

에러가 난 문장은 **통째로 빠진 채**로 나오므로 그 부분은 아예 돌지 않습니다.
`ok` 는 여전히 `false` 고, 문법 에러는 작품을 만들 수조차 없어서 `--force` 도 소용없습니다.

## 쓰는 라이브러리와 그 경계

| 하는 일          | 무엇을 쓰나                | 어디                        |
| ---------------- | -------------------------- | --------------------------- |
| 파싱             | `chevrotain`               | `src/parser/`               |
| 문법 에러 출력   | `@babel/code-frame`        | `src/parser/index.js`       |
| 모양 미리보기    | `sharp`                    | `src/compiler/thumbnail.js` |
| `.ent` 묶기      | `tar` (`Header`)           | `src/compiler/bundle.js`    |
| `.ent` 풀기      | `tar` (`Parser`)           | `src/decompiler/tar.js`     |

### `tar` 는 `Header` 만 쓴다

`tar.create` 는 **디스크에 있는 파일**을 묶습니다. 그런데 `.ent` 에 담을 것 중
`temp/project.json` 과 방금 그린 미리보기는 메모리에만 있습니다. 임시 파일로 떨궜다가
묶는 것은 더 나쁘므로, 블록은 직접 쌓되 ustar 헤더의 자릿수·체크섬처럼 틀리기 쉬운
부분만 `tar.Header` 에 맡깁니다.

### `sharp` 로 미리보기를 그린다

직접 짠 PNG 디코더·리사이저(233줄)를 걷어냈습니다. 덤으로 예전에는 PNG 만 미리보기를
만들었는데 이제 **JPEG·GIF·WebP 도** 만듭니다 (엔트리 편집기의 모양 목록에 그만큼 더
보입니다). SVG 는 그대로 `null` 입니다 — 그려 봐야 크기를 아는 형식이라 엔트리도
미리보기를 만들지 않습니다.

### 크기·길이 재기는 아직 헤더를 직접 읽는다

`imageSize`(`assets.js`)와 `audioDuration`(`audio.js`)은 `compileProject` 안에서
불립니다. `compileProject` 는 동기이고 호출부가 113군데(대부분 테스트)입니다. 반면
`sharp.metadata()` 와 `music-metadata` 는 **비동기 전용**이라, 이 둘을 쓰려면
`compileProject` 를 비동기로 바꿔야 합니다.

`makeEntryBundle` 은 호출부가 4군데뿐이라 비동기로 바꿔 `sharp` 를 들였지만,
`compileProject` 는 그렇지 않습니다. 게다가 실측으로 얻을 것이 없었습니다 —
예제의 mp3 **253개 전부** `audio.js` 와 `music-metadata` 의 재생 길이가 정확히
같았습니다(`audio.js` 는 Xing/VBRI VBR 표까지 읽습니다). 엔트리가 받는 소리 형식은
mp3·wav·ogg·m4a 뿐이고 넷 다 이미 다룹니다.

그래서 이 자리는 **일부러 그대로 두었습니다**. 바꾼다면 `compileProject` 를 비동기로
만드는 일이 먼저이고, 그것은 이 표의 문제가 아니라 API 결정입니다.

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
               Send Clone DeleteClone DeleteClones Jump Read TtsSetting
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

| 파일                         | 내용                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------ |
| `test/grammar.test.js`       | spec 각 절의 코드가 파싱되는지 / 잘못된 코드가 거부되는지                      |
| `test/ast.test.js`           | 연산자 우선순위 · 결합 방향 · 문장 AST 모양                                    |
| `test/validate.test.js`      | 의미 규칙과 에러 위치                                                          |
| `test/compile.test.js`       | 엔트리 블록 매핑 · 인덱스 보정 · 함수 · `use` · 주석 · 구조 검증 · `.ent` 묶음 |
| `test/runtime-scale.test.js` | 만들어 넣은 크기 함수를 엔트리 규칙 시뮬레이터로 계산 검증                     |
| `test/power.test.js`         | 거듭제곱·n제곱근이 내는 값을 `Math.pow` 와 비교                                |
| `test/player.test.js`        | `run` 서버의 응답과 파일 경로                                                  |
| `test/player-debug.test.js`  | 디버그 패널 — 탭 · 실행 제어 · 환경 흉내내기 · 자료 보기/고치기 · 오브젝트 정보 · 무대에서 고르기 · 딱 붙이기 · XSS (jsdom) |
| `test/cli.test.js`           | `check` 가 컴파일 단계까지, 조각 파일 안까지 검사하는지                        |
| `test/highlight.test.js`     | VS Code 문법 강조를 실제 토크나이저로 검사                                     |
| `test/examples.test.js`      | `examples/` 의 모든 `.tess` 가 에러 없이 통과                                  |

`examples/all_blocks.tess` 는 Tess 의 거의 모든 명령을 한 번씩 쓰는 파일입니다.
이걸 컴파일해서 나온 블록 484개를 전부 엔트리 스키마와 대조합니다.

문법을 고칠 때는 [Ohm 온라인 에디터](https://ohmjs.org/editor)에 `src/tess.ohm` 을 붙여넣고
실험하거나, `trace()` 로 파서의 판단 과정을 확인하세요.

```js
import { trace } from "./index.js";
console.log(trace("forward 10 at 90", "Statement"));
```
