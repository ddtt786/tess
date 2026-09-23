/** The Tess source for what the editor holds right now. */
import { buildSource } from '../codegen/project.ts';
import { project } from '../model/store.ts';
import { flush, liveWorkspaces } from './blockly-host.ts';

export function currentSource(doFlush = true): string {
  if (doFlush) flush();
  return buildSource(project.peek(), { live: liveWorkspaces() });
}
