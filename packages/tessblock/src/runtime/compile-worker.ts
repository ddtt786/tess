/**
 * @fileoverview Compiles Tess off the main thread, so a large work compiles
 * without holding the editor.
 */
import { initTreeSitterForVite } from '@tess/parser/vite';
import { compileProject } from '../../../compiler/src/index.ts';

export interface CompileRequest {
  id: number;
  source: string;
  name: string;
}

const ready = initTreeSitterForVite();

self.onmessage = async (event: MessageEvent<CompileRequest>) => {
  const { id, source, name } = event.data;
  await ready;
  try {
    const result = compileProject(source, { path: 'main.tess', name, assetUrls: true });
    self.postMessage({
      id,
      result: { project: result.project, errors: result.errors, warnings: result.warnings },
    });
  } catch (error) {
    self.postMessage({ id, error: String(error) });
  }
};
