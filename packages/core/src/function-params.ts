/**
 * @fileoverview 함수 매개변수 이름 생성 및 검증을 담당하는 유틸리티.
 */

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

/**
 * 인덱스에 해당하는 매개변수의 자동 생성 이름을 반환합니다.
 * 
 * 인덱스가 알파벳 갯수보다 작으면 알파벳 순서대로(a, b, ... z) 반환하고,
 * 그 이상이면 a1, a2 등의 형식으로 반환합니다.
 *
 * @param index - 매개변수의 인덱스 (0부터 시작)
 * @returns 생성된 자동 매개변수 이름
 *
 * @example
 * autoParamName(0); // "a"
 * autoParamName(1); // "b"
 * autoParamName(26); // "a1"
 */
export function autoParamName(index: number): string {
  return index < LETTERS.length ? LETTERS[index] : `a${index - LETTERS.length + 1}`;
}

/**
 * 주어진 이름이 해당 인덱스의 자동 생성 이름과 일치하는지 확인합니다.
 *
 * @param name - 확인할 매개변수 이름
 * @param index - 매개변수의 인덱스 (0부터 시작)
 * @returns 자동 생성 이름과 일치 여부
 *
 * @example
 * isAutoParamName("a", 0); // true
 * isAutoParamName("customName", 1); // false
 */
export function isAutoParamName(name: string, index: number): boolean {
  return name === autoParamName(index);
}
