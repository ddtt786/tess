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
| `../blockly/` | Blockly 13.3.0 포크(core + field-colour · field-grid-dropdown). 14절 |
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
- **모양 다듬기 성능** (`painter/src/vector/tools/reshape.ts`, `brush.ts`)
  - 붓 획은 perfect-freehand 윤곽점마다 노드가 생겨 한 획에 수백 개였다. 확정할 때 화면 0.35px 이내의
    점을 버린다(`simplifyRings`, 모양은 그대로, 노드는 약 1/3).
  - 다듬기 오버레이는 요소를 유지한다(`drawn`). 드래그는 한 프레임에 한 번(`requestAnimationFrame`)
    움직인 노드의 사각형·외곽선·선택 노드 손잡이만 고친다. 선택 변경은 class 만 바꾸고, 줌이
    바뀌었거나 오버레이가 지워졌으면 전체를 다시 그린다.
  - 손잡이 판정은 7px 안에서 **가장 가까운** 것을 고른다(예전엔 첫 번째라 촘촘한 획에서 엉뚱한 노드가 잡힘).
  - 헤드리스 Chromium, 1500 노드 경로에서 한 프레임에 이동 3번: 예전 방식 약 38ms/프레임 → 16.5ms(vsync).

## 8. 실행

```ts
const built = await compile(source, name);      // 워커에서 compileProject(assetUrls: true), 같은 소스면 이전 결과
await boot({ project: built.project, container, autoStart: true, kernelUrl: null, scene });
```

큰 작품의 실행 시작이 멈추지 않도록(16절):

- 컴파일은 `runtime/compile-worker.ts`(모듈 워커, 워커 안에서도 `initTreeSitterForVite`)에서 한다.
  `compile()` 은 마지막 소스와 결과(Promise)를 기억해 같은 소스면 그대로 돌려준다. 워커를 만들 수 없거나
  오류가 나면 메인 스레드 `build()` 로 돌아간다.
- `ui/source.ts` `prepareRuns()`(StagePanel 에서 시작): `project` 가 바뀌고 700ms 조용하면 소스를 쓰고
  워커에 미리 컴파일시킨다. 깃발을 누르면 소스가 같아 기다리지 않는다.
- 소스 쓰기는 블록 상태별 캐시(`codegen/project.ts` `cached`): 상태 참조 + 이름 문맥(식별자 표, 오브젝트
  키, 오브젝트·모양·소리·신호·장면·변수·테이블 이름, 함수 이름·매개변수)이 같으면 다시 쓰지 않는다.
  `currentSource()` 는 flush 직후라 열린 오브젝트도 저장된 상태로 캐시를 쓴다(`liveSaved`, 없으면 라이브
  워크스페이스에서 써서 그 상태에 넣는다). 코드 서랍(`currentSource(false)`)은 라이브 그대로.

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
- `update()` 는 블록 상태(`object.blocks`·`definition.blocks`)를 **복사하지 않고 공유**한다(`editableCopy`).
  블록 상태는 통째로 바꾸기만 하고 제자리에서 고치지 않는다는 규칙이 전제다. 함수 매개변수가 바뀔 때
  호출을 옮기는 `remapProjectCalls` 는 그 함수를 부르는 상태만 복사한 뒤 고친다. 덕분에 편집마다 작품 전체를
  복제하지 않고, 바뀌지 않은 오브젝트는 같은 상태 참조를 유지해 소스 캐시가 맞는다.
- 자동 저장·`setObjectBlocks` 비교는 상태별 JSON 캐시(`stateText`, `projectText`)로 바뀐 스크립트만 직렬화한다
  (결과 문자열은 `JSON.stringify(project)` 와 같다).
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

## 12. 이번 묶음에서 바뀐 동작

- **지역 함수** — `FunctionDef.owner` 가 오브젝트 id 이면 그 오브젝트 본문 안에 `function` 으로
  나간다(`codegen/project.ts`). 팔레트는 전역 함수 + 선택한 오브젝트의 지역 함수만 보인다.
  `.ent` 불러오기는 디컴파일 소스의 `object "키":` 안 `function` 을 찾아(`functionOwners`) owner 를
  채운다(이것들은 함수 편집기에서 고치는 옛 방식 그대로).
- **스크립트 자리에서 선언하는 지역 함수(`inline`)** — 함수 꾸러미의 "지역 함수 정의하기" 블록
  (`func_define`)을 오브젝트 스크립트 자리에 놓으면 그 자체가 선언이다.
  - 블록은 `fnId` 를 extraState(`fn`)에 들고 있다. 팔레트 블록은 `fn` 을 저장하지 않아(`isInFlyout`)
    끌어낼 때마다 새 id 를 받고, 붙여넣기·복제로 겹친 id 는 `inlineDefinitions` 가 새로 준다.
  - `flush` 가 스크립트와 함께 `FunctionDef{inline:true, blocks:null, returns}` 목록을 한 번의
    `update` 로 저장한다(되돌리기 한 번). 호출 블록 등록·팔레트는 기존 `project.functions` 경로 그대로.
    이름을 바꾸면 이미 놓인 호출 블록 라벨도 따라간다(`relabelCalls`).
  - 글쓰기: `forBlock[func_define]` 이 `function 이름(인자):…end` 전체를 쓰고, 스크립트 목록에 섞여
    오브젝트 안에 나간다. 전역/옛 지역 루프는 `inline` 을 건너뛴다. 오브젝트 복제는 새 id 로 복사.
  - 함수 편집기의 정의 블록은 `setDeletable(false)` 를 편집기가 건다(블록 기본값은 지울 수 있음).
  - 몸통 안 스택은 더블클릭해도 따로 돌리지 않는다(인자에 값이 없음).
- **남의 인자 비활성화** — `markForeignParams`: 매개변수 블록의 뿌리가 그 매개변수를 가진 정의
  블록이 아니면 `setDisabledReason(true, 'tess_foreign_param')`. 비활성 블록은 글쓰기에서 빠지고
  소켓 기본값이 쓰인다. 편집 후 한 프레임에 한 번, 불러온 직후에 한 번.
- **인자 지우기** — 머리의 매개변수를 휴지통에 버리면 지워진다. Blockly 는 `endDrag` 가 끝난 **뒤에**
  블록을 dispose 하므로 `isDisposed()` 대신 `disposition === DragDisposition.DELETE` 로 판단한다
  (예전에는 머리에 남긴 복사본이 그대로 있어 지워지지 않았다).
- **인자 ＋ 단추** — 더할 블록 모양 그대로: 둥근 알약 "＋ 값", 육각형 "＋ 판단".
- **카테고리 색** — 엔트리 계열(시작 초록, 흐름 하늘, 움직임 보라, 생김새 분홍빨강, 붓 주황, 소리 연두,
  판단 파랑, 계산 노랑, 자료 자홍, 함수 주황빨강…)을 조금씩 옮긴 값(`theme.ts`).
- **오브젝트 참조는 키로** — 이름이 겹치는 오브젝트(ladybug 의 `엔트리봇`×n)가 이름으로
  참조되어 클릭·닿기가 엉뚱한 대상을 가리켰다. `objectKeys`(장면 전체에서 유일한 키)로 참조한다.
- **오브젝트 폴더** — `TessObject.folder` 는 표시용 문자열(장면 id + 이름으로 구분). 목록 순서가 곧
  레이어 순서라 폴더는 목록 안에서 이어 붙어 있어야 한다: 끌어서 옮기면 도착한 이웃의 폴더를 따르고,
  폴더 머리에 놓으면 그 폴더 맨 위로 들어간다(`fileObject`). 접힌 폴더도 선택된 오브젝트는 보인다.
  장면에는 폴더가 없다(처음엔 장면에 붙였다가 요청에 따라 오브젝트 목록으로 옮김).
- **색 소켓** — 붓 색·채우기 색·글자 색·글상자 배경색·`from_hex` 의 색은 필드가 아니라 값 소켓이고,
  기본으로 `calc_colour` 그림자가 꽂혀 있다. 변수나 `"#rrggbb"` 문자열을 넣을 수 있다. 옛 저장본의
  `fields.COLOUR` 는 불러올 때 `upgradeBlocks` 가 소켓 그림자로 옮긴다. `.ent` 학습은 이 소켓에 색
  마커를 넣어 엔트리의 색 리터럴 블록과 맞추고, 색 리터럴이면 그림자로 되살린다.
- **블록 더블클릭 실행** — `ui/debug-run.ts`. 그 스택(모자면 몸통)만 `start_when_run` 에 담아 다른
  스크립트를 모두 비운 소스를 만들어 실행한다. 프로젝트는 건드리지 않으므로 멈추면 원래대로.
  도는 동안 그 스택이 빛난다(`runningStack` → 블록 SVG 그룹에 `tess-running`, drop-shadow 필터;
  Blockly 는 다음 블록을 그룹 안에 두므로 아래가 함께 빛남). 정지하거나 VM 스레드가 모두 끝나면
  (`activeThreads() === 0`, 150ms 간격) 꺼진다. 첫 프레임 안에 끝난 스택은 1초 뒤 꺼진다.
- **긴 스택 드래그** — `StackAwarePreviewer`: 120 블록 이상 스택에는 삽입 마커 대신 연결점 강조.
  마커는 진짜 블록이라 스택 전체를 다시 그린다.
- **시작** — `waitForAssets: false`. 모든 에셋이 올라올 때까지(최대 1.5 s) 미리보기를 덮어 둬서
  깜빡임이 없다. 첫 장면이 아닌 곳에서는 그 장면부터, Shift 를 누르면 첫 장면부터.
- **폴더 저장** — 폴더가 연결되어 있으면 "저장"이 폴더에 쓴다. 에셋은 원래 경로를 기억해(`pathOf`)
  다시 쓰지 않는다. 파일을 불러와도 폴더 연결은 유지된다.
- **파서** — 시작할 때 `@tess/parser/vite` 로 tree-sitter 를 올린다(`AI_PARSER.md` 10절).

## 13. 편집기 다듬기 (0.3.17)

- **호출 블록이 함수를 따라감** (`model/call-remap.ts`, `blocks/functions.ts`) — 호출 블록은 자기 자리들이
  어떤 매개변수용인지(`extraState.params`, id 순서)를 저장한다. 함수의 매개변수 목록(`signatureOf`)이
  바뀌면 그 `update` 안에서 모든 저장된 스크립트(오브젝트·함수 본문)의 호출을 id 기준으로 옮기고
  (`remapProjectCalls`, 없어진 매개변수 자리는 버리고 새 자리는 기본 그림자), 열려 있는 작업 공간의
  호출은 그 자리에서 다시 만든다(`refreshCallBlocks`). 서명 문자열이 그대로면 아무것도 돌지 않는다.
  예전 저장본(기록 없음)은 바뀌기 직전 목록으로 본다.
- **인수 지우기** — 머리의 매개변수를 Del/메뉴로 지워도 빈 자리를 닫는다(작업 공간 변경 후 한 프레임에
  `tidyHeader`). 머리 매개변수의 메뉴는 "인수 삭제"이고 접기·끄기는 숨긴다.
- **값 함수의 문장 호출** — tessblock 은 호출 블록을 그대로 `f(x)` 로 쓰고, 컴파일러가 엔트리용으로 바꾼다
  (`AI_SPEC-ADDENDUM.md` 5.1).
- **순서 바꾸기 드래그** (`ui/drag.ts` `SlideReorder`, `dragGhost`) — 오브젝트·리스트 항목·장면 탭 공통.
  드래그 시작 때 위치를 한 번 재고, 끼어들 자리에 틈이 벌어지도록 사이 항목을 `translate` 로 민다
  (`.obj` 는 `rise-in` 애니메이션이 `both` 로 `transform` 을 잡고 있어 `transform` 은 먹지 않는다).
  끌리는 원래 줄은 `visibility:hidden`, 그 복사본이 포인터를 따라간다(부모를 얕게 복제해 그 안에 넣어
  `.item-list li` 같은 부모 기준 스타일이 유지됨). 폴더 머리 위에서는 틈 대신 폴더 강조.
- **주석** — Blockly 버블의 `blocklyEmboss` 필터(그림자)와 `blocklyMinimalBody` 의 흰 배경을 없애고
  zelos 식 평평한 노란 카드(#fef49c, 테두리 #d8c34a 1px, 머리 띠 #f7e46c).
- **필드 드롭다운** — `.blocklyDropDownDiv` 에 둥근 모서리, 굵은 14px 흰 글자, 고른 줄 아래 어두운 알약.
- **미리보기 = 실행 화면**
  - 한 줄 글상자는 정렬에 따라 x 에 매달린다(왼쪽 정렬이면 x 에서 오른쪽으로, 엔트리/러너와 같음,
    `stage-geometry.ts` `textAnchor`). 글꼴은 러너 캔버스처럼 없으면 `sans-serif` 로 떨어지게.
  - 보이게 한 변수·리스트 상자를 미리보기에도 그린다(`ui/PreviewMonitors.tsx`). tessblock 은 상자 위치를
    쓰지 않으므로 러너의 `Overlay.homeOf`(엔트리 `generateView`) 배치를 그대로 따른다 — 종류별로
    전역 → 오브젝트 순으로 센 번호. 상자 모양도 overlay.ts 치수 그대로.
- **시작 단추의 조합키** — 그냥 누르면 부스트 꺼짐, Shift 를 누른 채면 부스트 켬(Shift 를 누르고 깃발에
  올리면 불붙은 깃발 `FireFlagIcon`), Alt 는 첫 장면부터(예전 Shift 자리). 블록 더블클릭도 Shift 를
  누른 채면 부스트로 돈다. 부스트 실행 중에는 일시정지/계속 단추가 은은하게 타오른다(`.play.pause.boost`).
  `boot({ boost })` 로 넘어가 `boost_mode?` 와 글상자 세로 정렬에 영향.
- **디버깅 표시** — 더블클릭 실행 중에는 조작 단추 옆에 "디버깅 중 · 오브젝트" 알약(깜박이는 점)과 무대
  테두리를 띄운다. 테두리는 둥근 `.stage-frame` 자체의 `border-color` + 바깥 `box-shadow`(은은히 맥박)라
  둥근 모서리를 따라가고 `overflow:hidden` 에 잘리지 않는다.
- **왼쪽 패널 숨기기** (`ui/Resizer.tsx`) — 너비를 끄는 중 포인터가 최솟값의 절반(`HIDE_BELOW` = 150px)보다
  왼쪽으로 가면 숨길 뜻이 분명하다고 보고 `html.side-hidden` 을 켠다(그 사이는 최솟값 300 에서 멈춤).
  숨기면 첫 열이 0, 손잡이만 10px 띠로 왼쪽 끝에 남고, 그 띠를 끌어내면 다시 보인다. 상태는
  localStorage `tessblock.sideHidden`. 블록 작업 공간은 `EditorTabs` 의 ResizeObserver 로 따라 커진다.
- **인수 많은 함수와 팔레트 너비** — 호출 블록은 인수가 4개를 넘으면 3개마다 `input_end_row` 로 줄을 바꾼다
  (입력 이름 `ARGn` 은 그대로라 저장본·`remapSlots` 에 영향 없음). 그래도 넓은 블록에 대비해 팔레트는
  `blocks/capped-flyout.ts` 의 `CappedFlyout`(플러그인 `flyoutsVerticalToolbox`)가 폭 계산에 쓰는 블록 경계를
  460(작업 공간 단위)으로 자른다 — 더 넓은 블록은 팔레트 끝에서 잘려 보이고 끌어낼 수는 있다.
- **미리보기 글자 세로 위치** (`model/text-metrics.ts` `textShift`) — 러너(PIXI)는 한 줄의 기준선을
  `ascent + (lineHeight − fontSize)/2` 로, 그 ascent·descent 는 자기가 캔버스 픽셀을 훑어 잰 값
  (`CanvasTextMetrics.measureFont`)으로 놓는다. 페이지는 글꼴 자체의 ascent·descent 를 쓰므로 그 차이
  `(pixi.a − pixi.d)/2 − (css.a − css.d)/2` 만큼 미리보기 글자를 내린다. 줄바꿈 글상자는 러너가 상자 위에서
  `10 − 5.9`(entryjs `TEXT_BOX_REPOSITION_OFFSET − TEXT_BOX_WEBGL_OFFSET`)만큼 내려 그리므로 그만큼 더한다.
  재 보니(헤드리스, 9가지 경우) 그림은 1화면픽셀 이내, 여러 줄·큰 글자는 0, 한 줄 20px 는 1무대픽셀 안팎.
- **무게중심 옮기기** (`stage-geometry.ts` `centerFromStage`) — 드래그 시작 때의 모양 기준으로 중심을 코스튬
  픽셀에 반올림한 뒤, 그 반올림된 중심에서 x/y 를 거꾸로 구해 그림이 한 치도 움직이지 않는다(x/y 는 소수
  둘째 자리). 예전에는 중심을 코스튬 크기 안으로 가뒀는데 x/y 는 포인터를 따라가서, 가둔 뒤로는 그림이
  끌려갔고, 중심과 x/y 를 따로 반올림해 드래그마다 그림이 떨렸다. 이제 중심은 어디로든 옮길 수 있다.
- **색 꺼내기** — 색 소켓(붓 색·채우기 색·글자 색·글상자 배경색·`from_hex`)은 팔레트·불러오기·옛 저장본
  모두 `calc_colour` 그림자 위에 같은 색의 **진짜** `calc_colour` 블록을 얹는다. 끌어내 다른 곳에 쓸 수 있고,
  빼면 그림자 색이 남는다.

## 14. Blockly 포크 (`packages/blockly`)와 긴 스택 드래그

tessblock 은 npm `blockly` 대신 `packages/blockly` 의 포크를 쓴다.

- 내용: Blockly `blockly-v13.3.0` 태그의 `packages/blockly/core` TS 소스 그대로 + 플러그인
  `field-colour`·`field-grid-dropdown` 소스(`plugins/`, import 를 상대 경로로 바꿈). 라이선스 Apache-2.0.
- 빌드: `vite.config.ts` 가 시작할 때 `tsc -p ../blockly/tsconfig.json`(증분)을 돌려 `packages/blockly/build`
  에 ESM 을 만든다(`.gitignore` 의 `build`). 소스가 `import {IBubble}` 뒤 재수출 같은 타입 전용 내보내기를 쓰므로
  파일 단위 변환(oxc)으로는 안 되고 tsc 가 필요하다. `useDefineForClassFields: false`·`target es2020` 은 Blockly
  원래 빌드와 같은 클래스 필드 의미를 위해 필수다(켜면 `override decompose?` 같은 선언이 부모 값을 지운다).
- 연결: vite `resolve.alias` 로 `blockly/core`, `@blockly/field-colour` 를 빌드 결과로 돌린다. 한 인스턴스만
  쓰기 위해서다(npm field-colour 는 UMD 로 npm `blockly/core` 를 따로 불러온다). 타입 검사는 npm `blockly` 의
  d.ts 를 그대로 쓴다(공개 API 동일). `blockly/msg/ko` 는 문자열만 있어 npm 것을 쓴다.
- 포크에서 바꾼 곳: `core/dragging/drag_proxy.ts`(새 파일), `block_svg.ts`(평평한 스택 그룹, `setDragging(adding, mark)`,
  `translate`, `moveBy`, `start/stopDragProxy`, `canUseDragProxy`, `setDeleteStyle`, `dispose`, 선택 윤곽),
  `dragging/block_drag_strategy.ts`(`proxied`), `render_management.ts`, `layer_manager.ts`, `block_animations.ts`,
  `block_flyout_inflater.ts`, `inputs/input.ts`·`rendered_connection.ts`(`setSvgDisplay`),
  `renderers/zelos/path_object.ts`, `field.ts`, `block_aria_composer.ts`, `serialization/blocks.ts`.

### 원인

- 원래 Blockly 는 드래그마다 스택 전체를 드래그 레이어 `<svg>` 로 옮기고 모든 블록에 `blocklyDragging` 을 붙인다.
  블록 `<g>` 가 부모 안에 중첩되어, 1485 블록에서 집기·놓기가 각각 약 1초(스타일·레이아웃 재계산)다.
- 끄는 동안에는 드래그 레이어가 합성되지 않아 **매 프레임 스택 전체를 다시 래스터**한다. 블록마다
  drop-shadow 필터가 있어 GPU 래스터(헤드리스 `--enable-gpu-rasterization --use-angle=swiftshader`)에서
  프레임당 약 150ms(초당 6~7 프레임)였다. 체감 렉의 주원인이다.

### 대역(stand-in) 드래그 (`DragProxy`)

포인터로 끄는 40 블록(그림자 포함) 이상 스택에만 쓴다. 키보드 이동·짧은 스택·플라이아웃은 원래 경로다.

- 원본 스택은 블록 캔버스에 그대로 두고 `clip-path: polygon(0 0,0 0,0 0)` 로 가린다(적용 0.2ms, 포커스·선택
  유지, 히트 테스트에서도 빠짐). 원본에는 `blocklyDragging` 을 붙이지 않고(`setDragging(true, false)`), 드래그
  중에는 `translate()` 가 DOM 을 건드리지 않는다. 놓을 때 한 번 transform 을 쓰고 클립을 푼다.
- 인젝션 div 에 합성 오버레이(`div.blocklyDragProxy`, z-index 80, 드래그 레이어 바로 앞 → 말풍선이 위)를 두고,
  블록 그룹의 **얕은 복사본을 평평하게** 그리는 순서대로 넣는다. 한 블록 그룹의 자식 중 자식 블록 사이 구간을
  세그먼트로 나눠(원래 칠하는 순서 유지) 각 세그먼트를 같은 클래스의 `<g>` 복사본으로 만든다. 복사본에는
  `blocklyDragging` 을 붙여 원래 드래그 모양(반투명·그림자·grabbing 커서·삭제 커서)이 그대로 나온다.
  `id`·`tabindex` 는 지운다.
- 보이는 영역(+반 화면 여백)에 걸친 블록만 복사하고, 스택이 움직여 새 영역이 들어오면 그때 더 복사한다
  (순서 번호로 이진 탐색해 제자리에 끼움).
- 오버레이 이동은 **Web Animation** 의 키프레임을 바꿔서 한다(`animate(...).effect.setKeyframes`). 스타일
  `transform` 을 바꾸면 합성 레이어라도 Chrome 이 매 프레임 문서 전체를 Layerize(1485 블록 약 20ms)하지만,
  애니메이션 키프레임 갱신은 Layerize 0 이다.
- 원본이 드래그 중 바뀌면(`markForeignParams` 가 비활성화 등) `MutationObserver` 가 대역을 다시 만든다.
- 놓을 때 z 순서: 시작할 때 뒤 형제를 스택 앞으로 옮겨 두므로(`moveSvgRootToFront` 와 같은 방식) 놓을 때
  `moveOffDragLayer` 가 스택을 다시 붙이지 않는다.

### 쓸 수 없던 것 (측정)

- 원본 숨기기: `opacity:0` 은 합성 레이어가 있을 때 Layerize 가 프레임당 1.4초로 폭증, `visibility:hidden` 은
  포커스·선택을 잃고 226ms. 드래그 레이어/그 `<svg>`/감싼 `<div>` 를 합성하면 중첩 스택 때문에 Layerize 폭증.
- 합성하지 않은 대역: 매 프레임 래스터가 그대로라 GPU 기준 137ms.

### 측정 (헤드리스 Chromium, 1485 블록, GPU 래스터 에뮬레이션)

| | 원래 | 대역 |
| --- | --- | --- |
| 끄는 중 프레임당 작업(모든 스레드) | 약 200ms (GPU 157) | 약 5ms (메인 2, GPU 0) |
| 집기 메인 스레드 | 약 1170ms | 약 230ms (그중 누를 때 선택 표시 약 110) |
| 놓기 메인 스레드 | 약 1170ms | 약 110ms |

### 화면 차이

합성하지 않으면 드래그 중 화면이 원래와 0 픽셀 차이다(대역 구조 검증). 합성하면 Chrome 이 투명 합성 레이어의
글자에 LCD(서브픽셀) 안티앨리어싱을 쓰지 않아, LCD 글꼴 렌더링을 쓰는 환경(윈도 100% 배율 등)에서 **끄는 동안만**
블록 글자가 회색조 안티앨리어싱으로 그려진다. 모양·색·그림자·z 순서(팔레트·휴지통·스크롤바 위)는 같다.

### 평평한 스택 그룹 (연결·분리·복사)

원래 Blockly 는 블록 `<g>` 를 부모 블록 `<g>` 안에 중첩한다(DOM 깊이 = 스택 길이). 블록을 끼우거나 빼면 아래쪽
전체가 DOM 에서 옮겨지고, 옮긴 요소는 스타일·레이아웃(특히 SVG `<text>`)을 처음부터 다시 계산한다.

- 측정: 같은 수의 요소를 옮길 때 중첩 740단은 63ms, 평평한 형제 740개는 2.4ms(중첩 깊이에 제곱으로 증가).
  평평해도 옮긴 블록 442개(텍스트 2294개)의 재레이아웃은 약 230ms, transform 만 바꾸면 2ms.
  → 연결·분리에서 **옮기는 요소 수를 최소화**하고 위치는 transform 으로만 바꾼다.
- 구조: 최상위 블록마다 스택 그룹(`stackGroup`, 캔버스의 `<g>`, transform = 최상위 블록 위치)을 둔다. 이전 연결
  (다음 블록·문장 입력)로 붙은 블록의 `<g>` 는 모두 이 그룹의 **직계 자식**(flat)으로, 그리는 순서(입력 순, 다음
  블록 마지막의 전위 순회)대로 놓는다. transform = 최상위 블록 기준 오프셋(`stackX/Y` = 부모 오프셋 +
  `relativeCoords`). 값 입력(출력 연결) 블록은 원래처럼 부모 `<g>` 안에 중첩(얕고, CSS 후손 선택자 유지).
- `getSvgRoot()` 는 블록 자신의 `<g>`. 스택 전체가 필요한 곳(레이어 이동, 삭제 애니메이션 복제, 흔들림 skew,
  `moveSvgRootToFront`, 대역 드래그, 플라이아웃 포인터 바인딩, tess 실행 발광 `.tess-running`)은
  `getStackSvgRoot()`(최상위면 스택 그룹) 를 쓴다.
- 분리(`setParent(null)`): 떨어지는 쪽이 절반보다 크면 남는 쪽을 새 그룹(원래 그룹 바로 앞)으로 옮기고 원래
  그룹을 떨어진 스택이 가진다. 아니면 떨어지는 쪽을 새 그룹(캔버스 끝)으로 옮긴다.
- 연결: 붙는 쪽이 대상 스택보다 크고 같은 레이어면 대상 스택의 그룹들을 붙는 쪽 그룹으로 옮기고(그리는 순서는
  붙는 쪽 그룹 위치), 아니면 붙는 쪽을 대상 그룹의 제자리(`precedingFlatGroup` 다음)에 넣는다.
  → 1485 블록 스크립트 중간에 끼우기·빼기·다시 넣기에서 옮기는 요소는 앞쪽 몇 블록뿐이다.
- 옮기기는 가능하면 `moveBefore`(포커스 유지, blur/focus 이벤트 없음). 지원하지 않으면 `insertBefore` 후 포커스
  복원(원래 동작과 같음). 포커스가 풀렸다 잡히면 선택 윤곽이 다시 만들어져 그리는 순서가 달라지므로 필요하다.
- 위치 갱신: `translate` 는 최상위면 스택 그룹 transform, 아니면 하위 트리 오프셋 재배치(`placeSubtree`).
  렌더 패스 안에서는 `render_management.deferPlacement` 로 모아 패스 끝에 스택마다 한 번만 배치(후위 순회
  렌더가 블록마다 하위 전체를 다시 배치하는 O(n²) 방지).
- 선택 윤곽(zelos `blocklyPathSelected`): 원래는 블록 `<g>` 끝에 붙어 그 아래 블록들 위에 그려진다. flat 블록은
  윤곽을 같은 클래스(`MutationObserver` 로 동기화)·같은 오프셋의 `<g>` 에 넣어 선택 시점의 하위 트리 끝 다음에 둔다.
  나중에 붙는 블록은 윤곽 뒤에 넣는다(`skipOutlines`, 원래도 나중에 붙은 자식이 위). 윤곽 그룹의 pointerdown 은
  블록으로 보낸다.
- 숨김(`display`): 입력 숨김·접기가 자식 `<g>` 에 주던 `display` 를 `setSvgDisplay` 로 받아, 숨은 조상을 가진 flat
  그룹에 `none` 을 준다(원래는 중첩으로 상속).
- 대역 드래그의 흔들림: 스택을 빼낼 때의 skew 를 대역 오버레이 애니메이션에 스택 시작점 기준으로 적용(원래와 같은 모양).
- 기타: `moveBy(0,0)`(좌표 없는 블록을 불러올 때마다 호출)은 연결 DB 정렬·콘텐츠 크기 재계산을 건너뜀(복사 시
  블록마다 전체 DB 정렬 → O(n²)). `Field.recomputeAriaContext` 는 초기화 전 예외를 던지지 않고 검사,
  `getBeginStackLabel` 은 부모 유무로 판정(O(1)), 불러오기·렌더 패스에서 글자 폭 캐시, 다음 연결로만 이어진
  조상은 다시 그리지 않고 자식 위치만 조임(`pathBlocks`).

### 측정 2 (헤드리스 Chromium, 1485 블록 스크립트, 트레이스 합계 ms)

| | 원래 포크(중첩) | 평평한 스택 그룹 |
| --- | --- | --- |
| 블록 하나를 중간에 끼우고 놓기 JS / 스타일 / 레이아웃 | 743 / 450 / 632 | 58 / 6 / 7 |
| 중간에서 빼내기 시작 | 711 / 281 / 283 | 80 / 6 / 12 |
| 빼낸 스택을 다시 끼우고 놓기 | 721 / 294 / 318 | 53 / 7 / 4 |
| 복제(붙여넣기 동기 호출) | 2142 (원래 Blockly) | 549 (대부분 새 요소 첫 레이아웃) |

### 화면 비교 (원래 Blockly 13.3.0 과 픽셀 비교)

정지 화면, 선택 윤곽, 필드 호버, 실행 발광, 끼우기 후, 겹친 스택 놓기, 다시 넣기, 비활성화, 놓은 뒤, 되돌리기:
블록 영역 0 픽셀 차이(실행 발광 필터 1픽셀 ±1). 끄는 중만 위의 합성 레이어 글자 안티앨리어싱 차이.

## 15. 모두 접기·펼치기, 드롭다운 크기, 함수 목록

- **모두 접기/펼치기**: Blockly 는 블록마다 `setTimeout` 을 10ms 간격으로 걸어 하나씩 접는다(1485 블록 스크립트:
  약 4.5초 동안 87 프레임, 원래 Blockly 는 11초). 포크 `contextmenu_items.ts` `toggleOption_` 은 한 번에
  바꾸고 한 번 그린다(같은 이벤트 그룹). 같이 고친 O(n²): `childHasWarning`(블록마다 `getDescendants` 두 번),
  `updateDisabled`(상태가 같아도 체인 끝까지, 블록마다 조상 경로 재계산 → 물려받은 비활성 값을 넘기는
  `updateDisabledWith`).
- 숨김은 `display:none` 대신 `visibility:hidden`(필드 `Field.setVisible`·초기화, 숨은 입력의 자식
  `applyDisplay`). 레이아웃이 남아 펼칠 때 글자를 다시 배치하지 않는다(펼치기 레이아웃 240ms → 4ms).
  보이지 않는 요소는 히트 테스트·포커스에서 빠지므로 동작은 같다.
- 글자 폭 캐시 구간에서 같은 SVG·같은 클래스의 글꼴 스타일은 한 번만 `getComputedStyle`(DOM 변경 뒤마다
  스타일 재계산을 강제하던 것).
- 측정(1485 블록): 모두 접기 4.5초/87프레임 → 약 0.3초/1프레임, 모두 펼치기 4.5초 → 약 0.16초. 결과 화면은
  원래 Blockly 와 픽셀 동일.
- **드롭다운 크기**: 포크 `dropdowndiv.ts` 가 드롭다운을 띄울 때 블록이 그려진 배율을
  `--blocklyBlockScale` 로 넘기고, `style.css` 가 시작 배율 0.75 대비 비율(`--tess-dd`)로 글자·여백·높이·모서리·
  체크 표시(`zoom`)를 곱한다. 기준 크기는 블록 글자에 맞춘 11.5px·항목 26px 이고, 체크 표시는
  왼쪽 여백 28px 의 가운데(`margin-left: -22px`)에 둔다.
- **속성 탭 함수 목록**: `.rec-list` 는 그리드인데 열 너비가 가장 긴 행(줄바꿈 없는 매개변수 목록)의
  min-content 로 늘어 모든 행의 편집·삭제 버튼이 패널 밖으로 밀렸다. `grid-template-columns: minmax(0, 1fr)`.

## 16. 큰 작품의 실행 시작

- 원래(합성 20만 블록, 오브젝트 120개): 깃발 → 소스 쓰기 4.4초(오브젝트마다 헤드리스 워크스페이스에 불러와
  생성) + 컴파일 3.1초 + tessvm 부팅 0.4초 ≈ 8초 동안 멈춤.
- 지금: 소스 26ms(캐시), 컴파일 0(워커가 미리), 부팅 약 0.4초 → 깃발에서 실행까지 약 0.5초, 가장 긴 프레임
  간격 약 0.4초(부팅: tessvm 이 스크립트를 JS 로 만들고 V8 이 처음 컴파일하는 비용).
- 편집 직후 바로 누르면 워커 컴파일을 기다리지만 화면은 멈추지 않는다.
- 검증: 캐시한 소스 = 캐시 없이 새로 쓴 소스(이름 바꾼 뒤 포함), 워커 결과 = 메인 스레드 결과,
  저장 문자열 = `JSON.stringify`, 되돌리기 동작, 프로덕션 빌드에서 워커·wasm 로드.

## 17. 긴 스크립트(수천 블록 한 줄)와 저장된 작품 복원

- **불러오기 실패(데이터 손실)**: `store.ts` 는 모듈을 읽을 때 `project = signal(loadProject())` 를 실행하는데,
  `loadProject` → `upgradeBlocks` 가 쓰는 `COLOUR_SOCKETS` 가 파일 아래쪽에 선언되어 TDZ 오류가 났다. 예외를
  삼키고 새 작품으로 시작하므로, 블록이 있는 작품은 새로고침마다 비어 보였고 다음 자동 저장이 원래 작품을
  덮어썼다. 상수를 `project` 위로 옮겼다. 추가로 `showObject` 가 블록을 다 불러오지 못하면 그 오브젝트는
  `flush` 하지 않는다(`unreadable`, 저장된 블록을 부분만 불러온 상태로 덮어쓰지 않음).
- **깊은 중첩**: Blockly JSON 은 다음 블록을 앞 블록의 `next.block` 안에 넣는다(블록 2000개 ≈ 깊이 4000).
  내장 `JSON.stringify`·`structuredClone`·`postMessage` 는 수준마다 재귀해 2048 블록 한 줄에서
  "Maximum call stack size exceeded" (`JSON.parse` 는 괜찮다). 저장(`flush`)에서 예외가 나 시작하기가 아무 반응
  없던 원인이기도 하다.
  - tessblock `model/json.ts`: `stringify(value, indent)`(`JSON.stringify` 와 같은 문자열, 반복문),
    `copyDeep`(parse(stringify)). 상태 JSON(`stateText`), 함수 비교, 오브젝트·함수 복제, 호출 재배치 복사,
    `.tessproj`·폴더 저장, 함수 편집기 복사, `returnsValue` 에 쓴다. `update()` 의 `structuredClone` 은 블록
    상태를 빼고 복제한다(9절).
  - 포크 `utils/deep_json.ts` `stringifyDeep`: 휴지통(`Trashcan.onDelete`/`cleanBlockJson`).
- **재귀를 반복문으로(포크)**: 직렬화 `save`(다음 블록 체인)·`appendPrivate`(체인을 반복으로 만들고 초기화는
  예전처럼 아래 블록부터), `getDescendants`, `disposeInternal`(뒤 블록들을 먼저 dying 표시한 뒤 끝에서부터),
  `allInputsFilled`, `setConnectionTracking`, `getHeightWidth`, `setDragging`, `updateComponentLocations`,
  `bumpNeighbours`(재귀와 같은 순서의 프레임 스택, 같은 스택 판정은 집합), `startTrackingAll`,
  `BlockDragStrategy.getAllConnections`, `render_management` 의 `renderBlock`·`dequeueBlock`, 평탄화의
  `lastFlatGroup`. tessblock: 생성기 `scrub_`(다음 블록을 `blockToCode(next, true)` 로 반복), JSON 을 걷는
  `remapSavedCalls`·`upgradeBlocks`.
- **O(n²) 제거**: 불러오기에서 블록마다 하위 전체의 연결 추적을 끄던 것(`setConnectionTracking(false, false)`,
  아래 블록은 이미 처리됨), `queueBlock` 이 이미 표시한 조상에서 멈춤, `getInheritedDisabled` 는 작업 공간에
  비활성 블록이 없으면 바로 false(`Workspace.disabledBlocks` 개수), `setParent` 의 루트 찾기는 스택 그룹의
  소유자로(`stackRoot`), 펼칠 때 비활성 갱신은 그 블록과 입력만.
- 측정(한 줄 스크립트): 2048·5000·20000 블록 모두 불러오기·실행·드래그·모두 접기/펼치기·가운데 빼고 다시
  붙이기·저장·새로고침·삭제 후 되돌리기가 된다(원래 Blockly 는 약 2500 에서 불러오기부터 넘침). 20000 블록
  불러오기 35초 → 6.4초.

## 18. 팔레트 첫 끌기, 옆 패널 너비, 실행 준비

- **팔레트에서 첫 끌기가 안 되던 것**: 블록을 누르면 `bringToFront` 가 스택을 맨 앞으로 옮긴다. 평탄화 뒤 "작은
  쪽 옮기기" 로 스택 그룹 자체를 `appendChild` 하면 포커스가 풀려 선택이 사라지고, Blockly 는 드래그 시작 때
  `common.getSelected()` 를 끌기 때문에 작업 공간 이동이 되었다(두 번째는 이미 맨 앞이라 정상). 스택 그룹은
  `moveBefore`(포커스 유지)로 옮기고, 없으면 원래처럼 뒤 형제들을 앞으로 옮긴다.
- **옆 패널 너비 조절 렉**: (1) SVG 루트 크기가 바뀌면 Chrome 이 안의 모든 요소를 다시 레이아웃한다(블록 1485개
  약 215ms, 배경의 % 길이·필터와 무관, 중첩 SVG 로도 못 막음). 포크 `svgResize` 는 SVG 요소를 화면 크기 이상으로
  한 번 키우고 줄이지 않으며, 작업 공간 크기는 캐시 크기(컨테이너)로 둔다. 컨테이너 크기만큼 `clip-path`
  (다시 칠하기만)로 자르고, 배경 사각형은 컨테이너 크기로 맞춰 가장자리 선이 예전 자리에 그려진다(픽셀 동일).
  (2) `--side-w` 를 문서 루트에 쓰면 사용자 정의 속성 상속 때문에 블록 요소 전부의 스타일이 다시 계산된다.
  `@property --side-w { inherits: false }` 로 등록하고 `.workarea` 에만 쓴다. 측정: 구분선 60번 이동의 JS·레이아웃
  각 14.9초 → 0.4초, 스타일 3.9초 → 0, 가장 긴 프레임 간격 약 500ms → 45ms(원래 Blockly 650ms).
- **실행 준비(16절 보강)**: 워커 작업은 하나씩 보내고, 기다리는 준비(prepare)는 가장 새 것 하나만 남긴다.
  실행(urgent)은 버리지 않고, 준비 컴파일이 돌고 있으면 워커를 끝내고 새로 만든다(오래된 준비 뒤에서 기다리지
  않음). 준비는 먼저 `flush` 해서(`currentSource()`) 저장 안 된 편집이 예전 상태 이름으로 캐시되지 않게 한다.
  소스 쓰기에서 예외가 나면 알림을 띄운다(예전엔 아무 반응 없음).


## 20. 모양·소리 메뉴 블록, 기본값 끌어내기, 오브젝트 정보

- **메뉴 블록**: 엔트리처럼 모양·소리 드롭다운이 소켓 안의 블록이다. `menuIn(name, type)` →
  `ShadowSpec { kind: 'menu', type }`, 기본 그림자가 `looks_costume_menu`/`sound_menu`(숨은 값 명세, `pick` 한 칸,
  이름을 따옴표로 쓴다). 쓰는 블록: `looks_set_costume_by`, `sound_play_by`, `sound_play_wait_by`,
  `sound_play_for_by`, `sound_play_for_wait_by`, `sound_play_range_by`, `sound_play_range_wait_by`,
  `sound_play_bgm_by`. 소켓 순위는 `Order.NOT` 이라 `and`/`or` 식은 괄호가 붙는다(`play sound … and wait` 와 안 섞임).
- 예전 필드형(`looks_set_costume`, `sound_play*`)과 `*_value` 는 저장된 작품을 열기 위해 숨겨 남겨 두고
  `unlearned: true` 로 `.ent` 패턴 학습에서 뺀다. 불러오기는 `get_pictures`/`get_sounds` 를 메뉴 블록으로
  바꾸고(`convertValue`), `valueInput` 이 같은 타입이면 그림자로 둔다.
- **기본값 끌어내기**: 포크 `gesture.ts` 의 `Gesture.detachableShadow(block)` 가 받아 주는 그림자는 부모 대신
  그 자신이 끌린다. 드래그가 시작될 때(`updateIsDragging`) `setShadow(false)` 로 진짜 블록이 되고, 소켓에는
  `setShadowState` 로 새 그림자를 남긴다. `true` 면 같은 값, 상태 객체면 그 그림자. tessblock 은
  `calc_number`·`calc_text`·`calc_colour` 는 같은 값, 메뉴 블록은 `calc_text "10"` 을 남긴다(`registry.ts`).
  플라이아웃·읽기 전용·잠긴 부모는 예전처럼 부모가 끌린다. 되돌리기는 블록이 진짜 블록인 채로 소켓에 돌아간다.
- **변수·리스트 만들기**: 새로 만든 것은 무대에 보인다(`addVariable` 의 `visible: true`). 이름을 비우고
  만들면 `변수N`/`리스트N`(비어 있는 가장 작은 N)이고, 입력칸 자리표시에 그 이름을 보여 준다.
- **오브젝트 정보**: 숫자 칸은 64px, 칸 사이 14px/8px. X·Y 는 라벨이 입력칸 안에 있다(`.f.inset`).
  이동 방향은 오른쪽의 계기판(`DirectionDial`, 0 이 위·90 이 오른쪽, 끝이 화살표인 바늘을 끌거나 아래 칸에 입력),
  회전 방식은 이름 칸 오른쪽의 `rot-toggle`(아이콘+글자, 누를 때마다 자유→좌우→없음).
- **모자 블록 아이콘**: `BlockSpec.icon`(16px 상자 SVG, 흰색) 이 있으면 `blockDefinition` 이 첫 줄 앞에
  `field_image` 를 붙인다(높이 24px, 왼쪽 6px 여백은 viewBox 를 왼쪽으로 늘려 만든다, `iconUrl`).
  지금은 `start_when_run` 의 깃발 하나만 쓴다.

## 21. 값 말풍선, 변수 창 자리, 폰트, 확장 api, 그림판

- **값 말풍선** (`ui/report-bubble.ts`): 부모 없는 값·판단 블록을 누르면(작업판·팔레트, `Events.CLICK`)
  아래에 값을 보인다. 블록을 `말하기` 두 개(값, 표식 `__tess_probe__`) 스크립트로 적어 그 오브젝트만
  살린 사본을 컴파일하고, 표식 앞 `dialog` 의 값을 꺼낸다.
  - 실행 중이면 사본 레코드 id 를 실행 중 작품 id 로 바꿔(`idMap`: 오브젝트는 순서, 모양·소리·변수·
    신호·장면·테이블은 이름, 함수는 라벨) `vm.evaluate`. 아니면 사본을 실행하지 않은 채 불러 둔 VM
    (소스별로 하나 캐시)에서 계산 — 처음 상태.
  - `calc_random_colour` 는 Tess 에서 값이 아니므로(`draw_color = random_color()` 뿐) 실행기처럼 채널마다
    무작위로 뽑은 색을 보인다. 색 값이면 견본을 붙인다. 계산이 안 되면 컴파일 오류 문구.
  - 말풍선 색은 블록 색(`--report`)을 `color-mix` 로 옅게. 다른 곳을 누르거나 작업판이 움직이면 닫힌다.
  - 주의: `Events.fire` 는 애니메이션 프레임에 전달되므로 백그라운드 탭에서는 클릭 이벤트가 오지 않는다.
- **변수·리스트 창 자리**: `VariableDef.at`(무대 가운데 기준 좌상단, y 아래로 — 엔트리 값 그대로). 미리보기
  (`PreviewMonitors`)에서 끌어 놓으면 반올림해 저장(0 은 엔트리가 "자리 없음"으로 읽어 1 로). 글쓰기는
  `visible` 뒤 `at X Y`. `.ent` 불러오기는 x·y 가 둘 다 0 이 아니면 `at`.
- **폰트** (`model/fonts.ts`): 엔트리가 주는 폰트 CSS 전체(`@tess/player` 의 `ENTRY_FONT_STYLES`, tessvm 페이지와
  같은 목록)를 시작할 때 페이지에 건다(`loadFonts`). 메뉴(`FONTS`)는 라벨 → CSS family. 글상자 속성·글꼴 블록·
  그림판 글꼴이 같은 목록을 쓴다. 예전 값(`나눔고딕` 등 한글 이름)은 `fontFamily()` 가 family 로 바꿔 쓴다
  (글상자 기본값도 `Nanum Gothic`). 글꼴 블록 드롭다운의 예전 한글 값은 Blockly 가 첫 항목으로 되돌린다.
- **확장 api**: 번역·읽어주기는 엔트리처럼 같은 출처 `/api/expansionBlock/...` 를 부른다. `vite.config.ts` 의
  dev/preview 프록시가 playentry.org 로 넘기고 referer 를 엔트리로 둔다(`tessvm run` 서버와 같은 방식).
  정적 호스팅에서는 이 경로를 받아 줄 서버가 따로 있어야 한다.
- **그림판**: 시트 FHD(1920×1080). 가운데 480×270(모양 100% 가 무대에 보이는 범위)을 `stage-guide`(점선,
  "실행 화면" 라벨)와 `stage-veil`(바깥을 옅게, `clip-path` evenodd 구멍)로 표시 — 오브젝트 위치와 무관한 안내.
  `%` 로 놓아 확대를 따라가고, 모드 전환(`modechange`)마다 다시 붙인다. 모양을 열면 `fitStage` 가 안내 틀이 보기
  영역의 80% 가 되게 확대·가운데 정렬(맞추기 버튼도 같음). 기본 글꼴 `Nanum Gothic`. 슬라이더는 `.paint-range`
  (채워진 트랙은 `--fill`). 색 칸(`.swatch`)은 안쪽 색도 둥글게.
- **painter 패키지**: 글자 도구는 입력이 끝나면(다른 곳 클릭·Esc) 다음 틱에 도구가 아직 `text` 일 때만 `select`
  로 바꾼다(`handOver`). 편집 중 다른 도구를 고르면 그 도구가 남는다. tessblock 은 `packages/painter/dist` 를
  쓰므로 painter 를 고치면 `npm run build` 가 필요하다.
- 오브젝트 정보: X·Y 칸 72px, 값 오른쪽 정렬, 칸은 열 오른쪽에 붙여 아래 가로·세로 칸과 끝을 맞춤, X·Y 글자는 흐리게. 글상자 내용은 모양 탭에서만 고친다(이름 아래 입력칸 없음).

## 22. 간결한 패널

- 글상자(`TextBoxPane`): 제목·설명 없이 미리 보기 → 내용(2줄) → (미리 보기 → 설정 한 줄 → 내용 순) 설정 한 줄(`text-bar`: 글꼴·크기·정렬 아이콘·
  꾸미기·줄바꿈 토글·색 칩). 색은 동그란 `ColourChip`(배경색은 빗금 = 없음, 마우스를 올리면 × 로 없애기). 폭 560px.
- `sheet-head` 공통: 제목과 설명을 한 줄에(설명은 말줄임), 추가 버튼은 작게, 머리 폭 560px. 소리 목록·빈 영역도 560px.

## 23. 번역 언어 코드, 값 다시 끼우기, 빈 상태, 이름 바꾸기, 그림판 설정·레이어·효과

- **번역**: 블록 언어 값은 파파고 코드(`ko`·`en`·`ja`·`zh-CN`… 14개, 엔트리와 같음). 예전 한글 값은 tessvm
  `ops.translate` 의 `languageCode` 가 코드로 바꾼다. 값 말풍선용 조용한 VM 에도 `EntryTranslator` 를 준다.
- **다시 끼운 값**: `absorbLiterals`(blockly-host) — `calc_number`·`calc_text`·메뉴 블록이 소켓에 들어가면
  (`BLOCK_MOVE` 에 새 부모·입력) `setShadow(true)` 로 그 소켓의 그림자가 되어 원래 모양. 소켓 밖으로
  나오면(되돌리기 등) 다시 진짜 블록.
- **빈 상태**: `.muted` 색 정의, `.rec-empty` 는 점선 카드(최대 560px). 리스트·테이블이 하나도 없으면 목록/상세로
  나누지 않고 카드 하나만(추가 버튼은 머리에만).
- **이름 바꾸기**: `InlineName` 이 `.rec-row`·`.rec` 안에 있으면 행의 빈 곳을 두 번 눌러도 편집(버튼·입력칸 제외).
- **그림판 오른쪽**(`SideSettings`): 도구별로 쓰는 것만 — 붓(색·크기), 지우개(크기), 채우기(색), 글자(색·글꼴·
  크기), 선(선 색·굵기), 사각형·원(채우기·선·굵기). 선택 도구는 고른 도형이 있을 때만 채우기·선·굵기·효과,
  글자를 골랐으면 글꼴. 아무것도 없으면 안내 한 줄.
- **효과**(벡터, 고른 도형): 채우기 단색/선형/원형 그라데이션(두 색, 선형은 방향), 선 모양 실선/점선/점, 투명도.
- **레이어**(벡터): 오른쪽 아래 목록(위가 앞). 고르기·보이기·이름(두 번 눌러)·위/아래·추가·지우기.

### painter 패키지 (packages/painter)

- 레이어: `layersRoot` 안에 레이어마다 `<g class="pt-scene" data-layer>`; `scene` 이 활성 레이어를 가리켜 도구·선택·
  히트 테스트는 그 레이어만 본다. 스냅샷은 전체 레이어 + 활성 번호. `toSVG` 는 레이어가 하나면 예전처럼 도형만,
  둘 이상이거나 숨김이면 `<g data-layer>`(숨김은 `display="none"`). `loadSVG` 는 최상위가 모두 레이어 그룹이면 레이어로
  읽고, 그룹의 `transform`(tessblock `centred` 가 붙이는 이동)을 도형에 옮긴다. 이벤트 `layerchange`.
- 효과: `setFillGradient`(도형마다 `ptg-<pid>` 그라데이션을 도형 바로 뒤 `<defs>` 에 — 저장 시 같이 간다),
  `selectionGradient`, `setOpacity`/`selectionOpacity`, `setDash`/`selectionDash`(굵기에 맞춘 `stroke-dasharray`,
  `data-dash`). `setFill` 은 그라데이션을 지운다.
- 글상자 오브젝트를 고르면 `모양` 탭 이름이 `글상자` 로 바뀌고 개수 표시가 없다(`EditorTabs`).

## 24. 미리보기 = 실행 화면, 코드 창, 키 고르기, 디버그 이어 하기 등

- **코드 창**: 선택한 오브젝트의 `object "키":` ~ `end` 만 보인다(`objectRange`, 들여쓰기 한 칸 뗌). 문제는 그 범위 것을
  오브젝트 줄 번호로, 범위 밖 오류는 `전체 N` 으로 함께 보인다. `.tess 저장` 은 작품 전체.
- **미리보기 크기**: `--stage-scale` 은 실행기 `layout` 과 같게 — 폭·높이 비 중 작은 쪽, 폭은 정수 내림. 무대 상자
  `.preview-stage` 가 그 크기로 가운데에 있고, 그림과 변형 상자·포인터 좌표(`toStage`)가 모두 그 상자를 기준으로 한다.
- **변수·리스트 창**: 미리보기에서도 실행기의 `Overlay`(tessvm) 로 그린다(`MonitorCanvas`, 투명 PIXI 캔버스). 변수마다
  `Variable` 을 한 번 만들어 계속 쓴다(새로 만들면 예전 상자가 남아 끌 때 잔상). 목록·이름이 바뀌면 `Overlay` 를 새로.
  DOM 상자는 투명하게(`.hit`) 끌기·크기 조절만 받는다. 캔버스는 `destroy({ removeView: true }, { children: true })` 로만
  정리한다 — `destroy(true)` 는 실행기와 함께 쓰는 PIXI 캐시까지 지워 실행 화면의 글자가 사라졌다.
- **리스트 크기**: `VariableDef.size`, 글쓰기 `size W H`(문법 추가, 최소 100), 오른쪽 아래 `.pm-resize` 를 끌어 바꾼다.
- **글상자**: `RunnerText` — PIXI `CanvasTextGenerator` 가 만드는 그 캔버스를 그대로 그리고, 실행기(부스트 아님)와 같은
  앵커(한 줄: 첫 줄 가운데가 점, 줄바꿈: 윗변 + 4.1)로 놓는다. 밑줄·취소선도 실행기와 같다.
- **시작·정지**: 미리보기는 늘 붙여 두고 실행 화면이 보일 때만 숨긴다(`.preview-holder.hidden`) — 정지하면 바로 보인다.
- **키 드롭다운**(`TessDropdown`, source `key`): 열려 있는 동안 누른 키의 `keyCode` 와 같은 코드의 이름을 고르고 닫는다
  (capture 단계, Esc·화살표 포함).
- **팔레트**: 고른 카테고리는 채운 아이콘(`CATEGORY_ICONS_FILLED`, 마스크는 알파만 보므로 구멍은 evenodd).
- **디버그 이어 하기**: 더블클릭 세션이 도는 중(`debugLive`)이면 `joinSession` — 스택을 사본으로 컴파일하고 id 를
  실행 중 작품에 맞춰(`idMap`/`remap`) `vm.runStack` 으로 새 스레드를 넣는다. 안 되면 예전처럼 새로 시작.
- **값 다시 끼우기**: 그림자로 되돌린 뒤 블록과 부모를 `queueRender`(메뉴 블록은 그림자일 때 모양이 달라 뚱뚱했다).
- **모양 이름**: 한 오브젝트 안에서 겹치지 않는다(`uniqueCostumeName`, `_2`…; `.ent` 불러오기도).
- **레이어**: 선택·모양 다듬기 도구는 보이는 모든 레이어를 위에서부터 찾고, 다른 레이어 것을 누르면 그 레이어로
  바뀐다(painter `hitTest` 의 `anyLayer`, 커서 판정은 `keepLayer`).
- **선 모양**: painter `lineDash`(선 도구가 새 선에 `dashShape` 로 적용) + `setDash`(고른 도형과 새 선 모두). 오른쪽 패널의
  "선 모양"은 선 도구, 또는 고른 것에 선(채우기 없는 외곽선, `selectionHasLine`)이 있을 때만 보인다.
- **오브젝트 고르기**(미리보기): `.po` 는 포인터를 받지 않고, 무대 상자(`.preview-stage`)가 누른 점을 `objectAt` 으로
  판정한다 — 위 오브젝트부터 누른 점을 모양 좌표로 되돌려(`stageToLocal`) 그 픽셀이 칠해져 있을 때만(`pixel-hit.ts`
  `paintedAt`, 알파 8 이상) 고른다. 투명한 곳은 아래 오브젝트로 넘어간다. 글상자는 상자 전체. 알파는 화면의 `<img>` 에서
  바로 읽거나 `onLoad` 때 미리 읽어 두고, 다른 출처라 못 읽으면 상자 전체로 본다. 커서도 같은 판정.
- **디버그 이어 하기 + 도우미 함수**: 합치는 스택이 부르는 함수 중 실행 중 작품에 없는 것(컴파일러 도우미 `[Tess] …`,
  `scale_x = …` 등)은 id 를 맞춘 사본으로 함께 넘기고(`vm.runStack(…, extraFunctions)`), tessvm 은 그것들을 더한
  `CompileInput` 으로 스택을 컴파일한다. 예전에는 그 호출이 빈 함수가 되어 가로·세로 정하기가 먹지 않았다.
- **한 번 눌러 다시 실행**: 더블클릭으로 실행한 스택은 `armed` — 그 스택을 눌렀다가 4px 안에서 떼면(`pointerup` capture,
  Blockly 클릭 이벤트를 기다리지 않음) 바로 다시 실행한다 — 연타도 누른 만큼 실행한다(걸려 있는 스택에서 난 더블클릭은
  클릭이 이미 실행했으므로 다시 실행하지 않는다). 다른 블록·빈 작업판·페이지 다른
  곳을 누르면 풀린다. 합친 스택은 컴파일 결과를 저장해 두고(`joined`: 같은 스택·같은 작품·같은 실행이면 재사용)
  `vm.startStack` 이 첫걸음을 그 자리에서 밟는다 — 누른 뒤 한 프레임도 기다리지 않는다.
- 움직임 블록 문구는 `x`·`y` 로 시작하지 않는다 — `좌표 x %1 y %2 위치로 이동하기`, `좌표를 x %1 y %2 만큼 바꾸기`,
  `좌표 x 를 %1 (으)로 정하기` 식으로 `좌표` 가 앞에 온다(시간이 걸리는 판도 같은 모양).
- 무대 미리보기(`.preview`)는 `user-select: none`, 두 번째 이후 클릭의 `mousedown` 기본 동작을 막아 빈 곳을 여러 번
  눌러도 페이지 글자가 선택되지 않는다.

## 25. 레이어 끌기, 리스트 가상화, 화면 밖 블록 숨기기, 값 말풍선 속도

- **레이어 순서 끌기**(`PaintTools.tsx` `LayerList`): 줄을 누르고 움직이면 `beginDrag`/`SlideReorder`/`dragGhost`(오브젝트
  목록과 같은 끌기), 놓으면 `VectorPainter.moveLayerTo(index, to)`. 움직이지 않고 떼면 그 레이어를 고른다. 목록은 위가
  맨 위 레이어라 `to = count - 1 - 보이는 자리`.
- **그림판 확대 메뉴**: `setZoom` 에 기준점이 없으면 보이는 영역 가운데(`clientToScene`/`clientToCanvas`)를 기준으로
  확대한다 — 예전에는 원점 기준이라 메뉴로 확대하면 그림이 화면 밖으로 밀렸다.
- **모양 다듬기**: 고른 것의 상자(여백 12px) 밖이나 빈 곳을 눌렀다 떼면 선택을 풀고 선택 도구로 돌아간다(`leaveOnUp`).
- **리스트 편집기**(`PropertyPane` `ListEditor`): 항목 목록 `.item-list` 가 따로 스크롤된다(`max-height: calc(100vh - 300px)`,
  `overscroll-behavior: contain`). 보이는 줄만 그린다 — 줄 높이 `ITEM_ROW = 34`(30 + 간격 4), 위아래 `ITEM_MARGIN = 10`
  줄 더, 나머지는 `li.item-room` 여백. 끌어 옮기기의 자리는 `first + …`. 5만 항목에서 입력 한 번 ~15–50ms.
- **화면 밖 블록 숨기기**(blockly 포크): 스크롤 중 비용은 JS 가 아니라 페인트·`Layerize` 였다(900 블록 스크립트,
  프레임 33ms, Layerize 최대 46ms). 문장 블록(평평한 그룹)마다 보이는 영역(+120px)에서 벗어나면 `blocklyCulled`
  (`visibility: hidden`) 을 붙인다 — 칠하지 않으니 페인트 청크도 생기지 않는다. 값 블록은 부모 그룹 안에 있어 함께 숨는다.
  - `BlockSvg.cullStack(rect | null)`: 스택 위치 + `stackX/Y`, 자기 `width/height`(C 블록은 안쪽 포함) 로 판정.
    `null` 은 모두 보이기 — 끌기 시작(`setDragging(true)`, `startDragProxy`) 전에 부른다.
  - `WorkspaceSvg.cullBlocks()`: `translate` 안에서 바로(스크롤한 그 프레임에 반영), 렌더 끝(`doRenders`), 윗 블록
    이동·`resize` 뒤 `queueCull`(다음 프레임 한 번). 팔레트·뮤테이터는 하지 않는다. 끄는 중인 스택은 건너뛴다.
  - 접기의 `visibility`(인라인 스타일)와 따로 놀도록 클래스로 한다.
  - 결과(3dcheese 1261 블록): 프레임 33→17ms, Layerize 최대 48→7ms, 900 블록 판정 한 번 ~0.3ms.
- **오브젝트 바꾸기**: 불러오는 동안 `startTextWidthCache`, 포크 `getFastTextWidthWithSizeString` 이 글꼴+글자별 폭을
  페이지 내내 기억(`measuredWidths`, 5만 개 넘으면 비움, `document.fonts` `loadingdone` 에 비움)하고 같은 글꼴이면
  `canvasContext.font` 를 다시 넣지 않는다. `returnsValue` 는 저장된 상태별로 기억(`WeakMap`, 상태는 통째로만 바뀜).
  1261 블록 오브젝트 615 → ~400ms(나머지는 블록 생성 자체).
- **값 말풍선**(`report-bubble.ts`): 예전엔 누를 때마다 작품 전체 소스(그림 data URL 포함 2MB)를 컴파일(600ms)하고
  소스마다 새 조용한 Vm 을 만들었다.
  - 소스는 `buildSource(…, { stubData: true })` — 모양·소리 파일은 `stub:<id>.png|mp3`, 리스트는 빈 채로 쓰고, 컴파일
    결과에 모델의 리스트 항목을 바로 넣는다(`fillLists`, 이름+주인으로 짝).
  - 컴파일한 사본은 `(model, 오브젝트, 블록 상태, 함수 정의)` 가 같으면 다시 쓴다(`probe`).
  - 조용한 Vm 은 모델마다 하나(`quiet.model`), 식은 `idMap`/`remap` 으로 그 Vm 의 id 로 옮겨 계산한다.
  - 컴파일 전에 한 프레임 쉬어 `…` 가 먼저 보인다.
  - 결과: 3dcheese 665→55–230ms(다시 누르면 ~10–45ms), 5만 항목 `포함되어 있는가` 596→56ms.
