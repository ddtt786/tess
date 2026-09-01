// ============================================================================
//  "혹시 이걸 쓰려던 건가요?"
//
//  이름을 하나 잘못 적었을 뿐인데 "그런 것 없습니다" 만 돌려주면, 어디가 틀렸는지
//  눈으로 찾아야 한다. 아는 이름 중 가장 가까운 것을 같이 알려 준다.
// ============================================================================

/**
 * 두 이름을 같게 만드는 데 드는 최소 편집 횟수 (Damerau-Levenshtein).
 *
 * 붙어 있는 두 글자가 바뀐 것(`lenght` <-> `length`)도 한 번으로 센다 — 손으로 칠 때
 * 가장 흔한 실수라, 이걸 두 번으로 세면 정작 찾아 줘야 할 오타를 놓친다.
 */
export function editDistance(a, b) {
  if (a === b) return 0;
  const rows = a.length + 1;
  const cols = b.length + 1;
  const grid = Array.from({ length: rows }, (unused, i) => {
    const row = new Array(cols).fill(0);
    row[0] = i;
    return row;
  });
  for (let j = 0; j < cols; j += 1) grid[0][j] = j;

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      grid[i][j] = Math.min(
        grid[i - 1][j] + 1,        // 지우기
        grid[i][j - 1] + 1,        // 넣기
        grid[i - 1][j - 1] + cost, // 바꾸기
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        grid[i][j] = Math.min(grid[i][j], grid[i - 2][j - 2] + 1); // 자리 바꾸기
      }
    }
  }
  return grid[a.length][b.length];
}

/** 이 길이의 이름에서 오타로 봐 줄 만한 최대 편집 횟수 */
function tolerance(length) {
  if (length <= 3) return 1;
  return length <= 8 ? 2 : 3;
}

/**
 * 후보 중 가장 가까운 이름. 오타로 보기 어려울 만큼 멀면 null.
 *
 * @param {string} name 사람이 적은 이름
 * @param {Iterable<string>} candidates 실제로 있는 이름들
 * @returns {string|null}
 */
export function nearestName(name, candidates) {
  if (!name) return null;
  const target = String(name).toLowerCase();
  const limit = tolerance(target.length);

  let best = null;
  let bestScore = Infinity;
  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null) continue;
    const text = String(candidate);
    if (text === name) continue; // 같은 이름이면 애초에 여기 오지 않는다
    const score = editDistance(target, text.toLowerCase());
    if (score < bestScore) {
      bestScore = score;
      best = text;
    }
  }
  return bestScore <= limit ? best : null;
}

/**
 * 메시지 뒤에 그대로 이어 붙일 안내. 가까운 이름이 없으면 빈 글자열이라,
 * 부르는 쪽에서 따로 따지지 않아도 된다.
 *
 * @param {string} name
 * @param {Iterable<string>} candidates
 */
export function didYouMean(name, candidates) {
  const found = nearestName(name, candidates);
  return found ? ` 혹시 '${found}' 인가요?` : '';
}

/**
 * 가까운 이름이 있으면 그것을, 없으면 대신 알려 줄 안내를 붙인다.
 *
 * 오타로 보이는데 "그 이름으로 새로 등록하세요" 라고 하면 서로 어긋난 말이 된다.
 * 둘 중 도움이 되는 쪽 하나만 낸다.
 *
 * @param {string} name
 * @param {Iterable<string>} candidates
 * @param {string} hint 가까운 이름이 없을 때 낼 안내
 */
export function orHint(name, candidates, hint) {
  const found = nearestName(name, candidates);
  return found ? ` 혹시 '${found}' 인가요?` : ` ${hint}`;
}
