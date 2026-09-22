/**
 * @fileoverview Editor state: one project signal plus the actions that change
 * it. Components read the signals; nothing else holds project data.
 */
import { computed, signal } from '@preact/signals';
import { newId } from './ids.ts';
import { COSTUME_LIBRARY, costumeFrom, makeScene, makeSprite, makeTextBox, starterProject } from './defaults.ts';
import type {
  BlocklyState, Costume, FunctionDef, ObjectProps, Sound, TableDef, TessObject, TessProject,
  TextProps, VariableDef, VariableKind,
} from './types.ts';

const STORAGE_KEY = 'tessblock.project.v1';

export const project = signal<TessProject>(loadProject());
export const selectedSceneId = signal<string>(project.value.scenes[0]?.id ?? '');
export const selectedObjectId = signal<string>(
  project.value.objects.find((object) => object.sceneId === selectedSceneId.value)?.id ?? '',
);

export const currentScene = computed(
  () => project.value.scenes.find((scene) => scene.id === selectedSceneId.value) ?? project.value.scenes[0],
);

export const sceneObjects = computed(() =>
  project.value.objects.filter((object) => object.sceneId === selectedSceneId.value),
);

export const selectedObject = computed(
  () => project.value.objects.find((object) => object.id === selectedObjectId.value) ?? null,
);

/** Variables the selected object can see: its own, plus every global one. */
export const visibleVariables = computed(() =>
  project.value.variables.filter((variable) => !variable.owner || variable.owner === selectedObjectId.value),
);

export function update(change: (draft: TessProject) => TessProject | void): void {
  const draft = structuredClone(project.value) as TessProject;
  const next = change(draft) ?? draft;
  project.value = next;
  saveSoon();
}

function patchObject(id: string, change: (object: TessObject) => void): void {
  update((draft) => {
    const object = draft.objects.find((candidate) => candidate.id === id);
    if (object) change(object);
  });
}

// --- scenes -----------------------------------------------------------------

/** A name no object in the work is using yet. */
function freeName(base: string): string {
  const taken = new Set(project.value.objects.map((object) => object.name));
  if (!taken.has(base)) return base;
  let index = 2;
  while (taken.has(`${base} ${index}`)) index += 1;
  return `${base} ${index}`;
}

export function addScene(): void {
  const scene = makeScene(`장면 ${project.value.scenes.length + 1}`);
  const object = makeSprite(freeName('로봇'), scene.id);
  update((draft) => {
    draft.scenes.push(scene);
    draft.objects.push(object);
  });
  selectedSceneId.value = scene.id;
  selectedObjectId.value = object.id;
}

export function removeScene(id: string): void {
  if (project.value.scenes.length <= 1) return;
  update((draft) => {
    draft.scenes = draft.scenes.filter((scene) => scene.id !== id);
    draft.objects = draft.objects.filter((object) => object.sceneId !== id);
  });
  if (selectedSceneId.value === id) {
    selectedSceneId.value = project.value.scenes[0]?.id ?? '';
    selectedObjectId.value = project.value.objects.find((object) => object.sceneId === selectedSceneId.value)?.id ?? '';
  }
}

export function renameScene(id: string, name: string): void {
  update((draft) => {
    const scene = draft.scenes.find((candidate) => candidate.id === id);
    if (scene) scene.name = name;
  });
}

export function selectScene(id: string): void {
  selectedSceneId.value = id;
  const first = project.value.objects.find((object) => object.sceneId === id);
  selectedObjectId.value = first?.id ?? '';
}

// --- objects ----------------------------------------------------------------

export function addObject(kind: 'sprite' | 'text' = 'sprite', costumeIndex = 0): void {
  const scene = selectedSceneId.value;
  const template = COSTUME_LIBRARY[costumeIndex % COSTUME_LIBRARY.length]!;
  const name = freeName(kind === 'sprite' ? '오브젝트' : '글상자');
  const object = kind === 'sprite' ? makeSprite(name, scene, template) : makeTextBox(name, scene);
  update((draft) => {
    draft.objects.unshift(object);
  });
  selectedObjectId.value = object.id;
}

export function removeObject(id: string): void {
  update((draft) => {
    draft.objects = draft.objects.filter((object) => object.id !== id);
    draft.variables = draft.variables.filter((variable) => variable.owner !== id);
  });
  if (selectedObjectId.value === id) {
    selectedObjectId.value = sceneObjects.value[0]?.id ?? '';
  }
}

export function selectObject(id: string): void {
  selectedObjectId.value = id;
}

export function renameObject(id: string, name: string): void {
  patchObject(id, (object) => {
    object.name = name;
  });
}

export function setObjectProps(id: string, patch: Partial<ObjectProps>): void {
  patchObject(id, (object) => {
    object.props = { ...object.props, ...patch };
  });
}

export function setTextProps(id: string, patch: Partial<TextProps>): void {
  patchObject(id, (object) => {
    if (object.text) object.text = { ...object.text, ...patch };
  });
}

/** Drops an object above or below another one in the list. */
export function reorderObject(id: string, targetId: string, before = true): void {
  if (id === targetId) return;
  update((draft) => {
    const from = draft.objects.findIndex((object) => object.id === id);
    if (from < 0) return;
    const [moved] = draft.objects.splice(from, 1);
    const to = draft.objects.findIndex((object) => object.id === targetId);
    if (to < 0) draft.objects.push(moved!);
    else draft.objects.splice(before ? to : to + 1, 0, moved!);
  });
}

/** Moves an object within its scene. Earlier in the list means nearer the front. */
export function moveObject(id: string, delta: number): void {
  update((draft) => {
    const index = draft.objects.findIndex((object) => object.id === id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= draft.objects.length) return;
    const [object] = draft.objects.splice(index, 1);
    draft.objects.splice(target, 0, object!);
  });
}

export function setObjectBlocks(id: string, blocks: BlocklyState): void {
  patchObject(id, (object) => {
    object.blocks = blocks;
  });
}

export function addCostume(id: string, index: number): void {
  const template = COSTUME_LIBRARY[index % COSTUME_LIBRARY.length]!;
  patchObject(id, (object) => {
    const costume = costumeFrom(template);
    object.costumes.push(costume);
    if (!object.selectedCostumeId) object.selectedCostumeId = costume.id;
  });
}

/** An empty costume to draw on, the size of the stage by default. */
export function addBlankCostume(objectId: string, width = 240, height = 180): string {
  const costume: Costume = { id: newId('c'), name: '새 모양', url: blankCostume(width, height), width, height };
  patchObject(objectId, (object) => {
    object.costumes.push(costume);
    object.selectedCostumeId = costume.id;
  });
  return costume.id;
}

function blankCostume(width: number, height: number): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" `
    + `viewBox="0 0 ${width} ${height}"></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function updateCostume(objectId: string, costumeId: string, patch: Partial<Costume>): void {
  patchObject(objectId, (object) => {
    const index = object.costumes.findIndex((costume) => costume.id === costumeId);
    if (index >= 0) object.costumes[index] = { ...object.costumes[index]!, ...patch };
  });
}

export function removeCostume(objectId: string, costumeId: string): void {
  patchObject(objectId, (object) => {
    if (object.costumes.length <= 1) return;
    object.costumes = object.costumes.filter((costume) => costume.id !== costumeId);
    if (object.selectedCostumeId === costumeId) object.selectedCostumeId = object.costumes[0]!.id;
  });
}

export function selectCostume(objectId: string, costumeId: string): void {
  patchObject(objectId, (object) => {
    object.selectedCostumeId = costumeId;
  });
}

export function addSound(objectId: string, sound: Omit<Sound, 'id'>): void {
  patchObject(objectId, (object) => {
    object.sounds.push({ id: newId('snd'), ...sound });
  });
}

export function removeSound(objectId: string, soundId: string): void {
  patchObject(objectId, (object) => {
    object.sounds = object.sounds.filter((sound) => sound.id !== soundId);
  });
}

// --- variables, signals, tables ---------------------------------------------

export function addVariable(name: string, kind: VariableKind, owner: string | null): VariableDef {
  const variable: VariableDef = {
    id: newId('v'),
    name,
    kind,
    owner,
    value: kind === 'list' ? '' : 0,
    array: [],
    visible: false,
    scope: 'local',
    slide: null,
  };
  update((draft) => {
    draft.variables.push(variable);
  });
  return variable;
}

export function updateVariable(id: string, patch: Partial<VariableDef>): void {
  update((draft) => {
    const index = draft.variables.findIndex((variable) => variable.id === id);
    if (index >= 0) draft.variables[index] = { ...draft.variables[index]!, ...patch };
  });
}

export function removeVariable(id: string): void {
  update((draft) => {
    draft.variables = draft.variables.filter((variable) => variable.id !== id);
  });
}

export function addSignal(name: string): void {
  update((draft) => {
    if (draft.signals.some((signalDef) => signalDef.name === name)) return;
    draft.signals.push({ id: newId('sig'), name });
  });
}

export function removeSignal(id: string): void {
  update((draft) => {
    draft.signals = draft.signals.filter((signalDef) => signalDef.id !== id);
  });
}

export function addTable(name: string): void {
  update((draft) => {
    draft.tables.push({ id: newId('t'), name, columns: ['이름', '값'], rows: [['가', '1']] });
  });
}

export function updateTable(id: string, patch: Partial<TableDef>): void {
  update((draft) => {
    const index = draft.tables.findIndex((table) => table.id === id);
    if (index >= 0) draft.tables[index] = { ...draft.tables[index]!, ...patch };
  });
}

/** Moves a scene to another place in the tab strip. */
export function reorderScene(id: string, targetId: string, before = true): void {
  if (id === targetId) return;
  update((draft) => {
    const from = draft.scenes.findIndex((scene) => scene.id === id);
    if (from < 0) return;
    const [moved] = draft.scenes.splice(from, 1);
    const to = draft.scenes.findIndex((scene) => scene.id === targetId);
    if (to < 0) draft.scenes.push(moved!);
    else draft.scenes.splice(before ? to : to + 1, 0, moved!);
  });
}

export function removeTable(id: string): void {
  update((draft) => {
    draft.tables = draft.tables.filter((table) => table.id !== id);
  });
}

// --- functions --------------------------------------------------------------

export function addFunction(definition: FunctionDef): void {
  update((draft) => {
    draft.functions.push(definition);
  });
}

export function saveFunction(definition: FunctionDef): void {
  update((draft) => {
    const index = draft.functions.findIndex((candidate) => candidate.id === definition.id);
    if (index >= 0) draft.functions[index] = definition;
    else draft.functions.push(definition);
  });
}

export function removeFunction(id: string): void {
  update((draft) => {
    draft.functions = draft.functions.filter((definition) => definition.id !== id);
  });
}

// --- project ----------------------------------------------------------------

export function setProjectName(name: string): void {
  update((draft) => {
    draft.name = name;
  });
}

export function setFps(fps: number): void {
  update((draft) => {
    draft.fps = fps;
  });
}

export function replaceProject(next: TessProject): void {
  project.value = next;
  selectedSceneId.value = next.scenes[0]?.id ?? '';
  selectedObjectId.value = next.objects.find((object) => object.sceneId === selectedSceneId.value)?.id ?? '';
  saveSoon();
}

export function resetProject(): void {
  replaceProject(starterProject());
}

// --- persistence ------------------------------------------------------------

let saveTimer: number | undefined;

function saveSoon(): void {
  if (saveTimer !== undefined) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(project.value));
    } catch {
      // Storage is full or blocked; the project stays in memory.
    }
  }, 400) as unknown as number;
}

/** Fills in fields a project saved by an older editor does not have. */
function migrateObject(object: TessObject): TessObject {
  const props = object.props as ObjectProps & { size?: number };
  const size = props.size ?? 100;
  return {
    ...object,
    props: {
      ...props,
      scaleX: props.scaleX ?? size,
      scaleY: props.scaleY ?? size,
      center: props.center ?? null,
    },
  };
}

function loadProject(): TessProject {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return starterProject();
    const parsed = JSON.parse(raw) as TessProject;
    if (!parsed.scenes?.length || !parsed.objects) return starterProject();
    return {
      ...parsed,
      variables: parsed.variables ?? [],
      signals: parsed.signals ?? [],
      functions: parsed.functions ?? [],
      tables: parsed.tables ?? [],
      objects: parsed.objects.map(migrateObject),
    };
  } catch {
    return starterProject();
  }
}
