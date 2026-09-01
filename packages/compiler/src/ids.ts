// ============================================================================
//  엔트리 스타일 식별자 생성기
//
//  엔트리의 모든 id 는 [a-z0-9] 4글자다 (Entry.generateHash).
//  같은 소스를 컴파일하면 항상 같은 결과가 나오도록 시드 기반 난수를 쓴다.
// ============================================================================
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** FNV-1a 32비트 해시 — 소스 문자열에서 시드를 만든다 */
export function seedFrom(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Hands out unique four-character ids, and remembers the ones taken already. */
export interface IdFactory {
  (): string;
  reserve(id: string): void;
  has(id: string): boolean;
}

/** 중복 없는 4글자 id 를 계속 뽑아주는 함수를 만든다 */
export function createIdFactory(seed = 0): IdFactory {
  let state = (seed || 0x9e3779b9) >>> 0;
  const used = new Set<string>();

  // mulberry32
  const random = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const next = (() => {
    for (;;) {
      let id = '';
      for (let i = 0; i < 4; i += 1) id += ALPHABET[Math.floor(random() * ALPHABET.length)];
      if (!used.has(id)) {
        used.add(id);
        return id;
      }
    }
  }) as IdFactory;

  next.reserve = (id: string) => { used.add(id); };
  next.has = (id: string) => used.has(id);
  return next;
}
