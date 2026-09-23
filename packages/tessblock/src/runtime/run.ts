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
): Promise<BuildResult> {
  const built = build(source, name);
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

export function relayout(): void {
  running?.relayout();
}
