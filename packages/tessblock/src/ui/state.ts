/** Signals the interface itself owns: tabs, drawers and dialogs. */
import { signal } from '@preact/signals';
import type { FunctionDef } from '../model/types.ts';

export type EditorTab = 'blocks' | 'costumes' | 'sounds' | 'properties';
export type PropertyTab = 'variable' | 'list' | 'signal' | 'table' | 'function';

export const editorTab = signal<EditorTab>('blocks');
export const propertyTab = signal<PropertyTab>('variable');
/** The list the property pane has open, so a new one shows itself. */
export const pickedList = signal('');

/** What the palette is being searched for; empty shows the chosen category. */
export const blockQuery = signal('');

export const codeOpen = signal(false);
/** While on, the stage shows the handle that moves an object's centre point. */
export const centerMode = signal(true);

export const stageFullscreen = signal(false);

export const functionDraft = signal<FunctionDef | null>(null);
export const toast = signal<string>('');

/** A single stack to run on the stage (double-clicked block); the stage picks it up. */
export const debugRequest = signal<{ source: string; scene: string; label: string; boost: boolean } | null>(null);
/** The double-clicked stack while it is still running, so the canvas can light it up. */
export const runningStack = signal<{ objectId: string; blockId: string } | null>(null);
/** A double-clicked stack's session is running; more double-clicks join it rather than start over. */
export const debugLive = signal(false);

/** A long job the whole editor waits on, with its progress (0–1). Null when idle. */
export const busy = signal<{ step: string; done: number } | null>(null);

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
