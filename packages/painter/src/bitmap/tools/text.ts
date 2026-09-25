import type { Tool } from '../../core/tool.js';
import type { Point, PointerInfo } from '../../core/types.js';
import { TextEditor } from '../../core/text-editor.js';
import type { BitmapPainter } from '../BitmapPainter.js';

/**
 * Raster text. Typed in a floating textarea, then stamped into the canvas with
 * `fillText` — once committed it is pixels like everything else.
 */
export class BitmapTextTool implements Tool {
  readonly name = 'text';
  readonly cursor = 'text';

  private editor: TextEditor;
  private anchor: Point = { x: 0, y: 0 };

  constructor(private readonly painter: BitmapPainter) {
    this.editor = new TextEditor(painter.root);
  }

  deactivate(): void {
    if (this.editor.isOpen) this.editor.commit();
  }

  onPointerDown(info: PointerInfo): void {
    if (this.editor.isOpen) {
      this.editor.commit();
      return;
    }
    this.painter.commitFloating();
    this.anchor = { x: info.x, y: info.y };
    const style = this.painter.textStyle;
    const fontSize = style.fontSize * this.painter.zoom;
    const client = this.painter.canvasToClient(this.anchor);
    this.editor.open(
      {
        left: client.x,
        top: client.y - fontSize * 0.82,
        fontSize,
        style,
        color: this.painter.paintColor,
        text: '',
      },
      {
        onCommit: (value) => {
          this.stamp(value);
          this.handOver();
        },
        onCancel: () => {},
      },
    );
  }

  /**
   * Once typing ends (a press elsewhere, Escape) the select tool takes over,
   * unless another tool was picked meanwhile.
   */
  private handOver(): void {
    setTimeout(() => {
      if (this.painter.tool === "text") this.painter.setTool("select");
    }, 0);
  }

  onPointerMove(): void {}
  onPointerUp(): void {}

  onKeyDown(e: KeyboardEvent): boolean {
    return this.editor.isOpen && e.key !== 'Escape';
  }

  cancel(): void {
    if (this.editor.isOpen) this.editor.cancel();
  }

  private stamp(value: string): void {
    const text = value.replace(/\s+$/g, '');
    if (!text) return;
    const style = this.painter.textStyle;
    const ctx = this.painter.ctx;
    ctx.save();
    ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize}px ${style.fontFamily}`;
    ctx.textAlign = style.align === 'center' ? 'center' : style.align === 'right' ? 'right' : 'left';
    ctx.textBaseline = 'alphabetic';
    this.painter.usePaint(ctx);
    text.split('\n').forEach((line, i) => {
      ctx.fillText(line, this.anchor.x, this.anchor.y + i * style.fontSize * TextEditor.lineHeight);
    });
    ctx.restore();
    this.painter.commit();
  }
}
