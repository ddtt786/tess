# tessvm 확장 프로그램

playentry.org 에서 작품을 실행할 때 실행기를 [tessvm](../../AI/AI_TESSVM.md) 으로 바꿉니다.

```bash
pnpm install
pnpm build:extension     # dist/chrome · dist/firefox
```

- **크롬** — `chrome://extensions` → 개발자 모드 → *압축해제된 확장 프로그램을 로드* →
  `packages/extension/dist/chrome`
- **파이어폭스** — `about:debugging#/runtime/this-firefox` → *임시 부가 기능 로드* →
  `packages/extension/dist/firefox/manifest.json`

도구 모음 아이콘을 눌러 켜고 끕니다. 끄면 엔트리 실행기를 그대로 씁니다.

작품에 `$tessvm` 이라는 이름의 변수를 만들어 두면, tessvm 으로 실행할 때 그 값이 1 이
됩니다. 엔트리 실행기로 실행하면 작품이 적어 둔 값 그대로입니다.

Tess 로 쓴다면 이렇게 만듭니다.

```
var tessvm as "$tessvm" = 0
```
