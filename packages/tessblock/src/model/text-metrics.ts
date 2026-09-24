/**
 * @fileoverview How big a text box is.
 *
 * The compiler cannot draw text, so the source has to carry the box size. It is
 * measured here with the same font the stage draws, and the same number goes to
 * the preview and to the work that runs.
 */
import type { TextProps } from './types.ts';

let context: CanvasRenderingContext2D | null = null;

function measurer(): CanvasRenderingContext2D | null {
  if (!context) context = document.createElement('canvas').getContext('2d');
  return context;
}

export function measureTextBox(text: TextProps): { boxWidth: number; boxHeight: number } {
  const lines = text.lineBreak ? text.content.split('\n') : [text.content.replace(/\n/g, ' ')];
  const font = `${text.italic ? 'italic ' : ''}${text.bold ? '700 ' : ''}${text.fontSize}px "${text.font}", sans-serif`;
  const ruler = measurer();
  if (ruler) ruler.font = font;
  let width = 0;
  for (const line of lines) {
    const measured = ruler ? ruler.measureText(line || ' ').width : (line.length || 1) * text.fontSize * 0.85;
    width = Math.max(width, measured);
  }
  return {
    boxWidth: Math.max(12, Math.ceil(width)),
    boxHeight: Math.max(12, Math.ceil(lines.length * text.fontSize * 1.25)),
  };
}

/** `TEXT_BOX_REPOSITION_OFFSET - TEXT_BOX_WEBGL_OFFSET` in entryjs: a wrapping box's text starts this far below its top. */
const WRAPPED_TOP = 10 - 5.9;

const shifts = new Map<string, number>();

/** The runner's text engine (PIXI) font metrics for a text box's font. */
export type RunnerMetrics = (text: TextProps) => { ascent: number; descent: number };

/**
 * How far below the page's placement the stage draws a text box's letters, in
 * the box's own pixels. The runner (PIXI) places a line's baseline from font
 * metrics it measures itself; the page uses the font's own ascent and descent.
 */
export function textShift(text: TextProps, runner: RunnerMetrics): number {
  const weight = text.bold ? 'bold' : 'normal';
  const style = text.italic ? 'italic' : 'normal';
  const key = `${style}|${weight}|${text.fontSize}|${text.font}`;
  let shift = shifts.get(key);
  if (shift === undefined) {
    shift = 0;
    const ruler = measurer();
    if (ruler) {
      ruler.font = `${style} ${weight} ${text.fontSize}px "${text.font}", sans-serif`;
      const page = ruler.measureText('가Hg');
      const pixi = runner(text);
      if (page.fontBoundingBoxAscent !== undefined) {
        shift = (pixi.ascent - pixi.descent) / 2 - (page.fontBoundingBoxAscent - page.fontBoundingBoxDescent) / 2;
      }
    }
    shifts.set(key, shift);
  }
  return text.lineBreak ? shift + WRAPPED_TOP : shift;
}
