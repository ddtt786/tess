/**
 * 실제로 배포되는 번들을 그대로 만들어, 작품 실행 페이지에서 엔트리 실행기를
 * 넘겨받는지 확인합니다. jsdom 에는 WebGL 이 없으므로 tessvm 은 화면을 세우다
 * 실패하는데, 그때 작품이 엔트리 실행기로 되돌아가는 것까지 같이 봅니다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as esbuild from 'esbuild';
import { JSDOM } from 'jsdom';
import { bundleOptions, ENTRIES } from '../bundle.ts';
import { manifestFor, MATCHES } from '../manifest.ts';

const pageEntry = ENTRIES.find((entry) => entry.output === 'page.js')!;
const bundled = await esbuild.build({
  ...bundleOptions({ dev: false }),
  entryPoints: [pageEntry.input],
  write: false,
  outfile: 'page.js',
  logLevel: 'silent',
});
const PAGE_SCRIPT = bundled.outputFiles![0]!.text;
// esbuild keeps a helper process alive; the test runner waits for it otherwise.
await esbuild.stop();

interface Harness {
  window: Window & typeof globalThis & Record<string, unknown>;
  raised: string[];
  posted: Array<Record<string, unknown>>;
  entry: Record<string, unknown>;
}

/** 작품 실행 페이지 한 장 — 엔트리 캔버스와 엔트리 실행기, 그리고 우리 스크립트. */
function openPage(
  t: { after(fn: () => void): void },
  { url = 'https://playentry.org/project/6a9b8f8dc769f2b3c8b13d20', type = 'minimize' } = {},
): Harness {
  const dom = new JSDOM('<!doctype html><body><canvas id="entryCanvas"></canvas></body>', {
    url,
    pretendToBeVisual: true,
    runScripts: 'outside-only',
  });
  const window = dom.window as unknown as Harness['window'];
  const raised: string[] = [];
  const posted: Array<Record<string, unknown>> = [];
  window.addEventListener('message', (event) => {
    posted.push((event as MessageEvent).data as Record<string, unknown>);
  });

  const container = {
    mapEntityIncludeCloneOnScene(_map: unknown, param: unknown) {
      raised.push(String(param));
      return ['ran'];
    },
  };
  const entry: Record<string, unknown> = {
    type,
    defaultPath: '',
    soundPath: '',
    container,
    engine: {
      state: 'stop',
      toggleRun(this: { state: string }) {
        this.state = 'run';
        container.mapEntityIncludeCloneOnScene(null, 'start');
      },
      toggleStop(this: { state: string }) {
        this.state = 'stop';
      },
      togglePause(this: { state: string }) {
        this.state = this.state === 'pause' ? 'run' : 'pause';
      },
      fireEvent(name: string) {
        container.mapEntityIncludeCloneOnScene(null, name);
      },
    },
    exportProject: () => ({
      name: '테스트 작품',
      speed: 60,
      objects: [],
      scenes: [{ id: 'sc01', name: '장면 1' }],
      variables: [],
      messages: [],
      functions: [],
      tables: [],
    }),
  };
  window.Entry = entry;
  window.eval(PAGE_SCRIPT);
  // Closing stops the page's own timers; without it the run never ends.
  t.after(() => dom.window.close());
  return { window, raised, posted, entry };
}

const settled = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function enable(page: Harness): void {
  page.window.postMessage(
    {
      channel: 'tessvm-entry',
      from: 'content',
      type: 'settings',
      settings: { enabled: true, pipeline: 'tess', relaxCsp: false, showStats: false, quality: 1 },
    },
    '*',
  );
}

test('페이지에 얹히면 설정을 달라고 알린다', async (t) => {
  const page = openPage(t);
  await settled(50);
  // 페이지 쪽 realm 의 객체라 프로토타입까지 같지는 않다. 값만 본다.
  assert.deepEqual({ ...page.posted[0] }, { channel: 'tessvm-entry', from: 'page', type: 'ready' });
});

test('실행 페이지에서 시작하기를 누르면 tessvm 이 넘겨받는다', async (t) => {
  const page = openPage(t);
  enable(page);
  await settled(400);

  const engine = page.entry.engine as { toggleRun(): void; state: string };
  engine.toggleRun();
  assert.deepEqual(page.raised, [], '엔트리 쪽 스크립트가 돌기 시작했습니다');
  assert.equal(engine.state, 'run', '엔트리의 상태와 화면은 그대로 바뀌어야 한다');
  assert.ok(page.window.document.getElementById('tessvm-ext-host'), '무대가 만들어지지 않았습니다');
  // 준비는 비동기다. 창을 닫기 전에 끝까지 가게 둔다.
  await settled(1500);
});

test('tessvm 이 화면을 세우지 못하면 엔트리 실행기로 되돌린다', async (t) => {
  const page = openPage(t);
  enable(page);
  await settled(400);

  (page.entry.engine as { toggleRun(): void }).toggleRun();
  await settled(1500);

  assert.deepEqual(page.raised, ['start'], '엔트리가 작품을 이어받지 못했습니다');
  const status = page.posted.filter((message) => message.type === 'status').pop();
  assert.ok(status, '상태를 알리지 않았습니다');
  assert.equal((status.status as { active: boolean }).active, false);

  // 알림은 엔트리 화면을 가리지도, 클릭을 막지도 않아야 한다.
  const host = page.window.document.getElementById('tessvm-ext-host')!;
  assert.ok(host.classList.contains('tessvm-ext-notice'));
});

test('만들기 페이지는 엔트리 실행기의 자리로 남겨 둔다', async (t) => {
  const page = openPage(t, { url: 'https://playentry.org/ws/1', type: 'workspace' });
  enable(page);
  await settled(400);

  (page.entry.engine as { toggleRun(): void }).toggleRun();
  assert.deepEqual(page.raised, ['start'], '만들기 페이지에서는 엔트리가 그대로 돌아야 한다');
  assert.equal(page.window.document.getElementById('tessvm-ext-host'), null);
});

test('꺼져 있으면 엔트리 실행기를 그대로 둔다', async (t) => {
  const page = openPage(t);
  page.window.postMessage(
    {
      channel: 'tessvm-entry',
      from: 'content',
      type: 'settings',
      settings: { enabled: false, pipeline: 'tess', relaxCsp: false, showStats: false, quality: 1 },
    },
    '*',
  );
  await settled(400);

  (page.entry.engine as { toggleRun(): void }).toggleRun();
  assert.deepEqual(page.raised, ['start']);
});

test('매니페스트는 두 브라우저가 각각 요구하는 모양을 갖춘다', () => {
  const chrome = manifestFor('chrome');
  const firefox = manifestFor('firefox');
  assert.deepEqual(chrome.background, { service_worker: 'background.js' });
  assert.deepEqual(firefox.background, { scripts: ['background.js'] });
  assert.ok((firefox.browser_specific_settings as { gecko: { id: string } }).gecko.id);
  for (const manifest of [chrome, firefox]) {
    assert.equal(manifest.manifest_version, 3);
    assert.deepEqual(manifest.host_permissions, MATCHES);
    const scripts = manifest.content_scripts as Array<{ js: string[]; run_at: string }>;
    assert.equal(scripts[0]!.run_at, 'document_start');
    // 페이지 스크립트는 페이지 쪽에서 불러가므로 반드시 접근 가능해야 한다.
    const resources = manifest.web_accessible_resources as Array<{ resources: string[] }>;
    assert.deepEqual(resources[0]!.resources, ['page.js']);
  }
});
