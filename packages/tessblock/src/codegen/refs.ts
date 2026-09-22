/**
 * @fileoverview Turns the ids blocks store into the names Tess reads.
 *
 * Variables, lists and tables become identifiers, which the project writer
 * hands over so two records that sanitise alike keep their own name.
 */
import { project } from '../model/store.ts';
import { safeIdent } from './ident.ts';
import type { DynamicSource } from '../blocks/spec.ts';

/** Special slots that stand for themselves rather than for a record. */
const LITERALS = new Set(['mouse', 'wall', 'wall_up', 'wall_down', 'wall_left', 'wall_right', 'self']);

let idents = new Map<string, string>();

/** Installs the id to identifier table the current write uses. */
export function useIdents(table: Map<string, string>): void {
  idents = table;
}

export function identFor(id: string, fallbackName: string): string {
  return idents.get(id) ?? safeIdent(fallbackName);
}

export function resolveDynamic(source: DynamicSource, value: string): string {
  if (!value) return source === 'variable' || source === 'list' || source === 'table' ? '없음' : '';
  if (source === 'key' || source === 'tableColumn') return value;
  if (LITERALS.has(value)) return value;

  const model = project.value;
  switch (source) {
    case 'object':
    case 'target':
    case 'lookTarget':
    case 'cloneTarget':
      return model.objects.find((object) => object.id === value)?.name ?? '';
    case 'signal':
      return model.signals.find((signal) => signal.id === value)?.name ?? '';
    case 'scene':
      return model.scenes.find((scene) => scene.id === value)?.name ?? '';
    case 'costume': {
      for (const object of model.objects) {
        const costume = object.costumes.find((candidate) => candidate.id === value);
        if (costume) return costume.name;
      }
      return '';
    }
    case 'sound': {
      for (const object of model.objects) {
        const sound = object.sounds.find((candidate) => candidate.id === value);
        if (sound) return sound.name;
      }
      return '';
    }
    case 'variable':
    case 'list': {
      const variable = model.variables.find((candidate) => candidate.id === value);
      return variable ? identFor(variable.id, variable.name) : '없음';
    }
    case 'table': {
      const table = model.tables.find((candidate) => candidate.id === value);
      return table ? identFor(table.id, table.name) : '없음';
    }
    default:
      return value;
  }
}
