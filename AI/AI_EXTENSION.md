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

응답은 `project.json` 과 사실상 같아서 `Vm.load()` 에 그대로 넣습니다. `objects[].script`
는 JSON 문자열인데 `Codegen` 이 문자열도 받으므로 손댈 것이 없습니다. Tess 로
디컴파일했다가 다시 컴파일할 이유도 없습니다 — 그 왕복은 `.ent` 파일을 열 때
`@tess/decompiler` 가 하는 일이고(AI_TESSVM.md 1장), 여기서는 이미 엔트리 작품 형식입니다.

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

## 5. tessvm 에 더한 것

확장이 필요로 해서 넣었고, 실행 페이지의 동작은 그대로입니다.

| 자리                        | 내용                                                         |
| --------------------------- | ------------------------------------------------------------ |
| `BootOptions.keyTarget`     | 키를 읽을 대상. 기본값은 `window`                            |
| `TessVmHandle.dispose()`    | 프레임 루프·리스너·캔버스·오디오를 놓는다                    |
| `PixiRenderer.destroy()`    | WebGL 컨텍스트와 캔버스를 놓는다                             |
| `WebAudioEngine.close()`    | 오디오 컨텍스트를 닫는다 (브라우저가 몇 개까지만 허용)       |

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
packages/extension/src/page/…     →  dist/page/…
packages/extension/src/content.ts →  dist/content.js  (의존성까지 이어 붙인 클래식 스크립트)
pixi.js                           →  dist/vendor/pixi.mjs   (pixi.min.mjs, 소스맵 주석 제거)
```

빌드가 끝나기 전에 세 가지를 확인합니다. 셋 다 **설치할 때가 아니라 쓸 때** 조용히
터지는 것들이라 빌드에서 잡습니다.

| 검사            | 무엇을 막나                                                         |
| --------------- | ------------------------------------------------------------------- |
| `new Function`  | 내용 스크립트에 모듈 문법이 남아 아무 줄도 실행되지 않는 것         |
| `checkLinks`    | 고쳐 쓴 임포트 주소가 없는 파일을 가리키는 것                       |
| `checkManifest` | 매니페스트가 없는 파일을 가리키는 것 (파이어폭스는 설치를 거부한다) |

번역 파일(`_locales`)은 두지 않습니다. 문구가 하나뿐이라 `default_locale` 을 두면
얻는 것 없이 "폴더를 읽을 수 있어야 설치된다" 는 조건만 늘어납니다.

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
