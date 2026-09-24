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

/** The last source handed to the compiler, and its result. */
let compiled: { source: string; name: string; result: Promise<BuildResult> } | null = null;
let worker: Worker | null = null;
let workerFailed = false;
let nextId = 0;
const waiting = new Map<number, (result: BuildResult | null) => void>();

function compileWorker(): Worker | null {
  if (worker || workerFailed || typeof Worker === 'undefined') return worker;
  try {
    worker = new Worker(new URL('./compile-worker.ts', import.meta.url), { type: 'module' });
  } catch {
    workerFailed = true;
    return null;
  }
  worker.onmessage = (event: MessageEvent<{ id: number; result?: BuildResult; error?: string }>) => {
    const done = waiting.get(event.data.id);
    waiting.delete(event.data.id);
    done?.(event.data.result ?? null);
  };
  worker.onerror = () => {
    // Without a worker the page compiles on the main thread, as before.
    workerFailed = true;
    worker?.terminate();
    worker = null;
    for (const done of waiting.values()) done(null);
    waiting.clear();
  };
  return worker;
}

/**
 * The compiled work for `source`, compiled off the main thread. The same
 * source asked for again (a run right after `prepare`) gets the same result.
 */
export function compile(source: string, name: string): Promise<BuildResult> {
  if (compiled && compiled.source === source && compiled.name === name) return compiled.result;
  const target = compileWorker();
  const result = target
    ? new Promise<BuildResult | null>((resolve) => {
        const id = nextId++;
        waiting.set(id, resolve);
        target.postMessage({ id, source, name });
      }).then((done) => done ?? build(source, name))
    : Promise.resolve().then(() => build(source, name));
  compiled = { source, name, result };
  return result;
}

let running: TessVmHandle | null = null;

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
}

/** The running work's handle, for the dev console. */
export function runningHandle(): TessVmHandle | null {
  return running;
}

/** Scripts still running in the work; 0 once every one has come to its end. */
export function activeThreads(): number {
  return running?.vm.targets.reduce((count, target) => count + target.threads.length, 0) ?? 0;
}

export function relayout(): void {
  running?.relayout();
}
