# tessblock — Blockly 기반 Tess 블록 에디터

`packages/tessblock` 은 블록을 조립해 **Tess 소스를 쓰고**, 그 소스를 Tess 컴파일러로
빌드해 **tessvm 으로 실행**하는 웹 에디터다. 엔트리 워크스페이스와 같은 화면 구성을
따르되, 렌더러는 Blockly 13 의 **zelos** 를 쓰고 UI 는 Preact + `@preact/signals` 로 짰다.

```bash
pnpm tessblock          # vite 개발 서버 (packages/tessblock)
pnpm typecheck          # tessblock 브라우저 tsconfig 포함
```

파이프라인은 한 방향이다.

```
Blockly workspace ──(codegen/generator.ts)──▶ Tess 소스 ──(@tess/compiler)──▶ EntryProject ──(tessvm boot)──▶ 실행
```

에디터는 엔트리 블록 JSON 을 직접 만들지 않는다. 블록이 만드는 것은 언제나 Tess
텍스트이고, 그 뒤는 CLI·확장과 똑같은 경로를 탄다.

---

## 1. 파일 구성

| 경로 | 하는 일 |
| --- | --- |
| `src/blocks/spec.ts` | 블록 명세 DSL(`BlockSpec`, `Arg`) 과 카탈로그 수집기 |
| `src/blocks/catalog/*.ts` | 카테고리별 블록 명세 (시작·흐름·움직임·생김새·붓·소리·판단·계산·자료·자료분석·글상자·확장) |
| `src/blocks/registry.ts` | 명세 → Blockly 블록 정의 · 생성기 등록 · 툴박스/플라이아웃 구성 |
| `src/blocks/fields.ts` | 프로젝트 목록을 읽는 동적 드롭다운(`field_tess_dropdown`) |
| `src/blocks/colour-field.ts` | 팔레트 대신 OS 색 선택기를 여는 `field_colour_picker` |
| `src/blocks/functions.ts` | 함수 정의 블록 · 매개변수 블록 · 호출 블록 생성 |
| `src/blocks/theme.ts` | zelos 기반 테마, 카테고리 색, 툴박스 점 색 주입 |
| `src/codegen/generator.ts` | `Blockly.CodeGenerator` 구현 (`expr`/`chain`/`scrub_`) |
| `src/codegen/project.ts` | 프로젝트 모델 + 워크스페이스 → `.tess` 소스 전체 |
| `src/codegen/refs.ts` | 블록이 들고 있는 id → 이름·식별자 변환 |
| `src/codegen/ident.ts` | 표시 이름 → Tess 식별자 (예약어·내장 이름 회피) |
| `src/model/*` | 프로젝트 모델·신호 저장소·기본값·파일 읽기 |
| `src/runtime/run.ts` | 소스 컴파일 및 tessvm `boot()` |
| `src/ui/*` | Preact 화면. Blockly 와 painter 는 명령형 호스트 모듈로 분리 |

## 2. 블록 명세 DSL

한 블록은 하나의 `BlockSpec` 으로 적는다. 명세 하나가 **블록 정의 · 팔레트 항목 ·
Tess 작성기** 세 가지를 만든다.

```ts
define({
  type: 'moving_forward',
  category: 'moving',
  message: '이동 방향으로 %1 만큼 움직이기',
  args: [numIn('STEPS', 10)],
  shape: 'statement',
  code: (a) => `forward ${a.STEPS}`,
});
```

인자 헬퍼:

| 헬퍼 | Blockly | 생성기가 넘겨주는 값 |
| --- | --- | --- |
| `numIn(name, 기본값, order?)` | `input_value` + `calc_number` 그림자 | 소켓 코드(비었으면 기본값) |
| `textIn(name, 기본값, order?)` | `input_value` + `calc_text` 그림자 | 소켓 코드 |
| `emptyIn(name, 기본값, order?)` | 그림자 없는 `input_value` | 소켓 코드 |
| `boolIn(name)` | `check: 'Boolean'` 소켓 | 소켓 코드(비었으면 `false`) |
| `stack(name)` | `input_statement` | 들여쓴 안쪽 문장들 |
| `numField`·`textField`·`menu`·`toggle` | 필드 | 필드 값 문자열 |
| `pick(name, source)` | 동적 드롭다운 | id 를 푼 **이름 또는 식별자** |
| `colourField(name, 기본값)` | 색 선택기 | `#rrggbb` |

`shape` 은 `hat`(모자) · `statement` · `value` · `boolean` 네 가지다. 값 블록은
`output: 'Value'`, 판단 블록은 `output: 'Boolean'` 을 갖는다. 값 소켓은 검사를 두지
않으므로 판단 블록도 꽂히고, 판단 소켓에는 판단 블록만 꽂힌다 — 엔트리와 같은 규칙이다.

### 2.1 메시지 줄 나누기

`registry.ts` 의 `layoutRows()` 가 `message` 를 `messageN`/`argsN` 여러 줄로 쪼갠다.
`input_statement` 는 언제나 자기 줄을 차지하므로, 그 앞의 글자는 앞줄에 남는다.

```
'만일 %1 이라면 %2'  →  message0: '만일 %1 이라면'  (COND)
                        message1: '%1'             (BODY)
```

한 줄로 두면 `이라면` 이 노치 아래로 내려가 블록이 읽히지 않는다.

## 3. 코드 생성기

`TessGenerator` 는 `Blockly.CodeGenerator` 를 상속한다.

- `expr(block, name, maxOrder, fallback)` — 값 소켓을 읽고, 안쪽 식이 `maxOrder` 보다
  **느슨하게 묶일 때만** 괄호를 씌운다. Blockly 기본 `valueToCode` 는 좌결합 연산에
  불필요한 괄호를 붙이므로 쓰지 않는다.
- `chain(block)` — 모자 블록 아래에 달린 스택을 한 단 들여써 돌려준다.
- `scrub_` — 모자 블록이면 다음 블록을 덧붙이지 않는다. 모자가 `chain()` 으로 자기
  몸통을 이미 썼기 때문이다.

우선순위(`codegen/order.ts`)는 Tess 사다리를 그대로 옮긴 것이다.

| 값 | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 99 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 이름 | ATOMIC | UNARY | POW | MUL | ADD | COMPARE | NOT | AND | OR | NONE |

`move`·`go` 처럼 인자를 공백으로 늘어놓는 문장은 `Order.UNARY` 로 받는다. 그래야
`move (a + b) 10` 처럼 괄호가 붙어 두 인자가 하나로 합쳐지지 않는다.

## 4. 프로젝트 → 소스

`codegen/project.ts` 의 `buildSource(model, { live })` 가 `.tess` 파일 한 벌을 만든다.

1. `nameTable()` 이 변수·리스트·테이블마다 **고유 식별자**를 배정한다(`uniqueIdent`).
2. `project:` 머리글 → 전역 변수/리스트 → 테이블 → 함수 → 장면 순으로 쓴다.
3. 장면 안의 오브젝트는 목록 순서를 그대로 따른다(앞에 있는 것이 앞으로 나온다).
4. 오브젝트 본문: `default costume …` · `sound …` · 좌표/크기/방향/회전/보이기 →
   오브젝트 지역 변수 → `when …` 스크립트.
5. 열려 있는 워크스페이스는 `live` 로 받고, 나머지 오브젝트는 저장된 상태를 **헤드리스
   `Blockly.Workspace`** 에 올려 읽는다.

표시 이름이 식별자로 쓸 수 없으면 `as "원래 이름"` 을 덧붙인다. 오브젝트 키는 장면
안에서 유일하게 만들고, 키와 이름이 다르면 `name "…"` 을 쓴다.

## 5. 동적 드롭다운

`TessDropdown`(`field_tess_dropdown`)은 항목의 **id** 를 저장한다. 이름을 저장하면 이름을
바꾼 순간 블록이 엉뚱한 곳을 가리키므로, 작성기가 `refs.ts` 에서 id 를 이름이나
식별자로 푼다.

| source | 값 | 소스가 없으면 |
| --- | --- | --- |
| `object` `target` `lookTarget` `cloneTarget` | 오브젝트 id, 또는 `mouse`/`wall*`/`self` | 빈 문자열 |
| `signal` `scene` `costume` `sound` | 각 레코드 id → 이름 | 빈 문자열 |
| `variable` `list` `table` | 레코드 id → 식별자 | `없음` |
| `key` | 키 이름 그대로 | — |
| `param` | 편집 중인 함수의 매개변수 id | — |

지워진 레코드를 가리키는 값도 그대로 보존한다(`doClassValidation_` 이 모든 문자열을
허용하고, `getText()` 가 이름을 다시 찾는다). 값이 사라졌다고 블록이 다른 것을 가리키게
바뀌는 편이 더 나쁘기 때문이다.

## 6. 함수

- `func_define` — 모자형 정의 블록. 이름은 `FieldTextInput` 이고, **매개변수는 블록**이다.
  `ARG0…` 값 입력에 꽂히며 `check: 'FuncParam'` 로 매개변수 블록만 받는다. 마지막에는
  언제나 빈 자리가 하나 남아 있어(`tidyHeader`) 거기에 끌어다 놓으면 매개변수가 는다.
- 매개변수는 정의 블록의 **＋ 단추**로만 더한다(값·판단 두 개). 팔레트에는 이 함수가
  이미 가진 매개변수만 놓는다 — 이름 없는 빈 매개변수 블록은 두지 않는다.
- 코드로 만든 블록은 Blockly 가 알리지 않으므로 `addParamBlock` 이 `BlockCreate` 를 직접
  쏜다. 편집기는 그 이벤트를 보고 팔레트와 초안을 따라간다.
- 머리에서 끌어내는 일은 `ParamDragStrategy` 가 **드래그 시작과 동시에** 처리한다.
  Blockly 의 변경 이벤트는 비동기로 모였다 나가므로(숨은 탭에서는 아예 늦는다) 복사본을
  그 자리에서 꽂아 둔다. 휴지통에 버린 경우에만 그 복사본을 거둔다.
- 매개변수 이름은 `FieldParamName` 이 그린다. 흰 입력 상자를 지우고 블록 색 위에 흰
  글자로 얹어 하나의 칩처럼 보이게 하며, **두 번 눌러야** 입력칸이 열린다. 한 번 누르는
  동작은 드래그 몫이다.
- 이름을 고칠 수 있는 것은 **머리에 꽂힌 매개변수뿐**이다. 팔레트나 본문의 복사본은
  쓰려고 꺼낸 것이라 두 번 눌러도 입력칸이 열리지 않는다 — 팔레트는 다시 만들어질 때마다
  갈아 끼우므로 거기서 고친 이름은 어차피 사라진다.
- 이름 바꾸기는 같은 id 를 가진 블록을 모두 따라 바꾼다. 그 블록들도 같은 검사기를 다시
  부르고, 각자는 자기 편집이 끝나기 전까지 옛 이름을 들고 있으므로 서로를 끝없이 고치게
  된다. 그래서 한 번의 통과만 일을 하고 나머지는 비켜선다(`renaming` 잠금).
- `func_param_value` / `func_param_boolean` — 매개변수 블록. 출력은 각각
  `['Value','FuncParam']`, `['Boolean','FuncParam']` 이라 머리에도, 본문 소켓에도 꽂힌다.
  이름은 블록의 `NAME` 필드이고 같은 매개변수 id 를 가진 블록은 함께 이름이 바뀐다.
- 머리에서 본문으로 끌어내면 편집기가 **머리에 같은 매개변수를 다시 채워 넣는다**
  (`FunctionEditor` 의 변경 리스너). 스크래치·엔트리처럼 인수 자체를 끌어다 쓰는 동작이다.
  휴지통에 버리면 그때는 매개변수가 사라진다.
- `func_return`, `func_local_var` — `return E`, `var 이름 = E`.
- 저장하면 `syncFunctionBlocks()` 가 함수마다 `func_call_<id>` 를 정의한다. 정의 본문에
  `func_return` 이 있으면 값 블록 `func_value_<id>` 도 함께 만든다.

매개변수 목록은 항상 머리의 블록에서 읽는다(`readParams`). 편집기는 바뀔 때마다 머리를
정리하고 그 결과를 `functionDraft` 에 반영하며, 저장할 때도 같은 값을 쓴다.

머리의 `ARG` 자리는 매개변수 수만큼 **늘어나는 입력**이라 블록 상태의 일부다. 정의
블록이 `saveExtraState`/`loadExtraState` 로 자리 이름을 적어 두지 않으면, 다시 읽을 때
Blockly 가 `ARG1` 을 찾지 못해 작품 전체가 컴파일되지 않는다. 자리 이름이 없는 옛 파일은
저장된 블록의 입력 이름에서 목록을 되살린다(`migrateFunction`).

## 6.5 무대 미리보기와 변형 상자

`ui/StagePreview.tsx` 는 실행 전 배치를 그대로 보여 준다. 좌표계는 480 × 270, 원점은
가운데, y 는 위쪽이 양수다. 오브젝트 한 개는 이렇게 놓인다.

```
화면점(p) = 원점 + R(angle) · ((p − 무게중심) ∘ (가로비, 세로비))
```

- 모델의 `scaleX` · `scaleY` 는 퍼센트이고 Tess 의 `scale_x` · `scale_y` 로 그대로 나간다.
  인스펙터의 “크기 %” 는 두 값을 비율을 지킨 채 함께 키우고 줄인다.
- `center` 는 무게중심(엔트리의 `regX`/`regY`)이며 모양 픽셀 좌표다. 비워 두면 그림
  한가운데다. 십자 손잡이를 끌면 그림은 그 자리에 두고 x·y 와 `center` 를 함께 고쳐
  화면상 위치가 변하지 않게 한다(`stage-geometry.ts` 의 `centerFromStage`).
- 모서리 손잡이는 비율을 지키고, 변 손잡이는 한 축만 늘인다. Shift 를 누르면 모서리도
  자유 변형이 된다. 위쪽 팔은 회전이고 Shift 로 15도씩 끊어진다.
- 크기 조절은 **반대편 모서리를 붙잡아 둔다**(`resizeFromHandle`). 배율은 무게중심이
  아니라 반대편 모서리까지의 거리로 구하고, 무게중심이 그만큼 밀리므로 x·y 도 같이
  고친다. 무게중심 기준으로 늘이면 오른쪽 손잡이를 끌었는데 왼쪽 변까지 따라 움직여
  손에 잡히지 않는다.
- 손잡이는 배율이 걸린 무대 안이 아니라 그 위 층에 퍼센트 좌표로 그린다. 무대를
  키우거나 줄여도 손잡이 크기는 그대로다. 손잡이 층 자체는 `pointer-events: none` 이고
  손잡이만 포인터를 받는다 — 그러지 않으면 무대 전체가 덮여 오브젝트를 끌 수 없다.
- 무게중심 손잡이는 그림 한가운데에 놓이므로 **무대 도구막대의 토글을 켠 동안에만**
  나타난다. 늘 띄워 두면 오브젝트를 옮기려는 드래그를 그 손잡이가 먼저 가로챈다.
- 글상자도 다른 오브젝트와 같이 배율을 받는다. 미리보기는 모양 크기 그대로 그린 뒤
  `scale()` 로 늘이고, 글상자 크기는 캔버스로 글자를 재서(`model/text-metrics.ts`)
  모델에 넣는다. 같은 값이 `size W H` 로 소스에 나가므로 미리보기와 실행이 일치한다.

## 7. 모양 편집 (painter 연동)

`ui/painter-host.ts` 가 `packages/painter` 의 `createPainterUI` 를 감싼다.

- 도구·색·굵기 같은 화면은 `ui/PaintTools.tsx` 에서 직접 만든다. painter 패키지의
  `createPainterUI` 는 쓰지 않고 `Painter` 코어만 쓴다 — 에디터와 같은 디자인을 쓰기
  위해서다.
- 캔버스는 **960 × 540 고정 시트**다. 모양 크기와 캔버스 크기는 별개다.
- 모양을 열 때 SVG 는 시트 가운데로 옮겨 넣는데, **도형마다 따로 옮긴다**(`centred`).
  하나의 `<g>` 로 감싸면 캔버스에서 그룹 하나로 잡혀, 만들지도 않은 그룹이 생긴다.
- 비트맵은 `loadImage({fit})`.
- 저장할 때 그린 내용에 맞춰 잘라내되, **시트 한가운데를 중심으로 대칭으로** 자른다
  (`middleBox`). 그림에 딱 맞춰 자르면 모양의 중심이 매번 옮겨 다녀, 그림을 고칠 때마다
  무대 위 오브젝트가 튄다. 벡터는 `getBBox()`, 비트맵은 알파값을 훑어 경계를 잡는다.
- 무게중심을 옮겨 둔 오브젝트는 모양 크기가 바뀐 만큼 `center` 도 함께 옮긴다
  (`keepCentre`). 그래야 그림을 고쳐도 무대에서 제자리에 있다.
- 편집이 있었을 때만(`dirty`) 저장한다. 탭을 열어 본 것만으로 모양이 다시 쓰이지 않는다.
- 결과는 `data:image/svg+xml,…` 또는 `data:image/png;base64,…` 로 모델에 담긴다.
  컴파일은 `assetUrls: true` 로 돌리므로 이 주소가 그대로 `fileurl` 이 된다.

## 8. 실행

```ts
const built = build(source, name);              // compileProject(assetUrls: true)
await boot({ project: built.project, container, autoStart: true, kernelUrl: null, scene });
```

`kernelUrl: null` 은 wasm 커널 없이 자바스크립트 커널로 돌린다는 뜻이다. `scene` 은
**지금 보고 있는 장면의 이름**이다 — 엔트리 편집기처럼 시작하기는 작업 중인 장면에서
시작한다(tessvm 의 `Vm.setStartScene`, 이름이나 id 로 고르고 없으면 첫 장면).
실행기가 스스로 그리는 부분(묻고 답하기 칸, 표 창, 권한·알림 상자)은 CSS 를 따로
넣어야 제 모습이 된다 — `installRuntimeStyles()` 가 `ASK_FIELD_STYLE` ·
`CHART_WINDOW_STYLE` · `EXTRAS_DIALOG_STYLE` 을 한 번 붙인다. 실행 전에는
`ui/StagePreview.tsx` 가 오브젝트를 시작 위치에 그려 두고, 무대에서 끌어 옮기면 x·y 가
모델에 바로 반영된다.

## 8.5 속성 편집기

속성 탭은 블록 화면을 덮지 않는다. 팔레트 자리에 패널로 뜨고(`.prop-panel`,
z-index 90 — Blockly 툴박스가 70이다) 오른쪽 블록은 그대로 보인다. 리스트와 테이블은
쉼표 문자열이 아니라 항목·칸 단위 편집기를 쓴다: 리스트는 줄마다 값·순서·삭제,
테이블은 열 이름과 칸을 바로 고치고 행·열을 더하거나 지운다.

변수와 리스트의 **쓰는 범위는 만들 때 정한다**(모든 오브젝트 / 이 오브젝트). 만들기
창에서 한 번 고르고 나면 목록에서는 글자로만 보여 준다 — 나중에 범위를 바꾸면 그 변수를
쓰던 다른 오브젝트의 블록이 조용히 끊어지기 때문이다. 그래서 `변수 추가`·`리스트 추가`
단추도 곧바로 만들지 않고 같은 만들기 창을 연다.

## 8.7 블록 메뉴

`blocks/context-menu.ts` 가 Blockly 의 오른쪽 메뉴를 다시 짠다.

- 말 바꾸기: `중복` → **복제하기**, `댓글` → **주석**, 그 밖의 항목도 에디터 말투로.
- 복제는 잘라 붙이기로 구현해 **맨 위 블록의 왼쪽 위가 마우스 자리**에 오게 한다.
  Blockly 기본 복제는 원본에서 고정된 거리만큼 비켜 놓는다.
- 복사하기와 붙여넣기를 따로 둔다(블록·작업판 양쪽). 붙여넣기도 마우스 자리에 놓는다.
- 자리는 메뉴가 넘겨주는 `location` 대신 **포인터 좌표를 직접 변환해서**
  쓴다(`svgMath.screenToWsCoordinates`). 그래야 작업판이나 브라우저가 확대돼 있어도,
  스크롤돼 있어도 포인터 밑에 떨어진다.

## 8.8 확장 카테고리

`catalog/expansion.ts` 가 `packages/core/src/expansion.ts` 의 `EXPANSION_BLOCKS` 39개를
그대로 블록으로 낸다. 블록 타입은 `ext_` 를 앞에 붙이고, 쓰는 글은 엔트리 블록 타입
이름 그대로다(`get_weather_data("오늘", "서울", "기온")`).

- 표의 `'field'` 칸은 **필드**(드롭다운 또는 글 상자), `'value'` 칸은 **소켓**으로
  놓는다. 컴파일러가 고르는 자리에 식을 받지 않으므로 이 짝이 어긋나면 컴파일 에러가
  난다. `test/tessblock.test.ts` 가 칸 종류·블록 모양·`%N` 개수를 표와 맞춰 본다.
- 고르는 값이 정해진 칸(날짜·시도·하늘 상태·미세먼지·자료 종류·달·언어 등)은
  드롭다운, 시/군/구나 행동요령 분류처럼 목록이 긴 칸은 글 상자다.
- `get_korea_area_code` 는 날씨 서비스가 쓰는 로마자 이름(`"Seoul"`, `"Jung-gu"`)을
  기본값으로 둔다. 이 값을 새 날씨 블록(`get_cur_weather` 등)의 값 칸에 꽂는다.
- 쓰인 블록의 확장 묶음은 컴파일러가 `project.expansionBlocks` 에, 번역 두 블록은
  `aiUtilizeBlocks` 에 자동으로 넣는다.

## 8.9 블록 찾기

팔레트 위 검색 줄(`.block-search`)은 `ui/state.ts` 의 `blockQuery` 신호 하나로 돈다.

- `blocks/registry.ts` 의 `searchFlyout(query)` 가 카테고리를 가리지 않고 카탈로그 전체와
  프로젝트의 함수 호출 블록을 훑는다. 찾는 글감은 블록 문구·카테고리 이름·타입 이름과
  드롭다운 항목 이름이고(타입별로 한 번 만들어 캐시한다), 공백으로 나눈 낱말이 모두
  들어 있어야 맞는다. 하나도 없으면 `{ kind: 'label' }` 한 줄을 띄운다.
- `blockly-host.ts` 가 신호를 구독해 검색 결과를 `flyout.show()` 로 직접 넣고, 검색어가
  비면 `toolbox.refreshSelection()` 으로 고른 카테고리를 되돌린다.
- 검색 줄은 **팔레트 위에만** 있다. 너비는 툴박스와 열린 플라이아웃을 잰 값을
  `--palette-w` 에 써서 맞추고(`ResizeObserver`), 카테고리 목록은 `padding-top` 으로,
  플라이아웃은 맨 앞에 넣는 `{ kind: 'sep' }` 한 칸으로 그만큼 내려간다. 작업판은 위까지
  그대로 쓴다.
- 카테고리를 누르면 검색이 풀린다. 툴박스 DOM 의 `pointerdown` 에서 바로 지운다 —
  Blockly 의 `TOOLBOX_ITEM_SELECT` 는 이벤트 큐를 거쳐 늦게 오므로 입력칸이 남아 보인다.

## 8.10 `.ent` 불러오기 (`model/ent-import.ts`, `blocks/entry-blocks.ts`)

맨 위 **불러오기**는 `.tessproj` 와 `.ent` 를 모두 받는다. `.ent` 는 다음 순서로 옮긴다.

```
.ent(tar, gzip 허용) ──readTar──▶ project.json + 자산
   ──decompileProject(inline, sizes, tableRows:false)──▶ Tess 소스
   ──compileProject──▶ 정규화된 엔트리 블록 트리 (+ restoreTableRows)
   ──toModel──▶ TessProject (레코드 id 는 컴파일된 id 그대로)
   ──convertStack──▶ 오브젝트·함수마다 Blockly 직렬화 JSON
```

- **역변환 표는 카탈로그에서 배운다.** `entryPatterns()` 는 명세마다 표식 값(숫자 70001…,
  `zqk…` 레코드, 판단 자리는 `표식 == 0` 비교)을 넣어 헤드리스 워크스페이스에 블록을 만들고,
  `buildSource` → `compileProject` 로 컴파일한 뒤 표식이 놓인 자리를 구멍(`Hole`)으로 바꾼
  패턴을 루트 엔트리 타입별로 모은다. 드롭다운·체크박스·키는 조합마다 한 패턴(128개 넘으면
  하나씩만 바꿈). 컴파일에 실패한 변형은 그 줄의 `zqktag = N` 으로 찾아 빼고 다시 컴파일한다.
  처음 한 번 약 0.5~1.5초.
- 매칭은 `unify` — 구멍이 아닌 자리는 글자 그대로 같아야 하고, 고정된 부분이 많은 패턴이 이긴다.
  루트 전체가 구멍인 패턴(`judge_value` 처럼 통과만 하는 명세)은 버린다.
- 리터럴 포장 블록(`number`·`text`·`angle`)의 값 구멍은 포장 블록째 잡고, 변환할 때 그림자로 둔다.
- 컴파일러 도우미 함수(`[Tess] …` 라벨)는 모델에 넣지 않는다. 호출 타입을 `helper:<라벨>` 로
  바꿔(`nameHelperCalls`) 빌드마다 다른 id 와 무관하게 맞추고, 원래 배율 같은 나머지 인자는
  `any` 구멍으로 둔다.
- 따로 처리하는 것: 함수 호출(`func_<id>` → `func_call_`/`func_value_`), 매개변수 블록,
  함수 지역 변수(`get/set_func_variable` → `func_local_get/set`, 첫 최상위 대입은
  `func_local_var` 선언), `char_at`(→ `calc_char_at`), `get_boolean_value`(안쪽 판단만).
- 판단 칸에 값 블록이 오면 숨은 `judge_value` 로 감싼다(판단 소켓은 `Boolean` 만 받는다).
- 드롭다운 자리에 식이 오는 엔트리 작품을 위해 식을 받는 숨은 명세가 있다:
  `looks_set_costume_value`, `sound_play_value`, `sound_play_bgm_value`,
  `text_set_colour_value`, `text_set_bg_colour_value`, `text_set_font_name`,
  `brush_set_colour_value`, `brush_set_fill_value`, `calc_from_hex_value`.
- 이름: 함수는 첫 라벨(Tess 이름), 같은 이름이면 `_2`. 지역 변수가 매개변수·다른 지역 변수·
  전역 변수와 겹치면 `_2`. 매개변수 이름은 디컴파일된 소스의 `function 이름(…)` 머리에서 읽는다.
- 옮기지 못한 블록은 빠지고, 알림에 종류와 개수를 보여 준다(`missed`).
- 되돌리지 못하는 것: 키 뗌(엔트리 블록 여럿으로 풀림), `root` 등 상수로 접히는 식,
  `open_table_chart`(번호가 1 줄어 접힘), 삭제된 오브젝트를 가리키던 자리.
- 예제 32개 중 대부분은 원본을 디컴파일·컴파일한 것과 블록 수가 같다. 남는 차이는
  `y` 와 `y("self")` 처럼 같은 뜻을 다른 엔트리 블록으로 적는 경우다.

## 9. 상태와 저장

- 프로젝트 전체는 `model/store.ts` 의 `project` 신호 하나에 있다. 변경은 `update()` 로만.
- `localStorage['tessblock.project.v1']` 에 400ms 디바운스로 자동 저장한다. 그림과 소리는
  여기 들어가지 않는다 — 프로젝트에는 `asset:<id>` 참조만 남는다.
- 자산은 **IndexedDB**(`model/assets.ts`)에 있다. 시작할 때 한 번 읽어 메모리에 데이터
  URL 로 들고 있으므로 무대·그림판·작성기가 기다리지 않고 바로 쓴다(`resolveAsset`).
  자동 저장 때마다 작품이 더는 가리키지 않는 자산을 지우되, 방금 만든 것은 1분 동안
  건드리지 않는다(모양을 저장하는 중일 수 있다).
- `.tessproj` 파일에는 자산을 데이터 URL 로 펴서 담고, 불러올 때 다시 저장소에 넣는다.
  그래야 다른 컴퓨터에서 열어도 그림이 그대로 있다.
- 블록 워크스페이스는 오브젝트마다 Blockly 직렬화 JSON(`object.blocks`)으로 보관하고,
  선택이 바뀔 때 `blockly-host.ts` 가 넣고 뺀다. **블록을 둔 자리도 그대로 저장된다** —
  불러올 때 `cleanUp()` 으로 줄을 세우지 않는다(보기만 블록 쪽으로 옮긴다).
- 옛 파일 보정은 `migrateProject()` 한 곳에 모아 두고, 자동 저장·파일 열기 양쪽이 지난다.
- 사이드 패널 너비는 `localStorage['tessblock.sideWidth']`.
- 오브젝트 복제와 장면 복제는 `cloneObject()` 하나를 같이 쓴다. 모양·소리에 새 id 를
  주고, 그 오브젝트가 가진 변수를 복사한 뒤, 직렬화된 블록 안의 옛 id 를 새 id 로
  바꾼다. 장면 복제는 여기에 **장면 id 도 바꿔 넣어** 복사본의 "장면 시작하기" 가
  복사본 장면을 가리키게 하고, 이름은 작품 전체에서 겹치지 않게 고른다.

## 10. 알아 둘 점

- 플라이아웃은 `autoClose = false` 로 두고 첫 카테고리를 열어 둔다. 엔트리처럼 팔레트가
  항상 보이고, 카테고리를 누르면 내용만 바뀐다.
- 워크스페이스 교체(`showObject`), 함수 호출 블록 등록(`syncFunctionBlocks`), 팔레트
  갱신, 모양 불러오기는 **컴포넌트 이펙트가 아니라 신호 구독**(`signal.subscribe`)으로
  건다. Preact 의 `useEffect` 는 렌더 뒤에 실행되고 탭이 가려지면 미뤄지므로, 선택이
  바뀐 그 자리에서 일어나야 하는 일은 구독으로 처리한다.
- Blockly 는 쌓인 이벤트를 `requestAnimationFrame` 안에서 흘려보낸다. 그래서 **화면이
  보이지 않는 탭에서는 변경 리스너가 아예 돌지 않는다** — 자동 저장도, 팔레트 갱신도
  그 탭이 다시 보일 때 한꺼번에 일어난다. 자동화로 확인할 때 이 점을 빼놓으면 멀쩡한
  기능이 고장 난 것처럼 보인다.
- 드래그 처리는 `ui/drag.ts` 로 모았다. `setPointerCapture` 에 기대지 않고 window 에
  리스너를 달며, 좌표 갱신에 `requestAnimationFrame` 을 쓰지 않는다 — 배경 탭에서는
  프레임 콜백이 멈춰 드래그가 반영되지 않는다.
- 다른 탭이 앞에 있을 때 블록 워크스페이스는 `display: none` 으로 숨긴다. `visibility`
  로 숨기면 위젯 레이어가 살아 있어 입력이 새어 들어간다.
- `painter` 는 `packages/painter/dist/index.js` 를 상대 경로로 읽는다(확장이 tessvm
  소스를 읽는 방식과 같다). painter 소스는 `erasableSyntaxOnly` 를 켜 둔 이 저장소의
  tsconfig 로는 검사되지 않으므로 빌드 산출물을 쓴다 — 새로 받은 저장소라면
  `pnpm --filter painter build` 를 한 번 돌려야 모양 탭이 뜬다.

- 팔레트 갱신(`refreshPalette`)은 팔레트에 보이는 것(변수·신호·테이블·장면·오브젝트·모양·
  소리·함수 머리, 선택된 오브젝트)의 키가 바뀔 때만 한다. 블록을 옮길 때마다 저장이 일어나고,
  갱신이 flyout 을 다시 그리면 열린 우클릭 메뉴가 닫혔다. 메뉴·드롭다운이 열려 있으면 미룬다.
- 우클릭 메뉴는 포커스를 가져가 블록의 선택 테두리가 사라진다. `showContextMenu` 를 감싸
  블록을 먼저 선택하고, 메뉴가 닫힐 때까지 `addSelect()` 로 테두리를 남긴다.
- 주석 아이콘은 CSS 로 숨기고, zelos `RenderInfo.createRows_` 에서도 빼서 블록 왼쪽에 자리를
  남기지 않는다.
- 글상자 크기(`measureTextBox`)는 캔버스에 글꼴을 넣고 잰다. 한 줄 글상자는 불러올 때 다시 잰다.
- 변수 식별자는 오브젝트·함수 이름을 피한다(`nameTable`). 같으면 Tess 가 다른 것으로 읽는다.
- `calc_state`(아이디·닉네임·기기·저장 가능·전체 블록 수)는 `calc_user`·`calc_block_count_all`·
  `calc_can_save` 로 나뉘었고, 옛 파일을 위해 숨긴 채 남아 있다. 기기 종류는 엔트리에 값 블록이 없어
  (`device` 는 비교로만 컴파일됨) 판단의 `judge_device` 만 쓴다.
- 자산 저장(`saveAsset`)은 메모리에 넣고 바로 참조를 돌려준다. IndexedDB 쓰기는 뒤에서 끝난다
  (다른 탭이 DB 를 쥐고 있어도 불러오기가 멈추지 않는다).

- **작품 되돌리기**(`model/store.ts`): `update()` 가 바꾸기 전 판을 `past` 에 넣는다. 500ms 안에
  이어진 변경(드래그, 입력)은 한 단계로 묶는다. 기록 개수는 직렬화 크기로 정한다(대략 120M 글자 /
  작품 크기, 5~100). `replaceProject` 는 기록을 비운다. 되돌린 뒤 `restored` 신호가 오르면
  `blockly-host` 가 보이는 오브젝트의 워크스페이스를 저장하지 않고 다시 읽는다(스크롤 유지).
  단축키는 `App.tsx` 가 캡처 단계에서 받는다. Blockly 는 문서 전체의 Ctrl+Z 를 잡으므로, 캔버스
  밖에서 누른 키는 여기서 끝낸다(`stopImmediatePropagation`). 입력창·Blockly 캔버스·그림판·
  실행 중인 무대는 각자의 되돌리기를 쓴다.
- 팔레트나 캔버스에서 함수 블록(`func_call_`/`func_value_`)을 더블클릭하면 편집기가 열린다
  (블록 SVG 의 `data-id` 로 찾는다).
- 여러 줄 글상자(`lineBreak`)는 손으로 정한 틀이다. 크기 손잡이는 배율이 아니라
  `boxWidth`/`boxHeight` 를 바꾸고, `setTextProps` 는 다시 재지 않는다. 미리보기는 실행기처럼
  위에서부터 `fontSize + 2` 간격으로 줄을 놓고 틀 밖은 자른다.
- 팔레트 아이콘은 `theme.ts` 의 `CATEGORY_ICONS`(선 SVG)를 카테고리 색 배경에 마스크로 씌운다.
- `beginDrag` 기본 문턱은 4px — 누르기만 한 클릭이 오브젝트를 옮기지 않는다.
- 무대의 일시정지는 tessvm 의 `pause()`/`start()`(멈춘 곳에서 이어서)를 쓴다.
- tessvm 렌더러는 초기화 직후 배경색으로 한 번 그린다. 불투명 WebGL 캔버스는 첫 프레임 전까지
  검게 보이고, 첫 프레임은 모든 모양·소리를 받은 뒤에야 오기 때문이다.

- **폴더에서 작업**(`model/folder.ts`, File System Access API — 크롬·엣지): 폴더에
  `project.tessproj` 와 `assets/<자산id>.<확장자>` 를 둔다. 폴더를 열면 `project.tessproj` 를
  읽고, 없으면 폴더 안의 `.ent` 를 옮기고, 그것도 없으면 지금 작품을 써 넣는다. 붙어 있는 동안
  작품이 바뀔 때마다 600ms 뒤 다시 쓴다(한 번에 하나씩). 자산 파일은 한 번만 쓰고, 폴더에서 읽은
  참조는 원래 경로를 기억해(`pathOf`) 같은 파일로 되돌린다. 폴더 핸들은 IndexedDB
  (`tessblock-folder`)에 두고, 다음 방문 때 "다시 연결"(권한 요청)로 붙인다. 새로 만들기와 파일
  불러오기는 폴더를 떼어 폴더 내용을 덮어쓰지 않는다. 테스트는 같은 API 인 OPFS
  (`navigator.storage.getDirectory()`)와 `attach()` 로 한다.
- **새로 만들기**는 `update()` 를 거치므로 Ctrl+Z 로 되돌릴 수 있다.
- `.ent` 불러오기는 단계마다(`ImportProgress`) 진행을 알리고 `setTimeout(0)` 으로 숨을 돌린다.
  블록 대응표는 `warmEntryPatterns()` 가 250개씩 컴파일하며 사이사이 쉰다. 화면 전체에
  `busy` 덮개(진행 막대)를 띄운다.
- 시작하기는 부팅이 모양·소리를 모두 받을 때까지 기다리므로 무대 위에 진행 막대를 띄운다
  (`boot` 의 `onProgress`). 측정(오브젝트 28개): 소스 5ms · Tess→엔트리 컴파일 27ms ·
  tessvm 부팅 253ms. 큰 작품(inthedark 786KB)은 컴파일 약 0.5초 중 파싱이 75~90%.
  즉 엔트리 형식으로 바꾸는 단계는 있지만(tessvm 은 엔트리 블록 JSON 을 JIT 한다) 병목은
  자산 로딩이다.
- 속성 창의 변수·신호·함수는 표 대신 폭 520px 의 행 목록(`.rec`)이다. 이름은 두 번 눌러
  (`InlineName`), 변수의 처음 값·저장 방식은 행을 눌렀을 때만 편다. 보이기는 눈 아이콘, 함수
  편집은 연필 아이콘. 리스트 항목은 손잡이를 끌어 옮긴다(`beginDrag`).
- 복제·복사는 블록과 그 아래에 붙은 블록 전부를 옮긴다(`stackCopyData`, `addNextBlocks`).
- 지역 변수 블록(`func_local_*`)은 함수를 편집할 때만 팔레트에 나온다.
- 무대 버튼은 아이콘만(깃발·일시정지·정지), 색은 아이콘에만 있다.

## 11. 남은 일

- 작품은 `.tessproj` 파일로 저장하고 불러올 수 있다(맨 위 저장·불러오기). `.ent` 도 불러온다(8.10). 자동 저장은
  브라우저 저장소를 쓰므로 큰 작품은 파일로 따로 남기는 편이 안전하다.
- 오브젝트 복제는 모양·소리·스크립트와 그 오브젝트의 지역 변수까지 함께 복사하고,
  복사한 스크립트가 복사한 변수를 가리키도록 블록 안의 변수 id 를 바꿔 준다. 파일 크기는 막지 않으므로(엔트리도 `.ent` 는
  검사하지 않는다) 큰 작품은 localStorage 한도에 걸릴 수 있고, 그때는 자동 저장이
  실패했다고 알린다(`saveFailed`).
- 하드웨어·인공지능(읽어주기 등) 카테고리.
