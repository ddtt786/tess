# 확장 프로그램 — 작품 실행 페이지의 실행기를 tessvm 으로 바꾼다

`packages/extension` 은 크롬과 파이어폭스에서 도는 확장 프로그램입니다. **작품을 실행하는
페이지** — `playentry.org/project/<id>` 와 그것의 전체 화면·삽입 화면 — 에서 **엔트리
실행기 대신 tessvm** 이 그 작품을 돌립니다. 돌릴 것은 페이지가 들고 있는 엔트리 작품을
**Tess 소스로 되돌린 뒤 다시 컴파일한 것**이며, 작품에 `$tessvm` 변수가 있으면 실행 직전에
1 로 둡니다.

**만들기(작업실) 페이지는 건드리지 않습니다.** 거기서는 실행기가 편집의 일부이기 때문입니다
— 도는 블록이 하이라이트되고, 디버거가 그 위를 따라가고, 멈추면 그 자리가 보입니다.
`Entry.type` 이 `workspace` 이거나 주소가 `/ws` 아래이면 엔트리 실행기를 그대로 둡니다
(실행 화면은 `minimize`·`invisible`·`phone`·`mobile` 입니다).

```bash
pnpm build:extension              # dist/chrome · dist/firefox 를 만든다
node packages/extension/build.ts --dev     # 압축하지 않고 소스맵을 넣는다
node packages/extension/build.ts --watch   # src 를 지켜보며 다시 만든다
```

## 1. 무엇이 무엇을 실행하는가

```
Entry.loadProject 이 받은 작품(project.json)
      │                            ← 실행 페이지의 작품은 이것이 곧 최종본이다
      ▼
@tess/decompiler ──▶ main.tess + objects/*.tess
      ▼
@tess/compiler   ──▶ 엔트리 작품
      ▼
주소 되돌리기 · $tessvm 표시
      ▼
tessvm(JIT → PixiJS) ──▶ 엔트리 캔버스 위에 얹은 무대
```

tessvm 이 아는 것은 Tess 뿐입니다(`AI_TESSVM.md` 1절). `tessvm run game.ent` 가 `.ent` 를
Tess 로 되돌린 뒤 실행하는 것과 확장 프로그램이 하는 일은 같은 길이며, 다른 것은 작품이
파일이 아니라 **페이지에서 온 객체**라는 점뿐입니다. 그래서 디스크가 필요한 자리 — 조각
파일 읽기, 리소스 파일 재기 — 를 전부 메모리로 바꿨습니다.

| 파일                          | 역할                                                        |
| ----------------------------- | ----------------------------------------------------------- |
| `src/content.ts`              | 페이지에 실행기를 심고 설정을 건네는 콘텐츠 스크립트        |
| `src/page/index.ts`           | 페이지 안에서 도는 실행기 본체                              |
| `src/page/entry-hook.ts`      | 엔트리 실행기를 가로채는 자리                               |
| `src/page/pipeline.ts`        | 엔트리 작품 → Tess → 엔트리 작품, `$tessvm` 표시            |
| `src/page/assets.ts`          | 모양·소리 주소를 사이트의 파일로 되돌리기                   |
| `src/page/runner.ts`          | tessvm 인스턴스의 수명 관리                                 |
| `src/page/overlay.ts`         | 엔트리 캔버스 위에 얹는 무대와 상태 표시                    |
| `src/background.ts`           | 설정 기본값 · 도구 모음 배지 · CSP 규칙 켜고 끄기           |
| `src/popup/*`                 | 켜고 끄는 팝업                                              |
| `src/shims/*`                 | `node:fs`·`node:path`·`Buffer`·`tar`·`sharp` 의 브라우저 대역 |
| `bundle.ts` · `build.ts`      | esbuild 설정과 두 브라우저용 묶기                           |
| `manifest.ts` · `icon.ts`     | 매니페스트와 아이콘 생성                                    |

## 2. 세 개의 세계

확장 프로그램의 코드는 서로 다른 세 곳에서 돕니다. 어느 것이 어디에 있어야 하는지는
고를 수 있는 문제가 아닙니다.

| 코드                | 어디에서                 | 왜 거기여야 하는가                                             |
| ------------------- | ------------------------ | -------------------------------------------------------------- |
| `content.js`        | 격리된 세계              | 확장 API(`storage`)를 쓸 수 있는 유일한 곳                     |

| `page.js`           | 페이지 자신의 세계       | `Entry` 는 페이지 전역이고, JIT 은 `new Function` 을 쓴다      |
| `background.js`     | 서비스 워커 · 이벤트 페이지 | 탭과 무관한 설정·배지·네트워크 규칙                          |

페이지 세계에서는 `chrome.storage` 를 볼 수 없으므로, 설정은 `window.postMessage` 로
건너갑니다(`src/common/protocol.ts`). 콘텐츠 스크립트는 `document_start` 에 `page.js` 를
`<script src>` 로 꽂고, 저장소를 읽은 뒤 설정을 보냅니다 — 저장소 읽기는 비동기라
그것을 기다리면 entryjs 보다 늦기 때문입니다. 실행 화면이 프레임 안에 들어가는 경우가
있어 모든 프레임에 꽂습니다(`all_frames`); 실행기는 `Entry` 를 찾은 곳에서만 움직입니다.

메시지는 `event.source` 가 이 창이고 `event.origin` 이 이 페이지의 출처일 때만 받습니다.
작품이 띄운 프레임에서 온 메시지는 그 자리에서 버려집니다.

## 3. 엔트리 실행기를 가로채는 한 자리

엔트리의 페이지·단추·상태 기계는 그대로 두고, **블록을 실제로 실행하는 부분만** 뺏습니다.
엔트리에서 스크립트가 시작되는 길은 시작 단추·키·마우스·신호·복제본까지 전부 하나로
모입니다.

```js
Entry.engine.fireEvent          ──┐
Entry.engine.fireEventWithValue ──┤
Entry.engine.fireEventOnEntity  ──┼──▶ Entry.container.mapEntityIncludeCloneOnScene
Entry.engine.raiseMessage       ──┤        └─▶ entity.parent.script.raiseEvent(...)
Entry.engine.captureKeyEvent    ──┘
```

그래서 tessvm 이 실행을 맡는 동안 `mapEntityIncludeCloneOnScene` 하나만 빈 배열을
돌려주게 하면, 엔트리 쪽 스크립트는 **한 줄도 시작되지 않습니다.** 감싸는 것은 이것과
`toggleRun`·`toggleStop`·`togglePause`·`loadProject` 다섯 개뿐이고, 그 밖의 entryjs 는
손대지 않습니다.

- `toggleRun` — 소유 표시를 세운 뒤 원본을 부릅니다. 엔트리의 상태와 단추는 평소대로
  바뀌고, 스크립트만 돌지 않습니다. 돌릴 작품은 `loadProject` 가 받아 둔 그것입니다 —
  실행 페이지에서는 그것이 곧 최종본이고, `exportProject` 는 편집기의 상태를 필요로 하며
  지나가는 길에 엔진까지 멈추므로 늦게 붙었을 때의 대비책으로만 씁니다.
- `toggleStop` — 소유를 내려놓고 원본을 부릅니다. 엔트리가 스냅숏으로 오브젝트와 변수를
  되돌리므로 무대가 처음 상태로 돌아옵니다.
- `togglePause` — 원본을 부른 뒤 `engine.state` 를 보고 tessvm 을 멈추거나 잇습니다.
- `loadProject` — 돌릴 작품을 받아 두고, 만들어 둔 tessvm 을 버립니다.

### 실행 조작은 tessvm 의 것이다

시작·일시정지·정지는 tessvm 이 전부 지원하므로(`vm.start`·`vm.pause`·`vm.stop`), 무대
왼쪽 위 배지를 눌러 열리는 판에 그 세 단추를 둡니다. **누르면 tessvm 을 먼저 움직이고**,
그다음에 엔트리의 상태 기계를 같은 자리로 옮겨 사이트의 단추가 반대를 가리키지 않게
합니다 — 반대 방향은 없습니다. 그 되돌림 중에는 표시를 세워, 우리가 움직인 단추가
우리에게 다시 돌아오지 않게 합니다.

엔트리 자신의 시작·정지 단추도 그대로 살아 있습니다. 둘 중 무엇을 눌러도 같은 곳에
닿습니다.

`Entry` 는 `window` 에 프로퍼티를 걸어 두고 기다립니다 — entryjs 가 자기 전역을 올려놓는
순간 붙습니다. 프로퍼티를 다시 정의할 수 없는 페이지(전역 변수로 선언된 경우)를 위해
0.1 초 주기 검사도 함께 돌며, 이것이 엔트리가 나중에 갈아 끼우는 `engine` 도 다시
잡아 줍니다. 같은 함수를 두 번 감싸지 않도록 표시를 남깁니다.

### 되돌려주기

tessvm 이 작품을 준비하지 못하면(뒤의 CSP, 지원하지 않는 작품) 소유를 내려놓고
`Entry.engine.fireEvent('start')` 를 한 번 불러 줍니다. `toggleRun` 이 부른 `start` 는
이미 우리가 막은 뒤라, 이 한 번이 없으면 작품이 그대로 멈춰 있습니다. 이때 화면에 남는
알림은 배경이 없고 클릭도 통과시켜서, 그 아래에서 엔트리 실행기가 정상적으로 보입니다.

## 4. 디스크 없이 컴파일하기

디컴파일러는 오브젝트마다 `objects/<이름>.tess` 조각을 만들고 `main.tess` 에서 `use` 로
불러오게 씁니다. 브라우저에는 그 파일들을 둘 곳이 없으므로, 조각을 경로를 키로 하는
표에 담고 컴파일러의 `readFile` 옵션으로 건네줍니다.

```ts
const decompiled = decompileProject(work, [], {});      // 리소스 바이트는 주지 않는다
const fragments = new Map<string, string>();            // '/tessvm/objects/고양이.tess' → 소스
const compiled = compileProject(decompiled.source, {
  path: '/tessvm/main.tess',
  assetDirs: [],                                        // 디스크를 뒤지지 않는다
  readFile: (target) => fragments.get(target) ?? throwMissing(target),
});
```

`assetDirs: []` 로 두면 컴파일러가 파일을 찾지 않고, 디컴파일러가 적어 둔 `size 가로 세로`
와 `for 초` 를 그대로 씁니다. 리소스 바이트를 주지 않는 것도 같은 이유입니다 — 원본
작품의 `dimension` 과 `duration` 이 실제 값이고, 파일에서 다시 잴 이유가 없습니다.

`node:fs` 는 "파일이 없다" 고만 답하는 대역으로 바꿉니다. 그래서 디컴파일러가 설치된
entryjs 를 찾는 자리(`findLocalRuntime`)도 자연히 빈손이 되고, 엔트리 기본 오브젝트의
모양은 원래 주소를 그대로 지닌 채 넘어갑니다 — 그것이 다음 절이 필요한 이유입니다.

## 5. 모양·소리 주소 — 컴파일러가 새로 지은 것을 되돌린다

컴파일러는 리소스마다 `temp/<앞2>/<다음2>/image/<32자>.png` 주소를 **새로 짓습니다.** Tess
소스에서 빌드한 작품은 자기 파일을 함께 들고 다니므로 그것이 맞지만, 사이트에서 읽은
작품의 파일은 이미 playentry.org 에 있습니다. 그래서 다시 컴파일한 작품의 주소를 원본이
쓰던 주소로 되돌립니다(`src/page/assets.ts`).

주소를 짓는 규칙은 entryjs 가 파일을 찾는 규칙 그대로입니다.

```
모양  fileurl ?? `${Entry.defaultPath}/uploads/<앞2>/<다음2>/image/<이름>.<png|svg>`
소리  fileurl ?? `${Entry.defaultPath}/uploads/<앞2>/<다음2>/${Entry.soundPath}<이름><확장자>`
```

`Entry.defaultPath` · `Entry.soundPath` · `Entry.mediaFilePath` 는 박아 두지 않고 페이지에서
읽습니다 — 사이트가 파일을 어디에 두는지 바꾸면 그 값도 함께 바뀝니다.

- **`fileurl` 이 없는 작품이 많습니다.** playentry.org 는 `filename` 만 내려주고 주소는
  실행기가 만들어 냅니다. 되돌릴 주소를 원본의 `fileurl` 에서만 찾으면 안 되는 이유입니다.
- **옛 번들 경로는 옮깁니다.** `./bower_components/entryjs/images/_1x1.png` 처럼 예전
  배포 경로를 가리키는 작품은 `Entry.mediaFilePath` 아래로 옮겨 지금 사이트가 서비스하는
  파일을 가리키게 합니다.
- **짝은 자리로 찾습니다.** 디컴파일러와 컴파일러 모두 오브젝트와 모양의 순서를
  지키므로 같은 자리끼리 맞춥니다. 수가 다르면 이름으로 찾고, 그래도 없으면 그 리소스만
  건너뜁니다.

## 6. `$tessvm`

작품이 지금 어느 실행기 위에 있는지 스스로 알 수 있게, **`$tessvm` 이라는 이름의 변수가
있으면** tessvm 에 넘기기 직전에 값을 1 로 둡니다. 없으면 아무것도 하지 않습니다.

엔트리에서는 그 이름으로 변수를 하나 만들면 되고, Tess 에서는 이름을 따로 붙입니다 —
`$` 는 Tess 식별자에 쓸 수 없기 때문입니다.

```
var tessvm as "$tessvm" = 0
```

- 페이지가 들고 있는 작품이 아니라 **넘겨줄 사본**만 바꿉니다. 확장 프로그램을 끄면
  엔트리 실행기는 작품이 적어 둔 값(보통 0)을 그대로 씁니다.
- 이름이 같아도 리스트는 건드리지 않습니다.
- Tess 를 지나가도 이름이 남습니다. 디컴파일러가 `var tessvm as "$tessvm"` 로 적고,
  컴파일러가 그 이름을 그대로 돌려놓습니다.

## 7. 설정

| 설정        | 기본값  | 하는 일                                                       |
| ----------- | ------- | ------------------------------------------------------------- |
| `enabled`   | 켬      | 끄면 엔트리 실행기를 그대로 쓴다                              |
| `pipeline`  | `tess`  | `direct` 는 작품을 Tess 로 되돌리지 않고 그대로 tessvm 에 준다 |
| `quality`   | 1       | 그리는 배율 (1 · 2 · 4). 무대 크기는 그대로다                 |
| `showStats` | 끔      | 무대 구석에 초당 프레임을 띄운다                              |
| `relaxCsp`  | 끔      | playentry.org 의 CSP 헤더를 지운다 (다음 절)                  |

`chrome.storage.local` 한 곳에 두고, 팝업·배경·콘텐츠 스크립트·페이지가 모두 그것을
봅니다. 무대 왼쪽 위의 배지를 누르면 열리는 판에도 끄는 단추가 있습니다 — 그것도 같은
저장소에 쓰므로 팝업과 어긋나지 않습니다.

## 8. JIT 과 CSP

tessvm 은 블록을 자바스크립트 소스로 만들어 `new Function` 으로 컴파일합니다
(`AI_TESSVM.md` 2절). 페이지의 CSP 가 `unsafe-eval` 을 막고 있으면 이것이 통하지 않습니다.

실행 직전에 `new Function('return 1')` 한 줄로 확인하고, 막혀 있으면 그 사실을 화면에
적고 작품을 엔트리 실행기로 되돌립니다. 팝업의 **CSP 완화** 를 켜면 정적
`declarativeNetRequest` 규칙이 켜지면서 playentry.org 응답의
`content-security-policy` 헤더를 지웁니다.

기본값은 끔입니다. 사이트의 보안 정책을 지우는 것은 그 사이트 전체에 영향을 주는 일이라,
필요한 사람이 필요할 때만 켜도록 두고, 필요해지는 순간 화면이 그것을 알려 줍니다.

## 9. 묶기

한 덩어리로 묶는 이유는 페이지에 꽂은 스크립트가 확장 프로그램 안의 모듈을 다시
가져올 수 없기 때문입니다. 그래서 파서·컴파일러·디컴파일러·tessvm·PixiJS 가 전부
`page.js` 하나에 들어갑니다(압축 후 약 0.95 MB).

명령줄에서만 쓰는 것들은 esbuild 의 `alias` 로 대역을 끼웁니다.

| 원래         | 대역                  | 브라우저에서 어떻게 되는가                       |
| ------------ | --------------------- | ------------------------------------------------ |
| `node:fs`    | `shims/fs.ts`         | 언제나 "파일 없음"                               |
| `node:path`  | `shims/path.ts`       | posix 경로 계산만                                |
| `node:url`   | `shims/url.ts`        | `fileURLToPath` 흉내                             |
| `tar`        | `shims/tar.ts`        | `.ent` 를 풀거나 묶을 일이 없다                  |
| `sharp`      | `shims/sharp.ts`      | 썸네일을 만들 일이 없다                          |
| `@tess/player` | `shims/player.ts`   | 설치된 entryjs 를 찾을 곳이 없다                 |
| `Buffer`     | `shims/buffer.ts`     | 조각 파일을 오가는 `from`·`toString` 만 실제로 쓴다 |

두 브라우저용 파일은 스크립트가 완전히 같고 매니페스트만 다릅니다 — 크롬은 워커를
`service_worker` 로, 파이어폭스는 `scripts` 로 받습니다. 아이콘은 `icon.ts` 가 그립니다
(둥근 사각형과 재생 표시, 4×4 표본으로 가장자리를 부드럽게).

## 10. 검사

브라우저가 없으므로, 확인할 수 있는 것을 확인할 수 있는 자리에서 봅니다.

- `test/pipeline.test.ts` — 저장소의 예제를 컴파일해 "사이트가 들고 있는 작품" 을 만들고
  그것을 되돌립니다. 오브젝트 순서·모양 수·주소·`$tessvm`·**tessvm 이 모르는 블록의
  집합이 왕복 전후로 같은가** 를 봅니다. 마지막 것이 왕복이 아무것도 잃지 않았다는 뜻입니다.
  `examples/ent/*.ent` 가 있으면 실제 작품으로도 같은 검사를 합니다.
- `test/entry-hook.test.ts` — 가짜 `Entry` 로 가로채기를 봅니다. 핵심은 둘입니다:
  tessvm 이 실행을 맡는 동안 엔트리 쪽 스크립트가 하나도 시작되지 않는가(그리고 정지
  뒤에 다시 시작되는가), 그리고 만들기 페이지는 손대지 않는가.
- `test/overlay.test.ts` — 판의 실행 조작이 눌리고, 지금 할 수 없는 것은 눌리지 않는지.
- `test/runner.test.ts` — **실제로 배포되는 번들을 그대로 만들어** jsdom 으로 연
  `playentry.org/project/<id>` 에서 돌립니다. jsdom 에는 WebGL 이 없어 tessvm 이 화면을
  세우다 실패하므로, 넘겨받는 것과 실패했을 때 엔트리로 되돌려주는 것을 한 번에 볼 수
  있습니다. `/ws` 로 열면 넘겨받지 않는 것도 같이 봅니다.

## 11. 지금 하지 못하는 것

- tessvm 이 아직 실행하지 못하는 블록(확장 블록·인공지능 블록 등, `AI_TESSVM.md` 17절)은
  이 길에서도 실행되지 않습니다. 왕복이 그것을 늘리거나 줄이지는 않습니다.
- 디컴파일러가 읽지 못하는 블록이 있는 작품은 Tess 경로에서 걸러집니다. 그때는 작품을
  그대로 tessvm 에 넘기고(`direct`), 왜 그랬는지 무대의 판에 적습니다.
- 하드웨어 블록과 실시간 변수처럼 사이트 서버와 계속 이야기해야 하는 것은 다루지 않습니다.
- playentry.org 의 DOM 이나 entryjs 의 함수 이름이 바뀌면 붙는 자리가 달라집니다. 붙지
  못하면 아무것도 하지 않고 엔트리 실행기가 그대로 돕니다.
