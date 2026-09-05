/**
 * `tess run` 명령어를 통해 실행되는 미리보기 서버의 동작을 검증합니다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileProject } from '@tess/compiler';
import { serveProject, findLocalRuntime } from '@tess/player';
import { assetRoutes } from '@tess/player';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function compileExample(name = 'examples/all_blocks.tess') {
  const file = path.join(root, name);
  const result = compileProject(fs.readFileSync(file, 'utf-8'), { path: file });
  assert.deepEqual(result.errors, []);
  return { ...result, assetDirs: [path.dirname(file)] };
}

async function withServer(options: any, body: any) {
  const result = compileExample(options.example);
  const server = await serveProject({
    project: result.project,
    assets: result.assets,
    assetDirs: result.assetDirs,
    name: result.project!.name,
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
  await withServer({}, async (server: any, result: any) => {
    const page = await (await fetch(server.url)).text();
    assert.match(page, /블록 검증/);
    assert.match(page, /장면 3 · 오브젝트 5 · 블록 \d+/);
    assert.match(page, /Entry\.loadProject/);

    const project = await (await fetch(`${server.url}project.json`)).json();
    assert.equal(project.scenes.length, result.project.scenes.length);
    assert.equal(project.objects.length, result.project.objects.length);
  });
});

test('실행하기 전에 글상자 폰트를 먼저 내려받는다', async () => {
  /**
   * 커스텀 폰트(나눔고딕, DungGeunMo 등)는 `@font-face`로 선언만 되어 있고, 
   * 실제 파일은 화면에 렌더링될 때 지연 로딩됩니다. 캔버스는 폰트가 늦게 로드되더라도 
   * 자동으로 다시 그리지 않으므로, 실행 직후 글상자가 기본 폰트로 렌더링되는 문제를 방지해야 합니다.
   * 이를 위해 `Entry.loadProject` 및 `toggleRun`이 실행되기 전에 프로젝트에서 사용하는 모든 폰트를 미리 로드합니다.
   * 이 테스트는 페이지 스크립트에서 해당 순서가 정확히 지켜지는지 검증합니다.
   */
  await withServer({}, async (server: any) => {
    const page = await (await fetch(server.url)).text();

    const preloadCall = page.indexOf('preloadTextFonts(project)');
    const loadProjectCall = page.indexOf('Entry.loadProject(project)');
    assert.notEqual(preloadCall, -1, '폰트를 미리 불러오는 코드가 있어야 한다');
    assert.notEqual(loadProjectCall, -1);
    assert.ok(
      preloadCall < loadProjectCall,
      '폰트를 먼저 불러온 다음에 Entry.loadProject 를 불러야 한다',
    );

    /** 
     * `preloadTextFonts` 함수는 `document.fonts.load`를 호출하여 실제 폰트 다운로드를 트리거해야 합니다. 
     * (단순히 CSS를 `<link>`로 추가하는 것만으로는 폰트가 실제로 사용되기 전까지 다운로드되지 않습니다.)
     */
    assert.match(page, /document\.fonts\.load/);
    assert.match(page, /document\.fonts\.ready/);
  });
});

test('작품 파일(.ent)을 내려받을 수 있다', async () => {
  await withServer({}, async (server: any) => {
    const page = await (await fetch(server.url)).text();
    const href = page.match(/href="\/([^"]+\.ent)"/)![1];
    const response = await fetch(server.url + encodeURIComponent(href));
    assert.equal(response.status, 200);

    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.length % 512, 0);
    assert.equal(bytes.subarray(0, 100).toString('utf-8').replace(/\0+$/, ''), 'temp/project.json');
  });
});

test('리소스를 디스크에 있는 그대로의 주소로 내보낸다', async () => {
  await withServer({ example: 'examples/cat_run.tess' }, async (server: any, result: any) => {
    const project = await (await fetch(`${server.url}project.json`)).json();
    const pictures = project.objects.flatMap((object: any) => object.sprite.pictures);
    const cat = pictures.find((picture: any) => picture.fileurl.endsWith('cat_idle.png'));

    /** 엔트리의 `temp/<해시>` 주소가 아닌, 파일이 실제 위치한 경로를 가리켜야 합니다. */
    assert.equal(cat.fileurl, '/cat_idle.png');

    const served = await fetch(server.url + cat.fileurl.slice(1));
    assert.equal(served.status, 200);
    assert.deepEqual(
      Buffer.from(await served.arrayBuffer()),
      fs.readFileSync(path.join(root, 'examples/cat_idle.png')),
    );

    /** 엔트리가 기존에 사용하던 주소 형식도 호환성을 위해 정상적으로 처리되어야 합니다. */
    const hashed = result.assets.find((asset: any) => asset.source.endsWith('cat_idle.png')).target;
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
  await withServer({}, async (server: any) => {
    assert.equal((await fetch(`${server.url}없는것`)).status, 404);
  });
});

test('설치된 entryjs 가 없으면 CDN 을 가리킨다', async () => {
  await withServer({ cwd: os.tmpdir() }, async (server: any) => {
    assert.match(server.runtime, /^CDN/);
    const page = await (await fetch(server.url)).text();
    /** 
     * `@entrylabs/entry` 본체는 unpkg를 통해 로드됩니다. 
     * jsDelivr는 패키지 전체 크기가 150MB 한도를 초과하여 `entry.min.js` 접근을 403 오류로 차단하기 때문입니다.
     */
    assert.match(page, /unpkg\.com\/@entrylabs\/entry/);
    /** 그 외의 서드파티 라이브러리(jquery, createjs, @entrylabs/tool 등)는 jsDelivr에서 로드됩니다. */
    assert.match(page, /cdn\.jsdelivr\.net/);
    /** 스크립트 로드에 실패했을 경우 화면에 안내 메시지가 표시되어야 합니다. */
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

  await withServer({ cwd: fake }, async (server: any) => {
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

  await withServer({ cwd: fake }, async (server: any) => {
    const escaped = await fetch(`${server.url}lib/${encodeURIComponent('../../../secret.txt')}`);
    assert.equal(escaped.status, 404);
  });
});

test('엔트리 글꼴 CSS 를 하나씩 <link> 로 직접 붙인다', async () => {
  /**
   * 묶음 파일 `fonts_2023_10.css`는 `@font-face`를 직접 선언하지 않고 22줄의 `@import` 구문을 포함합니다.
   * `@import` 방식은 해당 CSS 파일을 완전히 파싱한 후에야 내부 폰트 요청이 시작되므로 지연이 발생하며, 
   * 이로 인해 `preloadTextFonts` 함수가 필요한 글꼴을 제때 찾지 못하고 넘어가는 문제를 방지해야 합니다.
   */
  await withServer({}, async (server: any) => {
    const page = await (await fetch(server.url)).text();
    const hrefs = [...page.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map((m) => m[1]);
    const fontHrefs = hrefs.filter((href) => href.includes('/uploads/fonts/'));

    assert.equal(fontHrefs.length, 22, fontHrefs.join('\n'));
    for (const href of fontHrefs) {
      assert.match(href, /^https:\/\/entry-cdn\.pstatic\.net\/uploads\/fonts\/[\w.]+\.css$/);
    }
    /** 실제 글꼴 데이터가 아닌 `@import` 목록만 포함된 묶음 파일은 사용하지 않습니다. */
    assert.ok(!fontHrefs.some((href) => href.includes('fonts_2023_10')), 'fonts_2023_10.css 는 빼야 한다');
    for (const name of ['nanum_gothic', 'dunggeunmo_2023', 'd2coding_2023', 'SDShabang_2023']) {
      assert.ok(fontHrefs.some((href) => href.endsWith('/' + name + '.css')), name + ' 이 빠졌다');
    }
  });
});

test('캔버스 그리기 해상도는 처음 한 번만 정하고, 그 뒤에는 CSS 크기만 바꾼다', async () => {
  /**
   * 캔버스의 `width`/`height` 속성을 변경하면 기존에 렌더링된 내용이 지워지고 `stage` 변환 좌표계가 틀어지게 됩니다.
   * 따라서 브라우저 창 크기가 변경될 때는 해상도 속성을 유지한 채 CSS 크기만 조정해야 합니다.
   */
  await withServer({}, async (server: any) => {
    const ui = await (await fetch(`${server.url}debug-ui.js`)).text();

    assert.match(ui, /const setCanvasResolution = \(\) => \{/);
    assert.match(ui, /if \(resolutionFixed\) return;/);
    assert.match(ui, /resolutionFixed = true;/);

    const layout = ui.slice(ui.indexOf('function layoutCanvas()'), ui.indexOf('window.tessLayoutCanvas ='));
    assert.match(layout, /canvas\.style\.width/);
    assert.match(layout, /canvas\.style\.height/);
    assert.doesNotMatch(layout, /canvasEl\.width\s*=/);
    assert.doesNotMatch(layout, /canvasEl\.height\s*=/);
  });
});

test('물어보기 입력창을 캔버스 해상도에 맞춰 키운다', async () => {
  /**
   * 엔트리는 물어보기 입력창을 캔버스의 기본 픽셀 좌표계(640x360)에 맞추어 그립니다.
   * 뷰어의 캔버스 크기가 이보다 큰 경우, 동일한 배율로 입력창 크기를 확대하지 않으면 좌측 상단에 작게 렌더링되는 문제가 발생합니다.
   */
  await withServer({}, async (server: any) => {
    const ui = await (await fetch(`${server.url}debug-ui.js`)).text();

    assert.match(ui, /const ENTRY_BUFFER_WIDTH = 640;/);
    const scale = ui.slice(ui.indexOf('const scaleInputFieldToBuffer'), ui.indexOf('const setCanvasResolution'));
    assert.match(scale, /stage\.showInputField = /);
    /** 소스는 홑따옴표로도 겹따옴표로도 쓰일 수 있으므로 둘 다 받는다. */
    const quoted = (name: string) => new RegExp(`['"]${name}['"]`);
    const at = (name: string) => scale.search(quoted(name));
    for (const name of ['fontSize', 'borderWidth', 'borderRadius', 'padding', 'width', 'height', 'x', 'y']) {
      assert.match(scale, quoted(name), `${name} 도 같이 키워야 한다`);
    }
    /** 크기 관련 속성들을 먼저 설정한 후 위치를 변경해야, 마지막 setter에서 렌더링이 올바르게 갱신됩니다. */
    assert.ok(at('width') < at('x'));
    assert.ok(ui.includes('scaleInputFieldToBuffer(bufferW);'));
  });
});

test('무대 배치가 바뀌면 엔트리가 캐시한 캔버스 위치를 새로 잰다', async () => {
  /**
   * 엔트리는 창 크기가 변경될 때만 내부적으로 `_boundRect`를 갱신합니다. 
   * 디버그 패널이 열리면서 무대 레이아웃이 변경되면, 마우스 좌표 계산 시 이전 위치를 참조하는 오류를 방지하기 위해 경계 좌표를 다시 계산해야 합니다.
   */
  await withServer({}, async (server: any) => {
    const ui = await (await fetch(`${server.url}debug-ui.js`)).text();

    assert.match(ui, /const refreshBoundRect = \(\) => \{/);
    assert.match(ui, /stage\.updateBoundRect\(\)/);

    const layout = ui.slice(ui.indexOf('function layoutCanvas()'), ui.indexOf('window.addEventListener(\'resize\''));
    assert.match(layout, /refreshBoundRect\(\);/);
    /** 패널이 열릴 때 무대 캔버스가 CSS 트랜지션을 통해 이동하므로, 애니메이션 종료 후 경계 좌표를 다시 갱신합니다. */
    assert.match(ui, /propertyName === ['"]padding-right['"]/);
  });
});

test('디버그 UI 와 preact 를 모듈로 내보낸다', async () => {
  await withServer({}, async (server: any) => {
    const page = await (await fetch(server.url)).text();
    assert.match(page, /<script type="module" src="\/debug-ui\.js"><\/script>/);

    const ui = await fetch(`${server.url}debug-ui.js`);
    assert.equal(ui.status, 200);
    const uiSource = await ui.text();
    const preactFile = uiSource.match(/from ['"]\/preact\/([^'"]+)['"]/)![1];
    assert.equal((await fetch(`${server.url}preact/${preactFile}`)).status, 200);
    /** `preact` 폴더 외부의 파일에는 접근할 수 없도록 제한해야 합니다. */
    const escaped = await fetch(`${server.url}preact/${encodeURIComponent('../../../package.json')}`);
    assert.equal(escaped.status, 404);
  });
});

// --- 부스트 모드 --------------------------------------------------------------

test('run --boost 는 엔트리를 부스트 모드(WebGL 렌더러)로 띄운다', async () => {
  /**
   * 부스트 모드는 엔트리 에디터 환경에서는 활성화할 수 없지만,
   * 실행기에서는 `Entry.init`의 `useWebGL` 옵션을 통해 단독으로 활성화 가능합니다 (`GEHelper.INIT`).
   */
  await withServer({ boost: true }, async (server: any) => {
    assert.match(await (await fetch(server.url)).text(), /useWebGL: true/);
  });
  await withServer({}, async (server: any) => {
    assert.match(await (await fetch(server.url)).text(), /useWebGL: false/);
  });
});

test('부스트 모드는 실행기가 CDN 이어도 기본 그림을 같은 origin 으로 내보낸다', async () => {
  /**
   * `entryjs`는 기본적으로 이미지 리소스를 `crossOrigin` 설정 없이 `new Image()`로 불러옵니다 (`GEHelper.newSpriteWithCallback`). 
   * 하지만 WebGL 환경에서는 이러한 이미지를 텍스처로 로드할 때 보안 에러(`SecurityError`)가 발생하여 해당 프레임 렌더링이 실패합니다.
   * 이를 방지하기 위해 부스트 모드에서는 기본 리소스를 동일 출처(same-origin)로 서빙해야 합니다.
   */
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'tess-boost-'));
  try {
    await withServer({ cwd, boost: true }, async (server: any) => {
      const page = await (await fetch(server.url)).text();
      assert.match(page, /libDir: "\/lib"/);
      /** 스크립트 파일은 텍스처 로딩과 무관하므로 CDN에서 정상적으로 가져옵니다. */
      assert.match(page, /src="https:\/\/unpkg\.com\/@entrylabs\/entry@[\d.]+\/dist\/entry\.min\.js"/);
    });
    /** 부스트 모드가 아닌 경우, 기존 방식대로 기본 리소스를 CDN에서 직접 로드합니다. */
    await withServer({ cwd }, async (server: any) => {
      assert.match(await (await fetch(server.url)).text(), /libDir: "https:\/\/unpkg\.com\//);
    });
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('부스트 모드에서는 캔버스 버퍼 대신 렌더러 해상도를 올린다', async () => {
  /**
   * PIXI.js가 캔버스 요소를 관리하고 있으므로, 외부에서 직접 `canvasEl.width`를 변경하면 렌더링 영역이 어긋나게 됩니다.
   * 부스트 모드에서는 렌더러의 해상도(resolution) 옵션을 조정하여 화면 품질을 높이고, 무대 좌표계는 엔트리의 640x360 기준을 유지하도록 처리합니다.
   */
  await withServer({}, async (server: any) => {
    const ui = await (await fetch(`${server.url}debug-ui.js`)).text();
    const fn = ui.slice(ui.indexOf('const setCanvasResolution'), ui.indexOf('const refreshBoundRect'));
    assert.match(fn, /renderer\.resolution = bufferW \/ ENTRY_BUFFER_WIDTH;/);
    assert.match(fn, /renderer\.resize\(ENTRY_BUFFER_WIDTH, ENTRY_BUFFER_HEIGHT\)/);
    const pixiBranch = fn.slice(fn.indexOf('if (renderer'), fn.indexOf('} else {'));
    assert.doesNotMatch(pixiBranch, /canvasEl\.(width|height)\s*=/);
  });
});

test('부스트 모드에서 클릭 판정도 올린 해상도를 따라간다', async () => {
  /**
   * PIXI의 InteractionManager는 초기 타겟 엘리먼트 설정 시 전달받은 해상도 비율을 내부적으로 저장하여 좌표 변환(`mapPositionToPoint`)에 사용합니다. 
   * 렌더러 해상도만 변경할 경우, 이벤트 판정 해상도는 여전히 기본값(1)으로 남아 있어 UI 표시와 실제 클릭 영역 간에 오차가 발생합니다. 이를 동기화해야 합니다.
   */
  await withServer({}, async (server: any) => {
    const ui = await (await fetch(`${server.url}debug-ui.js`)).text();
    const fn = ui.slice(ui.indexOf('const setCanvasResolution'), ui.indexOf('const refreshBoundRect'));
    assert.match(fn, /interaction\.resolution = renderer\.resolution;/);
    assert.ok(fn.indexOf('renderer.resolution =') < fn.indexOf('interaction.resolution ='),
      '렌더러 해상도를 정한 다음에 판정 해상도를 맞춰야 한다');
  });
});

test('디버그 패널의 부스트 모드 흉내내기는 그대로 남는다', async () => {
  /**
   * `--boost` 옵션 실행 여부와 관계없이 활성화/비활성화 상태를 교차 테스트할 수 있어야 하므로, 
   * 블록의 반환값을 조작하는 디버그 패널의 모의 로직은 실제 렌더러 상태와 분리되어 동작합니다.
   */
  await withServer({}, async (server: any) => {
    const ui = await (await fetch(`${server.url}debug-ui.js`)).text();
    assert.match(ui, /wrap\(['"]is_boost_mode['"], \(\) => choice\(env\.boost\)\)/);
    assert.match(ui, /['"]env-boost['"]/);
    /** 실제 웹 렌더러의 모드 상태는 디버그 패널에 표시 용도로만 유지됩니다. */
    assert.match(ui, /realBoost: false,/);
    assert.match(ui, /Boolean\(window\.Entry && Entry\.options && Entry\.options\.useWebGL\)/);
  });
});
