// ============================================================================
//  되돌리기가 다루는 자료 구조
//
//  The input is a project.json someone else's editor wrote, so blocks and
//  entities are read through the loose types here rather than the compiler's
//  strict ones. Everything the decompiler builds for itself is typed exactly.
// ============================================================================

/**
 * A block read out of a work the decompiler did not build. Its slots hold
 * whatever the other editor wrote, so they are read as `any` and checked at
 * the point of use; everything the decompiler builds from them is typed.
 */
export interface RawBlock {
  type?: string;
  params?: any[];
  statements?: RawBlock[][];
  [key: string]: any;
}

/** Any entity from a project.json — read by name, never assumed complete. */
export type RawEntity = Record<string, any>;

/** One file taken out of the .ent tar. */
export interface TarEntry {
  name: string;
  data: Buffer;
}

/** A file the decompiler writes next to the source it produced. */
export interface CollectedAsset {
  path: string;
  data: Buffer;
}

/** A variable or list, with the Tess name chosen for it. */
export interface VarInfo {
  identifier: string;
  isList: boolean;
  objectId: string | null;
  source: RawEntity;
}

/** A costume or a sound, with the Tess name chosen for it. */
export interface ResourceInfo {
  identifier: string;
  source: RawEntity;
  owner: RawEntity;
  /** Where the file was written, once the assets have been collected. */
  relativePath?: string | null;
  /** Set on the 1x1 placeholder entry uses for a costume-less object. */
  blankImage?: boolean;
}

export interface SceneInfo {
  identifier: string;
  displayName: string;
}

export interface ObjectInfo {
  identifier: string;
  displayName: string;
  kind: string;
  sceneId: string;
}

export interface TableInfo {
  identifier: string;
  source: RawEntity;
}

/** A function local, with the Tess name chosen for it. */
export interface FunctionLocal {
  name: string;
  value: string | number;
}

/**
 * A function's head: its Tess name, parameters and locals. A boolean parameter
 * keeps its `?` suffix, the way the source spells it.
 */
export interface FunctionInfo {
  name: string;
  params: string[];
  locals: FunctionLocal[];
  displayLabel: string;
}

/** One link of the label/parameter chain an entry function head is made of. */
export type FunctionField =
  | { kind: 'label'; text: string }
  | { kind: 'param'; blockType: string | null; boolean: boolean };

/** A function that belongs to one object, ready to be written into it. */
export interface OwnedFunction {
  id: string;
  entry: FunctionInfo;
  createBlock: RawBlock;
}

/** How `decompileProject` should write the source. */
export interface DecompileOptions {
  /** Write `size W H` on every costume, not just the unmeasurable ones. */
  sizes?: boolean;
  /** Keep SVG costumes as SVG instead of the PNG entry captured on save. */
  keepSvg?: boolean;
}

/**
 * The id -> name tables every writer shares, plus the two flags that say where
 * in the work the writer currently is.
 */
export interface DecompileContext {
  warnings: Set<string>;
  allSizes: boolean;
  keepSvg: boolean;
  varsById: Map<string, VarInfo>;
  globalVars: VarInfo[];
  localVarsByObject: Map<string, VarInfo[]>;
  messagesById: Map<string, string>;
  tablesById: Map<string, TableInfo>;
  objectsById: Map<string, ObjectInfo>;
  scenesById: Map<string, SceneInfo>;
  functionsById: Map<string, FunctionInfo>;
  picturesById: Map<string, ResourceInfo>;
  soundsById: Map<string, ResourceInfo>;
  collectedAssets: CollectedAsset[];
  multiScene: boolean;
  forcedIds: Set<string>;
  functionOwnerById: Map<string, string>;
  functionsByOwner: Map<string, OwnedFunction[]>;
  inFunction: boolean;
  functionOwnerId: string | null;
  funcLocalsById: Map<string, string>;
  funcParamsByBlockType: Map<string, string>;
  varName(id: string): string;
  funcLocalName(id: string): string;
  funcParamName(blockType: string): string | null;
  pictureName(id: string): string;
  soundName(id: string): string;
  messageName(id: string): string;
  tableName(id: string): string;
}

/** What `decompileProject` produced. */
export interface DecompileResult {
  source: string;
  warnings: string[];
  assets: CollectedAsset[];
  name: string;
}
