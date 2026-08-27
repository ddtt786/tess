# Tess — VS Code 문법 강조

`.tess` 파일에 색을 입힙니다.

- 주석(`#`)과 색상 리터럴(`#ff0000`)을 구분합니다
- 선언(`object`, `function`, `useobject` …), 흐름(`if`, `repeat` …), 이벤트(`when` …),
  명령(`forward`, `say` …), 내장 함수, 상태 값, 오브젝트 속성을 각각 다른 색으로 칠합니다
- `end` 앞에서 들여쓰기가 자동으로 풀리고, `:` · `then` · `do` 뒤에서 들여쓰기가 들어갑니다

## 설치

### 방법 1 — 폴더 복사 (가장 간단)

이 폴더를 VS Code 확장 폴더에 복사하고 VS Code 를 다시 켜면 끝입니다.

```bash
# macOS / Linux
cp -r editors/vscode ~/.vscode/extensions/tess-lang

# Windows (PowerShell)
Copy-Item -Recurse editors\vscode $env:USERPROFILE\.vscode\extensions\tess-lang
```

저장소를 그대로 쓰고 싶으면 복사 대신 링크를 걸어도 됩니다.

```bash
ln -s "$(pwd)/editors/vscode" ~/.vscode/extensions/tess-lang
```

### 방법 2 — .vsix 로 묶어서 설치

```bash
npx @vscode/vsce package          # editors/vscode 안에서 실행
code --install-extension tess-lang-1.0.0.vsix
```

### 확인

`.tess` 파일을 열었을 때 오른쪽 아래에 **Tess** 라고 보이면 적용된 것입니다.
안 보이면 `Ctrl+Shift+P` → `Change Language Mode` → `Tess` 를 고르세요.

## 문법 파일 다시 만들기

키워드 목록은 `src/tess.ohm` 과 `src/builtins.js` 에서 뽑아 씁니다.
언어에 키워드를 더했다면 다시 만들어 주세요.

```bash
node editors/vscode/build-grammar.mjs
```

`pnpm test` 가 이 파일이 최신인지도 함께 확인합니다.
