# Tess 언어 가이드

Tess는 엔트리(playentry.org)의 블록 코드를 텍스트로 작성하기 위한 프로그래밍 언어입니다.
이 문서는 Tess로 작품을 만드는 방법을 다룹니다.

_(설치 및 실행 방법은 [README.md](./README.md)를, 컴파일러 내부의 특수 규칙은 [SPEC-ADDENDUM.md](./SPEC-ADDENDUM.md)를 참고하세요.)_

---

## 1. 시작하기

다음은 Tess로 작성된 간단한 작품 예제입니다.

```tess
project:
  title "내 첫 작품"
  fps 60
end

scene "메인화면":
  object "고양이":
    # 1. 초기 속성 정하기
    default costume 기본 "cat.png"
    size = 150
    x = 0
    y = -50

    # 2. 전역/지역 변수
    var 체력 = 100

    # 3. 블록 스크립트
    when start do
      say "안녕!" for 2

      forever:
        if key_down("right"):
          x += 5
        end
        wait 0.02
      end
    end
  end
end
```

블록을 열 때는 `do`, `then`, `:` 중 편한 것을 사용하고, 닫을 때는 `end`를 씁니다.

---

## 2. 변수와 리스트

변수와 리스트는 선언한 위치에 따라 **전역**과 **지역**으로 나뉩니다.

```tess
# 최상위에 쓰면 '전역 (모든 곳에서 사용 가능)'
var 점수 = 0
list 인벤토리 = ["검", "방패"]

object "플레이어":
  # 오브젝트 안에 쓰면 '지역 (이 오브젝트 전용)'
  var 속도 = 5

  when start do
    점수 += 10
    속도 *= 2

    in 인벤토리 add "포션"
    remove 인벤토리[0]      # 리스트의 첫 번째 항목 삭제
  end
end
```

---

## 3. 조건과 반복

```tess
when start do
  # 조건문
  if 점수 >= 100:
    say "클리어!"
  else:
    say "진행 중"
  end

  # 반복문
  repeat 5:
    forward 10
  end

  while 체력 > 0:
    wait 1
  end

  # ~할 때까지
  until touching("도착점"):
    move 5 0
  end
end
```

---

## 4. 움직임과 생김새

```tess
when start do
  # 이동
  x = 100               # x 좌표를 100으로 위치하기
  y += 50               # y 좌표를 50만큼 바꾸기
  move 20 -20           # x, y 만큼 이동하기
  go "mouse"            # 마우스 포인터로 이동하기
  forward 10 at 90      # 90도 방향으로 10만큼 움직이기
  bounce                # 화면 끝에 닿으면 튕기기

  # 회전
  angle = 90            # 방향을 90도로 정하기
  turn 45               # 방향을 45도만큼 회전하기
  look "적"             # '적' 오브젝트 쪽 바라보기

  # 생김새
  show                  # 모양 보이기
  hide                  # 모양 숨기기
  costume = "공격"      # '공격' 모양으로 바꾸기
  next costume          # 다음 모양으로 바꾸기

  effect_color = 50     # 색깔 효과 정하기
  clear effects         # 효과 모두 지우기
end
```

---

## 5. 이벤트와 신호

```tess
when start do              # 시작하기 버튼을 클릭했을 때
when click do              # 오브젝트를 클릭했을 때
when key "space" do        # 스페이스 키를 눌렀을 때
when scene start do        # 장면이 시작되었을 때
when cloned do             # 자신의 복제본이 처음 생성되었을 때

---

when start do
  send "게임시작"          # 신호 보내기 (바로 다음 줄 실행)
  call "보스등장"          # 신호 보내고 기다리기 (끝날 때까지 대기)
end

when signal "게임시작" do  # 신호를 받았을 때
  clone "적"               # '적' 오브젝트 복제하기
end
```

---

## 6. 객체 정보와 내장 함수

자신이나 다른 오브젝트의 상태를 읽거나 수학 계산을 할 수 있습니다. 대상의 이름을 생략하면 '자기 자신'을 의미합니다.

```tess
when start do
  # 객체 정보 읽기
  var 내위치 = x
  var 마우스y = y("mouse")
  var 적거리 = distance("적")
  var 지금모양 = costume

  # 상태 판단
  if mouse_down: ... end           # 마우스를 클릭했는가?
  if touching("벽"): ... end       # 벽에 닿았는가?
  if timer > 10: ... end           # 초시계 값

  # 수학 및 기타 함수
  var 랜덤 = random(1, 10)         # 1부터 10 사이 무작위 수
  var 이름길이 = length("엔트리")    # 문자열 길이
end
```

---

## 7. 글상자, 붓, 소리

일반 `object` 대신 `text` 키워드를 사용하면 글상자를 만들 수 있습니다.

```tess
# 글상자
text "점수판":
  font_color = #ff0000
  bg_color = transparent

  when start do
    write "점수: "
    append 점수      # 뒤에 이어 쓰기
  end
end

# 붓과 소리
object "펜":
  draw_width = 5
  draw_color = #0000ff
  sound 팝 "pop.mp3"

  when start do
    start draw                 # 그리기 시작
    play sound "팝" for 1      # 1초간 소리 재생
    stop draw                  # 그리기 멈춤
    clear draw                 # 모든 붓 지우기
  end
end
```

---

## 8. 함수 (Function)

자주 사용하는 로직을 함수로 묶을 수 있습니다. 엔트리의 규칙에 따라 **값을 반환하는 함수는 `return`을 함수의 가장 마지막 줄에만** 써야 합니다. 함수에는 지역 변수를 사용할 수 없습니다.

```tess
object "플레이어":
  # 1. 문장으로 쓰는 일반 함수
  function 이동하기(속도):
    forward 속도
    bounce
  end

  # 2. 값으로 쓰는(반환값이 있는) 함수
  function 대미지계산(기본공격력):
    var 크리티컬 = random(1, 2)
    return 기본공격력 * 크리티컬
  end

  when start do
    이동하기(10)
    var 최종대미지 = 대미지계산(50)
  end
end
```

---

## 9. 파일 나누기 (모듈화)

작품이 커지면 오브젝트별로 파일을 나누어 관리할 수 있습니다. `use` 키워드는 지정한 파일의 코드를 그 자리에 그대로 붙여 넣습니다.

**`main.tess`**

```tess
scene "게임화면":
  use "objects/player.tess"
  useobject "objects/enemy.tess" # useobject를 사용할 경우 파일에서 object "":...end 를 생략할 수 있습니다.
end
```

**`objects/player.tess`**

```tess
object "플레이어":
  x = -100
  when start do
    say "준비 완료!"
  end
end
```
