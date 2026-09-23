/**
 * @fileoverview The block menu, in the words this editor uses.
 *
 * Blockly's own Korean strings call a duplicate "중복" and a comment "댓글", and
 * its duplicate drops the copy a fixed distance away from the original. Here a
 * copy lands where the pointer is, with copy and paste as their own entries.
 */
import * as Blockly from "blockly/core";

const WORDS: Record<string, string> = {
  DUPLICATE_BLOCK: "복제하기",
  DUPLICATE_COMMENT: "주석 복제하기",
  ADD_COMMENT: "주석 달기",
  REMOVE_COMMENT: "주석 지우기",
  DELETE_BLOCK: "블록 삭제하기",
  DELETE_X_BLOCKS: "블록 %1개 삭제하기",
  DELETE_ALL_BLOCKS: "블록 %1개를 모두 삭제할까요?",
  COLLAPSE_BLOCK: "블록 접기",
  EXPAND_BLOCK: "블록 펼치기",
  COLLAPSE_ALL: "블록 모두 접기",
  EXPAND_ALL: "블록 모두 펼치기",
  DISABLE_BLOCK: "블록 끄기",
  ENABLE_BLOCK: "블록 켜기",
  INLINE_INPUTS: "가로로 늘어놓기",
  EXTERNAL_INPUTS: "세로로 늘어놓기",
  CLEAN_UP: "블록 정리하기",
  UNDO: "되돌리기",
  REDO: "다시 실행하기",
  HELP: "도움말",
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
    id: "blockDuplicate",
    scopeType: BLOCK,
    weight: 1,
    displayText: WORDS.DUPLICATE_BLOCK!,
    preconditionFn: (scope) => (copyable(scope.block) ? "enabled" : "hidden"),
    callback: (scope, open, _select, location) => {
      const block = scope.block;
      if (!block) return;
      // The copy goes where the pointer is, by its own top left, however long
      // the stack under it happens to be.
      const workspace = block.workspace as Blockly.WorkspaceSvg;
      const data = Blockly.clipboard.copy(block as Blockly.BlockSvg);
      if (data)
        Blockly.clipboard.paste(
          data,
          workspace,
          pointerPoint(workspace, open) ?? location,
        );
    },
  });

  replace({
    id: "tessBlockCopy",
    scopeType: BLOCK,
    weight: 1.2,
    displayText: "복사하기",
    preconditionFn: (scope) => (copyable(scope.block) ? "enabled" : "hidden"),
    callback: (scope, open, _select, location) => {
      const block = scope.block;
      if (!block) return;
      const workspace = block.workspace as Blockly.WorkspaceSvg;
      Blockly.clipboard.copy(
        block as Blockly.BlockSvg,
        pointerPoint(workspace, open) ?? location,
      );
    },
  });

  replace({
    id: "tessBlockPaste",
    scopeType: BLOCK,
    weight: 1.4,
    displayText: "붙여넣기",
    preconditionFn: (scope) =>
      Blockly.clipboard.getLastCopiedData() && scope.block
        ? "enabled"
        : "hidden",
    callback: (scope, open, _select, location) => {
      const workspace = scope.block?.workspace as
        | Blockly.WorkspaceSvg
        | undefined;
      pasteInto(workspace, open, location);
    },
  });

  replace({
    id: "tessWorkspacePaste",
    scopeType: WORKSPACE,
    weight: 3,
    displayText: "붙여넣기",
    preconditionFn: () =>
      Blockly.clipboard.getLastCopiedData() ? "enabled" : "disabled",
    callback: (scope, open, _select, location) => {
      pasteInto(
        scope.workspace as Blockly.WorkspaceSvg | undefined,
        open,
        location,
      );
    },
  });

  replace({
    id: "blockComment",
    scopeType: BLOCK,
    weight: 2,
    displayText: (scope) => {
      const block = scope.block as Blockly.BlockSvg | undefined;
      return block?.hasIcon(Blockly.icons.IconType.COMMENT)
        ? "주석 지우기"
        : "주석 달기";
    },
    preconditionFn: (scope) =>
      scope.block && !scope.block.isInFlyout ? "enabled" : "hidden",
    callback: async (scope) => {
      const block = scope.block as Blockly.BlockSvg | undefined;
      if (!block) return;
      if (block.hasIcon(Blockly.icons.IconType.COMMENT)) {
        block.setCommentText(null);
      } else {
        block.setCommentText("");
        const icon = block.getIcon(Blockly.icons.IconType.COMMENT) as any;
        if (icon) {
          await icon.setBubbleVisible?.(true);
          const bubble = icon.getBubble?.();
          if (bubble) {
            patchBubblePrototypes(bubble);
            if (!icon.getBubbleLocation?.()) {
              bubble.setPositionRelativeToAnchor?.(36, -8);
            }
            updateBubbleHeader(bubble);
            bubble.renderTail?.();
          }
        }
      }
    },
  });

  // The menu takes focus, which clears the block's selection outline; keep it until the menu closes.
  const blockProto = Blockly.BlockSvg.prototype as any;
  if (!blockProto.__tessMenuSelect) {
    blockProto.__tessMenuSelect = true;
    const showMenu = blockProto.showContextMenu;
    blockProto.showContextMenu = function (this: Blockly.BlockSvg, event: PointerEvent) {
      if (!this.isInFlyout) Blockly.common.setSelected(this);
      showMenu.call(this, event);
      if (this.isInFlyout || !Blockly.WidgetDiv.isVisible()) return;
      this.addSelect();
      const block = this;
      const widget = document.querySelector(".blocklyWidgetDiv");
      if (!widget) return;
      const watch = new MutationObserver(() => {
        if (Blockly.WidgetDiv.isVisible()) return;
        watch.disconnect();
        if (!block.isDisposed() && Blockly.getFocusManager().getFocusedNode() !== block) block.removeSelect();
      });
      watch.observe(widget, { attributes: true, attributeFilter: ["style"] });
    };
  }

  // The comment icon is hidden by CSS; drop it from layout so it reserves no space.
  const info = Blockly.zelos.RenderInfo.prototype as any;
  if (!info.__tessCommentIconDropped) {
    info.__tessCommentIconDropped = true;
    const createRows = info.createRows_;
    info.createRows_ = function (this: Blockly.zelos.RenderInfo) {
      createRows.call(this);
      const first = this.inputRows[0];
      if (first) {
        first.elements = first.elements.filter(
          (elem) => !(elem instanceof Blockly.blockRendering.Icon && elem.icon instanceof Blockly.icons.CommentIcon),
        );
      }
    };
  }

  // Patch CommentIcon to anchor cleanly to the right side of the block with connection line
  if (!(Blockly.icons.CommentIcon.prototype as any).__anchorPatched) {
    (Blockly.icons.CommentIcon.prototype as any).__anchorPatched = true;
    const iconProto = Blockly.icons.CommentIcon.prototype as any;
    const originalGetAnchor = iconProto.getAnchorLocation;
    iconProto.getAnchorLocation = function (this: Blockly.icons.CommentIcon) {
      const block = this.sourceBlock as Blockly.BlockSvg | undefined;
      if (!block) return originalGetAnchor.call(this);
      const bbox = (block as any).pathObject?.svgPath?.getBBox?.();
      const width =
        bbox?.width ??
        (block as any).width ??
        block.getHeightWidth?.()?.width ??
        120;
      const height = bbox?.height ?? (block as any).height ?? 40;
      const loc = block.getRelativeToSurfaceXY();
      return new Blockly.utils.Coordinate(
        loc.x + width,
        loc.y + Math.min(20, Math.max(10, height / 2)),
      );
    };

    const originalCreateBubble = (Blockly.icons.CommentIcon.prototype as any)
      .createBubble;
    (Blockly.icons.CommentIcon.prototype as any).createBubble = function () {
      originalCreateBubble.call(this);
      const bubble = (this as any).textInputBubble;
      if (bubble) {
        patchBubblePrototypes(bubble);
        if (!(this as any).bubbleLocation) {
          bubble.setPositionRelativeToAnchor(36, -8);
        }
        updateBubbleHeader(bubble);
        bubble.renderTail?.();
      }
    };
  }
}

const COLLAPSED_SIZE = 28;
const HEADER_HEIGHT = 28;

function patchBubblePrototypes(bubble: any): void {
  const TextInputBubbleProto = Object.getPrototypeOf(bubble);
  const BubbleProto = TextInputBubbleProto
    ? Object.getPrototypeOf(TextInputBubbleProto)
    : null;

  if (BubbleProto && !BubbleProto.__tessTailPatched) {
    BubbleProto.__tessTailPatched = true;
    BubbleProto.renderTail = function () {
      if (!this.tail) return;
      const d = -this.relativeLeft;
      const e = -this.relativeTop;
      const isCollapsed = Boolean(this.__isCollapsed);
      const width = isCollapsed ? COLLAPSED_SIZE : (this.size?.width ?? 160);

      let targetX = 0;
      let targetY = 14;
      if (d <= 0) {
        targetX = 0;
        targetY = 14;
      } else if (d >= width) {
        targetX = width;
        targetY = 14;
      } else {
        targetX = Math.max(0, Math.min(width, d));
        targetY = e < 0 ? 0 : isCollapsed ? COLLAPSED_SIZE : HEADER_HEIGHT;
      }

      this.tail.setAttribute("d", `M ${d} ${e} L ${targetX} ${targetY}`);
    };
  }

  if (TextInputBubbleProto && !TextInputBubbleProto.__tessResizePatched) {
    TextInputBubbleProto.__tessResizePatched = true;
    const originalSetSize = TextInputBubbleProto.setSize;
    TextInputBubbleProto.setSize = function (size: any, relayout = false) {
      if (this.__isCollapsed) {
        this.size = new size.constructor(COLLAPSED_SIZE, COLLAPSED_SIZE);
        if (this.background) {
          this.background.setAttribute("width", `${COLLAPSED_SIZE}`);
          this.background.setAttribute("height", `${COLLAPSED_SIZE}`);
        }
        this.renderTail?.();
        updateBubbleHeader(this);
        return;
      }
      originalSetSize.call(this, size, relayout);
      updateBubbleHeader(this);
    };
  }
}

function updateBubbleHeader(bubble: any): void {
  const svgRoot = bubble.getSvgRoot?.();
  if (!svgRoot) return;

  const isCollapsed = Boolean(bubble.__isCollapsed);
  const width = isCollapsed ? COLLAPSED_SIZE : (bubble.size?.width ?? 180);
  const height = isCollapsed ? COLLAPSED_SIZE : (bubble.size?.height ?? 120);

  if (bubble.background) {
    bubble.background.setAttribute("rx", isCollapsed ? "14" : "8");
    bubble.background.setAttribute("ry", isCollapsed ? "14" : "8");
    if (isCollapsed) {
      bubble.background.setAttribute("width", `${COLLAPSED_SIZE}`);
      bubble.background.setAttribute("height", `${COLLAPSED_SIZE}`);
    }
  }

  let header = svgRoot.querySelector(".tess-comment-header");
  if (!header) {
    header = document.createElementNS("http://www.w3.org/2000/svg", "g");
    header.setAttribute("class", "tess-comment-header");
    header.style.pointerEvents = "none";
    bubble.background?.after(header);
  }

  if (isCollapsed) {
    header.innerHTML = `
      <circle cx="14" cy="14" r="14" fill="#ffffff" stroke="#cbd5e1" stroke-width="1.5" style="pointer-events: none;" />
      <svg x="7" y="7" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="pointer-events: none;">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>
      <circle class="tess-comment-expand-btn" cx="14" cy="14" r="14" fill="transparent" style="cursor: pointer; pointer-events: auto;" />
    `;

    const expandBtn = header.querySelector(
      ".tess-comment-expand-btn",
    ) as SVGElement | null;
    if (expandBtn) {
      let startPos = { x: 0, y: 0 };
      let moved = false;
      expandBtn.onpointerdown = (e: PointerEvent) => {
        startPos = { x: e.clientX, y: e.clientY };
        moved = false;
      };
      expandBtn.onpointermove = (e: PointerEvent) => {
        if (Math.hypot(e.clientX - startPos.x, e.clientY - startPos.y) > 4) {
          moved = true;
        }
      };
      const expandComment = (e: Event) => {
        if (!moved) {
          e.stopPropagation();
          e.preventDefault();
          bubble.__isCollapsed = false;
          const w = bubble.__expandedWidth || 180;
          const h = bubble.__expandedHeight || 120;
          bubble.setSize(new bubble.size.constructor(w, h));
        }
      };
      expandBtn.onpointerup = expandComment;
      expandBtn.onclick = expandComment;
    }
  } else {
    // Flat modern header with divider, comment icon, "주석" text, chevron, and delete 'x' button
    header.innerHTML = `
      <path class="tess-comment-header-bg" style="pointer-events: none;" d="M 0 8 Q 0 0 8 0 L ${Math.max(0, width - 8)} 0 Q ${width} 0 ${width} 8 L ${width} ${HEADER_HEIGHT} L 0 ${HEADER_HEIGHT} Z" fill="#f8fafc" />
      <line x1="0" y1="${HEADER_HEIGHT}" x2="${width}" y2="${HEADER_HEIGHT}" stroke="#e2e8f0" stroke-width="1" style="pointer-events: none;" />
      <svg x="8" y="7" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="pointer-events: none;">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>
      <text x="26" y="18" font-size="11.5" font-weight="600" fill="#64748b" font-family="Pretendard, Inter, system-ui, sans-serif" style="pointer-events: none; user-select: none;">주석</text>
      <g class="tess-comment-collapse-btn" style="cursor: pointer; pointer-events: auto;">
        <rect x="${width - 36}" y="6" width="16" height="16" rx="4" fill="transparent" />
        <polyline points="${width - 32},17 ${width - 28},12 ${width - 24},17" fill="none" stroke="#64748b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="pointer-events: none;" />
      </g>
      <g class="tess-comment-delete-btn" style="cursor: pointer; pointer-events: auto;">
        <rect x="${width - 20}" y="6" width="16" height="16" rx="4" fill="transparent" />
        <line x1="${width - 16}" y1="10" x2="${width - 8}" y2="18" stroke="#94a3b8" stroke-width="1.6" stroke-linecap="round" style="pointer-events: none;" />
        <line x1="${width - 8}" y1="10" x2="${width - 16}" y2="18" stroke="#94a3b8" stroke-width="1.6" stroke-linecap="round" style="pointer-events: none;" />
      </g>
    `;

    const collapseBtn = header.querySelector(
      ".tess-comment-collapse-btn",
    ) as SVGElement | null;
    if (collapseBtn) {
      const toggle = (e: Event) => {
        e.stopPropagation();
        e.preventDefault();
        bubble.__expandedWidth = bubble.size.width;
        bubble.__expandedHeight = bubble.size.height;
        bubble.__isCollapsed = true;
        bubble.setSize(
          new bubble.size.constructor(COLLAPSED_SIZE, COLLAPSED_SIZE),
        );
      };
      collapseBtn.onpointerdown = (e) => e.stopPropagation();
      collapseBtn.onmousedown = (e) => e.stopPropagation();
      collapseBtn.onclick = toggle;
    }

    const deleteBtn = header.querySelector(
      ".tess-comment-delete-btn",
    ) as SVGElement | null;
    if (deleteBtn) {
      const del = (e: Event) => {
        e.stopPropagation();
        e.preventDefault();
        const block =
          (bubble as any).owner?.sourceBlock || (bubble as any).sourceBlock;
        if (block?.setCommentText) {
          block.setCommentText(null);
        } else {
          bubble.dispose?.();
        }
      };
      deleteBtn.onpointerdown = (e) => e.stopPropagation();
      deleteBtn.onmousedown = (e) => e.stopPropagation();
      deleteBtn.onclick = del;
    }
  }

  const fo = svgRoot.querySelector("foreignObject");
  if (fo) {
    fo.setAttribute("y", `${HEADER_HEIGHT + 2}`);
    fo.setAttribute("x", "2");
    fo.setAttribute("width", `${Math.max(10, width - 4)}`);
    fo.setAttribute("height", `${Math.max(10, height - HEADER_HEIGHT - 4)}`);
    fo.style.display = isCollapsed ? "none" : "";
  }

  if (bubble.resizeGroup) {
    bubble.resizeGroup.style.display = isCollapsed ? "none" : "";
    if (bubble.resizeGroup.setAttribute) {
      bubble.resizeGroup.innerHTML = "";
      bubble.resizeGroup.setAttribute(
        "href",
        'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><line x1="13" y1="7" x2="7" y2="13" stroke="%2394a3b8" stroke-width="1.5" stroke-linecap="round"/><line x1="13" y1="10" x2="10" y2="13" stroke="%2394a3b8" stroke-width="1.5" stroke-linecap="round"/></svg>',
      );
    }
  }
}

function pasteInto(
  workspace: Blockly.WorkspaceSvg | undefined,
  menuEvent: Event,
  location?: Blockly.utils.Coordinate,
): void {
  const data = Blockly.clipboard.getLastCopiedData();
  if (data && workspace)
    Blockly.clipboard.paste(
      data,
      workspace,
      pointerPoint(workspace, menuEvent) ?? location,
    );
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
  const screen = new Blockly.utils.Coordinate(
    menuEvent.clientX,
    menuEvent.clientY,
  );
  return Blockly.utils.svgMath.screenToWsCoordinates(workspace, screen);
}

function copyable(block: Blockly.BlockSvg | undefined): boolean {
  return Boolean(
    block && !block.isInFlyout && block.isMovable() && block.isDeletable(),
  );
}

/** Registers an item, taking over the id when Blockly already used it. */
function replace(item: Blockly.ContextMenuRegistry.RegistryItem): void {
  const registry = Blockly.ContextMenuRegistry.registry;
  if (registry.getItem(item.id)) registry.unregister(item.id);
  registry.register(item);
}
