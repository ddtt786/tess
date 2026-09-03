/**
 * 디컴파일(.ent -> Tess) 과정에서 use, useobject, usetext 예약어의 기본 동작을 검사합니다.
 * 
 * 오브젝트당 하나의 조각 파일(objects/이름.tess)을 생성하고, main.tess에는
 * useobject/usetext 참조 구문만 남도록 구성되는지 확인합니다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { decompileProject } from '@tess/decompiler';
import { compileProject } from '@tess/compiler';
import type { RawEntity } from '@tess/decompiler';

/**
 * 최소한의 스크립트와 스프라이트 하나를 포함하는 project.json 데이터를 생성합니다.
 * 
 * @param sceneCount 생성할 장면(Scene)의 개수
 * @returns 생성된 기본 프로젝트 엔티티 데이터
 */
function minimalProject(sceneCount = 1): RawEntity {
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
  const heroFragment = result.assets.find((a) => a.path === 'objects/주인공.tess')!.data.toString('utf-8');
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
  assert.equal(recompiled.project!.objects.length, 2);
  assert.deepEqual(
    recompiled.project!.objects.map((o) => o.objectType).sort(),
    ['sprite', 'textBox'],
  );
});

/**
 * 모양/소리 ID의 명시적 하드코딩 패턴 복원 테스트
 * 
 * 원본 프로젝트에서 모양이나 소리 참조 시 고유 ID 문자열을 직접 사용한 경우, 
 * 디컴파일 시 재컴파일 후에도 올바른 리소스를 가리킬 수 있도록 이름 기반 참조로 변환되는지 검증합니다.
 */
function trickProject() {
  const startHat = () => ({ type: 'when_run_button_click', params: [null], statements: [] });
  const literal = (value: any) => ({ type: 'text', params: [value] });

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
  const fragment = result.assets.find((a) => a.path === 'objects/주인공.tess')!.data.toString('utf-8');

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

/**
 * n번째 리소스 참조 인덱스의 타입 복원 테스트
 * 
 * 엔트리 시스템 내부에서 리소스 참조 시 혼용될 수 있는 순번(인덱스) 값들의 다양한 형태입니다.
 * 존재하더라도, 
 * 디컴파일 시 일관되게 숫자 타입으로 변환되는지 검증합니다.
 */
const NUMBER_VALUES = [
  ['number 블록', (value: any) => ({ type: 'number', params: [value] })],
  ['text 블록', (value: any) => ({ type: 'text', params: [value] })],
  ['text 블록 · 숫자', (value: any) => ({ type: 'text', params: [Number(value)] })],
  ['number 블록 · 숫자', (value: any) => ({ type: 'number', params: [Number(value)] })],
  ['맨 문자열', (value: any) => value],
  ['맨 숫자', (value: any) => Number(value)],
];

function nthResourceProject(numberValue: any) {
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
    const fragment = result.assets.find((a) => a.path === 'objects/주인공.tess')!.data.toString('utf-8');

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

    const thread = JSON.parse(recompiled.project!.objects[0].script)[0];
    const shape = thread.find((b: any) => b.type === 'change_to_some_shape');
    assert.equal(shape.params[0].type, 'number');
    assert.deepEqual(shape.params[0].params, ['1']);
  });
}

// 다시 적으면 글자가 달라지는 숫자는 이름으로 찾을 때 어긋날 수 있어서 문자열로 둔다.
test('"01" 처럼 다시 적으면 달라지는 값은 숫자로 바꾸지 않는다', () => {
  const result = decompileProject(nthResourceProject(() => ({ type: 'text', params: ['01'] })), []);
  const fragment = result.assets.find((a) => a.path === 'objects/주인공.tess')!.data.toString('utf-8');

  assert.match(fragment, /^ {2}costume = "01"$/m);
});

/**
 * coordinate_object 내장 변수의 picture_index 및 picture_name 디컴파일 테스트
 * 
 * 해당 속성들이 자리표시자로 깨지지 않고 올바르게 복원되는지 검증합니다.
 */
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

  const decompiled = decompileProject(compiled.project!, []);
  assert.deepEqual(decompiled.warnings, []);

  const fragment = decompiled.assets.find((a) => a.path === 'objects/o.tess')!.data.toString('utf-8');
  assert.doesNotMatch(fragment, /\[decompile/);
  assert.match(fragment, /^ {2}이름 = costume\("다른"\)$/m);
  assert.match(fragment, /^ {2}번호 = costume_number\("다른"\)$/m);
  assert.match(fragment, /^ {2}내이름 = costume$/m);
  assert.match(fragment, /^ {2}내번호 = costume_number$/m);
});

/**
 * 함수 내 특정 오브젝트 리소스 ID 하드코딩 패턴 복원 테스트
 * 
 * 함수 내에서 단일 오브젝트의 리소스만 수정하는 경우, 해당 오브젝트 내부의 로컬 함수로 
 * 디컴파일하여 참조 안전성을 확보합니다. 반면 여러 오브젝트의 리소스를 수정할 경우 
 * 전역 함수로 유지하고 force id 문법을 사용합니다.
 */
// 모양 자리에 id 가 들어가는 두 가지 모습 — 손으로 박아 넣은 문자열(text 블록)과,
// 편집기 드롭다운으로 고른 get_pictures 블록. 함수 안에서는 둘 다 똑같이 다뤄야 한다.
const SHAPE_VALUES = [
  ['손으로 박아 넣은 id', (value: any) => ({ type: 'text', params: [value] })],
  ['드롭다운으로 고른 모양', (value: any) => ({ type: 'get_pictures', params: [value] })],
];

/** `shared: true` 면 함수가 두 번째 오브젝트의 모양도 건드린다 */
function hardcodedFunctionProject(shapeValue: any, { shared = false } = {}) {
  const startHat = () => ({ type: 'when_run_button_click', params: [null], statements: [] });
  const sprite = (id: string, name: string, pictures: any) => ({
    id,
    name,
    objectType: 'sprite',
    scene: 'scene1',
    rotateMethod: 'free',
    selectedPictureId: pictures[0].id,
    entity: { x: 0, y: 0, scaleX: 1, scaleY: 1, visible: true, regX: 5, regY: 5 },
    sprite: { pictures, sounds: [] },
    script: JSON.stringify([[startHat(), { type: 'func_fn1', params: [null], statements: [] }]]),
  });
  const picture = (id: string, name: string) => ({ id, name, fileurl: null, dimension: { width: 10, height: 10 } });

  const body = [{ type: 'change_to_some_shape', params: [shapeValue('qio1'), null], statements: [] }];
  if (shared) body.push({ type: 'change_to_some_shape', params: [shapeValue('zzz1'), null], statements: [] });

  return {
    name: '하드코딩 함수 테스트',
    speed: 60,
    scenes: [{ id: 'scene1', name: '장면 1' }],
    variables: [],
    messages: [],
    aiUtilizeBlocks: [],
    objects: [
      sprite('obj1', '주인공', [picture('pic1', '기본'), picture('qio1', '점프')]),
      sprite('obj2', '조연', [picture('pic2', '기본'), picture('zzz1', '구르기')]),
    ],
    functions: [{
      id: 'fn1',
      content: JSON.stringify([[{
        type: 'function_create',
        params: [{ type: 'function_field_label', params: ['점프하기', null] }],
        // "점프" 모양 이름이 아니라, 그 모양의 진짜 엔트리 id 를 가리킨다.
        statements: [body],
      }]]),
    }],
  };
}

/** 되돌린 결과를 임시 폴더에 풀고 다시 컴파일한다 */
function recompileResult(result: any, prefix: any) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const mainFile = path.join(dir, 'main.tess');
  fs.writeFileSync(mainFile, result.source);
  for (const asset of result.assets) {
    const target = path.join(dir, asset.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, asset.data);
  }
  return compileProject(fs.readFileSync(mainFile, 'utf-8'), { path: mainFile, assetDirs: [dir] });
}

for (const [label, shapeValue] of SHAPE_VALUES) {
  test(`한 오브젝트만 건드리는 함수(${label})는 그 오브젝트 조각 파일로 옮기고 이름을 쓴다`, () => {
    const result = decompileProject(hardcodedFunctionProject(shapeValue), []);
    assert.deepEqual(result.warnings, []);

    // main.tess 에는 더 이상 함수 선언이 없다
    assert.doesNotMatch(result.source, /^function /m);

    const fragment = result.assets.find((a) => a.path === 'objects/주인공.tess')!.data.toString('utf-8');
    assert.match(fragment, /^function 점프하기\(\):$/m);
    assert.match(fragment, /^ {2}costume = "점프"$/m); // id 가 아니라 이름으로
    assert.doesNotMatch(fragment, /qio1/); // force id 도, 박아 넣은 id 도 사라진다
    // 함수는 이벤트 블록 뒤, 조각 파일 맨 끝에 온다
    assert.ok(fragment.indexOf('when start do') < fragment.indexOf('function 점프하기'));
  });

  test(`옮긴 함수(${label})를 다시 컴파일하면 원래 모양을 그대로 가리킨다`, () => {
    const result = decompileProject(hardcodedFunctionProject(shapeValue), []);
    const recompiled = recompileResult(result, 'tess-decompile-owned-');
    assert.deepEqual(recompiled.errors, [], recompiled.errors.map((e) => e.message).join('\n'));

    const hero = recompiled.project!.objects.find((o) => o.name === '주인공');
    const jump = hero!.sprite.pictures.find((p) => p.name === '점프');
    const block = JSON.parse(recompiled.project!.functions[0].content)[0][0].statements[0][0];
    assert.equal(block.type, 'change_to_some_shape');
    assert.equal(block.params[0].type, 'get_pictures');
    assert.equal(block.params[0].params[0], jump!.id);
  });

  test(`두 오브젝트를 건드리는 함수(${label})는 전역에 남고 force id 를 쓴다`, () => {
    const result = decompileProject(hardcodedFunctionProject(shapeValue, { shared: true }), []);
    assert.deepEqual(result.warnings, []);

    assert.match(result.source, /^function 점프하기\(\):$/m);
    assert.match(result.source, /^ {2}costume = "qio1"$/m); // 이름으로 바꾸면 어긋난다
    assert.match(result.source, /^ {2}costume = "zzz1"$/m);

    const hero = result.assets.find((a) => a.path === 'objects/주인공.tess')!.data.toString('utf-8');
    const other = result.assets.find((a) => a.path === 'objects/조연.tess')!.data.toString('utf-8');
    assert.match(hero, /^costume 점프 "점프\.png" size 10 10 force id "qio1"$/m);
    assert.match(other, /^costume 구르기 "구르기\.png" size 10 10 force id "zzz1"$/m);
    assert.doesNotMatch(hero, /^function /m);
  });

  test(`전역에 남은 함수(${label})도 다시 컴파일하면 id 가 그대로 고정된다`, () => {
    const result = decompileProject(hardcodedFunctionProject(shapeValue, { shared: true }), []);
    const recompiled = recompileResult(result, 'tess-decompile-forceid-');
    assert.deepEqual(recompiled.errors, [], recompiled.errors.map((e) => e.message).join('\n'));

    const hero = recompiled.project!.objects.find((o) => o.name === '주인공');
    assert.equal(hero!.sprite.pictures.find((p) => p.name === '점프')!.id, 'qio1');

    const block = JSON.parse(recompiled.project!.functions[0].content)[0][0].statements[0][0];
    assert.equal(block.params[0], 'qio1'); // 함수를 누가 부르든 정확히 그 모양을 가리킨다
  });
}

// 리소스를 아예 안 건드리는 함수는 어느 오브젝트 것도 아니므로 전역에 남는다.
test('모양·소리를 안 쓰는 함수는 전역에 그대로 둔다', () => {
  const project = hardcodedFunctionProject((value: any) => ({ type: 'text', params: [value] }));
  project.functions[0].content = JSON.stringify([[{
    type: 'function_create',
    params: [{ type: 'function_field_label', params: ['인사하기', null] }],
    statements: [[{ type: 'dialog', params: [{ type: 'text', params: ['안녕'] }, 'speak', null], statements: [] }]],
  }]]);

  const result = decompileProject(project, []);
  assert.match(result.source, /^function 인사하기\(\):$/m);
  const fragment = result.assets.find((a) => a.path === 'objects/주인공.tess')!.data.toString('utf-8');
  assert.doesNotMatch(fragment, /^function /m);
});

/**
 * 엔트리 기본 오브젝트 리소스(모양 및 소리) 디컴파일 테스트
 * 
 * 기본 리소스는 .ent 파일 내에 존재하지 않으므로, 경로를 그대로 사용하지 않고
 * 설치된 entryjs 내부에서 해당 리소스를 직접 추출하여 프로젝트 assets/ 에 포함시키는지 확인합니다.
 */
function builtinObjectProject() {
  const media = (file: string) => `./bower_components/entry-js/images/media/${file}`;
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
  const fragment = result.assets.find((a) => a.path === 'objects/엔트리봇.tess')!.data.toString('utf-8');

  // bower_components 경로가 소스에 새어 나오면 안 된다 — 그런 파일은 어디에도 없다
  assert.doesNotMatch(fragment, /bower_components/);
  // 파일을 실제로 담았으니 그림 크기는 적지 않는다 — 컴파일러가 그림을 열어 재고,
  // 사람이 그림을 바꿔 넣을 때 숫자까지 같이 고치지 않아도 된다.
  assert.match(fragment, /^default costume 엔트리봇_걷기1 "assets\/image\/엔트리봇_엔트리봇_걷기1\.svg"$/m);
  assert.match(fragment, /^costume 엔트리봇_걷기2 "assets\/image\/엔트리봇_엔트리봇_걷기2\.svg"$/m);
  // 소리 길이는 반대로 늘 적는다 — 아래 '소리 길이는 원본 값을 늘 적는다' 참고.
  assert.match(fragment, /^sound 강아지_짖는_소리 "assets\/sound\/엔트리봇_강아지_짖는_소리\.mp3" for 1\.3 as "강아지 짖는 소리"$/m);

  for (const relative of ['assets/image/엔트리봇_엔트리봇_걷기1.svg', 'assets/image/엔트리봇_엔트리봇_걷기2.svg', 'assets/sound/엔트리봇_강아지_짖는_소리.mp3']) {
    const asset = result.assets.find((a) => a.path === relative);
    assert.ok(asset && asset.data.length > 0, `${relative} 의 실제 파일이 담겨 있어야 한다`);
  }
  assert.match(result.assets.find((a) => a.path === 'assets/image/엔트리봇_엔트리봇_걷기1.svg')!.data.toString('utf-8'), /<svg/);
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

  const sprite = recompiled.project!.objects[0].sprite;
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
  const fragment = result.assets.find((a) => a.path === 'objects/새_오브젝트.tess')!.data.toString('utf-8');
  assert.doesNotMatch(fragment, /bower_components/);
  assert.match(fragment, /^default costume 새그림 "assets\/image\/새_오브젝트_새그림\.png" size 960 540$/m);
  assert.ok(result.assets.find((a) => a.path === 'assets/image/새_오브젝트_새그림.png')?.data.length! > 0);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tess-decompile-1x1-'));
  fs.writeFileSync(path.join(dir, 'main.tess'), result.source);
  for (const asset of result.assets) {
    const target = path.join(dir, asset.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, asset.data);
  }
  const recompiled = compileProject(result.source, { path: path.join(dir, 'main.tess'), assetDirs: [dir] });
  assert.deepEqual(recompiled.errors, [], recompiled.errors.map((e) => e.message).join('\n'));
  assert.deepEqual(recompiled.project!.objects[0].sprite.pictures[0].dimension, { width: 960, height: 540 });
});

/**
 * 다중 라벨 및 판단(boolean) 매개변수를 포함하는 복합 함수 정의부 복원 테스트
 * 
 * 매개변수와 라벨이 섞여 있는 경우에도 매개변수를 유실 없이 파싱하여 
 * 디컴파일 시 유효한 참조명으로 유지하는지 검증합니다.
 */
const fieldLabel = (text: string, next: any) => ({ type: 'function_field_label', params: [text, next] });
const fieldString = (id: string, next: any) => ({
  type: 'function_field_string', params: [{ type: `stringParam_${id}`, params: [] }, next],
});
const fieldBoolean = (id: string, next: any) => ({
  type: 'function_field_boolean', params: [{ type: `booleanParam_${id}`, params: [null] }, next],
});

/** 머리 사슬 하나짜리 프로젝트. body 는 함수 본문 블록들 */
function functionHeadProject(field: any, body: any[] = []): RawEntity {
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

const declarationOf = (field: any, body?: any[]) => decompileProject(functionHeadProject(field, body), [])
  .source.match(/^function .*/m)![0];

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

test('자동 이름은 알파벳을 다 쓰면 a1, a2 로 이어진다', () => {
  const field = fieldLabel('많이', Array.from({ length: 28 })
    .reduceRight((next, _, i) => fieldString(`p${i}`, next), null));
  // x·y 는 좌표를 뜻하는 내장 이름이라 자동 이름에서 빠진다
  assert.match(declarationOf(field), /, v, w, z, a1, a2, a3, a4\):$/);
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
  let node = JSON.parse(recompiled.project!.functions[0].content)[0][0].params[0];
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
  const fragment = result.assets.find((a) => a.path === 'objects/주인공.tess')!.data.toString('utf-8');
  assert.equal(fragment, 'x = 10\n\n\nwhen start do\n  wait 1\nend\n');
});

test('파일을 담은 모양은 크기를 적지 않고, 1×1 빈 그림만 예외다', () => {
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
  const fragment = result.assets.find((a) => a.path === 'objects/엔트리봇.tess')!.data.toString('utf-8');
  assert.match(fragment, /^default costume 엔트리봇_걷기1 "assets\/image\/엔트리봇_엔트리봇_걷기1\.svg"$/m);
  assert.match(fragment, /^sound 강아지_짖는_소리 "assets\/sound\/엔트리봇_강아지_짖는_소리\.mp3" for 1\.3 as "강아지 짖는 소리"$/m);
  assert.match(fragment, /^costume 새그림 "assets\/image\/엔트리봇_새그림\.png" size 960 540$/m);
});

// 사람이 고칠 소스에는 숫자를 안 적는 게 기본이지만, 원본 dimension 을 그대로 남겨
// 두고 싶을 때(그림 파일을 못 구했거나, 원본과 픽셀 하나까지 맞춰야 할 때)가 있다.
test('sizes 옵션을 켜면 모든 모양에 size 가로 세로 를 적는다', () => {
  const result = decompileProject(builtinObjectProject(), [], { sizes: true });
  const fragment = result.assets.find((a) => a.path === 'objects/엔트리봇.tess')!.data.toString('utf-8');

  assert.match(fragment, /^default costume 엔트리봇_걷기1 "assets\/image\/엔트리봇_엔트리봇_걷기1\.svg" size 144 246$/m);
  assert.match(fragment, /^costume 엔트리봇_걷기2 "assets\/image\/엔트리봇_엔트리봇_걷기2\.svg" size 144 246$/m);
  // 소리 길이는 이 옵션과 상관없다 — 원본 값을 늘 적기 때문이다
  assert.match(fragment, /^sound 강아지_짖는_소리 "assets\/sound\/엔트리봇_강아지_짖는_소리\.mp3" for 1\.3 as "강아지 짖는 소리"$/m);
});

/**
 * 텍스트 박스 크기 강제 명시(디컴파일) 규칙 테스트
 * 
 * 줄바꿈 글상자의 경우 렌더링에 의한 크기와 글자수 추정 크기의 오차가 크므로,
 * 디컴파일 시 항상 실제 'size 가로 세로' 속성을 소스 코드에 명시하도록 처리합니다.
 */
function textBoxProject(entityExtra: RawEntity = {}): RawEntity {
  return {
    name: '글상자 크기 테스트',
    speed: 60,
    scenes: [{ id: 'scene1', name: '장면 1' }],
    variables: [],
    messages: [],
    functions: [],
    aiUtilizeBlocks: [],
    objects: [{
      id: 'obj1',
      name: '안내문',
      objectType: 'textBox',
      scene: 'scene1',
      rotateMethod: 'free',
      text: '이름:\n\n죄목:',
      entity: {
        x: 0, y: 0, scaleX: 1, scaleY: 1, visible: true,
        colour: '#000000', bgColor: '#ffffff', font: '13.98px Nanum Gothic', fontSize: 13.98,
        lineBreak: true, width: 65.49, height: 104.65, ...entityExtra,
      },
      sprite: { pictures: [], sounds: [] },
      script: JSON.stringify([[]]),
    }],
  };
}

test('글상자는 옵션 없이도 size 가로 세로 를 적는다', () => {
  const result = decompileProject(textBoxProject(), []);
  const fragment = result.assets.find((a) => a.path === 'objects/안내문.tess')!.data.toString('utf-8');

  assert.match(fragment, /^size 65\.49 104\.65$/m);
});

test('되돌린 글상자를 다시 컴파일하면 원본 틀 크기가 그대로 나온다', () => {
  const result = decompileProject(textBoxProject(), []);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tess-decompile-textbox-'));
  const mainFile = path.join(dir, 'main.tess');
  fs.writeFileSync(mainFile, result.source);
  for (const asset of result.assets) {
    const target = path.join(dir, asset.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, asset.data);
  }

  const recompiled = compileProject(fs.readFileSync(mainFile, 'utf-8'), { path: mainFile, assetDirs: [dir] });
  assert.deepEqual(recompiled.errors, [], recompiled.errors.map((e) => e.message).join('\n'));

  const { entity } = recompiled.project!.objects[0];
  assert.equal(entity.width, 65.49);
  assert.equal(entity.height, 104.65);
  assert.equal(entity.lineBreak, true);
});

// ---------------------------------------------------------------------------
//  숫자를 문자열로 옮기던 문제
//
//  엔트리의 number 블록과 text 블록은 둘 다 "적어 둔 글자를 그대로 돌려주는" 같은
//  원시 블록이라(block_entry.js), 사람이 어느 칸에 입력했느냐만 다르고 실행 결과는
//  똑같다. 그런데 되돌리기가 text 블록을 무조건 문자열로 옮겨서, 판단문 안이나
//  계산식 안이나 함수 인수의 숫자가 `"45"` 처럼 따옴표를 뒤집어쓰고 나왔다.
// ---------------------------------------------------------------------------
function numberShapeProject() {
  const startHat = () => ({ type: 'when_run_button_click', params: [null], statements: [] });
  const text = (value: any) => ({ type: 'text', params: [value] });
  const number = (value: any) => ({ type: 'number', params: [value] });
  const compare = (left: any, op: any, right: any) => ({ type: 'boolean_basic_operator', params: [left, op, right] });
  const calc = (left: any, op: any, right: any) => ({ type: 'calc_basic', params: [left, op, right] });

  return {
    name: '숫자 모양 테스트',
    speed: 60,
    scenes: [{ id: 'scene1', name: '장면 1' }],
    variables: [
      { id: 'v1', name: '단계', value: 0 },
      { id: 'l1', name: '기록', variableType: 'list', array: [{ data: 'ㄱ' }] },
    ],
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
        pictures: [{ id: 'pic1', name: '기본', fileurl: null, dimension: { width: 10, height: 10 } }],
        sounds: [],
      },
      script: JSON.stringify([[
        startHat(),
        // 판단값 안의 숫자
        { type: '_if', params: [compare({ type: 'get_variable', params: ['v1'] }, 'EQUAL', text('14'))], statements: [[]] },
        // 괄호로 감싼 계산식 안의 숫자
        { type: 'set_variable', params: ['v1', calc(text('3'), 'MULTI', calc(text('2'), 'PLUS', number('5')))], statements: [] },
        // 함수 인수
        { type: 'func_fn1', params: [text('7'), null], statements: [] },
        // 리스트 순번
        { type: 'remove_value_from_list', params: [text('3'), 'l1', null], statements: [] },
        // 다시 적으면 글자가 달라지는 값은 그대로 글자로 둔다
        { type: 'dialog', params: [text('007'), 'speak', null], statements: [] },
      ]]),
    }],
    functions: [{
      id: 'fn1',
      content: JSON.stringify([[{
        type: 'function_create',
        params: [{
          type: 'function_field_label',
          params: ['더하기', { type: 'function_field_string', params: [{ type: 'stringParam_a' }, null] }],
        }],
        statements: [[]],
      }]]),
    }],
  };
}

test('판단값 · 계산식 · 함수 인수 · 순번 안의 숫자는 숫자로 되돌아온다', () => {
  const result = decompileProject(numberShapeProject(), []);
  const fragment = result.assets.find((a) => a.path === 'objects/주인공.tess')!.data.toString('utf-8');

  assert.match(fragment, /^ {2}if \(단계 == 14\):$/m);                 // 판단값
  assert.match(fragment, /^ {2}단계 = \(3 \* \(2 \+ 5\)\)$/m);         // 괄호 친 계산식
  assert.match(fragment, /^ {2}더하기\(7\)$/m);                        // 함수 인수
  assert.match(fragment, /^ {2}remove 기록\[3\]$/m);                  // 순번은 엔트리와 같은 1부터라 그대로 옮긴다
  assert.doesNotMatch(fragment, /"14"|"2"|"7"/);

  // 다시 적으면 달라지는 값은 글자 그대로 둔다
  assert.match(fragment, /^ {2}say "007"$/m);
});

test('숫자로 되돌린 코드는 다시 컴파일해도 값이 그대로다', () => {
  const result = decompileProject(numberShapeProject(), []);
  const recompiled = recompileResult(result, 'tess-decompile-number-');
  assert.deepEqual(recompiled.errors, [], recompiled.errors.map((e) => e.message).join('\n'));

  const thread = JSON.parse(recompiled.project!.objects[0].script)[0];
  const condition = thread.find((b: any) => b.type === '_if').params[0];
  // number 블록이든 text 블록이든 엔트리는 적어 둔 글자를 그대로 돌려준다 — 값이 같아야 한다
  assert.equal(condition.params[2].params[0], '14');
  const assign = thread.find((b: any) => b.type === 'set_variable').params[1];
  assert.equal(assign.params[0].params[0], '3');
  assert.equal(assign.params[2].params[0].params[0], '2');
});

// 소리 길이(get_sound_duration)와 색 고르기 칸(text_color)은 예전엔 자리표시자로
// 남아서 되돌린 소스가 컴파일되지 않았다.
test('소리 길이와 색 고르기 칸을 되돌리고 다시 컴파일한다', () => {
  const project = {
    name: 't',
    speed: 60,
    scenes: [{ id: 'scene1', name: '장면 1' }],
    variables: [{ id: 'v1', name: '길이', value: 0 }],
    messages: [],
    functions: [],
    aiUtilizeBlocks: [],
    objects: [{
      id: 'obj1',
      name: '점수판',
      objectType: 'textBox',
      scene: 'scene1',
      rotateMethod: 'free',
      text: '가',
      entity: {
        x: 0, y: 0, scaleX: 1, scaleY: 1, visible: true,
        colour: '#000000', bgColor: '#ffffff', font: '20px Nanum Gothic', fontSize: 20,
      },
      sprite: {
        pictures: [],
        sounds: [{ id: 'snd1', name: '점프음', fileurl: null, ext: '.mp3', duration: 2.5 }],
      },
      script: JSON.stringify([[
        { type: 'when_run_button_click', params: [null], statements: [] },
        { type: 'set_variable', params: ['v1', { type: 'get_sound_duration', params: [null, 'snd1', null] }], statements: [] },
        { type: 'text_change_font_color', params: [{ type: 'text_color', params: ['#16d8a3'] }, null], statements: [] },
      ]]),
    }],
  };

  const result = decompileProject(project, []);
  assert.deepEqual([...result.warnings], []);
  const fragment = result.assets.find((a) => a.path === 'objects/점수판.tess')!.data.toString('utf-8');
  assert.match(fragment, /^ {2}길이 = sound_duration\("점프음"\)$/m);
  assert.match(fragment, /^ {2}font_color = #16d8a3$/m);
  assert.doesNotMatch(fragment, /\[decompile/);

  const recompiled = recompileResult(result, 'tess-decompile-sound-');
  assert.deepEqual(recompiled.errors, [], recompiled.errors.map((e) => e.message).join('\n'));
  const thread = JSON.parse(recompiled.project!.objects[0].script)[0];
  const duration = thread.find((b: any) => b.type === 'set_variable').params[1];
  assert.equal(duration.type, 'get_sound_duration');
  // 소리 id 는 다시 배정되지만 그 소리를 그대로 가리켜야 한다
  assert.equal(duration.params[1], recompiled.project!.objects[0].sprite.sounds[0].id);
  assert.equal(thread.find((b: any) => b.type === 'text_change_font_color').params[0], '#16d8a3');
});

// get_sound_speed 에 대응하는 자리가 없어서 자리표시자로 남았고, 그 자리표시자가
// 산술식에 섞이면(엔트리 재생 속도 값이 필요한 대기 조건 등) NaN 이 되어 다시는
// 참이 되지 않는 wait 로 굳어 버렸다 — 글자 하나씩 찍는 효과가 첫 글자에서 멈추던 원인.
test('sound_speed 를 되돌리고 다시 컴파일한다', () => {
  const project = minimalProject(1);
  project.variables.push({ id: 'v1', name: '속도', value: 0, object: null });
  project.objects[0].script = JSON.stringify([[
    { type: 'when_run_button_click', params: [null], statements: [] },
    { type: 'set_variable', params: ['v1', { type: 'get_sound_speed', params: [null] }], statements: [] },
  ]]);

  const result = decompileProject(project, []);
  assert.deepEqual([...result.warnings], []);
  const fragment = result.assets.find((a) => a.path === 'objects/주인공.tess')!.data.toString('utf-8');
  assert.match(fragment, /^ {2}속도 = sound_speed$/m);
  assert.doesNotMatch(fragment, /\[decompile/);

  const recompiled = recompileResult(result, 'tess-decompile-soundspeed-');
  assert.deepEqual(recompiled.errors, [], recompiled.errors.map((e) => e.message).join('\n'));
  const thread = JSON.parse(recompiled.project!.objects[0].script)[0];
  assert.equal(thread.find((b: any) => b.type === 'set_variable').params[1].type, 'get_sound_speed');
});

// 이름 맨 앞의 숫자를 지워 버리면 "1.png"·"2.png"·"3.png" 가 죄다 같은 이름이 된 뒤
// 뒤에 번호가 붙어서, 원본과 짝이 어긋난 채로 되돌아왔다.
test('숫자로 시작하는 모양 이름도 숫자를 잃지 않는다', () => {
  const picture = (id: string, name: string) => ({ id, name, fileurl: null, dimension: { width: 10, height: 10 } });
  const project = {
    name: 't',
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
      selectedPictureId: 'p1',
      entity: { x: 0, y: 0, scaleX: 1, scaleY: 1, visible: true },
      sprite: { pictures: [picture('p1', '3.png'), picture('p2', '1.png'), picture('p3', '2.png')], sounds: [] },
      script: JSON.stringify([[
        { type: 'when_run_button_click', params: [null], statements: [] },
        { type: 'change_to_some_shape', params: [{ type: 'get_pictures', params: ['p3'] }, null], statements: [] },
      ]]),
    }],
  };

  const result = decompileProject(project, []);
  const fragment = result.assets.find((a) => a.path === 'objects/주인공.tess')!.data.toString('utf-8');
  assert.match(fragment, /^default costume costume_3_png /m);
  assert.match(fragment, /^costume costume_1_png /m);
  assert.match(fragment, /^costume costume_2_png /m);
  // 어느 모양을 가리키는지가 원본 그대로여야 한다 ("2.png")
  assert.match(fragment, /^ {2}costume = "costume_2_png"$/m);
});

// ---------------------------------------------------------------------------
//  무게중심(중심점 · 엔트리 regX/regY)
//
//  오브젝트의 x/y 는 그림 가운데가 아니라 "중심점" 을 무대의 그 자리에 놓는다.
//  엔트리는 오브젝트를 만들 때 이 점을 정하고 그 뒤로는 바꾸지 않으며, 기본값은
//  모양 한가운데다. 사람이 이 점을 옮겨 두면 x/y 의 뜻 자체가 달라지므로, 안 옮기면
//  오브젝트가 엉뚱한 데 놓인다 — right_leaning.ent 는 `go 0 0` 하나뿐인데도
//  중심점 덕분에 엔트리봇이 무대 맨 왼쪽에 선다.
// ---------------------------------------------------------------------------
function centerProject(regX: any, regY: any) {
  return {
    name: '중심점 테스트',
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
      entity: { x: 0, y: 0, scaleX: 1, scaleY: 1, visible: true, regX, regY },
      sprite: {
        pictures: [{ id: 'pic1', name: '기본', fileurl: null, dimension: { width: 144, height: 246 } }],
        sounds: [],
      },
      script: JSON.stringify([[]]),
    }],
  };
}

test('옮겨진 중심점은 center 가로 세로 로 되돌아온다', () => {
  const result = decompileProject(centerProject(461.84, 116.7), []);
  const fragment = result.assets.find((a) => a.path === 'objects/주인공.tess')!.data.toString('utf-8');
  assert.match(fragment, /^center 461\.84 116\.7$/m);
});

test('중심점이 모양 한가운데면 center 줄을 적지 않는다', () => {
  const result = decompileProject(centerProject(72, 123), []);
  const fragment = result.assets.find((a) => a.path === 'objects/주인공.tess')!.data.toString('utf-8');
  assert.doesNotMatch(fragment, /^center /m);
});

test('되돌린 중심점을 다시 컴파일하면 regX/regY 가 그대로 나온다', () => {
  const result = decompileProject(centerProject(461.84, 116.7), []);
  const recompiled = recompileResult(result, 'tess-decompile-center-');
  assert.deepEqual(recompiled.errors, [], recompiled.errors.map((e) => e.message).join('\n'));

  const { entity } = recompiled.project!.objects[0];
  assert.equal(entity.regX, 461.84);
  assert.equal(entity.regY, 116.7);
  // 중심점을 안 적었을 때 나오던 기본값(모양 한가운데)이 아니어야 한다
  assert.notEqual(entity.regX, 72);
});

test('center 를 안 적으면 모양 한가운데가 기본값이다', () => {
  const result = decompileProject(centerProject(72, 123), []);
  const recompiled = recompileResult(result, 'tess-decompile-center-default-');
  const { entity } = recompiled.project!.objects[0];
  assert.equal(entity.regX, 72);
  assert.equal(entity.regY, 123);
});

test('크기를 모르는 글상자는 size 줄을 적지 않는다', () => {
  const project = textBoxProject();
  delete project.objects[0].entity.width;
  delete project.objects[0].entity.height;

  const result = decompileProject(project, []);
  const fragment = result.assets.find((a) => a.path === 'objects/안내문.tess')!.data.toString('utf-8');
  assert.doesNotMatch(fragment, /^size /m);
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
  let node = JSON.parse(recompiled.project!.functions[0].content)[0][0].params[0];
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

  const object = (id: string, name: string, sceneId: any, fileurl: any) => ({
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
const fakeEntries = (project: any) => (project.objects ?? []).flatMap((object: any) => [
  ...(object.sprite.pictures ?? []).map((p: any) => ({ name: p.fileurl, data: Buffer.from(object.name + ' 그림') })),
  ...(object.sprite.sounds ?? []).map((s: any) => ({ name: s.fileurl, data: Buffer.from(object.name + ' 소리') })),
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
  const chiro = result.assets.find((a) => a.path === 'objects/치로.tess')!.data.toString('utf-8');
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
    const fragment = result.assets.find((a) => a.path === `objects/${name}.tess`)!.data.toString('utf-8');
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

// --- 벡터 모양은 엔트리가 저장할 때 남긴 PNG 로 가져온다 ---------------------------
//
// 엔트리 벡터 그림판은 그림판 크기를 넘는 이미지도 모양으로 받아 주고, 사용자가 그것을
// 옮겨서 맞춰 놓으면 저장할 때 그 화면을 PNG 로 캡처해 둔다. 그런데 SVG 쪽은 저장한
// 뒤 다시 가운데로 옮겨 버려서, 맞춰 놓은 위치가 SVG 에는 남지 않는다.

/** SVG 모양 하나짜리 project. `withPng` 면 엔트리가 같이 저장한 PNG 도 있는 것으로 친다 */
function svgPictureProject(): RawEntity {
  const project = minimalProject(1);
  project.objects[0].sprite.pictures = [{
    id: 'pic1',
    name: '배경',
    filename: 'aaaa',
    imageType: 'svg',
    fileurl: 'temp/aa/aa/image/aaaa.svg',
    dimension: { width: 960, height: 540 },
  }];
  project.objects[0].selectedPictureId = 'pic1';
  return project;
}

const svgEntries = (withPng: any) => [
  { name: 'temp/aa/aa/image/aaaa.svg', data: Buffer.from('<svg viewBox="0 0 1100 670"></svg>') },
  ...(withPng ? [{ name: 'temp/aa/aa/image/aaaa.png', data: Buffer.from('가운데로 안 옮겨진 그림') }] : []),
];

test('SVG 모양은 기본적으로 엔트리가 함께 저장한 PNG 로 가져온다', () => {
  const result = decompileProject(svgPictureProject(), svgEntries(true));

  const images = result.assets.filter((a) => a.path.startsWith('assets/image/'));
  assert.deepEqual(images.map((a) => a.path), ['assets/image/주인공_배경.png']);
  assert.equal(images[0].data.toString('utf-8'), '가운데로 안 옮겨진 그림');

  const fragment = result.assets.find((a) => a.path === 'objects/주인공.tess')!.data.toString('utf-8');
  assert.match(fragment, /default costume 배경 "assets\/image\/주인공_배경\.png"/);
});

test('--keep-svg 를 주면 SVG 를 그대로 가져온다', () => {
  const result = decompileProject(svgPictureProject(), svgEntries(true), { keepSvg: true });

  const images = result.assets.filter((a) => a.path.startsWith('assets/image/'));
  assert.deepEqual(images.map((a) => a.path), ['assets/image/주인공_배경.svg']);
  assert.match(images[0].data.toString('utf-8'), /<svg/);
});

test('함께 저장한 PNG 가 없으면 SVG 를 그대로 가져온다', () => {
  const result = decompileProject(svgPictureProject(), svgEntries(false));

  const images = result.assets.filter((a) => a.path.startsWith('assets/image/'));
  assert.deepEqual(images.map((a) => a.path), ['assets/image/주인공_배경.svg']);
});

// ---------------------------------------------------------------------------
//  함수 지역 변수
// ---------------------------------------------------------------------------
/** 지역 변수를 가진 함수 하나짜리 project.json. globals 로 전역 변수도 함께 둔다 */
function funcLocalProject(
  localVariables: any[],
  body: any[],
  globals: RawEntity[] = [],
): RawEntity {
  const field = fieldLabel('계산', fieldString('p1', null));
  return {
    name: '지역 변수 테스트',
    speed: 60,
    scenes: [{ id: 'scene1', name: '장면 1' }],
    variables: globals,
    messages: [],
    aiUtilizeBlocks: [],
    objects: [],
    functions: [{
      id: 'fn1',
      localVariables,
      useLocalVariables: localVariables.length > 0,
      content: JSON.stringify([[{ type: 'function_create', params: [field, null], statements: [body] }]]),
    }],
  };
}

const getLocal = (id: string) => ({ type: 'get_func_variable', params: [id, null], statements: [] });
const setLocal = (id: string, value: any) => ({
  type: 'set_func_variable',
  params: [id, { type: 'number', params: [String(value)] }, null],
  statements: [],
});

test('함수 지역 변수는 이름을 되찾아 몸통 맨 위에 var 로 선언된다', () => {
  const project = funcLocalProject(
    [{ name: '누적', value: 0, id: 'fn1_a' }],
    [setLocal('fn1_a', 3), { type: 'dialog', params: [getLocal('fn1_a'), 'speak'], statements: [] }],
  );
  const result = decompileProject(project, []);

  assert.deepEqual(result.warnings, []);
  assert.match(result.source, /^function 계산\(a\):\n {2}var 누적 = 0\n {2}누적 = 3\n {2}say 누적$/m);
});

test('지역 변수 이름이 매개변수·전역과 겹치면 다른 이름을 준다', () => {
  const project = funcLocalProject(
    [{ name: 'a', value: 0, id: 'fn1_a' }, { name: '점수', value: 0, id: 'fn1_b' }],
    [setLocal('fn1_a', 1), setLocal('fn1_b', 2)],
    [{ id: 'g1', name: '점수', variableType: 'variable', value: 0, object: null }],
  );
  const result = decompileProject(project, []);

  assert.match(result.source, /^ {2}var a_2 as "a" = 0$/m);
  assert.match(result.source, /^ {2}var 점수_2 as "점수" = 0$/m);
});

test('이름으로 쓸 수 없는 낱말은 뒤에 _ 를 붙여 되돌린다', () => {
  const project = funcLocalProject(
    [{ name: 'skip', value: 0, id: 'fn1_a' }],
    [setLocal('fn1_a', 1)],
  );
  const result = decompileProject(project, []);

  assert.match(result.source, /^ {2}var skip_ as "skip" = 0$/m);
  assert.match(result.source, /^ {2}skip_ = 1$/m);
});

test('지역 변수 이름이 내장 이름과 겹치면 내장 이름을 가리지 않게 비껴 준다', () => {
  const coordinate = { type: 'coordinate_object', params: [null, 'self', null, 'x'], statements: [] };
  const project = funcLocalProject(
    [{ name: 'x', value: 0, id: 'fn1_a' }],
    [{ type: 'set_func_variable', params: ['fn1_a', coordinate, null], statements: [] }],
  );
  const result = decompileProject(project, []);

  // 지역 변수가 `x` 로 남으면 `x = x` 가 되어 오른쪽의 좌표까지 지역 변수를 가리킨다
  assert.match(result.source, /^ {2}var x_ as "x" = 0$/m);
  assert.match(result.source, /^ {2}x_ = x$/m);

  const recompiled = compileProject(result.source, { path: 'main.tess' });
  assert.deepEqual(recompiled.errors, []);
  const fn = recompiled.project!.functions[0];
  assert.deepEqual(fn.localVariables.map((v: any) => v.name), ['x']);
  // 오른쪽의 `x` 는 지역 변수가 아니라 좌표 블록으로 돌아와야 한다
  const body = JSON.parse(fn.content as unknown as string)[0][0].statements[0];
  const assignment = body[body.length - 1];
  assert.equal(assignment.params[1].type, 'coordinate_object');
  assert.deepEqual(assignment.params[1].params, [null, 'self', null, 'x']);
});

test('내장 이름과 겹치는 전역 변수·함수 이름도 비껴 준다', () => {
  const project = funcLocalProject(
    [],
    [],
    [{ id: 'g1', name: 'size', variableType: 'variable', value: 0, object: null }],
  );
  const result = decompileProject(project, []);

  assert.match(result.source, /^var size_ as "size" = 0$/m);
});

test('되돌린 지역 변수는 다시 컴파일해도 함수의 지역 변수로 남는다', () => {
  const project = funcLocalProject(
    [{ name: '누적', value: 0, id: 'fn1_a' }],
    [setLocal('fn1_a', 3), { type: 'dialog', params: [getLocal('fn1_a'), 'speak'], statements: [] }],
  );
  const result = decompileProject(project, []);

  const recompiled = compileProject(result.source, { path: 'main.tess' });
  assert.deepEqual(recompiled.errors, [], recompiled.errors.map((e) => e.message).join('\n'));
  assert.deepEqual(recompiled.project!.functions[0].localVariables.map((v) => v.name), ['누적']);
});

test('함수 정의 앞에 주석 블록이 놓여 있어도 정의를 찾아낸다', () => {
  // The workspace keeps one thread per stack, ordered by position; a comment
  // parked above the definition comes first.
  const project = funcLocalProject(
    [{ name: '누적', value: 0, id: 'fn1_a' }],
    [setLocal('fn1_a', 3)],
  );
  const content = JSON.parse(project.functions[0].content);
  project.functions[0].content = JSON.stringify([
    [{ id: 'c1', type: 'comment', value: '메모', params: [], statements: [] }],
    content[0],
  ]);
  const result = decompileProject(project, []);

  assert.match(result.source, /^function 계산\(a\):\n {2}var 누적 = 0\n {2}누적 = 3\nend$/m);
});

// --- 이름 · 저장 범위 -----------------------------------------------------------
// 엔트리 이름은 Tess 식별자로 못 적는 글자를 담을 수 있는데, "모양으로 바꾸기" 같은
// 블록은 실행할 때 그 이름으로 모양을 찾는다. 이름을 식별자로 바꿔 버리면 그런 조회가
// 전부 빗나가므로, 원래 이름을 `as` 로 남기고 다시 컴파일할 때 되돌려 놓아야 한다.
function namedResourceProject() {
  const project = minimalProject();
  project.objects[0].sprite.pictures = [
    { id: 'pic1', name: '상호작용1*1', filename: 'a', fileurl: 'a.png', dimension: { width: 4, height: 4 } },
  ];
  project.objects[0].sprite.sounds = [
    { id: 'snd1', name: 'snd_select.mp3', filename: 'b', fileurl: 'b.mp3', duration: 1 },
  ];
  project.objects[0].selectedPictureId = 'pic1';
  project.objects[0].script = JSON.stringify([[
    { type: 'when_run_button_click', params: [null], statements: [] },
    {
      type: 'change_to_some_shape',
      params: [{ type: 'text', params: ['상호작용1*1'], statements: [] }, null],
      statements: [],
    },
  ]]);
  return project;
}

/** 오브젝트 조각 파일 하나의 내용 */
function fragmentOf(result: any, name = '주인공') {
  return result.assets.find((a: any) => a.path === `objects/${name}.tess`).data.toString('utf-8');
}

test('식별자로 적을 수 없는 모양 · 소리 이름은 as 로 남긴다', () => {
  const fragment = fragmentOf(decompileProject(namedResourceProject(), []));
  assert.match(fragment, /costume 상호작용1_1 "[^"]+"( size \d+ \d+)? as "상호작용1\*1"/);
  assert.match(fragment, /sound snd_select "[^"]+"( for \d+)? as "snd_select\.mp3"/);
});

test('as 로 남긴 이름은 다시 컴파일해도 그대로 붙는다', () => {
  const result = decompileProject(namedResourceProject(), []);
  const recompiled = recompileResult(result, 'tess-decompile-asname-');
  assert.deepEqual(recompiled.errors, [], recompiled.errors.map((e) => e.message).join('\n'));

  const object = recompiled.project!.objects.find((o) => o.name === '주인공');
  assert.deepEqual(object!.sprite.pictures.map((p) => p.name), ['상호작용1*1']);
  assert.deepEqual(object!.sprite.sounds.map((s) => s.name), ['snd_select.mp3']);
  // 이름이 하나뿐이라 두 철자가 같은 모양 하나를 가리켜야 한다 — 목록이 늘어나면 안 된다
  assert.equal(object!.sprite.pictures.length, 1);
});

test('공유 · 실시간 변수는 shared · realtime 로 적고 그대로 되돌아온다', () => {
  const project = minimalProject();
  project.variables = [
    {
      id: 'v1', name: '순위(공유)', variableType: 'list', array: [], object: null,
      isCloud: true, isRealTime: false, cloudDate: false, visible: false, value: 0, x: 0, y: 0,
    },
    {
      id: 'v2', name: '접속자', variableType: 'variable', object: null,
      isCloud: false, isRealTime: true, cloudDate: false, visible: false, value: 0, x: 0, y: 0,
    },
  ];
  const result = decompileProject(project, []);
  assert.match(result.source, /^shared list 순위_공유 as "순위\(공유\)" = \[\]$/m);
  assert.match(result.source, /^realtime var 접속자 = 0$/m);

  const recompiled = recompileResult(result, 'tess-decompile-cloud-');
  assert.deepEqual(recompiled.errors, []);
  const list = recompiled.project!.variables.find((v) => v.name === '순위(공유)');
  const variable = recompiled.project!.variables.find((v) => v.name === '접속자');
  assert.equal(list!.isCloud, true);
  assert.equal(list!.isRealTime, false);
  assert.equal(variable!.isRealTime, true);
  assert.equal(variable!.isCloud, false);
});

test('공유 · 실시간은 오브젝트 안의 변수에는 붙일 수 없다', () => {
  const source = 'scene "s":\n  object "o":\n    shared var 점수 = 0\n  end\nend';
  const result = compileProject(source, { path: 'main.tess' });
  assert.equal(result.ok, false);
  assert.match(result.errors[0].message, /전역 선언에만 붙일 수 있습니다/);
});

test('작품에 없는 변수 id 를 가리키는 블록은 선언을 되살려서 컴파일된다', () => {
  const project = minimalProject();
  project.objects[0].script = JSON.stringify([[
    { type: 'when_run_button_click', params: [null], statements: [] },
    { type: 'set_variable', params: ['지워진id', { type: 'number', params: ['1'], statements: [] }, null], statements: [] },
  ]]);
  const result = decompileProject(project, []);
  assert.match(result.source, /^var missing_var_지워진id = 0$/m);

  const recompiled = recompileResult(result, 'tess-decompile-missing-');
  assert.deepEqual(recompiled.errors, []);
});

// --- 테이블 -------------------------------------------------------------------
test('테이블 블록은 컴파일한 뒤 되돌려도 글자 하나까지 그대로다', () => {
  const body = [
    'in 점수표 add row',
    'in 점수표 add column',
    'in 점수표 insert row at 2',
    'in 점수표 insert column at 2',
    'remove 점수표 row 1',
    'remove 점수표 column 1',
    '점수표[1, "점수"] = 5',
    '점수표["B2"] = 6',
    'save 점수표',
    'show 점수표',
    'show 점수표 for 3',
    'show 점수표 chart 1',
    'hide chart',
    'say 점수표[1, "점수"]',
    'say 점수표["B2"]',
    'say row_count(점수표)',
    'say column_count(점수표)',
    'say last_row(점수표, "점수")',
    'say sum(점수표, "점수")',
    'say average(점수표, "점수")',
    'say maximum(점수표, "점수")',
    'say minimum(점수표, "점수")',
    'say stdev(점수표, "점수")',
    'say median(점수표, "점수")',
    'say correlation(점수표, "이름", "점수")',
    'say lookup(점수표, "이름", "철수", "점수")',
  ];
  const source = `table 점수표:
  columns "이름", "점수"
  row "철수", 10
end

scene "s":
  object "o":
    when start do
${body.map((line) => `      ${line}`).join('\n')}
    end
  end
end`;

  const compiled = compileProject(source, { path: 'main.tess' });
  assert.deepEqual(compiled.errors, [], compiled.errors.map((e) => e.message).join('\n'));

  const back = decompileProject(compiled.project!, []);
  assert.deepEqual(back.warnings, []);
  assert.match(back.source, /^table 점수표:\n {2}columns "이름", "점수"\n {2}row "철수", 10\nend$/m);
  const fragment = back.assets.find((a) => a.path === 'objects/o.tess')!.data.toString('utf-8');
  assert.equal(
    fragment.trim(),
    ['when start do', ...body.map((line) => `  ${line}`), 'end'].join('\n'),
  );
});

test('테이블 선언은 엔트리 project.tables 항목이 된다', () => {
  const { project, errors } = compileProject(
    'table 점수표 as "점수 표":\n  columns "이름", "점수"\n  row "철수", 10\n  row "영희", 20\nend',
    { path: 'main.tess' },
  );
  assert.deepEqual(errors, []);
  assert.equal(project!.tables.length, 1);
  const [table] = project!.tables;
  assert.equal(table.name, '점수 표');
  assert.deepEqual(table.fields, ['이름', '점수']);
  assert.deepEqual(table.data, [['철수', '10'], ['영희', '20']]);
});

test('테이블 줄의 칸 수가 열 개수와 다르면 에러다', () => {
  const result = compileProject(
    'table T:\n  columns "a", "b"\n  row 1\nend',
    { path: 'main.tess' },
  );
  assert.equal(result.ok, false);
  assert.match(result.errors[0].message, /열 개수\(2\)와 같아야 합니다/);
});

/**
 * 함수 매개변수 이름과 변수 이름의 충돌 복원 테스트
 *
 * 엔트리 함수 본문은 변수를 id 로 가리키므로 매개변수 이름과 겹쳐도 그만이지만,
 * Tess 는 함수 안에서 이름을 매개변수 -> 함수 지역 -> 오브젝트 로컬 -> 전역 순으로
 * 찾습니다. 그래서 라벨에서 딴 매개변수 이름이 변수 이름과 같으면 본문의 그 변수
 * 참조가 매개변수로 바뀌어 버립니다 — 대입은 컴파일 에러가 되어 문장째로 사라집니다.
 */
function paramClashProject() {
  const param = (blockType: string, next: unknown) => ({
    type: 'function_field_string',
    params: [{ type: blockType, params: [null], statements: [] }, next],
    statements: [],
  });
  const labelField = (text: string, next: unknown) => ({
    type: 'function_field_label',
    params: [text, next],
    statements: [],
  });

  const create = {
    type: 'function_create',
    params: [
      labelField('걷기', param('stringParam_aaaa', labelField('넉백횟수', param('stringParam_bbbb', null)))),
      null,
    ],
    // 매개변수로 받은 값을 같은 이름의 전역 변수에 넣어 둔다.
    statements: [[
      { type: 'set_variable', params: ['var1', { type: 'stringParam_bbbb', params: [null], statements: [] }, null], statements: [] },
    ]],
  };

  return {
    name: '이름 충돌 테스트',
    speed: 60,
    scenes: [{ id: 'scene1', name: '장면 1' }],
    variables: [{ id: 'var1', name: '넉백횟수', variableType: 'variable', value: 0, visible: false, x: 0, y: 0 }],
    messages: [],
    functions: [{ id: 'fn01', type: 'normal', localVariables: [], useLocalVariables: false, content: JSON.stringify([[create]]) }],
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
        pictures: [{ id: 'pic1', name: '기본', fileurl: null, dimension: { width: 1, height: 1 } }],
        sounds: [],
      },
      script: JSON.stringify([[
        { type: 'when_run_button_click', params: [null], statements: [] },
        { type: 'func_fn01', params: [{ type: 'number', params: ['1'] }, { type: 'number', params: ['3'] }, null], statements: [] },
      ]]),
    }],
  } as unknown as RawEntity;
}

test('변수와 이름이 겹치는 라벨은 매개변수 이름으로 그대로 쓰지 않는다', () => {
  const result = decompileProject(paramClashProject(), []);

  // 매개변수가 변수 이름을 가리지 않으니, 본문의 대입은 전역 변수 대입으로 남는다.
  assert.match(result.source, /^function 걷기\(a, (?!넉백횟수\))[\p{L}\p{N}_]+\):$/mu);
  assert.match(result.source, /^ {2}넉백횟수 = [\p{L}\p{N}_]+$/mu);
  assert.doesNotMatch(result.source, /^ {2}넉백횟수 = 넉백횟수$/m);
});

test('이름이 겹쳐도 되돌린 함수는 다시 컴파일되어 전역 변수에 값을 넣는다', () => {
  const result = decompileProject(paramClashProject(), []);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tess-decompile-clash-'));
  const mainFile = path.join(dir, 'main.tess');
  fs.writeFileSync(mainFile, result.source);
  for (const asset of result.assets) {
    const target = path.join(dir, asset.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, asset.data);
  }

  const recompiled = compileProject(fs.readFileSync(mainFile, 'utf-8'), { path: mainFile, assetDirs: [dir] });
  assert.deepEqual(recompiled.errors, [], recompiled.errors.map((e) => e.message).join('\n'));

  const body = JSON.parse(recompiled.project!.functions[0].content)[0][0].statements[0];
  const write = body.find((block: any) => block.type === 'set_variable');
  assert.ok(write, '전역 변수 대입 블록이 남아 있어야 한다');
  const variable = recompiled.project!.variables.find((v: any) => v.name === '넉백횟수');
  assert.equal(write.params[0], variable!.id);
  assert.match(write.params[1].type, /^stringParam_/);
});

/**
 * 되돌린 소스를 다시 컴파일했을 때 값 블록·속성이 원본과 같은 값을 내는지 검사합니다.
 */
function valueProject(script: any[], extra: RawEntity = {}): RawEntity {
  return {
    name: '값 테스트',
    speed: 60,
    scenes: [{ id: 'scene1', name: '장면 1' }],
    variables: extra.variables ?? [],
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
      entity: { x: 0, y: 0, scaleX: 1, scaleY: 1, visible: true, ...(extra.entity ?? {}) },
      sprite: {
        pictures: [{ id: 'pic1', name: '기본', fileurl: null, dimension: { width: 10, height: 10 } }],
        sounds: extra.sounds ?? [],
      },
      script: JSON.stringify([[
        { type: 'when_run_button_click', params: [null], statements: [] },
        ...script,
      ]]),
    }],
  } as unknown as RawEntity;
}

/** 되돌린 소스(조각 파일까지)를 다시 컴파일해서 첫 오브젝트의 첫 스레드를 돌려준다. */
function recompiledThread(project: RawEntity) {
  const result = decompileProject(project, []);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tess-decompile-value-'));
  const mainFile = path.join(dir, 'main.tess');
  fs.writeFileSync(mainFile, result.source);
  for (const asset of result.assets) {
    const target = path.join(dir, asset.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, asset.data);
  }
  const recompiled = compileProject(result.source, { path: mainFile, assetDirs: [dir] });
  assert.deepEqual(recompiled.errors, [], recompiled.errors.map((e) => e.message).join('\n'));
  const fragment = result.assets.find((a) => a.path === 'objects/주인공.tess')!.data.toString('utf-8');
  return {
    source: fragment,
    warnings: result.warnings,
    blocks: JSON.parse(recompiled.project!.objects[0].script)[0] as any[],
    project: recompiled.project!,
  };
}

// 붓 계열의 색 자리에 들어가는 `color` 는 글상자의 `text_color` 와 같은 원시 블록인데,
// 표에 빠져 있어서 자리표시자 문자열로 나갔다 — 되돌린 작품의 선 색이 깨졌다.
test('붓 색 고르기(color) 블록은 색상 리터럴로 되돌아온다', () => {
  const color = (hex: string) => ({ type: 'color', params: [hex], statements: [] });
  const { source, warnings, blocks } = recompiledThread(valueProject([
    { type: 'set_color', params: [color('#ffdc69'), null], statements: [] },
    { type: 'set_fill_color', params: [color('#616161'), null], statements: [] },
  ]));

  assert.deepEqual(warnings, []);
  assert.match(source, /^ {2}draw_color = #ffdc69$/m);
  assert.match(source, /^ {2}fill_color = #616161$/m);
  assert.equal(blocks.find((b) => b.type === 'set_color').params[0], '#ffdc69');
  assert.equal(blocks.find((b) => b.type === 'set_fill_color').params[0], '#616161');
});

// char_at 을 slice(문자열, i, i) 로 옮기면 자리 번호가 두 번 계산된다 — 그 안에
// 무작위 수가 있으면 서로 다른 값이 나와 엉뚱한 글자를 집는다.
test('변수의 글자 하나 읽기는 이름[번호] 로 되돌려 자리 번호를 한 번만 계산한다', () => {
  const project = valueProject([
    {
      type: 'set_variable',
      params: ['v1', {
        type: 'char_at',
        params: [null, { type: 'get_variable', params: ['v1', null] }, null,
          { type: 'calc_rand', params: [null, { type: 'number', params: ['1'] }, null, { type: 'number', params: ['5'] }, null] }, null],
      }, null],
      statements: [],
    },
  ], { variables: [{ id: 'v1', name: '글자', variableType: 'variable', value: 0, visible: false, x: 0, y: 0 }] } as RawEntity);

  const { source, warnings, blocks } = recompiledThread(project);
  assert.deepEqual(warnings, []);
  assert.match(source, /^ {2}글자 = 글자\[random\(1, 5\)\]$/m);
  const value = blocks.find((b) => b.type === 'set_variable').params[1];
  assert.equal(value.type, 'char_at');
  assert.equal(value.params[3].type, 'calc_rand');
});

// 엔트리 소수점 부분(unnatural) 은 Tess 함수가 없어서 자리표시자 문자열로 나갔다 —
// 숫자 자리에 글자가 들어가 계산이 깨졌다. |x| mod 1 이 모든 x 에서 같은 값이다.
test('소수점 부분(unnatural) 은 같은 값을 내는 계산으로 되돌아온다', () => {
  const { source, warnings, blocks } = recompiledThread(valueProject([
    {
      type: 'move_x',
      params: [{ type: 'calc_operation', params: [null, { type: 'number', params: ['-1.3'] }, null, 'unnatural'] }, null],
      statements: [],
    },
  ]));

  assert.deepEqual(warnings, []);
  assert.match(source, /^ {2}x \+= \(abs\(-1\.3\) % 1\)$/m);
  const value = blocks.find((b) => b.type === 'move_x').params[0];
  assert.equal(value.type, 'quotient_and_mod');
  assert.equal(value.params[5], 'MOD');
  assert.equal(value.params[1].params[3], 'abs');
});

// 엔트리 calc_operation 은 연산자 이름의 첫 `_` 뒤를 잘라내고 고르기 때문에
// asin 과 asin_radian 이 같은 계산이다. 표에 없던 앞쪽 세 개도 같은 곳으로 보낸다.
test('역삼각함수의 도 단위 이름도 자리표시자 없이 되돌아온다', () => {
  for (const [entryName, tessName] of [['asin', 'asin'], ['acos', 'acos'], ['atan', 'atan']]) {
    const { source, warnings } = recompiledThread(valueProject([
      {
        type: 'move_x',
        params: [{ type: 'calc_operation', params: [null, { type: 'number', params: ['0.5'] }, null, entryName] }, null],
        statements: [],
      },
    ]));
    assert.deepEqual(warnings, [], entryName);
    assert.match(source, new RegExp(`^ {2}x \\+= ${tessName}\\(0\\.5\\)$`, 'm'));
  }
});

// 엔트리 키 목록(extern/util/static.js keyInputList)에 있는 키는 전부 되돌릴 수 있어야
// 한다. 이름이 없으면 판단은 자리표시자가 되고, when 머리는 스레드째로 주석이 된다.
test('엔트리 키 목록의 모든 키 코드가 그대로 되돌아온다', () => {
  const codes = [8, 9, 13, 16, 17, 18, 27, 32, 37, 38, 39, 40, 48, 57, 65, 90,
    186, 187, 188, 189, 190, 191, 192, 219, 220, 221, 222];
  const project = valueProject([]);
  project.objects[0].script = JSON.stringify(codes.map((code) => [
    { type: 'when_some_key_pressed', params: [null, String(code)], statements: [] },
    {
      type: '_if',
      params: [{ type: 'is_press_some_key', params: [String(code), null], statements: [] }, null],
      statements: [[{ type: 'move_x', params: [{ type: 'number', params: ['1'] }, null], statements: [] }]],
    },
  ]));

  const { warnings, project: recompiled } = recompiledThread(project);
  assert.deepEqual(warnings, []);

  const threads = JSON.parse(recompiled.objects[0].script);
  assert.deepEqual(threads.map((t: any[]) => Number(t[0].params[1])), codes);
  assert.deepEqual(
    threads.map((t: any[]) => Number(t[1].params[0].params[0])),
    codes,
    '판단 블록의 키 코드도 그대로여야 한다',
  );
});

// 엔트리는 크기를 배율로, Tess 는 퍼센트로 적는다. 퍼센트를 정수로 깎으면
// 51.3% 짜리 오브젝트가 51% 로 줄어든다.
test('배율은 퍼센트 소수점을 버리지 않고 되돌아온다', () => {
  const project = valueProject([], { entity: { scaleX: 0.513, scaleY: 1.564 } } as RawEntity);
  const { source, project: recompiled } = recompiledThread(project);

  assert.match(source, /^scale_x = 51\.3$/m);
  assert.match(source, /^scale_y = 156\.4$/m);
  assert.equal(recompiled.objects[0].entity.scaleX, 0.513);
  assert.equal(recompiled.objects[0].entity.scaleY, 1.564);
});

// 그림 크기는 컴파일러가 파일에서 정확히 재지만, 소리 길이는 mp3 머리말로 어림잡는
// 값이라 엔트리가 재 둔 값과 0.1초씩 어긋난다. 그 길이는 "재생하고 기다리기" 가
// 기다리는 시간이고, 0 이면 엔트리가 소리를 아예 안 읽어 들인다.
test('소리 길이는 원본 값을 늘 적는다', () => {
  const project = valueProject([], {
    sounds: [{ id: 'snd1', name: '짖는 소리', fileurl: null, ext: '.mp3', duration: 1.3 }],
  } as RawEntity);
  const { source, project: recompiled } = recompiledThread(project);

  assert.match(source, /^sound 짖는_소리 ".*\.mp3" for 1\.3 as "짖는 소리"$/m);
  assert.equal(recompiled.objects[0].sprite.sounds[0].duration, 1.3);
});
