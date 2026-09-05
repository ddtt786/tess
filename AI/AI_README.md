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

pnpm 워크스페이스 모노레포입니다. 패키지는 아래로만 의존합니다 —
`cli → decompiler → player → compiler → parser → core`. 순환은 없습니다.
`tessvm` 은 그 위에 얹히는 별개의 실행기로, `decompiler` 와 `compiler` 를 쓰지만
아무도 `tessvm` 을 쓰지 않습니다.

| 패키지              | 이름               | 외부 의존성                  | 역할                                                    |
| ------------------- | ------------------ | ---------------------------- | ------------------------------------------------------- |
| `packages/core`     | `@tess/core`       | 없음                         | 모든 패키지가 함께 쓰는 표: 내장 함수·상태 값·속성 이름, 키 코드, 확장 블록, 이름 추천 |
| `packages/parser`   | `@tess/parser`     | chevrotain, @babel/code-frame | 소스 → 토큰 → CST → AST, 그리고 의미 검증               |
| `packages/compiler` | `@tess/compiler`   | sharp, tar                   | AST → 엔트리 작품(project.json · `.ent`)                |
| `packages/player`   | `@tess/player`     | preact                       | `run` 이 띄우는 미리보기 서버와 실행 페이지             |
| `packages/decompiler` | `@tess/decompiler` | tar                        | `.ent` → Tess 소스                                      |
| `packages/tessvm`   | `@tess/vm`         | pixi.js, es-toolkit          | Tess 작품을 PixiJS 로 직접 돌리는 실행기 (`bin: tessvm`) — [AI_TESSVM.md](./AI_TESSVM.md) |
| `packages/cli`      | `tess`             | @clack/prompts               | 라이브러리 재export + CLI (`bin: tess`)                 |
| `editors/vscode`    | `tess-lang`        | —                            | VS Code 문법 강조 (설치법은 그 폴더의 README)           |

`core` 는 의존성이 없다는 점이 중요합니다. `didYouMean` · `KEY_CODES` · `EXPANSION_BLOCKS` ·
`BUILTIN_FUNCTIONS` 는 파서와 컴파일러가 모두 쓰기 때문에, 한쪽에 두면 두 패키지가 서로를
부르게 됩니다. 이것들을 `core` 로 내려서 의존 방향을 한쪽으로 폈습니다.

테스트는 루트 `test/` 하나에 모여 있습니다. 여러 패키지를 가로지르는 경우(컴파일 → 검증 →
실행 페이지)가 많아 패키지별로 쪼개지 않았고, 각 테스트는 내부 파일이 아니라 패키지 이름
(`@tess/compiler` 등)으로 import 합니다 — 패키지 경계가 실제로 닫혀 있는지 같이 확인됩니다.

| 파서 파일                                  | 역할                                                       |
| ------------------------------------------ | ---------------------------------------------------------- |
| `packages/parser/src/parser/tokens.js`     | 토큰 정의와 어휘 분석(chevrotain `Lexer`)                  |
| `packages/parser/src/parser/parser.js`     | 구문 규칙(`CstParser`)                                     |
| `packages/parser/src/parser/visitor.js`    | 파스 트리(CST) → AST 변환                                  |
| `packages/parser/src/parser/index.js`      | 토큰화 → 파싱 → AST 를 묶고 에러 위치를 코드 프레임으로    |
| `packages/parser/src/validate.js`          | **의미 검증** — 문법으로 표현할 수 없는 spec 규칙 검사     |
| `packages/parser/src/parse.js`             | 파서 공개 API (`parse`, `parseOrThrow`, `check`)           |
| `packages/parser/legacy/tess.ohm`          | 초기 Ohm 문법 정의. 참고용으로만 남아 있고 아무도 읽지 않는다 |

| 컴파일러 파일                                   | 역할                                                     |
| ----------------------------------------------- | -------------------------------------------------------- |
| `packages/compiler/src/index.js`                | 심볼 수집 → 스크립트 컴파일 → 프로젝트 조립              |
| `packages/compiler/src/statement.js`            | Tess 문장 → 엔트리 블록                                  |
| `packages/compiler/src/expression.js`           | Tess 표현식 → 엔트리 값·판단 블록                        |
| `packages/compiler/src/include.js`              | `use` · `useobject` · `usetext` 를 그 자리에 펼치기      |
| `packages/compiler/src/comments.js`             | Tess 주석 → 엔트리 블록 주석                             |
| `packages/compiler/src/runtime.js`              | 엔트리에 없는 동작을 대신할 함수 만들어 넣기             |
| `packages/compiler/src/assets.js`               | 모양·소리 파일 → 엔트리 리소스 경로, 그림 원본 크기 재기 |
| `packages/compiler/src/audio.js`                | 소리 파일 헤더에서 재생 길이 재기 (mp3 · wav · ogg · m4a) |
| `packages/compiler/src/bundle.js`               | `.ent` (tar) 묶기 — 의존성 없이 직접                     |
| `packages/compiler/src/verify.js`               | 만든 프로젝트가 엔트리 구조에 맞는지 검사                |
| `packages/compiler/src/block-params.js`         | 엔트리 블록별 파라미터 자리 개수표                       |
| `packages/core/src/expansion.js`                | 엔트리 확장 블록표 — 컴파일러와 디컴파일러가 함께 쓴다   |
| `packages/core/src/keycodes.js`                 | 키 이름 → 엔트리 키 코드                                 |
| `packages/core/src/suggest.js`                  | 편집 거리 기반 오타 추천(`didYouMean`)                   |
| `packages/player/src/server.js`                 | 미리보기 서버 — 실행기·에셋·자동 새로고침                |
| `packages/player/src/debug-ui.js`               | 디버그 패널 UI (preact 로 만든 브라우저 모듈)            |
| `packages/player/src/debug-style.ts`            | 디버그 패널 CSS — 두 실행 페이지가 함께 붙인다           |
| `packages/tessvm/src/web/debug.ts`              | 디버그 패널이 tessvm 을 보는 어댑터                      |
| `packages/decompiler/src/index.js`              | `.ent` → Tess 소스(오브젝트마다 `objects/이름.tess` 조각 파일 + `useobject`/`usetext`) |

**문법과 동작을 완전히 분리**했습니다. `parser/` 에는 "엔트리" 라는 말이 한 줄도 없고,
"그래서 이게 무슨 뜻인가" 는 `validate.js` 가, "엔트리로 어떻게 옮기나" 는
`compiler/` 가 담당합니다.

## 사용법

```js
import { parse, compileProject, makeEntryBundle } from "tess";

const result = compileProject(source, { path: "main.tess" });
if (result.ok) {
  fs.writeFileSync("game.ent", makeEntryBundle(result.project, result.assets));
}
```

```js
import { parse } from "tess";

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
| `compileProject(source, options?)` | `{ ok, project, errors, warnings, notices, assets }` 반환 |
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
| 전역 함수에서 오브젝트 로컬 변수 참조                                | 14.2 | 경고 |
| 여러 오브젝트가 같은 이름으로 가진 로컬 변수를 전역 함수에서 참조     | 14.2 | 에러 |
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

#### `sound_speed` 값 읽기가 빠져서 글자 찍기 효과가 첫 글자에서 멈췄던 일

`sound_volume`(소리 크기)은 값으로 읽는 자리(`compiler/expression.js`)와 되돌리는 자리
(`decompiler/expr.js` 의 `get_sound_volume`)가 둘 다 있었는데, 짝인 `sound_speed`(재생
속도, entryjs `get_sound_speed` — `Entry.playbackRateValue`)는 되돌리는 쪽이 빠져 있어서
`[decompile: get_sound_speed]` 라는 문자열 자리표시자로 남았습니다. 이 값이 하필 배틀·
대화창의 "글자 하나씩 찍기" 효과(`잡글효_글`)가 다음 글자로 넘어가기 전에 기다리는
`n초_기다리기_조건` 안의 산술식(`timer * get_sound_speed()`)에 쓰이고 있어서, 문자열을
곱하면 `NaN` 이 되고 `NaN >= NaN` 은 절대 참이 안 되어 그 `wait` 가 영원히 안 풀립니다.
겉보기엔 "특정 글자만 보이고 그 뒤로는 하나도 안 보임" 으로 나타납니다 — 매 줄의 첫
글자까지는(대기 이전이라) 정상적으로 찍히지만, 그다음 글자로 넘어가는 재귀 호출 자체가
`wait` 에 막혀 한 번도 실행되지 못하기 때문입니다. `sound_volume` 과 똑같은 모양으로
`compiler/expression.js`(읽기: `sound_speed` -> `get_sound_speed`)와
`decompiler/expr.js`(되돌리기: `get_sound_speed` -> `sound_speed`) 양쪽에 짝을 채워
넣어 고쳤습니다.

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
  주소      http://127.0.0.1:2014/
  실행기    tessvm (PixiJS)
  새로고침  켜짐  --no-reload 로 끌 수 있습니다
```

**`run` 은 tessvm 으로 띄웁니다.** 같은 규칙으로 훨씬 빠르게 돌고, 엔트리 실행기와 그
서드파티 라이브러리를 받아 오지 않아도 됩니다([AI_TESSVM.md](./AI_TESSVM.md)).
엔트리 실행기(entryjs)로 보고 싶으면 `--entry` 를 붙입니다 — 아래 이야기는 그쪽입니다.

```
$ node index.js run examples/all_blocks.tess --entry
  주소      http://127.0.0.1:2013/
  실행기    설치된 @entrylabs/entry
```

두 실행기는 **같은 컴파일 결과와 같은 디버그 패널**을 받습니다. 다른 것은 그 작품을
무엇이 돌리는가 하나뿐이라, 어느 쪽에서 이상하면 다른 쪽과 대 볼 수 있습니다.

컴파일한 작품을 그 자리에서 띄우고 브라우저를 엽니다. `--entry` 서버가 주는 것은

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

#### createjs 판본 고정 — 2015.11.26 (EaselJS 0.8.2)

`THIRD_PARTY_SCRIPTS` 의 createjs 는 반드시
`createjs@1.0.1/builds/createjs-2015.11.26.min.js` 여야 한다. 같은 npm 패키지의
기본 파일인 `builds/1.0.0/createjs.min.js`(EaselJS 1.0.0)를 쓰면 2D 렌더러에서
**`~에 닿았는가?`(`reach_something`) 가 언제나 거짓**이 된다.

경로는 이렇다.

1. EaselJS 1.0.0 은 `DisplayObject.cache()` 를 `BitmapCache` 로 옮기면서
   `_cacheScale` · `_cacheOffsetX` · `_cacheOffsetY` 를 더 이상 채우지 않는다.
   그런데 `DisplayObject.getBounds()` 는 캐시가 있으면 여전히 그 세 값을 읽어
   `setValues(undefined, undefined, w/undefined, h/undefined)` 를 만든다.
   `Rectangle.setValues` 가 `NaN || 0` 을 거치므로 결과는 늘 `{0, 0, 0, 0}` 이다.
   즉 **캐시된 오브젝트는 크기가 0×0 으로 보고된다.** 0.8.2 에는 `cache()` 안에
   그 세 값을 넣는 코드가 있어서 이 문제가 없다.
2. 엔트리는 효과(투명도 · 밝기 · 색깔 …)가 걸린 오브젝트를 createjs 렌더러에서
   곧바로 캐시한다 (`EntityObject.applyFilter` → `cache()` →
   `object.cache(0, 0, getWidth(), getHeight())`). 게임에서 페이드·투명 처리를
   한 번이라도 거친 오브젝트는 전부 여기 걸린다.
3. `reach_something` 의 픽셀 충돌은 `extern/util/ndgmr.Collision.js` 로 가는데,
   그 첫 관문인 `_collisionDistancePrecheck` 가 `getTransformedBounds()` 를 쓴다.
   폭·높이가 0 이면 `Math.abs(dx) < 0` 이 참이 될 수 없어 늘 "멀리 떨어져 있다" 로
   판정하고 곧바로 `false` 를 돌려준다. 그 뒤의 실제 픽셀 비교는 아예 돌지 않는다.

`build` 로 만든 `.ent` 를 playentry.org 에서 열면 멀쩡히 막히는 이유가 이것이다 —
그쪽은 예전 판 createjs 로 돌고, 판본을 잘못 고른 것은 실행 페이지뿐이었다.
`@types/createjs@0.0.29`(entryjs 의 devDependency)도 0.8.x 계열을 가리킨다.

부스트 모드(`--boost`)는 PIXI 로 그리고 `window.ndgmr` 를 PIXI 전용 구현으로
갈아 끼우므로 이 문제의 영향을 받지 않는다. 2D 로 돌 때만 나타난다.

#### 디버그 패널 — preact

`src/player/debug-ui.js` 한 파일이고, 서버가 `/debug-ui.js` 로, preact 를
`/preact/preact.mjs` 로 내보낸다. 빌드 단계가 없어서 JSX 대신 `h()` 를 그대로 쓴다.

상태는 얇은 Proxy(`observable`) 하나로 감싸 두고, 값이 바뀌면 패널을 통째로 다시
그린다. preact 가 실제로 달라진 DOM 만 고치므로 이것으로 충분하다 — arrow-js 때
표현식마다 따라다니느라 생겼던 회피책(줄을 지우지 않고 `hidden` 으로만 감추기,
목록을 배열로만 돌려주기)은 전부 사라졌다.

**실행기는 어댑터 하나로만 만난다.** 패널 코드 어디에도 `window.Entry` 를 직접 만지는
곳은 없고, `rt()` 가 돌려주는 어댑터로만 실행기를 봅니다.

```js
const rt = () => window.tessRuntime ?? entryRuntime;
```

`entryRuntime` 이 엔트리 실행기용 기본 구현이고, tessvm 은 자기 어댑터를
`window.tessRuntime` 에 걸어 둡니다(`packages/tessvm/src/web/debug.ts`). 그래서 같은
패널이 두 실행기를 그대로 몹니다 — 실행 제어·자료·오브젝트·장면·환경 흉내내기·오류까지.
실행기마다 다른 것은 어댑터 안에만 있습니다(예: 캔버스를 찾는 법, 무대 칸 크기,
환경 판단 블록을 감쌀지 값을 그냥 넣을지).

패널 스타일은 `packages/player/src/debug-style.ts` 한 곳에 있습니다 — 엔트리 실행 페이지와
tessvm 실행 페이지가 같은 CSS 를 붙이기 때문입니다.

**안 보이는 탭은 아예 그리지 않는다.** 블록이 35,000개인 작품도 있어서, 켜져 있지도
않은 탭의 블록 트리를 0.4초마다 다시 만들면 그것만으로 느려진다.

**다시 그리기는 `queueMicrotask` 로 미룬다. `requestAnimationFrame` 으로 미루면 안
된다** — 브라우저는 탭이 뒤에 있거나 가려지면 rAF 를 아예 멈춘다. 그러면 패널을
눌러도 상태만 바뀌고 화면은 그대로라 디버거가 통째로 먹통이 된 것처럼 보인다.
(실제로 이 버그를 브라우저에서 확인하고 고쳤다.)

#### Ctrl+Shift 로 무대에서 오브젝트 고르기

실행 화면에서 Ctrl+Shift 를 누른 채 오브젝트를 누르면 오브젝트 탭이 열리면서 그
오브젝트가 골라진다. 예전에는 잘 안 먹었는데, 브라우저에서 직접 재 보니 이유가
세 가지였다.

1. **덮개가 `#workspace` 바깥에 있다.** 작품이 멈춰 있는 동안 엔트리가 씌우는
   "눌러서 시작" 판은 `#workspace` 밖에 붙는다. 눌린 요소가 무대 안인지로 따지던
   판정이 정작 오브젝트를 살펴보고 싶은 그때 늘 빗나갔다. 지금은 **캔버스가 놓인
   자리(좌표)** 로 따진다.
2. **`entityClick` 을 기다리면 안 된다.** 그 이벤트는 늘 오지 않는다 — 덮개가 클릭을
   먼저 먹으면 캔버스까지 가지도 않고, 실행 중이어도 렌더러에 따라 다음 차례로
   넘어간다(createjs 는 뒤이어 오는 mousedown, PIXI 는 제 ticker). 0ms 짜리 창은 그
   전에 닫혀 버렸다. 지금은 **경계 상자로 직접 맞힌다** — 멈춰 있든 돌고 있든,
   2D 든 WebGL 이든 언제나 답이 나온다. `entityClick` 이 오면 그쪽을 더 믿는다.
3. **디버깅하려던 클릭이 작품을 시작시켰다.** `pointerdown`·`mousedown` 뿐 아니라
   뒤따르는 `mouseup`·`click` 까지 고르는 동안에는 삼킨다.
4. **부스트 모드에서는 캔버스가 여러 개다.** PIXI 는 글자 따위를 그리려고 눈에 안
   보이는 도우미 캔버스를 열 몇 개나 먼저 만든다(실측 19개). `#workspace canvas` 로
   첫 번째를 집으면 크기 0 짜리가 잡혀서 좌표를 못 재고, 고르기가 아예 시작되지
   않았다 — 부스트 모드에서만 안 되던 이유가 이것이다. `#entryCanvas` 로 집고,
   이름이 없으면 화면에서 자리를 가장 많이 차지한 캔버스를 고른다.

#### 지금 장면의 오브젝트만 본다 (가장 컸던 원인)

`Entry.container.objects_` 에는 **모든 장면의** 오브젝트가 다 들어 있고, 다른 장면 것도
`getVisible()` 이 참인 채로 제자리에 남아 있다. 마녀 작품에서 재 보면 558개 중 지금
장면은 13개인데, **다른 장면인데 보이는 것으로 잡히는 게 285개**다.

그래서 그대로 훑으면 화면에 있지도 않은 앞 장면의 배경이 먼저 걸린다. 같은 자리를
눌렀을 때:

```
전체를 훑으면 : 꼬마마녀 썸네일.png1  (장면: Story)   ← 지금 화면에 없는 것
지금 장면만    : 배경                 (장면: Battle)  ← 실제로 눌린 것
```

첫 장면에서는 그 장면 오브젝트가 목록 앞쪽에 있어 우연히 맞아 보이지만, **장면을 한 번
넘긴 뒤로는 어디를 눌러도 늘 같은(앞 장면의) 오브젝트만 골라진다** — "인트로에선
되는데 장면 넘어가면 선택이 뻗는다" 가 이것이다. `getCurrentObjects()` 로 지금 장면만
본다.

#### 판정에 남는 상태를 두지 않는다

처음에는 "고르는 중" 플래그를 세우고 `engine.fireEventOnEntity` 를 빈 함수로 바꿔치기
했다가 잠시 뒤 되돌리는 식이었다. **그 중 하나라도 되돌아오지 못하면 그 뒤로는 영영
안 먹는다** — "한두 번 되다가 안 된다" 는 이런 모양으로 나타난다.

지금은 누를 때마다 이벤트만 보고 새로 판단한다(`isPick`). Ctrl+Shift 로 무대를 누른
클릭은 언제나 우리 것이므로 플래그가 필요 없고, `preventDefault` + `stopPropagation`
으로 실행기까지 못 가게 막으므로 함수를 바꿔치기할 일도 없다. `state.picking` 은 화면에
표시만 하고 고르는 일에는 관여하지 않는다.

완전히 투명한 오브젝트(`entity.effect.alpha === 0`)는 건너뛴다. 무대를 덮는 투명한
판이 하나 있으면 어디를 눌러도 그것만 잡혀서 역시 "고르기가 안 되는 것" 처럼 보인다.

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

**장면 바로가기.** 장면 이름 옆의 단추로 그 장면으로 넘어가서 **그 장면을 실행합니다** —
뒤쪽 장면을 고쳐 보려고 앞 장면을 처음부터 다시 깨는 수고를 덜어 줍니다. 엔트리의 "장면
시작하기" 블록과 같은 길입니다.

```js
Entry.scene.selectScene(scene);
Entry.engine.fireEvent('when_scene_start');
```

`selectScene` 은 무대에 그리는 장면만 갈아 끼울 뿐이라, 이것만으로는 그 장면의 **"장면이
시작되었을 때"** 가 돌지 않습니다 — 장면은 넘어갔는데 아무것도 안 움직이는, 멈춘 화면처럼
보입니다. 엔트리 자신도 `start_scene`·`start_neighbor_scene` 블록에서 `selectScene` 뒤에
`fireEvent('when_scene_start')` 를 이어서 부릅니다(entryjs `block_scene.js`).

**이벤트는 실행 중일 때만 갑니다.** `Entry.engine.fireEvent` 는 엔진 상태가 `run` 이
아니면 그냥 돌아가므로(entryjs `class/engine.js`), 멈춰 있으면 `toggleRun`, 일시정지면
`togglePause` 로 먼저 실행을 켠 다음에 이벤트를 보냅니다. 장면을 먼저 고르고 실행을 켜는
순서라, 켜질 때 도는 "시작하기 버튼을 클릭했을 때" 도 넘어간 그 장면에서 돕니다.

이미 그 장면에 있을 때 눌러도 이벤트를 다시 보냅니다 — 그 장면을 처음부터 다시 돌리는
길입니다(`selectScene` 은 같은 장면이면 `resetSceneDuringRun` 만 하고 돌아갑니다).

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
붙여야 보여 줍니다. 되돌리기도 경고와 주의를 나눠 셉니다 — 아래 진단 등급 항목 참고.

**함수 머리**도 그대로 살립니다. 엔트리 함수는 `스폰 (인수) 체력 (인수)` 처럼 이름이
중간에 끼어들 수 있고 판단 칸도 받는데, 그 정보를 매개변수 **이름**에 담아
`function 스폰(a, 체력)` 으로 되돌립니다 — 다시 컴파일하면 원래 사슬로 돌아갑니다
(SPEC-ADDENDUM.md 4.6). 자동 이름은 `a`, `b`, … `z`, `a1`, `a2` … 순입니다.

#### 함수와 오브젝트 로컬 변수

엔트리 함수는 전역이지만, 몸통에 넣은 `get_variable`/`set_variable` 블록은 **변수 id 를
그대로** 들고 있습니다. 그 변수가 어느 오브젝트의 로컬 변수든 상관없이 항상 그 하나를
가리키므로, 엔트리에서는 전혀 모호하지 않습니다. Tess 도 이를 그대로 허용합니다.

이름만 남은 소스에서 같은 뜻이 되려면 그 이름을 가진 오브젝트가 하나여야 합니다.
`Context.lookupVariable` 은 함수 안에서 매개변수 → 함수 지역 변수 → (오브젝트 안에
선언한 함수면) 그 오브젝트의 로컬 → 전역 순으로 찾고, 그래도 못 찾으면
`lookupObjectLocal` 로 모든 오브젝트의 로컬을 훑습니다.

- 오브젝트 안에 선언한 함수가 그 오브젝트의 로컬을 쓰는 것 — 권장 형태, 아무 말도 안 합니다.
- 전역 함수가 어느 오브젝트 하나의 로컬을 쓰는 것 — 그 변수로 컴파일하고, 그 오브젝트
  안에 선언하라고 **경고**합니다.
- 여러 오브젝트가 같은 이름의 로컬을 가진 것 — 무엇을 가리키는지 알 수 없으므로 **에러**입니다.

**모양·소리 이름도 같은 이유로 같은 폴백을 씁니다.** `change_to_some_shape`/`get_sounds`
같은 블록도 값 칸에 진짜 엔트리 id 를 들고 있어서, 그 모양·소리가 몇 번째 오브젝트
것이든 상관없이 항상 그 하나를 가리킵니다. 그런데 `resolvePicture`/`resolveSound`(
`compiler/statement.js`)와 `resolveSoundValue`(`compiler/expression.js`)는 오직
`ctx.object`(지금 컴파일 중인 오브젝트) 하나만 봤어서, 전역 함수 안에서는 `ctx.object`
가 `null` 이 되어 `costume = "이름"`/`play sound "이름"` 이 무조건 에러였습니다.
`Context.lookupObjectResource(kind, name)` 를 추가해 `lookupObjectLocal` 과 같은 모양의
폴백(유일한 소유자면 그 오브젝트 것으로 컴파일, 여럿이면 에러)을 셋 다 공유합니다.

함수 하나의 `content` 에는 **스택마다 스레드가 하나씩** 들어 있고, 정의 블록이 항상
첫 번째는 아닙니다 — 워크스페이스에서 정의보다 위에 놓인 주석 블록이나 떼어 놓은
블록 뭉치가 먼저 옵니다. 그래서 되돌리기는 `content[0][0]` 을 그냥 집지 않고
`function_create`/`function_create_value` 인 스레드를 찾습니다(`functionCreateBlock`).
이걸 안 하면 그 함수는 머리도 몸통도 없는 빈 함수가 되어, 그 함수를 부르는 곳이
전부 조용히 아무것도 안 하게 됩니다.

**함수의 지역 변수**도 이름을 되찾습니다. 엔트리는 함수 지역 변수를 함수 항목의
`localVariables`(`{name, value, id}`) 에 따로 담아 두고, 함수 몸통에서는
`get_func_variable`/`set_func_variable` 의 `함수id_해시` 로만 가리킵니다. 되돌리기는 이
표를 읽어 id → 이름 대응을 만들고, 함수 몸통 맨 위에 `var 이름 = 초기값` 을 적습니다 —
Tess 컴파일러가 함수 안의 `var` 를 그대로 엔트리 지역 변수로 되돌리므로(compiler/index.js
`collectFunctionLocals`) 다시 컴파일해도 같은 표가 나옵니다. 이름은 함수 안의 이름 찾기
순서(매개변수 → 지역 변수 → 전역)에 맞춰 매개변수·전역과 겹치지 않게 붙입니다. 이 표를
못 읽으면 몸통이 `_missing_local_...` 자리표시자로 남아 다시 컴파일할 수 없습니다.

**매개변수 이름도 같은 이유로 변수 이름을 다 비껴 갑니다.** 매개변수 이름은 함수
서명에서 그 칸 바로 앞에 붙은 라벨에서 따오는데(`함수 이름 (x) 체력 (y)` 의 `체력`),
그 라벨이 작품에 있는 변수 이름과 같을 수 있습니다. 엔트리 함수 몸통은 변수를 id 로
가리키므로 그래도 아무 문제가 없지만, 이름만 남은 Tess 소스에서는 매개변수가 같은
이름의 변수를 가려 버립니다 — 읽기는 조용히 매개변수 값으로 바뀌고, 대입은
"함수 매개변수에는 값을 대입할 수 없습니다" 에러가 되어 그 문장이 통째로 사라집니다.
그래서 되돌리기는 매개변수 이름을 고를 때 전역·오브젝트 로컬 변수 이름을 모두 이미 쓴
이름으로 넣어 두고(`variableNames`), 겹치면 뒤에 숫자를 붙입니다(`넉백횟수` →
`넉백횟수_2`). 매개변수 이름이 곧 엔트리 서명의 라벨이 되므로(compiler/index.js
`isAutoParamName`), 이렇게 비껴 간 매개변수는 되돌린 작품의 서명 라벨도 그만큼
달라집니다.

`dog.ent` 의 `멍뭉팀 이동함수` 가 이 경우였습니다. 서명의 `넉백횟수` 라벨과 전역 변수
`넉백횟수` 가 같은 이름이라 몸통의 `넉백횟수 = <매개변수>` 가 에러로 빠졌고, 그 변수가
0 으로 남아 `repeat 넉백횟수` 가 한 번도 돌지 않았습니다. 되돌린 작품에서는 소환된
캐릭터가 곧바로 `hide` → `del clone` 까지 흘러가 스폰 직후 사라졌습니다.

같은 작품에서 **튜토리얼이 안 뜨는 것은 되돌리기 탓이 아닙니다.** 튜토리얼(게임화면의
`창 뜨기`)은 `@멍뭉대왕 진행도 == 1` 일 때만 돌고, 그 값을 1 로 되돌리는 계정 초기화는
로딩 장면의 `if 신규유저 != nickname` 안에 있습니다. `project.json` 에 저장된 값이
`진행도 = 33`·`신규유저 = 0` 인데 로그인 없이 실행하면 `nickname` 이 빈 값이라 이 조건이
숫자 비교로 참이 되지 못해 초기화가 건너뛰어집니다 — 원본 `.ent` 를 그대로 실행해도
똑같습니다(블록 구조가 원본과 글자까지 같습니다). 진행도를 1 로 두고 게임화면에 들어가면
되돌린 작품에서도 대화가 뜨고 `캐릭터 움직임대기` 가 10 이 되어 캐릭터가 멈춥니다.

`skip`·`stop`·`show` 처럼 **혼자서 문장이 되는 낱말**은 파서가 대입보다 먼저 문장으로
읽어 버려서(`parser.js` 의 `STANDALONE_LEADERS`) 변수 이름이 될 수 없습니다. 되돌리기는
이런 이름과 예약어(`RESERVED`)를 만나면 뒤에 `_` 를 붙입니다(`skip` → `skip_`).

**색 자리**(`draw_color`/`fill_color`/`font_color`/`bg_color`)는 엔트리에서 색을 고르는
칸이지만 값 블록을 끼워 넣을 수도 있고, 실제 작품이 그렇게 씁니다. 그래서 컴파일러는
색상 리터럴·`transparent`·문자열뿐 아니라 **계산되는 값**도 받습니다.

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

#### 엔트리 이름은 이름 그대로 되살립니다

되돌리기는 이름을 Tess 식별자로 바꾸면서 원래 이름을 `as "..."` 로 함께 적습니다
(문법은 AI_SPEC-ADDENDUM.md 1.5절). 이걸 안 하면 **실행 결과가 달라집니다.**

엔트리의 "() 모양으로 바꾸기" 는 값을 1) id 2) 이름 3) 등록 순번 순으로 찾습니다
(`Entry.Sprite.prototype.getPicture`). 그래서 `costume = "상호작용1*1"` 처럼 이름을
문자열로 적거나 `costume = join("pillow", n)` 처럼 실행할 때 만들어 쓰는 코드는,
모양 이름이 `상호작용1_1` 로 바뀐 순간 아무것도 못 찾고 복제본이 **직전 모양을 그대로
달고 남습니다**. `deltarune.ent` 에서는 방 안의 투명한 상호작용 판정 스프라이트가
전부 엉뚱한 그림(이불·침대)으로 보이는 증상으로 나타났습니다.

한 작품에서 이렇게 어긋나던 이름의 수:

```
deltarune.ent  모양 311개 · 소리 102개 · 변수 288개
```

소리 이름은 확장자까지 이름의 일부입니다(`snd_select.mp3`) — 예전에는 확장자를
떼고 식별자를 만들면서 그대로 잃어버렸습니다.

컴파일러는 두 철자 **모두**를 같은 모양 하나에 걸어 둡니다. 그래서 되돌린 소스에서
식별자로 적어도, 원래 이름으로 적어도 같은 것을 가리키고, `project.json` 의 모양
목록이 늘어나지도 않습니다(`compiler/index.js` 의 별칭 등록과 `new Set(...)` 중복 제거).

#### 작품 자체가 망가진 참조는 살려서 되돌립니다

오래 손댄 작품에는 **가리키는 대상이 이미 없는 블록**이 남아 있습니다. 엔트리는
이런 블록을 지우지 않고, 실행하다 그 자리에 닿을 때에야 터집니다. 되돌리기가 그대로
옮기면 소스가 아예 컴파일되지 않아서 나머지 멀쩡한 부분까지 못 씁니다.

| 망가진 것                             | 되돌리기가 하는 일                                             |
| ------------------------------------- | -------------------------------------------------------------- |
| 지워진 변수·리스트를 가리키는 블록    | `var missing_var_<id> = 0` 선언을 만들어 붙입니다              |
| 지워진 장면으로 가는 `jump`           | 실행될 수 없으므로 `# [decompile] ...` 주석으로 남깁니다       |
| 지워진 오브젝트의 지역 변수           | 전역으로 옮깁니다 (예전에는 아무 말 없이 사라졌습니다)         |
| 리스트 id 를 담은 `get_variable`      | 그대로 옮기고 경고합니다 — 엔트리도 실행할 때 못 찾습니다      |
| 지워진 오브젝트를 가리키는 블록       | 아이디를 그대로 남기고 경고합니다 (`touching`·`go`·좌푯값 …)   |

모두 경고를 남깁니다. `deltarune.ent` 를 되돌린 소스의 컴파일 에러가 이 처리들로
40개에서 0개가 되었습니다.

**옮길 표기가 없어서 자리표시자로 나가던 값들.** 값 블록을 되돌리지 못하면
`"[decompile: 블록이름]"` 이라는 **문자열**이 그 자리에 들어가, 숫자·색을 기다리는
칸이 조용히 깨집니다. 그래서 다음 네 가지를 표기가 있는 쪽으로 붙였습니다.

| 엔트리 값                             | 되돌리기가 적는 것                                              |
| ------------------------------------- | --------------------------------------------------------------- |
| `color` (붓 색 고르기)                | `#ffdc69` — `text_color` 와 같은 원시 색 블록입니다             |
| `calc_operation` 의 `asin`·`acos`·`atan` | `asin(x)` — entryjs 가 `_` 뒤를 잘라 `asin_radian` 과 같은 계산입니다 |
| `calc_operation` 의 `unnatural`       | `(abs(x) - floor(abs(x)))` — 빼기여야 10진으로 맞습니다        |
| `is_press_some_key` 의 기호 키        | `key_down("=")` — 아래 키 이름 항목 참고                        |

`factorial` 만 아직 자리표시자입니다 — Tess 로는 한 식으로 적을 수 없습니다.

**소수 부분은 나머지(`%`)로 쓰면 안 됩니다.** 두 계산은 수학적으로 같지만 엔트리
안에서는 다릅니다 — `unnatural` 은 `BigNumber(x).minus(floor(x))` 로 **10진**
계산이라 49.1 이 정확히 0.1 이 되고, 나머지 블록은 `l - r * floor(l / r)` 를 2진
부동소수 그대로 해서 0.10000000000000142 가 됩니다. 빼기 블록(`calc_basic` MINUS)이
BigNumber 를 쓰므로 `(abs(x) - floor(abs(x)))` 가 엔트리와 같은 값입니다.

그 차이가 실제로 작품을 깨뜨렸습니다. `deltarune.ent` 의 초상화 애니메이션은
`소수 부분`의 **자릿수를 글자로 잘라 읽어** "몇 번째 모양까지 돌릴지" 를 정합니다
(`slice(소수부, 3, 길이)`). 나머지로 되돌리면 `0.1` 대신 `0.10000000000000142` 가
나와서 그 값이 50 이 아니라 10000000000000192 가 되고, 말하는 동안 모양이 끝없이
넘어가다 96개를 한 바퀴 돌아 **1번 모양('ERROR!' 그림)** 이 얼굴 위에 뜹니다.
(엔트리에서 같은 자리를 재어 확인했습니다 — 되돌린 소스의 `도착` 값이 엔트리에서도
같은 쓰레기 값이었고, 빼기로 고친 뒤에는 두 쪽 모두 50 입니다.)

**키 이름을 엔트리 목록에 맞췄습니다.** `KEY_CODES` 에 기호 키(`;` `=` `,` `-` `.`
`/` `~` `[` `backslash` `]` `'`, 코드 186~192·219~222)가 빠져 있었습니다. 이름이
없으면 판단은 자리표시자가 되고 **`when key` 머리는 스레드째로 주석**이 됩니다 —
`deltarune.ent` 에서 `[`·`\`·`]` 키로 시작하는 스레드 4개(장면 이동까지 들어 있는
뭉치)가 그렇게 사라졌습니다.

**글자 하나 읽기(`char_at`)는 `이름[번호]` 로 적습니다.** `slice(문자열, i, i)` 로
옮기면 자리 번호가 **두 번** 계산되어, 그 안에 무작위 수가 있으면 서로 다른 값이
나옵니다. `이름[번호]` 는 컴파일러가 다시 `char_at` 으로 되돌리는 유일한 표기이고
(문법상 `[` 앞은 이름 하나여야 합니다), 이름으로 적을 수 없는 자리는 여전히 `slice`
로 나가면서 경고를 남깁니다.

**아직 남은 것 — 지워진 오브젝트를 가리키는 블록.** `locate`·`reach_something` 처럼
대상 오브젝트를 고르는 칸은 오브젝트 id 를 들고 있는데, 그 오브젝트가 이미 없으면
되돌리기가 id 를 그대로 적고(`go "7o00"`) 컴파일이 `'7o00' 이라는 오브젝트가
없습니다` 에러로 그 문장을 버립니다. Tess 에는 없는 오브젝트를 가리킬 표기가 없어서
(모양·소리의 `force id` 에 해당하는 것이 오브젝트에는 없습니다) 지금은 살릴 방법이
없습니다. 조건 칸이 이렇게 빠지면 감싸고 있던 `if`/`if_else` 까지 함께 사라져
`else` 쪽 동작도 잃습니다 — `dog.ent` 의 `카드배치` 는 몸통이 통째로 비고,
`파워업` 장면의 카드 생성 뭉치도 이 때문에 빠집니다. 남은 컴파일 에러 12개가 전부
이 한 가지입니다.


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

**소리 길이(`for 초`)도 늘 적습니다.** 그림과 달리 소리 길이는 컴파일러가 파일을
"재는" 것이 아니라 mp3 머리말로 **어림잡습니다**(`compiler/src/audio.ts`). 예제
16개의 소리 804개로 재 보면 엔트리가 재 둔 값과 **170개(21%)** 가 0.1초씩 어긋납니다
(`deltarune.ent` 의 `battle.mp3` 는 75.4 → 75.5, `boss.ent` 의 `비행기 추락` 은
4.3 → 4.2). 이 값은 그냥 표시용이 아니라 **"소리 재생하고 기다리기" 가 기다리는
시간**이고(entryjs: `Math.floor(sound.duration * 1000 / playbackRate)`),
`Entry.initSound` 는 길이가 0 인 소리를 아예 읽어 들이지 않습니다. 그래서 소리는
글상자틀과 같은 이유로 원본 값을 그대로 남깁니다 — 그림 크기는 파일에서 정확히
재므로 여전히 적지 않습니다.

**크기(배율)는 퍼센트 소수점까지 적습니다.** 엔트리는 크기를 배율(`scaleX`)로,
Tess 는 퍼센트로 적습니다. 퍼센트를 정수로 깎으면 51.3% 짜리 오브젝트가 51% 로
줄어드므로(예제에서 `gy.ent` 20개 중 16개가 이렇게 어긋났습니다), 다시 100 으로
나누어도 같은 배율이 나오는 자리까지만 반올림합니다(`scalePercent`).

### 컴파일하면서 하는 일

| 하는 일          | 설명                                                                                                                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `use` 펼치기     | 파일을 그 자리에 통째로 넣고, 에러는 원래 파일 이름·줄 번호로 알려 줍니다                                                                                                                                     |
| 심볼 수집        | 장면·오브젝트·변수·리스트·신호·함수·모양·소리에 엔트리 id 를 붙입니다                                                                                                                                         |
| 스코프 해석      | 함수 지역 → 오브젝트 로컬 → 전역 순으로 찾고, 없으면 오브젝트 속성으로 봅니다                                                                                                                                 |
| 없는 블록 펼치기 | `move X Y` → 두 블록, `log2` → `ln/ln2`, `**` → 제곱·제곱근·곱셈                                                                                                                                              |
| 주석 옮기기      | `#` 주석을 블록의 `comment` 로 (문자열 안의 `#` 과 색상은 건드리지 않습니다)                                                                                                                                  |
| 리소스 처리      | 그림에서 원본 크기를, 소리에서 재생 길이를 헤더만 읽어 재고(`assets.js`·`audio.js`) `temp/xx/yy/image/…` 경로를 만듭니다 — 엔트리는 `project.json` 에 적힌 값을 그대로 믿어서, 안 재면 100×100·1초로 굳습니다. 이 단계는 동기라 헤더를 직접 읽습니다 (아래 '라이브러리' 참고) |
| 결정적 id        | 소스에서 만든 시드로 id 를 뽑아, 같은 소스는 항상 같은 결과가 됩니다                                                                                                                                          |

엔트리에 없어서 다르게 만드는 것들(그리고 `use`/`useobject`/`usetext` 같은, 엔트리에는
없는 Tess 만의 문법)은 [SPEC-ADDENDUM.md](./SPEC-ADDENDUM.md)에 정리했습니다.

**리스트·문자열 인덱스는 이제 엔트리처럼 1부터입니다** (AI_SPEC-ADDENDUM.md 4.3절).
전에는 Tess 만 0부터라서 컴파일할 때마다 `[i]` → `(i + 1)` 을, 되돌릴 때마다 `(i - 1)` 을
끼워 넣었습니다 — 리터럴이면 `--fold-index` 로 미리 접을 수 있었지만 기본은 안 접어서,
원본 `.ent` 를 되돌렸다가 다시 컴파일하면 있지도 않던 `calc_basic` 블록이 늘어나는
구조적 잡음이 생겼습니다(순번이 상수든 계산식이든 마찬가지). 지금은 `shiftIndex`/
`unshiftIndex` 를 걷어내고 인덱스를 그대로 옮기므로 이 잡음 자체가 안 생기고,
`--fold-index` 플래그도 할 일이 없어져 지웠습니다. `slice(s, a, b)` 도 엔트리 `substring`
그대로 양끝 포함으로 바뀌었고(전에는 Tess 만 절반열린 `[a, b)`), `index_of` 도 엔트리
`index_of_string` 그대로 못 찾으면 `0` 을 돌려줍니다(전에는 Tess 가 `-1` 로 보정).

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

### 진단 등급 — 에러 · 경고 · 주의

| 등급 | 뜻                                                       | 기본 동작                          |
| ---- | -------------------------------------------------------- | ---------------------------------- |
| 에러 | 그 문장을 엔트리 블록으로 옮길 수 없습니다.              | 그 문장만 빠지고 `ok` 가 `false`   |
| 경고 | 만들어진 작품에 컴파일러가 고칠 수 없는 흠이 남습니다.   | 노란색으로 그대로 보여 줍니다      |
| 주의 | 엔트리가 블록을 실행할 때 스스로 푸는 것입니다.          | 회색으로 흐리게 보여 줍니다        |

`CompileResult` 와 `DecompileResult` 는 셋을 `errors` · `warnings` · `notices` 로 나눠
돌려줍니다.

주의는 값 칸을 **이름 그대로** 흘려보낸 자리에 붙습니다. 엔트리는 모양·소리 칸을
1) id 2) 이름 3) 등록 순번 순으로 맞춰 찾으므로, 컴파일 시점에 이 오브젝트의 모양·
소리로 묶이지 않은 이름도 실행할 때 그 이름의 자원을 찾아냅니다 — 컴파일러가 지금
판정할 수 없는 것이지 틀렸다고 말할 수 있는 것이 아닙니다.

- `resolvePicture` · `resolveSound` (`compiler/statement.ts` 의 `byNameAtRuntime`)
- `resolveSoundValue` (`compiler/expression.ts`) — `sound_duration()` 의 소리 칸
- 되돌리기의 `pictureName` · `soundName` (`decompiler/index.ts`) — 작품에 없는 자원 id

반대로 이런 것들은 실행할 때 저절로 풀리지 않으므로 **경고**로 남습니다.

- 모양·소리 파일을 `assetDirs` 에서 찾지 못함 (`compiler/assets.ts`) — 묶음에 없는 파일을 가리킵니다
- 오브젝트에 모양이 하나도 없음 (`compiler/index.ts`) — 엔트리가 그릴 것이 없습니다

### 느슨한 실행과 `--strict`

컴파일러는 에러를 만나도 거기서 멈추지 않고 그 문장만 빼고 끝까지 갑니다 — 한
번에 에러를 다 보여 주기 위해서입니다. 그래서 만들다 만 작품이 이미 손에 있고,
`build` 와 `run` 은 **기본값으로** 그걸 그대로 내보냅니다. 큰 작품을 되돌려 놓고
아직 안 고친 부분이 남았을 때, 나머지가 제대로 도는지 먼저 실행해 보기 위해서입니다.

```
$ node index.ts run broken.tess
broken.tess:12:7  에러: 엔트리에는 scale_x 을(를) 정하는 블록이 없습니다. ...
broken.tess: 에러 1개가 난 문장을 빼고 실행합니다. --strict 를 붙이면 여기서 멈춥니다.
```

에러가 난 문장은 **통째로 빠진 채**로 나오므로 그 부분은 아예 돌지 않습니다.
`ok` 는 여전히 `false` 고, 문법 에러는 작품을 만들 수조차 없어서(`project` 가 `null`)
느슨한 실행으로도 내보낼 것이 없습니다.

`--strict` (`compileProject` 와 `decompileEnt` 의 `options.strict`) 는 이 느슨함을 끕니다.

- 에러가 하나라도 있으면 `project` 가 `null` 이 되어 `build`·`run` 이 멈춥니다.
- `notices` 가 비고, 그 내용이 `warnings` 로 올라갑니다.

`check` 는 검사가 목적이므로 `--strict` 와 상관없이 에러가 있으면 종료 코드 1 입니다.

## 에러 문구

### 오타는 짚어 준다

이름을 하나 잘못 적었을 뿐인데 "그런 것 없습니다" 만 돌려주면 어디가 틀렸는지 눈으로
찾아야 한다. 특히 한글은 글자 하나가 자음·모음이 뭉친 덩어리라 `체력` 과 `체렄` 이
잘 구별되지 않는다. `src/compiler/suggest.js` 가 아는 이름 중 가장 가까운 것을 찾아
붙인다.

```
typo.tess:6:7   선언되지 않은 이름 '체렄' 에 값을 대입했습니다. 혹시 '체력' 인가요?
typo.tess:7:17  '점푸' 모양이 이 오브젝트에 없습니다. 혹시 '점프' 인가요?
typo.tess:8:11  알 수 없는 함수 'lenght' 입니다. 혹시 'length' 인가요?
```

거리는 Damerau-Levenshtein 으로 잰다. **붙어 있는 두 글자가 바뀐 것(`lenght`)을 한
번으로 세는 것이 핵심이다** — 손으로 칠 때 가장 흔한 실수라, 이걸 두 번으로 세면
정작 찾아 줘야 할 오타를 놓친다. 봐주는 정도는 이름 길이에 따라 다르다(3글자 이하 1,
8글자 이하 2, 그 위 3) — 짧은 이름에서 두 글자가 다르면 오타라기보다 다른 이름이다.

붙이는 자리: 변수·리스트 이름, 함수 이름(내장 + 사용자), 모양·소리 이름, 오브젝트
이름, 장면 이름, 키 이름.

**가까운 이름을 찾았으면 원래 안내는 내지 않는다**(`orHint`). "혹시 '점프' 인가요?"
와 "'점푸' 로 먼저 등록하세요" 를 같이 내면 서로 어긋난 말이 된다.

### 같은 자리를 두 번 말하지 않는다

검증기(`validate.js`)는 컴파일 전에 이름을 훑어서 "선언되지 않은 이름" 을 미리 알려
주는데, 컴파일까지 갔으면 같은 자리에서 더 자세한 에러가 이미 나온다. 둘 다 내면 같은
오타를 두 번 읽게 되므로, 에러가 난 자리(파일 + 오프셋)의 경고는 접는다
(`withoutDuplicates`).

## 쓰는 라이브러리와 그 경계

| 하는 일          | 무엇을 쓰나                | 어디                        |
| ---------------- | -------------------------- | --------------------------- |
| 파싱             | `chevrotain`               | `src/parser/`               |
| 문법 에러 출력   | `@babel/code-frame`        | `src/parser/index.js`       |
| CLI 출력         | `@clack/prompts`           | `src/cli/output.js`         |
| 디버그 패널 UI   | `preact`                   | `src/player/debug-ui.js`    |
| 모양 미리보기    | `sharp`                    | `src/compiler/thumbnail.js` |
| `.ent` 묶기      | `tar` (`Header`)           | `src/compiler/bundle.js`    |
| `.ent` 풀기      | `tar` (`Parser`)           | `src/decompiler/tar.js`     |

### 단계는 끝나는 대로 바로 찍는다

`compileProject` 는 `onPhase` 로 단계가 끝날 때마다 알려 주고, CLI 가 그때그때 한 줄씩
찍는다. 다 끝나고 표를 한꺼번에 보여 주면 그동안 멈춘 것처럼 보이기 때문이다.
색은 `@clack/prompts` 가 제 기호에, `src/cli/output.js` 가 나머지 글자에 입힌다 —
둘 다 `NO_COLOR`·`FORCE_COLOR`·TTY 여부를 같은 기준으로 본다.

컴파일 단계는 동기라 도는 표시를 붙일 수 없다(그동안 이벤트 루프가 막혀 있다).
`.ent` 묶기나 서버 열기처럼 비동기인 일에만 `working()` 이 돌아가는 표시를 붙이고,
끝나면 다른 단계와 똑같은 모양의 한 줄로 바뀐다.

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
| `test/tessvm-debug.test.ts`  | 같은 패널을 tessvm 어댑터 위에 올려서 확인 — 실행 제어 · 자료 · 오브젝트 · 장면 · 환경 · 오류 (jsdom) |
| `test/cli.test.js`           | `check` 가 컴파일 단계까지, 조각 파일 안까지 검사하는지                        |
| `test/highlight.test.js`     | VS Code 문법 강조를 실제 토크나이저로 검사                                     |
| `test/examples.test.js`      | `examples/` 의 모든 `.tess` 가 에러 없이 통과 (조각을 불러오는 진입점은 컴파일까지) |
| `test/decompile.test.js`     | 되돌리기 — 조각 파일 분리 · 이름 보존(`as`) · 공유/실시간 변수 · 테이블 왕복    |
| `test/coverage.test.js`      | 설치된 entryjs 의 블록 팔레트를 직접 읽어, 지원해야 할 카테고리에 빠진 블록이 없는지 |

`examples/all_blocks.tess` 는 Tess 의 거의 모든 명령을 한 번씩 쓰는 파일입니다.
이걸 컴파일해서 나온 블록을 전부 엔트리 스키마와 대조합니다.

### 블록 커버리지를 손으로 적지 않는 이유

`test/coverage.test.js` 는 지원 블록 목록을 갖고 있지 않습니다. 대신
`node_modules/@entrylabs/entry/extern/util/static.js` 를 `vm` 으로 실행해서
`EntryStatic.getAllBlocks()` 가 돌려주는 **진짜 팔레트**를 읽고, 각 블록 타입이
`src/` 어딘가에 글자로 등장하는지 봅니다. 목록을 적어 두면 엔트리가 블록을 늘렸을 때
조용히 뒤처지지만, 이렇게 하면 `@entrylabs/entry` 를 올릴 때 바로 드러납니다.

팔레트에는 코드로 옮길 수 없는 것도 섞여 있어 두 가지를 걸러냅니다.

- 블록이 아닌 항목 — `*AddButton`(만들기 버튼), `*_title`(확장·인공지능 묶음 제목)
- 작품에 들어갈 수 없는 블록 — 정의에 `class: 'checker'` 가 붙은 학습(강의) 채점용
  블록 13개와, `isNotFor: ['functionEdit']` 인 함수 편집 화면 전용 블록
  (`function_name` — 컴파일러가 `function_field_label` 로 직접 만듭니다)

지금 통과하는 카테고리는 `start` `flow` `moving` `looks` `brush` `text` `sound`
`judgement` `calc` `variable` `func` `analysis` `expansion` 13개입니다.
`ai_utilize` 와 하드웨어 카테고리는 아직 대상이 아닙니다.

문법을 고칠 때는 [Ohm 온라인 에디터](https://ohmjs.org/editor)에 `packages/parser/legacy/tess.ohm` 을 붙여넣고
실험하거나, `trace()` 로 파서의 판단 과정을 확인하세요.

```js
import { trace } from "tess";
console.log(trace("forward 10 at 90", "Statement"));
```
