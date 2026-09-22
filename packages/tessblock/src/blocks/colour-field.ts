/**
 * @fileoverview A colour slot that opens the real colour picker.
 *
 * The plugin field draws the swatch well but edits through a fixed palette;
 * only the editor is replaced here, so any colour can be picked.
 */
import * as Blockly from 'blockly/core';
import { FieldColour } from '@blockly/field-colour';

export class FieldColourPicker extends FieldColour {
  protected override showEditor_(): void {
    const input = document.createElement('input');
    input.type = 'color';
    input.value = this.getValue() ?? '#000000';
    input.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;pointer-events:none;';
    document.body.appendChild(input);
    const apply = () => this.setValue(input.value);
    input.addEventListener('input', apply);
    input.addEventListener('change', () => {
      apply();
      input.remove();
    });
    input.addEventListener('blur', () => input.remove());
    input.click();
  }

  static override fromJson(options: Blockly.FieldConfig): FieldColourPicker {
    return new FieldColourPicker((options as { colour?: string }).colour ?? '#ff0000');
  }
}

let registered = false;

export function registerColourPicker(): void {
  if (registered) return;
  registered = true;
  Blockly.fieldRegistry.register('field_colour_picker', FieldColourPicker);
}
