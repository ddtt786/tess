// ============================================================================
//  tess — text-based language that compiles to Entry projects.
//
//  Library:  import { parse, compileProject } from 'tess'
//  CLI:
//    node index.js check examples/tour.tess
//    node index.js build examples/all_blocks.tess -o build/blocks.ent
//    node index.js build examples/all_blocks.tess -o build/project.json
// ============================================================================
export { parse, parseOrThrow, check, trace, grammar, semantics, validate } from './src/parse.js';
export { grammarSource } from './src/grammar.js';
export { compileProject } from './src/compiler/index.js';
export { makeEntryBundle, makeTar } from './src/compiler/bundle.js';
export { verifyEntryProject } from './src/compiler/verify.js';
export { serveProject } from './src/player/server.js';
export { decompileEnt, decompileProject } from './src/decompiler/index.js';
export * as builtins from './src/builtins.js';

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { parse } from './src/parse.js';
import { compileProject } from './src/compiler/index.js';
import { makeEntryBundle } from './src/compiler/bundle.js';
import { serveProject } from './src/player/server.js';

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
  --port <번호>      run 이 쓸 포트 (기본값: 비어 있는 포트)
  --no-open          run 할 때 브라우저를 자동으로 열지 않는다
  --no-reload        run 할 때 소스가 바뀌어도 자동으로 새로고침하지 않는다
  --force            컴파일 에러가 있어도 build/run 을 끝까지 밀어붙인다. 에러가 난
                     문장은 빠진 채로 나오니, 남은 부분만 확인하고 싶을 때만 쓰세요
                     (문법 에러는 작품을 만들 수조차 없어서 --force 도 소용없습니다)
  --warnings         decompile 이 옮기지 못한 부분을 콘솔에도 알려준다 (기본은 결과
                     소스에 '# [decompile]' 주석으로만 남기고 콘솔은 개수만 보여준다)`;

function report(label, diagnostics, kind) {
  for (const item of diagnostics) {
    const where = item.file && item.file !== label ? path.basename(item.file) : label;
    console.error(`${where}:${item.line}:${item.column}  ${kind}: ${item.message}`);
    if (item.detail) console.error(item.detail);
  }
}

function parseArgs(argv) {
  const options = { assets: [] };
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-o' || arg === '--out') options.out = argv[++i];
    else if (arg === '--assets') options.assets.push(argv[++i]);
    else if (arg === '--name') options.name = argv[++i];
    else if (arg === '--port') options.port = Number(argv[++i]);
    else if (arg === '--no-open') options.noOpen = true;
    else if (arg === '--no-reload') options.noReload = true;
    else if (arg === '--warnings') options.warnings = true;
    else if (arg === '--force') options.force = true;
    else rest.push(arg);
  }
  return { options, rest };
}

/** Compiles fully like build but discards the output; also checks files pulled in via `use`. */
function runCheck(file, options = { assets: [] }) {
  const source = fs.readFileSync(file, 'utf-8');
  const label = path.basename(file);
  const assetDirs = options.assets?.length > 0
    ? options.assets.map((dir) => path.resolve(dir))
    : [path.dirname(path.resolve(file))];

  const result = compileProject(source, { path: file, assetDirs, name: options.name });
  report(label, result.errors, '에러');
  report(label, result.warnings, '경고');
  if (result.ok) console.log(`${label}: OK`);
  return result.ok ? 0 : 1;
}

function runAst(file) {
  const source = fs.readFileSync(file, 'utf-8');
  const result = parse(source);
  if (!result.ok) {
    report(path.basename(file), result.errors, '에러');
    return 1;
  }
  console.log(JSON.stringify(result.ast, null, 2));
  return 0;
}

function runBuild(file, options) {
  const source = fs.readFileSync(file, 'utf-8');
  const label = path.basename(file);
  const assetDirs = options.assets.length > 0
    ? options.assets.map((dir) => path.resolve(dir))
    : [path.dirname(path.resolve(file))];

  const result = compileProject(source, { path: file, assetDirs, name: options.name, force: options.force });
  report(label, result.warnings, '경고');
  if (!result.ok) {
    report(label, result.errors, '에러');
    // A grammar error leaves no project (null), so --force has nothing to emit.
    if (!options.force || !result.project) return 1;
    console.error(`${label}: --force — 에러 ${result.errors.length}개를 무시하고 그대로 내보냅니다.`);
  }

  const out = options.out ?? `${file.replace(/\.tess$/, '')}.ent`;
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });

  if (out.endsWith('.json')) {
    fs.writeFileSync(out, JSON.stringify(result.project, null, 2));
  } else {
    fs.writeFileSync(out, makeEntryBundle(result.project, result.assets));
  }

  const { project } = result;
  const blocks = project.objects.reduce((sum, o) => sum + countBlocks(JSON.parse(o.script)), 0);
  console.log(
    `${label} -> ${out}\n`
    + `  장면 ${project.scenes.length} · 오브젝트 ${project.objects.length} · `
    + `변수 ${project.variables.length} · 신호 ${project.messages.length} · `
    + `함수 ${project.functions.length} · 블록 ${blocks}`,
  );
  return 0;
}

/** Compiles and opens the result in a browser. */
async function runProject(file, options) {
  const source = fs.readFileSync(file, 'utf-8');
  const label = path.basename(file);
  const assetDirs = options.assets.length > 0
    ? options.assets.map((dir) => path.resolve(dir))
    : [path.dirname(path.resolve(file))];

  const result = compileProject(source, { path: file, assetDirs, name: options.name, force: options.force });
  report(label, result.warnings, '경고');
  if (!result.ok) {
    report(label, result.errors, '에러');
    if (!options.force || !result.project) return 1;
    console.error(`${label}: --force — 에러 ${result.errors.length}개를 무시하고 그대로 실행합니다.`);
  }

  const bundle = makeEntryBundle(result.project, result.assets);
  const reload = !options.noReload;
  const server = await serveProject({
    project: result.project,
    bundle,
    assets: result.assets,
    name: result.project.name,
    port: options.port,
    cwd: path.dirname(path.resolve(file)),
    reload,
    sourceMap: result.sourceMap,
  });

  console.log(`${label} -> ${server.url}`);
  console.log(`  실행기: ${server.runtime}`);
  console.log(`  자동 새로고침: ${reload ? '켜짐 (--no-reload 로 끌 수 있습니다)' : '꺼짐'}`);
  console.log('  Ctrl+C 로 끕니다.');
  if (!options.noOpen) openBrowser(server.url);

  const stopWatching = reload ? watchAndReload(file, options, assetDirs, label, server) : null;

  process.on('SIGINT', () => {
    stopWatching?.();
    // Force-exit if the server doesn't close in time (e.g. a lingering socket).
    const forceExit = setTimeout(() => process.exit(0), 2000);
    forceExit.unref();
    server.close().then(() => process.exit(0));
  });
  return null; // Keep the process alive while the server is running.
}

/** Watches the source and asset directories and recompiles into the running server on change. */
function watchAndReload(file, options, assetDirs, label, server) {
  const watchDirs = new Set([path.dirname(path.resolve(file)), ...assetDirs]);
  let timer = null;

  const rebuild = () => {
    try {
      const source = fs.readFileSync(file, 'utf-8');
      const result = compileProject(source, { path: file, assetDirs, name: options.name, force: options.force });
      report(label, result.warnings, '경고');
      if (!result.ok) {
        report(label, result.errors, '에러');
        if (!options.force || !result.project) {
          console.error(`${label}: 다시 불러오기 실패 — 이전 버전을 계속 보여줍니다.`);
          return;
        }
        console.error(`${label}: --force — 에러 ${result.errors.length}개를 무시하고 그대로 반영합니다.`);
      }
      const nextBundle = makeEntryBundle(result.project, result.assets);
      server.update({
        project: result.project, bundle: nextBundle, assets: result.assets, sourceMap: result.sourceMap,
      });
      console.log(`${label}: 변경 사항을 반영했습니다.`);
    } catch (error) {
      console.error(`${label}: 다시 불러오기 실패 — ${error.message}`);
    }
  };

  const watchers = [];
  for (const dir of watchDirs) {
    try {
      watchers.push(fs.watch(dir, () => {
        clearTimeout(timer);
        timer = setTimeout(rebuild, 150);
      }));
    } catch {
      // Ignore directories that can't be watched (e.g. missing).
    }
  }
  return () => {
    clearTimeout(timer);
    watchers.forEach((watcher) => watcher.close());
  };
}

/** Opens the URL in a web browser; fails silently if it can't. */
function openBrowser(url) {
  const command = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'start'
      : 'xdg-open';
  try {
    const child = spawn(command, [url], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' });
    child.on('error', () => {});
    child.unref();
  } catch {
    // The URL was already printed, so a failed auto-open is not fatal.
  }
}

function countBlocks(node) {
  if (Array.isArray(node)) return node.reduce((sum, item) => sum + countBlocks(item), 0);
  if (!node || typeof node !== 'object' || !node.type) return 0;
  return 1 + countBlocks(node.params ?? []) + countBlocks(node.statements ?? []);
}

/** Decompiles an existing .ent (Entry project) back into Tess source. */
async function runDecompile(file, options) {
  const { decompileEnt } = await import('./src/decompiler/index.js');
  const label = path.basename(file);
  const bytes = fs.readFileSync(file);

  let result;
  try {
    result = await decompileEnt(bytes);
  } catch (error) {
    console.error(`${label}: 되돌리기 실패 — ${error.message}`);
    return 1;
  }

  const outDir = options.out ?? `${file.replace(/\.ent$/i, '')}_tess`;
  fs.mkdirSync(outDir, { recursive: true });
  const mainFile = path.join(outDir, 'main.tess');
  fs.writeFileSync(mainFile, result.source);
  for (const asset of result.assets) {
    const target = path.join(outDir, asset.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, asset.data);
  }

  const fragmentCount = result.assets.filter((asset) => asset.path.endsWith('.tess')).length;
  console.log(`${label} -> ${mainFile}`);
  console.log(`  오브젝트 조각 파일 ${fragmentCount}개, 에셋(모양·소리) ${result.assets.length - fragmentCount}개 옮김`);

  if (result.warnings.length > 0) {
    console.log(`  옮기지 못한 부분 ${result.warnings.length}개 — 소스에 '# [decompile]' 주석으로 표시해 뒀습니다.`);
    if (options.warnings) {
      for (const warning of result.warnings.slice(0, 20)) console.log(`    - ${warning}`);
      if (result.warnings.length > 20) console.log(`    ... 그 외 ${result.warnings.length - 20}개`);
    } else {
      console.log(`  자세한 내용은 --warnings 옵션을 붙여서 다시 실행하세요.`);
    }
  }

  try {
    const recheck = compileProject(result.source, { path: mainFile, assetDirs: [outDir] });
    console.log(recheck.ok
      ? '  되돌린 소스가 다시 정상적으로 컴파일됩니다.'
      : `  참고: 되돌린 소스에 아직 컴파일 에러가 ${recheck.errors.length}개 있습니다 — node index.js check ${mainFile} 로 자세히 보세요.`);
  } catch {
    // The recheck is informational only; keep the output even if it fails.
  }
  return 0;
}

async function main(argv) {
  const { options, rest } = parseArgs(argv);
  const [first, ...others] = rest;
  const commands = {
    check: runCheck, build: runBuild, run: runProject, ast: runAst, decompile: runDecompile,
  };

  const command = commands[first] ? first : 'check';
  const files = commands[first] ? others : rest;

  if (files.length === 0) {
    console.error(USAGE);
    process.exit(2);
  }

  // Flag a .ent passed to a non-decompile command (or .tess passed to decompile)
  // immediately, instead of failing later with a confusing parse error.
  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    if (command !== 'decompile' && ext === '.ent') {
      console.error(`${path.basename(file)}: .ent 파일은 Tess 소스가 아니라 엔트리 작품입니다.`
        + ` 'node index.js decompile ${file}' 로 Tess 소스로 되돌려 보세요.`);
      process.exit(2);
    }
    if (command === 'decompile' && ext === '.tess') {
      console.error(`${path.basename(file)}: decompile 은 .ent(엔트리 작품) 파일을 받습니다.`
        + ' Tess 소스를 엔트리 작품으로 만들려면 build 를 쓰세요.');
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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
