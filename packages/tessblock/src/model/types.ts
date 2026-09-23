/**
 * @fileoverview Editor project model.
 *
 * The shapes here describe what the editor edits, not what entry stores: the
 * block workspaces stay in Blockly's own serialization format, and everything
 * else is what the Tess writer needs to emit a source file.
 */

export type ObjectKind = 'sprite' | 'text';

export type RotateMethod = 'free' | 'vertical' | 'none';

export type TextAlign = 'left' | 'center' | 'right';

/** A costume file the object can wear. Sizes are in entry units. */
export interface Costume {
  id: string;
  name: string;
  url: string;
  width: number;
  height: number;
}

/** A sound file the object can play. Length is in seconds. */
export interface Sound {
  id: string;
  name: string;
  url: string;
  duration: number;
}

/** Placement and drawing state an object starts with. */
export interface ObjectProps {
  x: number;
  y: number;
  /** Width ratio in percent (`scale_x`). */
  scaleX: number;
  /** Height ratio in percent (`scale_y`). */
  scaleY: number;
  /** `angle` in Tess — where the object points. */
  angle: number;
  /** `way` in Tess — where it moves. */
  way: number;
  rotation: RotateMethod;
  visible: boolean;
  lock: boolean;
  /**
   * The spot on the costume that sits at x/y, in costume pixels from its top
   * left. Null keeps entry's default, the middle of the picture.
   */
  center: { x: number; y: number } | null;
}

/** Text box state. Only objects of kind `text` carry it. */
export interface TextProps {
  content: string;
  font: string;
  fontSize: number;
  color: string;
  bgColor: string | null;
  align: TextAlign;
  lineBreak: boolean;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  /** Box size in pixels, which entry measures by drawing the text. */
  boxWidth: number;
  boxHeight: number;
}

export interface TessObject {
  id: string;
  name: string;
  kind: ObjectKind;
  sceneId: string;
  costumes: Costume[];
  selectedCostumeId: string;
  sounds: Sound[];
  props: ObjectProps;
  text: TextProps | null;
  /** Blockly workspace state for this object's script. */
  blocks: BlocklyState | null;
}

export interface Scene {
  id: string;
  name: string;
  /** Folder the scene is filed under in the tab strip. Only for sorting; the work ignores it. */
  folder?: string | null;
}

export type VariableKind = 'variable' | 'list';

export type StorageScope = 'local' | 'shared' | 'realtime';

export interface VariableDef {
  id: string;
  name: string;
  kind: VariableKind;
  /** Object id for an object-owned variable, or null for a global one. */
  owner: string | null;
  value: string | number;
  array: Array<string | number>;
  visible: boolean;
  scope: StorageScope;
  /** Slider ends, for a slide variable. */
  slide: { min: number; max: number } | null;
}

export interface Signal {
  id: string;
  name: string;
}

export interface TableDef {
  id: string;
  name: string;
  columns: string[];
  rows: string[][];
}

export type FunctionParamKind = 'value' | 'boolean';

export interface FunctionParam {
  id: string;
  name: string;
  kind: FunctionParamKind;
}

export interface FunctionDef {
  id: string;
  name: string;
  /**
   * Object that keeps the function to itself (declared inside the object in
   * Tess, offered only in its palette); null or absent for a global one.
   */
  owner?: string | null;
  params: FunctionParam[];
  /** Blockly workspace state holding the definition block and its body. */
  blocks: BlocklyState | null;
}

/** Blockly's own serialized workspace. Kept opaque on purpose. */
export type BlocklyState = Record<string, unknown>;

export interface TessProject {
  name: string;
  description: string;
  fps: number;
  scenes: Scene[];
  objects: TessObject[];
  variables: VariableDef[];
  signals: Signal[];
  functions: FunctionDef[];
  tables: TableDef[];
}
