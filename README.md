# Tess

[Tess](./SPEC.md) 는 엔트리(playentry.org) 작품으로 변환되는 텍스트 프로그래밍 언어입니다.

```bash
git clone https://github.com/ddtt786/tess.git
cd tess
pnpm install
node index.js check examples/tour.tess
node index.js run   examples/all_blocks.tess
node index.js build examples/all_blocks.tess -o blocks.ent
```

## 라이브러리

내장 라이브러리를 활용하여 직접 파싱하거나 빌드할 수 있습니다.

```js
import { parse } from "./index.js";

const result = parse(`
  var score = 0
  scene "main":
    object "cat":
      when key "space" up do
        forward 10
        score += 1
      end
    end
  end
`);

result.ok; // true
result.ast; // { type: 'Program', body: [...] }
result.errors; // [{ line, column, message }]
result.warnings; // [{ line, column, message }]
```

```js
import { parse, compileProject, makeEntryBundle } from "./index.js";

const result = compileProject(source, { path: "main.tess" });
if (result.ok) {
  fs.writeFileSync("game.ent", makeEntryBundle(result.project, result.assets));
}
```
