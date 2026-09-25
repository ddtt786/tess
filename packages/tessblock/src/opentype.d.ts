/** The part of opentype.js (which ships no types) that font embedding uses. */
declare module 'opentype.js' {
  export class Path {}
  export class Glyph {
    constructor(options: { name?: string; unicode?: number; unicodes?: number[]; advanceWidth?: number; path?: Path });
    name: string | null;
    unicode?: number;
    unicodes: number[];
    advanceWidth?: number;
    path: Path;
  }
  export class Font {
    constructor(options: {
      familyName: string;
      styleName: string;
      unitsPerEm: number;
      ascender: number;
      descender: number;
      glyphs: Glyph[];
    });
    unitsPerEm: number;
    ascender: number;
    descender: number;
    glyphs: { get(index: number): Glyph; length: number };
    charToGlyph(char: string): Glyph;
    toArrayBuffer(): ArrayBuffer;
  }
  export function parse(buffer: ArrayBuffer): Font;
}
