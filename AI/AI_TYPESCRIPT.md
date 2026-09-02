# AI_TYPESCRIPT — TypeScript 전환 기록

이 문서는 Tess 모노레포를 JavaScript 에서 TypeScript 로 옮기면서 정한 것들과,
그 결정이 왜 그렇게 됐는지를 적어 둔다. 사용자용 문서가 아니다.

---

## 1. 전환 방식 — 빌드 단계 없음

`.ts` 파일을 **그대로 `node` 로 실행**한다. Node 24 는 타입 스트리핑이 기본으로
켜져 있어서 `.ts` 를 별도 변환 없이 읽는다. `tsc` 는 타입 검사(`--noEmit`) 에만
쓰고 산출물을 만들지 않는다.

```
pnpm test        node --test test/*.test.ts
pnpm tess        node packages/cli/index.ts
pnpm typecheck   tsc --noEmit  (노드용 + 브라우저용 두 프로젝트)
pnpm build:grammar  node editors/vscode/build-grammar.ts
```

이 선택이 강제하는 제약이 둘 있다.

1. **상대 경로 import 는 `.ts` 확장자를 그대로 적는다.** Node 는 `./x.js` 를
   `./x.ts` 로 되짚어 주지 않는다. tsconfig 의 `allowImportingTsExtensions` 가
   이 표기를 허용한다.
2. **지울 수 있는 문법만 쓴다.** `enum`, `namespace`, 매개변수 프로퍼티는 값을
   만들어 내므로 Node 가 지우지 못한다. `erasableSyntaxOnly: true` 로 막아 둔다.
   타입 전용 import 는 반드시 `import type` 으로 적어야 한다 — Node 는 import 를
   지우지 않으므로, 타입 이름을 값처럼 import 하면 실행 중에 터진다.
   `verbatimModuleSyntax: true` 가 이것을 강제한다.

패키지의 `main`/`exports`/`bin` 은 모두 `index.ts` 를 가리킨다. 워크스페이스
안에서는 문제가 없고, npm 에 배포하면 Node 22.18+ 에서만 돌아간다.

## 2. tsconfig 구성

| 파일 | 대상 |
| --- | --- |
| `tsconfig.base.json` | 공통 컴파일러 옵션 |
| `tsconfig.json` | 노드 쪽 전부 (packages, test, editors). `lib: es2023`, `types: ["node"]` |
| `packages/player/tsconfig.browser.json` | `src/debug-ui.ts` 만. `lib: es2023 + dom`, `types: []` |

디버그 패널만 따로 검사하는 이유는 실행 환경이 다르기 때문이다 — 노드 쪽에서
`document` 가 보이거나 브라우저 쪽에서 `process` 가 보이면 안 된다.

## 3. 브라우저로 나가는 디버그 패널

`packages/player/src/debug-ui.ts` 는 서버가 `/debug-ui.js` 주소로 내보내는
브라우저 모듈이다. TypeScript 로 적혀 있으므로 내보낼 때 타입을 벗긴다.

```
server.ts   debugUiScript()  ->  module.stripTypeScriptTypes(source, { mode: 'strip' })
```

`strip` 모드는 타입을 공백으로 바꾸므로 줄·칸 번호가 원본과 그대로 맞는다 —
브라우저 스택 트레이스가 소스와 어긋나지 않는다.

`test/player-debug.test.ts` 도 이 파일을 jsdom 에서 직접 eval 하므로 같은 함수로
타입을 벗긴 뒤 넣는다. 벗기지 않으면 문법 오류로 42개 테스트가 통째로 깨진다.

### 전역

entryjs 는 타입을 제공하지 않고, 실행 페이지와 패널은 `window.tess*` 로 서로를
부른다. 이 둘을 `packages/player/src/globals.d.ts` 에 선언해 두었다.
entryjs 런타임은 멤버를 하나하나 모델링하지 않고 불투명한 객체로 뒀다 — 패널이
그 런타임을 건드리는 자리는 전부 가드나 try/catch 로 감싸여 있어서, 정밀한 타입이
잡아 줄 것이 없다.

preact 는 `/preact/preact.mjs` 라는 **서버 주소**로 import 한다. TypeScript 는
`/` 로 시작하는 지정자를 파일시스템 절대 경로로 풀기 때문에 모듈 선언으로도
`paths` 로도 잡히지 않는다. 그래서 그 import 한 줄만 `@ts-ignore` 로 넘기고,
`h`/`render` 는 `globals.d.ts` 에 전역으로 선언해 두었다.

## 4. 타입 설계

### AST — `packages/parser/src/ast.ts`

문법이 만들어 내는 노드를 전부 `type` 으로 판별하는 유니온으로 적었다. 방문자의
각 메서드는 자기가 만드는 노드 타입을 **반환 타입으로 선언**하므로, 방문자가
실제로 그 모양을 만드는지 컴파일러가 확인해 준다. 컴파일러·되돌리기의
`switch (node.type)` 는 이 유니온으로 좁혀진다.

`Loc.file` 은 `use` 로 불러온 노드에만 붙는 선택 필드다.

### 엔트리 작품 — `packages/compiler/src/types.ts`

`project.json` 에 실제로 들어가는 구조(`EntryProject`, `EntryObject`,
`EntryBlock`, `EntryVariable` …)와, 컴파일하는 동안만 존재하는 구조
(`CompiledObject`, `CompiledFunction`, `VariableRef` …)를 나눠 적었다.

### 되돌리기 — `packages/decompiler/src/types.ts`

되돌리기의 입력은 **남이 만든 작품 파일**이라 모양을 가정할 수 없다. 그래서
읽어 들이는 블록·엔티티는 `RawBlock`/`RawEntity` 로 느슨하게 두고, 되돌리기가
스스로 만들어 내는 것(`DecompileContext` 의 id→이름 표들, `VarInfo`,
`FunctionInfo` …)만 정확히 적었다. 경계가 어디인지 분명하게 두는 편이,
믿을 수 없는 데이터에 정확한 타입을 씌워 두는 것보다 안전하다.

## 5. 타입 검사가 잡아낸 실제 버그

**`Context.knownNames()` 가 매개변수 이름을 잘못 모았다.**

```js
// 전:  Map 을 펼치면 [이름, 타입] 짝이 들어간다
names.push(...this.funcScope.params, ...this.funcScope.localVars.keys());
// 후:
names.push(...this.funcScope.params.keys(), ...this.funcScope.localVars.keys());
```

`params` 는 `Map<이름, 블록타입>` 이라 펼치면 `['a', 'stringParam_xxxx']` 같은
배열이 후보 목록에 들어갔다. 그래서 함수 안에서 매개변수 이름을 오타 냈을 때
"혹시 이걸 쓰려던 건가요?" 가 그 매개변수를 절대 제안하지 못했다.

**닿지 않는 `case`.** `compiler/src/statement.ts` 의 `case "TableDecl"` 은
문법상 도달할 수 없다 — `table` 은 최상위 선언이고 `statement` 규칙에 없다.
제거했다.

**항상 참인 식.** `compileEvent` 의 `return [ctx.error(...)] && null` 은 배열이
언제나 참이라 사실상 `ctx.error(...); return null` 이었다. 그대로 풀어 적었다.

## 6. 그 밖에 손댄 것

- `[ctx.error(...)].filter(Boolean)` 26곳을 `blocksOf([...])` 로 바꿨다.
  `ctx.error` 는 `null` 을 돌려주므로 원래도 항상 빈 배열이었고, 타입으로도
  그렇게 읽힌다.
- 되돌리기의 `watchStagePicks.armed` 함수 프로퍼티를 모듈 지역 변수
  `stagePicksArmed` 로 옮겼다. 동작은 같고 타입이 붙는다.
- `editors/vscode/package.json` 에 `"type": "module"` 을 넣었다. 전에는
  `build-grammar.mjs` 라서 확장자로 ESM 이 정해졌는데, `.ts` 가 되면서
  가장 가까운 package.json 이 정하게 됐다.

## 7. 남아 있는 `any`

의도적으로 남긴 자리는 셋이다. 전부 **바깥에서 들어오는 데이터의 경계**다.

1. `packages/parser/src/parser/visitor.ts` 의 `Ctx` — chevrotain 이 규칙마다
   런타임에 모양을 정하는 CST 컨텍스트. 대신 각 메서드의 반환 타입을 정확히
   적어서, 나가는 쪽(AST)은 전부 검사된다.
2. `packages/decompiler` 의 `RawBlock`/`RawEntity` — 남의 편집기가 쓴 작품.
3. `packages/player/src/debug-ui.ts` 와 `globals.d.ts` — 타입이 없는 entryjs
   런타임과 브라우저 쪽 글루.

테스트는 컴파일 결과를 파고들며 확인하는 성격이라, 널 가능성은
`!` 로 단언한다 — 실제로 없으면 어차피 그 테스트가 실패한다.
