/**
 * @fileoverview Tess 언어를 처리하는 커맨드 라인 인터페이스(CLI) 도구입니다.
 *
 * 엔트리 작품을 컴파일하거나, 구문 오류를 검사하고, 서버를 열어 테스트하는 등 다양한 명령을 지원합니다.
 *
 * @example
 * // 문법 및 의미 검사 (컴파일 테스트 포함)
 * node index.ts check examples/tour.tess
 *
 * // 엔트리 작품으로 컴파일하여 출력
 * node index.ts build examples/all_blocks.tess -o build/blocks.ent
 * node index.ts build examples/all_blocks.tess -o build/project.json
 */
export { parse, parseOrThrow, check, validate } from "@tess/parser";
export {
  compileProject,
  createCompileCache,
  makeEntryBundle,
  makeTar,
  verifyEntryProject,
} from "@tess/compiler";
export { serveProject } from "@tess/player";
export { decompileEnt, decompileProject } from "@tess/decompiler";
export * as builtins from "@tess/core/builtins";

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import type {
  CompileCache,
  CompileOptions,
  EntryProject,
} from "@tess/compiler";
import type { RunningServer } from "@tess/player";

/** Everything the command line can set. */
interface CliOptions {
  assets: string[];
  out?: string;
  name?: string;
  port?: number;
  noOpen?: boolean;
  noReload?: boolean;
  boost?: boolean;
  warnings?: boolean;
  sizes?: boolean;
  keepSvg?: boolean;
  force?: boolean;
  /** Shared between rebuilds so a watch only re-parses what changed. */
  cache?: CompileCache;
}
import { spawn } from "node:child_process";
import { parse } from "@tess/parser";
import {
  compileProject,
  createCompileCache,
  makeEntryBundle,
} from "@tess/compiler";
import { serveProject } from "@tess/player";
import * as out from "./src/output.ts";

const USAGE = `사용법
  node index.ts check      <파일.tess>          문법 및 의미 검사 (컴파일 테스트 포함)
  node index.ts build      <파일.tess> [-o 출력] 엔트리 작품으로 컴파일
  node index.ts run        <파일.tess>          컴파일 후 브라우저에서 실행
  node index.ts ast        <파일.tess>          AST 구조 출력
  node index.ts decompile  <파일.ent> [-o 폴더]  기존 엔트리 작품을 Tess 소스로 디컴파일

옵션
  -o, --out <경로>   출력 파일 또는 폴더를 지정합니다.
                     - build 명령 시: 확장자가 .json이면 project.json으로,
                       .ent이면 tar 묶음으로 저장합니다.
                     - decompile 명령 시: 폴더를 생성하여 main.tess와 에셋을 저장합니다.
                       (기본값: <파일 이름>_tess/)
  --assets <폴더>    모양 및 소리 파일을 검색할 폴더를 지정합니다. (여러 번 지정 가능)
  --name <이름>      작품 이름을 지정합니다. (기본값: project 블록의 title)
  --port <번호>      run 명령 시 사용할 포트 번호를 지정합니다.
                     (기본값: 2013, 사용 중인 경우 빈 포트 자동 할당)
  --no-open          run 명령 시 브라우저를 자동으로 열지 않도록 설정합니다.
  --no-reload        run 명령 시 소스가 변경되어도 자동 새로고침을 하지 않습니다.
  --boost            run 명령 시 부스트 모드(WebGL 렌더러)를 활성화합니다.
                     (참고: build 명령에는 적용되지 않습니다.)
  --force            컴파일 에러가 발생해도 중단하지 않고 build/run을 진행합니다.
                     에러가 발생한 문장은 제외하고 결과물이 생성됩니다.
                     단, 문법 오류가 발생한 경우에는 작동하지 않습니다.
  --warnings         decompile 명령 시 변환하지 못한 부분을 콘솔에 출력하여 알려줍니다.
                     (기본적으로는 소스 내에 '# [decompile]' 주석으로만 남깁니다.)
  --sizes            decompile 명령 시 모든 모양(costume)에 'size 가로 세로' 속성을 명시합니다.
                     (기본적으로 글상자를 제외한 모양 크기는 이미지 파일 자체의 크기를 따릅니다.)
  --keep-svg         decompile 명령 시 SVG 모양을 PNG로 대체하지 않고 원본 그대로 유지합니다.`;

function parseArgs(argv: string[]) {
  const options: CliOptions = { assets: [] };
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-o" || arg === "--out") options.out = argv[++i];
    else if (arg === "--assets") options.assets.push(argv[++i]!);
    else if (arg === "--name") options.name = argv[++i];
    else if (arg === "--port") options.port = Number(argv[++i]);
    else if (arg === "--no-open") options.noOpen = true;
    else if (arg === "--no-reload") options.noReload = true;
    else if (arg === "--boost") options.boost = true;
    else if (arg === "--warnings") options.warnings = true;
    else if (arg === "--sizes") options.sizes = true;
    else if (arg === "--keep-svg") options.keepSvg = true;
    else if (arg === "--force") options.force = true;
    else rest.push(arg!);
  }
  return { options, rest };
}

/** build 와 똑같이 끝까지 컴파일해 보고 결과만 버린다. use 로 불러오는 파일까지 검사된다. */
function runCheck(file: string, options: CliOptions = { assets: [] }): number {
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
function assetDirsFor(file: string, options: CliOptions): string[] {
  return (options.assets?.length ?? 0) > 0
    ? options.assets.map((dir) => path.resolve(dir))
    : [path.dirname(path.resolve(file))];
}

function runAst(file: string): number {
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

async function runBuild(file: string, options: CliOptions): Promise<number> {
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
      out.outro(
        out.red(
          `${label}: 에러 ${result.errors.length}개 — 내보내지 않았습니다`,
        ),
      );
      return 1;
    }
    out.log.warn(
      `--force — 에러 ${result.errors.length}개를 무시하고 그대로 내보냅니다.`,
    );
  }

  const outPath = options.out ?? `${file.replace(/\.tess$/, "")}.ent`;
  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });

  const asJson = outPath.endsWith(".json");
  const spin = out.working(
    asJson ? "작품 내보내는 중" : "작품 묶는 중 (모양 미리보기까지)",
  );
  try {
    fs.writeFileSync(
      outPath,
      asJson
        ? JSON.stringify(result.project, null, 2)
        : await makeEntryBundle(result.project!, result.assets),
    );
  } catch (error) {
    spin.fail(`내보내지 못했습니다: ${(error as Error).message}`);
    out.outro(out.red(`${label}: 실패`));
    return 1;
  }
  spin.done(asJson ? "파일 쓰기" : "묶기 · 파일 쓰기");

  const project = result.project!;
  const blocks = project.objects.reduce(
    (sum: number, o) => sum + countBlocks(JSON.parse(o.script)),
    0,
  );
  out.note(
    out.details([
      ["장면", String(project.scenes.length)],
      ["오브젝트", String(project.objects.length)],
      ["변수", String(project.variables.length)],
      ["신호", String(project.messages.length)],
      ["함수", String(project.functions.length)],
      ["블록", String(blocks)],
    ]),
    "요약",
  );
  out.outro(`${out.green("완료")}  ${label} ${out.dim("->")} ${outPath}`);
  return 0;
}

/** 컴파일해서 브라우저에서 열어 본다 */
async function runProject(
  file: string,
  options: CliOptions,
): Promise<number | null> {
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
      out.outro(
        out.red(
          `${label}: 에러 ${result.errors.length}개 — 실행하지 않았습니다`,
        ),
      );
      return 1;
    }
    out.log.warn(
      `--force — 에러 ${result.errors.length}개를 무시하고 그대로 실행합니다.`,
    );
  }

  const reload = !options.noReload;
  const spin = out.working("서버 여는 중");
  const server = await serveProject({
    project: result.project!,
    assets: result.assets,
    assetDirs,
    name: result.project!.name,
    port: options.port,
    cwd: path.dirname(path.resolve(file)),
    reload,
    sourceMap: result.sourceMap,
    boost: options.boost,
  });

  spin.done("서버 준비");

  const rows: Array<[string, string]> = [
    ["주소", out.cyan(server.url)],
    ["실행기", server.runtime],
    [
      "새로고침",
      reload ? "켜짐  " + out.dim("--no-reload 로 끌 수 있습니다") : "꺼짐",
    ],
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
function watchAndReload(
  file: string,
  options: CliOptions,
  assetDirs: string[],
  label: string,
  server: RunningServer,
) {
  const watchDirs = new Set([path.dirname(path.resolve(file)), ...assetDirs]);
  const cache = options.cache ?? createCompileCache();
  let timer: NodeJS.Timeout | null = null;

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
        out.log.warn(
          `--force — 에러 ${result.errors.length}개를 무시하고 그대로 반영합니다.`,
        );
      }
      // The guard above returned for every case that leaves `project` unset.
      server.update({
        project: result.project!,
        assets: result.assets,
        sourceMap: result.sourceMap,
      });
      const parsed = cache.parsed - before;
      out.log.success(
        `${out.green("다시 불러왔습니다")}  ` +
          out.dim(`파일 ${parsed}개 · ${out.duration(Date.now() - started)}`),
      );
    } catch (error) {
      out.log.error(`다시 불러오기 실패 — ${(error as Error).message}`);
    }
  };

  const onChange = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(rebuild, 150);
  };

  // Object fragments live under objects/<scene>/, so a non-recursive watch never
  // fires for the files that are edited most.
  const watchers: fs.FSWatcher[] = [];
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
    if (timer) clearTimeout(timer);
    watchers.forEach((watcher) => watcher.close());
  };
}

/** 웹 브라우저로 열기 (열 수 없으면 조용히 넘어간다) */
function openBrowser(url: string) {
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

function countBlocks(node: any): number {
  if (Array.isArray(node))
    return node.reduce((sum, item) => sum + countBlocks(item), 0);
  if (!node || typeof node !== "object" || !node.type) return 0;
  return (
    1 + countBlocks(node.params ?? []) + countBlocks(node.statements ?? [])
  );
}

/** 이미 있는 .ent(엔트리 작품)를 Tess 소스로 되돌린다 */
async function runDecompile(
  file: string,
  options: CliOptions,
): Promise<number> {
  const { decompileEnt } = await import("@tess/decompiler");
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
    reading.fail(`되돌리기 실패 — ${(error as Error).message}`);
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

  const rows: Array<[string, string]> = [
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
      out.log.info(
        out.dim("--warnings 를 붙이면 옮기지 못한 부분을 자세히 보여줍니다."),
      );
    }
  }

  // 되돌린 소스가 실제로 다시 컴파일되는지 확인해 준다 (참고용)
  try {
    const recheck = compileProject(result.source, {
      path: mainFile,
      assetDirs: [outDir],
    });
    if (recheck.ok)
      out.log.success("되돌린 소스가 다시 정상적으로 컴파일됩니다.");
    else {
      out.log.warn(
        `되돌린 소스에 아직 컴파일 에러가 ${recheck.errors.length}개 있습니다.\n` +
          out.dim(`node index.ts check ${mainFile}`),
      );
    }
  } catch {
    // 다시 컴파일해 보는 건 참고용이라, 실패해도 결과물은 그대로 둔다
  }

  out.outro(`${out.green("완료")}  ${label} ${out.dim("->")} ${mainFile}`);
  return 0;
}

async function main(argv: string[]): Promise<number | null> {
  const { options, rest } = parseArgs(argv);
  // One cache for the whole run: files shared by several inputs are parsed once,
  // and `run` keeps reusing it for every rebuild.
  options.cache = createCompileCache();
  const [first, ...others] = rest;
  const commands: Record<
    string,
    (
      file: string,
      options: CliOptions,
    ) => number | null | Promise<number | null>
  > = {
    check: runCheck,
    build: runBuild,
    run: runProject,
    ast: runAst,
    decompile: runDecompile,
  };

  const command = first && commands[first] ? first : "check";
  const files = first && commands[first] ? others : rest;

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
          ` 'node index.ts decompile ${file}' 로 Tess 소스로 되돌려 보세요.`,
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
    const code = await commands[command]!(file, options);
    if (code === null) keepAlive = true;
    else failed |= code;
  }
  if (!keepAlive) process.exit(failed ? 1 : 0);
  return null;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main(process.argv.slice(2));
}
