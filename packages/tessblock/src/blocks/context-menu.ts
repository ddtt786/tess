/**
 * @fileoverview The block menu, in the words this editor uses.
 *
 * Blockly's own Korean strings call a duplicate "중복" and a comment "댓글", and
 * its duplicate drops the copy a fixed distance away from the original. Here a
 * copy lands where the pointer is, with copy and paste as their own entries.
 */
import * as Blockly from 'blockly/core';

const WORDS: Record<string, string> = {
  DUPLICATE_BLOCK: '복제하기',
  DUPLICATE_COMMENT: '주석 복제하기',
  ADD_COMMENT: '주석 달기',
  REMOVE_COMMENT: '주석 지우기',
  DELETE_BLOCK: '블록 삭제하기',
  DELETE_X_BLOCKS: '블록 %1개 삭제하기',
  DELETE_ALL_BLOCKS: '블록 %1개를 모두 삭제할까요?',
  COLLAPSE_BLOCK: '블록 접기',
  EXPAND_BLOCK: '블록 펼치기',
  COLLAPSE_ALL: '블록 모두 접기',
  EXPAND_ALL: '블록 모두 펼치기',
  DISABLE_BLOCK: '블록 끄기',
  ENABLE_BLOCK: '블록 켜기',
  INLINE_INPUTS: '가로로 늘어놓기',
  EXTERNAL_INPUTS: '세로로 늘어놓기',
  CLEAN_UP: '블록 정리하기',
  UNDO: '되돌리기',
  REDO: '다시 실행하기',
  HELP: '도움말',
};

const BLOCK = Blockly.ContextMenuRegistry.ScopeType.BLOCK;
const WORKSPACE = Blockly.ContextMenuRegistry.ScopeType.WORKSPACE;

let installed = false;

export function installContextMenu(): void {
  if (installed) return;
  installed = true;
  Object.assign(Blockly.Msg, WORDS);

  const registry = Blockly.ContextMenuRegistry.registry;
  replace({
    id: 'blockDuplicate',
    scopeType: BLOCK,
    weight: 1,
    displayText: WORDS.DUPLICATE_BLOCK!,
    preconditionFn: (scope) => (copyable(scope.block) ? 'enabled' : 'hidden'),
    callback: (scope, open, _select, location) => {
      const block = scope.block;
      if (!block) return;
      // The copy goes where the pointer is, by its own top left, however long
      // the stack under it happens to be.
      const workspace = block.workspace as Blockly.WorkspaceSvg;
      const data = Blockly.clipboard.copy(block as Blockly.BlockSvg);
      if (data) Blockly.clipboard.paste(data, workspace, pointerPoint(workspace, open) ?? location);
    },
  });

  replace({
    id: 'tessBlockCopy',
    scopeType: BLOCK,
    weight: 1.2,
    displayText: '복사하기',
    preconditionFn: (scope) => (copyable(scope.block) ? 'enabled' : 'hidden'),
    callback: (scope, open, _select, location) => {
      const block = scope.block;
      if (!block) return;
      const workspace = block.workspace as Blockly.WorkspaceSvg;
      Blockly.clipboard.copy(block as Blockly.BlockSvg, pointerPoint(workspace, open) ?? location);
    },
  });

  replace({
    id: 'tessBlockPaste',
    scopeType: BLOCK,
    weight: 1.4,
    displayText: '붙여넣기',
    preconditionFn: (scope) => (Blockly.clipboard.getLastCopiedData() && scope.block ? 'enabled' : 'hidden'),
    callback: (scope, open, _select, location) => {
      const workspace = scope.block?.workspace as Blockly.WorkspaceSvg | undefined;
      pasteInto(workspace, open, location);
    },
  });

  replace({
    id: 'tessWorkspacePaste',
    scopeType: WORKSPACE,
    weight: 3,
    displayText: '붙여넣기',
    preconditionFn: () => (Blockly.clipboard.getLastCopiedData() ? 'enabled' : 'disabled'),
    callback: (scope, open, _select, location) => {
      pasteInto(scope.workspace as Blockly.WorkspaceSvg | undefined, open, location);
    },
  });
}

function pasteInto(
  workspace: Blockly.WorkspaceSvg | undefined,
  menuEvent: Event,
  location?: Blockly.utils.Coordinate,
): void {
  const data = Blockly.clipboard.getLastCopiedData();
  if (data && workspace) Blockly.clipboard.paste(data, workspace, pointerPoint(workspace, menuEvent) ?? location);
}

/**
 * Where the menu was opened, in workspace units.
 *
 * The pointer's own coordinates are read and converted, so zooming the page or
 * the workspace, or scrolling it, still drops the copy under the pointer. A
 * menu opened from the keyboard has no pointer, and the caller falls back.
 */
function pointerPoint(
  workspace: Blockly.WorkspaceSvg | undefined,
  menuEvent: Event,
): Blockly.utils.Coordinate | undefined {
  if (!workspace || !(menuEvent instanceof MouseEvent)) return undefined;
  const screen = new Blockly.utils.Coordinate(menuEvent.clientX, menuEvent.clientY);
  return Blockly.utils.svgMath.screenToWsCoordinates(workspace, screen);
}

function copyable(block: Blockly.BlockSvg | undefined): boolean {
  return Boolean(block && !block.isInFlyout && block.isMovable() && block.isDeletable());
}

/** Registers an item, taking over the id when Blockly already used it. */
function replace(item: Blockly.ContextMenuRegistry.RegistryItem): void {
  const registry = Blockly.ContextMenuRegistry.registry;
  if (registry.getItem(item.id)) registry.unregister(item.id);
  registry.register(item);
}
