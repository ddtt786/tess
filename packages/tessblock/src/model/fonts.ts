/**
 * @fileoverview The fonts a text box can use: entry's free web fonts, by the
 * family name entry's own stylesheets declare, so the stage, the preview and
 * the running work all draw the same letters.
 */

import { ENTRY_FONT_STYLES } from '../../../player/src/template.ts';

export interface FontChoice {
  /** What the menu shows. */
  label: string;
  /** The css family, which is also what the work stores. */
  family: string;
}

export const FONTS: FontChoice[] = [
  { label: '나눔고딕', family: 'Nanum Gothic' },
  { label: '나눔명조', family: 'Nanum Myeongjo' },
  { label: '나눔바른펜', family: 'Nanum Barun Pen' },
  { label: '나눔손글씨', family: 'Nanum Pen Script' },
  { label: '나눔스퀘어라운드', family: 'NanumSquareRound' },
  { label: '마루 부리', family: 'MaruBuri' },
  { label: '본고딕', family: 'NotoSans' },
  { label: 'D2 Coding', family: 'D2 Coding' },
  { label: '잘난체', family: 'yg-jalnan' },
  { label: '디자인하우스체', family: 'designhouseOTFLight00' },
  { label: '둥근모꼴체', family: 'DungGeunMo' },
  { label: '어비마이센체', family: 'UhBeemysen' },
  { label: '나눔고딕코딩', family: 'Nanum Gothic Coding' },
  { label: '제주한라산', family: 'Jeju Hallasan' },
  { label: '코펍바탕', family: 'KoPub Batang' },
  { label: '바탕체', family: '바탕체' },
  { label: '고딕체', family: '고딕체' },
  { label: '궁서체', family: '궁서체' },
];

/** Fonts no longer offered; a work that already uses one keeps it, and the menus show it for that work. */
const RETIRED_FONTS: FontChoice[] = [
  { label: 'SD 코믹스텐실', family: 'SDComicStencil' },
  { label: 'SD 차일드펀드코리아', family: 'SDChildfundkorea' },
  { label: 'SD 시네마극장', family: 'SDCinemaTheater' },
  { label: 'SD 맵씨', family: 'SDMapssi' },
  { label: 'SD 샤방', family: 'SDShabang' },
  { label: 'SD 우드카빙', family: 'SDWoodcarving' },
  { label: 'SD 용비', family: 'SDYongbi' },
];

/** The menu for a font setting: the offered fonts, plus the current one if it is retired. */
export function fontChoices(current = ''): FontChoice[] {
  const family = fontFamily(current);
  if (!family || FONTS.some((font) => font.family === family)) return FONTS;
  return [...FONTS, { label: fontLabel(family), family }];
}

/** What a menu shows for a font family. */
export function fontLabel(family: string): string {
  return [...FONTS, ...RETIRED_FONTS].find((font) => font.family === family)?.label ?? family;
}

/** Names older works stored in place of the family. */
const OLD_NAMES: Record<string, string> = {
  나눔고딕: 'Nanum Gothic',
  나눔명조: 'Nanum Myeongjo',
  나눔손글씨: 'Nanum Pen Script',
  둥근모꼴: 'DungGeunMo',
};

/** The css family for a stored font name. */
export function fontFamily(name: string): string {
  return OLD_NAMES[name] ?? name;
}

/**
 * Puts every font stylesheet entry offers on the page once, the same list
 * tessvm's own page loads, so a work naming any of them draws it here too.
 * The editor and the runner share the page.
 */
export function loadFonts(): void {
  if (typeof document === 'undefined' || document.getElementById('tess-fonts')) return;
  const marker = document.createElement('meta');
  marker.id = 'tess-fonts';
  document.head.appendChild(marker);
  for (const href of ENTRY_FONT_STYLES) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
  }
}
