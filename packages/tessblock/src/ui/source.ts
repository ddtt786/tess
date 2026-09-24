/** The Tess source for what the editor holds right now. */
import { buildSource } from '../codegen/project.ts';
import { project } from '../model/store.ts';
import { compile } from '../runtime/run.ts';
import { flush, liveWorkspaces } from './blockly-host.ts';

export function currentSource(doFlush = true): string {
  if (doFlush) flush();
  return buildSource(project.peek(), { live: liveWorkspaces(), liveSaved: doFlush });
}

/** Quiet time after an edit before the work is compiled ahead of a run. */
const PREPARE_DELAY_MS = 700;

/**
 * Keeps a compile of the work ready while it is edited: once edits settle, the
 * source is written (only changed objects are written again) and compiled off
 * the main thread, so pressing the flag finds it done. Returns a stop function.
 */
export function prepareRuns(): () => void {
  let timer: number | undefined;
  const prepare = () => {
    timer = undefined;
    // The saved state of the open object is current here: edits reach the
    // project by saving it.
    const model = project.peek();
    void compile(buildSource(model, { live: liveWorkspaces(), liveSaved: true }), model.name);
  };
  const stop = project.subscribe(() => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(prepare, PREPARE_DELAY_MS) as unknown as number;
  });
  return () => {
    stop();
    if (timer !== undefined) clearTimeout(timer);
  };
}
