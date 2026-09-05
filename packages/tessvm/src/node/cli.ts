#!/usr/bin/env node
/**
 * @fileoverview tessvm 명령줄 도구입니다.
 *
 * `run` 은 작품을 컴파일해 브라우저로 띄우고, `bench` 는 화면 없이 돌려 초당 프레임을
 * 재며, `emit` 은 JIT 가 만든 자바스크립트를 그대로 보여 줍니다.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { Vm } from '../runtime/engine.ts';
import { SilentAudioEngine } from '../audio/silent.ts';
import { loadProject } from './load.ts';
import { serveVm, DEFAULT_PORT } from './server.ts';

const USAGE = `사용법
  tessvm run    <파일.tess|파일.ent>   컴파일해서 브라우저로 실행
  tessvm bench  <파일.tess|파일.ent>   화면 없이 돌려 속도를 잰다
  tessvm emit   <파일.tess|파일.ent>   JIT 가 만든 자바스크립트를 출력
  tessvm check  <파일.tess|파일.ent>   아직 지원하지 않는 블록을 보고한다

옵션
  --port <번호>     run 이 쓸 포트 (기본 ${DEFAULT_PORT}, 사용 중이면 빈 포트)
  --quality <배수>  화질 배수 1 · 2 · 4 (기본 1 — 화면 크기와 기기 배율에 맞춘다)
  --fps <값>        틱 속도. 안 주면 작품이 정한 값(project.speed)을 따르고,
                    그것도 없으면 64 로 돕니다 — 엔트리와 같은 규칙입니다.
  --stage <가로x세로> 무대 크기 (기본 480x270 — 엔트리와 같다. 예: --stage 960x540)
  --ticks <횟수>    bench 가 돌릴 프레임 수 (기본 6000)
  --assets <폴더>   모양·소리를 찾을 폴더 (여러 번 지정 가능)
  --keep <폴더>     .ent 를 되돌린 Tess 소스를 남길 폴더
  --no-open         브라우저를 열지 않는다
  --no-stats        무대 아래 프레임 표시를 끈다
  --no-start        페이지를 열어도 바로 시작하지 않는다
  --boost           '부스트 모드인가?' 가 참을 돌려주게 한다
                    (그리기는 언제나 WebGL 이고, 이 값만 바뀝니다)`;

interface Options {
  port?: number;
  quality: number;
  fps?: number;
  stageWidth?: number;
  stageHeight?: number;
  ticks: number;
  assets: string[];
  keep?: string;
  open: boolean;
  stats: boolean;
  autoStart: boolean;
  boost: boolean;
}

function parseArgs(argv: string[]): { options: Options; rest: string[] } {
  const options: Options = {
    quality: 1,
    ticks: 6000,
    assets: [],
    open: true,
    stats: true,
    autoStart: true,
    boost: false,
  };
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === '--port') options.port = Number(argv[++i]);
    else if (arg === '--quality') options.quality = Number(argv[++i]);
    else if (arg === '--fps') options.fps = Number(argv[++i]);
    else if (arg === '--stage') {
      const [width, height] = String(argv[++i] ?? '').split(/[x×,]/);
      options.stageWidth = Number(width) || undefined;
      options.stageHeight = Number(height) || undefined;
    }
    else if (arg === '--ticks') options.ticks = Number(argv[++i]);
    else if (arg === '--assets') options.assets.push(argv[++i]!);
    else if (arg === '--keep') options.keep = argv[++i];
    else if (arg === '--no-open') options.open = false;
    else if (arg === '--no-stats') options.stats = false;
    else if (arg === '--no-start') options.autoStart = false;
    else if (arg === '--boost') options.boost = true;
    else rest.push(arg);
  }
  return { options, rest };
}

async function main(): Promise<number> {
  const { options, rest } = parseArgs(process.argv.slice(2));
  const [command, file] = rest;
  if (!command || !file) {
    console.log(USAGE);
    return command ? 1 : 0;
  }
  if (!fs.existsSync(file)) {
    console.error(`파일을 찾을 수 없습니다: ${file}`);
    return 1;
  }

  const loaded = await loadProject(file, {
    assetDirs: options.assets,
    decompileTo: options.keep,
  });
  if (loaded.decompiledTo) {
    console.log(`${path.basename(file)} → ${path.join(loaded.decompiledTo, 'main.tess')} (되돌린 Tess 소스)`);
  }
  for (const error of loaded.errors) {
    console.error(`  에러 ${error.line}:${error.column} ${error.message}`);
  }

  switch (command) {
    case 'run':
      return run(loaded, options);
    case 'bench':
      return bench(loaded, options);
    case 'emit':
      return emit(loaded);
    case 'check':
      return check(loaded);
    default:
      console.log(USAGE);
      return 1;
  }
}

type Loaded = Awaited<ReturnType<typeof loadProject>>;

async function run(loaded: Loaded, options: Options): Promise<number> {
  const server = await serveVm({
    project: loaded.project,
    assets: loaded.assets,
    assetDirs: loaded.assetDirs,
    name: loaded.name,
    port: options.port,
    quality: options.quality,
    fps: options.fps,
    stageWidth: options.stageWidth,
    stageHeight: options.stageHeight,
    stats: options.stats,
    autoStart: options.autoStart,
    boost: options.boost,
  });
  console.log(`${loaded.name} → ${server.url}`);
  console.log(`  오브젝트 ${loaded.project.objects.length} · 장면 ${loaded.project.scenes.length} · 에셋 ${loaded.assets.length}`);
  console.log('  Ctrl+C 로 끕니다.');
  if (options.open) {
    openBrowser(server.url);
  }
  await new Promise<void>((resolve) => {
    process.on('SIGINT', () => {
      void server.close().then(resolve);
    });
  });
  return 0;
}

function bench(loaded: Loaded, options: Options): number {
  const vm = new Vm({
    renderer: null,
    audio: new SilentAudioEngine(),
    fps: options.fps,
    stageWidth: options.stageWidth,
    stageHeight: options.stageHeight,
  });
  const compileStart = performance.now();
  vm.load(loaded.project as never);
  const compileMs = performance.now() - compileStart;

  vm.start();
  // Warm the JIT before measuring.
  for (let i = 0; i < 120; i += 1) {
    vm.tick();
  }
  const start = performance.now();
  for (let i = 0; i < options.ticks; i += 1) {
    vm.tick();
  }
  const elapsed = performance.now() - start;
  const perTick = elapsed / options.ticks;
  console.log(`${loaded.name}`);
  console.log(`  컴파일   ${compileMs.toFixed(1)} ms  (오브젝트 ${vm.targets.length} · ${vm.frameRate}fps)`);
  console.log(`  ${options.ticks} 틱  ${elapsed.toFixed(1)} ms  (틱당 ${perTick.toFixed(4)} ms)`);
  console.log(`  여유     ${(16.67 / perTick).toFixed(0)}× (60fps 한 프레임 예산 대비)`);
  if (vm.errors.length) {
    console.log(`  오류 ${vm.errors.length}건 — 첫 번째: ${vm.errors[0]!.message}`);
  }
  return 0;
}

function emit(loaded: Loaded): number {
  const vm = new Vm({ renderer: null, audio: null });
  vm.load(loaded.project as never);
  process.stdout.write(vm.compiledSource(loaded.project as never));
  return 0;
}

function check(loaded: Loaded): number {
  const vm = new Vm({ renderer: null, audio: null });
  vm.load(loaded.project as never);
  if (!vm.unknownBlocks.size) {
    console.log(`${loaded.name}: 모든 블록을 실행할 수 있습니다.`);
    return 0;
  }
  const rows = [...vm.unknownBlocks.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`${loaded.name}: 아직 실행하지 못하는 블록 ${rows.length}종`);
  for (const [type, count] of rows) {
    console.log(`  ${type.padEnd(38)} ${count}개`);
  }
  return 0;
}

function openBrowser(url: string): void {
  const command =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  try {
    spawn(command, [url], { detached: true, stdio: 'ignore', shell: process.platform === 'win32' }).unref();
  } catch {
    // No browser to open; the URL is already printed.
  }
}

process.exitCode = await main();
