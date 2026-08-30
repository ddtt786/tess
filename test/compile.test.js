// Tess -> 엔트리 작품 컴파일 검사
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileProject } from '../src/compiler/index.js';
import { verifyEntryProject } from '../src/compiler/verify.js';
import { makeEntryBundle } from '../src/compiler/bundle.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 문장 하나를 오브젝트 안에 넣어 컴파일하고 그 스크립트를 돌려준다 */
function compileScript(body, { before = '', kind = 'object', costumes = '' } = {}) {
  const source = `${before}
scene "s":
  ${kind} "o":
    ${costumes}
    when start do
${body.split('\n').map((line) => `      ${line}`).join('\n')}
    end
  end
end`;
  const result = compileProject(source, { path: path.join(root, 'test.tess') });
  assert.deepEqual(result.errors, [], result.errors.map((e) => `${e.line}: ${e.message}`).join('\n'));
  const object = result.project.objects.find((o) => o.name === 'o');
  return { project: result.project, thread: JSON.parse(object.script)[0], result };
}

/** 블록 트리를 읽기 쉬운 문자열로 (type 과 리터럴만) */
function sketch(block) {
  if (block === null || block === undefined) return '_';
  if (typeof block !== 'object') return String(block);
  const params = (block.params ?? []).map(sketch).filter((p) => p !== '_');
  const statements = (block.statements ?? []).map((s) => `{${s.map(sketch).join(' ')}}`);
  return `${block.type}(${[...params, ...statements].join(' ')})`;
}

// --- 기본 매핑 ---------------------------------------------------------------
test('이벤트 블록으로 시작하는 스크립트를 만든다', () => {
  const { thread } = compileScript('forward 10');
  assert.equal(thread[0].type, 'when_run_button_click');
  assert.equal(thread[0].x, 50);
  assert.equal(sketch(thread[1]), 'move_direction(number(10))');
});

test('say / think 를 dialog 계열로 바꾼다', () => {
  const { thread } = compileScript('say "안녕"\nsay "안녕" for 2\nthink "음"');
  assert.equal(sketch(thread[1]), 'dialog(text(안녕) speak)');
  assert.equal(sketch(thread[2]), 'dialog_time(text(안녕) number(2) speak)');
  assert.equal(sketch(thread[3]), 'dialog(text(음) think)');
});

test('x = / x += 를 서로 다른 블록으로 바꾼다', () => {
  const { thread } = compileScript('x = 100\nx += 10\nx -= 5');
  assert.equal(sketch(thread[1]), 'locate_x(number(100))');
  assert.equal(sketch(thread[2]), 'move_x(number(10))');
  assert.equal(sketch(thread[3]), 'move_x(number(-5))');
});

test('costume / costume_number 로 자기·다른 오브젝트의 모양 이름·번호를 읽는다', () => {
  // 엔트리의 coordinate_object 드롭다운은 x/y/방향/이동방향/크기 말고도
  // "모양 번호"(picture_index)·"모양 이름"(picture_name) 을 갖고 있다(entryjs
  // block_calc.js) — costume/costume_number 로 이 둘을 읽는다.
  const source = `
scene "s":
  object "다른":
    default costume 기본 "a.png" size 1 1
    costume 점프 "b.png" size 1 1
  end
  object "o":
    default costume 기본 "a.png" size 1 1
    when start do
      var 이름 = costume("다른")
      var 번호 = costume_number("다른")
      var 내이름 = costume
      var 내번호 = costume_number
    end
  end
end`;
  const result = compileProject(source, { path: path.join(root, 'test.tess') });
  assert.deepEqual(result.errors, [], result.errors.map((e) => e.message).join('\n'));

  const object = result.project.objects.find((o) => o.name === 'o');
  const otherId = result.project.objects.find((o) => o.name === '다른').id;
  const thread = JSON.parse(object.script)[0];
  assert.match(sketch(thread[1]), new RegExp(`^set_variable\\(\\w+ coordinate_object\\(${otherId} picture_name\\)\\)$`));
  assert.match(sketch(thread[2]), new RegExp(`^set_variable\\(\\w+ coordinate_object\\(${otherId} picture_index\\)\\)$`));
  assert.match(sketch(thread[3]), /^set_variable\(\w+ coordinate_object\(self picture_name\)\)$/);
  assert.match(sketch(thread[4]), /^set_variable\(\w+ coordinate_object\(self picture_index\)\)$/);
});

test('move x y 는 엔트리 블록 두 개로 펼친다', () => {
  const { thread } = compileScript('move 20 -30');
  assert.equal(sketch(thread[1]), 'move_x(number(20))');
  assert.equal(sketch(thread[2]), 'move_y(number(-30))');
});

test('시간이 붙은 이동은 시간이 첫 번째 파라미터다', () => {
  const { thread } = compileScript('move 50 0 in 1\ngo 10 20 in 2\nturn 90 in 0.5');
  assert.equal(sketch(thread[1]), 'move_xy_time(number(1) number(50) number(0))');
  assert.equal(sketch(thread[2]), 'locate_xy_time(number(2) number(10) number(20))');
  assert.equal(sketch(thread[3]), 'rotate_by_time(number(0.5) angle(90))');
});

test('flip x 는 엔트리의 flip_y (좌우 뒤집기) 다', () => {
  const { thread } = compileScript('flip x\nflip y');
  assert.equal(thread[1].type, 'flip_y');
  assert.equal(thread[2].type, 'flip_x');
});

test('while true 는 계속 반복하기가 된다', () => {
  const { thread } = compileScript('while true:\n  wait 1\nend');
  assert.equal(thread[1].type, 'repeat_inf');
});

test('until 은 repeat_while_true 의 until 모드다', () => {
  const { thread } = compileScript('until 점수 > 3:\n  wait 1\nend', { before: 'var 점수 = 0' });
  assert.equal(thread[1].type, 'repeat_while_true');
  assert.equal(thread[1].params[1], 'until');
});

test('wait 은 숫자면 초, 판단이면 기다리기 블록이다', () => {
  const { thread } = compileScript('wait 1.5\nwait mouse_down');
  assert.equal(thread[1].type, 'wait_second');
  assert.equal(thread[2].type, 'wait_until_true');
});

test('stop 계열을 stop_object 의 대상으로 구분한다', () => {
  const { thread } = compileScript('stop\nstop other\nstop me\nstop them\nstop all');
  assert.deepEqual(thread.slice(1).map((b) => b.params[0]),
    ['thisThread', 'otherThread', 'thisOnly', 'other_objects', 'all']);
});

// --- 자료 ---------------------------------------------------------------------
// 리스트·문자열 인덱스는 엔트리처럼 1부터다. 그대로 옮기니 보정 블록이 안 생긴다.
test('리스트 인덱스를 엔트리와 같은 1부터로 그대로 옮긴다', () => {
  const { thread } = compileScript(
    '기록[1] = 9\nin 기록 insert 5 at 2\nremove 기록[1]\nvar a = 기록[1]',
    { before: 'list 기록 = [1, 2, 3]' },
  );
  assert.equal(sketch(thread[1].params[1]), 'number(1)');
  assert.equal(sketch(thread[2].params[2]), 'number(2)');
  assert.equal(sketch(thread[3].params[0]), 'number(1)');
  assert.equal(sketch(thread[4].params[1].params[3]), 'number(1)');
});

test('slice/index_of 의 인덱스도 그대로 옮긴다 (양끝 포함, 1부터)', () => {
  const { thread } = compileScript('var a = slice("abcdef", 1, 3)\nvar b = index_of("abc", "b")');
  assert.equal(sketch(thread[1].params[1]), 'substring(text(abcdef) number(1) number(3))');
  assert.equal(sketch(thread[2].params[1]), 'index_of_string(text(abc) text(b))');
});

test('전역 변수와 오브젝트 변수를 구분해서 등록한다', () => {
  const source = `var 전역 = 1
scene "s":
  object "o":
    var 로컬 = 2
    when start do
      전역 += 로컬
    end
  end
end`;
  const { project } = compileProject(source, { path: 'x.tess' });
  const global = project.variables.find((v) => v.name === '전역');
  const local = project.variables.find((v) => v.name === '로컬');
  assert.equal(global.object, null);
  assert.equal(local.object, project.objects[0].id);
});

test('리스트 초기값이 array 로 들어간다', () => {
  const { project } = compileProject('list 기록 = [1, "둘", 3]', { path: 'x.tess' });
  const list = project.variables.find((v) => v.name === '기록');
  assert.equal(list.variableType, 'list');
  assert.deepEqual(list.array, [{ data: 1 }, { data: '둘' }, { data: 3 }]);
});

// --- 신호 · 장면 ---------------------------------------------------------------
test('신호를 messages 로 모으고 같은 id 를 쓴다', () => {
  const source = `scene "s":
  object "a":
    when start do
      send "출발"
    end
  end
  object "b":
    when signal "출발" do
      say "받았다"
    end
  end
end`;
  const { project } = compileProject(source, { path: 'x.tess' });
  assert.equal(project.messages.length, 1);
  const id = project.messages[0].id;
  const [a, b] = project.objects.map((o) => JSON.parse(o.script)[0]);
  assert.equal(a[1].params[0], id);
  assert.equal(b[0].params[1], id);
});

test('jump 가 장면 id 를 가리킨다', () => {
  const source = `scene "하나":
  object "o":
    when start do
      jump "둘"
    end
  end
end
scene "둘":
end`;
  const { project } = compileProject(source, { path: 'x.tess' });
  const thread = JSON.parse(project.objects[0].script)[0];
  assert.equal(thread[1].type, 'start_scene');
  assert.equal(thread[1].params[0], project.scenes[1].id);
});

// --- 함수 ----------------------------------------------------------------------
test('return 이 없는 함수는 일반 함수, 있으면 값 함수가 된다', () => {
  const source = `function 알림(내용):
  say 내용
end

function 두배(값):
  return 값 * 2
end

scene "s":
  object "o":
    when start do
      알림("안녕")
      var a = 두배(21)
    end
  end
end`;
  const { project } = compileProject(source, { path: 'x.tess' });
  const [normal, value] = project.functions;
  assert.equal(normal.type, 'normal');
  assert.equal(value.type, 'value');
  assert.equal(JSON.parse(normal.content)[0][0].type, 'function_create');
  assert.equal(JSON.parse(value.content)[0][0].type, 'function_create_value');

  // 호출 블록: 일반 함수는 끝에 아이콘 자리가 하나 더 붙는다
  const thread = JSON.parse(project.objects[0].script)[0];
  assert.equal(thread[1].type, `func_${normal.id}`);
  assert.equal(thread[1].params.length, 2);
  assert.equal(thread[2].params[1].type, `func_${value.id}`);
  assert.equal(thread[2].params[1].params.length, 1);
});

test('함수 매개변수는 stringParam 블록으로 이어진다', () => {
  const source = `function 더하기(a, b):
  return a + b
end
scene "s":
  object "o":
    when start do
      var c = 더하기(1, 2)
    end
  end
end`;
  const { project } = compileProject(source, { path: 'x.tess' });
  const create = JSON.parse(project.functions[0].content)[0][0];
  const first = create.params[0].params[1];
  const second = first.params[1];
  assert.equal(create.params[0].type, 'function_field_label');
  assert.equal(create.params[0].params[0], '더하기');
  assert.match(first.params[0].type, /^stringParam_/);
  assert.match(second.params[0].type, /^stringParam_/);
  // 본문(반환식)에서 같은 타입을 참조한다
  const body = JSON.stringify(create.params[3]);
  assert.ok(body.includes(first.params[0].type));
  assert.ok(body.includes(second.params[0].type));
});

test('함수 안의 var 는 엔트리 함수 지역 변수가 된다', () => {
  const source = `function 합(n):
  var 총합 = 0
  총합 += n
  return 총합
end
scene "s":
  object "o":
    when start do
      var a = 합(3)
    end
  end
end`;
  const { project } = compileProject(source, { path: 'x.tess' });
  const fn = project.functions[0];
  assert.equal(fn.localVariables.length, 1);
  assert.equal(fn.localVariables[0].name, '총합');
  assert.equal(fn.localVariables[0].value, 0);
  // 엔트리는 지역 변수를 이름이 아니라 `함수id_해시` 로 가리킨다
  assert.match(fn.localVariables[0].id, new RegExp(`^${fn.id}_[a-z0-9]{4}$`));
  assert.equal(fn.useLocalVariables, true);
  assert.ok(fn.content.includes(`["${fn.localVariables[0].id}"`));
  assert.ok(fn.content.includes('set_func_variable'));
  assert.ok(fn.content.includes('get_func_variable'));
});

// --- 오브젝트 · 글상자 -----------------------------------------------------------
test('오브젝트 속성이 entity 로 들어간다', () => {
  const source = `scene "s":
  object "o":
    name "주인공"
    costume 기본 "a.png" size 200 100
    x = -50
    y = 20
    scale_x = 150
    angle = 30
    way = 180
    visible false
    lock true
    rotation vertical
  end
end`;
  const { project } = compileProject(source, { path: 'x.tess' });
  const object = project.objects[0];
  assert.equal(object.name, '주인공');
  assert.equal(object.objectType, 'sprite');
  assert.equal(object.rotateMethod, 'vertical');
  assert.equal(object.lock, true);
  assert.deepEqual(object.entity, {
    x: -50, y: 20, regX: 100, regY: 50, scaleX: 1.5, scaleY: 1,
    rotation: 30, direction: 180, width: 200, height: 100,
    font: 'undefinedpx ', visible: false,
  });
  assert.equal(object.selectedPictureId, object.sprite.pictures[0].id);
  assert.equal(object.sprite.pictures[0].dimension.width, 200);
});

test('글상자는 textBox 로, 글꼴 정보가 entity 에 들어간다', () => {
  const source = `scene "s":
  text "t":
    text_content = "점수"
    font = "DungGeunMo"
    font_size = 24
    font_color = #ff0000
    bg_color = transparent
    text_bold = true
    text_align = left
  end
end`;
  const { project } = compileProject(source, { path: 'x.tess' });
  const object = project.objects[0];
  assert.equal(object.objectType, 'textBox');
  assert.equal(object.text, '점수');
  assert.equal(object.entity.font, 'bold 24px DungGeunMo');
  assert.equal(object.entity.colour, '#ff0000');
  assert.equal(object.entity.bgColor, 'transparent');
  assert.equal(object.entity.textAlign, 1);
  assert.equal(object.entity.fontSize, 24);
});

// 엔트리는 글상자틀을 글자를 그려 보고 재 두지만, 컴파일러는 글꼴을 그릴 수 없어
// 글자 수로 어림잡는다. `size 가로 세로` 를 적으면 그 값이 그대로 들어가야 한다.
test('글상자의 size 가로 세로 가 entity 크기가 된다', () => {
  const source = `scene "s":
  text "t":
    text_content = "이름:\\n\\n죄목:"
    font_size = 14
    line_break = true
    size 65.49 104.65
  end
end`;
  const { project } = compileProject(source, { path: 'x.tess' });
  const { entity } = project.objects[0];
  assert.equal(entity.width, 65.49);
  assert.equal(entity.height, 104.65);
});

test('size 가로 세로 가 없으면 글자 수로 어림잡은 크기를 쓴다', () => {
  const source = `scene "s":
  text "t":
    text_content = "가나다"
    font_size = 20
  end
end`;
  const { project } = compileProject(source, { path: 'x.tess' });
  const { entity } = project.objects[0];
  assert.equal(entity.width, 3 * 20 * 0.85);
  assert.equal(entity.height, 22);
});

// `size = 100` 은 예전부터 배율(%)이다 — 새로 들어온 `size 가로 세로` 와 헷갈리면 안 된다.
test('size = 배율과 size 가로 세로 는 서로 다른 것을 정한다', () => {
  const source = `scene "s":
  text "t":
    text_content = "가"
    size 80 30
    size = 150
  end
end`;
  const { project } = compileProject(source, { path: 'x.tess' });
  const { entity } = project.objects[0];
  assert.equal(entity.width, 80);
  assert.equal(entity.height, 30);
  assert.equal(entity.scaleX, 1.5);
  assert.equal(entity.scaleY, 1.5);
});

// ---------------------------------------------------------------------------
//  복잡한 수식
//
//  우선순위·괄호·좌결합이 엔트리 블록 트리로 제대로 접히는지, 블록 모양만 보지 않고
//  엔트리가 하는 것과 똑같이 실제로 계산해서 값으로 확인한다.
// ---------------------------------------------------------------------------
/** 엔트리 계산 블록 트리를 실행기가 하듯 계산한다 */
function runCalc(block) {
  if (block === null || typeof block !== 'object') return Number(block);
  const p = block.params ?? [];
  switch (block.type) {
    case 'number': case 'text': return Number(p[0]);
    case 'calc_basic': {
      const left = runCalc(p[0]);
      const right = runCalc(p[2]);
      return { PLUS: left + right, MINUS: left - right, MULTI: left * right, DIVIDE: left / right }[p[1]];
    }
    case 'quotient_and_mod': {
      const left = runCalc(p[1]);
      const right = runCalc(p[3]);
      return p[5] === 'MOD' ? left % right : Math.floor(left / right);
    }
    default: throw new Error(`계산할 수 없는 블록: ${block.type}`);
  }
}

const MATH_CASES = [
  ['3 - 2 * (3 + 7 - 2 * 5)', 3],
  ['(2 + 3) * 4', 20],
  ['10 - 2 - 3', 5],           // 좌결합
  ['2 * 3 + 4 * 5', 26],
  ['100 / 5 / 2', 10],
  ['1 + 2 * 3 - 4 / 2', 5],
  ['((1 + 2) * (3 + 4)) - 5', 16],
  ['7 % 3 + 8 // 3', 3],
  ['-3 + 5', 2],
  ['2 - -3', 5],
  ['(3 - 2) * (3 + 7 - 2 * 5)', 0],
];

for (const [expr, expected] of MATH_CASES) {
  test(`수식 ${expr} 를 엔트리 블록으로 옮겨도 값이 같다`, () => {
    const { thread, result } = compileScript(`var r = ${expr}`);
    assert.deepEqual(result.errors, []);
    const set = thread.find((block) => block.type === 'set_variable');
    assert.equal(runCalc(set.params[1]), expected);
  });
}

test('괄호가 블록 중첩으로 그대로 남는다', () => {
  const { thread } = compileScript('var r = 3 - 2 * (3 + 7 - 2 * 5)');
  const value = thread.find((block) => block.type === 'set_variable').params[1];
  // 3 - (2 * ((3 + 7) - (2 * 5)))
  assert.equal(value.type, 'calc_basic');
  assert.equal(value.params[1], 'MINUS');
  assert.equal(value.params[0].params[0], '3');
  const rhs = value.params[2];
  assert.equal(rhs.params[1], 'MULTI');
  assert.equal(rhs.params[2].params[1], 'MINUS'); // 괄호 안이 통째로 오른쪽에 들어간다
});

test('모양·소리를 엔트리 리소스 경로로 만든다', () => {
  const { project } = compileScript('', {
    costumes: 'costume 기본 "hero.png" size 10 20\n    sound 점프 "jump.mp3"',
  });
  const object = project.objects.find((o) => o.name === 'o');
  const picture = object.sprite.pictures[0];
  const sound = object.sprite.sounds[0];
  assert.match(picture.fileurl, /^temp\/[a-z0-9]{2}\/[a-z0-9]{2}\/image\/[a-z0-9]{32}\.png$/);
  assert.equal(picture.imageType, 'png');
  assert.match(sound.fileurl, /^temp\/[a-z0-9]{2}\/[a-z0-9]{2}\/sound\/[a-z0-9]{32}\.mp3$/);
  assert.equal(sound.ext, '.mp3');
});

test('force id 는 모양·소리의 엔트리 id 를 그 문자열로 고정한다', () => {
  const { project } = compileScript('', {
    costumes: 'costume 기본 "hero.png" size 10 20 force id "qio1"\n    sound 점프 "jump.mp3" force id "aabb"',
  });
  const object = project.objects.find((o) => o.name === 'o');
  assert.equal(object.sprite.pictures[0].id, 'qio1');
  assert.equal(object.sprite.sounds[0].id, 'aabb');
});

test('force id 가 이미 다른 곳에서 쓰이고 있으면 에러다', () => {
  const source = `
scene "s":
  object "o":
    costume 하나 "a.png" size 1 1 force id "qio1"
    costume 둘 "b.png" size 1 1 force id "qio1"
  end
end`;
  const result = compileProject(source, { path: path.join(root, 'test.tess') });
  assert.equal(result.ok, false);
  assert.match(result.errors[0].message, /이미 다른/);
});

test('force id 로 고정된 id 는 이 오브젝트 소유가 아니어도 costume = 로 그대로 흘려보낸다', () => {
  // 함수 안에 다른 오브젝트의 모양 id 를 그대로 박아 넣던 관습을 되돌릴 때 쓰는 패턴
  // (SPEC-ADDENDUM.md 1.4절) — force id 로 고정된 문자열은 이 오브젝트의 모양 이름이
  // 아니어도 에러 없이 그대로 통과해야 한다.
  const source = `
scene "s":
  object "다른":
    default costume 점프 "jump.png" size 1 1 force id "qio1"
  end
  object "o":
    default costume 기본 "a.png" size 1 1
    when start do
      costume = "qio1"
    end
  end
end`;
  const result = compileProject(source, { path: path.join(root, 'test.tess') });
  assert.deepEqual(result.errors, [], result.errors.map((e) => e.message).join('\n'));
  const object = result.project.objects.find((o) => o.name === 'o');
  const thread = JSON.parse(object.script)[0];
  assert.equal(sketch(thread[1]), 'change_to_some_shape(qio1)');
});

// --- use ------------------------------------------------------------------------
test('use 가 파일을 그 자리에 펼친다', () => {
  const files = {
    '/p/main.tess': `var 점수 = 0
scene "s":
  use "hero.tess"
end`,
    '/p/hero.tess': `object "주인공":
  name "주인공"
  use "hero_script.tess"
end`,
    '/p/hero_script.tess': `when start do
  점수 += 1
end`,
  };
  const result = compileProject(files['/p/main.tess'], {
    path: '/p/main.tess',
    readFile: (target) => {
      if (!files[target]) throw new Error('없음');
      return files[target];
    },
  });
  assert.deepEqual(result.errors, []);
  assert.equal(result.project.objects.length, 1);
  const thread = JSON.parse(result.project.objects[0].script)[0];
  assert.equal(thread[0].type, 'when_run_button_click');
  assert.equal(thread[1].type, 'change_variable');
});

// --- 엔트리에 없는 기능 -----------------------------------------------------------
test('키를 뗐을 때 이벤트는 감시 스크립트로 바뀐다', () => {
  const source = `scene "s":
  object "o":
    costume 기본 "a.png" size 10 10
    when key "a" up do
      say "뗐다"
    end
  end
end`;
  const result = compileProject(source, { path: 'x.tess' });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
  const thread = JSON.parse(result.project.objects[0].script)[0];
  assert.equal(thread[0].type, 'when_run_button_click');
  assert.equal(thread[1].type, 'repeat_inf');
  assert.equal(thread[1].statements[0][0].type, 'wait_until_true');
});

test('거듭제곱은 제곱·제곱근으로 펼쳐진다', () => {
  const { thread } = compileScript('var a = 3 ** 2\nvar b = 16 ** 0.5\nvar c = 2 ** 3\nvar d = 5 ** 0');
  assert.equal(thread[1].params[1].params[3], 'square');
  assert.equal(thread[2].params[1].params[3], 'root');
  // 2^3 = (2^1)^2 × 2  — 자릿수만큼만 펼친다
  assert.equal(sketch(thread[3].params[1]), 'calc_basic(calc_operation(number(2) square) MULTI number(2))');
  assert.equal(sketch(thread[4].params[1]), 'number(1)');
});

test('지수를 계산해서 적을 수 있다', () => {
  const { thread } = compileScript('var a = 8 ** (6 / 3)');
  assert.equal(thread[1].params[1].params[3], 'square');
});

test('지수가 숫자로 정해지지 않으면 알려 준다', () => {
  const bad = compileProject(`var n = 3
scene "s":
  object "o":
    when start do
      var a = 2 ** n
    end
  end
end`, { path: 'x.tess' });
  assert.equal(bad.ok, false);
  assert.match(bad.errors[0].message, /지수는 숫자로 정해져 있어야/);
});

test('random 이 든 값은 지수가 밑을 여러 번 쓸 때 막는다', () => {
  const bad = compileProject(`scene "s":
  object "o":
    when start do
      var a = random(1, 10) ** 3
    end
  end
end`, { path: 'x.tess' });
  assert.equal(bad.ok, false);
  assert.match(bad.errors[0].message, /random/);

  // 밑을 한 번만 쓰는 지수는 괜찮다
  const fine = compileProject(`scene "s":
  object "o":
    when start do
      var a = random(1, 10) ** 0.5
    end
  end
end`, { path: 'x.tess' });
  assert.deepEqual(fine.errors, []);
});

test('딱 떨어지지 않는 지수만 다듬기 함수를 부른다', () => {
  const exact = compileProject(`scene "s":
  object "o":
    when start do
      var a = 4 ** 0.75
    end
  end
end`, { path: 'x.tess' });
  assert.equal(exact.project.functions.length, 0);

  const inexact = compileProject(`scene "s":
  object "o":
    when start do
      var a = 27 ** (1/3)
    end
  end
end`, { path: 'x.tess' });
  const refiner = inexact.project.functions[0];
  assert.ok(refiner.content.includes('거듭제곱 다듬기'));
  assert.equal(refiner.type, 'value');
  assert.deepEqual(verifyEntryProject(inexact.project), []);
});

test('엔트리에 없는 동작은 에러로 알려 준다', () => {
  const cases = [
    ['go "없는오브젝트"', /오브젝트가 없습니다/],
    ['play sound "없는소리"', /소리가 이 오브젝트에 없습니다/],
    ['jump "없는장면"', /장면이 없습니다/],
    ['costume = "없는모양"', /모양이 이 오브젝트에 없습니다/],
  ];
  for (const [code, pattern] of cases) {
    const result = compileProject(`scene "s":
  object "o":
    when start do
      ${code}
    end
  end
end`, { path: 'x.tess' });
    assert.equal(result.ok, false, code);
    assert.match(result.errors[0].message, pattern, code);
  }
});

test('함수 중간의 return 은 에러다', () => {
  const source = `function f(n):
  if n > 1:
    return 1
  end
  return 2
end`;
  const result = compileProject(source, { path: 'x.tess' });
  assert.equal(result.ok, false);
  assert.match(result.errors[0].message, /중간에서 값을 돌려줄 수 없습니다/);
});

// --- 주석 -----------------------------------------------------------------------
test('문장 위의 주석이 그 블록의 엔트리 주석이 된다', () => {
  const { thread } = compileScript('# 앞으로 간다\nforward 10');
  assert.equal(thread[1].type, 'move_direction');
  assert.equal(thread[1].comment.value, '앞으로 간다');
  assert.equal(thread[1].comment.type, 'comment');
  assert.equal(thread[1].comment.isOpened, true);
});

test('같은 줄 뒤에 붙은 주석도 그 블록에 붙는다', () => {
  const { thread } = compileScript('x = 5  # 자리 잡기');
  assert.equal(thread[1].comment.value, '자리 잡기');
});

test('여러 줄 주석은 하나로 합쳐진다', () => {
  const { thread } = compileScript('# 첫 줄\n# 둘째 줄\nforward 1');
  assert.equal(thread[1].comment.value, '첫 줄\n둘째 줄');
});

test('이벤트 위의 주석은 이벤트 블록에 붙는다', () => {
  const source = `scene "s":
  object "o":
    # 시작할 때 하는 일
    when start do
      forward 1
    end
  end
end`;
  const { project } = compileProject(source, { path: 'x.tess' });
  const thread = JSON.parse(project.objects[0].script)[0];
  assert.equal(thread[0].type, 'when_run_button_click');
  assert.equal(thread[0].comment.value, '시작할 때 하는 일');
});

test('문자열 안의 # 과 색상 리터럴은 주석이 아니다', () => {
  const { thread } = compileScript('say "# 우물정"\ndraw_color = #ff0000');
  assert.equal(thread[1].comment, undefined);
  assert.equal(thread[1].params[0].params[0], '# 우물정');
  assert.equal(thread[2].params[0], '#ff0000');
});

test('붙을 블록이 없는 주석은 그냥 사라진다', () => {
  const source = `# 파일 설명
scene "s":
  object "o":
    # 오브젝트 설명
    name "이름"
  end
end`;
  const { project, errors } = compileProject(source, { path: 'x.tess' });
  assert.deepEqual(errors, []);
  assert.equal(project.objects[0].name, '이름');
});

// --- useobject / usetext -----------------------------------------------------------
test('useobject 는 불러온 조각을 오브젝트로 감싼다', () => {
  const files = {
    '/p/main.tess': 'scene "무대":\n  useobject "objects/치로.tess"\n  usetext "objects/점수판.tess"\nend',
    '/p/objects/치로.tess': 'name "치로"\ncostume 기본 "c.png" size 40 60\nx = -100\n\nwhen start do\n  say "안녕"\nend',
    '/p/objects/점수판.tess': 'text_content = "점수: 0"\nfont_size = 24',
  };
  const result = compileProject(files['/p/main.tess'], {
    path: '/p/main.tess',
    readFile: (target) => {
      if (!files[target]) throw new Error('없음');
      return files[target];
    },
  });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);

  const [sprite, textBox] = result.project.objects;
  assert.equal(sprite.objectType, 'sprite');
  assert.equal(sprite.name, '치로');
  assert.equal(sprite.entity.x, -100);
  assert.equal(JSON.parse(sprite.script).length, 1);
  assert.equal(textBox.objectType, 'textBox');
  assert.equal(textBox.text, '점수: 0');
});

test('useobject 로 만든 오브젝트는 파일 이름으로 서로를 가리킨다', () => {
  const files = {
    '/p/main.tess': 'scene "무대":\n  useobject "objects/주인공.tess"\n  useobject "objects/적.tess"\nend',
    '/p/objects/주인공.tess': 'costume 기본 "a.png" size 10 10\n\nwhen start do\n  if touching("적"):\n    say "앗"\n  end\nend',
    '/p/objects/적.tess': 'costume 기본 "b.png" size 10 10',
  };
  const result = compileProject(files['/p/main.tess'], {
    path: '/p/main.tess',
    readFile: (target) => files[target],
  });
  assert.deepEqual(result.errors, []);
  const enemy = result.project.objects[1];
  const thread = JSON.parse(result.project.objects[0].script)[0];
  assert.equal(thread[1].params[0].type, 'reach_something');
  assert.equal(thread[1].params[0].params[1], enemy.id);
});

// --- 리소스 선언 ---------------------------------------------------------------------
test('크기·길이를 적어 두면 파일이 없어도 알리지 않는다', () => {
  const declared = compileProject(`scene "s":
  object "o":
    costume 기본 "a.png" size 200 100
    sound 점프 "j.mp3" for 1.5
  end
end`, { path: 'x.tess' });
  assert.deepEqual(declared.warnings, []);
  const object = declared.project.objects[0];
  assert.deepEqual(object.sprite.pictures[0].dimension, { width: 200, height: 100 });
  assert.equal(object.sprite.sounds[0].duration, 1.5);

  const bare = compileProject(`scene "s":
  object "o":
    costume 기본 "a.png"
  end
end`, { path: 'x.tess' });
  assert.equal(bare.warnings.length, 1);
  assert.match(bare.warnings[0].message, /찾지 못했습니다/);
});

// --- scale_x / scale_y 정하기 ----------------------------------------------------------
test('scale_x = 값 은 컴파일러가 만든 함수를 부른다', () => {
  const { thread, project } = compileScript('scale_x = 50', {
    costumes: 'costume 기본 "a.png" size 100 100',
  });
  const setter = project.functions.find((fn) => fn.content.includes('가로 비율 정하기'));
  assert.ok(setter, '가로 비율 정하기 함수가 만들어져야 합니다.');
  assert.equal(thread[1].type, `func_${setter.id}`);
  assert.equal(Number(thread[1].params[0].params[0]), 50);
  assert.equal(Number(thread[1].params[1].params[0]), 1); // 시작 배율 100%
  assert.deepEqual(verifyEntryProject(project), []);
});

test('함수 안에서는 비율을 정할 수 없다고 알려 준다', () => {
  const result = compileProject(`function f():
  scale_x = 50
end
scene "s":
  object "o":
    when start do
      f()
    end
  end
end`, { path: 'x.tess' });
  assert.equal(result.ok, false);
  assert.match(result.errors[0].message, /함수 안에서 할 수 없습니다/);
});

// --- 전체 예제 --------------------------------------------------------------------
const examples = ['examples/all_blocks.tess', 'examples/functions.tess'];
for (const example of examples) {
  test(`예제 컴파일: ${example}`, () => {
    const file = path.join(root, example);
    const result = compileProject(fs.readFileSync(file, 'utf-8'), { path: file });
    assert.deepEqual(result.errors, [], result.errors.map((e) => e.message).join('\n'));
    const problems = verifyEntryProject(result.project);
    assert.deepEqual(problems, [], problems.join('\n'));
  });
}

test('.ent 묶음은 temp/project.json 을 담은 tar 다', async () => {
  const file = path.join(root, 'examples/all_blocks.tess');
  const { project } = compileProject(fs.readFileSync(file, 'utf-8'), { path: file });
  const tar = await makeEntryBundle(project, []);

  assert.equal(tar.length % 512, 0);
  const name = tar.subarray(0, 100).toString('utf-8').replace(/\0+$/, '');
  assert.equal(name, 'temp/project.json');
  const size = parseInt(tar.subarray(124, 136).toString('utf-8').replace(/\0/g, '').trim(), 8);
  const content = tar.subarray(512, 512 + size).toString('utf-8');
  assert.deepEqual(JSON.parse(content).scenes.length, 2);
});

test('같은 소스는 항상 같은 결과로 컴파일된다', () => {
  const source = fs.readFileSync(path.join(root, 'examples/all_blocks.tess'), 'utf-8');
  const options = { path: path.join(root, 'examples/all_blocks.tess') };
  const first = compileProject(source, options).project;
  const second = compileProject(source, options).project;
  assert.equal(JSON.stringify(first), JSON.stringify(second));
});

// --- force: 에러가 있어도 만들다 만 작품 받아 가기 -------------------------------
// 컴파일러는 에러를 만나도 그 자리만 빼고 끝까지 가므로(한 번에 에러를 다 보여
// 주기 위해서다), 만들다 만 작품이 이미 손에 있다. --force / options.force 는 그걸
// 그대로 돌려준다 — 큰 작품을 되돌려 놓고 아직 안 고친 부분이 남았을 때 나머지가
// 제대로 도는지 먼저 실행해 보는 용도다.
const FORCE_SOURCE = `project:
  title "강제"
end

object "주인공":
  costume 기본 "없음.png" size 10 10
  when start do
    costume = "없는모양"
    x += 1
  end
end`;

test('에러가 있으면 project 는 null 이고, force 를 주면 만들다 만 작품을 그대로 돌려준다', () => {
  const plain = compileProject(FORCE_SOURCE, { path: 'x.tess' });
  assert.equal(plain.ok, false);
  assert.equal(plain.project, null);

  const forced = compileProject(FORCE_SOURCE, { path: 'x.tess', force: true });
  assert.equal(forced.ok, false); // force 를 줘도 에러가 없어지는 건 아니다
  assert.deepEqual(forced.errors.map((e) => e.message), plain.errors.map((e) => e.message));
  assert.ok(forced.project);

  // 에러가 난 문장(costume = "없는모양")은 빠지고, 그 뒤의 멀쩡한 블록은 그대로 남는다
  const script = JSON.parse(forced.project.objects[0].script);
  assert.deepEqual(script[0].map((block) => block.type), ['when_run_button_click', 'move_x']);
});

test('문법 에러는 작품 자체가 안 만들어져서 force 도 소용없다', () => {
  const result = compileProject('object "주인공":\n  when start do\n    x +=\n', { path: 'x.tess', force: true });
  assert.equal(result.ok, false);
  assert.equal(result.project, null);
});

// --- 함수 머리: 라벨 + 매개변수 이름 (SPEC-ADDENDUM.md 4.6) ------------------------
// 엔트리 함수 머리는 라벨과 매개변수 칸이 번갈아 나오는 사슬이다. 제자리 자동 이름
// (a, b, c … z, a1, a2 …)은 라벨 없는 인수를, 그 밖의 이름은 그 이름을 라벨로 단
// 인수를 뜻한다 — 되돌리기가 읽는 규칙(src/function-params.js)의 정확한 반대다.
function fieldChain(project, index = 0) {
  const chain = [];
  let node = JSON.parse(project.functions[index].content)[0][0].params[0];
  while (node && typeof node === 'object') {
    if (node.type === 'function_field_label') chain.push(`label:${node.params[0]}`);
    else if (node.type?.startsWith('function_field_')) chain.push(`param:${node.params[0]?.type.split('_')[0]}`);
    else break;
    node = node.params[1];
  }
  return chain;
}

test('자동 이름 매개변수는 라벨 없이, 이름 붙인 매개변수는 라벨을 달고 나간다', () => {
  const plain = compileProject('function 스폰(a, b):\n  say a\nend', { path: 'x.tess' });
  assert.deepEqual(fieldChain(plain.project), ['label:스폰', 'param:stringParam', 'param:stringParam']);

  const named = compileProject('function 스폰(a, 체력):\n  say 체력\nend', { path: 'x.tess' });
  assert.deepEqual(fieldChain(named.project),
    ['label:스폰', 'param:stringParam', 'label:체력', 'param:stringParam']);
});

// --- 판단 <-> 값 자동 변환 (SPEC-ADDENDUM.md 4) -----------------------------------
// 엔트리는 판단 칸과 값 칸이 엄격히 나뉘어 있는데 Tess 에는 타입이 없다. 어긋나는
// 자리는 엔트리가 실제로 쓰는 블록(참/거짓, `(<판단>의 값)`)으로 이어 준다.
function firstBlocks(source) {
  const { project } = compileProject(`scene "s":\n  object "o":\n${source}\n  end\nend`, { path: 'x.tess' });
  return { project, thread: JSON.parse(project.objects[0].script)[0] };
}

test('판단 자리의 리터럴은 참/거짓 블록이 되고, 계산되는 값은 == "TRUE" 로 감싼다', () => {
  const { thread } = firstBlocks(`    var flag = false
    when start do
      if true then
        say "a"
      end
      if "살아있음" then
        say "b"
      end
      if 1 then
        say "c"
      end
      if flag then
        say "d"
      end
    end`);
  const conditions = thread.slice(1).map((block) => block.params[0]);
  assert.deepEqual(conditions.slice(0, 3).map((c) => c.type), ['True', 'True', 'True']);
  assert.equal(conditions[3].type, 'boolean_basic_operator');
  assert.equal(conditions[3].params[2].params[0], 'TRUE');
});

test('값 자리의 판단은 (<판단>의 값) 으로 감싸고, true/false 는 "TRUE"/"FALSE" 가 된다', () => {
  const { project, thread } = firstBlocks(`    var flag = true
    when start do
      flag = false
      flag = x > 3
    end`);
  // 초기값도 대입식과 같은 글자여야 if flag 가 맞아떨어진다
  assert.equal(project.variables.find((v) => v.name === 'flag').value, 'TRUE');

  const [, assignLiteral, assignCompare] = thread;
  assert.equal(assignLiteral.params[1].type, 'get_boolean_value');
  assert.equal(assignLiteral.params[1].params[0].type, 'False');
  assert.equal(assignCompare.params[1].type, 'get_boolean_value');
  assert.equal(assignCompare.params[1].params[0].type, 'boolean_basic_operator');
});

test('wait 은 판단을 감싸지 않고 "~까지 기다리기" 로 남는다', () => {
  const { thread } = firstBlocks('    when start do\n      wait x > 3\n    end');
  assert.equal(thread[1].type, 'wait_until_true');
  assert.equal(thread[1].params[0].type, 'boolean_basic_operator');
});

test('매개변수 이름 뒤의 ? 는 엔트리 판단 칸이 된다', () => {
  const source = `function 스폰(a, 살았나?):
  if 살았나 then
    say a
  end
end
scene "s":
  object "o":
    when start do
      스폰("치로", x > 3)
      스폰("나무", true)
    end
  end
end`;
  const result = compileProject(source, { path: 'x.tess' });
  assert.deepEqual(result.errors, [], result.errors.map((e) => e.message).join('\n'));
  assert.deepEqual(verifyEntryProject(result.project), []);

  // 머리: 라벨 -> 값 칸 -> 라벨(살았나) -> 판단 칸
  assert.deepEqual(fieldChain(result.project),
    ['label:스폰', 'param:stringParam', 'label:살았나', 'param:booleanParam']);

  // 본문에서는 판단 자리에 그대로 꽂힌다 (== "TRUE" 로 감싸지 않는다)
  const create = JSON.parse(result.project.functions[0].content)[0][0];
  assert.match(create.statements[0][0].params[0].type, /^booleanParam_/);

  // 호출: 판단 칸에는 판단이 그대로, 리터럴 true 는 참 블록으로 들어간다
  const [, compare, literal] = JSON.parse(result.project.objects[0].script)[0];
  assert.equal(compare.params[1].type, 'boolean_basic_operator');
  assert.equal(literal.params[1].type, 'True');
});

test('색 자리에는 계산되는 값도 넣을 수 있다', () => {
  const { thread } = compileScript('var c = "#ff0000"\ndraw_color = c\nfont_color = join("#", "00ff00")', { kind: 'text' });
  const drawColor = thread.find((block) => block.type === 'set_color');
  const fontColor = thread.find((block) => block.type === 'text_change_font_color');
  assert.equal(drawColor.params[0].type, 'get_variable');
  assert.equal(fontColor.params[0].type, 'combine_something');
});

test('전역 함수가 쓴 오브젝트 로컬 변수는 그 오브젝트의 변수를 가리킨다', () => {
  const source = `scene "s":
  object "hero":
    costume c "${path.join(root, 'assets', 'a.png')}"
    when start do
      회복(10)
    end
  end
end

function 회복(양):
  체력 += 양
end

object "hero2":
  costume c2 "${path.join(root, 'assets', 'a.png')}"
  var 체력 = 50
end`;
  const result = compileProject(source, { path: path.join(root, 'test.tess') });
  assert.deepEqual(result.errors, [], result.errors.map((e) => e.message).join('\n'));

  const 체력 = result.project.variables.find((v) => v.name === '체력');
  const hero2 = result.project.objects.find((o) => o.name === 'hero2');
  assert.equal(체력.object, hero2.id);

  const body = JSON.parse(result.project.functions[0].content)[0][0].statements[0];
  assert.equal(body[0].type, 'change_variable');
  assert.equal(body[0].params[0], 체력.id);
});

test('같은 이름의 로컬 변수를 여러 오브젝트가 가지면 전역 함수에서 못 쓴다', () => {
  const source = `object "a":
  var 힘 = 1
end

object "b":
  var 힘 = 2
end

function 세기():
  힘 += 1
end`;
  const result = compileProject(source, { path: path.join(root, 'test.tess') });
  assert.ok(result.errors.some((e) => /a, b 가 저마다 가진 지역 변수/.test(e.message)));
});

test('sound_speed 를 값으로 읽으면 get_sound_speed 가 된다', () => {
  const { thread } = compileScript('var a = sound_speed');
  assert.equal(sketch(thread[1].params[1]), 'get_sound_speed()');
});

test('전역 함수가 쓴 모양·소리 이름은 그걸 가진 오브젝트 것으로 풀린다', () => {
  const source = `scene "s":
  object "hero":
    costume 점프 "${path.join(root, 'assets', 'a.png')}"
    sound 점프음 "${path.join(root, 'assets', 'a.png')}"
    when start do
      바꾸기()
    end
  end
end

function 바꾸기():
  costume = "점프"
  play sound "점프음"
end`;
  const result = compileProject(source, { path: path.join(root, 'test.tess') });
  assert.deepEqual(result.errors, [], result.errors.map((e) => e.message).join('\n'));

  const hero = result.project.objects.find((o) => o.name === 'hero');
  const [costume, sound] = JSON.parse(result.project.functions[0].content)[0][0].statements[0];
  assert.equal(costume.type, 'change_to_some_shape');
  assert.equal(costume.params[0].params[0], hero.sprite.pictures[0].id);
  assert.equal(sound.params[0].params[0], hero.sprite.sounds[0].id);
});

test('같은 이름의 모양·소리를 여러 오브젝트가 가지면 전역 함수에서 못 쓴다', () => {
  const source = `object "a":
  costume 점프 "${path.join(root, 'assets', 'a.png')}"
end

object "b":
  costume 점프 "${path.join(root, 'assets', 'a.png')}"
end

function 바꾸기():
  costume = "점프"
end`;
  const result = compileProject(source, { path: path.join(root, 'test.tess') });
  assert.ok(result.errors.some((e) => /a, b 가 저마다 가진 모양/.test(e.message)));
});
