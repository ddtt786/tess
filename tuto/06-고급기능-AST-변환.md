# 06. 고급 기능: AST 변환 (`ohm-js/extras`)

지금까지는 시맨틱 액션을 직접 하나하나 작성해서 값을 계산했습니다. 하지만 때로는 "일단 파스 트리를 좀 더 다루기 쉬운 형태(AST, Abstract Syntax Tree)로 바꿔놓고, 그 다음에 처리하고 싶다"는 경우가 많습니다. Ohm은 이를 위한 `extras` 모듈을 별도로 제공합니다.

## CST와 AST의 차이

- **CST (Concrete Syntax Tree, 구체 구문 트리)**: Ohm이 매칭할 때 내부적으로 만드는 트리로, 문법의 모든 세부사항(괄호, 구분자 등)이 그대로 남아있습니다.
- **AST (Abstract Syntax Tree, 추상 구문 트리)**: 실제 의미 있는 정보만 남기고, 괄호나 구분자 같은 "장식"은 제거한 더 간단한 트리입니다. 대부분의 컴파일러/인터프리터는 CST가 아니라 AST를 가지고 작업합니다.

`extras.toAST()`는 CST를 AST로 자동 변환해주는 헬퍼 함수입니다. 결과 형태는 [acorn](https://github.com/ternjs/acorn), [esprima](http://esprima.org/) 같은 유명 JavaScript 파서들이 쓰는 [ESTree](https://github.com/estree/estree) 포맷에서 영감을 받았습니다.

## 불러오기

```js
const extras = require('ohm-js/extras');
// extras.toAST(...) 처럼 사용
```

## 기본 사용법

```js
const ohm = require('ohm-js');
const extras = require('ohm-js/extras');

const g = ohm.grammar(`
  G {
    Equation = AddExpr
    AddExpr = number "+" number
    number = digit+
  }
`);

const match = g.match('24 + 6');
const ast = extras.toAST(match);
```

이 결과로 만들어지는 AST는 대략 이런 모양입니다.

```js
{
  "type": "AddExpr", // 'type'은 규칙 이름에서 자동으로 가져옴
  "0": "24",         // AddExpr 규칙의 0번째 부분
  "2": "6"            // AddExpr 규칙의 2번째 부분 (1번째인 "+"는 리터럴이라 생략됨)
}
```

## 기본 변환 규칙 (mapping을 안 줬을 때)

별도 설정 없이 `toAST()`를 호출하면 아래 5가지 규칙이 자동으로 적용됩니다.

1. AST의 모든 노드는 매칭에 사용된 규칙 이름에서 따온 **`type` 속성**을 가집니다. (`-- caseName`으로 만들어진 인라인 규칙이면 `규칙이름_caseName` 형태)
2. 값이 **고정된 문자열 리터럴**(예: 위 예시의 `"+"`)이면 AST에서 생략됩니다. (단, 여러 후보 중 하나로 매칭된 경우는 생략되지 않습니다.)
3. 자식이 딱 하나뿐인 규칙은 **중간 노드**로 간주되어 생략되고, 자식의 값이 그대로 올라옵니다.
4. `*`, `+`, `ListOf` 같은 **반복될 수 있는** 부분은 배열로 표현되고, `?`(선택) 부분은 매칭된 값 또는 `null`로 표현됩니다.
5. 내장 리스트 규칙(`ListOf`/`listOf` 등)은 구분자를 버리고 값들의 배열로 표현됩니다.

## `mapping`으로 변환 방식 커스터마이징하기

두 번째 인자로 매핑 객체를 넘기면, 특정 규칙에 대해 원하는 형태로 변환 방식을 바꿀 수 있습니다.

```js
const ast = extras.toAST(match, {
  Equation: { content: 0 },
  AddExpr: { type: 'Expression', expr1: 0, op: 1, expr2: 2 },
});
```

결과는 이렇게 바뀝니다.

```js
{
  "type": "Equation",      // 다시 노드로 명시적으로 되살림
  "content": {              // "0"번째를 "content"라는 이름으로
    "type": "Expression",   // type 이름을 직접 지정
    "expr1": "24",           // "0"번째를 "expr1"이라는 이름으로
    "op": "+",               // 원래는 생략됐을 값을 명시적으로 되살림
    "expr2": "6"             // "2"번째를 "expr2"라는 이름으로
  }
}
```

### mapping에서 규칙 이름(노드 단위)에 쓸 수 있는 값

| 값 종류 | 의미 |
|---|---|
| 객체 | 해당 노드를 어떤 형태로 만들지 정하는 템플릿 (아래 "속성 단위" 참고) |
| 숫자 | 그 규칙에 대해서는 노드를 만들지 않고, 지정한 번째 자식으로 그대로 대체 (노드 생략) |
| 함수 | 그 규칙 전용 시맨틱 액션. 기본 동작을 대체함. 자식 노드의 기본 변환이 필요하면 `[자식].toAST(this.args.mapping)`을 호출 |

### mapping에서 속성(property) 단위에 쓸 수 있는 값

| 값 종류 | 의미 |
|---|---|
| 숫자 | 해당 번째 자식을 `toAST()`로 변환한 값을 이 속성에 넣음 |
| 문자열 / 불리언 / 객체 / `null` | 그 값을 그대로 사용 |
| 함수 | 모든 자식 노드 배열을 인자로 받는 함수. `[자식].toAST(this.args.mapping)`으로 개별 자식을 변환 가능 |

> 💡 속성 값으로 순수한 숫자(예: `12`)를 그대로 쓰고 싶다면 `new Number(12)`처럼 박싱해서 넣어야 합니다. (그냥 숫자를 쓰면 "몇 번째 자식을 가리키는 인덱스"로 해석되기 때문입니다.)

## 언제 `toAST()`를 쓰면 좋을까?

- 문법 구조가 복잡하지 않고, 계산 로직도 단순할 때는 [03번 문서](./03-시맨틱-액션과-오퍼레이션.md)에서 배운 `addOperation`으로 직접 계산하는 것으로 충분합니다.
- 문법이 크고(예: 프로그래밍 언어 하나를 통째로 파싱), AST를 다른 여러 단계(타입 검사, 최적화, 코드 생성 등)에서 재사용해야 한다면, `toAST()`로 먼저 깔끔한 AST를 만들어두고 그 위에서 작업하는 게 유리합니다.

## `asIteration` 다시 보기

[03번 문서](./03-시맨틱-액션과-오퍼레이션.md)에서 살펴본 `asIteration`도 `ListOf` 계열을 다룰 때 함께 기억해두면 좋은 도구입니다. `toAST()`를 안 쓰고 직접 오퍼레이션을 작성할 때, 리스트를 배열처럼 다루고 싶다면 `asIteration()`을 활용하세요.

```js
s.addOperation('upper()', {
  Start(list) {
    return list.asIteration().children.map(c => c.upper());
  }
});
```

다음 문서에서는 그래머가 예상대로 동작하지 않을 때 원인을 찾는 방법(디버깅)과, 자주 만나는 에러 메시지들을 정리합니다. → [07-디버깅과-에러.md](./07-디버깅과-에러.md)
