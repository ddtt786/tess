/** Signals the interface itself owns: tabs, drawers and dialogs. */
import { signal } from '@preact/signals';
import type { FunctionDef } from '../model/types.ts';

export type EditorTab = 'blocks' | 'costumes' | 'sounds' | 'properties';
export type PropertyTab = 'variable' | 'list' | 'signal' | 'table' | 'function';

export const editorTab = signal<EditorTab>('blocks');
export const propertyTab = signal<PropertyTab>('variable');
export const codeOpen = signal(false);
export const functionDraft = signal<FunctionDef | null>(null);
export const toast = signal<string>('');

let toastTimer: number | undefined;

export function notify(message: string): void {
  toast.value = message;
  if (toastTimer !== undefined) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.value = '';
  }, 2600) as unknown as number;
}

export type DialogKind = 'variable' | 'list' | 'signal' | 'table';

export const dialog = signal<DialogKind | null>(null);
