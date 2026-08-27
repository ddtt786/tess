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
| `when key S up do` | 엔트리에 "키를 뗐을 때" 이벤트가 없어서, **시작하기 → 계속 반복(키가 눌릴 때까지 기다림 → 떼질 때까지 기다림 → 본문)** 스크립트로 바꾸고 경고합니다 |
| `move X Y` | 상대 좌표를 한 번에 옮기는 블록이 없어서 `move_x` + `move_y` 두 블록이 됩니다 |
| `log2(N)` | 밑이 2인 로그 블록이 없어서 `ln(N) / ln(2)` 로 펼칩니다 |
| `A ** N` | `N` 이 `2` 면 제곱, `0.5` 면 제곱근, `1~8` 정수면 곱셈으로 펼칩니다. 그 밖에는 에러 |
| `type(V) == "number"` | 엔트리의 `is_type` 판단 블록이 됩니다. `"number"` 외의 자료형은 에러 |
| `device == "mobile"` | `is_current_device_type` 판단 블록. `device` 를 홀로 쓰면 에러 |
| 판단이 아닌 값을 조건에 쓰기 | `값 == "true"` 비교로 감쌉니다 |

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

- `scale_x = N` — 가로/세로 크기를 **정하는** 블록이 없습니다. `scale_x += N` 을 쓰거나 오브젝트 속성으로 선언하세요
- 선언하지 않은 오브젝트·모양·소리·장면·신호를 이름으로 가리킬 때
- 함수 중간의 `return`, 함수 안의 `list` 선언
- 전역/오브젝트 변수의 초기값이 상수가 아닐 때 (`when start` 안에서 대입하세요)
- `random_color()` 를 `draw_color =` 밖에서 쓸 때

---

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
