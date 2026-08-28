// 되돌리기(.ent -> Tess)가 기본적으로 use/useobject/usetext 를 쓰는지 검사한다.
//
// 오브젝트 하나당 조각 파일 하나(objects/이름.tess)로 나눠 쓰고 main.tess 에는
// useobject/usetext 한 줄만 남기는 게 기본 동작이어야 한다(SPEC-ADDENDUM.md 1.2절
// 참고) — 손으로 짠 예제(examples/gift_delivery, 이제는 지워졌지만 커밋 d159c2e 에
// 남아 있다)가 보여 준 형태 그대로다. 이 파일이 생기기 전엔 되돌리기에 대한 자동
// 테스트가 전혀 없었다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { decompileProject } from '../src/decompiler/index.js';
import { compileProject } from '../src/compiler/index.js';

/** 스프라이트 하나짜리, 스크립트도 아주 단순한 최소 project.json. sceneCount 로 장면 수를 고른다 */
function minimalProject(sceneCount = 1) {
  const startHat = () => ({ type: 'when_run_button_click', params: [null], statements: [] });
  const waitOneSecond = () => ({
    type: 'wait_second',
    params: [{ type: 'number', params: ['1'] }, null],
    statements: [],
  });

  const scenes = sceneCount === 1
    ? [{ id: 'scene1', name: '장면 1' }]
    : [{ id: 'scene1', name: '장면 1' }, { id: 'scene2', name: '장면 2' }];

  return {
    name: '되돌리기 테스트',
    speed: 60,
    scenes,
    variables: [],
    messages: [],
    functions: [],
    aiUtilizeBlocks: [],
    objects: [
      {
        id: 'obj1',
        name: '주인공',
        objectType: 'sprite',
        scene: 'scene1',
        rotateMethod: 'free',
        script: JSON.stringify([[startHat(), waitOneSecond()]]),
        entity: { x: 10, y: 0, scaleX: 1, scaleY: 1, visible: true },
        sprite: { pictures: [], sounds: [] },
        selectedPictureId: null,
      },
      {
        id: 'obj2',
        name: '점수판',
        objectType: 'textBox',
        scene: sceneCount === 1 ? 'scene1' : 'scene2',
        rotateMethod: 'free',
        script: JSON.stringify([[startHat(), waitOneSecond()]]),
        entity: {
          x: 0, y: 0, scaleX: 1, scaleY: 1, visible: true,
          colour: '#ff0000', bgColor: '#ffffff', font: '20px Nanum Gothic', fontSize: 20,
        },
        text: '점수: 0',
        sprite: { pictures: [], sounds: [] },
      },
    ],
  };
}

test('되돌리기는 기본적으로 오브젝트마다 objects/이름.tess 조각 파일을 만든다', () => {
  const project = minimalProject(1);
  const result = decompileProject(project, []);

  // main.tess 에는 오브젝트를 인라인으로 감싸는 object/text 선언이 아니라
  // useobject/usetext 한 줄만 있어야 한다.
  assert.match(result.source, /useobject "objects\/주인공\.tess"/);
  assert.match(result.source, /usetext "objects\/점수판\.tess"/);
  assert.doesNotMatch(result.source, /object "주인공"/);
  assert.doesNotMatch(result.source, /text "점수판"/);

  const fragmentPaths = result.assets.map((a) => a.path).sort();
  assert.deepEqual(fragmentPaths, ['objects/점수판.tess', 'objects/주인공.tess']);

  // 조각 파일 자체는 object/text 로 감싸지 않은 내용만 담는다 (들여쓰기 0에서 시작)
  const heroFragment = result.assets.find((a) => a.path === 'objects/주인공.tess').data.toString('utf-8');
  assert.doesNotMatch(heroFragment, /^object /m);
  assert.match(heroFragment, /^when start do$/m);
  assert.match(heroFragment, /^ {2}wait 1$/m); // when 본문은 한 단 들여쓴다
});

test('장면이 여러 개면 objects/장면이름/이름.tess 로 장면마다 폴더를 나눈다', () => {
  const project = minimalProject(2);
  const result = decompileProject(project, []);

  assert.match(result.source, /useobject "objects\/장면_1\/주인공\.tess"/);
  assert.match(result.source, /usetext "objects\/장면_2\/점수판\.tess"/);

  const fragmentPaths = result.assets.map((a) => a.path).sort();
  assert.deepEqual(fragmentPaths, ['objects/장면_1/주인공.tess', 'objects/장면_2/점수판.tess']);
});

test('되돌린 결과(main.tess + 조각 파일)는 다시 정상적으로 컴파일된다', () => {
  const project = minimalProject(1);
  const result = decompileProject(project, []);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tess-decompile-'));
  const mainFile = path.join(dir, 'main.tess');
  fs.writeFileSync(mainFile, result.source);
  for (const asset of result.assets) {
    const target = path.join(dir, asset.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, asset.data);
  }

  const recompiled = compileProject(fs.readFileSync(mainFile, 'utf-8'), { path: mainFile, assetDirs: [dir] });
  assert.deepEqual(recompiled.errors, [], recompiled.errors.map((e) => e.message).join('\n'));
  assert.equal(recompiled.project.objects.length, 2);
  assert.deepEqual(
    recompiled.project.objects.map((o) => o.objectType).sort(),
    ['sprite', 'textBox'],
  );
});

// ---------------------------------------------------------------------------
//  엔트리 사용자들의 "모양/소리 id 를 문자열로 직접 박아 넣기" 트릭 되돌리기
//
//  엔트리는 "OO 모양으로 바꾸기"/"소리 OO 재생하기" 값을 1) id 2) 이름 3) 등록
//  순번 순으로 찾기 때문에, 값 칸에 그 모양·소리의 진짜 엔트리 id 를 문자열로
//  직접 적어 넣어도(목록에서 고르지 않고) 실제로 그 모양·소리로 바뀐다 — 실제
//  프로젝트에서 흔히 보이는 형태다. 이 id 를 그대로 옮기면, 되돌린 소스를 다시
//  컴파일할 때 모든 id 가 새로 배정되면서(결정적이지만 원본과 다른 id) 더 이상
//  아무 것도 가리키지 않게 되어 깨진다 — 그래서 진짜 id 와 맞는지 먼저 확인해서
//  이름으로 옮겨야 한다.
// ---------------------------------------------------------------------------
function trickProject() {
  const startHat = () => ({ type: 'when_run_button_click', params: [null], statements: [] });
  const literal = (value) => ({ type: 'text', params: [value] });

  return {
    name: '트릭 테스트',
    speed: 60,
    scenes: [{ id: 'scene1', name: '장면 1' }],
    variables: [],
    messages: [],
    functions: [],
    aiUtilizeBlocks: [],
    objects: [{
      id: 'obj1',
      name: '주인공',
      objectType: 'sprite',
      scene: 'scene1',
      rotateMethod: 'free',
      selectedPictureId: 'pic1',
      entity: { x: 0, y: 0, scaleX: 1, scaleY: 1, visible: true },
      sprite: {
        pictures: [
          { id: 'pic1', name: '기본', fileurl: null, dimension: { width: 10, height: 10 } },
          { id: '0cdd', name: '점프', fileurl: null, dimension: { width: 10, height: 10 } },
        ],
        sounds: [
          { id: 'snd1', name: '점프음', fileurl: null, ext: '.mp3', duration: 1 },
          { id: 'xk9q', name: '효과음', fileurl: null, ext: '.mp3', duration: 1 },
        ],
      },
      script: JSON.stringify([[
        startHat(),
        // 트릭: 목록에서 고른 게 아니라(get_pictures/get_sounds 블록이 아니라)
        // 리터럴 문자열로 진짜 엔트리 id 를 직접 박아 넣었다.
        { type: 'sound_something_with_block', params: [literal('xk9q'), null], statements: [] },
        { type: 'change_to_some_shape', params: [literal('0cdd'), null], statements: [] },
        // 숫자를 직접 적어 넣는 건 "n번째 모양으로 바꾸기" 이지, id 트릭이 아니다.
        { type: 'change_to_some_shape', params: [{ type: 'number', params: ['2'] }, null], statements: [] },
      ]]),
    }],
  };
}

test('모양/소리 값에 진짜 엔트리 id 를 그대로 박아 넣은 트릭은 이름으로 되돌린다', () => {
  const result = decompileProject(trickProject(), []);
  const fragment = result.assets.find((a) => a.path === 'objects/주인공.tess').data.toString('utf-8');

  assert.match(fragment, /^ {2}play sound "효과음"$/m);
  assert.match(fragment, /^ {2}costume = "점프"$/m);
  // "n번째 모양으로 바꾸기" 는 리터럴 id 와 안 겹치니 그냥 숫자로 남는다
  assert.match(fragment, /^ {2}costume = 2$/m);
  assert.doesNotMatch(fragment, /xk9q/);
  assert.doesNotMatch(fragment, /0cdd/);
});

test('되돌린 트릭 코드도 다시 정상적으로 컴파일된다', () => {
  const result = decompileProject(trickProject(), []);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tess-decompile-trick-'));
  const mainFile = path.join(dir, 'main.tess');
  fs.writeFileSync(mainFile, result.source);
  for (const asset of result.assets) {
    const target = path.join(dir, asset.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, asset.data);
  }

  const recompiled = compileProject(fs.readFileSync(mainFile, 'utf-8'), { path: mainFile, assetDirs: [dir] });
  assert.deepEqual(recompiled.errors, [], recompiled.errors.map((e) => e.message).join('\n'));
});

// ---------------------------------------------------------------------------
//  "n번째 모양으로 바꾸기" 의 순번이 문자열로 들어 있는 경우
//
//  엔트리는 모양·소리 값 칸을 문자열로 읽어서 1) id 2) 이름 3) 순번 순으로 찾는다
//  (entryjs Entry.Object#getPicture). 그래서 순번이 number 블록이 아니라 text
//  블록이나 맨 문자열로 들어 있는 작품이 흔하다 — 실제로 문자열 형태를 그대로
//  `costume = "1"` 로 옮기면 '1' 이라는 이름의 모양이 없어서 다시 컴파일할 때
//  에러가 났다. 순번은 어느 형태로 들어 있든 숫자로 되돌아와야 한다.
// ---------------------------------------------------------------------------
// 엔트리는 같은 순번을 문자열로도 숫자로도 담아 둔다 — text 블록 안이라도 그렇다.
const NUMBER_VALUES = [
  ['number 블록', (value) => ({ type: 'number', params: [value] })],
  ['text 블록', (value) => ({ type: 'text', params: [value] })],
  ['text 블록 · 숫자', (value) => ({ type: 'text', params: [Number(value)] })],
  ['number 블록 · 숫자', (value) => ({ type: 'number', params: [Number(value)] })],
  ['맨 문자열', (value) => value],
  ['맨 숫자', (value) => Number(value)],
];

function nthResourceProject(numberValue) {
  const startHat = () => ({ type: 'when_run_button_click', params: [null], statements: [] });

  return {
    name: '순번 테스트',
    speed: 60,
    scenes: [{ id: 'scene1', name: '장면 1' }],
    variables: [],
    messages: [],
    functions: [],
    aiUtilizeBlocks: [],
    objects: [{
      id: 'obj1',
      name: '주인공',
      objectType: 'sprite',
      scene: 'scene1',
      rotateMethod: 'free',
      selectedPictureId: 'pic1',
      entity: { x: 0, y: 0, scaleX: 1, scaleY: 1, visible: true },
      sprite: {
        pictures: [
          { id: 'pic1', name: '기본', fileurl: null, dimension: { width: 10, height: 10 } },
          { id: 'pic2', name: '점프', fileurl: null, dimension: { width: 10, height: 10 } },
        ],
        sounds: [{ id: 'snd1', name: '점프음', fileurl: null, ext: '.mp3', duration: 1 }],
      },
      script: JSON.stringify([[
        startHat(),
        { type: 'change_to_some_shape', params: [numberValue('1'), null], statements: [] },
        { type: 'sound_something_with_block', params: [numberValue('1'), null], statements: [] },
      ]]),
    }],
  };
}

for (const [label, numberValue] of NUMBER_VALUES) {
  test(`모양·소리 순번(${label})은 문자열이 아니라 숫자로 되돌아온다`, () => {
    const result = decompileProject(nthResourceProject(numberValue), []);
    const fragment = result.assets.find((a) => a.path === 'objects/주인공.tess').data.toString('utf-8');

    assert.match(fragment, /^ {2}costume = 1$/m);
    assert.match(fragment, /^ {2}play sound 1$/m);
    assert.doesNotMatch(fragment, /costume = "1"/);
    assert.doesNotMatch(fragment, /play sound "1"/);
  });

  test(`순번(${label})으로 되돌린 코드도 다시 정상적으로 컴파일된다`, () => {
    const result = decompileProject(nthResourceProject(numberValue), []);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tess-decompile-nth-'));
    const mainFile = path.join(dir, 'main.tess');
    fs.writeFileSync(mainFile, result.source);
    for (const asset of result.assets) {
      const target = path.join(dir, asset.path);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, asset.data);
    }

    const recompiled = compileProject(fs.readFileSync(mainFile, 'utf-8'), { path: mainFile, assetDirs: [dir] });
    assert.deepEqual(recompiled.errors, [], recompiled.errors.map((e) => e.message).join('\n'));

    const thread = JSON.parse(recompiled.project.objects[0].script)[0];
    const shape = thread.find((b) => b.type === 'change_to_some_shape');
    assert.equal(shape.params[0].type, 'number');
    assert.deepEqual(shape.params[0].params, ['1']);
  });
}

// 다시 적으면 글자가 달라지는 숫자는 이름으로 찾을 때 어긋날 수 있어서 문자열로 둔다.
test('"01" 처럼 다시 적으면 달라지는 값은 숫자로 바꾸지 않는다', () => {
  const result = decompileProject(nthResourceProject(() => ({ type: 'text', params: ['01'] })), []);
  const fragment = result.assets.find((a) => a.path === 'objects/주인공.tess').data.toString('utf-8');

  assert.match(fragment, /^ {2}costume = "01"$/m);
});

// ---------------------------------------------------------------------------
//  coordinate_object 의 "모양 번호"(picture_index)/"모양 이름"(picture_name) —
//  x/y/방향/이동방향/크기 옆에 있는 드롭다운 값인데, 예전엔 이 둘이 빠져 있어서
//  costume/costume_number 를 쓴 스크립트가 `??("coordinate_object", ...)`
//  자리표시자로 깨져 나왔다.
// ---------------------------------------------------------------------------
test('coordinate_object 의 모양 번호·모양 이름도 자리표시자 없이 되돌아온다', () => {
  const source = `
scene "s":
  object "다른":
    default costume 기본 "a.png" size 1 1
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
  const compiled = compileProject(source, { path: 'x.tess' });
  assert.deepEqual(compiled.errors, []);

  const decompiled = decompileProject(compiled.project, []);
  assert.deepEqual(decompiled.warnings, []);

  const fragment = decompiled.assets.find((a) => a.path === 'objects/o.tess').data.toString('utf-8');
  assert.doesNotMatch(fragment, /\[decompile/);
  assert.match(fragment, /^ {2}이름 = costume\("다른"\)$/m);
  assert.match(fragment, /^ {2}번호 = costume_number\("다른"\)$/m);
  assert.match(fragment, /^ {2}내이름 = costume$/m);
  assert.match(fragment, /^ {2}내번호 = costume_number$/m);
});

// ---------------------------------------------------------------------------
//  "함수 안에 특정 오브젝트의 모양 id 를 하드코딩" 관습(SPEC-ADDENDUM.md 1.4절) 되돌리기
//
//  함수는 엔트리에서 전역이라 여러 오브젝트가 같이 부를 수 있는데도, 많은 실제 작품이
//  "개인 함수"를 흉내 내려고 그 함수 안에 특정 오브젝트 하나의 모양 id 를 문자열로
//  그대로 박아 넣어 왔다. 이 id 를 이름으로 되짚어 버리면(오브젝트 스크립트에서는
//  안전하지만) 함수 안에서는 그 이름이 정말 그 함수를 부르는 오브젝트에도 있다는
//  보장이 없어 다시 컴파일했을 때 깨질 수 있다 — 그래서 함수 안에서는 id 를 그대로
//  두고, 그 모양 선언에 `force id` 를 붙여 다시 컴파일해도 정확히 같은 id 가 나오게
//  만든다.
// ---------------------------------------------------------------------------
// 모양 자리에 id 가 들어가는 두 가지 모습 — 손으로 박아 넣은 문자열(text 블록)과,
// 편집기 드롭다운으로 고른 get_pictures 블록. 함수 안에서는 둘 다 똑같이 다뤄야 한다.
const SHAPE_VALUES = [
  ['손으로 박아 넣은 id', (value) => ({ type: 'text', params: [value] })],
  ['드롭다운으로 고른 모양', (value) => ({ type: 'get_pictures', params: [value] })],
];

function hardcodedFunctionProject(shapeValue) {
  const startHat = () => ({ type: 'when_run_button_click', params: [null], statements: [] });

  return {
    name: '하드코딩 함수 테스트',
    speed: 60,
    scenes: [{ id: 'scene1', name: '장면 1' }],
    variables: [],
    messages: [],
    aiUtilizeBlocks: [],
    objects: [{
      id: 'obj1',
      name: '주인공',
      objectType: 'sprite',
      scene: 'scene1',
      rotateMethod: 'free',
      selectedPictureId: 'pic1',
      entity: { x: 0, y: 0, scaleX: 1, scaleY: 1, visible: true },
      sprite: {
        pictures: [
          { id: 'pic1', name: '기본', fileurl: null, dimension: { width: 10, height: 10 } },
          { id: 'qio1', name: '점프', fileurl: null, dimension: { width: 10, height: 10 } },
        ],
        sounds: [],
      },
      script: JSON.stringify([[startHat(), { type: 'func_fn1', params: [null], statements: [] }]]),
    }],
    functions: [{
      id: 'fn1',
      content: JSON.stringify([[{
        type: 'function_create',
        params: [{ type: 'function_field_label', params: ['점프하기', null] }],
        statements: [[
          // "점프" 모양 이름이 아니라, 그 모양의 진짜 엔트리 id 를 가리킨다.
          { type: 'change_to_some_shape', params: [shapeValue('qio1'), null], statements: [] },
        ]],
      }]]),
    }],
  };
}

for (const [label, shapeValue] of SHAPE_VALUES) {
  test(`함수 안 모양 id(${label})는 이름으로 안 바꾸고, 그 모양 선언에 force id 를 붙인다`, () => {
    const result = decompileProject(hardcodedFunctionProject(shapeValue), []);
    assert.deepEqual(result.warnings, []);

    assert.match(result.source, /^function 점프하기\(\):$/m);
    assert.match(result.source, /^ {2}costume = "qio1"$/m); // 함수 안에서는 이름으로 안 바뀐다

    const fragment = result.assets.find((a) => a.path === 'objects/주인공.tess').data.toString('utf-8');
    assert.match(fragment, /^costume 점프 "점프\.png" size 10 10 force id "qio1"$/m);
  });

  test(`되돌린 함수 코드(${label})도 다시 정상적으로 컴파일되고, id 가 그대로 고정된다`, () => {
    const result = decompileProject(hardcodedFunctionProject(shapeValue), []);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tess-decompile-forceid-'));
    const mainFile = path.join(dir, 'main.tess');
    fs.writeFileSync(mainFile, result.source);
    for (const asset of result.assets) {
      const target = path.join(dir, asset.path);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, asset.data);
    }

    const recompiled = compileProject(fs.readFileSync(mainFile, 'utf-8'), { path: mainFile, assetDirs: [dir] });
    assert.deepEqual(recompiled.errors, [], recompiled.errors.map((e) => e.message).join('\n'));

    const picture = recompiled.project.objects[0].sprite.pictures.find((p) => p.name === '점프');
    assert.equal(picture.id, 'qio1');

    const fn = recompiled.project.functions[0];
    const block = JSON.parse(fn.content)[0][0].statements[0][0];
    assert.equal(block.type, 'change_to_some_shape');
    assert.equal(block.params[0], 'qio1'); // 함수를 누가 부르든 정확히 그 모양을 가리킨다
  });
}

// ---------------------------------------------------------------------------
//  엔트리 기본 오브젝트(걷는 엔트리봇)의 모양·소리
//
//  기본 오브젝트의 리소스는 작품 파일(.ent) 안에 안 들어 있고, project.json 이 엔트리
//  실행기 번들 안의 파일을 `./bower_components/entry-js/images/media/...` 로 가리킬
//  뿐이다. 이 경로를 소스에 그대로 옮겨 두면 그런 파일이 없어서 다시 컴파일한 작품에는
//  모양이 통째로 비어 버린다 — 설치된 entryjs 에서 진짜 파일을 꺼내 와야 한다.
// ---------------------------------------------------------------------------
function builtinObjectProject() {
  const media = (file) => `./bower_components/entry-js/images/media/${file}`;
  return {
    name: '엔트리봇 테스트',
    speed: 60,
    scenes: [{ id: 'scene1', name: '장면 1' }],
    variables: [],
    messages: [],
    aiUtilizeBlocks: [],
    functions: [],
    objects: [{
      id: 'obj1',
      name: '엔트리봇',
      objectType: 'sprite',
      scene: 'scene1',
      rotateMethod: 'free',
      selectedPictureId: 'vx80',
      entity: { x: 0, y: 0, scaleX: 1, scaleY: 1, visible: true },
      sprite: {
        pictures: [
          { id: 'vx80', name: '엔트리봇_걷기1', imageType: 'svg', fileurl: media('entrybot1.svg'), dimension: { width: 144, height: 246 } },
          { id: '4t48', name: '엔트리봇_걷기2', imageType: 'svg', fileurl: media('entrybot2.svg'), dimension: { width: 144, height: 246 } },
        ],
        sounds: [{ id: '8el5', name: '강아지 짖는 소리', ext: '.mp3', duration: 1.3, fileurl: media('bark.mp3') }],
      },
      script: JSON.stringify([[]]),
    }],
  };
}

test('엔트리 기본 오브젝트의 모양·소리는 entryjs 에서 꺼내 와 assets/ 에 담는다', () => {
  const result = decompileProject(builtinObjectProject(), []);
  const fragment = result.assets.find((a) => a.path === 'objects/엔트리봇.tess').data.toString('utf-8');

  // bower_components 경로가 소스에 새어 나오면 안 된다 — 그런 파일은 어디에도 없다
  assert.doesNotMatch(fragment, /bower_components/);
  // 파일을 실제로 담았으니 크기·길이는 적지 않는다 — 컴파일러가 그림을 열어 재고,
  // 사람이 그림을 바꿔 넣을 때 숫자까지 같이 고치지 않아도 된다.
  assert.match(fragment, /^default costume 엔트리봇_걷기1 "assets\/image\/엔트리봇_엔트리봇_걷기1\.svg"$/m);
  assert.match(fragment, /^costume 엔트리봇_걷기2 "assets\/image\/엔트리봇_엔트리봇_걷기2\.svg"$/m);
  assert.match(fragment, /^sound 강아지_짖는_소리 "assets\/sound\/엔트리봇_강아지_짖는_소리\.mp3"$/m);

  for (const relative of ['assets/image/엔트리봇_엔트리봇_걷기1.svg', 'assets/image/엔트리봇_엔트리봇_걷기2.svg', 'assets/sound/엔트리봇_강아지_짖는_소리.mp3']) {
    const asset = result.assets.find((a) => a.path === relative);
    assert.ok(asset && asset.data.length > 0, `${relative} 의 실제 파일이 담겨 있어야 한다`);
  }
  assert.match(result.assets.find((a) => a.path === 'assets/image/엔트리봇_엔트리봇_걷기1.svg').data.toString('utf-8'), /<svg/);
});

test('되돌린 기본 오브젝트를 다시 컴파일하면 그림 파일에서 잰 원본 크기가 나온다', () => {
  const result = decompileProject(builtinObjectProject(), []);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tess-decompile-builtin-'));
  const mainFile = path.join(dir, 'main.tess');
  fs.writeFileSync(mainFile, result.source);
  for (const asset of result.assets) {
    const target = path.join(dir, asset.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, asset.data);
  }

  const recompiled = compileProject(fs.readFileSync(mainFile, 'utf-8'), { path: mainFile, assetDirs: [dir] });
  assert.deepEqual(recompiled.errors, [], recompiled.errors.map((e) => e.message).join('\n'));

  const sprite = recompiled.project.objects[0].sprite;
  // 엔트리는 렌더링 크기를 dimension 값 그대로 믿는다 — 파일을 못 찾아 100x100 으로
  // 뭉개지면 안 된다. entrybot1/2.svg 의 viewBox 가 그대로 잡혀야 한다.
  assert.deepEqual(sprite.pictures[0].dimension, { width: 144, height: 246 });
  assert.deepEqual(sprite.pictures[1].dimension, { width: 144, height: 246 });
  // 그림 파일이 진짜로 작품에 딸려 나가야 한다(bower_components 경로일 땐 하나도 없었다)
  assert.equal(recompiled.assets.length, 3);
});

test('모양 없이 만든 "새 오브젝트"의 _1x1.png 도 꺼내 오고, 선언된 크기를 그대로 지킨다', () => {
  // 엔트리는 그림을 실제로 재 보지 않고 project.json 의 dimension 을 그대로 믿는다 —
  // 1×1 픽셀짜리 _1x1.png 를 960×540 으로 쓰는 이 오브젝트가 딱 그 경우다. 되돌린
  // 소스에서 `size` 를 빼면 다시 컴파일할 때 1×1 로 뭉개져 화면에서 사라진다.
  // (bower_components 밑 폴더 이름은 엔트리 버전에 따라 entry-js 이기도 entryjs 이기도 하다.)
  const project = builtinObjectProject();
  project.objects[0].name = '새 오브젝트';
  project.objects[0].sprite.pictures = [{
    id: 'p1x1',
    name: '새그림',
    imageType: 'png',
    fileurl: './bower_components/entryjs/images/_1x1.png',
    dimension: { width: 960, height: 540 },
  }];
  project.objects[0].sprite.sounds = [];
  project.objects[0].selectedPictureId = 'p1x1';

  const result = decompileProject(project, []);
  const fragment = result.assets.find((a) => a.path === 'objects/새_오브젝트.tess').data.toString('utf-8');
  assert.doesNotMatch(fragment, /bower_components/);
  assert.match(fragment, /^default costume 새그림 "assets\/image\/새_오브젝트_새그림\.png" size 960 540$/m);
  assert.ok(result.assets.find((a) => a.path === 'assets/image/새_오브젝트_새그림.png')?.data.length > 0);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tess-decompile-1x1-'));
  fs.writeFileSync(path.join(dir, 'main.tess'), result.source);
  for (const asset of result.assets) {
    const target = path.join(dir, asset.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, asset.data);
  }
  const recompiled = compileProject(result.source, { path: path.join(dir, 'main.tess'), assetDirs: [dir] });
  assert.deepEqual(recompiled.errors, [], recompiled.errors.map((e) => e.message).join('\n'));
  assert.deepEqual(recompiled.project.objects[0].sprite.pictures[0].dimension, { width: 960, height: 540 });
});

// ---------------------------------------------------------------------------
//  함수 머리 — 라벨이 중간에 끼거나 판단 매개변수가 있는 경우 (SPEC-ADDENDUM.md 4.6)
//
//  엔트리 함수 머리는 라벨과 매개변수 칸이 번갈아 나올 수 있는 사슬인데, 예전에는
//  맨 앞 라벨 뒤의 function_field_string 만 세다가 라벨이나 판단 칸을 만나면 거기서
//  멈춰 버렸다 — 그 뒤 매개변수를 통째로 잃고, 본문에서 그 매개변수를 가리키는
//  블록은 전부 '# [decompile]' 자리표시자가 됐다.
// ---------------------------------------------------------------------------
const fieldLabel = (text, next) => ({ type: 'function_field_label', params: [text, next] });
const fieldString = (id, next) => ({
  type: 'function_field_string', params: [{ type: `stringParam_${id}`, params: [] }, next],
});
const fieldBoolean = (id, next) => ({
  type: 'function_field_boolean', params: [{ type: `booleanParam_${id}`, params: [null] }, next],
});

/** 머리 사슬 하나짜리 프로젝트. body 는 함수 본문 블록들 */
function functionHeadProject(field, body = []) {
  return {
    name: '함수 머리 테스트',
    speed: 60,
    scenes: [{ id: 'scene1', name: '장면 1' }],
    variables: [],
    messages: [],
    aiUtilizeBlocks: [],
    objects: [],
    functions: [{
      id: 'fn1',
      content: JSON.stringify([[{ type: 'function_create', params: [field, null], statements: [body] }]]),
    }],
  };
}

const declarationOf = (field, body) => decompileProject(functionHeadProject(field, body), [])
  .source.match(/^function .*/m)[0];

test('함수 머리의 라벨·판단 칸을 지나서 매개변수를 끝까지 읽는다', () => {
  // 라벨-인수-인수: 맨 앞 라벨만 함수 이름, 인수는 자동 이름
  assert.equal(declarationOf(fieldLabel('스폰', fieldString('p1', fieldString('p2', null)))),
    'function 스폰(a, b):');

  // 라벨-인수-라벨-인수: 중간 라벨은 바로 뒤 인수의 이름이 된다
  assert.equal(declarationOf(fieldLabel('스폰', fieldString('p1', fieldLabel('체력', fieldString('p2', null))))),
    'function 스폰(a, 체력):');

  // 라벨-인수-라벨: 뒤에 인수가 없는 라벨은 담을 자리가 없다
  assert.equal(declarationOf(fieldLabel('스폰', fieldString('p1', fieldLabel('체력', null)))),
    'function 스폰(a):');

  // 판단 칸도 매개변수다 — 여기서 멈추면 뒤가 통째로 사라졌다
  // 판단 칸은 `이름?` 으로 적어서 다시 컴파일해도 판단 칸으로 남는다
  assert.equal(
    declarationOf(fieldLabel('스폰', fieldBoolean('b1', fieldString('p2', fieldLabel('이름', fieldString('p3', null)))))),
    'function 스폰(a?, b, 이름):',
  );
});

test('자동 이름은 z 를 넘으면 a1, a2 로 이어진다', () => {
  const field = fieldLabel('많이', Array.from({ length: 28 })
    .reduceRight((next, _, i) => fieldString(`p${i}`, next), null));
  assert.match(declarationOf(field), /, x, y, z, a1, a2\):$/);
});

test('함수 본문의 매개변수 블록은 이름으로 되짚는다', () => {
  const field = fieldLabel('스폰', fieldString('p1', fieldLabel('체력', fieldBoolean('b1', null))));
  const body = [{
    type: 'dialog',
    params: [{ type: 'stringParam_p1', params: [] }, 'speak'],
    statements: [],
  }, {
    type: '_if',
    params: [{ type: 'booleanParam_b1', params: [null] }],
    statements: [[]],
  }];
  const result = decompileProject(functionHeadProject(field, body), []);
  assert.deepEqual(result.warnings, []); // 자리표시자가 하나도 남으면 안 된다
  assert.match(result.source, /^ {2}say a$/m);
  assert.match(result.source, /^ {2}if 체력:$/m);
});

test('되돌린 함수 머리는 다시 컴파일하면 원래 사슬로 돌아간다', () => {
  const field = fieldLabel('스폰', fieldString('p1', fieldLabel('체력', fieldString('p2', null))));
  const body = [{ type: 'dialog', params: [{ type: 'stringParam_p2', params: [] }, 'speak'], statements: [] }];
  const result = decompileProject(functionHeadProject(field, body), []);

  const recompiled = compileProject(result.source, { path: 'main.tess' });
  assert.deepEqual(recompiled.errors, [], recompiled.errors.map((e) => e.message).join('\n'));

  const chain = [];
  let node = JSON.parse(recompiled.project.functions[0].content)[0][0].params[0];
  while (node && typeof node === 'object') {
    chain.push(node.type === 'function_field_label' ? `label:${node.params[0]}` : 'param');
    node = node.params[1];
  }
  assert.deepEqual(chain, ['label:스폰', 'param', 'label:체력', 'param']);
});

test('참/거짓 블록과 (<판단>의 값) 껍데기를 벗겨서 옮긴다', () => {
  const field = fieldLabel('스폰', fieldString('p1', null));
  const body = [{
    type: 'dialog',
    params: [{ type: 'get_boolean_value', params: [{ type: 'True', params: [null] }] }, 'speak'],
    statements: [],
  }];
  const result = decompileProject(functionHeadProject(field, body), []);
  assert.deepEqual(result.warnings, []);
  assert.match(result.source, /^ {2}say true$/m);
});

test('when 본문은 한 단 들여쓰고, 선언 뭉치 뒤에는 두 줄을 띄운다', () => {
  // 조각 파일에서는 when 헤더가 0단이라, 예전 들여쓰기 계산(헤더와 같은 단)은
  // 본문을 아예 안 들여썼다 — 되돌린 소스가 사람이 짠 것처럼 보이지 않았다.
  const result = decompileProject(minimalProject(1), []);
  const fragment = result.assets.find((a) => a.path === 'objects/주인공.tess').data.toString('utf-8');
  assert.equal(fragment, 'x = 10\n\n\nwhen start do\n  wait 1\nend\n');
});

test('파일을 담은 모양·소리는 크기·길이를 적지 않고, 1×1 빈 그림만 예외다', () => {
  // 크기를 늘 적어 두면 그림을 바꿔 넣을 때마다 사람이 숫자까지 고쳐야 한다 —
  // 컴파일러가 파일을 열어 재 주므로 적지 않는 게 기본이다. 다만 "모양 없이 만든
  // 새 오브젝트"의 _1x1.png 는 파일에서 잰 1×1 이 진짜 크기가 아니라 예외다.
  const project = builtinObjectProject();
  project.objects[0].sprite.pictures.push({
    id: 'p1x1',
    name: '새그림',
    imageType: 'png',
    fileurl: './bower_components/entryjs/images/_1x1.png',
    dimension: { width: 960, height: 540 },
  });

  const result = decompileProject(project, []);
  const fragment = result.assets.find((a) => a.path === 'objects/엔트리봇.tess').data.toString('utf-8');
  assert.match(fragment, /^default costume 엔트리봇_걷기1 "assets\/image\/엔트리봇_엔트리봇_걷기1\.svg"$/m);
  assert.match(fragment, /^sound 강아지_짖는_소리 "assets\/sound\/엔트리봇_강아지_짖는_소리\.mp3"$/m);
  assert.match(fragment, /^costume 새그림 "assets\/image\/엔트리봇_새그림\.png" size 960 540$/m);
});

test('판단 매개변수는 이름? 로 되돌아오고, 다시 컴파일해도 판단 칸이다', () => {
  const field = fieldLabel('스폰', fieldString('p1', fieldLabel('살았나', fieldBoolean('b1', null))));
  const body = [{ type: '_if', params: [{ type: 'booleanParam_b1', params: [null] }], statements: [[]] }];
  const result = decompileProject(functionHeadProject(field, body), []);
  assert.match(result.source, /^function 스폰\(a, 살았나\?\):$/m);
  assert.match(result.source, /^ {2}if 살았나:$/m); // 본문에서는 ? 없이 쓴다

  const recompiled = compileProject(result.source, { path: 'main.tess' });
  assert.deepEqual(recompiled.errors, [], recompiled.errors.map((e) => e.message).join('\n'));
  const chain = [];
  let node = JSON.parse(recompiled.project.functions[0].content)[0][0].params[0];
  while (node && typeof node === 'object') {
    chain.push(node.type === 'function_field_label' ? `label:${node.params[0]}` : node.type);
    node = node.params[1];
  }
  assert.deepEqual(chain,
    ['label:스폰', 'function_field_string', 'label:살았나', 'function_field_boolean']);
});

// ---------------------------------------------------------------------------
//  리소스 파일 이름 겹침 막기
//
//  모양·소리 이름은 오브젝트마다 따로 붙는다. 엔트리가 자동으로 붙여 주는 "새그림"
//  같은 이름은 여러 오브젝트에 그대로 남아 있기 마련이라, 그 이름을 그대로 파일
//  이름으로 쓰면 나중에 저장한 파일이 앞의 파일을 덮어써서 모양 하나만 남는다.
// ---------------------------------------------------------------------------
function samePictureNameProject(sceneCount = 1) {
  const scenes = sceneCount === 1
    ? [{ id: 'scene1', name: '장면 1' }]
    : [{ id: 'scene1', name: '장면 1' }, { id: 'scene2', name: '장면 2' }];

  const object = (id, name, sceneId, fileurl) => ({
    id,
    name,
    objectType: 'sprite',
    scene: sceneId,
    rotateMethod: 'free',
    selectedPictureId: `${id}_pic`,
    entity: { x: 0, y: 0, scaleX: 1, scaleY: 1, visible: true },
    sprite: {
      // 두 오브젝트가 똑같이 "새그림" 이라는 이름을 쓰지만 파일은 서로 다르다
      pictures: [{ id: `${id}_pic`, name: '새그림', imageType: 'png', fileurl, dimension: { width: 4, height: 4 } }],
      sounds: [{ id: `${id}_snd`, name: '소리', ext: '.mp3', duration: 1, fileurl: `${fileurl}.mp3` }],
    },
    script: JSON.stringify([[]]),
  });

  return {
    name: '이름 겹침 테스트',
    speed: 60,
    scenes,
    variables: [],
    messages: [],
    functions: [],
    aiUtilizeBlocks: [],
    objects: [
      object('obj1', '치로', 'scene1', 'temp/aa/bb/image/aaa.png'),
      object('obj2', '엔트리봇', sceneCount === 1 ? 'scene1' : 'scene2', 'temp/cc/dd/image/ccc.png'),
    ],
  };
}

/** project.json 이 가리키는 fileurl 마다 내용이 다른 가짜 tar 항목 */
const fakeEntries = (project) => (project.objects ?? []).flatMap((object) => [
  ...(object.sprite.pictures ?? []).map((p) => ({ name: p.fileurl, data: Buffer.from(object.name + ' 그림') })),
  ...(object.sprite.sounds ?? []).map((s) => ({ name: s.fileurl, data: Buffer.from(object.name + ' 소리') })),
]);

test('모양 이름이 겹쳐도 오브젝트 이름을 붙여서 파일이 안 덮인다', () => {
  const project = samePictureNameProject(1);
  const result = decompileProject(project, fakeEntries(project));

  const images = result.assets.filter((a) => a.path.startsWith('assets/image/')).map((a) => a.path);
  assert.deepEqual(images.sort(), ['assets/image/엔트리봇_새그림.png', 'assets/image/치로_새그림.png']);

  // 두 파일의 내용이 실제로 서로 달라야 한다 (하나가 다른 하나를 덮어쓰지 않았다)
  const contents = result.assets
    .filter((a) => a.path.startsWith('assets/image/'))
    .map((a) => a.data.toString('utf-8'));
  assert.equal(new Set(contents).size, 2);

  // 각 오브젝트 조각 파일도 자기 파일을 가리켜야 한다
  const chiro = result.assets.find((a) => a.path === 'objects/치로.tess').data.toString('utf-8');
  assert.match(chiro, /"assets\/image\/치로_새그림\.png"/);
});

test('장면이 여러 개면 리소스도 장면별 폴더로 나눈다', () => {
  const project = samePictureNameProject(2);
  const result = decompileProject(project, fakeEntries(project));

  const paths = result.assets.map((a) => a.path).filter((p) => p.startsWith('assets/'));
  assert.deepEqual(paths.sort(), [
    'assets/image/장면_1/치로_새그림.png',
    'assets/image/장면_2/엔트리봇_새그림.png',
    'assets/sound/장면_1/치로_소리.mp3',
    'assets/sound/장면_2/엔트리봇_소리.mp3',
  ]);
});

test('여러 모양이 같은 파일을 쓰면 한 번만 저장한다', () => {
  const project = samePictureNameProject(1);
  // 두 오브젝트가 똑같은 파일을 가리키게 바꾼다
  project.objects[1].sprite.pictures[0].fileurl = project.objects[0].sprite.pictures[0].fileurl;
  const result = decompileProject(project, fakeEntries(project));

  const images = result.assets.filter((a) => a.path.startsWith('assets/image/'));
  assert.equal(images.length, 1);
  // 두 조각 파일 모두 그 하나를 가리킨다
  for (const name of ['치로', '엔트리봇']) {
    const fragment = result.assets.find((a) => a.path === `objects/${name}.tess`).data.toString('utf-8');
    assert.match(fragment, new RegExp(images[0].path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('경로가 그래도 겹치면 뒤에 번호를 붙인다', () => {
  // 오브젝트 이름은 겹치지 않게 정리되지만, 마지막 안전장치가 실제로 도는지 확인한다.
  const project = samePictureNameProject(1);
  project.objects[1].name = '치로'; // 같은 이름 -> safeIdentifier 가 치로_2 로 바꾼다
  const result = decompileProject(project, fakeEntries(project));

  const images = result.assets.filter((a) => a.path.startsWith('assets/image/')).map((a) => a.path);
  assert.equal(images.length, 2);
  assert.equal(new Set(images).size, 2, images.join(', '));
});
