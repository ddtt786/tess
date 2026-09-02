/**
 * @fileoverview 오타 교정 및 가장 유사한 이름 추천 기능
 */

/**
 * 두 문자열 간의 Damerau-Levenshtein 편집 거리를 계산합니다.
 *
 * 두 글자의 순서가 바뀐 경우(예: 'lenght'와 'length')도 단일 편집으로 처리하여
 * 일반적인 오타를 더 정확하게 잡아냅니다.
 *
 * @param a - 비교할 첫 번째 문자열
 * @param b - 비교할 두 번째 문자열
 * @returns 최소 편집 횟수
 *
 * @example
 * editDistance("length", "lenght"); // 1
 * editDistance("apple", "apply"); // 1
 */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const rows = a.length + 1;
  const cols = b.length + 1;
  const grid = Array.from({ length: rows }, (unused: unknown, i: number) => {
    const row = new Array(cols).fill(0);
    row[0] = i;
    return row;
  });
  for (let j = 0; j < cols; j += 1) grid[0][j] = j;

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      grid[i][j] = Math.min(
        grid[i - 1][j] + 1,
        grid[i][j - 1] + 1,
        grid[i - 1][j - 1] + cost,
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        grid[i][j] = Math.min(grid[i][j], grid[i - 2][j - 2] + 1);
      }
    }
  }
  return grid[a.length][b.length];
}

/**
 * 문자열 길이에 따라 허용되는 최대 편집 횟수를 반환합니다.
 *
 * @param length - 기준 문자열의 길이
 * @returns 허용되는 최대 편집 횟수
 *
 * @example
 * tolerance(3); // 1
 * tolerance(5); // 2
 * tolerance(10); // 3
 */
function tolerance(length: number): number {
  if (length <= 3) return 1;
  return length <= 8 ? 2 : 3;
}

/**
 * 제공된 후보 목록 중 가장 유사한 이름을 찾습니다.
 * 허용 오차 범위를 벗어날 경우 null을 반환합니다.
 *
 * @param name - 검색할 대상 이름
 * @param candidates - 비교할 식별자 목록
 * @returns 가장 유사한 이름 또는 null
 *
 * @example
 * nearestName("aple", ["apple", "banana"]); // "apple"
 * nearestName("xyz", ["apple", "banana"]); // null
 */
export function nearestName(name: string, candidates: Iterable<string>): string | null {
  if (!name) return null;
  const target = String(name).toLowerCase();
  const limit = tolerance(target.length);

  let best = null;
  let bestScore = Infinity;
  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null) continue;
    const text = String(candidate);
    if (text === name) continue; 
    const score = editDistance(target, text.toLowerCase());
    if (score < bestScore) {
      bestScore = score;
      best = text;
    }
  }
  return bestScore <= limit ? best : null;
}

/**
 * 가장 유사한 이름이 있을 경우 추천 메시지를 반환합니다.
 * 
 * @param name - 검색할 대상 이름
 * @param candidates - 비교할 식별자 목록
 * @returns 오타 추천 메시지 또는 빈 문자열
 *
 * @example
 * didYouMean("forwad", ["forward", "turn"]); // " 혹시 'forward' 인가요?"
 * didYouMean("xyz", ["forward", "turn"]); // ""
 */
export function didYouMean(name: string, candidates: Iterable<string>): string {
  const found = nearestName(name, candidates);
  return found ? ` 혹시 '${found}' 인가요?` : '';
}

/**
 * 가장 유사한 이름이 있을 경우 해당 이름을 추천하고,
 * 없을 경우 대체 안내 메시지를 반환합니다.
 *
 * @param name - 검색할 대상 이름
 * @param candidates - 비교할 식별자 목록
 * @param hint - 추천할 이름이 없을 때 반환할 기본 안내 메시지
 * @returns 추천 메시지 또는 기본 안내 메시지
 *
 * @example
 * orHint("forwad", ["forward"], "새로 등록하세요."); // " 혹시 'forward' 인가요?"
 * orHint("xyz", ["forward"], "새로 등록하세요."); // " 새로 등록하세요."
 */
export function orHint(name: string, candidates: Iterable<string>, hint: string): string {
  const found = nearestName(name, candidates);
  return found ? ` 혹시 '${found}' 인가요?` : ` ${hint}`;
}
