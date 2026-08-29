# AI_LSP — Langium 언어 서버와 VS Code 확장

`editors/vscode` 에 있는 Tess 언어 지원의 구조, 설계 판단, 검증 방법을 기록한다.

---

## 1. 무엇을 만들었나

Langium 4.3 위에 올린 LSP 서버와, 그 서버를 띄우는 VS Code 확장.

| 기능              | LSP 메서드                        | 구현                        |
| ----------------- | --------------------------------- | --------------------------- |
| 진단              | `publishDiagnostics`              | `tess-validator.ts`         |
| 자동 완성         | `textDocument/completion`         | `tess-completion.ts`        |
| 호버              | `textDocument/hover`              | `tess-hover.ts`             |
| 정의로 이동       | `textDocument/definition`         | `tess-navigation.ts`        |
| 참조 찾기         | `textDocument/references`         | `tess-navigation.ts`        |
| 문서 강조         | `textDocument/documentHighlight`  | `tess-navigation.ts`        |
| 이름 바꾸기       | `textDocument/rename`             | `tess-navigation.ts`        |
| 개요              | `textDocument/documentSymbol`     | `tess-document-symbol.ts`   |
| 의미 기반 강조    | `textDocument/semanticTokens`     | `tess-semantic-tokens.ts`   |
| 접기              | `textDocument/foldingRange`       | `tess-folding.ts`           |
| 들여쓰기 정리     | `textDocument/formatting`         | `tess-formatter.ts`         |

---

## 2. 핵심 설계 판단 — 왜 `.langium` 문법으로 파싱하지 않는가

Langium 은 보통 `.langium` 문법에서 파서를 생성한다. Tess 에서는 그렇게 하지
않고, 저장소의 chevrotain 파서를 Langium 의 `LangiumParser` 자리에 끼워
넣었다. 이유는 세 가지다.

1. **소프트 키워드.** Tess 의 키워드 116개 중 예약어는 10개뿐이고
   (`src/parser/tokens.js` 의 `RESERVED`), 나머지는 전부 이름으로 쓸 수 있다.
   `var size = 5`, `say next` 가 모두 유효하다. Langium 문법에서 키워드는
   `ID` 보다 먼저 매칭되는 렉서 토큰이 되므로, 이 규칙을 선언적으로 적으려면
   이름 자리마다 106개 대안의 선택지를 두어야 하고 문장 디스패치와 대규모로
   충돌한다.
2. **줄 경계 의존성.** `clone` 뒤에 인자가 오는지, `move 50 -30` 이 인자
   두 개인지 뺄셈 하나인지는 다음 토큰이 같은 줄에 있는지로 갈린다
   (`parser.js` 의 `sameLine()`). Langium 의 선언적 문법에는 이 술어를 적을
   자리가 없다.
3. **판정 일치.** 편집기가 "괜찮다"고 한 코드를 컴파일러가 거절하면 LSP 는
   없느니만 못하다. 파서를 두 벌 두면 반드시 벌어지는 일이다.

그래서 **문법 파일은 의미 모델(타입) 선언에만 쓰고, 파싱은 컴파일러 것을
그대로 쓴다.** `src/language/tess.langium` 은 `interface` · `type` 선언만
담으며, `langium-cli` 가 여기서 `ast.ts`(타입 + `TessAstReflection`),
`grammar.ts`, `module.ts` 를 만든다. 진입 규칙 `TessFile` 은 생성기가 요구하는
시작 심볼일 뿐 파싱에 쓰이지 않는다.

바꾼 결과 얻는 것: Langium 의 문서 수명주기, DI 컨테이너, LSP 배선,
`DocumentBuilder` 단계, 취소 처리, 워크스페이스 관리는 그대로 쓰고,
언어 판정만 컴파일러가 한다.

---

## 3. 브리지 — `tess-bridge.ts`

`TessBridgeParser.parse(text)` 가 하는 일:

1. `tokenize(text)` — 컴파일러의 렉서. 토큰 스트림은 CST, 이름 위치 찾기,
   자동 완성 문맥 판단에 재사용한다.
2. `parse(text)` — 컴파일러의 파서 + 검증기. `{ok, ast, errors, warnings}`.
3. 성공하면 Tess AST 를 Langium AST 로 옮기면서 CST 를 같이 만든다.
4. 실패하면 빈 `Program` 을 루트로 세우고, 오류를 chevrotain 모양의
   `parserErrors` 로 돌려 Langium 의 `DefaultDocumentValidator` 가
   진단으로 바꾸게 한다.

### 3.1 AST 변환

일반 변환이다. 노드별 코드가 없다.

- `$type` 은 Tess 의 `type` 을 그대로 쓰되, JavaScript 전역과 겹치는 이름만
  바꾼다: `Object→ObjectDecl`, `String→StringLiteral`, `Number→NumberLiteral`,
  `Boolean→BooleanLiteral`, `Keyword→KeywordValue`.
- `Jump.target` 은 문자열(`next`/`back`)이거나 표현식이라, 문자열일 때는
  `where` 로 옮긴다 (`PROPERTY_NAMES`).
- 자식 노드는 `$container` · `$containerProperty` · `$containerIndex` 를 채운다.
- `null`/`undefined` 스칼라는 넣지 않는다. 서비스 쪽에서 `?.` 로 다룬다.

### 3.2 CST 구성

Langium 의 위치 조회(`findLeafNodeAtOffset`), 범위, 문서 세그먼트가 전부
CST 위에서 돌기 때문에 진짜 CST 를 만든다.

AST 를 재귀 하강하면서 토큰 커서를 하나 들고 간다. 노드마다
`CompositeCstNodeImpl` 을 만들고, 자식으로 내려가기 전에 "자식 시작 위치보다
앞서는 토큰"을 전부 자기 잎(`LeafCstNodeImpl`)으로 가져간다. 자식을 다 돌면
자기 끝 위치까지 남은 토큰을 마저 가져간다.

Tess AST 의 `loc` 범위는 항상 부모 안에 중첩되므로 이 방식으로 **모든 토큰이
정확히 한 번씩** 가장 안쪽 노드에 붙는다. `test/language.test.js` 의
"every lexed token lands in the CST exactly once" 가 이걸 검사한다.

`loc` 이 없는 노드(`rotation free` 의 `KeywordValue` 하나뿐)는 부모의 CST 를
공유한다. 의미 기반 강조에서 같은 토큰을 두 번 칠하지 않도록,
`highlightElement` 는 `cst.astNode !== node` 인 노드를 건너뛴다.

### 3.3 이름 토큰 위치

Tess AST 의 `VarDecl.name`, `FunctionDecl.name`, `Costume.id` 등은 문자열일 뿐
자기 위치를 갖지 않는다. 이름 바꾸기와 개요의 `selectionRange` 에는 이름
토큰의 정확한 범위가 필요하다.

선언 노드의 `loc` 안에서 이미지가 이름과 같은 첫 토큰을 이진 탐색으로 찾는다
(`tess-symbols.ts` 의 `findNameRange`). 문자열로 이름을 다는 `object` ·
`scene` 은 따옴표를 포함한 리터럴 토큰을 쓴다(`stringRange`).

---

## 4. 스코프 — `tess-symbols.ts`

`src/validate.js` 의 규칙을 그대로 옮겼다. 여기서 어긋나면 이동과 완성이
컴파일러와 다른 답을 내므로 중요하다.

- **전역**: 최상위 `var`/`list`. `scene` 안의 것은 전역이 아니다.
- **함수 이름**: 파일 전체에서 보인다. `scene`/`object` 안쪽까지 훑어 모은다
  (`collectFunctionNames`).
- **오브젝트 로컬**: 오브젝트 몸통에 직접 선언한 `var`/`list`. `objectLocals`
  에 따로 담아, 이벤트 스크립트에서만 보이게 한다.
- **함수 스코프**: 매개변수 + 전역. 감싼 오브젝트의 로컬은 **보이지 않는다**
  (spec 14.2). `resolve()` 가 `kind === 'event'` 일 때만 `objectLocals` 를
  들여다보는 것이 이 규칙이다.
- **암묵적 이름**: 상태 값, 옵션 키워드, 오브젝트 속성, 글상자 속성은 선언
  없이 쓴다 (`IMPLICIT_NAMES`).

`occurrences(symbol)` 은 이름이 같은 토큰을 세는 게 아니라, 각 자리에서
`resolve()` 한 결과가 같은 심볼인지 본다. 그래서 가려진 지역 변수는 이름
바꾸기에 딸려 가지 않는다.

### 4.1 파싱이 깨졌을 때

타이핑 중에는 파싱이 실패하는 시간이 길고, 자동 완성이 가장 필요한 순간도
그때다. AST 가 없으면 `collectFromTokens()` 가 토큰 스트림에서
`var`/`list`/`function` 다음 토큰을 읽어 선언 목록을 세운다. 자동 완성은
AST 가 아니라 토큰 스트림으로 문맥을 판단하므로 그대로 동작한다.

---

## 5. 자동 완성 문맥

`previousToken()` 은 커서 바로 앞 토큰을 찾되, **커서에 걸친 토큰은 건너뛴다**
— 그건 문맥이 아니라 사용자가 치고 있는 검색어다.

| 앞 토큰 / 위치                       | 내놓는 것                              |
| ------------------------------------ | -------------------------------------- |
| 문자열 안 (`isInsideString`)         | 신호 · 장면 · 오브젝트 · 모양 · 소리 이름 |
| `when`                               | 이벤트 형태 9종 (스니펫)               |
| `jump`                               | `next`, `back`, 장면 이름              |
| `rotation`                           | `free`, `vertical`, `none`             |
| `order`                              | `front`, `back`, `first`, `last`       |
| 전역 스코프 + 줄 시작                | 선언 키워드 + 블록 스니펫              |
| 오브젝트 스코프 + 줄 시작            | 멤버 키워드 + 이벤트 + 속성            |
| 스크립트 스코프 + 줄 시작            | 문장 키워드 + 블록 스니펫 + 속성 + 이름 |
| 그 외                                | 이름 + 내장 함수 + 상태 값 + 리터럴    |

"줄 시작"은 앞 토큰이 `:` · `then` · `do` · `end` · `else` 이거나, 앞 토큰과
커서 사이에 줄바꿈이 있는 경우다 (`opensLine`).

---

## 6. 들여쓰기 정리

블록 깊이만 다시 매긴다. 줄 안의 다른 것은 건드리지 않는다.

토큰 스트림을 줄 단위로 훑으며:

- 줄의 첫 토큰이 `end` 또는 `else` 면 그 줄은 깊이 −1, 그리고 깊이를 하나 줄인다.
- 줄의 마지막 토큰이 `:` · `then` · `do` 면 깊이를 하나 늘린다.
- 토큰이 하나도 시작하지 않는 줄(빈 줄, 주석 줄)은 현재 깊이를 따른다.
- 여러 줄에 걸친 문자열의 이어지는 줄은 내용이므로 건드리지 않는다.

빈 줄의 공백은 지운다. CRLF 를 깨지 않도록 앞쪽 공백/탭만 잘라 낸다.

`test/language.test.js` 가 `examples/*.tess` 를 대상으로, 내용이 있는 줄은
한 글자도 바뀌지 않고 두 번 돌려도 편집이 없음을 검사한다.

---

## 7. 파일 배치

```
editors/vscode/
├── package.json              확장 매니페스트 + 빌드 스크립트
├── langium-config.json       langium-cli 설정
├── esbuild.mjs               번들 3개 (extension / server / language)
├── tsconfig.json
├── language-configuration.json   괄호·주석·들여쓰기 규칙 (편집기 기본)
├── syntaxes/tess.tmLanguage.json 서버가 뜨기 전 첫 화면 강조
├── build-grammar.mjs         위 파일 생성기
├── icons/tess.svg
├── src/
│   ├── extension/main.ts     VS Code 클라이언트
│   └── language/
│       ├── tess.langium      의미 모델 선언
│       ├── generated/        langium-cli 산출물 (커밋함)
│       ├── main.ts           서버 진입점 (stdio)
│       ├── api.ts            헤드리스 분석 API
│       ├── tess-module.ts    DI 모듈
│       ├── tess-core.ts      컴파일러 프런트엔드 타입 경계
│       ├── tess-bridge.ts    AST/CST 브리지
│       ├── tess-model.ts     문서별 분석 캐시
│       ├── tess-symbols.ts   심볼 테이블 · 스코프
│       ├── tess-docs.ts      호버/완성 설명 데이터
│       └── tess-*.ts         각 LSP 서비스
└── test/
    ├── helpers.js
    ├── lsp-client.js         stdio JSON-RPC 클라이언트
    ├── language.test.js      서비스 단위 검사 (20개)
    └── server.test.js        실제 서버 프로세스 검사 (8개)
```

### 7.1 번들

`out/server.cjs` 는 Langium 과 `src/parser` · `src/validate.js` 를 통째로
담는다. 확장이 설치될 때 저장소가 옆에 없어도 되고, 런타임 의존성이 없다.
esbuild 가 `../../../../src/parse.js` 를 따라가며 `chevrotain` 과
`@babel/code-frame` 은 저장소 루트의 `node_modules` 에서 찾는다 — 그래서
빌드 전에 루트에서 `pnpm install` 이 한 번 돌아 있어야 한다.

`out/language.cjs` 는 `api.ts` 를 번들한 것으로, 편집기 없이 같은 분석을
돌리는 데 쓴다. 검사가 이걸 쓴다.

### 7.2 서비스 대체

`tess-module.ts` 가 Langium 기본값을 갈아 끼우는 자리:

- `parser.LangiumParser` → 브리지. Langium 은 이 서비스에서 `parse` 만
  부르므로 브리지도 그것만 구현한다.
- `lsp.*` → 전부 직접 구현. 기본 구현은 생성된 문법의 ATN 을 따라가므로
  브리지 파서와는 맞지 않는다.
- `validation.TessValidator` → 컴파일러 진단 재생.

`parser.CompletionParser`, `parser.Lexer` 는 기본값을 그대로 두었다. DI 가
지연 생성이라, 이들을 요구하는 서비스를 전부 대체한 지금은 만들어지지 않는다.

---

## 8. 검사

```bash
cd editors/vscode && npm test        # pretest 가 빌드까지 한다
```

- `language.test.js` — 진단이 컴파일러와 일치하는지, CST 토큰 보존,
  개요 중첩, 이동/참조/이름 바꾸기, spec 14.2 스코프, 자동 완성(파싱 실패
  중 포함), 의미 토큰 종류, 접기, 들여쓰기 정리, `examples/*.tess` 전부.
- `server.test.js` — 서버 프로세스를 띄워 `initialize` → `didOpen` →
  `didChange` → 각 요청을 실제 JSON-RPC 로 주고받는다. `use` 를 따라 다른
  파일로 이동하는 것도 여기서 본다.

저장소 루트의 `pnpm test` 는 이 검사를 돌리지 않는다 (빌드 산출물이 필요하고
확장 의존성이 따로 설치되어야 한다).

---

## 9. 손댈 때 주의할 것

- **언어에 문장을 추가했다면** `src/parser` 와 `src/parser/visitor.js` 를
  고친 뒤 `tess.langium` 에 대응 `interface` 를 더하고 `npm run
  langium:generate` 를 돌린다. 브리지는 일반 변환이라 따로 고칠 게 없다.
  다만 새 타입 이름이 JavaScript 전역과 겹치면 `TYPE_NAMES` 에 넣는다.
- **키워드를 추가했다면** `node build-grammar.mjs` 로 TextMate 문법을 다시
  만들고, 설명이 필요하면 `tess-docs.ts` 의 표에 한 줄 더한다.
- **`src/validate.js` 의 스코프 규칙을 바꿨다면** `tess-symbols.ts` 도 같이
  고쳐야 한다. 두 곳이 어긋나면 편집기와 컴파일러의 답이 갈린다.
