/**
 * @license
 * Copyright 2026 Tess contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `JSON.stringify` for values nested deeper than the built-in allows: a saved
 * stack nests each block under the one before it, and the built-in recurses
 * once per level.
 *
 * @internal
 */

type Task = string | {value: unknown; inArray: boolean};

/** Same text as `JSON.stringify(value)`, without recursion. */
export function stringifyDeep(value: unknown): string {
  const out: string[] = [];
  const stack: Task[] = [{value, inArray: true}];
  while (stack.length) {
    const task = stack.pop()!;
    if (typeof task === 'string') {
      out.push(task);
      continue;
    }
    let current = task.value;
    if (
      current &&
      typeof (current as {toJSON?: unknown}).toJSON === 'function'
    ) {
      current = (current as {toJSON: () => unknown}).toJSON();
    }
    if (current === null || typeof current !== 'object') {
      out.push(skipped(current) ? 'null' : JSON.stringify(current));
      continue;
    }
    const items: Task[] = [];
    if (Array.isArray(current)) {
      items.push('[');
      current.forEach((item, index) => {
        if (index) items.push(',');
        items.push({value: item, inArray: true});
      });
      items.push(']');
    } else {
      const record = current as Record<string, unknown>;
      items.push('{');
      let first = true;
      for (const key of Object.keys(record)) {
        if (skipped(record[key])) continue;
        items.push(`${first ? '' : ','}${JSON.stringify(key)}:`);
        items.push({value: record[key], inArray: false});
        first = false;
      }
      items.push('}');
    }
    for (let index = items.length - 1; index >= 0; index--) {
      stack.push(items[index]);
    }
  }
  return out.join('');
}

/** Values `JSON.stringify` leaves out of objects and writes as null in arrays. */
function skipped(value: unknown): boolean {
  return (
    value === undefined ||
    typeof value === 'function' ||
    typeof value === 'symbol'
  );
}
