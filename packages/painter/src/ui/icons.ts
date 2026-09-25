const wrap = (body: string): string =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ` +
  `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

/** Inline SVG icons for the built-in toolbar. */
export const icons: Record<string, string> = {
  select: wrap('<path d="M5 3l6.5 16 2.2-6.3L20 10.5z" fill="currentColor" stroke="none"/>'),
  reshape: wrap(
    '<path d="M6 19c0-7 5-12 12-12" /><rect x="3" y="16" width="5" height="5" rx="1" fill="#fff"/>' +
      '<rect x="16" y="3" width="5" height="5" rx="1" fill="currentColor"/>',
  ),
  brush: wrap('<path d="M4 20c3 .5 5-1 5-3.5S7 13 6.5 11.5C9 8 14 4.5 18.5 3.2c1.6-.5 2.7.7 2.1 2.2C19 10 15.5 15 12 17.5 10.5 17 8.5 16 6.5 16" />'),
  eraser: wrap('<path d="M8.5 20H20"/><path d="M15.5 4.5l4 4a1.5 1.5 0 010 2.1L11 19.2a1.5 1.5 0 01-2.1 0l-4-4a1.5 1.5 0 010-2.1l8.5-8.6a1.5 1.5 0 012.1 0z"/><path d="M9.5 9.5l5 5"/>'),
  fill: wrap('<path d="M12.5 3.5l7.2 7.2a1.5 1.5 0 010 2.1l-6.6 6.6a1.5 1.5 0 01-2.1 0L3.8 12.2a1.5 1.5 0 010-2.1l6-6z"/><path d="M8 7l7.5 7.5"/><path d="M20 16.5c1 1.4 1.6 2.4 1.6 3.1a1.6 1.6 0 01-3.2 0c0-.7.6-1.7 1.6-3.1z" fill="currentColor" stroke="none"/>'),
  text: wrap('<path d="M5 6V4.5h14V6"/><path d="M12 4.5v15"/><path d="M9 19.5h6"/>'),
  line: wrap('<path d="M4.5 19.5L19.5 4.5"/>'),
  ellipse: wrap('<ellipse cx="12" cy="12" rx="8.5" ry="8.5"/>'),
  rect: wrap('<rect x="3.5" y="3.5" width="17" height="17" rx="1.5"/>'),
  marquee: wrap('<rect x="3.5" y="3.5" width="17" height="17" rx="1" stroke-dasharray="3 2.5"/>'),

  undo: wrap('<path d="M4 9h9a6 6 0 010 12h-3"/><path d="M8 4.5L3.5 9 8 13.5"/>'),
  redo: wrap('<path d="M20 9h-9a6 6 0 000 12h3"/><path d="M16 4.5L20.5 9 16 13.5"/>'),
  group: wrap('<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/><path d="M11 7h4a2 2 0 012 2v4" stroke-dasharray="2.5 2"/>'),
  ungroup: wrap('<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/><path d="M12 12l-1.5 1.5M12 12l1.5-1.5" />'),
  forward: wrap('<path d="M12 20V6"/><path d="M6.5 11.5L12 6l5.5 5.5"/>'),
  backward: wrap('<path d="M12 4v14"/><path d="M17.5 12.5L12 18l-5.5-5.5"/>'),
  front: wrap('<path d="M4 4h16"/><path d="M12 21V8"/><path d="M6.5 13.5L12 8l5.5 5.5"/>'),
  back: wrap('<path d="M4 20h16"/><path d="M12 3v13"/><path d="M17.5 10.5L12 16l-5.5-5.5"/>'),
  copy: wrap('<rect x="8.5" y="8.5" width="12" height="12" rx="1.5"/><path d="M15.5 5.5v-1a1 1 0 00-1-1h-10a1 1 0 00-1 1v10a1 1 0 001 1h1"/>'),
  paste: wrap('<rect x="5" y="5" width="14" height="16" rx="1.5"/><path d="M9 5V3.5h6V5"/><path d="M9 11h6M9 15h4"/>'),
  trash: wrap('<path d="M4.5 6.5h15"/><path d="M9 6.5V4.5h6v2"/><path d="M6.5 6.5l1 13h9l1-13"/><path d="M10 10v6M14 10v6"/>'),
  flipH: wrap('<path d="M12 3v18" stroke-dasharray="3 2.5"/><path d="M9.5 7L4 12l5.5 5z" fill="currentColor"/><path d="M14.5 7L20 12l-5.5 5z"/>'),
  flipV: wrap('<path d="M3 12h18" stroke-dasharray="3 2.5"/><path d="M7 9.5L12 4l5 5.5z" fill="currentColor"/><path d="M7 14.5L12 20l5-5.5z"/>'),
  selectAll: wrap('<rect x="3.5" y="3.5" width="17" height="17" rx="1" stroke-dasharray="3 2.5"/><path d="M8 12.5l3 3 5-6"/>'),
  zoomIn: wrap('<circle cx="11" cy="11" r="6.5"/><path d="M11 8.5v5M8.5 11h5"/><path d="M16 16l4.5 4.5"/>'),
  zoomOut: wrap('<circle cx="11" cy="11" r="6.5"/><path d="M8.5 11h5"/><path d="M16 16l4.5 4.5"/>'),
  zoomReset: wrap('<circle cx="11" cy="11" r="6.5"/><path d="M8 11h6"/><path d="M8 13.5h6"/><path d="M16 16l4.5 4.5"/>'),
  convert: wrap('<rect x="3" y="4" width="8.5" height="7" rx="1"/><rect x="12.5" y="13" width="8.5" height="7" rx="1"/><path d="M7.5 11v4a2 2 0 002 2h3"/><path d="M11 14.5L12.5 17 11 19.5" fill="none"/>'),
  duplicate: wrap('<rect x="3.5" y="3.5" width="12" height="12" rx="1.5"/><rect x="8.5" y="8.5" width="12" height="12" rx="1.5"/>'),
  deselect: wrap('<rect x="3.5" y="3.5" width="17" height="17" rx="1" stroke-dasharray="3 2.5"/><path d="M9 9l6 6M15 9l-6 6"/>'),
  alignLeft: wrap('<path d="M4 5h16M4 10h10M4 15h14M4 20h8"/>'),
  alignCenter: wrap('<path d="M4 5h16M7 10h10M5 15h14M8 20h8"/>'),
  alignRight: wrap('<path d="M4 5h16M10 10h10M6 15h14M12 20h8"/>'),
  zoomFit: wrap('<path d="M3.5 8.5v-5h5M20.5 8.5v-5h-5M3.5 15.5v5h5M20.5 15.5v5h-5"/><rect x="8" y="8" width="8" height="8" rx="1"/>'),
  none: wrap('<circle cx="12" cy="12" r="8.5"/><path d="M6 18L18 6"/>'),
};

export function icon(name: keyof typeof icons | string): string {
  return icons[name] ?? '';
}
