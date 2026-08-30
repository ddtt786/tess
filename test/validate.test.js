// 문법만으로는 잡을 수 없는 spec 의 의미 규칙을 검사한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../src/parse.js';

const messages = (source) => parse(source).errors.map((e) => e.message);
const warnings = (source) => parse(source).warnings.map((w) => w.message);

test('8.5 글상자 전용 명령은 object 에서 쓸 수 없다', () => {
  const errors = messages(`object "o":
  when start do
    write "안녕"
    append "!"
    clear text
  end
end`);
  assert.equal(errors.length, 3);
  assert.match(errors[0], /글상자\(text\) 전용 명령/);
});

test('8.5 글상자 전용 명령은 text 에서는 괜찮다', () => {
  const result = parse(`text "t":
  when start do
    write "안녕"
    append "!"
    prepend "["
    clear text
    font = "NanumGothic"
    bg_color = transparent
  end
end`);
  assert.deepEqual(result.errors, []);
  assert.ok(result.ok);
});

test('8.5 글상자 전용 속성은 object 에서 쓸 수 없다', () => {
  const errors = messages(`object "o":
  font_color = #ff0000
end`);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /글상자\(text\) 전용 속성/);
});

// 글상자틀 크기(`size 가로 세로`)는 글상자만 갖는다 — 오브젝트 크기는 모양 그림에서 나온다.
test('size 가로 세로 는 object 에서 쓸 수 없다', () => {
  const errors = messages(`object "o":
  size 300 50
end`);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /글상자\(text\) 전용/);
});

test('size 가로 세로 는 text 에서는 괜찮고, size = 배율과 함께 쓸 수 있다', () => {
  const result = parse(`text "t":
  text_content = "가나다"
  size 120.5 22
  size = 150
end`);
  assert.deepEqual(result.errors, []);
  assert.ok(result.ok);
});

// 중심점은 모양에서 나오므로 글상자에는 없다.
test('center 가로 세로 는 text 에서 쓸 수 없다', () => {
  const errors = messages(`text "t":
  center 10 20
end`);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /오브젝트\(object\) 전용/);
});

test('center 는 음수도 받는다', () => {
  const result = parse(`object "o":
  center -12.5 -3
end`);
  assert.deepEqual(result.errors, []);
});

test('오브젝트 안에 선언한 함수는 그 오브젝트의 로컬 변수를 그대로 쓴다', () => {
  const result = parse(`object "hero":
  var local_power = 50

  function get_damage(base_dmg):
    return base_dmg * local_power
  end
end`);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
});

test('전역 함수가 오브젝트 로컬 변수를 쓰면 그 오브젝트 안으로 옮기라고 알린다', () => {
  const result = parse(`object "hero":
  var local_power = 50
end

function get_damage(base_dmg):
  return base_dmg * local_power
end`);
  assert.deepEqual(result.errors, []);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0].message, /'local_power' 은\(는\) hero 의 지역 변수입니다/);
});

test('여러 오브젝트가 같은 이름의 로컬 변수를 가지면 어느 것인지 알 수 없다', () => {
  const errors = messages(`object "hero":
  var power = 50
end

object "villain":
  var power = 70
end

function get_damage():
  return power
end`);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /hero, villain 가 저마다 가진 지역 변수/);
});

test('14.2 매개변수로 넘기면 문제없다 (spec 예제)', () => {
  const result = parse(`var global_multiplier = 2

object "hero":
  var local_power = 50

  function get_damage(base_dmg):
    return base_dmg * global_multiplier
  end

  when start do
    var dmg = get_damage(local_power)
    say dmg
  end
end`);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
});

test('14.3 함수 안에서 선언한 지역 변수는 참조할 수 있다', () => {
  const result = parse(`function sum_numbers(limit):
  var total = 0
  var i = 1
  while i <= limit:
    total += i
    i += 1
  end
  return total
end

var result = sum_numbers(10)`);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
});

test('return 은 함수 밖에서 쓸 수 없다', () => {
  const errors = messages(`object "o":
  when start do
    return 1
  end
end`);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /function 블록 안에서만/);
});

test('break / skip 은 반복문 밖에서 쓸 수 없다', () => {
  const errors = messages(`object "o":
  when start do
    break
    skip
  end
end`);
  assert.equal(errors.length, 2);
  assert.match(errors[0], /반복문/);
});

test('반복문 안의 break / skip 은 괜찮다', () => {
  const result = parse(`object "o":
  when start do
    forever:
      if mouse_down:
        break
      end
      skip
    end
  end
end`);
  assert.deepEqual(result.errors, []);
});

test('project 는 하나만 선언할 수 있다', () => {
  const errors = messages(`project:
  fps 60
end

project:
  fps 30
end`);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /하나만/);
});

test('선언하지 않은 이름은 경고한다', () => {
  const found = warnings(`object "o":
  when start do
    say unknown_thing
    lenght("abc")
  end
end`);
  assert.equal(found.length, 2);
  assert.match(found[0], /선언되지 않은 이름 'unknown_thing'/);
  assert.match(found[1], /선언되지 않은 함수 'lenght'/);
});

test('상태 값 · 내장 함수 · 오브젝트 속성은 경고하지 않는다', () => {
  const found = warnings(`object "o":
  when start do
    say user_id
    say nickname
    say block_count
    say answer
    if mouse_down and clicked and boost_mode and touchable: skip end
    x += 1
    effect_alpha = 20
    size = 100
    costume = "run"
    draw_color = random_color()
    var d = distance("player") + now("year") + to_hex(1, 2, 3)
  end
end`);
  assert.deepEqual(found, []);
});

test('use 가 있으면 이름 기반 경고를 끈다', () => {
  const result = parse(`use "common/helpers.tess"

object "o":
  when start do
    helper_function(1)
    say helper_variable
  end
end`);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.errors, []);
});

test('에러 위치는 줄과 열로 알려준다', () => {
  const { errors } = parse(`object "o":
  when start do
    write "x"
  end
end`);
  assert.equal(errors[0].line, 3);
  assert.equal(errors[0].column, 5);
});

test('문법 에러도 같은 형태로 돌려준다', () => {
  const result = parse('object "o":\n  when start do\n    say "hi"\nend');
  assert.equal(result.ok, false);
  assert.equal(result.ast, null);
  assert.equal(typeof result.errors[0].line, 'number');
  assert.equal(typeof result.errors[0].column, 'number');
  // detail 은 문제가 난 줄을 짚어 주는 코드 프레임이다
  assert.match(result.errors[0].detail, /^\s*2 \|\s+when start do$/m);
  assert.match(result.errors[0].detail, /\^/);
});
