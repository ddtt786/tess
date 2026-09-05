/**
 * @fileoverview @tess/vm 패키지 진입점
 *
 * tessvm 은 Tess 작품을 PixiJS 위에서 엔트리와 같은 규칙으로, 훨씬 빠르게 돌리는
 * 실행기입니다. 여기서는 노드에서 쓰는 것(작품 읽기·서버·헤드리스 실행)을 내보냅니다.
 * 브라우저 쪽 모듈은 `src/web/boot.ts` 가 진입점입니다.
 */
export { Vm, DEFAULT_FPS, MAX_CLONES } from './src/runtime/engine.ts';
export type {
  AudioEngine,
  EntryProjectLike,
  Renderer,
  VmError,
  VmOptions,
} from './src/runtime/engine.ts';
export { Codegen } from './src/compile/codegen.ts';
export type { CompiledProgram, CompileInput, RawBlock } from './src/compile/codegen.ts';
export {
  Entity,
  Target,
  Thread,
  Variable,
  DEFAULT_STAGE_HEIGHT,
  DEFAULT_STAGE_WIDTH,
  WORLD_SCALE,
  parseFont,
  setStageSize,
  stage,
} from './src/runtime/model.ts';
export type { StageMetrics } from './src/runtime/model.ts';
export * as cast from './src/runtime/cast.ts';
export { CollisionSystem, entityBounds, wallRect } from './src/collision/detect.ts';
export { MaskStore, maskFromPixels, solidMask } from './src/collision/mask.ts';
export type { AlphaMask, MaskLoader } from './src/collision/mask.ts';
export { Table, columnIndex, cellToRowCol } from './src/runtime/table.ts';
export { loadProject, assetDirsFor } from './src/node/load.ts';
export type { LoadedProject, LoadOptions } from './src/node/load.ts';
export { serveVm, DEFAULT_PORT } from './src/node/server.ts';
export type { ServeOptions, RunningServer } from './src/node/server.ts';
export { SilentAudioEngine } from './src/audio/silent.ts';
