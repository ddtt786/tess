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
test('리스트 인덱스를 0부터 -> 1부터로 보정한다', () => {
  const { thread } = compileScript(
    '기록[0] = 9\nin 기록 insert 5 at 2\nremove 기록[1]\nvar a = 기록[0]',
    { before: 'list 기록 = [1, 2, 3]' },
  );
  assert.equal(thread[1].params[1].params[0], '1');   // 0 -> 1
  assert.equal(thread[2].params[2].params[0], '3');   // 2 -> 3
  assert.equal(thread[3].params[0].params[0], '2');   // 1 -> 2
  assert.equal(thread[4].params[1].params[3].params[0], '1');
});

test('문자열 함수의 인덱스도 보정한다', () => {
  const { thread } = compileScript('var a = slice("abcdef", 0, 3)\nvar b = index_of("abc", "b")');
  assert.equal(sketch(thread[1].params[1]), 'substring(text(abcdef) number(1) number(3))');
  assert.equal(sketch(thread[2].params[1]), 'calc_basic(index_of_string(text(abc) text(b)) MINUS number(1))');
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
const examples = ['examples/all_blocks.tess', 'examples/gift_delivery/main.tess'];
for (const example of examples) {
  test(`예제 컴파일: ${example}`, () => {
    const file = path.join(root, example);
    const result = compileProject(fs.readFileSync(file, 'utf-8'), { path: file });
    assert.deepEqual(result.errors, [], result.errors.map((e) => e.message).join('\n'));
    const problems = verifyEntryProject(result.project);
    assert.deepEqual(problems, [], problems.join('\n'));
  });
}

test('.ent 묶음은 temp/project.json 을 담은 tar 다', () => {
  const file = path.join(root, 'examples/gift_delivery/main.tess');
  const { project } = compileProject(fs.readFileSync(file, 'utf-8'), { path: file });
  const tar = makeEntryBundle(project, []);

  assert.equal(tar.length % 512, 0);
  const name = tar.subarray(0, 100).toString('utf-8').replace(/\0+$/, '');
  assert.equal(name, 'temp/project.json');
  const size = parseInt(tar.subarray(124, 136).toString('utf-8').replace(/\0/g, '').trim(), 8);
  const content = tar.subarray(512, 512 + size).toString('utf-8');
  assert.deepEqual(JSON.parse(content).scenes.length, 3);
});

test('같은 소스는 항상 같은 결과로 컴파일된다', () => {
  const source = fs.readFileSync(path.join(root, 'examples/gift_delivery/main.tess'), 'utf-8');
  const options = { path: path.join(root, 'examples/gift_delivery/main.tess') };
  const first = compileProject(source, options).project;
  const second = compileProject(source, options).project;
  assert.equal(JSON.stringify(first), JSON.stringify(second));
});
