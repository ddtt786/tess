# Tess — VS Code 확장

`.tess` 파일에 언어 서버를 붙입니다. 오류·경고, 자동 완성, 이동, 이름 바꾸기,
개요, 접기, 들여쓰기 정리가 컴파일러와 같은 판정으로 동작합니다.

## 만들기

저장소 루트에서 한 번, 이 폴더에서 한 번 설치한 뒤 빌드합니다.

```bash
pnpm install                 # 저장소 루트에서
cd editors/vscode
npm install
npm run build                # out/extension.cjs, out/server.cjs 를 만듭니다
```

## 설치

```bash
# macOS / Linux
ln -s "$(pwd)" ~/.vscode/extensions/tess-lang

# Windows (PowerShell)
New-Item -ItemType Junction -Path $env:USERPROFILE\.vscode\extensions\tess-lang -Target (Get-Location)
```

`.vsix` 로 묶으려면:

```bash
npm run package
code --install-extension tess-lang-2.0.0.vsix
```

## 확인

`.tess` 파일을 열었을 때 오른쪽 아래에 **Tess** 라고 보이면 적용된 것입니다.
안 보이면 `Ctrl+Shift+P` → `Change Language Mode` → `Tess` 를 고르세요.
서버가 멈춘 것 같으면 `Ctrl+Shift+P` → `Tess: 언어 서버 다시 시작`.

## 검사

```bash
npm test
```

## 문법 강조 파일 다시 만들기

TextMate 문법은 언어 서버가 뜨기 전 첫 화면에만 쓰입니다. 키워드를 더했다면
다시 만들어 주세요.

```bash
node build-grammar.mjs
```
