# painter

**SVG(벡터) 그림판 + 비트맵 그림판**을 한 패키지로 제공하는 그림판 라이브러리입니다.
두 화면 모두 아래 세 라이브러리 위에 만들어졌습니다.

| 라이브러리 | 담당 |
| --- | --- |
| [perfect-freehand](https://github.com/steveruizok/perfect-freehand) | 브러시/지우개 획의 외곽선 생성 (필압·테이퍼 포함) |
| [SVG.js](https://svgjs.dev/) | 벡터 장면(scene) 생성·조작 |
| [clipper2-ts](https://github.com/countertype/clipper2-ts) | 불리언 연산 — 지우개(차집합), 선→면 변환(offset), 경로 단순화 |

벡터 지우개가 "마스크"가 아니라 진짜로 도형을 잘라내고, 비트맵 → 벡터 변환이 실제 윤곽선 추적으로
동작하는 게 핵심입니다.

---

## 설치

```bash
pnpm add painter
# peer 의존성이 아니라 일반 의존성입니다. 별도 설치 불필요.
```

```ts
import { createPainterUI } from 'painter';
// 스타일은 런타임에 자동 주입됩니다. 번들러로 직접 넣고 싶다면:
// import 'painter/style.css';
```

## 빠른 시작

### 1) 기본 UI까지 한 번에

```ts
import { createPainterUI } from 'painter';

const ui = createPainterUI(document.getElementById('app')!, {
  width: 1920,
  height: 1080,
  mode: 'vector',              // 'vector' | 'bitmap'
  name: '그림1',
  style: { fill: '#2f6df6', stroke: '#17243a', strokeWidth: 8 },
  brush: { size: 22 },
});

ui.painter.on('change', () => console.log(ui.painter.export()));
```

`createPainterUI`가 만드는 화면 구성은 이렇습니다.

```
┌──────────────────────────────────────────────────────┐
│ 이름            [ 벡터 | 비트맵 ]         실행취소 ↶↷ │
├────┬────────────────────────────────┬────────────────┤
│ 도 │                                │  채우기        │
│ 구 │            캔버스              │  선            │
│ 레 │                                │  붓 / 글자     │
│ 일 │                                │  배치 / 편집   │
├────┴────────────────────────────────┴────────────────┤
│ 1920 × 1080   도구·선택   3개 선택됨        − 100% + │
└──────────────────────────────────────────────────────┘
```

UI 문자열은 전부 한국어이고 `labels` 옵션으로 통째로 바꿀 수 있습니다.
레이아웃이 마음에 들지 않으면 `Painter`만 쓰고 UI는 직접 붙이면 됩니다.

### 2) 코어만 사용

```ts
import { Painter } from 'painter';

const painter = new Painter(container, { width: 1920, height: 1080 });

painter.setTool('brush');
painter.setFill('#ff8c1a');
painter.setBrushOptions({ size: 12 });

await painter.convertToBitmap();   // 벡터 → 비트맵
await painter.convertToVector();   // 비트맵 → 벡터(윤곽선 추적)
```

### 3) 한쪽 화면만 사용

```ts
import { VectorPainter, BitmapPainter } from 'painter';

const vector = new VectorPainter(container, { width: 1920, height: 1080 });
const bitmap = new BitmapPainter(container, { width: 1920, height: 1080 });
```

---

## 기능

두 화면 모두 아래 기능을 전부 지원합니다. (`—`는 해당 화면에 개념이 없는 항목)

| 기능 | 벡터 | 비트맵 |
| --- | :---: | :---: |
| 실행 취소 / 다시 실행 | ✅ | ✅ |
| 채우기 색 | ✅ | ✅ |
| 윤곽선 색 · 두께 | ✅ | ✅ (선/도형 두께) |
| 복사 / 붙여넣기 / 삭제 | ✅ | ✅ |
| 좌우 뒤집기 / 상하 뒤집기 | ✅ | ✅ (선택 영역 또는 전체) |
| 그룹 / 그룹 해제 | ✅ | — |
| 앞으로 / 뒤로 / 맨 앞 / 맨 뒤 | ✅ | — |
| 투명(채우기 없음) | ✅ | ✅ (지우는 칠) |
| 확대 / 축소 / 원래 크기 / 맞춤 | ✅ | ✅ |
| 벡터 ↔ 비트맵 변환 | ✅ | ✅ |
| **도구** | 선택, 형태 변경, 붓, 지우개, 채우기, 텍스트, 선, 원, 사각형 | 붓, 선, 원, 사각형, 텍스트, 채우기, 지우개, 선택 |

### 벡터 화면의 동작

- **선택** — 클릭/Shift+클릭/드래그 박스 선택, 이동, 8방향 크기 조절, 회전 핸들.
- **형태 변경(Reshape)** — 경로의 점과 베지어 핸들을 직접 편집합니다. 사각형·원·텍스트를
  선택한 채 이 도구를 켜면 자동으로 경로로 변환됩니다(텍스트는 글자 윤곽선으로).
  세그먼트를 더블클릭하면 점 추가, `Delete`로 점 삭제, 점 더블클릭으로 코너 ↔ 곡선 전환.
- **붓** — perfect-freehand 외곽선을 **채워진 `<path>`** 로 커밋합니다. 획 자체가 편집 가능한 도형입니다.
- **지우개** — 지운 영역을 clipper2 `difference`로 빼냅니다. 채움 영역과 외곽선 영역을 각각
  계산하므로 색이 유지되고, 구멍이 생기면 구멍 그대로 남습니다. 그룹 내부까지 재귀합니다.
- **채우기** — 클릭한 도형의 채움색을 바꿉니다. 외곽선을 클릭하면 외곽선 색, `Alt`+클릭은 스포이드.
  빈 캔버스를 클릭하면 **맨 뒤에 배경 사각형이 하나 생깁니다.** 다른 도형과 똑같은 아이템이라
  되돌리기·지우개·선택이 전부 그대로 먹습니다. 채우기 색이 투명이면 그 배경을 다시 없앱니다.
- **텍스트** — 떠 있는 `<textarea>`로 입력(IME·선택·클립보드 정상 동작)하고 `<text>`/`<tspan>`으로 커밋합니다.

### 비트맵 화면의 동작

- **붓 / 지우개** — 벡터와 동일한 perfect-freehand 실루엣을 캔버스에 채웁니다.
  지우개는 `destination-out`이라 그리는 중에도 결과가 그대로 보입니다.
- **선 / 원 / 사각형** — `Shift` 비율 고정, `Alt` 중심에서 그리기. `outlineShapes`로 채움/외곽선 전환.
- **채우기** — 허용 오차(`fillTolerance`)가 있는 스캔라인 플러드 필. `Alt`+클릭은 스포이드.
- **선택** — 사각형 마퀴 → 떠 있는 선택 영역(floating selection). 드래그 이동, 핸들 크기 조절,
  뒤집기, 복사/붙여넣기/삭제가 가능하고 선택 해제 시 캔버스에 찍힙니다.
- **텍스트** — 입력 후 `fillText`로 픽셀에 확정됩니다.

### 투명

채우기 색은 `null`(투명)일 수 있습니다. 인스펙터의 **투명** 버튼이나 `painter.setFill(null)`로 켭니다.

- 벡터 — 도형이 `fill="none"`이 됩니다.
- 비트맵 — "없는 색으로 칠한다"를 그대로 해석해서 **칠한 만큼 지웁니다**(`destination-out`).
  붓은 지우개가 되고, 채우기 버킷은 영역을 투명하게 만들고, 도형은 미리보기에 점선 윤곽으로 표시됩니다.

### 두 화면 사이의 클립보드

클립보드는 모듈 전역으로 공유됩니다. 벡터에서 복사 → 비트맵에 붙여넣기(래스터화), 비트맵에서
복사 → 벡터에 붙여넣기(`<image>` 요소)가 모두 됩니다.

---

## 단축키

| 키 | 동작 |
| --- | --- |
| `V` `A` `B` `E` `F` `T` `L` `O` `R` | 선택 / 형태 변경 / 붓 / 지우개 / 채우기 / 텍스트 / 선 / 원 / 사각형 |
| `Ctrl/⌘ + Z`, `Ctrl/⌘ + Shift + Z` | 실행 취소 / 다시 실행 |
| `Ctrl/⌘ + C` `X` `V` `D` | 복사 / 잘라내기 / 붙여넣기 / 복제 |
| `Ctrl/⌘ + A` | 모두 선택 |
| `Ctrl/⌘ + G`, `Ctrl/⌘ + Shift + G` | 그룹 / 그룹 해제 (벡터) |
| `Delete` / `Backspace` | 삭제 |
| `Esc` | 진행 중인 동작 취소 / 선택 해제 |
| 방향키 (`Shift`로 10px) | 이동 |
| `Ctrl/⌘ + 휠`, `Ctrl/⌘ + =` / `-` | 확대·축소 |
| `Ctrl/⌘ + 0` / `9` | 실제 크기 / 화면에 맞추기 |
| 그리는 중 `Shift` / `Alt` | 비율·각도 고정 / 중심에서 그리기 |

그림판에 포커스가 있는 동안에는 브라우저 기본 단축키(페이지 확대, 저장, 인쇄 등)를 가로채서
캔버스 동작으로 바꿉니다. `swallowBrowserShortcuts: false`로 끌 수 있습니다.

---

## API

### `Painter` (두 화면을 감싸는 파사드)

```ts
const painter = new Painter(container, options);

painter.mode                  // 'vector' | 'bitmap'
painter.surface               // 현재 살아 있는 VectorPainter | BitmapPainter
painter.vector                // 벡터 모드일 때만 VectorPainter, 아니면 null
painter.bitmap                // 비트맵 모드일 때만 BitmapPainter, 아니면 null

await painter.setMode('bitmap');
await painter.convertToBitmap();
await painter.convertToVector();

painter.setTool('brush');
painter.setFill('#ff0000');
painter.setStroke('#000000');
painter.setStrokeWidth(4);
painter.setBrushOptions({ size: 12, thinning: 0.6 });
painter.setTextStyle({ fontSize: 42, fontFamily: 'Pretendard' });

painter.undo(); painter.redo();
painter.copy(); painter.cut(); await painter.paste(); painter.delete();
painter.selectAll(); painter.deselect();
painter.flipHorizontal(); painter.flipVertical();
painter.group(); painter.ungroup();                       // 벡터 전용
painter.bringForward(); painter.sendBackward();
painter.bringToFront(); painter.sendToBack();
painter.zoomIn(); painter.zoomOut(); painter.resetZoom(); painter.zoomToFit();

painter.export();   // 벡터: SVG 문자열 / 비트맵: PNG data URL
painter.destroy();
```

#### `PainterOptions`

| 옵션 | 기본값 | 설명 |
| --- | --- | --- |
| `width` / `height` | `1920` / `1080` | 캔버스 크기 |
| `mode` | `'vector'` | 시작 화면 |
| `tool` | 모드별 기본값 | 시작 도구 |
| `background` | `null` | 배경색. 벡터에서는 맨 뒤 아이템으로 들어갑니다 |
| `style` | `{ fill: '#2f6df6', stroke: '#17243a', strokeWidth: 4 }` | 초기 페인트 스타일. `fill: null`이면 투명 |
| `brush` | `size: 8`(벡터) / `12`(비트맵) | perfect-freehand 설정 |
| `text` | Helvetica 42px | 텍스트 기본 스타일 |
| `historyLimit` | `60`(벡터) / 자동(비트맵) | 되돌리기 단계 수 |
| `historyBytes` | `192MB` | 비트맵 되돌리기 메모리 예산. 캔버스가 크면 단계 수가 자동으로 줄어듭니다 |
| `swallowBrowserShortcuts` | `true` | 포커스 중 브라우저 단축키(확대·저장·인쇄) 차단 |
| `zoom` | `1` | 초기 배율 |
| `keyboard` | `true` | 컨테이너에 단축키 바인딩 |
| `outlineShapes` | `false` | 비트맵 도형을 외곽선으로 |
| `vectorize` | — | 비트맵 → 벡터 추적 옵션 |
| `rasterScale` | `1` | 벡터 → 비트맵 슈퍼샘플링 |

### 이벤트

```ts
painter.on('change', () => {});                    // 문서가 바뀜(히스토리 1단계 확정)
painter.on('selectionchange', () => {});
painter.on('toolchange', (name) => {});
painter.on('stylechange', () => {});
painter.on('historychange', ({ canUndo, canRedo }) => {});
painter.on('viewchange', ({ zoom }) => {});
painter.on('modechange', (mode) => {});
```

모든 `on()`은 해제 함수를 돌려줍니다.

### `VectorPainter` (추가 API)

```ts
vector.items                       // 최상위 SVG 아이템 배열
vector.selection                   // 선택된 노드 배열
vector.setSelection(nodes);
vector.hitTest(clientX, clientY);  // { item, node, kind: 'fill' | 'stroke' } | null
vector.itemsInRect(rect, contained?);
vector.createPath(d, style?);
vector.addItem(svgElement);
vector.subtractFromItems(rings);   // 지우개가 쓰는 clipper2 차집합
vector.setBackground('#eaf1ff');   // 맨 뒤 배경 사각형 (null이면 제거)
vector.backgroundItem();           // 배경 사각형 | null
vector.convertTextToPath(textNode);
vector.toSVG(); vector.loadSVG(markup);
vector.scene / vector.overlay / vector.draw   // SVG.js 객체
```

### `BitmapPainter` (추가 API)

```ts
bitmap.ctx / bitmap.overlayCtx     // 2D 컨텍스트
bitmap.floating                    // FloatingSelection | null
bitmap.commitFloating();
bitmap.fillTolerance = 0.08;
bitmap.fillContiguous = true;
bitmap.outlineShapes = false;
bitmap.isTransparentPaint;         // 채우기 색이 null이면 true (지우는 칠)
bitmap.usePaint(ctx);              // 현재 색/합성 모드를 컨텍스트에 적용
bitmap.toImageData(); bitmap.toDataURL(); await bitmap.loadImage(src);
```

### 변환 유틸 (단독 사용 가능)

```ts
import { rasterizeSVG, svgToImageData, imageDataToLayers, layersToSVG, traceMask } from 'painter';

const canvas = await rasterizeSVG(svgMarkup, 480, 360, 2);
const layers = imageDataToLayers(imageData, { maxColors: 16, epsilon: 1.2, smooth: true });
const svg = layersToSVG(layers, 480, 360);
```

`traceMask(mask, w, h, epsilon)`는 0/1 마스크의 경계를 따라가며 닫힌 링을 만듭니다.
구멍도 같이 나오므로 `fill-rule: evenodd`로 그리면 됩니다.

### 기하 유틸

```ts
import {
  unionRings, differenceRings, intersectRings, xorRings,
  inflateRings, outlineRings, outlinePolyline, simplifyRings,
  strokeOutline, ringToSmoothPathData, ringToCanvasPath,
  pathDataToCubics, cubicsToPathData, flattenPathData, shapeToPathData,
} from 'painter';
```

### 커스텀 도구 추가

```ts
import type { Tool, PointerInfo } from 'painter';

class StampTool implements Tool {
  readonly name = 'stamp';
  readonly cursor = 'copy';
  constructor(private painter: VectorPainter) {}
  onPointerDown(info: PointerInfo) {
    this.painter.createPath(`M ${info.x} ${info.y} l 20 0 l -10 18 Z`, { fill: '#f00' });
    this.painter.commit();
  }
  onPointerMove() {}
  onPointerUp() {}
}

vector.registerTool(new StampTool(vector));
vector.setTool('stamp' as never);
```

---

## 구현 메모

- **되돌리기** — 벡터는 장면의 SVG 마크업 스냅샷, 비트맵은 `ImageData` 스냅샷입니다.
  중간 상태가 아니라 "확정된 한 동작"마다 `commit()`이 호출됩니다.
- **좌표계** — 벡터는 `viewBox` 사용자 좌표, 비트맵은 캔버스 픽셀. 줌은 프레임의 CSS 크기만 바꾸므로
  히트 테스트와 기하 계산은 배율과 무관합니다.
- **히트 테스트** — `SVGGeometryElement.isPointInFill / isPointInStroke`를 씁니다(변환·그룹 포함).
- **텍스트 윤곽선** — 폰트 파서 없이, 텍스트를 캔버스에 그린 뒤 윤곽선을 추적해서 경로로 만듭니다.
- **배경 탭** — `image.decode()`가 끝나지 않는 환경을 고려해 `load` 이벤트와 경쟁시킵니다.
- **큰 캔버스** — 뷰포트는 `safe center` 정렬이라 많이 확대해도 캔버스 왼쪽/위쪽까지 스크롤이 닿고,
  플렉스 기준 크기를 `0`으로 잡아 확대한 캔버스가 패널을 밀어내지 않습니다.

## 개발

```bash
pnpm install
pnpm dev         # 데모 (vite)
pnpm typecheck
pnpm build       # dist/ (esm + cjs + d.ts + painter.css)
```

## 라이선스

MIT. 번들된 의존성은 각자의 라이선스를 따릅니다(clipper2-ts는 Boost Software License 1.0).
