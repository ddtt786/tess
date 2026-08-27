# Tess 명세 보충 — 엔트리 작품으로 컴파일하기

이 문서는 [Tess 언어 가이드 및 명세서](#)를 **실제 엔트리 작품(`project.json` / `.ent`)으로
컴파일**하기 위해 추가하거나 다듬은 부분을 정리합니다.

원칙은 하나입니다. **Tess 의 문법 철학을 그대로 지킨다.**

- 새 문법도 기존 속성과 똑같은 두 가지 모양만 씁니다 — 키워드형(`rotation free`)과 대입형(`font_size = 20`)
- 블록은 여는 말 세 가지(`then` · `do` · `:`)와 `end` 로 닫는 규칙을 그대로 따릅니다
- 새 예약어를 늘리지 않았습니다. `rotation`, `font_size` 같은 이름은 전부 변수명으로도 쓸 수 있습니다

---

## 1. 추가한 오브젝트 속성

엔트리 오브젝트에는 있지만 명세에는 없던 값들입니다. 전부 **선언은 선택**이고 기본값이 있습니다.

| 속성 | 문법 | 설명 | 기본값 |
| --- | --- | --- | --- |
| 회전 방식 | `rotation free \| vertical \| none` | 엔트리의 회전 방식(모든 방향 / 좌우 / 회전 없음) | `free` |
| 모양 각도 | `angle = Number` | 시작할 때의 모양 각도 | `0` |
| 이동 방향 | `way = Number` | 시작할 때의 이동 방향 | `90` |
| 전체 크기 | `size = Number` | `scale_x`, `scale_y` 를 한 번에 정한다 | `100` |

```tess
object "치로":
  name "치로"
  rotation vertical    # 좌우로만 뒤집힌다
  angle = 0
  way = 90
  size = 120
end
```

## 2. 추가한 글상자 속성

`text` 블록에서만 쓸 수 있습니다. 기존 글상자 명령(`font`, `font_color`, `bg_color`,
`text_bold` …)과 이름·문법이 같고, 오브젝트 상단에 쓰면 시작 상태가 됩니다.

| 속성 | 문법 | 설명 | 기본값 |
| --- | --- | --- | --- |
| 글씨 크기 | `font_size = Number` | 글자 크기(px) | `20` |
| 정렬 | `text_align = left \| center \| right` | 문단 정렬 | `center` |
| 줄바꿈 | `line_break = Bool` | 여러 줄 글상자 여부 | `false` |

```tess
text "점수판":
  text_content = "점수: 0"
  font = "DungGeunMo"
  font_size = 24
  font_color = #ffffff
  bg_color = transparent
  text_align = left
  line_break = false
end
```

## 3. 모양 원본 크기 선언

이미지 파일을 찾을 수 있으면 컴파일러가 파일에서 크기를 직접 읽습니다.
파일 없이(예: 이미지를 아직 안 만든 상태로) 구조만 잡을 때는 크기를 직접 적을 수 있습니다.

```tess
costume 기본 "hero.png" size 200 120     # 원본 200×120 으로 기록
default costume 밤하늘 "intro_bg.png" size 960 540
```

`size W H` 를 생략하고 파일도 없으면 100×100 으로 기록하고 경고합니다.

## 3.1 소리 길이 선언

소리도 같은 이유로 길이를 적어 둘 수 있습니다. 파일을 찾을 수 있으면 필요 없습니다.

```tess
sound 딸깍 "click.mp3" for 0.3      # 0.3초짜리 소리
```

`size W H` 나 `for N` 을 적어 두면, 파일이 아직 없어도 컴파일러가 아무 말 없이 지나갑니다.
둘 다 없고 파일도 못 찾을 때만 알려 줍니다.

## 3.2 `useobject` / `usetext` — 오브젝트 파일 통째로 불러오기

오브젝트 하나를 파일 하나로 관리할 때, 파일마다 `object "..." : ... end` 로 감싸는 것은
군더더기입니다. `useobject` / `usetext` 는 불러오면서 감싸 줍니다.

```tess
# main.tess
scene "메인 게임":
  useobject "objects/플레이어.tess"
  usetext "objects/점수판.tess"
end
```

```tess
# objects/플레이어.tess — object 로 감싸지 않는다
name "치로(썰매)"
costume 정지 "sled_idle.png" size 140 120
x = -180

when start do
  forward 10
end
```

| | |
| --- | --- |
| 오브젝트 이름 | **파일 이름**(확장자 뺀 것)이 됩니다. `플레이어.tess` -> `touching("플레이어")` |
| 화면에 보이는 이름 | 파일 안의 `name "..."` 이 정합니다 (없으면 파일 이름) |
| 파일 안에 적는 것 | 오브젝트 속성, `var`, `list`, `function`, `when` 블록 — `object` 안에 쓰던 그대로 |
| 쓸 수 있는 자리 | 최상위, `scene` 안 |
| `usetext` | 같은 일을 하되 글상자(`text`)로 감쌉니다 |

`use` 는 그대로 남아 있습니다. 감싸지 않고 그대로 펼치고 싶을 때 씁니다.

## 3.3 주석은 엔트리 주석이 됩니다

Tess 의 `#` 주석은 버려지지 않고 **엔트리 블록의 주석**으로 옮겨집니다.

```tess
when start do
  # 앞으로 간다          <- 아래 블록에 붙는다
  forward 10
  x = 5  # 자리 잡기      <- 같은 줄 블록에 붙는다
end
```

| 주석이 놓인 자리 | 붙는 곳 |
| --- | --- |
| 문장 바로 위 (여러 줄이면 한 덩어리로) | 그 문장의 첫 블록 |
| 문장과 같은 줄 뒤쪽 | 그 문장의 첫 블록 |
| `when` 블록 바로 위 | 이벤트 블록 |
| 그 밖(파일 머리말, 속성 사이 등) | 붙을 블록이 없으므로 사라집니다 |

문자열 안의 `#` 과 색상 리터럴(`#ff0000`)은 주석으로 보지 않습니다.

## 4. `return` 의 위치 제한

엔트리의 "값을 돌려주는 함수"는 **함수가 끝난 뒤 계산할 식 하나**를 가집니다.
중간에 빠져나오는 `return` 은 엔트리 블록으로 표현할 방법이 없습니다.

```tess
# 됩니다 — 마지막 문장이 return
function 두배(값):
  var 배수 = 2
  return 값 * 배수
end

# 안 됩니다 — 중간 return
function 등급(점수):
  if 점수 > 90:
    return "A"      # 컴파일 에러
  end
  return "B"
end
```

`return` 이 없는 함수는 엔트리의 일반 함수, `return` 으로 끝나는 함수는 값 함수가 됩니다.
값 함수는 문장으로 쓸 수 없고, 일반 함수는 값으로 쓸 수 없습니다 (엔트리와 같은 규칙입니다).

## 5. `use` 는 진짜로 펼쳐집니다

명세대로 "그 위치에 통째로 불러와 포함"합니다. 불러온 파일은 놓인 자리에 맞는 조각이면 됩니다.

| `use` 를 쓴 자리 | 불러올 파일에 들어갈 내용 |
| --- | --- |
| 최상위 | `project`, `scene`, `object`, `text`, `function`, `var`, `list` |
| `scene` 안 | `object`, `text` |
| `object` / `text` 안 | 속성, `var`, `list`, `function`, `when` 블록 |

경로는 **불러오는 파일 기준 상대 경로**이고, 순환 참조는 에러입니다.
에러 위치는 그 코드가 실제로 있는 파일 이름과 줄 번호로 알려 줍니다.

---

## 6. Tess → 엔트리 블록 대응표

컴파일러가 실제로 만드는 블록입니다. (엔트리 블록 이름은 `entryjs` 기준)

### 이벤트

| Tess | 엔트리 블록 |
| --- | --- |
| `when start do` | `when_run_button_click` |
| `when scene start do` | `when_scene_start` |
| `when key "space" do` | `when_some_key_pressed` |
| `when key "space" up do` | *(없음 → 6.1 참고)* |
| `when click do` / `when click up do` | `when_object_click` / `when_object_click_canceled` |
| `when stage click do` / `... up do` | `mouse_clicked` / `mouse_click_cancled` |
| `when signal S do` | `when_message_cast` |
| `when cloned do` | `when_clone_start` |

### 흐름 · 신호 · 장면

| Tess | 엔트리 블록 |
| --- | --- |
| `if` / `if ... else` | `_if` / `if_else` |
| `repeat N:` / `forever:` | `repeat_basic` / `repeat_inf` |
| `while C:` / `until C:` | `repeat_while_true` (`while` / `until` 모드) |
| `while true:` | `repeat_inf` |
| `wait N` / `wait C` | `wait_second` / `wait_until_true` |
| `break` / `skip` / `restart` | `stop_repeat` / `continue_repeat` / `restart_project` |
| `stop` `other` `me` `them` `all` | `stop_object` (`thisThread` `otherThread` `thisOnly` `other_objects` `all`) |
| `send S` / `call S` | `message_cast` / `message_cast_wait` |
| `clone` / `clone S` | `create_clone` |
| `kill` · `del clone` / `del clones` | `delete_clone` / `remove_all_clones` |
| `jump S` / `jump next` / `jump back` | `start_scene` / `start_neighbor_scene` |

### 움직임 · 모양

| Tess | 엔트리 블록 |
| --- | --- |
| `forward N` / `forward N at A` | `move_direction` / `move_to_angle` |
| `bounce` | `bounce_wall` |
| `move X Y` | `move_x` + `move_y` **(블록 두 개)** |
| `move X Y in T` / `go X Y in T` | `move_xy_time` / `locate_xy_time` |
| `go X Y` / `go S` / `go S in T` | `locate_xy` / `locate` / `locate_object_time` |
| `turn A` / `turn A in T` | `rotate_relative` / `rotate_by_time` |
| `steer A` / `steer A in T` | `direction_relative` / `direction_relative_duration` |
| `look S` | `see_angle_object` |
| `x = N` / `x += N` | `locate_x` / `move_x` |
| `angle = A` / `way = A` | `rotate_absolute` / `direction_absolute` |
| `show` / `hide` | `show` / `hide` |
| `say S [for N]` / `think S [for N]` | `dialog` / `dialog_time` (`speak` · `think`) |
| `clear bubble` | `remove_dialog` |
| `costume = S` / `next costume` | `change_to_some_shape` / `change_to_next_shape` |
| `size = N` / `size += N` / `reset size` | `set_scale_size` / `change_scale_size` / `reset_scale_size` |
| `scale_x += N` | `stretch_scale_size` (`WIDTH`) |
| `scale_x = N` | 컴파일러가 만들어 넣는 함수 (6.4 참고) |
| `effect_* = N` / `effect_* += N` | `change_effect_amount` / `add_effect_amount` |
| `clear effects` | `erase_all_effects` |
| `flip x` / `flip y` | `flip_y` / `flip_x` **(이름이 서로 반대입니다)** |
| `order front` / `order back` | `change_object_index` |

### 글상자 · 붓 · 소리

| Tess | 엔트리 블록 |
| --- | --- |
| `write` / `append` / `prepend` / `clear text` | `text_write` / `text_append` / `text_prepend` / `text_flush` |
| `font =` / `font_color =` / `bg_color =` | `text_change_font` / `text_change_font_color` / `text_change_bg_color` |
| `text_bold = Bool` 등 | `text_change_effect` (`fontBold` `fontItalic` `underLine` `strike`) |
| `start draw` / `stop draw` / `stamp` / `clear draw` | `start_drawing` / `stop_drawing` / `brush_stamp` / `brush_erase_all` |
| `start fill` / `stop fill` | `start_fill` / `stop_fill` |
| `draw_color = C` / `= random_color()` | `set_color` / `set_random_color` |
| `draw_width` / `draw_alpha` / `fill_color` | `set_thickness` / `set_brush_tranparency` / `set_fill_color` |
| `play sound S [for N \| from A to B] [and wait]` | `sound_something_*` 6종 |
| `play bgm S` / `stop bgm` | `play_bgm` / `stop_bgm` |
| `sound_volume` / `sound_speed` | `sound_volume_set·change` / `sound_speed_set·change` |
| `stop sound this \| all` | `sound_silent_all` |

### 자료 · 계산

| Tess | 엔트리 블록 |
| --- | --- |
| `var x = v` (선언) | `variables` 항목 (오브젝트 안이면 그 오브젝트 소유) |
| `x = v` / `x += v` | `set_variable` / `change_variable` |
| 함수 안의 `var` | 엔트리 함수 지역 변수 (`set_func_variable` / `get_func_variable`) |
| `list[i]` / `list[i] = v` | `value_of_index_from_list` / `change_value_list_index` |
| `in l add v` / `insert v at i` / `remove l[i]` | `add_value_to_list` / `insert_value_to_list` / `remove_value_from_list` |
| `length(l)` / `contains(l, v)` | `length_of_list` / `is_included_in_list` |
| `ask S` / `answer` | `ask_and_wait` / `get_canvas_input_value` |
| `show/hide 변수·리스트·timer·answer` | `show_variable` · `show_list` · `set_visible_project_timer` · `set_visible_answer` |
| `start/stop/reset timer`, `timer` | `choose_project_timer_action`, `get_project_timer_value` |
| `+ - * /` / `% //` | `calc_basic` / `quotient_and_mod` |
| `== != > < >= <=` | `boolean_basic_operator` |
| `and` `or` `not` | `boolean_and_or` / `boolean_not` |
| `sin cos tan asin acos atan ln log10 floor ceil round abs` | `calc_operation` |
| `A ** N`, `root(A, N)` | `calc_operation`(제곱·제곱근·자연로그)과 곱셈으로 펼침 (6.5) |
| `random(a, b)` | `calc_rand` |
| `key_down(S)` / `touching(S)` | `is_press_some_key` / `reach_something` |
| `mouse_down` `clicked` `boost_mode` `touchable` | `is_clicked` `is_object_clicked` `is_boost_mode` `is_touch_supported` |
| `user_id` `nickname` `block_count` | `get_user_name` `get_nickname` `get_block_count` |
| `x(S) y(S) angle(S) way(S) size(S)` | `coordinate_object` (마우스는 `coordinate_mouse`) |
| `distance(S)` / `text_content(S)` | `distance_something` / `text_read` |
| `join` `length` `slice` `count` `index_of` `replace` `reverse` `uppercase` `lowercase` | `combine_something` `length_of_string` `substring` `count_match_string` `index_of_string` `replace_string` `reverse_of_string` `change_string_case` |
| `now(S)` / `to_hex` / `from_hex` | `get_date` / `change_rgb_to_hex` / `change_hex_to_rgb` |

---

## 6.1 엔트리에 없어서 다르게 만드는 것

| Tess | 컴파일 결과 |
| --- | --- |
| `when key S up do` | 엔트리에 "키를 뗐을 때" 이벤트가 없어서, **시작하기 → 계속 반복(키가 눌릴 때까지 기다림 → 떼질 때까지 기다림 → 본문)** 스크립트로 바꿉니다 |
| `move X Y` | 상대 좌표를 한 번에 옮기는 블록이 없어서 `move_x` + `move_y` 두 블록이 됩니다 |
| `log2(N)` | 밑이 2인 로그 블록이 없어서 `ln(N) / ln(2)` 로 펼칩니다 |
| `A ** N` · `root(A, N)` | 제곱·제곱근·자연로그로 펼칩니다 (6.5 참고). 지수는 숫자로 정해져 있어야 합니다 |
| `type(V) == "number"` | 엔트리의 `is_type` 판단 블록이 됩니다. `"number"` 외의 자료형은 에러 |
| `device == "mobile"` | `is_current_device_type` 판단 블록. `device` 를 홀로 쓰면 에러 |
| 판단이 아닌 값을 조건에 쓰기 | `값 == "true"` 비교로 감쌉니다 |

## 6.4 가로/세로 비율 "정하기" — 컴파일러가 만들어 넣는 함수

엔트리에는 한 축의 크기를 **정하는** 블록이 없습니다. 늘리는 블록만 있습니다.

```
가로 크기를 v 만큼 바꾸기  ->  setXSize(크기 + v)  ->  가로배율 × = (크기 + v) / 크기
```

즉 **지금 크기 기준의 비율**로만 바꿀 수 있는데, 엔트리가 알려 주는 값은 가로와 세로가
섞인 "크기" 하나뿐입니다.

```
크기 = (원본가로 × |가로배율| + 원본세로 × |세로배율|) / 2
```

그래서 컴파일러는 `scale_x = N` 을 만나면 **한 축만 크게 늘려 보고 크기가 얼마나
변했는지로 그 축의 길이를 되짚는** 함수를 만들어 넣습니다.

```
세로를 v 만큼 늘리면   크기' = (원본가로×가로배율 + 원본세로×세로배율×(크기+v)/크기) / 2
따라서                2 × 크기 × (크기' − 크기) / v = 원본세로 × 세로배율
```

`v = 100000` 을 쓰면 `2 × 크기 × (크기' − 크기) × 0.00001` 이 곧 세로 길이입니다.
지금 상태와 "원래 크기로 되돌린" 상태에서 각각 재면, 건드리지 않을 축을 그대로 되살리면서
목표 축만 원하는 비율로 맞출 수 있습니다.

만들어지는 함수는 엔트리 편집기에서 이렇게 보입니다.

```
함수 정의하기  [Tess] 가로 비율 정하기 (비율) (원래 배율)
  현재 크기 ▼ 를  (자신의 크기)              (으)로 정하기
  세로 ▼ 를  100000  만큼 늘리기
  지금 축 ▼ 를  2 × 현재크기 × (자신의크기 − 현재크기) × 0.00001  (으)로 정하기
  원래 크기로 되돌리기
  원래 크기 ▼ 를  (자신의 크기)              (으)로 정하기
  세로 ▼ 를  100000  만큼 늘리기
  원래 축 ▼ 를  2 × 원래크기 × (자신의크기 − 원래크기) × 0.00001  (으)로 정하기
  원래 크기로 되돌리기
  크기를  (자신의크기 × 지금축 / 원래축)      (으)로 정하기
  가로 를  자신의크기 × (비율 × 원래축 / (100 × 원래배율 × 지금축) − 1)  만큼 늘리기
```

- `비율` 은 **원본 크기 기준 %** 입니다. `scale_x = 100` 이면 그림 원본 가로 크기가 됩니다
- `원래 배율` 은 오브젝트마다 다르므로(= `entity.scaleX`) 컴파일러가 호출할 때 넣어 줍니다
- 지역 변수는 호출마다 따로 생기므로 **복제본이 동시에 불러도 서로 섞이지 않습니다**
- 모양이 바뀌어 원본 크기가 달라져도 매번 다시 재기 때문에 그대로 맞습니다
- `scale_x = N` 을 쓴 작품에서만 만들어집니다

알아둘 점

- **함수 안에서는 쓸 수 없습니다.** 엔트리 함수는 어느 오브젝트가 부를지 모르는데,
  `원래 배율` 은 오브젝트마다 다르기 때문입니다. 컴파일 에러로 알려 줍니다
- `flip x` 로 배율이 음수가 된 상태에서 쓰면 뒤집힘이 풀립니다 (엔트리의 크기 계산이
  절댓값을 쓰기 때문입니다)
- 목표 크기가 1보다 작아지는 극단적인 경우에는 엔트리 쪽 `max(1, …)` 때문에 어긋납니다

## 6.5 거듭제곱과 n제곱근 — 제곱·제곱근만으로 만들기

엔트리에 있는 계산 블록은 제곱(square)과 제곱근(root)뿐입니다. 그런데 이 둘이면
모든 실수 지수를 만들 수 있습니다.

```
정수부   x^13 = ((x^2)^2 · x)^2 · x                (자릿수만큼만, 13 = 1101₂)
소수부   x^0.b₁b₂b₃… = √(x^b₁ · √(x^b₂ · √(x^b₃ · …)))
```

소수부는 지수를 2배씩 하며 1을 넘는지 보는 이진 전개입니다.
`0.5`(=0.1₂), `0.75`(=0.11₂), `2.5` 처럼 2의 거듭제곱으로 떨어지면 **오차가 전혀 없고**,
`1/3`(=0.010101…₂) 같은 무한소수는 20자리에서 끊습니다.

끊어서 생긴 오차는 엔트리의 자연로그(`ln`)로 **뉴턴 보정을 한 번** 해서 지웁니다.

```
y ≈ x^p 일 때   y ← y × (1 + p·ln x − ln y)

y = x^p(1+ε) 이면 ln y ≈ p·ln x + ε 이므로 보정 뒤 오차는 ε²/2 가 된다
```

이 보정은 `[Tess] 거듭제곱 다듬기` 라는 값 함수로 만들어 넣습니다(작품에 하나만).
어림값을 두 번 써야 하는데 식을 복사하면 블록이 두 배가 되므로, 매개변수로 받습니다.

| 쓴 식 | 블록 수 | 나오는 값 | 상대오차 |
| --- | --- | --- | --- |
| `2 ** 10` | 6 | 1024 | 0 |
| `16 ** 0.5` | 2 | 4 | 0 |
| `16 ** 0.25` | 3 | 2 | 0 |
| `7 ** 2.5` | 5 | 129.64181424216494 | 0 |
| `5 ** -2` | 4 | 0.04 | 0 |
| `root(16, 4)` | 3 | 2 | 0 |
| `27 ** (1/3)` | 42 | 2.9999999999983533 | 5.5e-13 |
| `1000 ** 0.3` | 38 | 7.9432823471325005 | 1.4e-11 |
| `2 ** 0.1` | 40 | 1.071773462536209 | 7.9e-14 |

### `root(값, n)` — n제곱근

`값 ** (1/n)` 과 같습니다. 읽기 좋은 쪽을 쓰면 됩니다.

```tess
var 세제곱근 = root(27, 3)      # 3
var 네제곱근 = root(16, 4)      # 2 (정확)
var 제곱근   = root(2, 2)       # 1.4142135623730951 (정확)
```

### 알아둘 점

- **지수는 숫자로 정해져 있어야 합니다.** `2 ** n` 처럼 변수를 지수로 쓸 수 없습니다.
  엔트리 반복 블록은 한 번 돌 때마다 프레임을 넘겨서, 값을 구하는 식에 쓸 수 없기 때문입니다.
  지수 자리에 계산식은 쓸 수 있습니다 — `x ** (1/3)`, `x ** (6/2)` 처럼 상수끼리면 됩니다
- 지수에 따라 밑이 여러 번 들어가므로, 값이 매번 달라지는 `random()` 이 밑에 있으면 막습니다.
  변수에 먼저 담아 두고 쓰세요
- 밑이 음수인데 지수가 정수가 아니면 결과가 없습니다(엔트리도 마찬가지입니다)

## 6.2 인덱스와 값이 달라지는 곳

엔트리는 리스트·문자열 인덱스가 **1부터**이고 Tess 는 **0부터**입니다. 컴파일러가 보정합니다.

| Tess | 엔트리 |
| --- | --- |
| `scores[0]` | `value_of_index_from_list(scores, 1)` |
| `in scores insert 5 at 2` | `insert_value_to_list(5, scores, 3)` |
| `remove scores[1]` | `remove_value_from_list(2, scores)` |
| `msg[0]` | `char_at(msg, 1)` |
| `slice(s, 0, 3)` | `substring(s, 1, 3)` (엔트리는 양끝 포함) |
| `index_of(s, t)` | `index_of_string(s, t) - 1` (못 찾으면 Tess 는 `-1`) |

## 6.3 컴파일 에러가 나는 경우

엔트리에 대응 블록이 정말 없을 때는 조용히 넘어가지 않고 위치와 함께 알려 줍니다.

- `scale_x = N` 을 **함수 안에서** 쓸 때 — 오브젝트마다 시작 배율이 달라서 값을 정할 수 없습니다 (6.4 참고)
- 선언하지 않은 오브젝트·모양·소리·장면·신호를 이름으로 가리킬 때
- 함수 중간의 `return`, 함수 안의 `list` 선언
- 전역/오브젝트 변수의 초기값이 상수가 아닐 때 (`when start` 안에서 대입하세요)
- `random_color()` 를 `draw_color =` 밖에서 쓸 때

---

## 6.6 글상자에서 쓸 수 없는 명령

엔트리는 글상자(`text`)에 다음 블록을 주지 않습니다(`entryjs` 의 `isNotFor: ['textBox']`).
Tess 는 이걸 막지 않고 그대로 컴파일하지만, 엔트리에서 열면 쓸 수 없는 블록이 됩니다.

| 못 쓰는 것 | 대신 쓸 수 있는 것 |
| --- | --- |
| `effect_color` · `effect_brightness` · `effect_alpha`, `clear effects` | `font_color`, `bg_color`, `size` 로 눈에 띄게 하기 |
| `costume = …`, `next costume`, `prev costume` | 글상자는 모양이 없습니다. `write` 로 내용을 바꾸세요 |
| 붓 전체 (`start draw`, `stamp`, `draw_color`, `fill_color` …) | 붓은 일반 오브젝트에서만 |

반대로 `write`·`append`·`prepend`·`clear text`·`font`·`font_color`·`bg_color`·`text_*` 는
일반 오브젝트에서 쓸 수 없고, 이쪽은 컴파일 에러로 알려 줍니다(spec 8.5 에 적힌 규칙이라서).

## 7. 컴파일 결과물

```
build/gift.ent          # tar 묶음
└─ temp/
   ├─ project.json      # 엔트리 작품 데이터
   ├─ 84/5a/image/845a9347….png
   └─ 67/84/sound/67845a93….mp3
```

리소스 파일은 내용에서 만든 32자 이름으로 바뀌고, `temp/<앞2자>/<다음2자>/image|sound/` 아래에
담깁니다. `project.json` 의 `fileurl` 이 그 경로를 가리킵니다.
같은 소스를 다시 컴파일하면 **항상 같은 결과**가 나옵니다(모든 id 를 소스에서 만든 시드로 생성).

## 8. 바로 실행해 보기

```bash
node index.js run examples/gift_delivery/main.tess
```

컴파일해서 그 자리에 작은 서버를 띄우고 브라우저를 엽니다.
엔트리 실행기는 설치돼 있으면(`pnpm add -D @entrylabs/entry`) 그것을, 없으면 CDN 을 씁니다.
둘 다 안 되면 페이지가 그 사실을 알려 주고 `.ent` 를 받아 playentry.org 에서 여는 길을
안내합니다.

| 옵션 | 뜻 |
| --- | --- |
| `--port 8080` | 쓸 포트 (기본값: 비어 있는 포트) |
| `--no-open` | 브라우저를 자동으로 열지 않음 |
| `--assets 폴더` | 모양·소리 파일을 찾을 폴더 |
