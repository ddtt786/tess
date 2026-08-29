// ============================================================================
//  tess — 엔트리 작품으로 컴파일되는 텍스트 언어
//
//  라이브러리:  import { parse, compileProject } from 'tess'
//  CLI:
//    node index.js check examples/tour.tess
//    node index.js build examples/all_blocks.tess -o build/blocks.ent
//    node index.js build examples/all_blocks.tess -o build/project.json
// ============================================================================
export {
  parse,
  parseOrThrow,
  check,
  validate,
} from "./src/parse.js";
export { compileProject, createCompileCache } from "./src/compiler/index.js";
export { makeEntryBundle, makeTar } from "./src/compiler/bundle.js";
export { verifyEntryProject } from "./src/compiler/verify.js";
export { serveProject } from "./src/player/server.js";
export { decompileEnt, decompileProject } from "./src/decompiler/index.js";
export * as builtins from "./src/builtins.js";

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { parse } from "./src/parse.js";
import { compileProject, createCompileCache } from "./src/compiler/index.js";
import { makeEntryBundle } from "./src/compiler/bundle.js";
import { serveProject } from "./src/player/server.js";

const USAGE = `사용법
  node index.js check      <파일.tess>          문법 · 의미 검사 (컴파일까지 해 본다)
  node index.js build      <파일.tess> [-o 출력] 엔트리 작품으로 컴파일
  node index.js run        <파일.tess>          컴파일해서 브라우저로 열기
  node index.js ast        <파일.tess>          AST 출력
  node index.js decompile  <파일.ent> [-o 폴더]  이미 있는 엔트리 작품을 Tess 소스로 되돌리기

옵션
  -o, --out <경로>   출력 파일/폴더. build 는 확장자가 .json 이면 project.json,
                     .ent 이면 tar 묶음(temp/project.json)으로 저장한다.
                     decompile 은 폴더를 만들어 main.tess 와 에셋을 담는다
                     (기본값: <파일 이름>_tess/).
  --assets <폴더>    모양·소리 파일을 찾을 폴더 (여러 번 쓸 수 있음)
  --name <이름>      작품 이름 (기본값: project 의 title)
  --port <번호>      run 이 쓸 포트 (기본값: 2013, 쓰이고 있으면 비어 있는 포트)
  --no-open          run 할 때 브라우저를 자동으로 열지 않는다
  --no-reload        run 할 때 소스가 바뀌어도 자동으로 새로고침하지 않는다
  --boost            run 을 부스트 모드(WebGL 렌더러)로 띄운다. 엔트리 만들기 화면
                     에서는 켤 수 없지만 실행기 자체는 이 모드로 돌 수 있다. 디버그
                     패널의 '부스트 모드' 는 그대로 남는다 — 켜고 끈 두 경우를
                     따로 흉내내 볼 수 있어야 하기 때문이다. build 에는 없는 옵션
                     이다 (컴파일한 작품은 실행하는 쪽이 정한다)
  --force            컴파일 에러가 있어도 build/run 을 끝까지 밀어붙인다. 에러가 난
                     문장은 빠진 채로 나오니, 남은 부분만 확인하고 싶을 때만 쓰세요
                     (문법 에러는 작품을 만들 수조차 없어서 --force 도 소용없습니다)
  --warnings         decompile 이 옮기지 못한 부분을 콘솔에도 알려준다 (기본은 결과
                     소스에 '# [decompile]' 주석으로만 남기고 콘솔은 개수만 보여준다)
  --sizes            decompile 이 모든 모양에 'size 가로 세로' 를 적어 둔다. 기본은
                     컴파일러가 그림 파일에서 직접 재게 두고 생략한다 (글상자의
                     'size 가로 세로' 는 이 옵션과 상관없이 항상 적는다)
  --keep-svg         decompile 이 SVG 모양을 SVG 그대로 가져온다. 기본은 엔트리가
                     저장할 때 같이 남긴 PNG 를 대신 쓴다 — 엔트리 벡터 그림판은
                     저장한 뒤 SVG 를 다시 가운데로 옮겨 버려서, 그림판 크기를 넘는
                     그림을 맞춰 놓은 위치가 SVG 에는 남지 않기 때문이다
  --fold-index       리스트·글자 순번의 상수를 미리 계산한다 (예: 되돌릴 때
                     '기록[(3 - 1)]' 대신 '기록[2]', 컴파일할 때 '(2 + 1)' 대신 '3').
                     기본은 접지 않아서 적어 둔 숫자가 그대로 보인다`;

function report(label, diagnostics, kind) {
  for (const item of diagnostics) {
    const where =
      item.file && item.file !== label ? path.basename(item.file) : label;
    console.error(
      `${where}:${item.line}:${item.column}  ${kind}: ${item.message}`,
    );
    if (item.detail) console.error(item.detail);
  }
}

// 한글·한자는 터미널에서 두 칸을 차지한다. 글자 수로 맞추면 칸이 어긋난다.
const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹯＀-｠￠-￦]/;
const displayWidth = (text) =>
  [...text].reduce((width, ch) => width + (WIDE.test(ch) ? 2 : 1), 0);

/**
 * 단계마다 걸린 시간을 찍는다.
 *
 * @param {Array<{label: string, ms: number}>} timings
 * @param {Array<{label: string, ms: number}>} [extra] 컴파일 밖에서 잰 단계
 */
function reportTimings(timings = [], extra = []) {
  const rows = [...timings, ...extra, null];
  if (rows.length === 1) return;

  const total = timings.concat(extra).reduce((sum, row) => sum + row.ms, 0);
  const width = Math.max(...rows.map((row) => displayWidth(row?.label ?? "합계")));
  console.log("  단계별 시간");
  for (const row of rows) {
    const { label, ms } = row ?? { label: "합계", ms: total };
    const pad = " ".repeat(width - displayWidth(label));
    console.log(`    ${label}${pad}  ${ms.toFixed(0).padStart(5)} ms`);
  }
}

function parseArgs(argv) {
  const options = { assets: [] };
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-o" || arg === "--out") options.out = argv[++i];
    else if (arg === "--assets") options.assets.push(argv[++i]);
    else if (arg === "--name") options.name = argv[++i];
    else if (arg === "--port") options.port = Number(argv[++i]);
    else if (arg === "--no-open") options.noOpen = true;
    else if (arg === "--no-reload") options.noReload = true;
    else if (arg === "--boost") options.boost = true;
    else if (arg === "--warnings") options.warnings = true;
    else if (arg === "--sizes") options.sizes = true;
    else if (arg === "--keep-svg") options.keepSvg = true;
    else if (arg === "--fold-index") options.foldIndex = true;
    else if (arg === "--force") options.force = true;
    else rest.push(arg);
  }
  return { options, rest };
}

/** build 와 똑같이 끝까지 컴파일해 보고 결과만 버린다. use 로 불러오는 파일까지 검사된다. */
function runCheck(file, options = { assets: [] }) {
  const source = fs.readFileSync(file, "utf-8");
  const label = path.basename(file);
  const assetDirs =
    options.assets?.length > 0
      ? options.assets.map((dir) => path.resolve(dir))
      : [path.dirname(path.resolve(file))];

  const result = compileProject(source, {
    path: file,
    assetDirs,
    name: options.name,
    cache: options.cache,
    foldIndex: options.foldIndex,
  });
  report(label, result.errors, "에러");
  report(label, result.warnings, "경고");
  if (result.ok) console.log(`${label}: OK`);
  return result.ok ? 0 : 1;
}

function runAst(file) {
  const source = fs.readFileSync(file, "utf-8");
  const result = parse(source);
  if (!result.ok) {
    report(path.basename(file), result.errors, "에러");
    return 1;
  }
  console.log(JSON.stringify(result.ast, null, 2));
  return 0;
}

async function runBuild(file, options) {
  const source = fs.readFileSync(file, "utf-8");
  const label = path.basename(file);
  const assetDirs =
    options.assets.length > 0
      ? options.assets.map((dir) => path.resolve(dir))
      : [path.dirname(path.resolve(file))];

  const result = compileProject(source, {
    path: file,
    assetDirs,
    name: options.name,
    force: options.force,
    cache: options.cache,
    foldIndex: options.foldIndex,
  });
  report(label, result.warnings, "경고");
  if (!result.ok) {
    report(label, result.errors, "에러");
    // 문법 에러면 작품 자체가 없으므로(project 가 null) --force 로도 내보낼 게 없다
    if (!options.force || !result.project) return 1;
    console.error(
      `${label}: --force — 에러 ${result.errors.length}개를 무시하고 그대로 내보냅니다.`,
    );
  }

  const out = options.out ?? `${file.replace(/\.tess$/, "")}.ent`;
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });

  const startedWrite = performance.now();
  if (out.endsWith(".json")) {
    fs.writeFileSync(out, JSON.stringify(result.project, null, 2));
  } else {
    fs.writeFileSync(out, await makeEntryBundle(result.project, result.assets));
  }
  const writeMs = performance.now() - startedWrite;

  const { project } = result;
  const blocks = project.objects.reduce(
    (sum, o) => sum + countBlocks(JSON.parse(o.script)),
    0,
  );
  console.log(
    `${label} -> ${out}\n` +
      `  장면 ${project.scenes.length} · 오브젝트 ${project.objects.length} · ` +
      `변수 ${project.variables.length} · 신호 ${project.messages.length} · ` +
      `함수 ${project.functions.length} · 블록 ${blocks}`,
  );
  reportTimings(result.timings, [
    { label: out.endsWith(".json") ? "파일 쓰기" : "묶기 · 파일 쓰기", ms: writeMs },
  ]);
  return 0;
}

/** 컴파일해서 브라우저에서 열어 본다 */
async function runProject(file, options) {
  const source = fs.readFileSync(file, "utf-8");
  const label = path.basename(file);
  const assetDirs =
    options.assets.length > 0
      ? options.assets.map((dir) => path.resolve(dir))
      : [path.dirname(path.resolve(file))];

  const result = compileProject(source, {
    path: file,
    assetDirs,
    name: options.name,
    force: options.force,
    cache: options.cache,
    foldIndex: options.foldIndex,
  });
  report(label, result.warnings, "경고");
  if (!result.ok) {
    report(label, result.errors, "에러");
    if (!options.force || !result.project) return 1;
    console.error(
      `${label}: --force — 에러 ${result.errors.length}개를 무시하고 그대로 실행합니다.`,
    );
  }

  const reload = !options.noReload;
  const startedServer = performance.now();
  const server = await serveProject({
    project: result.project,
    assets: result.assets,
    assetDirs,
    name: result.project.name,
    port: options.port,
    cwd: path.dirname(path.resolve(file)),
    reload,
    sourceMap: result.sourceMap,
    boost: options.boost,
  });

  const serverMs = performance.now() - startedServer;

  console.log(`${label} -> ${server.url}`);
  console.log(`  실행기: ${server.runtime}`);
  if (options.boost) console.log("  부스트 모드: 켜짐 (WebGL 렌더러)");
  console.log(
    `  자동 새로고침: ${reload ? "켜짐 (--no-reload 로 끌 수 있습니다)" : "꺼짐"}`,
  );
  reportTimings(result.timings, [{ label: "서버 준비", ms: serverMs }]);
  console.log("  Ctrl+C 로 끕니다.");
  if (!options.noOpen) openBrowser(server.url);

  const stopWatching = reload
    ? watchAndReload(file, options, assetDirs, label, server)
    : null;

  process.on("SIGINT", () => {
    stopWatching?.();
    // 서버가 어떤 이유로든 안 닫히면(예: 소켓이 안 끊김) Ctrl+C 가 먹통이 된
    // 것처럼 보이니, 잠깐 기다려도 안 끝나면 그냥 강제로 끝낸다.
    const forceExit = setTimeout(() => process.exit(0), 2000);
    forceExit.unref();
    server.close().then(() => process.exit(0));
  });
  return null; // 서버가 떠 있는 동안 프로세스를 유지한다
}

/**
 * 소스와 리소스 폴더를 지켜보다가 바뀌면 다시 컴파일해서 서버에 반영한다.
 *
 * Rebuilds share one compile cache, so an edit only re-parses the files it
 * touched — the rest of the `use` graph is reused from the previous build.
 */
function watchAndReload(file, options, assetDirs, label, server) {
  const watchDirs = new Set([path.dirname(path.resolve(file)), ...assetDirs]);
  const cache = options.cache ?? createCompileCache();
  let timer = null;

  const rebuild = () => {
    try {
      const source = fs.readFileSync(file, "utf-8");
      const before = cache.parsed;
      const started = Date.now();
      const result = compileProject(source, {
        path: file,
        assetDirs,
        name: options.name,
        force: options.force,
        cache,
        foldIndex: options.foldIndex,
      });
      report(label, result.warnings, "경고");
      if (!result.ok) {
        report(label, result.errors, "에러");
        if (!options.force || !result.project) {
          console.error(
            `${label}: 다시 불러오기 실패 — 이전 버전을 계속 보여줍니다.`,
          );
          return;
        }
        console.error(
          `${label}: --force — 에러 ${result.errors.length}개를 무시하고 그대로 반영합니다.`,
        );
      }
      server.update({
        project: result.project,
        assets: result.assets,
        sourceMap: result.sourceMap,
      });
      const parsed = cache.parsed - before;
      console.log(
        `${label}: 변경 사항을 반영했습니다.` +
          ` (파일 ${parsed}개 다시 컴파일 · ${Date.now() - started}ms)`,
      );
      reportTimings(result.timings);
    } catch (error) {
      console.error(`${label}: 다시 불러오기 실패 — ${error.message}`);
    }
  };

  const onChange = () => {
    clearTimeout(timer);
    timer = setTimeout(rebuild, 150);
  };

  // Object fragments live under objects/<scene>/, so a non-recursive watch never
  // fires for the files that are edited most.
  const watchers = [];
  for (const dir of watchDirs) {
    try {
      watchers.push(fs.watch(dir, { recursive: true }, onChange));
    } catch {
      try {
        watchers.push(fs.watch(dir, onChange)); // where recursive is unsupported
      } catch {
        // 폴더를 지켜볼 수 없어도 (예: 없는 폴더) 조용히 넘어간다
      }
    }
  }
  return () => {
    clearTimeout(timer);
    watchers.forEach((watcher) => watcher.close());
  };
}

/** 웹 브라우저로 열기 (열 수 없으면 조용히 넘어간다) */
function openBrowser(url) {
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "start"
        : "xdg-open";
  try {
    const child = spawn(command, [url], {
      stdio: "ignore",
      detached: true,
      shell: process.platform === "win32",
    });
    child.on("error", () => {});
    child.unref();
  } catch {
    // 브라우저를 못 열어도 주소를 찍어 뒀으니 괜찮다
  }
}

function countBlocks(node) {
  if (Array.isArray(node))
    return node.reduce((sum, item) => sum + countBlocks(item), 0);
  if (!node || typeof node !== "object" || !node.type) return 0;
  return (
    1 + countBlocks(node.params ?? []) + countBlocks(node.statements ?? [])
  );
}

/** 이미 있는 .ent(엔트리 작품)를 Tess 소스로 되돌린다 */
async function runDecompile(file, options) {
  const { decompileEnt } = await import("./src/decompiler/index.js");
  const label = path.basename(file);
  const bytes = fs.readFileSync(file);

  let result;
  try {
    result = await decompileEnt(bytes, {
      sizes: options.sizes,
      foldIndex: options.foldIndex,
      keepSvg: options.keepSvg,
    });
  } catch (error) {
    console.error(`${label}: 되돌리기 실패 — ${error.message}`);
    return 1;
  }

  const outDir = options.out ?? `${file.replace(/\.ent$/i, "")}_tess`;
  fs.mkdirSync(outDir, { recursive: true });
  const mainFile = path.join(outDir, "main.tess");
  fs.writeFileSync(mainFile, result.source);
  for (const asset of result.assets) {
    const target = path.join(outDir, asset.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, asset.data);
  }

  const fragmentCount = result.assets.filter((asset) =>
    asset.path.endsWith(".tess"),
  ).length;
  console.log(`${label} -> ${mainFile}`);
  console.log(
    `  오브젝트 조각 파일 ${fragmentCount}개, 에셋(모양·소리) ${result.assets.length - fragmentCount}개 옮김`,
  );

  if (result.warnings.length > 0) {
    console.log(`  주의 ${result.warnings.length}개`);
    if (options.warnings) {
      for (const warning of result.warnings.slice(0, 20))
        console.log(`    - ${warning}`);
      if (result.warnings.length > 20)
        console.log(`    ... 그 외 ${result.warnings.length - 20}개`);
    } else {
      console.log(`  자세한 내용은 --warnings 옵션을 붙여서 다시 실행하세요.`);
    }
  }

  try {
    const recheck = compileProject(result.source, {
      path: mainFile,
      assetDirs: [outDir],
    });
    console.log(
      recheck.ok
        ? "  되돌린 소스가 다시 정상적으로 컴파일됩니다."
        : `  참고: 되돌린 소스에 아직 컴파일 에러가 ${recheck.errors.length}개 있습니다 — node index.js check ${mainFile} 로 자세히 보세요.`,
    );
  } catch {
    // 다시 컴파일해 보는 건 참고용이라, 실패해도 결과물은 그대로 둔다
  }
  return 0;
}

async function main(argv) {
  const { options, rest } = parseArgs(argv);
  // One cache for the whole run: files shared by several inputs are parsed once,
  // and `run` keeps reusing it for every rebuild.
  options.cache = createCompileCache();
  const [first, ...others] = rest;
  const commands = {
    check: runCheck,
    build: runBuild,
    run: runProject,
    ast: runAst,
    decompile: runDecompile,
  };

  const command = commands[first] ? first : "check";
  const files = commands[first] ? others : rest;

  if (files.length === 0) {
    console.error(USAGE);
    process.exit(2);
  }

  // .ent(엔트리 작품)를 decompile 이 아닌 명령에 잘못 넣거나, 반대로 .tess 를
  // decompile 에 넣는 실수는 아리송한 파싱 에러 대신 바로 알려 준다.
  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    if (command !== "decompile" && ext === ".ent") {
      console.error(
        `${path.basename(file)}: .ent 파일은 Tess 소스가 아니라 엔트리 작품입니다.` +
          ` 'node index.js decompile ${file}' 로 Tess 소스로 되돌려 보세요.`,
      );
      process.exit(2);
    }
    if (command === "decompile" && ext === ".tess") {
      console.error(
        `${path.basename(file)}: decompile 은 .ent(엔트리 작품) 파일을 받습니다.` +
          " Tess 소스를 엔트리 작품으로 만들려면 build 를 쓰세요.",
      );
      process.exit(2);
    }
  }

  let failed = 0;
  let keepAlive = false;
  for (const file of files) {
    const code = await commands[command](file, options);
    if (code === null) keepAlive = true;
    else failed |= code;
  }
  if (!keepAlive) process.exit(failed ? 1 : 0);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main(process.argv.slice(2));
}
