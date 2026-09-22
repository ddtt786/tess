/**
 * @fileoverview Block colours and workspace chrome.
 *
 * Hues follow entry's families so the categories stay recognisable, at a
 * lower saturation that holds up next to the editor's own surfaces.
 */
import * as Blockly from 'blockly/core';
import type { Category } from './spec.ts';

export const CATEGORY_COLOURS: Record<Category, string> = {
  start: '#16a34a',
  flow: '#0d9488',
  moving: '#4f46e5',
  looks: '#db2777',
  brush: '#ea580c',
  sound: '#7c3aed',
  judge: '#0284c7',
  calc: '#ca8a04',
  data: '#dc2626',
  analysis: '#475569',
  text: '#92400e',
  func: '#c026d3',
};

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
  func: '함수',
};

export const CATEGORY_ORDER: Category[] = [
  'start', 'flow', 'moving', 'looks', 'brush', 'sound',
  'judge', 'calc', 'data', 'analysis', 'text', 'func',
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
 * Paints the toolbox dots. Blockly gives a category no class of its own, so the
 * colours are matched to `CATEGORY_ORDER` by position.
 */
export function installCategoryStyles(): void {
  const id = 'tess-category-style';
  if (document.getElementById(id)) return;
  const rules = CATEGORY_ORDER.map((category, index) => (
    `.blocklyToolboxCategoryGroup > *:nth-child(${index + 1}) .blocklyToolboxCategoryIcon`
    + `{background:${CATEGORY_COLOURS[category]};}`
  ));
  const style = document.createElement('style');
  style.id = id;
  style.textContent = rules.join('\n');
  document.head.appendChild(style);
}
