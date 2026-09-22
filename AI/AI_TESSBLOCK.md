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
| `src/blocks/catalog/*.ts` | 카테고리별 블록 명세 (시작·흐름·움직임·생김새·붓·소리·판단·계산·자료·자료분석·글상자) |
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

- `func_define` — 모자형 정의 블록. 이름은 `FieldTextInput`, 매개변수는 `PARAMS` 더미
  입력에 이름 필드 + 삭제 아이콘으로 그린다(`refreshParams`).
- `func_param_value` / `func_param_boolean` — 매개변수 참조 블록. 값은 매개변수 id 이고,
  작성기가 `safeIdent(name)` 으로 바꾼다.
- `func_return`, `func_local_var` — `return E`, `var 이름 = E`.
- 저장하면 `syncFunctionBlocks()` 가 함수마다 `func_call_<id>` 를 정의한다. 정의 본문에
  `func_return` 이 있으면 값 블록 `func_value_<id>` 도 함께 만든다.

매개변수 이름 필드는 **시작값으로도 검증기를 부른다.** 이름이 같으면 아무 것도 하지
않도록 막지 않으면 다시 그리기 → 검증기 → 다시 그리기로 무한히 돈다.

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
  키우거나 줄여도 손잡이 크기는 그대로다.

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
await boot({ project: built.project, container, autoStart: true, kernelUrl: null });
```

`kernelUrl: null` 은 wasm 커널 없이 자바스크립트 커널로 돌린다는 뜻이다. 실행 전에는
`ui/StagePreview.tsx` 가 오브젝트를 시작 위치에 그려 두고, 무대에서 끌어 옮기면 x·y 가
모델에 바로 반영된다.

## 8.5 속성 편집기

속성 탭은 블록 화면을 덮지 않는다. 팔레트 자리에 패널로 뜨고(`.prop-panel`,
z-index 90 — Blockly 툴박스가 70이다) 오른쪽 블록은 그대로 보인다. 리스트와 테이블은
쉼표 문자열이 아니라 항목·칸 단위 편집기를 쓴다: 리스트는 줄마다 값·순서·삭제,
테이블은 열 이름과 칸을 바로 고치고 행·열을 더하거나 지운다.

## 8.7 블록 메뉴

`blocks/context-menu.ts` 가 Blockly 의 오른쪽 메뉴를 다시 짠다.

- 말 바꾸기: `중복` → **복제하기**, `댓글` → **주석**, 그 밖의 항목도 에디터 말투로.
- 복제는 잘라 붙이기로 구현해 **맨 위 블록의 왼쪽 위가 마우스 자리**에 오게 한다.
  Blockly 기본 복제는 원본에서 고정된 거리만큼 비켜 놓는다.
- 복사하기와 붙여넣기를 따로 둔다(블록·작업판 양쪽). 붙여넣기도 마우스 자리에 놓는다.

## 9. 상태와 저장

- 프로젝트 전체는 `model/store.ts` 의 `project` 신호 하나에 있다. 변경은 `update()` 로만.
- `localStorage['tessblock.project.v1']` 에 400ms 디바운스로 자동 저장한다.
- 블록 워크스페이스는 오브젝트마다 Blockly 직렬화 JSON(`object.blocks`)으로 보관하고,
  선택이 바뀔 때 `blockly-host.ts` 가 넣고 뺀다.
- 사이드 패널 너비는 `localStorage['tessblock.sideWidth']`.

## 10. 알아 둘 점

- 플라이아웃은 `autoClose = false` 로 두고 첫 카테고리를 열어 둔다. 엔트리처럼 팔레트가
  항상 보이고, 카테고리를 누르면 내용만 바뀐다.
- 워크스페이스 교체(`showObject`), 함수 호출 블록 등록(`syncFunctionBlocks`), 팔레트
  갱신, 모양 불러오기는 **컴포넌트 이펙트가 아니라 신호 구독**(`signal.subscribe`)으로
  건다. Preact 의 `useEffect` 는 렌더 뒤에 실행되고 탭이 가려지면 미뤄지므로, 선택이
  바뀐 그 자리에서 일어나야 하는 일은 구독으로 처리한다.
- 드래그 처리는 `ui/drag.ts` 로 모았다. `setPointerCapture` 에 기대지 않고 window 에
  리스너를 달며, 좌표 갱신에 `requestAnimationFrame` 을 쓰지 않는다 — 배경 탭에서는
  프레임 콜백이 멈춰 드래그가 반영되지 않는다.
- 다른 탭이 앞에 있을 때 블록 워크스페이스는 `display: none` 으로 숨긴다. `visibility`
  로 숨기면 위젯 레이어가 살아 있어 입력이 새어 들어간다.
- `painter` 는 `packages/painter/dist/index.js` 를 상대 경로로 읽는다(확장이 tessvm
  소스를 읽는 방식과 같다). painter 소스는 `erasableSyntaxOnly` 를 켜 둔 이 저장소의
  tsconfig 로는 검사되지 않으므로 빌드 산출물을 쓴다 — 새로 받은 저장소라면
  `pnpm --filter painter build` 를 한 번 돌려야 모양 탭이 뜬다.

## 11. 남은 일

- 소리·모양 자산을 IndexedDB 로 옮기기(현재는 localStorage 한도를 공유한다).
- 하드웨어·인공지능 카테고리, 확장 블록(`EXPANSION_BLOCKS`) 노출.
- 장면 복제, 오브젝트 복제, 블록 주석.
- 프로젝트 파일(.json) 가져오기/내보내기와 `.ent` 빌드 버튼.
