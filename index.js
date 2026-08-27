// ============================================================================
//  tess — 엔트리 작품으로 컴파일되는 텍스트 언어
//
//  라이브러리:  import { parse, compileProject } from 'tess'
//  CLI:
//    node index.js check examples/tour.tess
//    node index.js build examples/gift_delivery/main.tess -o build/gift.ent
//    node index.js build examples/gift_delivery/main.tess -o build/project.json
// ============================================================================
export { parse, parseOrThrow, check, trace, grammar, semantics, validate } from './src/parse.js';
export { grammarSource } from './src/grammar.js';
export { compileProject } from './src/compiler/index.js';
export { makeEntryBundle, makeTar } from './src/compiler/bundle.js';
export { verifyEntryProject } from './src/compiler/verify.js';
export { serveProject } from './src/player/server.js';
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
  node index.js check <파일.tess>              문법 · 의미 검사
  node index.js build <파일.tess> [-o 출력]     엔트리 작품으로 컴파일
  node index.js run   <파일.tess>              컴파일해서 브라우저로 열기
  node index.js ast   <파일.tess>              AST 출력

옵션
  -o, --out <경로>   출력 파일. 확장자가 .json 이면 project.json,
                     .ent 이면 tar 묶음(temp/project.json)으로 저장한다.
  --assets <폴더>    모양·소리 파일을 찾을 폴더 (여러 번 쓸 수 있음)
  --name <이름>      작품 이름 (기본값: project 의 title)
  --port <번호>      run 이 쓸 포트 (기본값: 비어 있는 포트)
  --no-open          run 할 때 브라우저를 자동으로 열지 않는다`;

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
  const server = await serveProject({
    project: result.project,
    bundle,
    assets: result.assets,
    name: result.project.name,
    port: options.port,
    cwd: path.dirname(path.resolve(file)),
  });

  console.log(`${label} -> ${server.url}`);
  console.log(`  실행기: ${server.runtime}`);
  console.log('  Ctrl+C 로 끕니다.');
  if (!options.noOpen) openBrowser(server.url);

  process.on('SIGINT', () => {
    server.close().then(() => process.exit(0));
  });
  return null; // 서버가 떠 있는 동안 프로세스를 유지한다
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

async function main(argv) {
  const { options, rest } = parseArgs(argv);
  const [first, ...others] = rest;
  const commands = { check: runCheck, build: runBuild, run: runProject, ast: runAst };

  const command = commands[first] ? first : 'check';
  const files = commands[first] ? others : rest;

  if (files.length === 0) {
    console.error(USAGE);
    process.exit(2);
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
