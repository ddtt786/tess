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
import * as out from "./src/cli/output.js";

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
                     그림을 맞춰 놓은 위치가 SVG 에는 남지 않기 때문이다`;

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
    else if (arg === "--force") options.force = true;
    else rest.push(arg);
  }
  return { options, rest };
}

/** build 와 똑같이 끝까지 컴파일해 보고 결과만 버린다. use 로 불러오는 파일까지 검사된다. */
function runCheck(file, options = { assets: [] }) {
  const source = fs.readFileSync(file, "utf-8");
  const label = path.basename(file);
  const assetDirs = assetDirsFor(file, options);

  out.begin("check", file);
  const result = compileProject(source, {
    path: file,
    assetDirs,
    name: options.name,
    cache: options.cache,
    onPhase: out.step,
  });
  out.report(label, result.errors, "에러");
  out.report(label, result.warnings, "경고");

  if (!result.ok) {
    out.outro(out.red(`${label}: 에러 ${result.errors.length}개`));
    return 1;
  }
  out.outro(`${out.green("OK")}  ${label}`);
  return 0;
}

/** 모양·소리를 찾을 폴더. --assets 가 없으면 소스 파일 옆이다. */
function assetDirsFor(file, options) {
  return options.assets?.length > 0
    ? options.assets.map((dir) => path.resolve(dir))
    : [path.dirname(path.resolve(file))];
}

function runAst(file) {
  const source = fs.readFileSync(file, "utf-8");
  const result = parse(source);
  if (!result.ok) {
    out.report(path.basename(file), result.errors, "에러");
    return 1;
  }
  // AST 는 다른 도구로 넘겨 쓰는 것이라 꾸미지 않고 그대로 낸다.
  console.log(JSON.stringify(result.ast, null, 2));
  return 0;
}

async function runBuild(file, options) {
  const source = fs.readFileSync(file, "utf-8");
  const label = path.basename(file);
  const assetDirs = assetDirsFor(file, options);

  out.begin("build", file);
  const result = compileProject(source, {
    path: file,
    assetDirs,
    name: options.name,
    force: options.force,
    cache: options.cache,
    onPhase: out.step,
  });
  out.report(label, result.warnings, "경고");
  if (!result.ok) {
    out.report(label, result.errors, "에러");
    // 문법 에러면 작품 자체가 없으므로(project 가 null) --force 로도 내보낼 게 없다
    if (!options.force || !result.project) {
      out.outro(out.red(`${label}: 에러 ${result.errors.length}개 — 내보내지 않았습니다`));
      return 1;
    }
    out.log.warn(`--force — 에러 ${result.errors.length}개를 무시하고 그대로 내보냅니다.`);
  }

  const outPath = options.out ?? `${file.replace(/\.tess$/, "")}.ent`;
  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });

  const asJson = outPath.endsWith(".json");
  const spin = out.working(asJson ? "작품 내보내는 중" : "작품 묶는 중 (모양 미리보기까지)");
  try {
    fs.writeFileSync(
      outPath,
      asJson
        ? JSON.stringify(result.project, null, 2)
        : await makeEntryBundle(result.project, result.assets),
    );
  } catch (error) {
    spin.fail(`내보내지 못했습니다: ${error.message}`);
    out.outro(out.red(`${label}: 실패`));
    return 1;
  }
  spin.done(asJson ? "파일 쓰기" : "묶기 · 파일 쓰기");

  const { project } = result;
  const blocks = project.objects.reduce(
    (sum, o) => sum + countBlocks(JSON.parse(o.script)),
    0,
  );
  out.note(
    out.details([
      ["장면", project.scenes.length],
      ["오브젝트", project.objects.length],
      ["변수", project.variables.length],
      ["신호", project.messages.length],
      ["함수", project.functions.length],
      ["블록", blocks],
    ]),
    "요약",
  );
  out.outro(`${out.green("완료")}  ${label} ${out.dim("->")} ${outPath}`);
  return 0;
}

/** 컴파일해서 브라우저에서 열어 본다 */
async function runProject(file, options) {
  const source = fs.readFileSync(file, "utf-8");
  const label = path.basename(file);
  const assetDirs = assetDirsFor(file, options);

  out.begin("run", file);
  const result = compileProject(source, {
    path: file,
    assetDirs,
    name: options.name,
    force: options.force,
    cache: options.cache,
    onPhase: out.step,
  });
  out.report(label, result.warnings, "경고");
  if (!result.ok) {
    out.report(label, result.errors, "에러");
    if (!options.force || !result.project) {
      out.outro(out.red(`${label}: 에러 ${result.errors.length}개 — 실행하지 않았습니다`));
      return 1;
    }
    out.log.warn(`--force — 에러 ${result.errors.length}개를 무시하고 그대로 실행합니다.`);
  }

  const reload = !options.noReload;
  const spin = out.working("서버 여는 중");
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

  spin.done("서버 준비");

  const rows = [
    ["주소", out.cyan(server.url)],
    ["실행기", server.runtime],
    ["새로고침", reload ? "켜짐  " + out.dim("--no-reload 로 끌 수 있습니다") : "꺼짐"],
  ];
  if (options.boost) rows.push(["부스트", "켜짐  " + out.dim("WebGL 렌더러")]);
  out.note(out.details(rows), "실행 중");

  out.outro(out.dim("Ctrl+C 로 끕니다."));
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
      });
      out.report(label, result.warnings, "경고");
      if (!result.ok) {
        out.report(label, result.errors, "에러");
        if (!options.force || !result.project) {
          out.log.warn("다시 불러오기 실패 — 이전 버전을 계속 보여줍니다.");
          return;
        }
        out.log.warn(`--force — 에러 ${result.errors.length}개를 무시하고 그대로 반영합니다.`);
      }
      server.update({
        project: result.project,
        assets: result.assets,
        sourceMap: result.sourceMap,
      });
      const parsed = cache.parsed - before;
      out.log.success(
        `${out.green("다시 불러왔습니다")}  ` +
          out.dim(`파일 ${parsed}개 · ${out.duration(Date.now() - started)}`),
      );
    } catch (error) {
      out.log.error(`다시 불러오기 실패 — ${error.message}`);
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

  out.begin("decompile", file);
  const reading = out.working("작품 읽는 중");
  let result;
  try {
    result = await decompileEnt(bytes, {
      sizes: options.sizes,
      keepSvg: options.keepSvg,
    });
  } catch (error) {
    reading.fail(`되돌리기 실패 — ${error.message}`);
    out.outro(out.red(`${label}: 실패`));
    return 1;
  }
  reading.done("작품 읽기");

  const outDir = options.out ?? `${file.replace(/\.ent$/i, "")}_tess`;
  const writing = out.working("소스와 에셋 쓰는 중");
  fs.mkdirSync(outDir, { recursive: true });
  const mainFile = path.join(outDir, "main.tess");
  fs.writeFileSync(mainFile, result.source);
  for (const asset of result.assets) {
    const target = path.join(outDir, asset.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, asset.data);
  }
  writing.done("파일 쓰기");

  const fragmentCount = result.assets.filter((asset) =>
    asset.path.endsWith(".tess"),
  ).length;

  const rows = [
    ["오브젝트 조각", `${fragmentCount}개`],
    ["모양 · 소리", `${result.assets.length - fragmentCount}개`],
  ];
  if (result.warnings.length > 0) {
    rows.push(["주의", out.yellow(`${result.warnings.length}개`)]);
  }
  out.note(out.details(rows), "요약");

  if (result.warnings.length > 0) {
    if (options.warnings) {
      const shown = result.warnings.slice(0, 20);
      const more = result.warnings.length - shown.length;
      out.log.warn(
        [...shown, ...(more > 0 ? [out.dim(`… 외 ${more}개`)] : [])].join("\n"),
      );
    } else {
      out.log.info(out.dim("--warnings 를 붙이면 옮기지 못한 부분을 자세히 보여줍니다."));
    }
  }

  // 되돌린 소스가 실제로 다시 컴파일되는지 확인해 준다 (참고용)
  try {
    const recheck = compileProject(result.source, {
      path: mainFile,
      assetDirs: [outDir],
    });
    if (recheck.ok) out.log.success("되돌린 소스가 다시 정상적으로 컴파일됩니다.");
    else {
      out.log.warn(
        `되돌린 소스에 아직 컴파일 에러가 ${recheck.errors.length}개 있습니다.\n` +
          out.dim(`node index.js check ${mainFile}`),
      );
    }
  } catch {
    // 다시 컴파일해 보는 건 참고용이라, 실패해도 결과물은 그대로 둔다
  }

  out.outro(`${out.green("완료")}  ${label} ${out.dim("->")} ${mainFile}`);
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
