// spec 의 각 절에 나오는 코드가 문법에 맞는지 확인한다.
import test from 'node:test';
import { assertParses, assertRejects, inObject } from './helpers.js';

const ok = (name, code, kind) => test(name, () => assertParses(inObject(code, kind), name));
const okRaw = (name, code) => test(name, () => assertParses(code, name));
const noRaw = (name, code) => test(name, () => assertRejects(code, name));

// --- 3. 프로그램의 뼈대 -------------------------------------------------------
okRaw('3.1 전역 변수 · 리스트', `
var total_score = 0
var game_title = "모험의 시작"
list inventory = ["단검", "회복약"]
list ranking = []
`);

okRaw('3.2 project', `
project:
  title "우주 비행사"
  description "운석을 피하며 목적지까지 비행하는 게임입니다."
  fps 60
end
`);

okRaw('3.3 use', `
use "common/settings.tess"

project:
  title "모듈화 예제"
  fps 60
end

scene "stage1":
  use "objects/hero.tess"
  use "objects/monster.tess"
end
`);

okRaw('3.4 scene 여러 개', `
scene "intro":
  object "title_logo":
    name "로고"
  end
end

scene "play_game":
  object "player":
    name "주인공"
  end
end
`);

okRaw('3.5 object 속성', `
object "player":
  name "용사"
  costume idle "hero_idle.png"
  costume attack "hero_attack.png"
  sound slash "slash.mp3"
  x = 0
  y = -50
  scale_x = 100
  scale_y = 100
  visible true
  lock false

  var local_hp = 100

  when start do
    say "모험을 시작합니다!" for 2
  end
end
`);

okRaw('3.5 default costume', `
object "player":
  default costume idle "hero_idle.png"
  costume run "hero_run.png"
end
`);

okRaw('3.6 text 블록', `
text "score_board":
  name "점수판"
  text_content = "점수: 0"
  font = "NanumGothic"
  font_color = #ff0000
  bg_color = transparent
end
`);

// --- 4. 기본 문법 및 연산자 ---------------------------------------------------
ok('4.1 블록 열기 세 가지', `
if score >= 100:
  say "축하합니다!"
end

if hp <= 0 then
  kill
end

if hp > 0 do
  forward 10
end
`);

ok('4.2 산술 연산자', `
var a = 10 + 5
var b = 20 / 4
var c = 10 % 3
var d = 10 // 3
var e = 2 ** 3
var f = 16 ** 0.5
`);

ok('4.2 대입 연산자', `
score = 0
score += 10
hp -= 5
score *= 2
score /= 2
count %= 2
level **= 2
`);

ok('4.2 비교 · 논리 연산자', `
var a = item == "potion"
var b = state != "dead"
var c = hp > 0 and not dead
var d = key_down("left") or key_down("a")
var e = not mouse_down
var f = score >= 100 and score <= 200
`);

// --- 5. 제어 흐름 -------------------------------------------------------------
ok('5.1 if / else', `
if score >= 50:
  say "통과!"
else:
  say "재도전해 보세요."
end
`);

ok('5.2 반복문 네 가지', `
repeat 5:
  forward 10
  wait 0.1
end

while hp > 0:
  wait 0.5
end

until touching("goal"):
  forward 5
end

forever:
  if key_down("right"):
    x += 5
  end
  wait 0.02
end
`);

ok('5.3 흐름 제어', `
wait 1.5
wait mouse_down

while true:
  if touching("trap"):
    break
  end
  if touching("coin"):
    skip
  end
  forward 2
end

restart
stop
stop other
stop me
stop them
stop all
`);

// --- 6. 이벤트 ----------------------------------------------------------------
okRaw('6. 이벤트 전체', `
object "o":
  when start do
    say "게임 시작!" for 2
  end
  when scene start do
    x = 0
  end
  when key "space" do
    say "점프!"
  end
  when key "space" up do
    say "착지!"
  end
  when click do
    say "나를 클릭했군요!"
  end
  when click up do
    say "클릭 해제!"
  end
  when stage click do
    say "무대 클릭 감지!"
  end
  when stage click up do
    say "무대 클릭 해제!"
  end
  when signal "game_over" do
    say "게임 오버..."
  end
  when cloned do
    y = 100
  end
end
`);

// --- 7. 신호와 복제본 ---------------------------------------------------------
ok('7.1 · 7.2 · 7.3 신호 · 복제 · 장면', `
send "monster_spawn"
call "stage_clear"
clone
clone "bullet"
kill
del clone
del clones
jump "stage_2"
jump next
jump back
`);

// --- 8. 오브젝트 제어 ---------------------------------------------------------
ok('8.1 위치와 이동', `
x = 100
y = -50
x += 10
y -= 5
forward 10
forward 10 at 90
bounce
move 20 20
move 50 0 in 1
go 0 0
go "mouse"
go "boss" in 2
`);

ok('8.2 각도와 방향', `
angle = 90
way = 180
turn 45
turn 90 in 0.5
steer 30
steer 45 in 1
look "mouse"
look "enemy"
`);

ok('8.3 모양과 크기', `
show
hide
costume = "run"
next costume
prev costume
size = 120
size += 10
scale_x = 80
scale_y = 100
reset size
effect_color += 10
effect_color = 100
effect_brightness = 50
effect_alpha += 20
clear effects
flip x
flip y
order front
order back
`);

ok('8.4 대화와 생각', `
say "안녕하세요!"
say "반갑습니다!" for 2
think "무슨 일이지?"
think "조심해야겠어." for 1.5
clear bubble
`);

ok('8.5 글상자 제어', `
write "엔트리"
append " 환영합니다."
prepend "[공지] "
clear text
font = "NanumGothic"
font_color = #ff0000
bg_color = #000000
bg_color = transparent
text_bold = true
text_italic = false
text_underline = true
text_strikethrough = true
`, 'text');

// --- 9. 붓 --------------------------------------------------------------------
ok('9.1 · 9.2 붓', `
start draw
forward 50
turn 90
forward 50
stop draw

stamp
clear draw

fill_color = #00ff00
start fill
forward 40
turn 120
forward 40
stop fill

draw_color = #ff0000
draw_color = random_color()
draw_width = 5
draw_alpha = 70
`);

// --- 10. 소리 ------------------------------------------------------------------
ok('10. 소리', `
play sound "jump"
play sound "laser" for 0.5
play sound "bgm_intro" from 1 to 5
play sound "explosion" and wait
play sound "voice" for 2 and wait
play sound "song" from 0 to 3 and wait
play bgm "main_theme"
stop bgm
sound_volume = 80
sound_volume += 5
sound_speed = 1.2
stop sound this
stop sound all
`);

// --- 11. 판단 및 상태 값 --------------------------------------------------------
ok('11.1 상태 값', `
if mouse_down: forward 5 end
if clicked: say "클릭!" end
if boost_mode: wait 0.01 end
if touchable: say "터치 지원" end
if device == "mobile": size = 150 end
say user_id
say nickname
if timer > 10: jump "end_scene" end
say answer
say block_count
`);

ok('11.2 조건 판단 함수', `
if key_down("space"):
  y += 10
end
if touching("enemy"):
  hp -= 10
end
if type(score) == "number":
  total += score
end
`);

// --- 12. 계산 및 내장 함수 -------------------------------------------------------
ok('12.1 수학 함수', `
var p = 2 ** 4
var root = 25 ** 0.5
var a = sin(90)
var b = cos(0)
var c = tan(45)
var d = asin(1)
var e = acos(1)
var f = atan(1)
var g = log2(8)
var h = ln(2.718)
var i = log10(100)
var j = floor(3.7)
var k = ceil(3.2)
var l = round(3.5)
var m = abs(-15)
var rnd = random(1, 10)
`);

ok('12.2 객체 정보 및 거리', `
var mx = x("mouse")
var my = y("mouse")
var enemy_angle = angle("bot")
var enemy_way = way("bot")
var enemy_size = size("bot")
var dist = distance("player")
var msg = text_content("score_board")
if distance("mouse") < 50:
  say "가까워요!"
end
`);

ok('12.3 문자열 처리', `
var msg = "Entry Tess"
var len = length(msg)
var first_ch = msg[0]
var sub = slice(msg, 0, 5)
var cnt = count("banana", "a")
var merged = join("Hello, ", "Tess!")
var idx = index_of(msg, "Tess")
var replaced = replace(msg, "Entry", "Hello")
var rev = reverse("Tess")
var upper = uppercase("abc")
var lower = lowercase("ABC")
`);

ok('12.4 시간 · 초시계 · 블록 수', `
var current_year = now("year")
var current_month = now("month")
var current_dayname = now("weekday")
start timer
wait 2
stop timer
var record = timer
reset timer
var all_blocks = block_count
var cat_blocks = block_count("cat")
`);

ok('12.5 색상 변환', `
var hex_code = to_hex(255, 0, 0)
var r = from_hex(#ff0000, red)
var g = from_hex(#ff0000, green)
var b = from_hex(#ff0000, blue)
`);

// --- 13. 자료 --------------------------------------------------------------------
ok('13.2 리스트', `
var first = scores[0]
scores[0] = 95
in scores add 70
in scores insert 80 at 1
remove scores[2]
var total_items = length(scores)
var has_perfect = contains(scores, 100)
`);

ok('13.3 · 13.4 대답 · 표시', `
ask "당신의 이름은 무엇인가요?"
say join("반갑습니다, ", answer)
show global_score
hide global_score
show scores
hide scores
show timer
hide timer
show answer
hide answer
`);

// --- 14. 함수 ---------------------------------------------------------------------
okRaw('14.1 함수 정의와 호출', `
function add(a, b):
  return a + b
end

function greet(user_name):
  say join("안녕하세요, ", user_name) for 2
end

var sum = add(10, 20)
`);

okRaw('14.2 오브젝트 안의 함수', `
var global_multiplier = 2

object "hero":
  var local_power = 50

  function get_damage(base_dmg):
    return base_dmg * global_multiplier
  end

  when start do
    var dmg = get_damage(local_power)
    say dmg
  end
end
`);

okRaw('14.3 함수 지역 변수', `
function sum_numbers(limit):
  var total = 0
  var i = 1
  while i <= limit:
    total += i
    i += 1
  end
  return total
end

var result = sum_numbers(10)
`);

// --- 주석 · 공백 ------------------------------------------------------------------
okRaw('주석만 있는 파일', '# 주석만 있어도 됩니다\n');
okRaw('빈 파일', '');
okRaw('CRLF 줄바꿈', 'object "o":\r\n  when start do\r\n    say "hi"\r\n  end\r\nend\r\n');
ok('줄 끝 주석과 색상 리터럴 구분', `
draw_color = #ff0000  # 빨간색 선
font_color = #00FF00
# 여기는 통째로 주석
`, 'text');

// --- 줄바꿈 경계 (같은 줄 가드) -----------------------------------------------------
ok('인자 없는 show 다음 줄이 식별자로 시작', `
show
score = 1
`);
ok('인자 없는 hide 다음 줄이 호출로 시작', `
hide
greet("철수")
`);
ok('인자 없는 clone 다음 줄', `
clone
say "복제본"
`);
ok('go 대상 다음 줄이 식별자로 시작', `
go "mouse"
score = 5
`);
ok('go 좌표 다음 줄', `
go 0 0
score = 5
`);
ok('음수 좌표 인자', `
move 50 -30
go -10 -20
`);

// --- 실패해야 하는 입력 -------------------------------------------------------------
noRaw('end 가 없는 블록', 'object "o":\n  when start do\n    say "hi"\nend');
noRaw('닫히지 않은 문자열', 'object "o":\n  when start do\n    say "hi\n  end\nend');
noRaw('이름 없는 scene', 'scene:\nend');
noRaw('이름 없는 object', 'object:\nend');
noRaw('object 밖의 이벤트 핸들러', 'when start do\n  say "hi"\nend');
noRaw('scene 안의 문장', 'scene "s":\n  forward 10\nend');
noRaw('== 로 대입', 'object "o":\n  when start do\n    x == 5\n  end\nend');
noRaw('project 필드에 잘못된 타입', 'project:\n  fps "60"\nend');
noRaw('object 에 없는 속성', 'object "o":\n  hp = 100\nend');
noRaw('리스트 초기값이 리터럴이 아님', 'list a = 1');
