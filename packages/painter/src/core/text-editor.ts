import type { TextStyle } from "./types.js";

export interface TextEditorOpenOptions {
  /** Where to place the editor, in client coordinates. */
  left: number;
  top: number;
  /** Rendered font size in CSS pixels (already multiplied by zoom). */
  fontSize: number;
  style: TextStyle;
  color: string;
  text: string;
  /** Minimum width so an empty editor is still clickable. */
  minWidth?: number;
  /** Rotation in degrees. */
  rotation?: number;
  /** Whether the anchor point is on the text baseline. */
  baseline?: boolean;
}

export interface TextEditorHandlers {
  onCommit(text: string): void;
  onCancel(): void;
  onInput?(text: string): void;
}

const LINE_HEIGHT = 1.2;

/**
 * A plain `<textarea>` floated over the canvas for text entry.
 *
 * Using a real textarea keeps IME composition, selection and clipboard working
 * — things a hand-rolled SVG caret gets wrong — while the committed value is
 * written back into the `<text>` element (or the canvas) by the caller.
 */
export class TextEditor {
  readonly element: HTMLTextAreaElement;
  private open_ = false;
  private handlers: TextEditorHandlers | null = null;

  constructor(private readonly host: HTMLElement) {
    this.element = document.createElement("textarea");
    this.element.className = "pt-text-editor";
    this.element.spellcheck = false;
    this.element.wrap = "off";
    this.element.rows = 1;
    this.element.style.display = "none";
    host.appendChild(this.element);

    this.element.addEventListener("keydown", (e) => {
      e.stopPropagation();
      // Escape leaves the box and keeps what was typed, as clicking away does.
      if (e.key === "Escape") {
        e.preventDefault();
        this.commit();
      } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        this.commit();
      }
    });
    this.element.addEventListener("input", () => {
      this.autoSize();
      this.handlers?.onInput?.(this.element.value);
    });
    this.element.addEventListener("blur", () => {
      if (this.open_) this.commit();
    });
  }

  get isOpen(): boolean {
    return this.open_;
  }
  get value(): string {
    return this.element.value;
  }

  open(options: TextEditorOpenOptions, handlers: TextEditorHandlers): void {
    this.handlers = handlers;
    const hostRect = this.host.getBoundingClientRect();
    const el = this.element;
    el.value = options.text;
    el.style.display = "block";
    el.style.left = `${options.left - hostRect.left}px`;
    el.style.top = `${options.top - hostRect.top}px`;
    el.style.fontFamily = options.style.fontFamily;
    el.style.fontSize = `${options.fontSize}px`;
    el.style.fontWeight = String(options.style.fontWeight);
    el.style.fontStyle = options.style.fontStyle;
    el.style.lineHeight = `${LINE_HEIGHT}`;
    el.style.color = options.color;
    el.style.textAlign = options.style.align;
    el.style.minWidth = `${options.minWidth ?? Math.max(24, options.fontSize)}px`;

    const rotation = options.rotation ?? 0;
    const alignX =
      options.style.align === "center"
        ? "-50%"
        : options.style.align === "right"
          ? "-100%"
          : "0%";
    const baselineY = options.baseline ? -options.fontSize * 0.82 : 0;

    // Anchor the box so the caret sits where the glyphs will land, matching rotation.
    if (rotation !== 0 || options.baseline) {
      el.style.transformOrigin = "0 0";
      el.style.transform = `rotate(${Math.round(rotation * 100) / 100}deg) translate(${alignX}, ${Math.round(baselineY * 100) / 100}px)`;
    } else {
      el.style.transformOrigin = "top left";
      el.style.transform = alignX !== "0%" ? `translateX(${alignX})` : "none";
    }
    this.open_ = true;
    this.autoSize();
    // A timeout rather than rAF: the editor must still focus in a background
    // tab, where animation frames are throttled to a standstill.
    setTimeout(() => {
      if (!this.open_) return;
      el.focus({ preventScroll: true });
      el.setSelectionRange(el.value.length, el.value.length);
    }, 0);
  }

  commit(): void {
    if (!this.open_) return;
    const handlers = this.handlers;
    const value = this.element.value;
    this.close();
    handlers?.onCommit(value);
  }

  cancel(): void {
    if (!this.open_) return;
    const handlers = this.handlers;
    this.close();
    handlers?.onCancel();
  }

  close(): void {
    this.open_ = false;
    this.handlers = null;
    this.element.style.display = "none";
    this.element.value = "";
  }

  destroy(): void {
    this.element.remove();
  }

  private autoSize(): void {
    const el = this.element;
    const lines = el.value.split("\n");
    el.rows = Math.max(1, lines.length);
    el.style.height = `${Math.max(1, lines.length) * parseFloat(el.style.fontSize || "16") * LINE_HEIGHT + 4}px`;
    // Grow with the longest line; canvas text is not wrapped.
    const measure = document.createElement("span");
    measure.style.cssText =
      `position:absolute;visibility:hidden;white-space:pre;font-family:${el.style.fontFamily};` +
      `font-size:${el.style.fontSize};font-weight:${el.style.fontWeight};font-style:${el.style.fontStyle}`;
    measure.textContent =
      lines.reduce((a, b) => (a.length >= b.length ? a : b), "") || " ";
    document.body.appendChild(measure);
    const width = measure.getBoundingClientRect().width;
    measure.remove();
    el.style.width = `${Math.max(parseFloat(el.style.minWidth || "24"), width + parseFloat(el.style.fontSize || "16") * 0.6)}px`;
  }

  static get lineHeight(): number {
    return LINE_HEIGHT;
  }
}
