/**
 * 확장 프로그램이 페이지에서 읽은 엔트리 작품을 tessvm 이 실행할 작품으로 바꾸는
 * 과정을 검사합니다. 브라우저에서 확장 프로그램이 받는 것은 파일이 아니라 작품 객체
 * 하나뿐이므로, 여기서도 리소스 바이트 없이 작품만 가지고 다룹니다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileProject } from '@tess/compiler';
import { readTar } from '@tess/decompiler';
import { Vm } from '@tess/vm';
import { buildForTessvm, markTessvmVariable, TESSVM_VARIABLE } from '../src/page/pipeline.ts';
import {
  DEFAULT_ENTRY_PATHS,
  pictureUrl,
  soundUrl,
  restoreAssetUrls,
  type EntryPaths,
} from '../src/page/assets.ts';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PATHS: EntryPaths = { ...DEFAULT_ENTRY_PATHS };

interface RawPicture {
  fileurl?: string;
  filename?: string;
  imageType?: string;
  dimension?: { width: number; height: number };
}
interface RawSound {
  fileurl?: string;
  filename?: string;
  ext?: string;
  duration?: number;
}
interface RawObject {
  name?: string;
  sprite?: { pictures?: RawPicture[]; sounds?: RawSound[] };
}
interface RawProject {
  [key: string]: unknown;
  name?: string;
  objects?: RawObject[];
  scenes?: unknown[];
  variables?: Array<Record<string, unknown>>;
}

/** Compiles one of the repository's own examples into an entry work. */
function exampleProject(file: string): RawProject {
  const source = fs.readFileSync(path.join(root, 'examples', file), 'utf-8');
  const result = compileProject(source, {
    path: path.join(root, 'examples', file),
    assetDirs: [path.join(root, 'examples')],
  });
  assert.ok(result.project, `${file} 을(를) 컴파일하지 못했습니다`);
  assert.deepEqual(result.errors, []);
  return result.project as unknown as RawProject;
}

/**
 * playentry.org 가 내려주는 모양으로 바꿉니다. 사이트의 작품은 `fileurl` 없이
 * `filename` 만 갖고 있고, 주소는 실행기가 그 이름으로 만들어 냅니다.
 */
function asSiteWork(project: RawProject): RawProject {
  const copy = JSON.parse(JSON.stringify(project)) as RawProject;
  for (const object of copy.objects ?? []) {
    for (const picture of object.sprite?.pictures ?? []) delete picture.fileurl;
    for (const sound of object.sprite?.sounds ?? []) delete sound.fileurl;
  }
  return copy;
}

/** `.ent` 예제의 project.json 만 읽습니다. 없으면 그 검사는 건너뜁니다. */
async function entProject(name: string): Promise<RawProject | null> {
  const file = path.join(root, 'examples', 'ent', name);
  if (!fs.existsSync(file)) return null;
  const entries = await readTar(fs.readFileSync(file));
  const found = entries.find((entry) => entry.name.endsWith('project.json'));
  return found ? (JSON.parse(found.data.toString('utf-8')) as RawProject) : null;
}

function unknownBlocksOf(project: unknown): string[] {
  const vm = new Vm({ renderer: null, audio: null });
  vm.load(project as never);
  return [...vm.unknownBlocks.keys()].sort();
}

/** 짝이 맞는 자리마다 주소가 원본이 쓰던 파일을 가리키는지 본다. */
function assertAssetsRestored(source: RawProject, built: RawProject): number {
  const sourceObjects = source.objects ?? [];
  const builtObjects = built.objects ?? [];
  assert.equal(builtObjects.length, sourceObjects.length);
  let checked = 0;
  for (let i = 0; i < sourceObjects.length; i += 1) {
    const pictures = sourceObjects[i]!.sprite?.pictures ?? [];
    const builtPictures = builtObjects[i]!.sprite?.pictures ?? [];
    assert.equal(builtPictures.length, pictures.length);
    for (let p = 0; p < pictures.length; p += 1) {
      assert.equal(builtPictures[p]!.fileurl, pictureUrl(pictures[p]!, PATHS));
      checked += 1;
    }
    const sounds = sourceObjects[i]!.sprite?.sounds ?? [];
    const builtSounds = builtObjects[i]!.sprite?.sounds ?? [];
    assert.equal(builtSounds.length, sounds.length);
    for (let s = 0; s < sounds.length; s += 1) {
      assert.equal(builtSounds[s]!.fileurl, soundUrl(sounds[s]!, PATHS));
      assert.equal(builtSounds[s]!.duration, sounds[s]!.duration);
      checked += 1;
    }
  }
  return checked;
}

const EXAMPLES = ['cat_run.tess', 'all_blocks.tess'];

for (const file of EXAMPLES) {
  test(`${file}: Tess 로 되돌려 다시 컴파일해도 같은 작품이다`, () => {
    const project = exampleProject(file);
    const result = buildForTessvm(project, { paths: PATHS, route: 'tess' });

    assert.equal(result.route, 'tess', `Tess 경로로 가지 못했습니다: ${result.warnings[0]}`);
    assert.deepEqual(result.errors, []);
    assert.ok(result.source && result.source.includes('scene'));

    const built = result.project as unknown as RawProject;
    assert.deepEqual(
      built.objects?.map((object) => object.name),
      project.objects?.map((object) => object.name),
    );
    assert.equal(built.scenes?.length, project.scenes?.length);
    assert.equal(built.variables?.length, project.variables?.length);
  });

  test(`${file}: 되돌린 작품에서 tessvm 이 실행할 수 있는 블록이 줄지 않는다`, () => {
    const project = exampleProject(file);
    const result = buildForTessvm(project, { paths: PATHS, route: 'tess' });
    assert.deepEqual(unknownBlocksOf(result.project), unknownBlocksOf(project));
  });

  test(`${file}: playentry 가 주는 모양(파일 이름만)에서도 주소를 되살린다`, () => {
    const project = asSiteWork(exampleProject(file));
    const result = buildForTessvm(project, { paths: PATHS, route: 'tess' });
    const built = result.project as unknown as RawProject;

    const checked = assertAssetsRestored(project, built);
    assert.ok(checked > 0);
    assert.equal(result.restored, checked);
    for (const object of built.objects ?? []) {
      for (const picture of object.sprite?.pictures ?? []) {
        assert.match(picture.fileurl ?? '', /^\/uploads\/[^/]{2}\/[^/]{2}\/image\//);
      }
    }
  });
}

for (const name of ['cat_run.ent', 'boss.ent', 'gamok.ent']) {
  test(`${name}: 실제 작품도 그대로 되돌아온다`, async (t) => {
    const project = await entProject(name);
    if (!project) return t.skip(`${name} 이 없습니다`);

    const result = buildForTessvm(project, { paths: PATHS, route: 'tess' });
    assert.equal(result.route, 'tess', `Tess 경로로 가지 못했습니다: ${result.warnings[0]}`);
    assert.deepEqual(result.errors, []);

    const built = result.project as unknown as RawProject;
    assert.deepEqual(
      built.objects?.map((object) => object.name),
      project.objects?.map((object) => object.name),
    );
    assert.equal(result.restored, assertAssetsRestored(project, built));
    assert.deepEqual(unknownBlocksOf(result.project), []);
  });
}

test('$tessvm 변수가 있으면 1 로 바뀐다', () => {
  const project = exampleProject('cat_run.tess');
  project.variables = [
    ...(project.variables ?? []),
    {
      name: TESSVM_VARIABLE,
      id: 'tsvm',
      value: '0',
      variableType: 'variable',
      visible: false,
      x: 0,
      y: 0,
      array: [],
      object: null,
      isCloud: false,
    },
  ];

  for (const route of ['tess', 'direct'] as const) {
    const result = buildForTessvm(project, { paths: PATHS, route });
    assert.equal(result.marked, true, `${route} 경로에서 변수를 표시하지 못했습니다`);
    const built = result.project as unknown as RawProject;
    const flag = built.variables?.find((variable) => variable.name === TESSVM_VARIABLE);
    assert.ok(flag, `${route} 경로에서 ${TESSVM_VARIABLE} 변수가 사라졌습니다`);
    assert.equal(flag.value, 1);
  }
});

test('$tessvm 변수가 없는 작품은 건드리지 않는다', () => {
  const project = exampleProject('cat_run.tess');
  const before = project.variables?.length ?? 0;
  const result = buildForTessvm(project, { paths: PATHS, route: 'tess' });
  assert.equal(result.marked, false);
  assert.equal((result.project as unknown as RawProject).variables?.length, before);
});

test('리스트 이름이 $tessvm 이어도 값을 바꾸지 않는다', () => {
  const project = { variables: [{ name: TESSVM_VARIABLE, variableType: 'list', array: [] }] };
  assert.equal(markTessvmVariable(project), false);
  assert.equal('value' in project.variables[0]!, false);
});

test('페이지가 준 작품은 그대로 두고 사본만 바꾼다', () => {
  const project = exampleProject('cat_run.tess');
  const snapshot = JSON.stringify(project);
  buildForTessvm(project, { paths: PATHS, route: 'tess' });
  buildForTessvm(project, { paths: PATHS, route: 'direct' });
  assert.equal(JSON.stringify(project), snapshot);
});

test('작품을 그대로 실행하는 길에서도 주소는 절대 경로가 된다', () => {
  const project = asSiteWork(exampleProject('cat_run.tess'));
  const result = buildForTessvm(project, { paths: PATHS, route: 'direct' });
  assert.equal(result.route, 'direct');
  assert.equal(result.source, null);
  const built = result.project as unknown as RawProject;
  assert.equal(result.restored, assertAssetsRestored(project, built));
});

test('Tess 로 되돌리지 못하면 작품을 그대로 실행한다', () => {
  // `scenes` 가 없으면 디컴파일러가 장면을 훑다가 멈춘다.
  const broken = { name: '망가진 작품', objects: [], variables: [] } as unknown as RawProject;
  const result = buildForTessvm(broken, { paths: PATHS, route: 'tess' });
  assert.equal(result.route, 'direct');
  assert.match(result.warnings[0] ?? '', /그대로 실행/);
});

test('주소 규칙은 엔트리가 파일을 찾는 규칙과 같다', () => {
  const paths: EntryPaths = {
    defaultPath: 'https://cdn.playentry.org',
    soundPath: 'sound/',
    mediaFilePath: '/lib/@entrylabs/entry/images/',
  };
  assert.equal(
    pictureUrl({ filename: 'abcdefgh1234' }, paths),
    'https://cdn.playentry.org/uploads/ab/cd/image/abcdefgh1234.png',
  );
  assert.equal(
    pictureUrl({ filename: 'abcdefgh1234', imageType: 'svg' }, paths),
    'https://cdn.playentry.org/uploads/ab/cd/image/abcdefgh1234.svg',
  );
  assert.equal(
    soundUrl({ filename: 'zzxxccvv0099', ext: '.wav' }, paths),
    'https://cdn.playentry.org/uploads/zz/xx/sound/zzxxccvv0099.wav',
  );
  // 이미 주소가 있으면 그대로 쓴다.
  assert.equal(pictureUrl({ fileurl: '/uploads/aa/bb/image/x.png' }, paths), '/uploads/aa/bb/image/x.png');
  // 예전 작품이 가리키는 번들 경로는 사이트가 지금 서비스하는 경로로 옮긴다.
  assert.equal(
    pictureUrl({ fileurl: './bower_components/entryjs/images/_1x1.png' }, paths),
    '/lib/@entrylabs/entry/images/_1x1.png',
  );
  // 이름도 주소도 없으면 되살릴 것이 없다.
  assert.equal(pictureUrl({}, paths), null);
  assert.equal(soundUrl({}, paths), null);
});

test('오브젝트 수가 달라도 이름으로 짝을 찾는다', () => {
  const original = {
    objects: [
      { name: '가', sprite: { pictures: [{ filename: 'aaaabbbbcccc' }] } },
      { name: '나', sprite: { pictures: [{ filename: 'ddddeeeeffff' }] } },
    ],
  };
  const built = {
    objects: [{ name: '나', sprite: { pictures: [{ fileurl: 'temp/zz/zz/image/z.png' }] } }],
  };
  assert.equal(restoreAssetUrls(original, built, PATHS), 1);
  assert.equal(
    (built.objects[0]!.sprite.pictures[0] as { fileurl: string }).fileurl,
    '/uploads/dd/dd/image/ddddeeeeffff.png',
  );
});
