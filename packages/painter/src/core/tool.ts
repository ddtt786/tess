import type { PointerInfo } from './types.js';

/** Contract every vector / bitmap tool implements. */
export interface Tool {
  readonly name: string;
  /** CSS cursor while the tool is active. */
  readonly cursor?: string;
  activate?(): void;
  deactivate?(): void;
  onPointerDown(info: PointerInfo): void;
  onPointerMove(info: PointerInfo): void;
  onPointerUp(info: PointerInfo): void;
  onPointerHover?(info: PointerInfo): void;
  onDoubleClick?(info: PointerInfo): void;
  /** Return `true` when the key was handled and should not bubble further. */
  onKeyDown?(event: KeyboardEvent): boolean;
  /** Called when fill / outline / width changed while the tool is active. */
  onStyleChange?(): void;
  /** Abort an in-flight gesture (Escape, tool switch, undo, ...). */
  cancel?(): void;
}

/** Convenience base class: every hook is optional. */
export abstract class BaseTool implements Tool {
  abstract readonly name: string;
  readonly cursor: string = 'crosshair';
  onPointerDown(_info: PointerInfo): void {}
  onPointerMove(_info: PointerInfo): void {}
  onPointerUp(_info: PointerInfo): void {}
}
