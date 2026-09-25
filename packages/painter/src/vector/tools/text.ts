import type { Tool } from "../../core/tool.js";
import type { PointerInfo } from "../../core/types.js";
import { TextEditor } from "../../core/text-editor.js";
import { matApply, round } from "../../core/geom.js";
import { ensurePid, readFont, readTextLines } from "../scene.js";
import type { VectorPainter } from "../VectorPainter.js";

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Text tool. Typing happens in a floating `<textarea>` (so IME, selection and
 * clipboard behave) and the value is written back as `<text>` + `<tspan>` lines.
 */
export class TextTool implements Tool {
  readonly name = "text";
  readonly cursor = "text";

  private editor: TextEditor;
  private editing: SVGTextElement | null = null;
  private createdNow = false;

  constructor(private readonly painter: VectorPainter) {
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
    const hit = this.painter.hitTest(info.clientX, info.clientY, 4);
    if (hit && hit.item.tagName.toLowerCase() === "text") {
      this.beginEdit(hit.item as SVGTextElement);
      return;
    }

    const text = document.createElementNS(SVG_NS, "text");
    const style = this.painter.textStyle;
    text.setAttribute("x", String(round(info.x, 2)));
    text.setAttribute("y", String(round(info.y, 2)));
    text.setAttribute("font-family", style.fontFamily);
    text.setAttribute("font-size", String(style.fontSize));
    text.setAttribute("font-weight", String(style.fontWeight));
    text.setAttribute("font-style", style.fontStyle);
    text.setAttribute(
      "text-anchor",
      style.align === "center"
        ? "middle"
        : style.align === "right"
          ? "end"
          : "start",
    );
    text.setAttribute("fill", this.painter.style.fill ?? "#000000");
    text.setAttribute("stroke", "none");
    text.setAttribute("xml:space", "preserve");
    this.painter.scene.node.appendChild(text);
    ensurePid(text);
    this.createdNow = true;
    this.beginEdit(text);
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
    return this.editor.isOpen && e.key !== "Escape";
  }

  cancel(): void {
    if (this.editor.isOpen) this.editor.cancel();
  }

  /** Opens the editor over an existing text item. */
  beginEdit(text: SVGTextElement): void {
    this.editing = text;
    const font = readFont(text);
    const lines = readTextLines(text).map((l) => l.text);
    const value = lines.join("\n");
    const x = parseFloat(text.getAttribute("x") ?? "0") || 0;
    const y = parseFloat(text.getAttribute("y") ?? "0") || 0;

    const m = this.painter.itemMatrix(text as unknown as SVGGraphicsElement);
    const sceneAnchor = matApply(m, { x, y });
    const anchor = this.painter.sceneToClient(sceneAnchor);
    const rotation = (Math.atan2(m[1], m[0]) * 180) / Math.PI;
    const fontSize = font.size * this.painter.zoom;

    text.style.visibility = "hidden";
    this.painter.deselect();
    this.editor.open(
      {
        left: anchor.x,
        top: anchor.y,
        rotation,
        baseline: true,
        fontSize,
        style: {
          ...this.painter.textStyle,
          fontFamily: font.family,
          fontSize: font.size,
          align: this.painter.textStyle.align,
        },
        color: text.getAttribute("fill") ?? "#000000",
        text: value,
      },
      {
        onCommit: (next) => {
          this.finish(next);
          this.handOver();
        },
        onCancel: () => this.finish(value, true),
      },
    );
  }

  private finish(value: string, cancelled = false): void {
    const text = this.editing;
    this.editing = null;
    if (!text) return;
    text.style.visibility = "";

    const trimmed = value.replace(/\s+$/g, "");
    if (!trimmed) {
      text.remove();
      if (!cancelled || this.createdNow) {
        this.painter.commit();
      }
      this.createdNow = false;
      return;
    }

    this.writeLines(text, trimmed.split("\n"));
    this.createdNow = false;
    this.painter.setSelection([text as unknown as SVGGraphicsElement]);
    this.painter.commit();
  }

  private writeLines(text: SVGTextElement, lines: string[]): void {
    const size = parseFloat(text.getAttribute("font-size") ?? "16") || 16;
    const x = text.getAttribute("x") ?? "0";
    text.replaceChildren();
    lines.forEach((line, i) => {
      const tspan = document.createElementNS(SVG_NS, "tspan");
      tspan.setAttribute("x", x);
      tspan.setAttribute(
        "dy",
        i === 0 ? "0" : String(round(size * TextEditor.lineHeight, 2)),
      );
      tspan.setAttribute("xml:space", "preserve");
      tspan.textContent = line.length ? line : " ";
      text.appendChild(tspan);
    });
  }
}
