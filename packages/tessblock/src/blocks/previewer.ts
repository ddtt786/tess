/**
 * @fileoverview Where a dragged block would go, shown cheaply on long stacks.
 *
 * Blockly's insertion marker is a real block spliced into the stack, and every
 * block below the stack's top is its parent's child — so on a stack hundreds of
 * blocks tall, each move of the marker re-renders the whole stack above it.
 * Past a size, the target connection is highlighted instead.
 */
import * as Blockly from 'blockly/core';

/** Stacks this many blocks or more get the highlight instead of the marker. */
const HEAVY_STACK = 120;

export class StackAwarePreviewer implements Blockly.IConnectionPreviewer {
  private readonly marker: Blockly.InsertionMarkerPreviewer;
  private markerShown = false;
  private lit: Blockly.RenderedConnection | null = null;
  /** Stack sizes by root block, counted once per drag. */
  private readonly sizes = new Map<string, number>();

  constructor(draggedBlock: Blockly.BlockSvg) {
    this.marker = new Blockly.InsertionMarkerPreviewer(draggedBlock);
  }

  previewReplacement(
    draggedConn: Blockly.RenderedConnection,
    staticConn: Blockly.RenderedConnection,
    replacedBlock: Blockly.BlockSvg,
  ): void {
    if (this.heavy(staticConn)) {
      this.highlight(staticConn);
      return;
    }
    this.clearHighlight();
    this.markerShown = true;
    this.marker.previewReplacement(draggedConn, staticConn, replacedBlock);
  }

  previewConnection(draggedConn: Blockly.RenderedConnection, staticConn: Blockly.RenderedConnection): void {
    if (this.heavy(staticConn)) {
      this.highlight(staticConn);
      return;
    }
    this.clearHighlight();
    this.markerShown = true;
    this.marker.previewConnection(draggedConn, staticConn);
  }

  hidePreview(): void {
    this.clearHighlight();
    if (this.markerShown) {
      this.marker.hidePreview();
      this.markerShown = false;
    }
  }

  dispose(): void {
    this.hidePreview();
    this.marker.dispose();
  }

  private heavy(connection: Blockly.RenderedConnection): boolean {
    const root = connection.getSourceBlock().getRootBlock();
    let size = this.sizes.get(root.id);
    if (size === undefined) {
      size = root.getDescendants(false).length;
      this.sizes.set(root.id, size);
    }
    return size >= HEAVY_STACK;
  }

  private highlight(connection: Blockly.RenderedConnection): void {
    if (this.markerShown) {
      this.marker.hidePreview();
      this.markerShown = false;
    }
    if (this.lit === connection) return;
    this.clearHighlight();
    connection.highlight();
    this.lit = connection;
  }

  private clearHighlight(): void {
    this.lit?.unhighlight();
    this.lit = null;
  }
}
