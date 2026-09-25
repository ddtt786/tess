/** 2D point in user (scene) coordinates. */
export interface Point {
  x: number;
  y: number;
}

/** A pointer sample: position plus pen pressure (0..1). */
export interface InputPoint extends Point {
  pressure: number;
}

/** A closed polygon ring. */
export type Ring = Point[];
/** A set of rings. Even-odd / non-zero interpretation depends on the consumer. */
export type Rings = Ring[];

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Paint style applied to newly created items and to the current selection. */
export interface PaintStyle {
  /** CSS colour, or `null` for "no fill". */
  fill: string | null;
  /** CSS colour, or `null` for "no outline". */
  stroke: string | null;
  /** Outline width in user units. */
  strokeWidth: number;
}

/** perfect-freehand tuning shared by the vector brush and the bitmap brush. */
export interface BrushOptions {
  /** Diameter of the stroke at full pressure. */
  size: number;
  /** How much pressure affects width (0..1). */
  thinning: number;
  /** Corner smoothing (0..1). */
  smoothing: number;
  /** Input jitter damping (0..1). */
  streamline: number;
  /** Fake pressure from velocity when the device reports none. */
  simulatePressure: boolean;
  /** Taper length (user units) at the start / end of the stroke. */
  taperStart: number;
  taperEnd: number;
}

export const defaultBrushOptions = (size = 8): BrushOptions => ({
  size,
  thinning: 0.55,
  smoothing: 0.52,
  streamline: 0.45,
  simulatePressure: true,
  taperStart: 0,
  taperEnd: 0,
});

export interface TextStyle {
  fontFamily: string;
  fontSize: number;
  fontWeight: string | number;
  fontStyle: 'normal' | 'italic';
  align: 'left' | 'center' | 'right';
}

export const defaultTextStyle = (): TextStyle => ({
  fontFamily: 'Helvetica, Arial, sans-serif',
  fontSize: 42,
  fontWeight: 'normal',
  fontStyle: 'normal',
  align: 'left',
});

export type PainterMode = 'vector' | 'bitmap';

export type VectorToolName =
  | 'select'
  | 'reshape'
  | 'brush'
  | 'eraser'
  | 'fill'
  | 'text'
  | 'line'
  | 'ellipse'
  | 'rect';

export type BitmapToolName =
  | 'brush'
  | 'line'
  | 'ellipse'
  | 'rect'
  | 'text'
  | 'fill'
  | 'eraser'
  | 'select';

export type ToolName = VectorToolName | BitmapToolName;

/** Normalised pointer event handed to tools. */
export interface PointerInfo {
  /** Position in scene (document) coordinates. */
  x: number;
  y: number;
  /** Position where the gesture started, scene coordinates. */
  startX: number;
  startY: number;
  /** Raw client coordinates, for DOM hit-testing. */
  clientX: number;
  clientY: number;
  pressure: number;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  /** `true` for the secondary (usually right) button. */
  secondary: boolean;
  pointerId: number;
  /** Original DOM event. */
  native: PointerEvent;
}

export interface PainterEvents {
  /** Document contents changed (a new history entry was committed). */
  change: void;
  /** Selection contents changed. */
  selectionchange: void;
  /** Active tool changed. */
  toolchange: ToolName;
  /** Fill / outline / width / brush / text style changed. */
  stylechange: void;
  /** Undo / redo availability changed. */
  historychange: { canUndo: boolean; canRedo: boolean };
  /** Zoom or pan changed. */
  viewchange: { zoom: number };
  /** Vector <-> bitmap switch (Painter facade only). */
  modechange: PainterMode;
  /** A tool asked the host to switch back to the select tool, etc. */
  toolrequest: ToolName;
  /** Layers were added, removed, reordered, renamed, shown or hidden, or another one picked. */
  layerchange: void;
}
