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
