/**
 * 디컴파일러에서 다루는 자료 구조를 정의합니다.
 * 입력 프로젝트의 데이터는 느슨한 타입으로 읽히며, 디컴파일러가 내부적으로 생성하는 데이터는 엄격한 타입을 가집니다.
 */

/**
 * 외부 편집기에서 작성된 원시 블록 데이터를 나타냅니다.
 * 슬롯에 들어있는 값은 `any` 타입으로 읽어들이며 사용 시점에 타입을 검사합니다.
 * 
 * @example
 * const block: RawBlock = { type: "number", params: [10] };
 */
export interface RawBlock {
  type?: string;
  params?: any[];
  statements?: RawBlock[][];
  [key: string]: any;
}

/**
 * 프로젝트 내의 임의의 엔티티를 나타냅니다.
 * 
 * @example
 * const entity: RawEntity = { name: "Object1", type: "sprite" };
 */
export type RawEntity = Record<string, any>;

/**
 * 아카이브(.ent) 파일에서 추출한 단일 파일 정보를 나타냅니다.
 * 
 * @example
 * const entry: TarEntry = { name: "image.png", data: Buffer.from([0, 1]) };
 */
export interface TarEntry {
  name: string;
  data: Buffer;
}

/**
 * 디컴파일러가 소스 코드와 함께 출력하는 에셋 파일을 나타냅니다.
 * 
 * @example
 * const asset: CollectedAsset = { path: "./assets/image.png", data: Buffer.from([0, 1]) };
 */
export interface CollectedAsset {
  path: string;
  data: Buffer;
}

/**
 * 변수 또는 리스트와 변환된 Tess 이름을 나타냅니다.
 * 
 * @example
 * const varInfo: VarInfo = { identifier: "myVar", isList: false, objectId: null, source: {} };
 */
export interface VarInfo {
  identifier: string;
  isList: boolean;
  objectId: string | null;
  source: RawEntity;
}

/**
 * 모양(costume)이나 소리(sound)와 변환된 Tess 이름을 나타냅니다.
 * 
 * @example
 * const resource: ResourceInfo = { identifier: "sound1", source: {}, owner: {} };
 */
export interface ResourceInfo {
  identifier: string;
  source: RawEntity;
  owner: RawEntity;
  /**
   * 에셋 수집 후 파일이 기록된 상대 경로입니다.
   * 
   * @example
   * resource.relativePath = "sounds/jump.mp3";
   */
  relativePath?: string | null;
  /**
   * 모양이 없는 오브젝트를 위한 1x1 크기의 자리표시자 이미지 여부입니다.
   * 
   * @example
   * resource.blankImage = true;
   */
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

/**
 * 지역 함수 변수와 변환된 Tess 이름을 나타냅니다.
 * 
 * @example
 * const local: FunctionLocal = { name: "localIndex", value: 0 };
 */
export interface FunctionLocal {
  name: string;
  value: string | number;
}

/**
 * 함수의 이름, 매개변수, 지역 변수 등 함수의 선언부(Head) 정보를 나타냅니다.
 * 논리형 매개변수는 원본 표기법과 동일하게 `?` 접미사를 유지합니다.
 * 
 * @example
 * const funcInfo: FunctionInfo = { name: "jump", params: ["height"], locals: [], displayLabel: "Jump {height}" };
 */
export interface FunctionInfo {
  name: string;
  params: string[];
  locals: FunctionLocal[];
  displayLabel: string;
}

/**
 * 함수 선언부를 구성하는 레이블 또는 매개변수 체인의 단일 항목입니다.
 * 
 * @example
 * const field: FunctionField = { kind: 'label', text: '점프하기' };
 */
export type FunctionField =
  | { kind: 'label'; text: string }
  | { kind: 'param'; blockType: string | null; boolean: boolean };

/**
 * 특정 오브젝트에 속하여 해당 오브젝트 내에 기록될 준비가 완료된 함수를 나타냅니다.
 * 
 * @example
 * const func: OwnedFunction = { id: "func1", entry: funcInfo, createBlock: block };
 */
export interface OwnedFunction {
  id: string;
  entry: FunctionInfo;
  createBlock: RawBlock;
}

/**
 * 프로젝트 디컴파일 시 소스 코드 출력 방식을 설정하는 옵션입니다.
 * 
 * @example
 * const options: DecompileOptions = { sizes: true, keepSvg: false };
 */
export interface DecompileOptions {
  /**
   * 크기를 측정할 수 없는 경우뿐만 아니라 모든 모양(costume)에 대해 `size W H` 정보를 기록할지 여부입니다.
   * 
   * @example
   * options.sizes = true;
   */
  sizes?: boolean;
  /**
   * SVG 모양을 저장할 때 캡처된 PNG로 변환하지 않고 SVG 원본 형식으로 유지할지 여부입니다.
   * 
   * @example
   * options.keepSvg = true;
   */
  keepSvg?: boolean;
}

/**
 * 디컴파일 과정에서 모든 출력 작성기가 공유하는 컨텍스트 정보입니다.
 * 식별자 매핑 테이블과 현재 작업 위치 등의 상태를 포함합니다.
 * 
 * @example
 * const ctx: DecompileContext = { ... };
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

/**
 * 프로젝트 디컴파일 결과를 나타냅니다.
 * 
 * @example
 * const result: DecompileResult = { source: "...", warnings: [], assets: [], name: "Project" };
 */
export interface DecompileResult {
  source: string;
  warnings: string[];
  assets: CollectedAsset[];
  name: string;
}
