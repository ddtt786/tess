# 확장 — playentry.org 의 실행기를 tessvm 으로 바꾸기

`packages/extension` 은 크롬·파이어폭스 확장입니다. 작품 페이지
(`https://playentry.org/project/<id>`)에서 **엔트리 실행기 대신 tessvm 이 그 작품을
돌리게** 합니다. 만들기 화면(`/ws`)은 건드리지 않습니다 — 바뀌는 것은 실행기 하나뿐입니다.

```bash
pnpm build:extension        # dist 폴더와 tessvm-extension.zip 을 만든다
```

크롬: `chrome://extensions` → 개발자 모드 → 압축해제된 확장 프로그램을 로드 → `dist`.
파이어폭스: `about:debugging#/runtime/this-firefox` → 임시 부가 기능 로드 → **`tessvm-extension.zip`**.

파이어폭스에 폴더 대신 zip 을 주는 이유가 있습니다. 파일 선택창으로 `manifest.json` 을
고르면 샌드박스(플랫팩)에서는 **그 파일 하나만** 열람 권한이 붙어서, 옆에 있는 파일을
읽는 순간 `NS_ERROR_FILE_NOT_FOUND` 로 설치가 통째로 실패합니다. zip 은 파일 하나라
그 문제가 없습니다.

| 파일                        | 역할                                                    |
| --------------------------- | ------------------------------------------------------- |
| `manifest.json`             | MV3 매니페스트 (크롬·파이어폭스 공용)                   |
| `build.ts`                  | 타입만 지워 `dist` 를 만드는 빌드                       |
| `icons.ts`                  | 툴바 아이콘 PNG 생성기                                  |
| `pack.ts`                   | zip 작성기와 CRC-32 (아이콘도 같은 CRC 를 쓴다)          |
| `src/browser.ts`            | `browser`/`chrome` 두 이름을 하나로 맞춘 얇은 어댑터    |
| `src/content.ts`            | 격리 세계 — 엔트리 iframe 을 비우고 자리를 만든다       |
| `src/page/main.ts`          | 페이지 세계 진입점 — 자리를 찾아 실행기를 붙인다        |
| `src/page/entry-project.ts` | graphql 로 작품을 읽고 에셋 주소를 채운다               |
| `src/page/tess-project.ts`  | 작품을 Tess 로 되돌렸다가 다시 컴파일한다               |
| `src/page/player.ts`        | 실행기 화면 — 무대·조작줄·시작 화면·오류 줄             |
| `src/player.css`            | 실행기 스타일 (무대·조작줄·시작 화면·오류 줄)           |
| `src/popup/*`               | 툴바 스위치                                             |

## 1. 왜 페이지의 세계에서 도는가

tessvm 은 작품을 열 때 블록 트리를 자바스크립트 소스로 만들고 `new Function` 으로
컴파일합니다(AI_TESSVM.md 2장). MV3 확장 페이지의 CSP 는 `script-src 'self'` 라
`unsafe-eval` 이 없고, 파이어폭스는 샌드박스 페이지(`sandbox.pages`)를 지원하지 않습니다.
확장 자신의 문서 안에서는 JIT 이 아예 돌지 않습니다.

그래서 실행기는 **playentry.org 문서 그 자체**에서 돕니다.

- 페이지에 CSP 헤더도 `<meta http-equiv>` 도 없습니다 — `new Function` 과 블롭 워커
  (백그라운드 탭 틱)가 그대로 됩니다.
- 에셋(`/uploads/…`)이 **동일 출처**입니다. 충돌 마스크는 그림을 캔버스에 그린 뒤
  `getImageData` 로 알파를 읽으므로(AI_TESSVM.md 11장), 출처가 갈리면 캔버스가 오염되어
  판정이 통째로 죽습니다.
- graphql 의 csrf 토큰(`meta[name=csrf-token]`)과 쿠키가 그 문서의 것입니다.

격리 세계의 내용 스크립트는 `chrome.runtime.getURL('page/main.js')` 를 가리키는
`<script type="module">` 하나를 문서에 넣습니다. 모듈이므로 나머지 파일은 확장 주소를
기준으로 상대 경로로 따라 들어옵니다. 그 스크립트가 오지 못하면 빈 상자만 남으므로,
`onerror` 가 마운트 지점에 이유를 적습니다.

### 내용 스크립트만은 모듈이 아니다

`content_scripts` 에 적은 파일은 브라우저가 **클래식 스크립트**로 읽습니다. `import` 가
하나라도 있으면 `Cannot use import statement outside a module` 로 파싱 자체가 실패하고,
**그 파일의 어떤 줄도 실행되지 않습니다.** 오류가 눈에 잘 띄지 않아서 "확장을 켰는데
아무 일도 일어나지 않는다" 로만 나타납니다.

그래서 `build.ts` 는 내용 스크립트만 따로 다룹니다 — 임포트를 따라가 의존성부터 차례로
늘어놓고, `import`·`export` 문법을 지운 뒤 하나의 IIFE 로 이어 붙입니다. 붙인 결과는
`new Function` 으로 한 번 파싱해 봅니다. 남은 모듈 문법도, 두 파일이 같은 이름을 선언한
경우도 여기서 걸립니다. 페이지 쪽(`page/main.js`)과 팝업은 문서가 모듈로 불러오므로
그대로 둡니다.

## 2. 엔트리 실행기를 멈추는 자리

작품 페이지는 스스로 작품을 돌리지 않습니다. `/iframe/<id>` 를 여는 iframe 이 돌립니다.
그 iframe 이 뜨면 엔트리 실행기(`entry.min.js` 18MB 와 서드파티 묶음)를 통째로 받습니다.

내용 스크립트는 `document_start` 에서 `MutationObserver` 를 걸고, 주소에 `/iframe/` 이 든
프레임이 **붙는 순간**(또는 그 뒤에 `src` 가 채워지는 순간) 주소를 `about:blank` 로
바꿉니다. 항해가 시작되기 전에 바뀌므로 엔트리 쪽 요청은 한 건도 나가지 않습니다.

**지우지 않고 비웁니다.** 이유가 둘입니다.

1. 실행기의 크기를 정하는 것이 그 프레임입니다. 페이지의 규칙은
   `.래퍼 iframe { height: 495px }` 이고 뷰포트에 따라 `58vw`·`calc(53px + 56vw)` 로
   바뀝니다. 래퍼 자신의 높이는 auto 라, 프레임을 빼면 상자가 0 이 됩니다.
2. 그 노드는 페이지의 뷰 코드가 들고 있습니다. 없어진 노드를 지우려 하면 경로가 바뀔 때
   `removeChild` 가 터집니다.

그래서 프레임은 `visibility: hidden` 으로 자리만 지키고, 마운트 지점(`.tessvm-host`)을
`position: absolute; inset: 0` 으로 그 위에 겹칩니다(래퍼가 `static` 이면 인라인으로
`relative` 를 줍니다). 실제 페이지에서 재보면 엔트리의 상자와 **같은 자리·같은 크기**
(792×495)이고, 창 크기를 바꾸면 페이지의 원래 규칙을 그대로 따라갑니다.

끄면 `visibility` 와 원래 주소를 되돌려 놓습니다 — 그때부터는 엔트리 실행기가 뜹니다.

### 내용 스크립트가 붙는 범위

`matches` 는 `https://playentry.org/*` 전부입니다. 작품 페이지만 걸면 안 됩니다 —
playentry 는 Next.js 라, 목록에서 작품으로 들어갈 때 문서가 새로 뜨지 않아 내용 스크립트가
주입되지 않습니다. 대신 `/ws`(만들기)와 `/iframe/*` 은 `exclude_matches` 로 뺍니다.
찾는 것이 `/iframe/` 프레임이므로, 그 밖의 페이지에서는 관찰자만 돌고 아무 일도 없습니다.

## 3. 작품을 직접 읽어 온다

엔트리 실행기가 없으니 작품도 직접 가져와야 합니다.

```
POST /graphql/SELECT_PROJECT
csrf-token: <meta[name=csrf-token]>.content
{"query":"query SELECT_PROJECT($id: ID!, $groupId: ID){ project(id:$id, groupId:$groupId){ … } }",
 "variables":{"id":"<작품 id>","groupId":null}}
```

토큰 없이 보내면 `form tampered with` 로 막힙니다. 토큰은 `_csrf` 쿠키와 짝이라 같은
문서에서 보내야 맞습니다. 받는 필드는 tessvm 이 읽는 것만입니다 —
`speed·objects·variables·messages·functions·tables·scenes` 에 이름과 썸네일.

응답은 `project.json` 과 **사실상** 같습니다 — 다만 `.ent` 로 저장한 것과 모양이 다른
자리가 있습니다. 빈 `statements` 는 아예 빠지고, **함수 본문은 정의 블록 뒤에 이어 붙은
채로** 옵니다(AI_TESSVM.md 2장 '함수 본문은 두 가지 모양으로 온다'). 이 차이 때문에
`.ent` 로는 잘 돌던 작품이 확장에서만 함수가 전부 비어 돌던 일이 있었습니다.

### 돌리기 전에 Tess 를 지나간다

받은 작품은 **그대로 돌리지 않습니다.** `tessvm run` 이 `.ent` 를 열 때와 같은 길을
지나갑니다(AI_TESSVM.md 1장).

```
graphql 응답 ──@tess/decompiler──▶ Tess 소스 ──@tess/compiler──▶ 엔트리 작품 ──▶ boot()
```

작품 데이터를 그대로 `Vm.load()` 에 넣어도 돌기는 합니다 — `Codegen` 이 블록 트리를
직접 읽으니까요. 그렇게 하면 확장만 **다른 길**이 되어, 컴파일러가 하는 정리
(엔트리에 없는 블록 만들어 내기, 값 블록 펴기, 치트로 쓰인 껍데기 블록 걷어내기)를
받지 못한 채 돕니다. 같은 작품이 `tessvm run` 에서는 되고 확장에서는 안 되는 차이가
거기서 생깁니다. 길을 하나로 두면 고칠 곳도 한 군데입니다.

**그대로 넘어가는 것은 파일 주소뿐입니다.** 되돌릴 때 `inline`·`sizes` 를 켜서

- 오브젝트를 조각 파일이 아니라 소스 안에 씁니다 — 브라우저에는 파일을 둘 곳이 없어
  `useobject` 가 가리킬 데가 없습니다,
- 모든 모양에 `size 가로 세로` 를, 소리에 `for 초` 를 적습니다 — 그림 파일을 열어
  재는 대신 소스에 적힌 값을 씁니다,
- 벡터는 `keepSvg` 로 원본 주소를 그대로 둡니다. 벡터와 래스터 중 무엇을 쓸지는 늘 그랬듯
  렌더러가 정합니다.

컴파일은 `assetUrls` 로 부릅니다. 모양·소리의 경로를 `temp/…` 로 새로 만들지 않고 적힌
주소를 그대로 `fileurl` 로 쓰고, `.svg` 옆에는 확장자만 바꾼 `pngurl` 을 답니다. 블록
주석은 편집기용이라 `comments: new Map()` 으로 건너뜁니다.

작품 하나를 옮기는 데 큰 것은 2~4초쯤 걸리고(deltarune 기준) 그동안 페이지의 스레드를
잡으므로, 안내 문구를 먼저 띄우고 한 프레임 쉰 뒤에 시작합니다. 옮기지 못한 블록은
`vm.unknownBlocks` 와 같은 줄에 같은 문구로 알립니다.

컴파일러가 만든 작품에는 `id` 가 없으므로 원래 작품 id 를 붙여 줍니다 — 공유·실시간
변수가 저장소에서 그 작품을 찾는 이름입니다(AI_TESSVM.md 12장).

### 에셋 주소 — 하나 빠져 있다

응답의 그림·소리에는 `fileurl` 이 없습니다. 엔트리 실행기가 `filename` 에서 만들어 쓰기
때문입니다. `entry.min.js` 의 규칙을 그대로 옮깁니다.

| 종류 | 주소                                                              |
| ---- | ----------------------------------------------------------------- |
| 그림 | `/uploads/<이름[0:2]>/<이름[2:4]>/image/<이름>.<png\|svg>`         |
| 소리 | `/uploads/<이름[0:2]>/<이름[2:4]>/<이름><ext 또는 .mp3>`           |

**소리에는 `sound/` 칸이 없습니다.** `Entry.getSoundPath` 는
`… + Entry.soundPath + filename + ext` 인데 playentry 의 `soundPath` 는 빈 문자열입니다.
`image/` 를 보고 `sound/` 를 넣으면 전부 404 입니다(확인함).

## 4. 실행기 화면

`boot()`(tessvm) 위에 엔트리와 같은 배치를 올립니다.

```
┌───────────────────────────────┐
│  무대 (16:9, 시작 전에는 썸네일)  │
├───────────────────────────────┤
│ ◼ ❚❚      X: 0  Y: 0    부스트모드 ⬤  ⛶ │  47px, 흰 바탕
├───────────────────────────────┤
│ 오류로 멈췄습니다 — …             │  오류가 났을 때만
└───────────────────────────────┘
```

- **시작 전 화면**은 작품 썸네일(`project.thumb`)에 재생 단추입니다. tessvm 은 멈춰 있어도
  첫 프레임을 그리므로, 덮개에 `z-index` 를 줘서 캔버스 위에 올립니다 — 덮개가 먼저
  들어가고 `boot()` 이 무대를 그 뒤에 넣기 때문입니다.
- **오류 줄**은 두 가지를 씁니다. 붉은 줄은 실행을 멈춘 오류(스크립트 오류와, 한 프레임을
  끝내지 못한 오류 — AI_TESSVM.md 12장)이고, 노란 줄은 **이 실행기가 아직 모르는 블록**의
  목록입니다. 모르는 블록은 아무것도 아닌 것으로 컴파일되므로, 그 블록으로 장면을 짓는
  작품은 조용히 반쯤 빈 채로 돕니다 — 작품이 고장 난 것처럼 보이지 않게 적어 둡니다.
- **부스트모드**는 `vm.boost` 를 그대로 켜고 끕니다. tessvm 은 부스트와 상관이 없지만
  작품이 `boost_mode?` 로 갈라지는 경우가 있어서 필요합니다.
- **오류**는 토스트를 띄우지 않습니다. `vm.onError` 가 오면 작품을 세우고 시작 전 화면으로
  돌아간 뒤, 맨 밑 줄에 오브젝트 이름과 함께 작게 씁니다. 같은 블록의 같은 오류는 한 번만
  적습니다.
- **키 입력은 실행기 안에서만** 받습니다(`BootOptions.keyTarget`). 실행 페이지와 달리
  작품 페이지에는 댓글 입력칸이 있어서, `window` 에서 키를 읽으면 댓글을 쓰는 동안 작품이
  같이 움직입니다.
- **물어보기 입력창**은 tessvm 이 만드는 것이라 그 스타일(`src/web/ask-style.ts`)도 tessvm
  에서 가져와 `<style>` 하나로 넣습니다. 확장이 따로 베껴 쓰면 실행 페이지와 어긋납니다.
- **조작줄은 상태가 바뀔 때만 다시 그립니다.** 100ms 마다 단추의 `innerHTML` 을 새로 쓰면
  누른 순간의 노드가 떼는 순간 전에 문서에서 빠져서, 브라우저가 그것을 클릭으로 치지
  않습니다. 일시정지가 안 먹히던 이유가 이것이었습니다.

### 벡터 모양

`entry-project.ts` 는 벡터로 그린 모양에 `.svg` 와 `.png` 주소를 **둘 다** 실어 주고,
어느 쪽을 쓸지는 렌더러가 정합니다(규칙은 AI_TESSVM.md). 팝업의 '벡터 모양 그대로 쓰기'
스위치는 `chrome.storage` 에 남고, 내용 스크립트가 마운트 지점의 `data-tessvm-svg` 로
넘겨 `boot({ svg })` 까지 갑니다. 이 값은 실행기를 만들 때 읽으므로, 스위치를 바꾸면
내용 스크립트가 마운트 지점을 지우고 다시 만듭니다.

### 아이디·닉네임 — `__NEXT_DATA__`

`아이디`·`닉네임` 블록은 엔트리에서 `window.user.username`·`.nickname` 을 읽습니다.
확장의 실행기는 같은 페이지에 있지만 같은 스크립트가 아니라 그 변수를 볼 수 없으므로,
페이지가 렌더될 때 심어 둔 next.js 꾸러미에서 같은 기록을 꺼냅니다.

```
JSON.parse(document.getElementById('__NEXT_DATA__').textContent)
  .props.pageProps.initialState.common.user
```

`signed-in.ts` 가 이 길을 한 칸씩 확인하며 내려갑니다 — 사이트가 언제든 바꿀 수 있는
모양이고 next.js 가 렌더하지 않은 페이지에는 아예 없으므로, 중간에 하나만 어긋나도
**로그인하지 않은 것**으로 봅니다. 그때 두 블록은 `guest` 를 돌려줍니다(엔트리는 빈
칸을 돌려주지만, 사이트 밖에서도 도는 실행기라 자기가 누구인지 밝히는 쪽을 택했습니다).

**아이디는 앞 두 글자만 남깁니다** — `ddtt786` → `dd*****`. 팝업의 '아이디 가리기'
스위치로 끌 수 있고, `chrome.storage` 에 남아 `data-tessvm-mask` 로 넘어가
`boot({ maskUserId })` 까지 갑니다. 벡터 모양 스위치와 달리 **실행기를 다시 만들지
않습니다** — VM 이 블록을 돌릴 때마다 이 값을 읽으므로, 내용 스크립트가 보낸
`{ __tessvm: 'mask' }` 를 받아 돌고 있는 작품에 그대로 넣습니다. 닉네임은 가리지
않습니다.

디버그 패널의 '실행 환경 흉내내기' 에도 같은 세 칸이 있습니다(AI_TESSVM.md).

## 5. tessvm 에 더한 것

확장이 필요로 해서 넣었고, 실행 페이지의 동작은 그대로입니다.

| 자리                        | 내용                                                         |
| --------------------------- | ------------------------------------------------------------ |
| `BootOptions.keyTarget`     | 키를 읽을 대상. 기본값은 `window`                            |
| `TessVmHandle.dispose()`    | 프레임 루프·리스너·캔버스·오디오를 놓는다                    |
| `PixiRenderer.destroy()`    | WebGL 컨텍스트와 캔버스를 놓는다                             |
| `WebAudioEngine.close()`    | 오디오 컨텍스트를 닫는다 (브라우저가 몇 개까지만 허용)       |
| `BootOptions.user`          | `아이디`·`닉네임` 이 답할 사람. 없으면 둘 다 `guest`         |
| `BootOptions.maskUserId`    | 아이디의 앞 두 글자만 남긴다. 끄지 않으면 켜짐               |

playentry 는 SPA 라 작품 사이를 오갈 때 문서가 그대로입니다. `dispose()` 가 없으면
`requestAnimationFrame` 루프와 오디오 컨텍스트가 작품마다 쌓입니다. 실행기는 마운트
지점이 문서에서 빠졌는지 100ms 마다 보고, 빠졌으면 스스로 정리합니다.

## 6. 빌드 — 번들러 없이

`build.ts` 는 세 진입점(`content.ts`·`page/main.ts`·`popup/popup.ts`)에서 임포트를 따라가며
`stripTypeScriptTypes` 로 타입만 지우고, 임포트 주소를 각 파일이 놓인 자리로 고쳐 씁니다.
파일이 1:1 로 남아서 개발자 도구에서 본 위치가 저장소의 위치와 같습니다 — 실행 서버가
`.ts` 를 그대로 내보내는 것과 같은 방식입니다(AI_TESSVM.md 의 `src/node/server.ts`).

```
packages/tessvm/src/web/boot.ts   →  dist/vendor/tessvm/web/boot.js
packages/{core,parser,compiler,decompiler}/…
                                  →  dist/vendor/tess/<패키지>/…
packages/extension/src/page/…     →  dist/page/…
packages/extension/src/content.ts →  dist/content.js  (의존성까지 이어 붙인 클래식 스크립트)
pixi.js                           →  dist/vendor/pixi.mjs        (pixi.min.mjs)
chevrotain                        →  dist/vendor/chevrotain.mjs  (chevrotain.min.mjs)
```

`@tess/<패키지>` 같은 맨 이름은 그 패키지의 `index.ts` 로, `chevrotain`·`pixi.js` 는
vendor 의 esm 묶음으로 고쳐 씁니다. 확장이 파서·컴파일러·디컴파일러를 싣게 되면서
그 세 패키지에서 노드에 매인 부분을 갈라 냈습니다(AI_README.md).

- `@tess/compiler` 는 파일을 `CompilerHost`(`resolve`·`isFile`·`readFile`·`readText`)
  로만 읽습니다. 패키지 진입점이 노드 구현을 끼워 주고, 브라우저는 아무것도 없는
  기본 구현을 씁니다 — `use` 도 파일에서 재는 크기도 쓰지 않으니 그것으로 충분합니다.
- `@tess/decompiler` 의 `.ent` 읽기와 엔트리 기본 모양 찾기는 `src/node.ts` 로 나갔고,
  나머지는 `Uint8Array` 와 `TextDecoder` 만 씁니다.
- `@tess/parser` 의 코드 프레임은 `@babel/code-frame` 대신 `src/parser/frame.ts` 로
  직접 그립니다.

빌드가 끝나기 전에 세 가지를 확인합니다. 셋 다 **설치할 때가 아니라 쓸 때** 조용히
터지는 것들이라 빌드에서 잡습니다.

| 검사            | 무엇을 막나                                                         |
| --------------- | ------------------------------------------------------------------- |
| `new Function`  | 내용 스크립트에 모듈 문법이 남아 아무 줄도 실행되지 않는 것         |
| `checkLinks`    | 고쳐 쓴 임포트 주소가 없는 파일을 가리키는 것                       |
| `checkManifest` | 매니페스트가 없는 파일을 가리키는 것 (파이어폭스는 설치를 거부한다) |

번역 파일(`_locales`)은 두지 않습니다. 문구가 하나뿐이라 `default_locale` 을 두면
얻는 것 없이 "폴더를 읽을 수 있어야 설치된다" 는 조건만 늘어납니다.

### 브라우저마다 다른 묶음

`browser_specific_settings.gecko` 는 파이어폭스의 키입니다. 크롬은 모르는 키이고
웹스토어는 올릴 때 매니페스트를 검사하므로, 빌드가 **같은 파일 위에 매니페스트만 바꿔
가며** 두 번 묶습니다.

| 파일                          | 매니페스트                        |
| ----------------------------- | --------------------------------- |
| `tessvm-extension.zip`        | `browser_specific_settings` 있음  |
| `tessvm-extension-chrome.zip` | 그 키를 뺀 것                     |

`dist/` 에는 크롬 쪽이 남습니다 — 압축해제 상태로 로드하는 것이 크롬이기 때문입니다.

**웹스토어에 올리는 것은 zip 입니다. crx 는 올릴 수 없습니다** — 웹스토어가 zip 을 받아
자기 키로 서명해 crx 를 만들어 배포합니다. crx 는 스토어를 거치지 않고 직접 나눠 줄 때만
씁니다.

`--crx` 를 주면 `pack.ts` 가 CRX3 로 묶습니다.

```
"Cr24" · 버전 3 · 헤더 길이 · CrxFileHeader(protobuf) · zip
```

서명은 `"CRX3 SignedData\0"` + 헤더 길이(LE 4바이트) + `signed_header_data` + zip 전체를
RSA PKCS#1 v1.5 SHA-256 으로 서명한 값입니다. 헤더에 쓰는 필드가 전부 길이 붙은
바이트열이라 protobuf 라이브러리 없이 varint 몇 줄로 씁니다. **확장 id 는 공개키의
SHA-256 앞 16바이트**이므로 `crx-key.pem` 을 잃으면 id 가 바뀝니다 — 키는 처음 한 번만
만들고 그대로 둡니다(`.gitignore` 에 있습니다).

### `fileurl` 은 믿지 않는다

모양·소리 주소는 작품 데이터 안에 들어 있어서 **작성자가 아무 데나 겨눌 수 있습니다.**
남의 호스트를 적어 두면 그 작품을 연 사람의 브라우저가 그리로 요청을 보내고, 같은
출처를 적어 두면 그 사람의 쿠키가 함께 갑니다.

그래서 `entry-project.ts` 는 `fileurl` 이 **playentry 와 같은 출처일 때만** 그대로 쓰고,
아니면 엔트리가 하는 것처럼 `filename` 으로 주소를 다시 만듭니다. `filename` 도 경로의
일부가 되므로 영숫자만 받고, 소리의 `ext` 도 마찬가지입니다.

## 7. 확인한 것

실제 playentry 작품(`무한의계단` 77개 오브젝트, `감옥탈출` 167개·글상자 13개)을 엔트리
서버의 에셋 그대로 돌려 확인했습니다.

- 60fps 로 정확히 60틱, 못 도는 블록 없음(AI 블록 셋은 건너뜀), 실행 중 오류 없음
- 그림·소리 주소 모두 200, 글상자가 엔트리 웹폰트로 그려짐
- 시작·일시정지·이어서 하기·정지, 좌표 표시, 부스트 스위치, 오류 줄 동작
- 마운트 지점이 엔트리 iframe 과 같은 자리·같은 크기(792×495), 페이지 레이아웃 변화 없음

빌드된 `dist/content.js` 자체도 브라우저가 읽는 방식 그대로 — 클래식 스크립트로, 확장
API 만 흉내 낸 채 — 작품 페이지와 같은 모양의 문서에 걸어 확인했습니다.

- 엔트리 실행기(`/iframe/…`) 요청 **0건**, 프레임은 `about:blank` 에 `visibility: hidden`
- 끄면 원래 주소가 돌아오고 그때 처음 요청이 나감, 다시 켜면 도로 비워지고 실행기가 붙음

자동화된 클릭에는 사용자 제스처가 없어 `requestFullscreen` 이 거부되므로, 전체화면만
손으로 확인해야 합니다(`document.fullscreenEnabled` 는 참). 파이어폭스는 이 환경에
설치되어 있지 않아 직접 띄워 보지 못했습니다.
