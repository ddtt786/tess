/**
 * @fileoverview Block colours and workspace chrome.
 *
 * Hues follow entry's families so the categories stay recognisable, in
 * brighter tints that sit well on the light editor surfaces.
 */
import * as Blockly from 'blockly/core';
import type { Category } from './spec.ts';

export const CATEGORY_COLOURS: Record<Category, string> = {
  start: '#22b45a',
  flow: '#14b3a4',
  moving: '#6366f1',
  looks: '#ec4899',
  brush: '#f97316',
  sound: '#a855f7',
  judge: '#3b82f6',
  calc: '#f2a007',
  data: '#f43f5e',
  analysis: '#64748b',
  text: '#0cb2cf',
  expansion: '#65b30f',
  func: '#d946ef',
};

/** Line icons for the palette, drawn in each category's colour through a mask. */
const CATEGORY_ICONS: Record<Category, string> = {
  start: '<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>',
  flow: '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="12" cy="18" r="2.5"/><path d="M6 8.5v1.5a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V8.5M12 13v2.5"/>',
  moving: '<path d="M4 8h14l-3-3M20 16H6l3 3"/>',
  looks: '<circle cx="8" cy="8" r="4"/><path d="M14 20h7l-3.5-6z"/><rect x="4" y="14" width="6" height="6" rx="1"/><path d="M15 4h5v5h-5z"/>',
  brush: '<path d="M18.4 3.6a2 2 0 0 1 2.8 2.8L12 15.6 8.4 12z"/><path d="M8 13c-2.2 0-4 1.8-4 4 0 1.2-.5 2.2-1.5 3 3.5.5 8-.5 8-4"/>',
  sound: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 8.5a5 5 0 0 1 0 7M19.5 6a8.5 8.5 0 0 1 0 12"/>',
  judge: '<path d="M4 12.5l5 5L20 6.5"/>',
  calc: '<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8 7.5h8M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01"/>',
  data: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"/>',
  analysis: '<path d="M12 3v9h9"/><path d="M20.5 15.5A9 9 0 1 1 8.5 3.7"/>',
  text: '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>',
  expansion: '<path d="M9 4h4v2.5a1.5 1.5 0 0 0 3 0V4h4v6h-2.5a1.5 1.5 0 0 0 0 3H20v7h-6v-2.5a1.5 1.5 0 0 0-3 0V20H4v-7h2.5a1.5 1.5 0 0 0 0-3H4V4z"/>',
  func: '<path d="M15 4h-1.5A3.5 3.5 0 0 0 10 7.5V20M7 11h7"/><path d="M15 13l4 5M19 13l-4 5"/>',
};

function iconUrl(paths: string): string {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#000" '
    + `stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
  return `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}")`;
}

export const CATEGORY_LABELS: Record<Category, string> = {
  start: '시작',
  flow: '흐름',
  moving: '움직임',
  looks: '생김새',
  brush: '붓',
  sound: '소리',
  judge: '판단',
  calc: '계산',
  data: '자료',
  analysis: '자료분석',
  text: '글상자',
  expansion: '확장',
  func: '함수',
};

export const CATEGORY_ORDER: Category[] = [
  'start', 'flow', 'moving', 'looks', 'brush', 'sound',
  'judge', 'calc', 'data', 'analysis', 'text', 'expansion', 'func',
];

function blockStyles(): Record<string, Blockly.Theme.BlockStyle> {
  const styles: Record<string, Blockly.Theme.BlockStyle> = {};
  for (const [category, colour] of Object.entries(CATEGORY_COLOURS)) {
    styles[`${category}_blocks`] = {
      colourPrimary: colour,
      colourSecondary: shade(colour, 0.14),
      colourTertiary: shade(colour, -0.18),
      hat: category === 'start' ? 'cap' : undefined,
    } as Blockly.Theme.BlockStyle;
  }
  return styles;
}

/** Lightens (positive) or darkens (negative) a hex colour. */
function shade(hex: string, amount: number): string {
  const value = parseInt(hex.slice(1), 16);
  const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  const mixed = channels.map((channel) => {
    const target = amount >= 0 ? 255 : 0;
    return Math.round(channel + (target - channel) * Math.abs(amount));
  });
  return `#${mixed.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

export const tessTheme = Blockly.Theme.defineTheme('tess', {
  name: 'tess',
  base: Blockly.Themes.Zelos,
  blockStyles: blockStyles(),
  categoryStyles: Object.fromEntries(
    Object.entries(CATEGORY_COLOURS).map(([category, colour]) => [`${category}_category`, { colour }]),
  ),
  componentStyles: {
    workspaceBackgroundColour: '#fafbfc',
    toolboxBackgroundColour: '#ffffff',
    toolboxForegroundColour: '#16181d',
    flyoutBackgroundColour: '#f3f4f7',
    flyoutForegroundColour: '#16181d',
    flyoutOpacity: 1,
    scrollbarColour: '#d9dce3',
    scrollbarOpacity: 1,
    insertionMarkerColour: '#16181d',
    insertionMarkerOpacity: 0.3,
    markerColour: '#4f46e5',
    cursorColour: '#4f46e5',
  },
  fontStyle: {
    family: 'Pretendard, Inter, "Noto Sans KR", system-ui, sans-serif',
    weight: '600',
    size: 11.5,
  },
  startHats: true,
});

/**
 * Paints the toolbox icons. Blockly gives a category no class of its own, so the
 * icons are matched to `CATEGORY_ORDER` by position.
 */
export function installCategoryStyles(): void {
  const id = 'tess-category-style';
  if (document.getElementById(id)) return;
  const rules = CATEGORY_ORDER.map((category, index) => {
    const icon = iconUrl(CATEGORY_ICONS[category]);
    return `.blocklyToolboxCategoryGroup > *:nth-child(${index + 1}) .blocklyToolboxCategoryIcon`
      + `{background:${CATEGORY_COLOURS[category]};-webkit-mask:${icon} center/contain no-repeat;mask:${icon} center/contain no-repeat;}`;
  });
  const style = document.createElement('style');
  style.id = id;
  style.textContent = rules.join('\n');
  document.head.appendChild(style);
}
