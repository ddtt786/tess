/**
 * @fileoverview The function the modal editor currently has open.
 *
 * Parameter dropdowns read it, so a parameter block always offers the
 * parameters of the function it sits in.
 */
import { signal } from '@preact/signals';
import type { FunctionDef } from './types.ts';

export const editingFunction = signal<FunctionDef | null>(null);
