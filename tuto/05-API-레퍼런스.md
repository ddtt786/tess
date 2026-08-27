# 05. API 레퍼런스

지금까지 실습하면서 사용했던 함수/메서드들을 한 곳에 정리했습니다. 필요할 때 찾아보는 용도로 활용하세요.

## 그래머 인스턴스 만들기

### `ohm.grammar(source, optNamespace?)` → `Grammar`

문자열 `source`로부터 하나의 Grammar를 만듭니다.

```js
const g = ohm.grammar(String.raw`
  Parent {
    start = "parent"
  }
`);
```

`source`가 다른 문법을 상속받는 경우(`Child <: Parent { ... }`), `optNamespace`에 그 상위 문법을 담은 객체를 넘겨줘야 합니다.

```js
const parentDef = String.raw`
  Parent {
    start = "parent"
  }
`;
const parentGrammar = ohm.grammar(parentDef);

const childDef = String.raw`
  Child <: Parent {
    start := "child"
  }
`;
const childGrammar = ohm.grammars(childDef, { Parent: parentGrammar });
```

### `ohm.grammars(source, optNamespace?)` → `object`

`source` 안에 정의된 **여러 개의 문법**을 한 번에 인스턴스화해서, `{ 문법이름: Grammar }` 형태의 객체로 돌려줍니다.

```js
const combinedDef = parentDef.concat(childDef);
const grammars = ohm.grammars(combinedDef);
console.log(Object.keys(grammars)); // ['Parent', 'Child']
```

## Grammar 객체

Grammar 인스턴스 `g`가 갖는 메서드입니다.

| 메서드 | 설명 |
|---|---|
| `g.match(str, optStartRule?)` → `MatchResult` | `str`을 `g`로 매칭 시도. `optStartRule`을 주면 특정 규칙부터 시작 (생략 시 문법의 첫 번째 규칙) |
| `g.matcher()` → `Matcher` | 입력이 계속 바뀌는 상황(에디터 등)에서 점진적으로 매칭하는 Matcher 생성 |
| `g.trace(str, optStartRule?)` → `Trace` | `match()`와 비슷하지만, 파싱 과정을 단계별로 보여주는 Trace 객체를 반환 (`.toString()`으로 텍스트 출력) |
| `g.createSemantics()` → `Semantics` | 이 문법을 위한 새 Semantics 생성 |
| `g.extendSemantics(superSemantics)` → `Semantics` | 상위 Semantics의 오퍼레이션/어트리뷰트를 모두 물려받는 새 Semantics 생성. `g`는 반드시 `superSemantics`가 속한 문법의 하위 문법이어야 함 |

## Matcher 객체 — 점진적(incremental) 매칭

코드 에디터처럼 입력이 조금씩 계속 바뀌는 상황을 위한 기능입니다. `replaceInputRange`로 입력의 일부만 바꾸면, 이전 매칭 결과를 최대한 재사용해서 다시 매칭하는 시간을 크게 줄여줍니다.

| 메서드 | 설명 |
|---|---|
| `m.getInput()` → `string` | 현재 입력 문자열 반환 |
| `m.setInput(str)` | 입력 문자열 전체를 `str`로 교체 |
| `m.replaceInputRange(startIdx, endIdx, str)` | `startIdx`~`endIdx` 구간의 문자를 `str`로 교체 |
| `m.match(optStartRule?)` → `MatchResult` | `Grammar.match()`와 같지만 점진적으로 동작 |
| `m.trace(optStartRule?)` → `Trace` | `Grammar.trace()`와 같지만 점진적으로 동작 |

```js
const m = g.matcher();
m.setInput('2 + 3');
console.log(m.match().succeeded()); // true

m.replaceInputRange(4, 5, '30'); // '2 + 3' -> '2 + 30'
console.log(m.match().succeeded()); // true
```

## MatchResult 객체

`match()`나 `matcher().match()`의 반환값입니다.

| 메서드 | 설명 |
|---|---|
| `r.succeeded()` → `boolean` | 매칭 성공 여부 |
| `r.failed()` → `boolean` | 매칭 실패 여부 |

### 매칭이 실패했을 때 (`r.failed() === true`)

추가로 아래 속성/메서드를 쓸 수 있습니다.

| 속성/메서드 | 설명 |
|---|---|
| `r.message` | 실패 위치와 원인을 담은 메시지 (최종 사용자에게 보여줘도 되는 수준) |
| `r.shortMessage` | `message`의 축약 버전 (입력 발췌 없이) |
| `r.getRightmostFailurePosition()` → `number` | 매칭이 실패한 입력상의 위치(인덱스) |
| `r.getRightmostFailures()` → `Array` | 그 위치에서 발생한 실패들에 대한 Failure 객체 배열 |

```js
const bad = g.match('2 +');
if (bad.failed()) {
  console.log(bad.message);
  console.log(bad.getRightmostFailurePosition());
}
```

## Semantics / Operation / Attribute

자세한 개념 설명은 [03-시맨틱-액션과-오퍼레이션.md](./03-시맨틱-액션과-오퍼레이션.md)를 참고하고, 여기서는 메서드 시그니처만 정리합니다.

| 메서드 | 설명 |
|---|---|
| `s.addOperation(nameOrSignature, actionDict)` | 새 Operation 추가 |
| `s.addAttribute(name, actionDict)` | 새 Attribute 추가 (결과가 캐싱됨) |
| `s.extendOperation(name, actionDict)` | 상위 Semantics의 Operation을 확장 |
| `s.extendAttribute(name, actionDict)` | 상위 Semantics의 Attribute를 확장 |

모두 `this`(체이닝 가능한 Semantics 객체)를 반환합니다.

Operation/Attribute를 실행하려면, Semantics 객체에 MatchResult를 적용합니다.

```js
mySemantics(matchResult).prettyPrint(); // 오퍼레이션 호출
mySemantics(matchResult).value;         // 어트리뷰트는 프로퍼티처럼 접근
```

## 파스 노드(Parse Node)

시맨틱 액션 함수 안에서 받는 각 인자가 바로 파스 노드입니다.

| 이름 | 설명 |
|---|---|
| `n.child(idx)` | idx번째 자식 노드 |
| `n.isTerminal()` | 터미널 노드 여부 |
| `n.isIteration()` | 반복 노드 여부 |
| `n.children` | 자식 노드 배열 |
| `n.ctorName` | 이 노드를 만든 규칙 이름 |
| `n.source` | 소비한 입력 구간(Interval) |
| `n.sourceString` | 소비한 입력 문자열 |
| `n.numChildren` | 자식 개수 |
| `n.isOptional()` | `?`로 생긴 노드인지 여부 |

## 정리 — 전체 흐름 한눈에 보기

```
ohm.grammar(source)             문법 문자열 → Grammar
        │
        ▼
   g.match(input)                입력 문자열 → MatchResult
        │
        ▼
 g.createSemantics()             Grammar → Semantics
        │
        ▼
 s.addOperation(...)             동작 등록
        │
        ▼
   s(matchResult).연산()        실제 값 계산
```

다음 문서에서는 매칭 결과를 AST(추상 구문 트리)로 자동 변환해주는 `ohm-js/extras`를 살펴봅니다. → [06-고급기능-AST-변환.md](./06-고급기능-AST-변환.md)
