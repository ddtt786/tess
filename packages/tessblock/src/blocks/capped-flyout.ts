/**
 * @fileoverview A palette that never grows wider than `MAX_CONTENT_WIDTH`.
 *
 * Blockly sizes the vertical flyout to its widest block; one very long block
 * (a call with many arguments, a long name) would otherwise push the palette
 * across the whole script area. Wider blocks are cut off at the edge and can
 * still be dragged out.
 */
import * as Blockly from 'blockly/core';

/** Widest block the palette makes room for, in workspace units (before the flyout's scale). */
const MAX_CONTENT_WIDTH = 460;

export class CappedFlyout extends Blockly.VerticalFlyout {
  protected override reflowInternal_(): void {
    // The width is taken from the contents' bounding boxes; report no box wider than the cap.
    const contents = this.getContents;
    this.getContents = () => contents.call(this).map((item) => capped(item));
    try {
      super.reflowInternal_();
    } finally {
      this.getContents = contents;
    }
  }
}

function capped(item: Blockly.FlyoutItem): Blockly.FlyoutItem {
  const element = item.getElement();
  const box = () => {
    const rect = element.getBoundingRectangle();
    return rect.getWidth() <= MAX_CONTENT_WIDTH
      ? rect
      : new Blockly.utils.Rect(rect.top, rect.bottom, rect.left, rect.left + MAX_CONTENT_WIDTH);
  };
  const view = new Proxy(element, {
    get(target, key) {
      if (key === 'getBoundingRectangle') return box;
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return new Blockly.FlyoutItem(view, item.getType());
}
