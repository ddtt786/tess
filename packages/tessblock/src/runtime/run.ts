/**
 * @fileoverview Compiling the written source and running it on tessvm.
 *
 * The editor never builds entry blocks itself: it writes Tess, the Tess
 * compiler builds the work, and tessvm runs exactly that work.
 */
import { compileProject } from '../../../compiler/src/index.ts';
import type { CompileDiagnostic, EntryProject } from '../../../compiler/src/types.ts';
import { boot, type TessVmHandle } from '../../../tessvm/src/web/boot.ts';

export interface BuildResult {
  project: EntryProject | null;
  errors: CompileDiagnostic[];
  warnings: CompileDiagnostic[];
}

export function build(source: string, name: string): BuildResult {
  const result = compileProject(source, { path: 'main.tess', name, assetUrls: true });
  return { project: result.project, errors: result.errors, warnings: result.warnings };
}

let running: TessVmHandle | null = null;

export function isRunning(): boolean {
  return running !== null;
}

export async function start(container: HTMLElement, source: string, name: string): Promise<BuildResult> {
  const built = build(source, name);
  if (!built.project) return built;
  stop();
  container.replaceChildren();
  running = await boot({
    project: built.project as never,
    container,
    autoStart: true,
    keyTarget: container,
    kernelUrl: null,
  });
  return built;
}

export function stop(): void {
  running?.dispose();
  running = null;
}

export function relayout(): void {
  running?.relayout();
}
