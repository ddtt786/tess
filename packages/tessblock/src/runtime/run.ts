/**
 * @fileoverview Compiling the written source and running it on tessvm.
 *
 * The editor never builds entry blocks itself: it writes Tess, the Tess
 * compiler builds the work, and tessvm runs exactly that work.
 */
import { compileProject } from "../../../compiler/src/index.ts";
import type {
  CompileDiagnostic,
  EntryProject,
} from "../../../compiler/src/types.ts";
import { boot, type TessVmHandle } from "../../../tessvm/src/web/boot.ts";
import { ASK_FIELD_STYLE } from "../../../tessvm/src/web/ask-style.ts";
import { CHART_WINDOW_STYLE } from "../../../tessvm/src/web/chart-view.ts";
import { EXTRAS_DIALOG_STYLE } from "../../../tessvm/src/web/extras.ts";

export interface BuildResult {
  project: EntryProject | null;
  errors: CompileDiagnostic[];
  warnings: CompileDiagnostic[];
}

export function build(source: string, name: string): BuildResult {
  const result = compileProject(source, {
    path: "main.tess",
    name,
    assetUrls: true,
  });
  return {
    project: result.project,
    errors: result.errors,
    warnings: result.warnings,
  };
}

/** One source to compile, and the promise its result settles. */
interface Job {
  source: string;
  name: string;
  /** A run waits on it; a prepared one may be dropped for newer work. */
  urgent: boolean;
  result: Promise<BuildResult>;
  settle: (result: BuildResult) => void;
}

/** The result a dropped job settles with; nothing waits on dropped jobs. */
const DROPPED: BuildResult = { project: null, errors: [], warnings: [] };

/** The last job asked for; the same source asked for again gets its result. */
let latest: Job | null = null;
/** The job the worker is compiling, and the jobs waiting for it: runs, and the newest prepare. */
let active: Job | null = null;
const pending: Job[] = [];
let worker: Worker | null = null;
let workerFailed = false;

function compileWorker(): Worker | null {
  if (worker || workerFailed || typeof Worker === 'undefined') return worker;
  try {
    worker = new Worker(new URL('./compile-worker.ts', import.meta.url), { type: 'module' });
  } catch {
    workerFailed = true;
    return null;
  }
  worker.onmessage = (event: MessageEvent<{ result?: BuildResult; error?: string }>) => {
    const job = active;
    active = null;
    job?.settle(event.data.result ?? build(job.source, job.name));
    sendNext();
  };
  worker.onerror = () => {
    // Without a worker the page compiles on the main thread, as before.
    workerFailed = true;
    worker?.terminate();
    worker = null;
    for (const job of [active, ...pending.splice(0)]) job?.settle(build(job.source, job.name));
    active = null;
  };
  return worker;
}

function sendNext(): void {
  if (active || !pending.length) return;
  const target = compileWorker();
  const job = pending.shift()!;
  if (!target) {
    job.settle(build(job.source, job.name));
    return;
  }
  active = job;
  target.postMessage({ id: 0, source: job.source, name: job.name });
}

/** Drops a job no one waits on; a later ask for its source compiles again. */
function drop(job: Job | null): void {
  if (!job) return;
  if (latest === job) latest = null;
  job.settle(DROPPED);
}

/**
 * The compiled work for `source`, compiled off the main thread. The same
 * source asked for again (a run right after a prepare) gets the same result.
 * A run (`urgent`) does not wait behind older prepared work: that work is
 * stopped. A prepare waits for the worker, replacing any prepare still waiting.
 */
export function compile(source: string, name: string, urgent = true): Promise<BuildResult> {
  if (latest && latest.source === source && latest.name === name) {
    latest.urgent ||= urgent;
    return latest.result;
  }
  let settle!: (result: BuildResult) => void;
  const result = new Promise<BuildResult>((resolve) => { settle = resolve; });
  const job: Job = { source, name, urgent, result, settle };
  latest = job;
  if (!compileWorker()) {
    job.settle(build(source, name));
    return result;
  }
  // Only the newest prepare is worth compiling; runs are never dropped.
  for (let index = pending.length - 1; index >= 0; index--) {
    if (!pending[index]!.urgent) drop(pending.splice(index, 1)[0]!);
  }
  pending.push(job);
  if (active && urgent && !active.urgent) {
    // Older prepared work is thrown away with the worker compiling it.
    worker?.terminate();
    worker = null;
    drop(active);
    active = null;
  }
  sendNext();
  return result;
}

let running: TessVmHandle | null = null;
/** The work `running` was booted with. */
let runningProject: EntryProject | null = null;

export function isRunning(): boolean {
  return running !== null;
}

/** The runner draws its own chrome — the answer field, charts, dialogs. */
function installRuntimeStyles(): void {
  const id = "tessvm-runtime-style";
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = [
    ASK_FIELD_STYLE,
    CHART_WINDOW_STYLE,
    EXTRAS_DIALOG_STYLE,
  ].join("\n");
  document.head.appendChild(style);
}

export async function start(
  container: HTMLElement,
  source: string,
  name: string,
  scene = '',
  onProgress?: (loaded: number, total: number) => void,
  boost = true,
): Promise<BuildResult> {
  const built = await compile(source, name);
  if (!built.project) return built;
  stop();
  installRuntimeStyles();
  container.replaceChildren();
  runningProject = built.project;
  running = await boot({
    project: built.project as never,
    container,
    autoStart: true,
    keyTarget: container,
    kernelUrl: null,
    // The scene being worked on is the one that runs, the way entry's editor does.
    scene,
    onProgress,
    // The editor's files are in memory already; the stage shows the preview until they are drawn.
    waitForAssets: false,
    boost,
  });
  return built;
}

/** Holds the running work where it is; sounds are held too, not ended. */
export function pause(): void {
  running?.pause();
}

/** Carries a paused work on from where it was held. */
export function resume(): void {
  running?.start();
}

export function stop(): void {
  running?.dispose();
  running = null;
  runningProject = null;
}

/** The running work's handle, for the dev console. */
export function runningHandle(): TessVmHandle | null {
  return running;
}

/** The compiled work that is running, for reading its records' ids. */
export function runningWork(): EntryProject | null {
  return running ? runningProject : null;
}

/** Scripts still running in the work; 0 once every one has come to its end. */
export function activeThreads(): number {
  return running?.vm.targets.reduce((count, target) => count + target.threads.length, 0) ?? 0;
}

export function relayout(): void {
  running?.relayout();
}
