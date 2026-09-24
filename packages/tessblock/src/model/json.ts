/**
 * @fileoverview `JSON.stringify` and a deep copy for values nested deeper than
 * the built-ins allow. A saved script nests each block under the one before
 * it (`next.block`), and the built-in stringify and `structuredClone` recurse
 * once per level, so a long script throws "Maximum call stack size exceeded".
 */

type Task = string | { value: unknown; depth: number; inArray: boolean };

/** Same text as `JSON.stringify(value, null, indent)`, without recursion. */
export function stringify(value: unknown, indent = 0): string {
  const out: string[] = [];
  const pad = (depth: number) => (indent ? `\n${' '.repeat(indent * depth)}` : '');
  const colon = indent ? ': ' : ':';
  const stack: Task[] = [{ value, depth: 0, inArray: true }];
  while (stack.length) {
    const task = stack.pop()!;
    if (typeof task === 'string') {
      out.push(task);
      continue;
    }
    let current = task.value;
    if (current && typeof (current as { toJSON?: unknown }).toJSON === 'function') {
      current = (current as { toJSON: () => unknown }).toJSON();
    }
    if (current === null || typeof current !== 'object') {
      out.push(skipped(current) ? 'null' : JSON.stringify(current));
      continue;
    }
    const depth = task.depth + 1;
    const items: Task[] = [];
    if (Array.isArray(current)) {
      if (!current.length) {
        out.push('[]');
        continue;
      }
      items.push('[');
      current.forEach((item, index) => {
        items.push(`${index ? ',' : ''}${pad(depth)}`, { value: item, depth, inArray: true });
      });
      items.push(`${pad(task.depth)}]`);
    } else {
      const record = current as Record<string, unknown>;
      const keys = Object.keys(record).filter((key) => !skipped(record[key]));
      if (!keys.length) {
        out.push('{}');
        continue;
      }
      items.push('{');
      keys.forEach((key, index) => {
        items.push(`${index ? ',' : ''}${pad(depth)}${JSON.stringify(key)}${colon}`, {
          value: record[key],
          depth,
          inArray: false,
        });
      });
      items.push(`${pad(task.depth)}}`);
    }
    for (let index = items.length - 1; index >= 0; index--) stack.push(items[index]!);
  }
  return out.join('');
}

/** Values `JSON.stringify` leaves out of objects and writes as null in arrays. */
function skipped(value: unknown): boolean {
  return value === undefined || typeof value === 'function' || typeof value === 'symbol';
}

/** A deep copy of plain JSON data, however deeply it nests. */
export function copyDeep<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(stringify(value)) as T);
}
