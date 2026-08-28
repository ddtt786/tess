// Verifies decompilation (.ent -> Tess) defaults to use/useobject/usetext: one
// fragment file per object (objects/name.tess), with main.tess holding only a
// useobject/usetext line (SPEC-ADDENDUM.md 1.2).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { decompileProject } from '../src/decompiler/index.js';
import { compileProject } from '../src/compiler/index.js';

/** Minimal project.json with one sprite and a trivial script; sceneCount picks the number of scenes. */
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

  // main.tess should hold only a useobject/usetext line, not an inline object/text block.
  assert.match(result.source, /useobject "objects\/주인공\.tess"/);
  assert.match(result.source, /usetext "objects\/점수판\.tess"/);
  assert.doesNotMatch(result.source, /object "주인공"/);
  assert.doesNotMatch(result.source, /text "점수판"/);

  const fragmentPaths = result.assets.map((a) => a.path).sort();
  assert.deepEqual(fragmentPaths, ['objects/점수판.tess', 'objects/주인공.tess']);

  // The fragment file itself has no object/text wrapper (starts at indent 0).
  const heroFragment = result.assets.find((a) => a.path === 'objects/주인공.tess').data.toString('utf-8');
  assert.doesNotMatch(heroFragment, /^object /m);
  assert.match(heroFragment, /^when start do$/m);
  assert.match(heroFragment, /^ {2}wait 1$/m); // when body is indented one level
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
//  Decompiling the "literal shape/sound id in a string" trick
//
//  Entry resolves a shape/sound value by id, then name, then registration order,
//  so a literal string holding the real Entry id works even without picking from
//  a list. Recompiling would otherwise reassign ids and break the reference, so
//  the decompiler must resolve such a literal id back to its name first.
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
        // The trick: a literal string holding the real Entry id, not a
        // get_pictures/get_sounds block picked from a list.
        { type: 'sound_something_with_block', params: [literal('xk9q'), null], statements: [] },
        { type: 'change_to_some_shape', params: [literal('0cdd'), null], statements: [] },
        // A literal number means "switch to the nth costume," not the id trick.
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
  // "switch to nth costume" doesn't collide with the literal-id case, so it stays a number.
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
//  coordinate_object's picture_index/picture_name dropdown values (alongside
//  x/y/direction/rotation/size) must decompile without a placeholder for
//  scripts using costume/costume_number.
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
//  Decompiling a hardcoded object-specific shape id inside a function body
//  (SPEC-ADDENDUM.md 1.4).
//
//  Entry functions are global, but many projects hardcode one object's shape id
//  inside a function to fake a "private" function. Resolving that id to a name
//  is unsafe there — the caller may not have a costume with that name — so the
//  decompiler keeps the id and adds `force id` to the costume declaration so
//  recompiling reproduces the exact same id.
// ---------------------------------------------------------------------------
// A shape value can be a hand-written literal string (text block) or a
// get_pictures block picked from the editor dropdown; both must be handled
// identically inside a function.
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
          // Refers to the shape's real Entry id, not the costume name "점프".
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
    assert.match(result.source, /^ {2}costume = "qio1"$/m); // stays an id inside a function

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
    assert.equal(block.params[0], 'qio1'); // refers to the same shape regardless of caller
  });
}

// ---------------------------------------------------------------------------
//  Entry's built-in object (walking Entrybot) shapes/sounds.
//
//  Built-in resources aren't in the .ent bundle — project.json points at files
//  inside the Entry runtime bundle (`./bower_components/entry-js/images/media/...`).
//  Copying that path verbatim would break recompilation, so the decompiler must
//  extract the real files from the installed entryjs package.
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

  // A bower_components path must never leak into the source — no such file exists.
  assert.doesNotMatch(fragment, /bower_components/);
  // A bundled file omits explicit size/duration; the compiler measures the file
  // itself, so replacing the asset doesn't require updating numbers by hand.
  assert.match(fragment, /^default costume 엔트리봇_걷기1 "assets\/image\/엔트리봇_엔트리봇_걷기1\.svg"$/m);
  assert.match(fragment, /^costume 엔트리봇_걷기2 "assets\/image\/엔트리봇_엔트리봇_걷기2\.svg"$/m);
  assert.match(fragment, /^sound 강아지_짖는_소리 "assets\/sound\/엔트리봇_강아지_짖는_소리\.mp3"$/m);

  for (const relative of ['assets/image/엔트리봇_엔트리봇_걷기1.svg', 'assets/image/엔트리봇_엔트리봇_걷기2.svg', 'assets/sound/엔트리봇_강아지_짖는_소리.mp3']) {
    const asset = result.assets.find((a) => a.path === relative);
    assert.ok(asset && asset.data.length > 0, `${relative} must contain actual file data`);
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
  // Entry trusts the dimension field verbatim for rendering; it must not fall back
  // to 100x100 from a missing file, and must match entrybot1/2.svg's viewBox.
  assert.deepEqual(sprite.pictures[0].dimension, { width: 144, height: 246 });
  assert.deepEqual(sprite.pictures[1].dimension, { width: 144, height: 246 });
  // Image files must actually ship with the project (a bower_components path had none).
  assert.equal(recompiled.assets.length, 3);
});

test('모양 없이 만든 "새 오브젝트"의 _1x1.png 도 꺼내 오고, 선언된 크기를 그대로 지킨다', () => {
  // Entry trusts project.json's dimension rather than measuring the file, so a
  // 1x1 _1x1.png placeholder scaled to 960x540 needs an explicit `size` in the
  // decompiled source or it recompiles back down to 1x1.
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
//  Function header chains with a mid-chain label or a boolean parameter
//  (SPEC-ADDENDUM.md 4.6).
//
//  An Entry function header alternates labels and parameter slots. The decompiler
//  must walk the whole chain rather than stop at the first label or boolean slot
//  after the leading label, or later parameters and their body references are lost.
// ---------------------------------------------------------------------------
const fieldLabel = (text, next) => ({ type: 'function_field_label', params: [text, next] });
const fieldString = (id, next) => ({
  type: 'function_field_string', params: [{ type: `stringParam_${id}`, params: [] }, next],
});
const fieldBoolean = (id, next) => ({
  type: 'function_field_boolean', params: [{ type: `booleanParam_${id}`, params: [null] }, next],
});

/** Project with a single function header chain; body holds the function's body blocks. */
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
  // label-arg-arg: only the leading label is the function name; args get auto names
  assert.equal(declarationOf(fieldLabel('스폰', fieldString('p1', fieldString('p2', null)))),
    'function 스폰(a, b):');

  // label-arg-label-arg: a mid-chain label names the argument right after it
  assert.equal(declarationOf(fieldLabel('스폰', fieldString('p1', fieldLabel('체력', fieldString('p2', null))))),
    'function 스폰(a, 체력):');

  // label-arg-label: a trailing label with no argument has nowhere to attach
  assert.equal(declarationOf(fieldLabel('스폰', fieldString('p1', fieldLabel('체력', null)))),
    'function 스폰(a):');

  // A boolean slot is a parameter too, and round-trips as `name?`
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
  assert.deepEqual(result.warnings, []); // no placeholder blocks should remain
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
  // A when header sits at indent 0 in a fragment file, so its body must still be
  // indented one level deeper, not left at the header's own level.
  const result = decompileProject(minimalProject(1), []);
  const fragment = result.assets.find((a) => a.path === 'objects/주인공.tess').data.toString('utf-8');
  assert.equal(fragment, 'x = 10\n\n\nwhen start do\n  wait 1\nend\n');
});

test('파일을 담은 모양·소리는 크기·길이를 적지 않고, 1×1 빈 그림만 예외다', () => {
  // Size/duration are omitted by default since the compiler measures the file
  // itself; a blank "new object"'s _1x1.png placeholder is the exception, since
  // its measured 1x1 size isn't the real one.
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
  assert.match(result.source, /^ {2}if 살았나:$/m); // written without ? in the body

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
//  Avoiding resource filename collisions.
//
//  Shape/sound names are per-object, so Entry's auto-generated "새그림" name is
//  likely to repeat across objects. Writing such names verbatim as filenames
//  would let a later save overwrite an earlier one.
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
      // Both objects use the same "새그림" name but point at different files.
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

/** Fake tar entries with distinct content per fileurl referenced in project.json. */
const fakeEntries = (project) => (project.objects ?? []).flatMap((object) => [
  ...(object.sprite.pictures ?? []).map((p) => ({ name: p.fileurl, data: Buffer.from(object.name + ' 그림') })),
  ...(object.sprite.sounds ?? []).map((s) => ({ name: s.fileurl, data: Buffer.from(object.name + ' 소리') })),
]);

test('모양 이름이 겹쳐도 오브젝트 이름을 붙여서 파일이 안 덮인다', () => {
  const project = samePictureNameProject(1);
  const result = decompileProject(project, fakeEntries(project));

  const images = result.assets.filter((a) => a.path.startsWith('assets/image/')).map((a) => a.path);
  assert.deepEqual(images.sort(), ['assets/image/엔트리봇_새그림.png', 'assets/image/치로_새그림.png']);

  // The two files' contents must actually differ (neither overwrote the other).
  const contents = result.assets
    .filter((a) => a.path.startsWith('assets/image/'))
    .map((a) => a.data.toString('utf-8'));
  assert.equal(new Set(contents).size, 2);

  // Each object's fragment file must reference its own asset.
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
  // Point both objects at the same file.
  project.objects[1].sprite.pictures[0].fileurl = project.objects[0].sprite.pictures[0].fileurl;
  const result = decompileProject(project, fakeEntries(project));

  const images = result.assets.filter((a) => a.path.startsWith('assets/image/'));
  assert.equal(images.length, 1);
  // Both fragment files must reference that one asset.
  for (const name of ['치로', '엔트리봇']) {
    const fragment = result.assets.find((a) => a.path === `objects/${name}.tess`).data.toString('utf-8');
    assert.match(fragment, new RegExp(images[0].path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('경로가 그래도 겹치면 뒤에 번호를 붙인다', () => {
  // Object names are normally deduplicated; this checks the last-resort fallback.
  const project = samePictureNameProject(1);
  project.objects[1].name = '치로'; // same name -> safeIdentifier renames it to 치로_2
  const result = decompileProject(project, fakeEntries(project));

  const images = result.assets.filter((a) => a.path.startsWith('assets/image/')).map((a) => a.path);
  assert.equal(images.length, 2);
  assert.equal(new Set(images).size, 2, images.join(', '));
});
