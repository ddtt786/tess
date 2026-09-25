/**
 * @fileoverview Dropdowns whose entries come from the project.
 *
 * One field type covers every list — objects, signals, costumes, variables —
 * and stores the record's id, so renaming a thing keeps the blocks pointing at
 * it. The Tess writer turns the id back into a name.
 */
import { FONTS, fontLabel } from '../model/fonts.ts';
import * as Blockly from 'blockly/core';
import { KEY_CODES } from '../../../core/src/keycodes.ts';
import { project, selectedObjectId } from '../model/store.ts';
import type { DynamicSource } from './spec.ts';

type Option = [string, string];

const EMPTY: Option[] = [['없음', '']];

/** Targets every object slot offers besides the objects themselves. */
const MOUSE: Option = ['마우스포인터', 'mouse'];
const WALLS: Option[] = [
  ['벽', 'wall'],
  ['위쪽 벽', 'wall_up'],
  ['아래쪽 벽', 'wall_down'],
  ['왼쪽 벽', 'wall_left'],
  ['오른쪽 벽', 'wall_right'],
];

/** Keys in the order a person looks for them, not the order they are stored. */
const KEY_ORDER = [
  'space', 'enter', 'left', 'right', 'up', 'down', 'shift', 'ctrl', 'alt', 'esc', 'tab',
  'backspace', 'delete',
  ...'abcdefghijklmnopqrstuvwxyz',
  ...'0123456789',
];

const KEY_OPTIONS: Option[] = [
  ...KEY_ORDER,
  ...Object.keys(KEY_CODES).filter((name) => !KEY_ORDER.includes(name) && !/^(escape|backslash)$/.test(name)),
].map((name) => [keyLabel(name), name] as Option);

/** The key menu's name for a key pressed: the name entry stores that key's code under. */
function keyNameOf(event: KeyboardEvent): string | null {
  const code = event.keyCode;
  const names = KEY_OPTIONS.map(([, name]) => name).filter((name) => KEY_CODES[name] === code);
  return names[0] ?? null;
}

function keyLabel(name: string): string {
  const labels: Record<string, string> = {
    space: '스페이스', enter: '엔터', shift: '시프트', ctrl: '컨트롤', alt: '알트',
    esc: 'esc', tab: '탭', backspace: '백스페이스', delete: '딜리트',
    left: '← 왼쪽 화살표', right: '→ 오른쪽 화살표', up: '↑ 위쪽 화살표', down: '↓ 아래쪽 화살표',
  };
  return labels[name] ?? name.toUpperCase();
}

function objectOptions(exclude = false): Option[] {
  const scene = project.value.objects.filter(
    (object) => object.sceneId === currentSceneId() && (!exclude || object.id !== selectedObjectId.value),
  );
  return scene.map((object) => [object.name, object.id] as Option);
}

function currentSceneId(): string {
  const object = project.value.objects.find((candidate) => candidate.id === selectedObjectId.value);
  return object?.sceneId ?? project.value.scenes[0]?.id ?? '';
}

function ownObject() {
  return project.value.objects.find((object) => object.id === selectedObjectId.value) ?? null;
}

/** The entries a source offers right now. */
export function optionsFor(source: DynamicSource, current = ''): Option[] {
  const options = buildOptions(source);
  if (current && !options.some(([, value]) => value === current)) {
    options.push([labelFor(source, current), current]);
  }
  return options.length ? options : [...EMPTY];
}

function buildOptions(source: DynamicSource): Option[] {
  const model = project.value;
  switch (source) {
    case 'object':
      return objectOptions();
    case 'target':
      return [MOUSE, ...WALLS, ...objectOptions(true)];
    case 'lookTarget':
      return [MOUSE, ...objectOptions(true)];
    case 'cloneTarget':
      return [['자신', 'self'], ...objectOptions(true)];
    case 'signal':
      return model.signals.map((signal) => [signal.name, signal.id] as Option);
    case 'scene':
      return model.scenes.map((scene) => [scene.name, scene.id] as Option);
    case 'costume':
      return (ownObject()?.costumes ?? []).map((costume) => [costume.name, costume.id] as Option);
    case 'sound':
      return (ownObject()?.sounds ?? []).map((sound) => [sound.name, sound.id] as Option);
    case 'variable':
      return visibleVariablesOf('variable');
    case 'list':
      return visibleVariablesOf('list');
    case 'table':
      return model.tables.map((table) => [table.name, table.id] as Option);
    case 'tableColumn':
      return model.tables[0]?.columns.map((column) => [column, column] as Option) ?? [];
    case 'key':
      return KEY_OPTIONS;
    case 'font':
      return FONTS.map((font) => [font.label, font.family] as Option);
    default:
      return [];
  }
}

function visibleVariablesOf(kind: 'variable' | 'list'): Option[] {
  const owner = selectedObjectId.value;
  return project.value.variables
    .filter((variable) => variable.kind === kind && (!variable.owner || variable.owner === owner))
    .map((variable) => [variable.name, variable.id] as Option);
}

/** The label a stored value keeps when its record is gone. */
function labelFor(source: DynamicSource, value: string): string {
  if (source === 'key') return keyLabel(value);
  if (source === 'tableColumn') return value;
  if (source === 'font') return fontLabel(value);
  return `${value.slice(0, 6)} (없음)`;
}

/** A dropdown backed by one of the project's lists. */
export class TessDropdown extends Blockly.FieldDropdown {
  source: DynamicSource;

  constructor(source: DynamicSource, value?: string) {
    let self: TessDropdown | undefined;
    super(() => optionsFor(source, self?.getValue() ?? ''));
    this.source = source;
    self = this;
    if (value !== undefined && value !== null) this.setValue(value);
  }

  static override fromJson(options: Blockly.FieldDropdownFromJsonConfig): TessDropdown {
    const config = options as { source?: DynamicSource; value?: string };
    return new TessDropdown(config.source ?? 'object', config.value);
  }

  /** Any id is allowed: a deleted record must not wipe the block's choice. */
  protected override doClassValidation_(newValue?: string): string | null {
    return typeof newValue === 'string' ? newValue : null;
  }

  /** While a key menu is open, the key pressed is the key picked. */
  private keyPick: ((event: KeyboardEvent) => void) | null = null;

  protected override showEditor_(event?: MouseEvent): void {
    super.showEditor_(event);
    if (this.source !== 'key') return;
    this.keyPick = (pressed: KeyboardEvent) => {
      const name = keyNameOf(pressed);
      if (!name) return;
      // Taken before Blockly's menu sees it: Escape and the arrows pick keys here.
      pressed.preventDefault();
      pressed.stopPropagation();
      this.setValue(name);
      Blockly.DropDownDiv.hideWithoutAnimation();
    };
    window.addEventListener('keydown', this.keyPick, true);
  }

  protected override dropdownDispose_(): void {
    if (this.keyPick) window.removeEventListener('keydown', this.keyPick, true);
    this.keyPick = null;
    super.dropdownDispose_();
  }

  override getText(): string {
    const value = this.getValue() ?? '';
    const match = optionsFor(this.source, value).find(([, option]) => option === value);
    const label = match?.[0];
    return typeof label === 'string' ? label : '없음';
  }
}

let registered = false;

export function registerFields(): void {
  if (registered) return;
  registered = true;
  Blockly.fieldRegistry.register('field_tess_dropdown', TessDropdown);
}
