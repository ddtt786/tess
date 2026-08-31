// 이름을 잘못 적었을 때 가까운 이름을 짚어 주는지 검사한다.
//
// "그런 것 없습니다" 만 돌려주면 어디가 틀렸는지 눈으로 찾아야 한다. 특히 한글은
// 글자 하나가 자음·모음이 뭉친 덩어리라 '체력' 과 '체렄' 이 눈에 잘 안 띈다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { editDistance, nearestName, didYouMean } from '@tess/core';
import { compileProject } from '@tess/compiler';
import { parse } from '@tess/parser';

const object = (body) => `scene "s":\n  object "o":\n${body}\n  end\nend`;
const firstError = (source) => compileProject(source, { path: 't.tess' }).errors[0]?.message ?? '';
// 엔트리가 실행할 때 이름으로 찾는 자리(모양·소리)는 경고로만 짚어 준다
const firstWarning = (source) => compileProject(source, { path: 't.tess' }).warnings[0]?.message ?? '';

test('붙어 있는 두 글자가 바뀐 것은 한 번으로 센다', () => {
  // 손으로 칠 때 가장 흔한 실수다. 두 번으로 세면 정작 찾아 줘야 할 오타를 놓친다.
  assert.equal(editDistance('lenght', 'length'), 1);
  assert.equal(editDistance('abc', 'abc'), 0);
  assert.equal(editDistance('abc', 'abd'), 1);
  assert.equal(editDistance('', 'ab'), 2);
});

test('가까운 이름을 고르고, 너무 멀면 아무것도 고르지 않는다', () => {
  assert.equal(nearestName('lenght', ['length', 'slice', 'count']), 'length');
  assert.equal(nearestName('체렄', ['체력', '점수']), '체력');
  assert.equal(nearestName('완전히다른것', ['체력', '점수']), null);
  assert.equal(nearestName('', ['체력']), null);
  assert.equal(nearestName('체력', []), null);
});

test('짧은 이름일수록 덜 봐준다', () => {
  // 세 글자짜리에서 두 글자가 다르면 오타라기보다 다른 이름이다
  assert.equal(nearestName('abc', ['abd']), 'abd');
  assert.equal(nearestName('abc', ['xyz']), null);
});

test('가까운 이름이 없으면 아무 말도 덧붙이지 않는다', () => {
  assert.equal(didYouMean('체렄', ['체력']), " 혹시 '체력' 인가요?");
  assert.equal(didYouMean('생뚱맞은것', ['체력']), '');
});

test('내장 함수 이름 오타를 짚어 준다', () => {
  const warnings = parse(object('    when start do\n      say lenght("가")\n    end')).warnings;
  assert.match(warnings[0].message, /혹시 'length' 인가요\?/);
});

test('변수 이름 오타를 짚어 준다', () => {
  const message = firstError(object('    var 체력 = 3\n    when start do\n      say 체렄\n    end'));
  assert.match(message, /선언되지 않은 이름 '체렄'/);
  assert.match(message, /혹시 '체력' 인가요\?/);
});

test('모양 · 소리 · 오브젝트 · 장면 이름 오타를 짚어 준다', () => {
  const costume = firstWarning(object(
    '    costume 점프 "a.png" size 1 1\n    when start do\n      costume = "점푸"\n    end',
  ));
  assert.match(costume, /혹시 '점프' 인가요\?/);

  const sound = firstWarning(object(
    '    sound 효과음 "a.mp3" for 1\n    when start do\n      play sound "효과응"\n    end',
  ));
  assert.match(sound, /혹시 '효과음' 인가요\?/);

  const target = firstError('scene "s":\n  object "주인공":\n    when start do\n      go "주인콩"\n    end\n  end\nend');
  assert.match(target, /혹시 '주인공' 인가요\?/);

  const scene = firstError('scene "무대":\n  object "o":\n    when start do\n      jump "무데"\n    end\n  end\nend');
  assert.match(scene, /혹시 '무대' 인가요\?/);
});

test('키 이름 오타를 짚어 준다', () => {
  const event = firstError(object('    when key "spce" do\n      say 1\n    end'));
  assert.match(event, /혹시 'space' 인가요\?/);
});

test('오타로 볼 수 없으면 원래 안내를 그대로 낸다', () => {
  // 가까운 이름이 있는데 "그 이름으로 새로 등록하세요" 라고 하면 서로 어긋난 말이 된다.
  // 반대로 가까운 이름이 없으면 등록 방법을 알려 주는 쪽이 도움이 된다.
  const message = firstWarning(object(
    '    costume 점프 "a.png" size 1 1\n    when start do\n      costume = "전혀다른모양"\n    end',
  ));
  assert.match(message, /costume 전혀다른모양 "파일명" 으로 먼저 등록하세요/);
  assert.doesNotMatch(message, /혹시/);
});

test('같은 오타를 에러와 경고로 두 번 읽히지 않는다', () => {
  // 검증기는 컴파일 전에 "선언되지 않은 이름" 을 미리 알려 주는데, 컴파일까지 갔으면
  // 같은 자리에서 더 자세한 에러가 이미 나온다.
  const result = compileProject(
    object('    var 체력 = 3\n    when start do\n      체렄 = 5\n    end'),
    { path: 't.tess' },
  );
  const spots = new Set(result.errors.map((e) => `${e.line}:${e.column}`));
  const overlap = result.warnings.filter((w) => spots.has(`${w.line}:${w.column}`));
  assert.deepEqual(overlap, []);
  assert.equal(result.errors.length, 1);
});
