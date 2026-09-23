/**
 * @fileoverview Entry block trees back to editor blocks.
 *
 * The catalog only knows how to write Tess, so the way back is learned from it:
 * every spec is written once with marker values in its slots, the result is
 * compiled, and the entry blocks that come out become a pattern with the
 * markers as holes. An entry block is converted by the pattern that matches it
 * with the most fixed parts.
 */
import { compileProject } from '../../../compiler/src/index.ts';
import { buildSource } from '../codegen/project.ts';
import { useModel } from '../codegen/refs.ts';
import { optionsFor } from './fields.ts';
import { installBlocks } from './registry.ts';
import { allSpecs, type Arg, type BlockSpec, type DynamicSource } from './spec.ts';
import { PARAM_BOOLEAN, PARAM_VALUE } from './function-ids.ts';
import type { BlocklyState, TessProject } from '../model/types.ts';

/** One entry block as `project.json` stores it. */
export interface EntryBlock {
  type: string;
  params?: unknown[];
  statements?: EntryBlock[][];
}

/** A hole in a pattern, filled by whatever the entry block has there. */
interface Hole {
  hole: string;
  /** `any` matches whatever is there and keeps nothing. */
  kind: 'value' | 'bool' | 'statement' | 'field' | 'any';
}

type PatternNode = Hole | { type: string; params: PatternNode[]; statements: PatternNode[][] } | PatternNode[] | unknown;

interface Pattern {
  spec: BlockSpec;
  /** Dropdown and checkbox values this pattern was written with. */
  fields: Record<string, string | boolean>;
  root: PatternNode;
  /** Fixed parts, so the most specific match wins. */
  weight: number;
}

/** Serialized Blockly block, as `Blockly.serialization.blocks` reads it. */
export type BlockJson = Record<string, unknown> & { type: string };

type Path = Array<string | number>;

/** Functions the compiler adds for its own statements (`scale_x = …`) carry this label. */
const HELPER_LABEL = '[Tess]';

/** Compiler helper function ids, by the label that names them in every build. */
export function helperFunctions(functions: Array<{ id: string; content: string }>): Map<string, string> {
  const helpers = new Map<string, string>();
  for (const fn of functions) {
    try {
      const label = JSON.parse(fn.content)?.[0]?.[0]?.params?.[0]?.params?.[0];
      if (typeof label === 'string' && label.startsWith(HELPER_LABEL)) helpers.set(fn.id, label);
    } catch {
      // Not a function this build could read; it is left as it is.
    }
  }
  return helpers;
}

/** Calls to helpers named by label instead of by the id one build happened to give them. */
export function nameHelperCalls<T>(node: T, helpers: Map<string, string>): T {
  if (!helpers.size) return node;
  if (Array.isArray(node)) return node.map((item) => nameHelperCalls(item, helpers)) as T;
  const block = node as unknown as EntryBlock | null;
  if (block && typeof block === 'object' && typeof block.type === 'string') {
    const label = block.type.startsWith('func_') ? helpers.get(block.type.slice(5)) : undefined;
    return {
      ...block,
      type: label ? `helper:${label}` : block.type,
      params: (block.params ?? []).map((param) => nameHelperCalls(param, helpers)),
      statements: (block.statements ?? []).map((list) => nameHelperCalls(list, helpers)),
    } as T;
  }
  return node;
}

const LITERALS = new Set(['number', 'text', 'angle']);
/** More combinations than this and each dropdown is varied on its own. */
const MAX_COMBOS = 128;

// --- learning the patterns --------------------------------------------------

/** Marker records the specs are written against. Names are ascii so they stay identifiers. */
const MARK = 'zqk';
const HOST = `${MARK}host`;

interface Variant {
  spec: BlockSpec;
  fields: Record<string, string | boolean>;
  /** Marker value per arg name. */
  markers: Map<string, string>;
}

let learned: Map<string, Pattern[]> | null = null;

/** Patterns by the entry type at their root. Learned once per page. */
export function entryPatterns(): Map<string, Pattern[]> {
  if (!learned) learned = learnPatterns();
  return learned;
}

/** Variants compiled together; small enough that each batch is a short pause. */
const BATCH = 250;

function learnPatterns(): Map<string, Pattern[]> {
  const { model, variants } = prepareLearning();
  const patterns = new Map<string, Pattern[]>();
  for (let at = 0; at < variants.length; at += BATCH) learnBatch(variants.slice(at, at + BATCH), model, patterns);
  return finishLearning(patterns);
}

/** The same as `entryPatterns`, a batch at a time, giving the page room to paint in between. */
export async function warmEntryPatterns(): Promise<void> {
  if (learned) return;
  const { model, variants } = prepareLearning();
  const patterns = new Map<string, Pattern[]>();
  for (let at = 0; at < variants.length; at += BATCH) {
    learnBatch(variants.slice(at, at + BATCH), model, patterns);
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (learned) return;
  }
  learned = finishLearning(patterns);
}

function prepareLearning(): { model: TessProject; variants: Variant[] } {
  installBlocks();
  const model = markerModel();
  return { model, variants: allSpecs().flatMap((spec) => variantsOf(spec, model)) };
}

function finishLearning(patterns: Map<string, Pattern[]>): Map<string, Pattern[]> {
  for (const list of patterns.values()) list.sort((a, b) => b.weight - a.weight);
  return patterns;
}

function learnBatch(batch: Variant[], model: TessProject, patterns: Map<string, Pattern[]>): void {
  let variants = batch;
  // A variant that does not compile is dropped and the rest compiled again.
  for (let attempt = 0; attempt < 40 && variants.length; attempt += 1) {
    const host = model.objects[0]!;
    host.blocks = variantWorkspace(variants, model);
    useModel(model);
    let source: string;
    try {
      source = buildSource(model);
    } finally {
      useModel(null);
    }
    const compiled = compileProject(source, { path: 'main.tess', assetUrls: true });
    if (!compiled.project) {
      const bad = new Set(compiled.errors.map((error) => variantAtLine(source, error.line)));
      bad.delete(-1);
      if (!bad.size) return;
      variants = variants.filter((_, index) => !bad.has(index));
      continue;
    }
    collectPatterns(compiled.project as never, variants, patterns);
    return;
  }
}

/** The variant a source line belongs to: the next tag assignment below it. */
function variantAtLine(source: string, line: number): number {
  const lines = source.split('\n');
  for (let at = Math.max(0, line - 1); at < lines.length; at += 1) {
    const tag = new RegExp(`${MARK}tag = (\\d+)`).exec(lines[at]!);
    if (tag) return Number(tag[1]);
  }
  return -1;
}

const DYNAMIC_POOL = 3;

function markerModel(): TessProject {
  const scenes = [0, 1].map((index) => ({ id: `${MARK}sc${index}`, name: `${MARK}sc${index}` }));
  const costumes = range(DYNAMIC_POOL).map((index) => ({
    id: `${MARK}c${index}`, name: `${MARK}c${index}`, url: 'data:,', width: 10, height: 10,
  }));
  const sounds = range(DYNAMIC_POOL).map((index) => ({
    id: `${MARK}s${index}`, name: `${MARK}s${index}`, url: 'data:,', duration: 1,
  }));
  const object = (id: string) => ({
    id,
    name: id,
    kind: 'sprite' as const,
    sceneId: scenes[0]!.id,
    costumes,
    selectedCostumeId: costumes[0]!.id,
    sounds,
    props: {
      x: 0, y: 0, scaleX: 100, scaleY: 100, angle: 0, way: 90,
      rotation: 'free' as const, visible: true, lock: false, center: null,
    },
    text: null,
    blocks: null,
  });
  const variable = (id: string, kind: 'variable' | 'list') => ({
    id, name: id, kind, owner: null, value: 0, array: [], visible: false, scope: 'local' as const, slide: null,
  });
  return {
    name: MARK,
    description: '',
    fps: 60,
    scenes,
    objects: [object(HOST), ...range(DYNAMIC_POOL).map((index) => object(`${MARK}o${index}`))],
    variables: [
      ...['tag', 'val', 'body'].map((name) => variable(`${MARK}${name}`, 'variable')),
      ...range(DYNAMIC_POOL).map((index) => variable(`${MARK}v${index}`, 'variable')),
      ...range(DYNAMIC_POOL).map((index) => variable(`${MARK}l${index}`, 'list')),
    ],
    signals: range(DYNAMIC_POOL).map((index) => ({ id: `${MARK}m${index}`, name: `${MARK}m${index}` })),
    functions: [],
    tables: range(DYNAMIC_POOL).map((index) => ({
      id: `${MARK}t${index}`, name: `${MARK}t${index}`, columns: ['a', 'b'], rows: [['1', '2']],
    })),
  };
}

function range(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index);
}

/** Record ids a dynamic slot draws markers from. */
function dynamicPool(source: DynamicSource): string[] | null {
  switch (source) {
    case 'object': case 'target': case 'lookTarget': case 'cloneTarget':
      return range(DYNAMIC_POOL).map((index) => `${MARK}o${index}`);
    case 'signal': return range(DYNAMIC_POOL).map((index) => `${MARK}m${index}`);
    case 'scene': return [`${MARK}sc1`, `${MARK}sc0`];
    case 'costume': return range(DYNAMIC_POOL).map((index) => `${MARK}c${index}`);
    case 'sound': return range(DYNAMIC_POOL).map((index) => `${MARK}s${index}`);
    case 'variable': return range(DYNAMIC_POOL).map((index) => `${MARK}v${index}`);
    case 'list': return range(DYNAMIC_POOL).map((index) => `${MARK}l${index}`);
    case 'table': return range(DYNAMIC_POOL).map((index) => `${MARK}t${index}`);
    default: return null;
  }
}

let markerSeed = 70001;

/** Every way a spec is written: one per combination of its fixed choices. */
function variantsOf(spec: BlockSpec, model: TessProject): Variant[] {
  const choices: Array<{ arg: Arg; values: Array<string | boolean> }> = [];
  for (const arg of spec.args) {
    if (arg.type === 'dropdown') choices.push({ arg, values: arg.options.map(([, value]) => value) });
    if (arg.type === 'checkbox') choices.push({ arg, values: [false, true] });
    if (arg.type === 'dynamic' && arg.source === 'key') {
      choices.push({ arg, values: optionsFor('key').map(([, value]) => value) });
    }
  }
  const base = Object.fromEntries(choices.map(({ arg, values }) => [arg.name, values[0]!]));
  const combos: Array<Record<string, string | boolean>> = [];
  const total = choices.reduce((product, choice) => product * choice.values.length, 1);
  if (total <= MAX_COMBOS) {
    const walk = (index: number, picked: Record<string, string | boolean>) => {
      if (index === choices.length) {
        combos.push({ ...picked });
        return;
      }
      for (const value of choices[index]!.values) walk(index + 1, { ...picked, [choices[index]!.arg.name]: value });
    };
    walk(0, {});
  } else {
    combos.push(base);
    for (const { arg, values } of choices) {
      for (const value of values.slice(1)) combos.push({ ...base, [arg.name]: value });
    }
  }
  void model;
  return combos.map((fields) => {
    const markers = new Map<string, string>();
    const used = new Map<string, number>();
    for (const arg of spec.args) {
      if (arg.name in fields) continue;
      if (arg.type === 'dynamic') {
        const pool = dynamicPool(arg.source);
        const taken = used.get(arg.source) ?? 0;
        used.set(arg.source, taken + 1);
        markers.set(arg.name, pool ? pool[taken % pool.length]! : `${MARK}x${markerSeed++}`);
      } else if (arg.type === 'colour') {
        markers.set(arg.name, `#${(markerSeed++ % 0xffffff).toString(16).padStart(6, '0')}`);
      } else if (arg.type === 'text') {
        markers.set(arg.name, `${MARK}x${markerSeed++}`);
      } else {
        markers.set(arg.name, String(markerSeed++));
      }
    }
    return { spec, fields, markers };
  });
}

/** One script per variant, each ending in a tag that says which one it is. */
function variantWorkspace(variants: Variant[], model: TessProject): BlocklyState {
  void model;
  const blocks = variants.map((variant, index) => {
    const tag = setVariable(`${MARK}tag`, numberShadow(index));
    const block = variantBlock(variant);
    let top: BlockJson;
    switch (variant.spec.shape) {
      case 'hat':
        top = { ...block, next: { block: tag } };
        break;
      case 'statement':
        top = startHat(chain([block, tag]));
        break;
      case 'value':
        top = startHat(chain([setVariable(`${MARK}val`, { block }), tag]));
        break;
      case 'boolean':
        top = startHat(chain([
          { type: 'flow_if', inputs: { COND: { block } } } as BlockJson,
          tag,
        ]));
        break;
    }
    return { ...top, x: 0, y: index * 100 };
  });
  return { blocks: { languageVersion: 0, blocks } };
}

function variantBlock(variant: Variant): BlockJson {
  const fields: Record<string, unknown> = {};
  const inputs: Record<string, unknown> = {};
  for (const arg of variant.spec.args) {
    if (arg.name in variant.fields) {
      fields[arg.name] = variant.fields[arg.name];
      continue;
    }
    const marker = variant.markers.get(arg.name)!;
    switch (arg.type) {
      case 'value':
        inputs[arg.name] = numberShadow(Number(marker));
        break;
      case 'bool':
        inputs[arg.name] = {
          block: { type: 'judge_compare', fields: { OP: '==' }, inputs: { A: numberShadow(Number(marker)), B: numberShadow(0) } },
        };
        break;
      case 'statement':
        inputs[arg.name] = { block: setVariable(`${MARK}body`, numberShadow(Number(marker))) };
        break;
      case 'number':
        fields[arg.name] = Number(marker);
        break;
      default:
        fields[arg.name] = marker;
    }
  }
  return { type: variant.spec.type, fields, inputs };
}

function numberShadow(value: number): Record<string, unknown> {
  return { shadow: { type: 'calc_number', fields: { NUM: value } } };
}

function setVariable(variable: string, value: Record<string, unknown>): BlockJson {
  return { type: 'data_set_variable', fields: { NAME: variable }, inputs: { VALUE: value } };
}

function startHat(body: BlockJson | null): BlockJson {
  return body ? { type: 'start_when_run', next: { block: body } } : { type: 'start_when_run' };
}

/** Links statement blocks into one stack. */
export function chain(blocks: BlockJson[]): BlockJson | null {
  let head: BlockJson | null = null;
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = { ...blocks[index]! };
    if (head) block.next = { block: head };
    head = block;
  }
  return head;
}

interface CompiledWork {
  functions: Array<{ id: string; content: string }>;
  objects: Array<{ id: string; name: string; script: string; sprite: { pictures: Array<{ id: string; name: string }>; sounds: Array<{ id: string; name: string }> } }>;
  variables: Array<{ id: string; name: string }>;
  messages: Array<{ id: string; name: string }>;
  scenes: Array<{ id: string; name: string }>;
  tables?: Array<{ id: string; name: string }>;
}

function collectPatterns(work: CompiledWork, variants: Variant[], patterns: Map<string, Pattern[]>): void {
  // Marker record names to the ids the compiler gave them.
  const ids = new Map<string, string>();
  for (const object of work.objects) {
    ids.set(object.name, object.id);
    if (object.name !== HOST) continue;
    for (const picture of object.sprite.pictures) ids.set(picture.name, picture.id);
    for (const sound of object.sprite.sounds) ids.set(sound.name, sound.id);
  }
  for (const record of [...work.variables, ...work.messages, ...work.scenes, ...(work.tables ?? [])]) {
    ids.set(record.name, record.id);
  }
  const host = work.objects.find((object) => object.name === HOST);
  if (!host) return;
  const idOf = (name: string) => ids.get(name) ?? name;
  const tagId = idOf(`${MARK}tag`);
  const valId = idOf(`${MARK}val`);

  const helpers = helperFunctions(work.functions);
  for (const script of nameHelperCalls(JSON.parse(host.script) as EntryBlock[][], helpers)) {
    const tagAt = script.findIndex((block) => block.type === 'set_variable' && block.params?.[0] === tagId);
    if (tagAt < 0) continue;
    const variant = variants[Number(literalOf(script[tagAt]!.params?.[1]))];
    if (!variant) continue;
    let root: EntryBlock | undefined;
    switch (variant.spec.shape) {
      case 'hat':
        root = tagAt === 1 ? script[0] : undefined;
        break;
      case 'statement':
        root = tagAt === 2 ? script[1] : undefined;
        break;
      case 'value': {
        const holder = script[1];
        root = holder?.type === 'set_variable' && holder.params?.[0] === valId ? holder.params[1] as EntryBlock : undefined;
        break;
      }
      case 'boolean':
        root = script[1]?.type === '_if' ? script[1].params?.[0] as EntryBlock : undefined;
        break;
    }
    if (!root || typeof root !== 'object') continue;
    const pattern = toPattern(root, variant, idOf);
    if (!pattern) continue;
    const list = patterns.get(root.type) ?? [];
    list.push(pattern);
    patterns.set(root.type, list);
  }
}

function literalOf(node: unknown): unknown {
  if (node && typeof node === 'object' && LITERALS.has((node as EntryBlock).type)) {
    return (node as EntryBlock).params?.[0];
  }
  return node;
}

/** Replaces each marker in a compiled tree with a hole. */
function toPattern(root: EntryBlock, variant: Variant, idOf: (name: string) => string): Pattern | null {
  const tree = strip(root) as PatternNode;
  const holes: Array<{ path: Path; hole: Hole }> = [];

  for (const arg of variant.spec.args) {
    if (arg.name in variant.fields) continue;
    const marker = variant.markers.get(arg.name)!;
    const wanted = arg.type === 'dynamic' && dynamicPool(arg.source) ? idOf(marker) : marker;
    const path = findPrimitive(tree, (value) => String(value) === wanted);
    if (!path) return null;
    const parentPath = path.slice(0, -2);
    const parent = at(tree, parentPath) as EntryBlock | undefined;
    switch (arg.type) {
      case 'value':
        holes.push({
          path: parent && LITERALS.has(parent.type) ? parentPath : path,
          hole: { hole: arg.name, kind: 'value' },
        });
        break;
      case 'bool': {
        // The marker sits in a comparison; the hole is the comparison.
        let compare = parentPath;
        while (compare.length && (at(tree, compare) as EntryBlock | undefined)?.type !== 'boolean_basic_operator') {
          compare = compare.slice(0, -2);
        }
        if ((at(tree, compare) as EntryBlock | undefined)?.type !== 'boolean_basic_operator') return null;
        holes.push({ path: compare, hole: { hole: arg.name, kind: 'bool' } });
        break;
      }
      case 'statement': {
        // marker → number block → set_variable → statements[k][j]
        const listPath = path.slice(0, -5);
        if (listPath[listPath.length - 2] !== 'statements') return null;
        holes.push({ path: listPath, hole: { hole: arg.name, kind: 'statement' } });
        break;
      }
      default:
        holes.push({ path, hole: { hole: arg.name, kind: 'field' } });
    }
  }
  // A spec that only passes its slot through has nothing of its own to match.
  if (holes.some(({ path }) => !path.length)) return null;
  for (const { path, hole } of holes) setAt(tree, path, hole);
  // A helper's other arguments are the object's saved state, which differs per object.
  const top = tree as { type: string; params: PatternNode[] };
  if (top.type.startsWith('helper:')) {
    top.params = top.params.map((param) => (isHole(param) ? param : { hole: '', kind: 'any' }));
  }
  return { spec: variant.spec, fields: variant.fields, root: tree, weight: weigh(tree) };
}

function strip(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strip);
  if (node && typeof node === 'object' && typeof (node as EntryBlock).type === 'string') {
    const block = node as EntryBlock;
    return {
      type: block.type,
      params: (block.params ?? []).map(strip),
      statements: (block.statements ?? []).map((list) => list.map(strip)),
    };
  }
  return node ?? null;
}

function findPrimitive(node: unknown, test: (value: unknown) => boolean, path: Path = []): Path | null {
  if (Array.isArray(node)) {
    for (let index = 0; index < node.length; index += 1) {
      const found = findPrimitive(node[index], test, [...path, index]);
      if (found) return found;
    }
    return null;
  }
  if (node && typeof node === 'object') {
    const block = node as { params: unknown[]; statements: unknown[][] };
    return findPrimitive(block.params, test, [...path, 'params'])
      ?? findPrimitive(block.statements, test, [...path, 'statements']);
  }
  return node !== null && test(node) ? path : null;
}

function at(node: unknown, path: Path): unknown {
  let current = node as Record<string | number, unknown> | undefined;
  for (const key of path) current = current?.[key] as Record<string | number, unknown> | undefined;
  return current;
}

function setAt(node: unknown, path: Path, value: unknown): void {
  const parent = at(node, path.slice(0, -1)) as Record<string | number, unknown>;
  parent[path[path.length - 1]!] = value;
}

function isHole(node: unknown): node is Hole {
  return Boolean(node) && typeof node === 'object' && typeof (node as Hole).hole === 'string';
}

function weigh(node: PatternNode): number {
  if (isHole(node)) return 0;
  if (Array.isArray(node)) return node.reduce((sum: number, item) => sum + weigh(item), 0);
  if (node && typeof node === 'object') {
    const block = node as { params: PatternNode[]; statements: PatternNode[][] };
    return 1 + weigh(block.params) + weigh(block.statements);
  }
  return 1;
}

// --- matching ---------------------------------------------------------------

type Binds = Map<string, unknown>;

function unify(pattern: PatternNode, actual: unknown, binds: Binds): boolean {
  if (isHole(pattern)) {
    if (pattern.kind === 'any') return true;
    if (pattern.kind === 'statement' && !Array.isArray(actual)) return false;
    if (pattern.kind === 'field' && actual !== null && typeof actual === 'object') return false;
    binds.set(pattern.hole, actual);
    return true;
  }
  if (Array.isArray(pattern)) {
    const list = Array.isArray(actual) ? actual : [];
    const length = Math.max(pattern.length, list.length);
    for (let index = 0; index < length; index += 1) {
      if (!unify(pattern[index] ?? null, list[index] ?? null, binds)) return false;
    }
    return true;
  }
  if (pattern && typeof pattern === 'object') {
    const block = pattern as { type: string; params: PatternNode[]; statements: PatternNode[][] };
    const other = actual as EntryBlock | null;
    if (!other || typeof other !== 'object' || other.type !== block.type) return false;
    return unify(block.params, other.params ?? [], binds)
      && unify(block.statements, other.statements ?? [], binds);
  }
  if (pattern === null || pattern === undefined) return actual === null || actual === undefined;
  return actual !== null && actual !== undefined && String(actual) === String(pattern);
}

function match(block: EntryBlock, shapes: BlockSpec['shape'][]): { pattern: Pattern; binds: Binds } | null {
  for (const pattern of entryPatterns().get(block.type) ?? []) {
    if (!shapes.includes(pattern.spec.shape)) continue;
    const binds: Binds = new Map();
    if (unify(pattern.root, block, binds)) return { pattern, binds };
  }
  return null;
}

// --- converting -------------------------------------------------------------

/** What a conversion needs to know about the work around the blocks. */
export interface ConvertContext {
  /** Compiler helper function ids → their labels (`helperFunctions`). */
  helpers: Map<string, string>;
  /** Function id → its parameter kinds and whether it gives a value. */
  functions: Map<string, { value: boolean; params: Array<'value' | 'boolean'> }>;
  /** Parameter id → the name the function gave it. */
  params: Map<string, string>;
  /** Function-local variable id → its name. */
  locals: Map<string, string>;
  /** Entry types no pattern matched, with how often. */
  missed: Map<string, number>;
}

/** A stack of entry statements as one chained Blockly stack. */
export function convertStack(blocks: EntryBlock[], ctx: ConvertContext): BlockJson | null {
  return chain(blocks.map((block) => convertStatement(block, ctx)).filter((block): block is BlockJson => block !== null));
}

function convertStatement(block: EntryBlock, ctx: ConvertContext): BlockJson | null {
  if (!block || typeof block !== 'object') return null;
  const params = block.params ?? [];
  if (block.type.startsWith('func_') && ctx.functions.has(block.type.slice(5))) {
    return callBlock(block, `func_call_${block.type.slice(5)}`, ctx);
  }
  if (block.type === 'set_func_variable') {
    return {
      type: 'func_local_set',
      fields: { NAME: ctx.locals.get(String(params[0])) ?? '값' },
      inputs: { VALUE: valueInput(params[1], { kind: 'number', value: 0 }, ctx) },
    };
  }
  const found = match(block, ['statement', 'hat']);
  if (!found) {
    miss(block.type, ctx);
    return null;
  }
  return fromMatch(found.pattern, found.binds, ctx);
}

/** A value slot's content as a Blockly block, or null when there is none. */
export function convertValue(node: unknown, ctx: ConvertContext): BlockJson | null {
  if (node === null || node === undefined) return null;
  if (typeof node !== 'object') return literalBlock(node);
  const block = node as EntryBlock;
  const params = block.params ?? [];
  if (block.type === 'number' || block.type === 'angle') return literalBlock(params[0]);
  if (block.type === 'text') return { type: 'calc_text', fields: { TEXT: String(params[0] ?? '') } };
  if (/^(string|boolean)Param_/.test(block.type)) {
    const id = block.type.replace(/^(string|boolean)Param_/, '');
    return {
      type: block.type.startsWith('boolean') ? PARAM_BOOLEAN : PARAM_VALUE,
      fields: { NAME: ctx.params.get(id) ?? '값' },
      extraState: { param: id },
    };
  }
  // The compiler adds this around a judgement used as a value; the judgement is enough.
  if (block.type === 'get_boolean_value') return convertValue(params[0], ctx);
  if (block.type === 'char_at') {
    return {
      type: 'calc_char_at',
      inputs: {
        TEXT: valueInput(params[1], { kind: 'text', value: '' }, ctx),
        INDEX: valueInput(params[3], { kind: 'number', value: 1 }, ctx),
      },
    };
  }
  if (block.type === 'get_func_variable') {
    return { type: 'func_local_get', fields: { NAME: ctx.locals.get(String(params[0])) ?? '값' } };
  }
  if (block.type.startsWith('func_') && ctx.functions.has(block.type.slice(5))) {
    return callBlock(block, `func_value_${block.type.slice(5)}`, ctx);
  }
  const found = match(block, ['value', 'boolean']);
  if (!found) {
    miss(block.type, ctx);
    return null;
  }
  return fromMatch(found.pattern, found.binds, ctx);
}

function literalBlock(value: unknown): BlockJson {
  const text = String(value ?? '');
  return text.trim() !== '' && Number.isFinite(Number(text))
    ? { type: 'calc_number', fields: { NUM: Number(text) } }
    : { type: 'calc_text', fields: { TEXT: text } };
}

function callBlock(block: EntryBlock, type: string, ctx: ConvertContext): BlockJson {
  const kinds = ctx.functions.get(type.replace(/^func_(call|value)_/, ''))?.params ?? [];
  const inputs: Record<string, unknown> = {};
  kinds.forEach((kind, index) => {
    const value = convertValue(block.params?.[index], ctx);
    const converted = kind === 'boolean' ? judgement(value) : value;
    if (converted) inputs[`ARG${index}`] = { block: converted };
  });
  return { type, inputs };
}

/** A block that fits a judgement slot; plain values ride in `judge_value`. */
function judgement(block: BlockJson | null): BlockJson | null {
  if (!block || isJudgement(block.type)) return block;
  return { type: 'judge_value', inputs: { VALUE: { block } } };
}

function isJudgement(type: string): boolean {
  if (type === PARAM_BOOLEAN) return true;
  return specOf(type)?.shape === 'boolean';
}

function fromMatch(pattern: Pattern, binds: Binds, ctx: ConvertContext): BlockJson {
  const fields: Record<string, unknown> = { ...pattern.fields };
  const inputs: Record<string, unknown> = {};
  for (const arg of pattern.spec.args) {
    if (arg.name in pattern.fields || !binds.has(arg.name)) continue;
    const bound = binds.get(arg.name);
    switch (arg.type) {
      case 'value':
        inputs[arg.name] = valueInput(bound, arg.shadow, ctx);
        break;
      case 'bool': {
        const converted = judgement(convertValue(bound, ctx));
        if (converted) inputs[arg.name] = { block: converted };
        break;
      }
      case 'statement': {
        const stack = convertStack(bound as EntryBlock[], ctx);
        if (stack) inputs[arg.name] = { block: stack };
        break;
      }
      case 'number':
        fields[arg.name] = Number(literalOf(bound)) || 0;
        break;
      default:
        fields[arg.name] = String(literalOf(bound) ?? '');
    }
  }
  const json: BlockJson = { type: pattern.spec.type };
  if (Object.keys(fields).length) json.fields = fields;
  if (Object.keys(inputs).length) json.inputs = inputs;
  return json;
}

type ShadowKind = { kind: 'number'; value: number } | { kind: 'text'; value: string } | { kind: 'none' };

/** A socket input: a literal becomes the shadow, anything else sits on top of one. */
function valueInput(node: unknown, shadow: ShadowKind, ctx: ConvertContext): Record<string, unknown> {
  const converted = convertValue(node, ctx);
  const fallback = shadow.kind === 'number'
    ? { type: 'calc_number', fields: { NUM: shadow.value } }
    : shadow.kind === 'text' ? { type: 'calc_text', fields: { TEXT: shadow.value } } : null;
  if (!converted) return fallback ? { shadow: fallback } : {};
  if (fallback && converted.type === fallback.type) return { shadow: converted };
  return fallback ? { shadow: fallback, block: converted } : { block: converted };
}

function miss(type: string, ctx: ConvertContext): void {
  ctx.missed.set(type, (ctx.missed.get(type) ?? 0) + 1);
}

/** Rough height of a stack on the canvas, so scripts can sit one under another. */
export function stackHeight(block: BlockJson | null): number {
  let height = 0;
  for (let current = block; current; current = (current.next as { block?: BlockJson } | undefined)?.block ?? null) {
    height += 48;
    for (const input of Object.values((current.inputs ?? {}) as Record<string, { block?: BlockJson }>)) {
      if (input.block && isStatementBlock(input.block.type)) height += stackHeight(input.block) + 24;
    }
  }
  return height;
}

function isStatementBlock(type: string): boolean {
  const spec = specOf(type);
  if (spec) return spec.shape === 'statement';
  return type.startsWith('func_call_') || type === 'func_local_set' || type === 'func_local_var' || type === 'func_return';
}

let specsByType: Map<string, BlockSpec> | null = null;

function specOf(type: string): BlockSpec | undefined {
  specsByType ??= new Map(allSpecs().map((spec) => [spec.type, spec]));
  return specsByType.get(type);
}
