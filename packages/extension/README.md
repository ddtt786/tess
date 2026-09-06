# tessvm for Entry

엔트리 작품 페이지(`playentry.org/project/…`)의 실행기를 tessvm 으로 바꾸는 확장입니다.

```bash
pnpm build:extension     # packages/extension/dist 생성
```

- 크롬: `chrome://extensions` → 개발자 모드 → **압축해제된 확장 프로그램을 로드** → `dist`
- 파이어폭스: `about:debugging#/runtime/this-firefox` → **임시 부가 기능 로드** → `dist/manifest.json`

툴바 아이콘을 눌러 켜고 끕니다.
