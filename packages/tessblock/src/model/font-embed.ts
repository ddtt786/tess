/**
 * @fileoverview Puts the fonts a vector costume's text uses into the SVG, cut
 * down to the letters it uses. An SVG drawn as an image (the runner, entry,
 * thumbnails, turning it into a bitmap) cannot reach the page's fonts, and its
 * text would come out in a default face.
 */
import { Font, Glyph, parse } from 'opentype.js';
import { fontFamily } from './fonts.ts';

/** Marks the style element this module writes, so the next save replaces it. */
const MARK = 'data-tess-fonts';

/** Where entry's font files live. */
const FONT_BASE = 'https://entry-cdn.pstatic.net/uploads/fonts/';

/**
 * The woff file (the parser cannot read woff2) of each font entry offers, by
 * family, as its stylesheets declare them. The stylesheets themselves cannot
 * be read from the page (no CORS); the font files can.
 */
const FONT_FILES: Record<string, { normal: string; bold?: string }> = {
  'D2 Coding': { normal: 'd2coding-subset.woff', bold: 'd2coding-bold-subset.woff' },
  'designhouseOTFLight00': { normal: 'designhouseOTFLight00.woff' },
  'DungGeunMo': { normal: 'DungGeunMo.woff' },
  'Jeju Hallasan': { normal: 'JejuHallasan-Regular.woff' },
  'KoPub Batang': { normal: 'KoPubBatang-Regular.woff', bold: 'KoPubBatang-Bold.woff' },
  'MaruBuri': { normal: 'MaruBuri-Regular.woff', bold: 'MaruBuri-Bold.woff' },
  'Nanum Barun Pen': { normal: 'nanumbarunpenR.woff', bold: 'nanumbarunpenB.woff' },
  'Nanum Gothic': { normal: 'NanumGothic-Regular.woff', bold: 'NanumGothic-Bold.woff' },
  'Nanum Gothic Coding': { normal: 'NanumGothicCoding-Regular.woff', bold: 'NanumGothicCoding-Bold.woff' },
  'Nanum Myeongjo': { normal: 'NanumMyeongjo-Regular.woff', bold: 'NanumMyeongjo-Bold.woff' },
  'Nanum Pen Script': { normal: 'NanumPenScript-Regular.woff' },
  'NanumSquareRound': { normal: 'NanumSquareRound-Regular.woff', bold: 'NanumSquareRound-Bold.woff' },
  'NotoSans': { normal: 'NotoSans-Regular.woff', bold: 'NotoSans-Bold.woff' },
  'SDChildfundkorea': { normal: 'SDChildfundkorea.woff' },
  'SDCinemaTheater': { normal: 'SDCinemaTheater.woff' },
  'SDComicStencil': { normal: 'SDComicStencil-aBasic.woff' },
  'SDMapssi': { normal: 'SDMapssi.woff' },
  'SDShabang': { normal: 'SDShabang-bMd.woff' },
  'SDWoodcarving': { normal: 'SDWoodcarving.woff' },
  'SDYongbi': { normal: 'SDYongbi.woff' },
  'UhBeemysen': { normal: 'UhBeemysen.woff' },
  'yg-jalnan': { normal: 'JalnanOTF00.woff' },
};

/** The font file for a family and weight, if entry offers one. */
function fileFor(family: string, bold: boolean): string | null {
  const files = FONT_FILES[family];
  if (!files) return null;
  return FONT_BASE + (bold ? files.bold ?? files.normal : files.normal);
}

const parsed = new Map<string, Promise<Font | null>>();

function loadFont(url: string): Promise<Font | null> {
  let font = parsed.get(url);
  if (!font) {
    font = fetch(url)
      .then((response) => (response.ok ? response.arrayBuffer() : Promise.reject(new Error(String(response.status)))))
      .then((buffer) => parse(buffer))
      .catch(() => null);
    parsed.set(url, font);
  }
  return font;
}

/** A font holding only the glyphs for `text`, as base64 OpenType. */
function subset(font: Font, family: string, bold: boolean, text: string): string {
  const notdef = font.glyphs.get(0);
  const glyphs = [new Glyph({ name: '.notdef', advanceWidth: notdef.advanceWidth ?? font.unitsPerEm / 2, path: notdef.path })];
  const seen = new Set<number>();
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (seen.has(code)) continue;
    seen.add(code);
    const glyph = font.charToGlyph(char);
    if (!glyph || glyph === notdef) continue;
    // Copies: the parsed font's own glyphs are shared with every later save.
    glyphs.push(new Glyph({
      name: glyph.name ?? `u${code.toString(16)}`,
      unicode: code,
      unicodes: [code],
      advanceWidth: glyph.advanceWidth,
      path: glyph.path,
    }));
  }
  const cut = new Font({
    familyName: family,
    styleName: bold ? 'Bold' : 'Regular',
    unitsPerEm: font.unitsPerEm,
    ascender: font.ascender,
    descender: font.descender,
    glyphs,
  });
  const bytes = new Uint8Array(cut.toArrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** The first family a `font-family` value names, unquoted. */
function firstFamily(value: string): string {
  return fontFamily(value.split(',')[0]!.trim().replace(/^['"]|['"]$/g, ''));
}

/**
 * The SVG with `@font-face` rules for the fonts its text uses, each holding
 * just the letters used. Text in a font entry does not offer (or that cannot
 * be fetched) is left to the viewer's fonts. Markup with no text comes back as
 * it was.
 */
export async function embedFonts(markup: string): Promise<string> {
  if (!/<text\b/i.test(markup)) return markup;
  const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
  const root = doc.documentElement;
  if (root.nodeName === 'parsererror') return markup;
  for (const old of Array.from(root.querySelectorAll(`style[${MARK}]`))) old.remove();

  // Letters used, by family and weight.
  const uses = new Map<string, { family: string; bold: boolean; text: string }>();
  for (const text of Array.from(root.querySelectorAll('text'))) {
    const style = (text.getAttribute('style') ?? '');
    const familyValue = text.getAttribute('font-family') ?? /font-family:\s*([^;]+)/.exec(style)?.[1] ?? '';
    const weightValue = text.getAttribute('font-weight') ?? /font-weight:\s*([^;]+)/.exec(style)?.[1] ?? '400';
    const family = firstFamily(familyValue);
    if (!family) continue;
    const bold = weightValue.trim() === 'bold' || Number(weightValue) >= 600;
    const key = `${family}\u0000${bold}`;
    const entry = uses.get(key) ?? { family, bold, text: '' };
    entry.text += text.textContent ?? '';
    uses.set(key, entry);
  }

  const rules: string[] = [];
  for (const { family, bold, text } of uses.values()) {
    const url = fileFor(family, bold);
    const font = url ? await loadFont(url) : null;
    if (!font || !text.trim()) continue;
    const data = subset(font, family, bold, text);
    rules.push(`@font-face{font-family:'${family.replace(/'/g, "\\'")}';font-weight:${bold ? 700 : 400};`
      + `src:url(data:font/otf;base64,${data}) format('opentype');}`);
  }
  if (!rules.length) return new XMLSerializer().serializeToString(root);

  const ns = 'http://www.w3.org/2000/svg';
  const style = doc.createElementNS(ns, 'style');
  style.setAttribute(MARK, '');
  style.textContent = rules.join('\n');
  let defs = root.querySelector(':scope > defs');
  if (!defs) {
    defs = doc.createElementNS(ns, 'defs');
    root.insertBefore(defs, root.firstChild);
  }
  defs.appendChild(style);
  return new XMLSerializer().serializeToString(root);
}
