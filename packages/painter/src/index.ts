/**
 * painter — an SVG + bitmap paint library.
 *
 * Built on perfect-freehand (strokes), SVG.js (vector scene) and clipper2-ts
 * (boolean geometry: eraser, outlining, simplification).
 */

export { Painter } from "./Painter.js";
export type { PainterOptions } from "./Painter.js";

export { VectorPainter, type LayerInfo, type GradientFill, type DashStyle } from './vector/VectorPainter.js';
export type {
  VectorPainterOptions,
  VectorSnapshot,
  HitResult,
  FillRegionOptions,
  FillPreviewTarget,
} from "./vector/VectorPainter.js";

export { BitmapPainter } from "./bitmap/BitmapPainter.js";
export type { BitmapPainterOptions } from "./bitmap/BitmapPainter.js";
export { FloatingSelection } from "./bitmap/floating.js";
export { floodFill } from "./bitmap/flood-fill.js";
export type { FloodFillOptions } from "./bitmap/flood-fill.js";

export { PainterUI, createPainterUI } from "./ui/Toolbar.js";
export type { PainterUIOptions } from "./ui/Toolbar.js";
export { PAINTER_CSS, injectStyles } from "./ui/styles.js";
export { icons, icon } from "./ui/icons.js";

/* Core building blocks, useful when composing a custom UI or new tools. */
export * from "./core/types.js";
export { Emitter } from "./core/emitter.js";
export { History } from "./core/history.js";
export type { HistoryOptions } from "./core/history.js";
export { BaseTool } from "./core/tool.js";
export type { Tool } from "./core/tool.js";
export { bindPointer } from "./core/pointer.js";
export { handleViewShortcut } from "./core/shortcuts.js";
export type { ZoomTarget } from "./core/shortcuts.js";
export type { PointerHost } from "./core/pointer.js";
export { TextEditor } from "./core/text-editor.js";
export * from "./core/geom.js";
export * from "./core/color.js";
export * from "./core/freehand.js";
export * from "./core/path-data.js";
export {
  unionRings,
  differenceRings,
  intersectRings,
  xorRings,
  inflateRings,
  outlineRings,
  outlinePolyline,
  simplifyRings,
  ringsArea,
  ringsOverlap,
  circleRing,
  FillRule,
  JoinType,
  EndType,
} from "./core/clipper.js";
export {
  setClipboard,
  getClipboard,
  hasClipboard,
  clearClipboard,
} from "./core/clipboard.js";
export type {
  ClipboardPayload,
  VectorClip,
  BitmapClip,
} from "./core/clipboard.js";

/* Vector <-> bitmap conversion. */
export {
  rasterizeSVG,
  svgToImageData,
  imageDataToLayers,
  layersToSVG,
  traceImageData,
  traceMask,
  quantize,
  floodRegion,
  inkMask,
} from "./convert/index.js";
export type {
  VectorizeOptions,
  VectorLayer,
  TraceOptions,
  TracedLayer,
  RegionResult,
} from "./convert/index.js";
export { whenDecoded, loadImageElement } from "./convert/decode.js";

/* Vector scene helpers (hit-testing, geometry extraction, styling). */
export {
  itemGeometry,
  readStyle,
  applyStyle,
  boundsIn,
  paintBoundsIn,
  elementMatrixTo,
  textRings,
  isItemNode,
  ensurePid,
} from "./vector/scene.js";
export type { ItemGeometry } from "./vector/scene.js";

export {
  handlePoint,
  HANDLE_KINDS,
  HANDLE_CURSORS,
  rotateMatrixFor,
  scaleMatrixFor,
  selectionBounds,
} from "./vector/selection.js";
export type { HandleKind } from "./vector/selection.js";
