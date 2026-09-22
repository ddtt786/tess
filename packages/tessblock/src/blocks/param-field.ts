/**
 * @fileoverview The name on a parameter block.
 *
 * It draws as part of the block — no white box around it — so a parameter
 * reads as one coloured chip the way scratch's do, and it only becomes an
 * input field on a double click. A single press is left to the drag, which is
 * how a parameter is taken from the header into the body.
 */
import * as Blockly from 'blockly/core';
import { DEFINE_BLOCK } from './function-ids.ts';

const DOUBLE_CLICK_MS = 450;

export class FieldParamName extends Blockly.FieldTextInput {
  private lastClick = 0;

  /**
   * Zelos paints a lone text field as the whole block, in white. A parameter
   * should read as a coloured chip instead, so it stays an ordinary field.
   */
  override isFullBlockField(): boolean {
    return false;
  }

  /** Keeps Blockly's layout but hides the white box the input normally draws. */
  override initView(): void {
    super.initView();
    this.blendIn();
  }

  override applyColour(): void {
    super.applyColour();
    this.blendIn();
  }

  /**
   * Blockly styles the field's box and text from its own stylesheet, which
   * beats attributes set here. A class is added instead and the editor's css
   * takes it from there.
   */
  private blendIn(): void {
    this.getSvgRoot()?.classList.add('tess-param-field');
  }

  protected override showEditor_(event?: Event): void {
    if (!this.inHeader()) return;
    const now = Date.now();
    const quick = now - this.lastClick < DOUBLE_CLICK_MS;
    this.lastClick = now;
    if (!quick) return;
    super.showEditor_(event);
  }

  /**
   * Only the parameter sitting in the definition header carries the name. A
   * copy in the palette or in the body is there to be used, not renamed —
   * renaming one of those would be thrown away with the next palette rebuild.
   */
  private inHeader(): boolean {
    const block = this.getSourceBlock();
    if (!block || block.isInFlyout) return false;
    return block.getParent()?.type === DEFINE_BLOCK;
  }

  static override fromJson(options: Blockly.FieldTextInputFromJsonConfig): FieldParamName {
    return new FieldParamName(String(options.text ?? ''));
  }
}

let registered = false;

export function registerParamField(): void {
  if (registered) return;
  registered = true;
  Blockly.fieldRegistry.register('field_param_name', FieldParamName);
}
