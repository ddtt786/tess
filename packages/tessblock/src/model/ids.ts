/** Short unique ids for model records. */
let counter = 0;

export function newId(prefix = 'i'): string {
  counter += 1;
  const stamp = Date.now().toString(36).slice(-4);
  const rand = Math.random().toString(36).slice(2, 6);
  return `${prefix}${stamp}${rand}${counter.toString(36)}`;
}
