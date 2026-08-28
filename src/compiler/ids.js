// Entry-style id generator.
//
// Every Entry id is 4 chars of [a-z0-9] (Entry.generateHash). Uses a
// seeded PRNG so compiling the same source always yields the same ids.
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** FNV-1a 32-bit hash — derives a seed from the source string. */
export function seedFrom(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Creates a function that keeps producing unique 4-char ids. */
export function createIdFactory(seed = 0) {
  let state = (seed || 0x9e3779b9) >>> 0;
  const used = new Set();

  // mulberry32
  const random = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const next = () => {
    for (;;) {
      let id = '';
      for (let i = 0; i < 4; i += 1) id += ALPHABET[Math.floor(random() * ALPHABET.length)];
      if (!used.has(id)) {
        used.add(id);
        return id;
      }
    }
  };

  next.reserve = (id) => used.add(id);
  next.has = (id) => used.has(id);
  return next;
}
