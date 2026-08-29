# Tess 파서 — chevrotain 구현 노트

Ohm(`src/legacy/tess.ohm`)으로 쓰여 있던 파서를 [chevrotain](https://chevrotain.io/)
으로 옮긴 기록이다. **언어 문법은 한 글자도 바꾸지 않았다.** 내부 구현만 교체했고,
그 사실을 아래 "동등성 검증" 절의 방법으로 확인했다.

---

## 1. 파일 구성

| 파일 | 역할 |
| --- | --- |
| `src/parser/tokens.js` | 토큰 정의, 키워드 목록, 예약어, 렉서 |
| `src/parser/parser.js` | 문법 규칙 (`CstParser`) |
| `src/parser/visitor.js` | CST → AST 변환 |
| `src/parser/index.js` | `parseSource` / `checkSource`, 에러 렌더링 |
| `src/parse.js` | 공개 API (`parse`, `parseOrThrow`, `check`) |
| `src/legacy/tess.ohm` | 옛 Ohm 문법. **참고용이며 아무도 읽지 않는다** |

없어진 파일: `src/grammar.js`, `src/ast.js`(Ohm 시맨틱), 의존성 `ohm-js`.

---

## 2. 렉서 설계

### 2.1 키워드를 나중에 다시 붙인다

Ohm은 스캐너가 없어서 `size = "size" ~identifierPart` 처럼 문맥마다 키워드를
판정했다. 그래서 Tess에서는 `var size = 5` 처럼 **키워드를 변수 이름으로 쓸 수
있다**. 예약어는 `and or not true false end then do in wait` 열 개뿐이다.

렉서를 따로 두면 `size`가 무조건 키워드 토큰이 되어 이 성질이 깨진다. 그래서:

1. 낱말은 전부 `Identifier`로 렉싱한다.
2. 렉싱이 끝난 뒤 `retag()`가 이미지가 키워드와 정확히 같은 토큰만 키워드 토큰으로
   바꾼다. 이것이 `~identifierPart`(낱말 경계)와 정확히 같은 의미다.
3. 예약어가 아닌 키워드 토큰에는 `IdentLike` 카테고리를 준다. `Identifier`에도 준다.
   파서에서 이름 자리는 전부 `CONSUME(IdentLike)`이므로 `say size`가 계속 된다.

키워드 토큰의 패턴은 `Lexer.NA`다 — 렉서가 직접 만들지 않고 `retag`만 붙인다.

### 2.2 `u` 플래그 함정

chevrotain은 패턴에 sticky 플래그를 다시 붙이면서 **`u` 플래그를 버린다.** 그러면
`[\p{L}_]`가 "p, {, L, }, _ 중 한 글자"라는 엉뚱한 문자 클래스가 되어 한글
식별자가 깨진다. `Identifier`와 `ColorLiteral`은 그래서 `unicodePattern()`이
만드는 **커스텀 매칭 함수**를 쓴다. 직접 `yu` 정규식을 돌리므로 플래그가 살아있다.

식별자 모양은 문법 그대로다 — 글자는 유니코드(`\p{L}`), 숫자는 ASCII(`0-9`).

### 2.3 주석과 색상

`comment = "#" ~colorBody ...` 는 토큰 순서로 대신한다. 배열에서 `ColorLiteral`이
`Comment`보다 앞에 있고, 색상 패턴이 `#` + 16진수 6자 + `(?!식별자문자)` 이므로
`#ff0000`은 색상, `#ff00`과 `#ff0000ab`는 주석이 된다.

### 2.4 `~"="` 류 부정 전방탐색이 사라진 이유

`AddExpr "+" ~"=" MulExpr` 같은 가드는 전부 필요 없다. 렉서가 `+=`, `**=`, `==`,
`//` 를 각각 하나의 토큰으로 (긴 것 먼저) 잡기 때문이다.

---

## 3. PEG → LL 번역

Ohm은 PEG(순서 있는 선택 + 백트래킹)이고 chevrotain은 LL(k)다. 세 가지 수법으로
받아들이는 언어를 똑같이 유지했다.

### 3.1 공통 접두사 접기

`say Expr for Expr` / `say Expr` 처럼 앞이 같은 대안은 **선택지를 나열하지 않고**
꼬리를 `OPTION`으로 만든다. 순서 있는 선택과 결과가 같으면서 백트래킹이 없다.
`play sound`, `costume`, `when key … up`, `turn … in`, `stop …` 이 모두 이 방식이다.

### 3.2 게이트 + `IGNORE_AMBIGUITIES`

순서가 의미를 가르는 자리에서는 대안마다 `GATE`를 달고 `IGNORE_AMBIGUITIES: true`
를 준다. chevrotain은 게이트를 통과한 **첫 번째** 대안을 고르므로 PEG와 같아진다.
`statement`, `propertyDecl`, `primaryExpr`, `jumpStatement`, `assignOrCall`이 해당한다.

### 3.3 문장 첫 키워드 판정 — `leads()`

`say = 5`는 Ohm에서 `LooksStatement_say`가 실패하고 `AssignStatement`로 떨어져
**변수 `say`에 대입**이 된다. 반대로 `stop = 5`는 `stop` 단독형이 먼저 성공해
버려서 뒤의 `= 5`가 남고 **에러**가 된다.

`leads(kw)`가 이 두 경우를 가른다:

- 다음 토큰이 대입 연산자나 `[` 이면 → 대입문으로 넘긴다.
- 단, `STANDALONE_LEADERS`(인자 없이도 완성되는 문장: `stop break skip restart
  bounce stamp show hide clone kill`)는 넘기지 않는다. 문법이 이미 그 키워드에
  확정되기 때문이다.

`say(1)`이 함수 호출이 아니라 `say (1)`인 것도 그대로다 — `(`는 넘김 조건이 아니다.

### 3.4 블록이 끝나는 곳 — `startsStatement()`

`else`는 예약어가 아니라서 변수 이름으로 쓸 수 있다. 그래서 `Block = Statement*`
가 `else`에서 멈추는 이유는 "`else`가 키워드라서"가 아니라 "`else :` 가 문장으로
읽히지 않아서"다. `startsStatement()`가 이것을 그대로 흉내낸다 — 명령 키워드가
아닌 이름은 뒤에 `=`류, `[`, `(` 중 하나가 와야 문장을 시작한다.

### 3.5 `go` 만 백트래킹한다

`go`는 두 좌표(`go 10 20`)와 대상 하나(`go a + b`)를 받는데, 첫 인자를 다 읽기
전에는 구분할 수 없다. 여기만 `BACKTRACK($.pointArgs)`를 게이트로 써서 PEG처럼
점 형태를 먼저 시도한다. `move`는 점 형태밖에 없어서 백트래킹이 없다.

---

## 4. 어휘적 경계 두 가지

### 4.1 `#sameLine`

`clone`, `show`, `hide`, `move`, `go`는 인자를 **같은 줄에서만** 찾는다. 그렇지
않으면 인자 없는 `clone` 다음 줄의 식별자를 삼킨다.

chevrotain에는 `LA(0)` = **직전에 소비한 토큰**이 있다. 공백은 렉서가 건너뛰므로

```js
sameLine() { return this.LA(1).startLine === this.LA(0).endLine; }
```

이 한 줄이 `~(spacesNoNL lineTerminator)`와 같은 판정이 된다.

### 4.2 `signedNumberLiteral`

`center -5 -3`의 부호는 붙어 있어야 한다(`- 5`는 뺄셈). 토큰이 분리돼 있으므로
`signedNumber` 규칙이 오프셋 인접성을 직접 본다 — `숫자.startOffset === 부호.endOffset + 1`.

### 4.3 `and wait`

`play sound X and wait`에서 표현식 파서가 `and`를 연산자로 먹으면 안 된다. Ohm은
`and NotExpr`이 실패하면 backtrack했지만 LL은 한 번 들어가면 못 나온다. 그래서
`andExpr`의 반복에 게이트를 달았다 — `and` 뒤에 피연산자가 될 수 있는 토큰이 올
때만 연산자로 읽는다. `wait`는 예약어라 피연산자가 못 되므로 자동으로 갈린다.

---

## 5. `loc` 오프셋을 똑같이 맞추기

`nodeLocationTracking: 'full'`로 CST 노드마다 `location`이 붙는다. `end`는
포함(inclusive)이라 **`endOffset + 1`** 이 AST의 `loc.end`다. 세 군데를 맞췄다.

1. **이항·단항 연산자 노드는 AST가 아니라 CST 범위를 쓴다.**
   Ohm의 `PrimaryExpr_paren`은 안쪽 표현식을 그대로 돌려주므로 괄호가 `loc`에서
   빠진다. 하지만 그 괄호식을 피연산자로 갖는 `AddExpr_add`의 `loc`는 **괄호를
   포함**한다. AST의 `loc.start`로 접으면 1씩 어긋나므로 `ctx.operands[i].location`
   을 쓴다.

2. **`Program`의 `end`는 항상 소스 길이다.** Ohm의 `Program = TopLevelItem*`은
   마지막 항목 뒤 공백까지 건너뛴 자리에서 끝난다. 전체 입력을 소비해야 성공하므로
   결국 `source.length`와 같다. 빈 프로그램은 `{start: len, end: len}`이다.

3. 문자열 이스케이프(`\n`, `\uXXXX`)는 `decodeString()`이 Ohm의
   `stringChar` 케이스들과 같은 순서로 처리한다 — 유니코드 이스케이프를 먼저 보고,
   16진수 4자가 아니면 일반 이스케이프로 떨어진다.

---

## 6. 동등성 검증

문법이 안 바뀌었다는 것을 두 가지로 확인했다.

### 6.1 차등 테스트 (핵심 근거)

`examples/` 아래 **`.tess` 566개**를 옛 파서와 새 파서에 각각
`Program` / `SceneFragment` / `ObjectFragment` 세 시작 규칙으로 넣어
**1,698번 파싱**하고 결과를 `assert.deepStrictEqual`로 비교했다.

```
files: 566   parse attempts: 1698   both-ok: 566
mismatches: 0
```

성공·실패 여부, AST 구조, **모든 `loc` 오프셋까지** 완전히 같다. 이 과정에서 실제로
세 개의 차이를 잡아냈다 (`and wait` 삼킴, 괄호 포함 `loc`, `Program`의 끝 오프셋).

### 6.2 기존 테스트

교체 전 기준선이 **934 통과 / 1 실패**였고, 교체 후에도 **934 통과 / 1 실패**다.
그 1개(`examples/ent/witch_tess/objects/Battle/아군버프1.tess`)는 교체 전부터
실패하던 것이고, 차등 테스트에서 두 파서가 똑같이 거부하는 것을 확인했다.

`test/helpers.js`만 손댔다. `grammar.match()` + `semantics()` 대신
`parse(source, {startRule})`를 쓰도록 배선만 바꿨고 단언은 그대로다.

---

## 7. 에러 출력 (`@babel/code-frame`)

문법 에러는 `{line, column, offset, message, detail}` 모양을 그대로 유지한다.

- `message` — chevrotain `errorMessageProvider`가 만드는 한국어 한 줄.
  토큰마다 `label`을 줘서 `kw_end` 대신 `'end'`, `Identifier` 대신 `이름`으로 읽힌다.
- `detail` — `codeFrameColumns()`가 만드는 코드 프레임.

```
  2 |   when start do
  3 |     say "hi"
> 4 | end
    |    ^ 'end' 이(가) 와야 하는데 입력이 끝났습니다.
```

입력 끝(EOF) 토큰은 오프셋이 `-1`이므로 `offsetOf()`가 `source.length`로 바꾼다.

---

## 8. 남은 것

- `AI_GRAMMAR.md`는 Ohm 문법을 규칙 단위로 설명한 문서라 지금은 옛 구현을 가리킨다.
  규칙의 *의미*는 그대로 유효하지만 파일 경로와 Ohm 표기는 이 문서로 대체됐다.
- `.ohm/` 폴더는 Ohm 사용법 튜토리얼이다. 이제 쓰이지 않는다.
- `editors/vscode/build-grammar.mjs`는 `tess.ohm`을 정규식으로 긁는 대신
  `src/parser/tokens.js`의 `KEYWORDS`를 import한다. 생성 결과는 바이트 단위로 동일하다.
