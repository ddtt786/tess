export const PAINTER_CSS = `
:root {
  --pt-bg: #f8fafc;
  --pt-surface: #ffffff;
  --pt-surface-2: #f1f5f9;
  --pt-surface-subtle: #f8fafc;
  --pt-line: #e2e8f0;
  --pt-line-strong: #cbd5e1;
  --pt-text: #0f172a;
  --pt-text-2: #475569;
  --pt-text-3: #94a3b8;
  --pt-accent: #2563eb;
  --pt-accent-hover: #1d4ed8;
  --pt-accent-weak: #eff6ff;
  --pt-accent-border: #bfdbfe;
  --pt-danger: #ef4444;
  --pt-danger-weak: #fef2f2;
  --pt-danger-border: #fecaca;
  --pt-check: #e2e8f0;
  --pt-radius: 8px;
  --pt-radius-sm: 6px;
  --pt-font: "Pretendard", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans KR", sans-serif;
}

/* ------------------------------------------------------------------ *
 * Drawing surface
 * ------------------------------------------------------------------ */
.pt-root {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1 1 0;
  width: 100%;
  min-width: 0;
  min-height: 0;
  outline: none;
  background: var(--pt-bg);
  color: var(--pt-text);
  font-family: var(--pt-font);
  user-select: none;
  -webkit-user-select: none;
  touch-action: none;
  overscroll-behavior: contain;
}
.pt-viewport {
  position: relative;
  flex: 1 1 0;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  display: flex;
  align-items: safe center;
  justify-content: safe center;
  padding: 36px;
  scrollbar-width: thin;
  scrollbar-color: var(--pt-line-strong) transparent;
}
.pt-viewport::-webkit-scrollbar { width: 6px; height: 6px; }
.pt-viewport::-webkit-scrollbar-thumb {
  background: var(--pt-line-strong);
  border-radius: 99px;
}
.pt-viewport::-webkit-scrollbar-thumb:hover { background: var(--pt-text-3); }
.pt-viewport::-webkit-scrollbar-track { background: transparent; }

.pt-frame {
  position: relative;
  flex: 0 0 auto;
  border: 1px solid var(--pt-line-strong);
  background-color: #ffffff;
  background-image:
    linear-gradient(45deg, var(--pt-check) 25%, transparent 25%),
    linear-gradient(-45deg, var(--pt-check) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, var(--pt-check) 75%),
    linear-gradient(-45deg, transparent 75%, var(--pt-check) 75%);
  background-size: 16px 16px;
  background-position: 0 0, 0 8px, 8px -8px, -8px 0;
}
.pt-frame > svg,
.pt-frame > canvas { display: block; position: absolute; inset: 0; width: 100%; height: 100%; }
.pt-frame > canvas.pt-overlay-canvas { pointer-events: none; }
.pt-bitmap .pt-frame > canvas.pt-main-canvas { image-rendering: pixelated; }

/* selection & handles */
.pt-overlay { pointer-events: none; }
.pt-selection-box { fill: none; stroke: var(--pt-accent); stroke-width: 1.5; }
.pt-item-outline { fill: none; stroke: rgba(37, 99, 235, 0.4); stroke-width: 1.2; }
.pt-marquee { fill: rgba(37, 99, 235, 0.06); stroke: var(--pt-accent); stroke-width: 1.2; }
.pt-guide { stroke: #ff3d8b; pointer-events: none; }
.pt-handle { fill: #ffffff; stroke: var(--pt-accent); stroke-width: 1.5; }
.pt-handle-rotate { fill: var(--pt-accent); stroke: #ffffff; stroke-width: 1.5; }
.pt-handle-stem { stroke: var(--pt-accent); stroke-width: 1.2; }
.pt-handle-node.is-selected { fill: var(--pt-accent); stroke: #ffffff; }
.pt-handle-control { fill: #ffffff; stroke: #0891b2; stroke-width: 1.5; }
.pt-reshape-outline { fill: none; stroke: #0891b2; stroke-width: 1.2; }
.pt-eraser-preview { fill: rgba(37, 99, 235, 0.1); stroke: var(--pt-accent); stroke-width: 1.2; }
.pt-fill-preview {
  pointer-events: none;
  fill: url(#pt-fill-grid-pattern);
  stroke: var(--pt-accent);
  stroke-width: 1.5;
  stroke-dasharray: 4 3;
  animation: pt-preview-dash 1.2s linear infinite;
}
.pt-fill-stroke-preview {
  pointer-events: none;
  fill: none;
  stroke: var(--pt-accent);
  stroke-width: 2.5;
  stroke-dasharray: 4 3;
  animation: pt-preview-dash 1.2s linear infinite;
}
@keyframes pt-preview-dash {
  to {
    stroke-dashoffset: -7;
  }
}

.pt-text-editor {
  position: absolute;
  z-index: 30;
  margin: 0;
  padding: 2px 4px;
  border: 1px solid var(--pt-accent);
  border-radius: var(--pt-radius-sm);
  outline: none;
  background: rgba(255, 255, 255, 0.95);
  overflow: hidden;
  resize: none;
  white-space: pre;
  caret-color: currentColor;
}

/* ------------------------------------------------------------------ *
 * Shell
 * ------------------------------------------------------------------ */
.pt-app {
  display: flex;
  flex-direction: column;
  flex: 1 1 0;
  width: 100%;
  min-width: 0;
  min-height: 0;
  height: 100%;
  background: var(--pt-surface);
  color: var(--pt-text);
  font-family: var(--pt-font);
  font-size: 13px;
  line-height: 1.4;
  letter-spacing: -0.01em;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
.pt-app * { box-sizing: border-box; }
.pt-app button { font-family: inherit; }

.pt-topbar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 0 0 auto;
  height: 50px;
  padding: 0 16px;
  border-bottom: 1px solid var(--pt-line);
  background: var(--pt-surface);
}
.pt-doc { display: flex; align-items: center; gap: 8px; min-width: 0; }
.pt-doc-mark {
  width: 24px;
  height: 24px;
  flex: 0 0 auto;
  border-radius: var(--pt-radius-sm);
  background: var(--pt-text);
  color: #ffffff;
  display: flex;
  align-items: center;
  justify-content: center;
}
.pt-doc-name {
  width: 168px;
  height: 32px;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: var(--pt-radius-sm);
  background: transparent;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  color: inherit;
  letter-spacing: -0.01em;
  transition: all 120ms ease;
}
.pt-doc-name:hover { background: var(--pt-surface-2); }
.pt-doc-name:focus { outline: none; border-color: var(--pt-accent); background: #ffffff; }

.pt-spacer { flex: 1 1 auto; }

.pt-segmented {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 3px;
  border-radius: 9px;
  background: #f1f5f9;
  border: 1px solid var(--pt-line);
}
.pt-segmented button {
  min-width: 68px;
  height: 28px;
  padding: 0 14px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  color: var(--pt-text-2);
  cursor: pointer;
  transition: all 120ms ease;
}
.pt-segmented button:hover:not(.is-active):not(:disabled) { color: var(--pt-text); }
.pt-segmented button.is-active {
  background: #ffffff;
  color: var(--pt-text);
  font-weight: 600;
  border: 1px solid var(--pt-line);
}
.pt-segmented button:disabled { opacity: 0.5; cursor: progress; }

.pt-workspace { display: flex; flex: 1 1 0; width: 100%; min-width: 0; min-height: 0; }

/* tool rail --------------------------------------------------------- */
.pt-rail {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 56px;
  flex: 0 0 56px;
  padding: 10px 8px;
  border-right: 1px solid var(--pt-line);
  background: var(--pt-surface);
  overflow-y: auto;
  scrollbar-width: none;
}
.pt-rail::-webkit-scrollbar { width: 0; }
.pt-rail-tool {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid transparent;
  border-radius: var(--pt-radius);
  background: transparent;
  color: var(--pt-text-2);
  cursor: pointer;
  transition: all 120ms ease;
}
.pt-rail-tool:hover { background: var(--pt-surface-2); color: var(--pt-text); }
.pt-rail-tool.is-active {
  background: var(--pt-text);
  color: #ffffff;
  border-color: var(--pt-text);
}
.pt-rail-tool svg { width: 19px; height: 19px; }

.pt-stage { display: flex; flex: 1 1 0; min-width: 0; min-height: 0; }

/* inspector --------------------------------------------------------- */
.pt-inspector {
  width: 260px;
  flex: 0 0 260px;
  padding-bottom: 20px;
  border-left: 1px solid var(--pt-line);
  background: var(--pt-surface);
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--pt-line-strong) transparent;
}
.pt-inspector::-webkit-scrollbar { width: 6px; }
.pt-inspector::-webkit-scrollbar-thumb {
  background: var(--pt-line-strong);
  border-radius: 99px;
}
.pt-section {
  padding: 14px 16px 16px;
  border-bottom: 1px solid var(--pt-line);
}
.pt-section:last-child { border-bottom: 0; }
.pt-section-title {
  display: block;
  margin-bottom: 12px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--pt-text-3);
}
.pt-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}
.pt-row:first-of-type { margin-top: 0; }
.pt-row-label {
  flex: 0 0 46px;
  font-size: 12px;
  font-weight: 500;
  color: var(--pt-text-2);
}

/* controls ---------------------------------------------------------- */
.pt-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--pt-line);
  border-radius: var(--pt-radius-sm);
  background: var(--pt-surface);
  color: var(--pt-text);
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  transition: all 120ms ease;
}
.pt-btn > span { overflow: hidden; text-overflow: ellipsis; }
.pt-btn:hover:not(:disabled) {
  background: var(--pt-surface-2);
  border-color: var(--pt-line-strong);
  color: var(--pt-text);
}
.pt-btn:active:not(:disabled) { background: #e2e8f0; }
.pt-btn:disabled { opacity: 0.35; cursor: not-allowed; }
.pt-btn svg { width: 15px; height: 15px; flex: 0 0 auto; }
.pt-btn.is-icon { padding: 0; width: 100%; }
.pt-btn.is-active {
  background: var(--pt-text);
  border-color: var(--pt-text);
  color: #ffffff;
}
.pt-btn.is-danger {
  color: var(--pt-danger);
}
.pt-btn.is-danger:hover:not(:disabled) {
  background: var(--pt-danger-weak);
  border-color: var(--pt-danger-border);
  color: var(--pt-danger);
}

.pt-swatch {
  position: relative;
  display: flex;
  align-items: center;
  flex: 1 1 auto;
  height: 32px;
  padding: 3px;
  border: 1px solid var(--pt-line);
  border-radius: var(--pt-radius-sm);
  background: var(--pt-surface);
  cursor: pointer;
  transition: border-color 120ms ease;
}
.pt-swatch:hover { border-color: var(--pt-line-strong); }
.pt-swatch > span {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: 4px;
  border: 1px solid rgba(0, 0, 0, 0.08);
}
.pt-swatch input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  border: 0;
  padding: 0;
  cursor: pointer;
}
.pt-swatch.is-none > span {
  background: #ffffff !important;
  position: relative;
  overflow: hidden;
}
.pt-swatch.is-none > span::after {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(
    to top right,
    transparent calc(50% - 1.5px),
    #ef4444 calc(50% - 1.5px),
    #ef4444 calc(50% + 1.5px),
    transparent calc(50% + 1.5px)
  );
}

.pt-toggle {
  flex: 0 0 auto;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid var(--pt-line);
  border-radius: var(--pt-radius-sm);
  background: var(--pt-surface);
  color: var(--pt-text-2);
  cursor: pointer;
  transition: all 120ms ease;
}
.pt-toggle:hover {
  background: var(--pt-surface-2);
  border-color: var(--pt-line-strong);
  color: var(--pt-text);
}
.pt-toggle.is-active {
  background: var(--pt-surface-2);
  border-color: var(--pt-accent);
  color: var(--pt-accent);
}
.pt-toggle svg { width: 15px; height: 15px; }

.pt-field {
  display: flex;
  align-items: center;
  flex: 1 1 auto;
  min-width: 0;
  height: 32px;
  padding: 0 8px;
  border: 1px solid var(--pt-line);
  border-radius: var(--pt-radius-sm);
  background: var(--pt-surface);
  transition: border-color 120ms ease;
}
.pt-field:hover { border-color: var(--pt-line-strong); }
.pt-field:focus-within { border-color: var(--pt-accent); }
.pt-field input, .pt-field select {
  flex: 1 1 auto;
  min-width: 0;
  height: 100%;
  border: 0;
  background: transparent;
  font: inherit;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: inherit;
  outline: none;
  cursor: inherit;
}
.pt-field select { cursor: pointer; }
.pt-field input[type="number"] { -moz-appearance: textfield; }
.pt-field input::-webkit-outer-spin-button,
.pt-field input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.pt-field .pt-unit { padding-right: 4px; font-size: 11px; font-weight: 500; color: var(--pt-text-3); }

.pt-slider {
  flex: 1 1 auto;
  min-width: 0;
  height: 20px;
  -webkit-appearance: none;
  appearance: none;
  background: transparent;
  cursor: pointer;
}
.pt-slider::-webkit-slider-runnable-track {
  height: 4px;
  border-radius: 99px;
  background: var(--pt-line);
}
.pt-slider::-moz-range-track {
  height: 4px;
  border-radius: 99px;
  background: var(--pt-line);
}
.pt-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 14px;
  height: 14px;
  margin-top: -5px;
  border-radius: 50%;
  background: var(--pt-accent);
  border: 2px solid #ffffff;
  transition: transform 100ms ease;
}
.pt-slider::-moz-range-thumb {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--pt-accent);
  border: 2px solid #ffffff;
}
.pt-slider:hover::-webkit-slider-thumb {
  transform: scale(1.15);
  background: var(--pt-accent-hover);
}

/* status bar --------------------------------------------------------- */
.pt-statusbar {
  display: flex;
  align-items: center;
  gap: 16px;
  flex: 0 0 auto;
  height: 34px;
  padding: 0 16px;
  border-top: 1px solid var(--pt-line);
  background: var(--pt-surface);
  font-size: 11.5px;
  color: var(--pt-text-3);
  font-variant-numeric: tabular-nums;
}
.pt-status-item {
  color: var(--pt-text-2);
  font-size: 11.5px;
}
.pt-status-item b {
  font-weight: 600;
  color: var(--pt-text);
}
.pt-zoom {
  display: flex;
  align-items: center;
  gap: 3px;
}
.pt-zoom .pt-toggle {
  width: 26px;
  height: 24px;
  border: 1px solid transparent;
  border-radius: var(--pt-radius-sm);
}
.pt-zoom .pt-toggle:hover {
  background: var(--pt-surface-2);
  border-color: var(--pt-line);
}
.pt-zoom .pt-toggle svg { width: 13px; height: 13px; }
.pt-zoom-value {
  min-width: 50px;
  height: 24px;
  padding: 0 6px;
  border: 1px solid transparent;
  border-radius: var(--pt-radius-sm);
  background: transparent;
  font: inherit;
  font-size: 11.5px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--pt-text);
  text-align: center;
  cursor: pointer;
  transition: all 120ms ease;
}
.pt-zoom-value:hover {
  background: var(--pt-surface-2);
  border-color: var(--pt-line);
}
`;

let injected = false;

/** Adds the painter stylesheet once per document. */
export function injectStyles(
  doc: Document = typeof document !== "undefined" ? document : (null as never),
): void {
  if (injected || !doc) return;
  if (doc.getElementById("painter-styles")) {
    injected = true;
    return;
  }
  const style = doc.createElement("style");
  style.id = "painter-styles";
  style.textContent = PAINTER_CSS;
  doc.head.appendChild(style);
  injected = true;
}
