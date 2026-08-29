// `tess run` 이 띄우는 미리보기 서버 검사
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileProject } from '../src/compiler/index.js';
import { serveProject, findLocalRuntime } from '../src/player/server.js';
import { assetRoutes } from '../src/player/asset-routes.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function compileExample(name = 'examples/all_blocks.tess') {
  const file = path.join(root, name);
  const result = compileProject(fs.readFileSync(file, 'utf-8'), { path: file });
  assert.deepEqual(result.errors, []);
  return { ...result, assetDirs: [path.dirname(file)] };
}

async function withServer(options, body) {
  const result = compileExample(options.example);
  const server = await serveProject({
    project: result.project,
    assets: result.assets,
    assetDirs: result.assetDirs,
    name: result.project.name,
    port: 0,
    ...options,
  });
  try {
    await body(server, result);
  } finally {
    await server.close();
  }
}

test('작품과 실행 페이지를 내보낸다', async () => {
  await withServer({}, async (server, result) => {
    const page = await (await fetch(server.url)).text();
    assert.match(page, /블록 검증/);
    assert.match(page, /장면 2 · 오브젝트 4 · 블록 \d+/);
    assert.match(page, /Entry\.loadProject/);

    const project = await (await fetch(`${server.url}project.json`)).json();
    assert.equal(project.scenes.length, result.project.scenes.length);
    assert.equal(project.objects.length, result.project.objects.length);
  });
});

test('실행하기 전에 글상자 폰트를 먼저 내려받는다', async () => {
  // 커스텀 폰트(나눔고딕 · DungGeunMo ...)는 @font-face 로 "선언"만 돼 있고 실제 파일은
  // 처음 쓰일 때 늦게 도착한다. 캔버스는 폰트가 늦게 와도 알아서 다시 그려주지 않으므로,
  // 시작하자마자 보이는 글상자가 대체 글꼴로 굳어 버리지 않으려면 Entry.loadProject/
  // toggleRun 으로 블록을 실행하기 '전에' 그 프로젝트가 쓰는 폰트를 전부 미리 내려받아
  // 둬야 한다 — 이 순서가 페이지 스크립트에 실제로 지켜지는지를 검사한다.
  await withServer({}, async (server) => {
    const page = await (await fetch(server.url)).text();

    const preloadCall = page.indexOf('preloadTextFonts(project)');
    const loadProjectCall = page.indexOf('Entry.loadProject(project)');
    assert.notEqual(preloadCall, -1, '폰트를 미리 불러오는 코드가 있어야 한다');
    assert.notEqual(loadProjectCall, -1);
    assert.ok(
      preloadCall < loadProjectCall,
      '폰트를 먼저 불러온 다음에 Entry.loadProject 를 불러야 한다',
    );

    // preloadTextFonts 자체는 document.fonts.load 로 실제 다운로드를 트리거해야 한다
    // (그냥 CSS 를 <link> 로 붙이기만 해서는 폰트가 실제로 쓰이기 전까진 안 받아진다).
    assert.match(page, /document\.fonts\.load/);
    assert.match(page, /document\.fonts\.ready/);
  });
});

test('작품 파일(.ent)을 내려받을 수 있다', async () => {
  await withServer({}, async (server) => {
    const page = await (await fetch(server.url)).text();
    const href = page.match(/href="\/([^"]+\.ent)"/)[1];
    const response = await fetch(server.url + encodeURIComponent(href));
    assert.equal(response.status, 200);

    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.length % 512, 0);
    assert.equal(bytes.subarray(0, 100).toString('utf-8').replace(/\0+$/, ''), 'temp/project.json');
  });
});

test('리소스를 디스크에 있는 그대로의 주소로 내보낸다', async () => {
  await withServer({ example: 'examples/cat_run.tess' }, async (server, result) => {
    const project = await (await fetch(`${server.url}project.json`)).json();
    const pictures = project.objects.flatMap((object) => object.sprite.pictures);
    const cat = pictures.find((picture) => picture.fileurl.endsWith('cat_idle.png'));

    // 엔트리의 temp/<해시> 주소가 아니라 파일이 실제로 있는 경로를 가리킨다
    assert.equal(cat.fileurl, '/cat_idle.png');

    const served = await fetch(server.url + cat.fileurl.slice(1));
    assert.equal(served.status, 200);
    assert.deepEqual(
      Buffer.from(await served.arrayBuffer()),
      fs.readFileSync(path.join(root, 'examples/cat_idle.png')),
    );

    // 엔트리가 쓰던 주소도 그대로 답한다
    const hashed = result.assets.find((asset) => asset.source.endsWith('cat_idle.png')).target;
    assert.equal((await fetch(`${server.url}${hashed}`)).status, 200);
  });
});

test('리소스 폴더 밖의 파일은 엔트리의 원래 주소를 그대로 쓴다', () => {
  const { files, rewrites } = assetRoutes(
    [{ source: '/그밖/멀리.png', target: 'temp/aa/bb/image/x.png' }],
    ['/작품'],
  );
  assert.equal(rewrites.size, 0);
  assert.equal(files.get('/temp/aa/bb/image/x.png'), '/그밖/멀리.png');
});

test('두 폴더가 같은 이름을 주장하면 어느 쪽도 그 주소를 쓰지 않는다', () => {
  const { rewrites } = assetRoutes(
    [
      { source: path.join('/작품/가', '고양이.png'), target: 'temp/aa/bb/image/1.png' },
      { source: path.join('/작품/나', '고양이.png'), target: 'temp/cc/dd/image/2.png' },
    ],
    ['/작품/가', '/작품/나'],
  );
  assert.equal(rewrites.size, 0);
});

test('없는 주소는 404 를 준다', async () => {
  await withServer({}, async (server) => {
    assert.equal((await fetch(`${server.url}없는것`)).status, 404);
  });
});

test('설치된 entryjs 가 없으면 CDN 을 가리킨다', async () => {
  await withServer({ cwd: os.tmpdir() }, async (server) => {
    assert.match(server.runtime, /^CDN/);
    const page = await (await fetch(server.url)).text();
    // @entrylabs/entry 본체는 unpkg 에서 받는다 — jsDelivr 는 이 패키지 전체 크기가
    // 150MB 한도를 넘어 entry.min.js 조차 403 으로 막는다(server.js CDN 상수 주석 참고).
    assert.match(page, /unpkg\.com\/@entrylabs\/entry/);
    // 나머지 서드파티 라이브러리(jquery, createjs, @entrylabs/tool ...)는 jsDelivr 에서 받는다
    assert.match(page, /cdn\.jsdelivr\.net/);
    // 못 불러왔을 때 안내가 페이지에 들어 있다
    assert.match(page, /엔트리 실행기를 불러오지 못했습니다/);
    assert.match(page, /playentry\.org/);
  });
});

test('설치된 entryjs 가 있으면 그것을 내보낸다', async (t) => {
  const fake = fs.mkdtempSync(path.join(os.tmpdir(), 'tess-runtime-'));
  const dist = path.join(fake, 'node_modules', '@entrylabs', 'entry', 'dist');
  fs.mkdirSync(dist, { recursive: true });
  fs.writeFileSync(path.join(dist, 'entry.min.js'), 'window.Entry = {};');
  t.after(() => fs.rmSync(fake, { recursive: true, force: true }));

  assert.ok(findLocalRuntime(fake));

  await withServer({ cwd: fake }, async (server) => {
    assert.match(server.runtime, /^설치된/);
    const page = await (await fetch(server.url)).text();
    assert.match(page, /src="\/lib\/dist\/entry\.min\.js"/);

    const runtime = await fetch(`${server.url}lib/dist/entry.min.js`);
    assert.equal(runtime.status, 200);
    assert.equal(await runtime.text(), 'window.Entry = {};');
  });
});

test('lib 바깥 파일은 주지 않는다', async (t) => {
  const fake = fs.mkdtempSync(path.join(os.tmpdir(), 'tess-runtime-'));
  const dist = path.join(fake, 'node_modules', '@entrylabs', 'entry', 'dist');
  fs.mkdirSync(dist, { recursive: true });
  fs.writeFileSync(path.join(dist, 'entry.min.js'), 'x');
  fs.writeFileSync(path.join(fake, 'secret.txt'), '비밀');
  t.after(() => fs.rmSync(fake, { recursive: true, force: true }));

  await withServer({ cwd: fake }, async (server) => {
    const escaped = await fetch(`${server.url}lib/${encodeURIComponent('../../../secret.txt')}`);
    assert.equal(escaped.status, 404);
  });
});

test('엔트리 글꼴 CSS 를 하나씩 <link> 로 직접 붙인다', async () => {
  // 묶음 파일 fonts_2023_10.css 는 @font-face 가 아니라 @import 스물두 줄이다.
  // @import 는 그 CSS 를 받아 파싱한 뒤에야 다음 요청이 시작되므로 글꼴이 늦게
  // 도착하고, 그 사이에 preloadTextFonts 가 글꼴을 찾지 못한 채 넘어간다.
  await withServer({}, async (server) => {
    const page = await (await fetch(server.url)).text();
    const hrefs = [...page.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map((m) => m[1]);
    const fontHrefs = hrefs.filter((href) => href.includes('/uploads/fonts/'));

    assert.equal(fontHrefs.length, 22, fontHrefs.join('\n'));
    for (const href of fontHrefs) {
      assert.match(href, /^https:\/\/entry-cdn\.pstatic\.net\/uploads\/fonts\/[\w.]+\.css$/);
    }
    // 실제 글꼴이 아니라 @import 목록만 담긴 묶음 파일은 더 이상 쓰지 않는다
    assert.ok(!fontHrefs.some((href) => href.includes('fonts_2023_10')), 'fonts_2023_10.css 는 빼야 한다');
    for (const name of ['nanum_gothic', 'dunggeunmo_2023', 'd2coding_2023', 'SDShabang_2023']) {
      assert.ok(fontHrefs.some((href) => href.endsWith('/' + name + '.css')), name + ' 이 빠졌다');
    }
  });
});

test('캔버스 그리기 해상도는 처음 한 번만 정하고, 그 뒤에는 CSS 크기만 바꾼다', async () => {
  // width/height 속성을 바꾸면 그리던 내용이 지워지고 stage 변환도 어긋나므로,
  // 창 크기가 바뀔 때는 CSS 크기만 건드려야 한다.
  await withServer({}, async (server) => {
    const ui = await (await fetch(`${server.url}debug-ui.js`)).text();

    assert.match(ui, /const setCanvasResolution = \(\) => \{/);
    assert.match(ui, /if \(resolutionFixed\) return;/);
    assert.match(ui, /resolutionFixed = true;/);

    const layout = ui.slice(ui.indexOf('function layoutCanvas()'), ui.indexOf('window.addEventListener(\'resize\''));
    assert.match(layout, /canvas\.style\.width/);
    assert.match(layout, /canvas\.style\.height/);
    assert.doesNotMatch(layout, /canvasEl\.width\s*=/);
    assert.doesNotMatch(layout, /canvasEl\.height\s*=/);
  });
});

test('물어보기 입력창을 캔버스 해상도에 맞춰 키운다', async () => {
  // 엔트리는 입력창을 캔버스 픽셀 좌표에 그대로 그린다(640x360 기준). 우리 캔버스는
  // 그보다 크므로, 그 배율만큼 같이 키우지 않으면 왼쪽 위에 작게 그려진다.
  await withServer({}, async (server) => {
    const ui = await (await fetch(`${server.url}debug-ui.js`)).text();

    assert.match(ui, /const ENTRY_BUFFER_WIDTH = 640;/);
    const scale = ui.slice(ui.indexOf('const scaleInputFieldToBuffer'), ui.indexOf('const setCanvasResolution'));
    assert.match(scale, /stage\.showInputField = /);
    for (const name of ['fontSize', 'borderWidth', 'borderRadius', 'padding', 'width', 'height', 'x', 'y']) {
      assert.ok(scale.includes(`'${name}'`), `${name} 도 같이 키워야 한다`);
    }
    // 길이를 먼저 맞춘 뒤 위치를 옮겨야 마지막 setter 가 다시 그린다
    assert.ok(scale.indexOf("'width'") < scale.indexOf("'x'"));
    assert.ok(ui.includes('scaleInputFieldToBuffer(bufferW);'));
  });
});

test('무대 배치가 바뀌면 엔트리가 캐시한 캔버스 위치를 새로 잰다', async () => {
  // 엔트리는 창 크기가 바뀔 때만 _boundRect 를 다시 재므로, 디버그 패널이 무대를
  // 밀어내면 마우스 좌표 블록이 옛날 위치로 계산한다.
  await withServer({}, async (server) => {
    const ui = await (await fetch(`${server.url}debug-ui.js`)).text();

    assert.match(ui, /const refreshBoundRect = \(\) => \{/);
    assert.match(ui, /stage\.updateBoundRect\(\)/);

    const layout = ui.slice(ui.indexOf('function layoutCanvas()'), ui.indexOf('window.addEventListener(\'resize\''));
    assert.match(layout, /refreshBoundRect\(\);/);
    // 패널이 열릴 때 무대는 CSS 전환으로 옆으로 밀리므로 끝난 뒤 한 번 더 잰다
    assert.match(ui, /propertyName === 'padding-right'/);
  });
});

test('디버그 UI 와 preact 를 모듈로 내보낸다', async () => {
  await withServer({}, async (server) => {
    const page = await (await fetch(server.url)).text();
    assert.match(page, /<script type="module" src="\/debug-ui\.js"><\/script>/);

    const ui = await fetch(`${server.url}debug-ui.js`);
    assert.equal(ui.status, 200);
    const uiSource = await ui.text();
    const preactFile = uiSource.match(/from '\/preact\/([^']+)'/)[1];
    assert.equal((await fetch(`${server.url}preact/${preactFile}`)).status, 200);
    // preact 폴더 바깥은 주지 않는다
    const escaped = await fetch(`${server.url}preact/${encodeURIComponent('../../../package.json')}`);
    assert.equal(escaped.status, 404);
  });
});

// --- 부스트 모드 --------------------------------------------------------------

test('run --boost 는 엔트리를 부스트 모드(WebGL 렌더러)로 띄운다', async () => {
  // 부스트 모드는 엔트리 만들기 화면에서는 못 켜지만, 실행기 자체는 Entry.init 의
  // useWebGL 하나로 그 모드로 돈다(GEHelper.INIT).
  await withServer({ boost: true }, async (server) => {
    assert.match(await (await fetch(server.url)).text(), /useWebGL: true/);
  });
  await withServer({}, async (server) => {
    assert.match(await (await fetch(server.url)).text(), /useWebGL: false/);
  });
});

test('부스트 모드는 실행기가 CDN 이어도 기본 그림을 같은 origin 으로 내보낸다', async () => {
  // entryjs 는 기본 그림을 crossOrigin 없이 new Image() 로 받는다
  // (GEHelper.newSpriteWithCallback). WebGL 은 그런 그림을 텍스처로 못 올려서
  // texImage2D 가 SecurityError 로 막히고, 그 프레임이 통째로 안 그려진다.
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'tess-boost-'));
  try {
    await withServer({ cwd, boost: true }, async (server) => {
      const page = await (await fetch(server.url)).text();
      assert.match(page, /libDir: "\/lib"/);
      // 스크립트는 그대로 CDN 에서 받는다 — 텍스처가 아니라 막힐 일이 없다
      assert.match(page, /src="https:\/\/unpkg\.com\/@entrylabs\/entry@[\d.]+\/dist\/entry\.min\.js"/);
    });
    // 부스트가 아니면 예전처럼 기본 그림도 CDN 에서 바로 받는다
    await withServer({ cwd }, async (server) => {
      assert.match(await (await fetch(server.url)).text(), /libDir: "https:\/\/unpkg\.com\//);
    });
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('부스트 모드에서는 캔버스 버퍼 대신 렌더러 해상도를 올린다', async () => {
  // PIXI 가 캔버스를 갖고 있어서, 몰래 canvasEl.width 를 바꾸면 화면 한 구석에만 그린다.
  // 해상도를 올리면 무대는 엔트리의 640x360 좌표계에 그대로 남는다.
  await withServer({}, async (server) => {
    const ui = await (await fetch(`${server.url}debug-ui.js`)).text();
    const fn = ui.slice(ui.indexOf('const setCanvasResolution'), ui.indexOf('const refreshBoundRect'));
    assert.match(fn, /renderer\.resolution = bufferW \/ ENTRY_BUFFER_WIDTH;/);
    assert.match(fn, /renderer\.resize\(ENTRY_BUFFER_WIDTH, ENTRY_BUFFER_HEIGHT\)/);
    const pixiBranch = fn.slice(fn.indexOf('if (renderer'), fn.indexOf('} else {'));
    assert.doesNotMatch(pixiBranch, /canvasEl\.(width|height)\s*=/);
  });
});

test('부스트 모드에서 클릭 판정도 올린 해상도를 따라간다', async () => {
  // PIXI 의 InteractionManager 는 setTargetElement 때 받은 해상도를 따로 들고 있다가
  // 캔버스 버퍼 좌표를 그 값으로 나눈다(mapPositionToPoint). 렌더러만 올리면 판정은
  // 1 로 남아서, 좌표 표시는 멀쩡한데 실제보다 배율만큼 왼쪽 위를 눌러야 맞는다.
  await withServer({}, async (server) => {
    const ui = await (await fetch(`${server.url}debug-ui.js`)).text();
    const fn = ui.slice(ui.indexOf('const setCanvasResolution'), ui.indexOf('const refreshBoundRect'));
    assert.match(fn, /interaction\.resolution = renderer\.resolution;/);
    assert.ok(fn.indexOf('renderer.resolution =') < fn.indexOf('interaction.resolution ='),
      '렌더러 해상도를 정한 다음에 판정 해상도를 맞춰야 한다');
  });
});

test('디버그 패널의 부스트 모드 흉내내기는 그대로 남는다', async () => {
  // --boost 로 켠 상태에서 끈 경우를(그 반대도) 테스트할 수 있어야 하므로, 블록이
  // 돌려주는 값을 바꾸는 흉내내기는 실제 렌더러와 따로 논다.
  await withServer({}, async (server) => {
    const ui = await (await fetch(`${server.url}debug-ui.js`)).text();
    assert.match(ui, /wrap\('is_boost_mode', \(\) => choice\(state\.env\.boost\)\)/);
    assert.match(ui, /'env-boost'/);
    // 실제 렌더러는 패널에 표시만 한다 (다시 그리려면 반응형 상태여야 한다)
    assert.match(ui, /realBoost: false,/);
    assert.match(ui, /state\.realBoost = Boolean\(Entry\.options && Entry\.options\.useWebGL\)/);
  });
});
