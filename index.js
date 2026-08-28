// ============================================================================
//  tess — 엔트리 작품으로 컴파일되는 텍스트 언어
//
//  라이브러리:  import { parse, compileProject } from 'tess'
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
  node index.js check      <파일.tess>          문법 · 의미 검사
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
  --no-reload        run 할 때 소스가 바뀌어도 자동으로 새로고침하지 않는다`;

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
    else rest.push(arg);
  }
  return { options, rest };
}

function runCheck(file) {
  const source = fs.readFileSync(file, 'utf-8');
  const result = parse(source);
  const label = path.basename(file);
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

  const result = compileProject(source, { path: file, assetDirs, name: options.name });
  report(label, result.warnings, '경고');
  if (!result.ok) {
    report(label, result.errors, '에러');
    return 1;
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

/** 컴파일해서 브라우저에서 열어 본다 */
async function runProject(file, options) {
  const source = fs.readFileSync(file, 'utf-8');
  const label = path.basename(file);
  const assetDirs = options.assets.length > 0
    ? options.assets.map((dir) => path.resolve(dir))
    : [path.dirname(path.resolve(file))];

  const result = compileProject(source, { path: file, assetDirs, name: options.name });
  report(label, result.warnings, '경고');
  if (!result.ok) {
    report(label, result.errors, '에러');
    return 1;
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
    // 서버가 어떤 이유로든 안 닫히면(예: 소켓이 안 끊김) Ctrl+C 가 먹통이 된
    // 것처럼 보이니, 잠깐 기다려도 안 끝나면 그냥 강제로 끝낸다.
    const forceExit = setTimeout(() => process.exit(0), 2000);
    forceExit.unref();
    server.close().then(() => process.exit(0));
  });
  return null; // 서버가 떠 있는 동안 프로세스를 유지한다
}

/** 소스와 리소스 폴더를 지켜보다가 바뀌면 다시 컴파일해서 서버에 반영한다 */
function watchAndReload(file, options, assetDirs, label, server) {
  const watchDirs = new Set([path.dirname(path.resolve(file)), ...assetDirs]);
  let timer = null;

  const rebuild = () => {
    try {
      const source = fs.readFileSync(file, 'utf-8');
      const result = compileProject(source, { path: file, assetDirs, name: options.name });
      report(label, result.warnings, '경고');
      if (!result.ok) {
        report(label, result.errors, '에러');
        console.error(`${label}: 다시 불러오기 실패 — 이전 버전을 계속 보여줍니다.`);
        return;
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
      // 폴더를 지켜볼 수 없어도 (예: 없는 폴더) 조용히 넘어간다
    }
  }
  return () => {
    clearTimeout(timer);
    watchers.forEach((watcher) => watcher.close());
  };
}

/** 웹 브라우저로 열기 (열 수 없으면 조용히 넘어간다) */
function openBrowser(url) {
  const command = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'start'
      : 'xdg-open';
  try {
    const child = spawn(command, [url], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' });
    child.on('error', () => {});
    child.unref();
  } catch {
    // 브라우저를 못 열어도 주소를 찍어 뒀으니 괜찮다
  }
}

function countBlocks(node) {
  if (Array.isArray(node)) return node.reduce((sum, item) => sum + countBlocks(item), 0);
  if (!node || typeof node !== 'object' || !node.type) return 0;
  return 1 + countBlocks(node.params ?? []) + countBlocks(node.statements ?? []);
}

/** 이미 있는 .ent(엔트리 작품)를 Tess 소스로 되돌린다 */
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

  console.log(`${label} -> ${mainFile}`);
  console.log(`  에셋 ${result.assets.length}개 옮김`);

  if (result.warnings.length > 0) {
    console.log(`  옮기지 못한 부분 ${result.warnings.length}개 — 소스에 '# [decompile]' 주석으로 표시해 뒀습니다:`);
    for (const warning of result.warnings.slice(0, 20)) console.log(`    - ${warning}`);
    if (result.warnings.length > 20) console.log(`    ... 그 외 ${result.warnings.length - 20}개`);
  }

  try {
    const recheck = compileProject(result.source, { path: mainFile, assetDirs: [outDir] });
    console.log(recheck.ok
      ? '  되돌린 소스가 다시 정상적으로 컴파일됩니다.'
      : `  참고: 되돌린 소스에 아직 컴파일 에러가 ${recheck.errors.length}개 있습니다 — node index.js check ${mainFile} 로 자세히 보세요.`);
  } catch {
    // 다시 컴파일해 보는 건 참고용이라, 실패해도 결과물은 그대로 둔다
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

  // .ent(엔트리 작품)를 decompile 이 아닌 명령에 잘못 넣거나, 반대로 .tess 를
  // decompile 에 넣는 실수는 아리송한 파싱 에러 대신 바로 알려 준다.
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
