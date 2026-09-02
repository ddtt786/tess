/**
 * 엔트리 스타일의 식별자(ID) 생성기 모듈입니다.
 * 
 * 엔트리의 모든 ID는 영소문자와 숫자로 이루어진 4자리 문자열입니다.
 * 컴파일 결과의 일관성을 위해 시드 기반의 난수 생성을 사용합니다.
 */
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/**
 * 주어진 문자열에서 FNV-1a 32비트 해시 알고리즘을 사용하여 시드(seed) 값을 생성합니다.
 * 
 * @param text 시드를 생성할 원본 문자열
 * @returns 32비트 정수형 시드 값
 * @example
 * ```typescript
 * const seed = seedFrom('my_scene_name');
 * ```
 */
export function seedFrom(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * 고유한 4자리 문자열 ID를 발급하고, 이미 사용된 ID를 기억하는 팩토리 함수 인터페이스입니다.
 * 
 * @example
 * ```typescript
 * const getNewId = createIdFactory();
 * const id1 = getNewId(); // 'a1b2'
 * getNewId.reserve('c3d4');
 * const isUsed = getNewId.has('c3d4'); // true
 * ```
 */
export interface IdFactory {
  (): string;
  reserve(id: string): void;
  has(id: string): boolean;
}

/**
 * 중복 없는 4자리 문자열 ID를 생성하는 팩토리 함수를 반환합니다.
 * 
 * @param seed 난수 생성기의 초기 시드 값 (기본값: 0)
 * @returns ID를 생성하고 관리할 수 있는 `IdFactory` 함수
 * @example
 * ```typescript
 * const generateId = createIdFactory(12345);
 * const newId = generateId();
 * ```
 */
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
