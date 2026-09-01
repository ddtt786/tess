// ============================================================================
//  함수 매개변수 이름 규칙 — 컴파일러와 되돌리기가 공유한다
//
//  엔트리 함수 머리는 라벨과 매개변수 칸이 번갈아 나올 수 있는 사슬이다. Tess 에는
//  그 마디가 없으므로 정보를 매개변수 이름에 담는다 (SPEC-ADDENDUM.md 4.6).
//
//    라벨-인수-인수      ->  이름(a, b)      맨 앞 라벨만 함수 이름
//    라벨-인수-라벨-인수  ->  이름(a, 체력)    중간 라벨은 바로 뒤 인수의 이름
//    라벨-인수-라벨      ->  이름(a)         뒤에 인수가 없는 라벨은 사라진다
// ============================================================================
const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

/** 라벨이 없는 i 번째(0부터 센다) 매개변수의 자동 이름: a, b, … z, a1, a2, … */
export function autoParamName(index: number): string {
  return index < LETTERS.length ? LETTERS[index] : `a${index - LETTERS.length + 1}`;
}

/** 이 이름이 그 자리의 자동 이름과 같은지 확인한다. 같으면 라벨이 없는 매개변수이다. */
export function isAutoParamName(name: string, index: number): boolean {
  return name === autoParamName(index);
}
