/**
 * @fileoverview Editor state: one project signal plus the actions that change
 * it. Components read the signals; nothing else holds project data.
 */
import { remapProjectCalls } from './call-remap.ts';
import { computed, signal } from '@preact/signals';
import { newId } from './ids.ts';
import { COSTUME_LIBRARY, costumeFrom, makeScene, makeSprite, makeTextBox, starterProject } from './defaults.ts';
import { keepOnly } from './assets.ts';
import { measureTextBox } from './text-metrics.ts';
import type {
  BlocklyState, Costume, FunctionDef, ObjectProps, Signal, Sound, TableDef, TessObject, TessProject,
  TextProps, VariableDef, VariableKind,
} from './types.ts';
import { copyDeep, stringify } from './json.ts';

const STORAGE_KEY = 'tessblock.project.v1';

/**
 * Blocks whose colour moved from a field to a socket holding a colour shadow.
 * Declared before `project`: loading the saved work reads it.
 */
const COLOUR_SOCKETS = new Set([
  'brush_set_colour', 'brush_set_fill', 'text_set_colour', 'text_set_bg_colour', 'calc_from_hex',
]);

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
  const before = project.value;
  const draft = editableCopy(before);
  const next = change(draft) ?? draft;
  remember(before);
  project.value = next;
  saveSoon();
}

/** JSON of each saved block state, which is never changed in place. */
const stateTexts = new WeakMap<object, string>();

/** `JSON.stringify(state)`, written once per state. */
function stateText(state: unknown): string {
  if (!state || typeof state !== 'object') return JSON.stringify(state ?? null);
  let text = stateTexts.get(state);
  if (text === undefined) {
    text = stringify(state);
    stateTexts.set(state, text);
  }
  return text;
}

/** Stands in for a block state while the rest of the work is written. */
const STATE_MARK = '\u0000tess-state:';

/**
 * `JSON.stringify(model)`, with block states written from `stateText`: a save
 * after an edit writes only the scripts that changed.
 */
function projectText(model: TessProject): string {
  const states: unknown[] = [];
  const mark = (state: unknown) => {
    if (!state || typeof state !== 'object') return state;
    states.push(state);
    return `${STATE_MARK}${states.length - 1}`;
  };
  const shell = {
    ...model,
    objects: model.objects.map((object) => ({ ...object, blocks: mark(object.blocks) })),
    functions: model.functions.map((definition) => ({ ...definition, blocks: mark(definition.blocks) })),
  };
  return JSON.stringify(shell).replace(/"\\u0000tess-state:(\d+)"/g, (_, index: string) => stateText(states[Number(index)]));
}

/**
 * A deep copy of the work to edit, sharing the saved block states. A block
 * state is replaced whole when scripts change and never changed in place, so
 * an edit does not copy every script in the work, and an object whose scripts
 * did not change keeps the same state (and the code written from it).
 */
function editableCopy(model: TessProject): TessProject {
  const shell = {
    ...model,
    objects: model.objects.map((object) => ({ ...object, blocks: null })),
    functions: model.functions.map((definition) => ({ ...definition, blocks: null })),
  };
  const copy = structuredClone(shell) as TessProject;
  copy.objects.forEach((object, index) => { object.blocks = model.objects[index]!.blocks; });
  copy.functions.forEach((definition, index) => { definition.blocks = model.functions[index]!.blocks; });
  return copy;
}

// --- undo -------------------------------------------------------------------

/** Edits closer together than this (a drag, typing) undo as one step. */
const BURST_MS = 500;
/** Rough memory the history may hold, in serialized characters. */
const HISTORY_BUDGET = 40_000_000;

const past: TessProject[] = [];
const future: TessProject[] = [];
let lastEdit = 0;
/** Serialized size of the work, updated on every save. */
let workSize = 0;

/** Bumped when an undo or redo swaps the whole work; open editors reload from it. */
export const restored = signal(0);

function remember(before: TessProject): void {
  const now = Date.now();
  if (now - lastEdit > BURST_MS) {
    past.push(before);
    const limit = Math.max(5, Math.min(100, Math.floor(HISTORY_BUDGET / Math.max(workSize, 1))));
    while (past.length > limit) past.shift();
  }
  lastEdit = now;
  future.length = 0;
}

export function undo(): boolean {
  return travel(past, future);
}

export function redo(): boolean {
  return travel(future, past);
}

function travel(from: TessProject[], to: TessProject[]): boolean {
  const target = from.pop();
  if (!target) return false;
  to.push(project.value);
  lastEdit = 0;
  project.value = target;
  if (!target.scenes.some((scene) => scene.id === selectedSceneId.value)) {
    selectedSceneId.value = target.scenes[0]?.id ?? '';
  }
  if (!target.objects.some((object) => object.id === selectedObjectId.value)) {
    selectedObjectId.value = target.objects.find((object) => object.sceneId === selectedSceneId.value)?.id ?? '';
  }
  restored.value += 1;
  saveSoon();
  return true;
}

function forgetHistory(): void {
  past.length = 0;
  future.length = 0;
  lastEdit = 0;
}

function patchObject(id: string, change: (object: TessObject) => void): void {
  update((draft) => {
    const object = draft.objects.find((candidate) => candidate.id === id);
    if (object) change(object);
  });
}

// --- scenes -----------------------------------------------------------------

/** `base`, or `base 2`, `base 3`… until it is free. */
function untaken(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  let index = 2;
  while (taken.has(`${base} ${index}`)) index += 1;
  return `${base} ${index}`;
}

/** A name no object in the work is using yet. */
function freeName(base: string): string {
  return untaken(base, new Set(project.value.objects.map((object) => object.name)));
}

export function addScene(): void {
  const scene = makeScene(`장면 ${project.value.scenes.length + 1}`);
  const object = makeSprite(freeName('로봇'), scene.id);
  update((draft) => {
    // Right after the scene being worked on.
    const at = draft.scenes.findIndex((candidate) => candidate.id === selectedSceneId.value);
    if (at < 0) draft.scenes.push(scene);
    else draft.scenes.splice(at + 1, 0, scene);
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

/** Copies a scene with its objects, their scripts and the variables they own. */
export function duplicateScene(id: string): void {
  const source = project.value.scenes.find((scene) => scene.id === id);
  if (!source) return;
  const scene = {
    ...source,
    id: newId('s'),
    name: untaken(source.name, new Set(project.value.scenes.map((candidate) => candidate.name))),
  };
  const taken = new Set(project.value.objects.map((object) => object.name));
  // Scripts that name this scene follow the copy.
  const scenes = new Map([[source.id, scene.id]]);
  const clones = project.value.objects
    .filter((object) => object.sceneId === id)
    .map((object) => {
      const name = untaken(object.name, taken);
      taken.add(name);
      return cloneObject(object, name, scene.id, scenes);
    });

  update((draft) => {
    const at = draft.scenes.findIndex((candidate) => candidate.id === id);
    draft.scenes.splice(at < 0 ? draft.scenes.length : at + 1, 0, scene);
    const last = draft.objects.map((object) => object.sceneId === id).lastIndexOf(true);
    draft.objects.splice(last + 1, 0, ...clones.map((clone) => clone.object));
    draft.variables.push(...clones.flatMap((clone) => clone.variables));
    draft.functions.push(...clones.flatMap((clone) => clone.functions));
  });
  selectedSceneId.value = scene.id;
  selectedObjectId.value = clones[0]?.object.id ?? '';
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

/** A sprite starts as an empty drawing, ready for the painter. */
export function addObject(kind: 'sprite' | 'text' = 'sprite'): void {
  const scene = selectedSceneId.value;
  const name = freeName(kind === 'sprite' ? '새 그림' : '글상자');
  const object = kind === 'sprite' ? makeSprite(name, scene) : makeTextBox(name, scene);
  if (kind === 'sprite') {
    const blank: Costume = { id: newId('c'), name: '새 그림', url: blankCostume(240, 180), width: 240, height: 180 };
    object.costumes = [blank];
    object.selectedCostumeId = blank.id;
  }
  update((draft) => {
    draft.objects.unshift(object);
  });
  selectedObjectId.value = object.id;
}

/**
 * A copy of one object: fresh ids for its costumes and sounds, copies of the
 * variables it owns, and scripts pointed at those copies.
 */
function cloneObject(
  source: TessObject,
  name: string,
  sceneId = source.sceneId,
  swap = new Map<string, string>(),
): { object: TessObject; variables: VariableDef[]; functions: FunctionDef[] } {
  // Scripts nest too deeply for structuredClone; they are copied as text below.
  const copy = structuredClone({ ...source, blocks: null }) as TessObject;
  copy.id = newId('o');
  copy.name = name;
  copy.sceneId = sceneId;
  copy.costumes = copy.costumes.map((costume) => ({ ...costume, id: newId('c') }));
  copy.selectedCostumeId = copy.costumes[source.costumes.findIndex(
    (costume) => costume.id === source.selectedCostumeId,
  )]?.id ?? copy.costumes[0]?.id ?? '';
  copy.sounds = copy.sounds.map((sound) => ({ ...sound, id: newId('snd') }));

  const locals = project.value.variables.filter((variable) => variable.owner === source.id);
  const variables = locals.map((variable) => ({ ...variable, id: newId('v'), owner: copy.id }));
  const ids = new Map(swap);
  locals.forEach((variable, index) => ids.set(variable.id, variables[index]!.id));
  // Functions declared in the scripts are the copy's own, under new ids.
  const functions = project.value.functions
    .filter((definition) => definition.inline && definition.owner === source.id)
    .map((definition) => {
      const id = newId('f');
      ids.set(definition.id, id);
      return { ...copyDeep(definition), id, owner: copy.id };
    });

  let blocks = stateText(source.blocks);
  for (const [from, to] of ids) blocks = blocks.split(from).join(to);
  copy.blocks = JSON.parse(blocks) as typeof copy.blocks;
  return { object: copy, variables, functions };
}

/** Copies an object, its costumes, its sounds, its scripts and its variables. */
export function duplicateObject(id: string): void {
  const source = project.value.objects.find((object) => object.id === id);
  if (!source) return;
  const { object, variables, functions } = cloneObject(source, freeName(source.name));
  update((draft) => {
    const at = draft.objects.findIndex((candidate) => candidate.id === id);
    draft.objects.splice(at < 0 ? draft.objects.length : at, 0, object);
    draft.variables.push(...variables);
    draft.functions.push(...functions);
  });
  selectedObjectId.value = object.id;
}

export function removeObject(id: string): void {
  update((draft) => {
    draft.objects = draft.objects.filter((object) => object.id !== id);
    draft.variables = draft.variables.filter((variable) => variable.owner !== id);
    draft.functions = draft.functions.filter((definition) => !(definition.inline && definition.owner === id));
  });
  if (selectedObjectId.value === id) {
    selectedObjectId.value = sceneObjects.value[0]?.id ?? '';
  }
}

export function selectObject(id: string): void {
  selectedObjectId.value = id;
}

export function renameObject(id: string, name: string): void {
  const current = project.peek().objects.find((candidate) => candidate.id === id);
  if (current && current.name === name) return;
  patchObject(id, (object) => {
    object.name = name;
  });
}

export function setObjectProps(id: string, patch: Partial<ObjectProps>): void {
  const current = project.peek().objects.find((candidate) => candidate.id === id);
  if (!current) return;
  let changed = false;
  for (const key of Object.keys(patch) as Array<keyof ObjectProps>) {
    if (current.props[key] !== patch[key]) {
      changed = true;
      break;
    }
  }
  if (!changed) return;
  patchObject(id, (object) => {
    object.props = { ...object.props, ...patch };
  });
}

export function setTextProps(id: string, patch: Partial<TextProps>): void {
  const current = project.peek().objects.find((candidate) => candidate.id === id);
  if (!current?.text) return;
  let changed = false;
  for (const key of Object.keys(patch) as Array<keyof TextProps>) {
    if (current.text[key] !== patch[key]) {
      changed = true;
      break;
    }
  }
  if (!changed) return;
  patchObject(id, (object) => {
    if (!object.text) return;
    const text = { ...object.text, ...patch };
    // A multi-line box is a frame the text wraps in, sized by hand; a one-line box fits its text.
    object.text = text.lineBreak && text.boxWidth > 0 && text.boxHeight > 0 ? text : { ...text, ...measureTextBox(text) };
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
    // An object dropped beside another joins that one's folder (or leaves its own).
    moved!.folder = draft.objects[to]?.folder ?? null;
    if (to < 0) draft.objects.push(moved!);
    else draft.objects.splice(before ? to : to + 1, 0, moved!);
  });
}

/** Moves an object to the top of a folder in its scene. */
export function fileObject(id: string, folder: string): void {
  update((draft) => {
    const from = draft.objects.findIndex((object) => object.id === id);
    if (from < 0) return;
    const [moved] = draft.objects.splice(from, 1);
    moved!.folder = folder;
    const to = draft.objects.findIndex((object) => object.sceneId === moved!.sceneId && object.folder === folder);
    if (to < 0) draft.objects.splice(from, 0, moved!);
    else draft.objects.splice(to, 0, moved!);
  });
}

/** Files the object under a new folder of its own. */
export function addObjectFolder(objectId: string): string {
  const taken = new Set(project.peek().objects.map((object) => object.folder).filter(Boolean));
  let index = 1;
  while (taken.has(`폴더 ${index}`)) index += 1;
  const name = `폴더 ${index}`;
  patchObject(objectId, (object) => {
    object.folder = name;
  });
  return name;
}

export function renameObjectFolder(sceneId: string, from: string, to: string): void {
  const name = to.trim();
  if (!name || name === from) return;
  update((draft) => {
    for (const object of draft.objects) if (object.sceneId === sceneId && object.folder === from) object.folder = name;
  });
}

/** Takes the objects out of the folder; the folder goes with them. */
export function removeObjectFolder(sceneId: string, name: string): void {
  update((draft) => {
    for (const object of draft.objects) if (object.sceneId === sceneId && object.folder === name) object.folder = null;
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

/**
 * Stores an object's scripts, and with them the local functions its definition
 * blocks declare (`inline`), so both land in one undo step.
 */
export function setObjectBlocks(id: string, blocks: BlocklyState, inline?: FunctionDef[]): void {
  const model = project.peek();
  const current = model.objects.find((candidate) => candidate.id === id);
  const declared = model.functions.filter((each) => each.inline && each.owner === id);
  const sameBlocks = !!current && stateText(current.blocks) === stateText(blocks);
  const sameFunctions = !inline || stringify(declared) === stringify(inline);
  if (sameBlocks && sameFunctions) return;
  update((draft) => {
    const object = draft.objects.find((candidate) => candidate.id === id);
    if (object) object.blocks = blocks;
    if (inline && !sameFunctions) {
      draft.functions = [...draft.functions.filter((each) => !(each.inline && each.owner === id)), ...inline];
      remapProjectCalls(draft, model.functions);
    }
  });
}

/**
 * A costume name no other costume of the object has: a taken one gets `_2`,
 * `_3`… Blocks and the written source name costumes, so two of one name would
 * leave one of them out of reach.
 */
function uniqueCostumeName(object: TessObject, name: string, except?: string): string {
  const base = name.trim() || '모양';
  const taken = new Set(object.costumes.filter((costume) => costume.id !== except).map((costume) => costume.name));
  if (!taken.has(base)) return base;
  let index = 2;
  while (taken.has(`${base}_${index}`)) index += 1;
  return `${base}_${index}`;
}

export function addCostume(id: string, index: number): void {
  const template = COSTUME_LIBRARY[index % COSTUME_LIBRARY.length]!;
  patchObject(id, (object) => {
    const costume = costumeFrom(template);
    costume.name = uniqueCostumeName(object, costume.name);
    object.costumes.push(costume);
    if (!object.selectedCostumeId) object.selectedCostumeId = costume.id;
  });
}

/** An empty costume to draw on, the size of the stage by default. */
export function addBlankCostume(objectId: string, width = 240, height = 180): string {
  const costume: Costume = { id: newId('c'), name: '새 모양', url: blankCostume(width, height), width, height };
  patchObject(objectId, (object) => {
    costume.name = uniqueCostumeName(object, costume.name);
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
    if (index < 0) return;
    const named = patch.name === undefined ? patch : { ...patch, name: uniqueCostumeName(object, patch.name, costumeId) };
    object.costumes[index] = { ...object.costumes[index]!, ...named };
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
    visible: true,
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

export function updateSignal(id: string, patch: Partial<Signal>): void {
  const current = project.peek().signals.find((s) => s.id === id);
  if (current && (patch.name === undefined || patch.name === current.name)) return;
  update((draft) => {
    const at = draft.signals.findIndex((signalDef) => signalDef.id === id);
    if (at >= 0) draft.signals[at] = { ...draft.signals[at]!, ...patch };
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
  const previous = project.peek().functions;
  update((draft) => {
    const index = draft.functions.findIndex((candidate) => candidate.id === definition.id);
    if (index >= 0) draft.functions[index] = definition;
    else draft.functions.push(definition);
    remapProjectCalls(draft, previous);
  });
}

export function updateFunction(id: string, patch: Partial<FunctionDef>): void {
  const current = project.peek().functions.find((f) => f.id === id);
  if (current && patch.name !== undefined && patch.name === current.name && patch.params === undefined && patch.blocks === undefined) {
    return;
  }
  const previous = project.peek().functions;
  update((draft) => {
    const at = draft.functions.findIndex((fn) => fn.id === id);
    if (at >= 0) draft.functions[at] = { ...draft.functions[at]!, ...patch };
    remapProjectCalls(draft, previous);
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
  forgetHistory();
  const model = migrateProject(next);
  project.value = model;
  selectedSceneId.value = model.scenes[0]?.id ?? '';
  selectedObjectId.value = model.objects.find((object) => object.sceneId === selectedSceneId.value)?.id ?? '';
  saveSoon();
}

/** Starts a new work. It goes through `update`, so Ctrl+Z brings the old one back. */
export function newProject(): void {
  const fresh = starterProject();
  update(() => fresh);
  selectedSceneId.value = fresh.scenes[0]?.id ?? '';
  selectedObjectId.value = fresh.objects[0]?.id ?? '';
}

export function resetProject(): void {
  replaceProject(starterProject());
}

// --- persistence ------------------------------------------------------------

let saveTimer: number | undefined;

/** Set when the browser refused to keep the project — usually a full store. */
export const saveFailed = signal(false);

function saveSoon(): void {
  if (saveTimer !== undefined) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const serialized = projectText(project.value);
      workSize = serialized.length;
      localStorage.setItem(STORAGE_KEY, serialized);
      saveFailed.value = false;
      void keepOnly(assetRefs(project.value));
    } catch {
      // The work stays in memory; the editor says so rather than losing it
      // quietly. Big sounds and costumes are the usual cause.
      saveFailed.value = true;
    }
  }, 400) as unknown as number;
}

/** Fills in what a project saved by an older editor does not have. */
function migrateProject(model: TessProject): TessProject {
  return {
    ...model,
    variables: model.variables ?? [],
    signals: model.signals ?? [],
    tables: model.tables ?? [],
    functions: (model.functions ?? []).map((definition) => migrateFunction(upgradeBlocks(definition))),
    objects: (model.objects ?? []).map((object) => migrateObject(upgradeBlocks(object))),
  };
}

function migrateObject(object: TessObject): TessObject {
  const props = object.props as ObjectProps & { size?: number };
  const size = props.size ?? 100;
  // A one-line box is as wide as its text; boxes saved while the measure ignored the font are fixed here.
  const text = object.text && !object.text.lineBreak ? { ...object.text, ...measureTextBox(object.text) } : object.text;
  return {
    ...object,
    text,
    props: {
      ...props,
      scaleX: props.scaleX ?? size,
      scaleY: props.scaleY ?? size,
      center: props.center ?? null,
    },
  };
}

/**
 * A function saved before the header recorded its slots. The parameter inputs
 * are named in the saved block, so the slot list is read back from there.
 */
function migrateFunction(definition: FunctionDef): FunctionDef {
  const blocks = definition.blocks as { blocks?: { blocks?: BlockState[] } } | null;
  for (const block of blocks?.blocks?.blocks ?? []) {
    if (block.type !== 'func_define' || block.extraState?.slots) continue;
    const slots = Object.keys(block.inputs ?? {}).filter((name) => name.startsWith('ARG'));
    if (slots.length) block.extraState = { ...block.extraState, slots };
  }
  return definition;
}

interface BlockState {
  type?: string;
  fields?: Record<string, unknown>;
  inputs?: Record<string, { block?: BlockState; shadow?: BlockState }>;
  next?: { block?: BlockState };
  extraState?: { slots?: string[] } & Record<string, unknown>;
}

/** Rewrites block states saved by an older editor in place. */
function upgradeBlocks<T extends { blocks: unknown }>(owner: T): T {
  const state = owner.blocks as { blocks?: { blocks?: BlockState[] } } | null;
  // A list, not recursion: a long stack nests each block under the one before it.
  const pending: Array<BlockState | undefined> = [...(state?.blocks?.blocks ?? [])];
  while (pending.length) {
    const block = pending.pop();
    if (!block) continue;
    const colour = block.fields?.COLOUR;
    if (block.type && COLOUR_SOCKETS.has(block.type) && typeof colour === 'string') {
      delete block.fields!.COLOUR;
      const swatch = { type: 'calc_colour', fields: { COLOUR: colour } };
      block.inputs = { ...block.inputs, COLOUR: { shadow: swatch, block: { ...swatch } } };
    }
    for (const input of Object.values(block.inputs ?? {})) pending.push(input.block, input.shadow);
    pending.push(block.next?.block);
  }
  return owner;
}

/** Every costume and sound the work still points at. */
function assetRefs(model: TessProject): string[] {
  const refs: string[] = [];
  for (const object of model.objects) {
    for (const costume of object.costumes) refs.push(costume.url);
    for (const sound of object.sounds) refs.push(sound.url);
  }
  return refs;
}

function loadProject(): TessProject {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return starterProject();
    const parsed = JSON.parse(raw) as TessProject;
    if (!parsed.scenes?.length || !parsed.objects) return starterProject();
    return migrateProject(parsed);
  } catch {
    return starterProject();
  }
}
