/**
 * 작품 실행 페이지에서 엔트리 실행기를 가로채는 부분을 가짜 `Entry` 로 검사합니다.
 * 실제 사이트가 없어도 확인해야 하는 것은 하나입니다 — tessvm 이 실행을 맡는 동안
 * 엔트리 쪽 스크립트가 단 하나도 시작되지 않는가.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><body><canvas id="entryCanvas"></canvas></body>', {
  url: 'https://playentry.org/project/6a9b8f8dc769f2b3c8b13d20',
  pretendToBeVisual: true,
});
const scope = globalThis as unknown as { window?: unknown; document?: unknown };
scope.window = dom.window;
scope.document = dom.window.document;

const { EntryBridge } = await import('../src/page/entry-hook.ts');

interface Calls {
  loaded: Array<Record<string, unknown>>;
  run: Array<Record<string, unknown> | null>;
  stop: number;
  pause: boolean[];
}

/** A stand-in with the parts of entry the bridge touches. */
function fakeEntry(exported: Record<string, unknown> | null = { name: '내보낸 작품' }) {
  const raised: string[] = [];
  const entry = {
    type: 'minimize',
    defaultPath: '',
    soundPath: '',
    engine: {
      state: 'stop',
      toggleRun(this: { state: string }) {
        this.state = 'run';
        entry.container.mapEntityIncludeCloneOnScene('raise', 'start');
      },
      toggleStop(this: { state: string }) {
        this.state = 'stop';
      },
      togglePause(this: { state: string }) {
        this.state = this.state === 'pause' ? 'run' : 'pause';
      },
    },
    container: {
      mapEntityIncludeCloneOnScene(_fn: unknown, param: unknown) {
        raised.push(String(param));
        return ['ran'];
      },
    },
    loadProject(project: Record<string, unknown>) {
      return project;
    },
    exportProject() {
      if (!exported) throw new Error('내보낼 수 없습니다');
      return exported;
    },
  };
  return { entry, raised };
}

function install(control: () => boolean, entry: unknown) {
  (dom.window as unknown as { Entry?: unknown }).Entry = entry;
  const calls: Calls = { loaded: [], run: [], stop: 0, pause: [] };
  const bridge = new EntryBridge({
    wantsControl: control,
    onProjectLoaded: (project) => calls.loaded.push(project),
    onRun: (project) => calls.run.push(project),
    onStop: () => {
      calls.stop += 1;
    },
    onPause: (paused) => calls.pause.push(paused),
  });
  bridge.install();
  return { bridge, calls };
}

test('시작하기를 누르면 tessvm 이 실행을 넘겨받고 엔트리 스크립트는 하나도 돌지 않는다', () => {
  const { entry, raised } = fakeEntry();
  const { bridge, calls } = install(() => true, entry);

  entry.engine.toggleRun();
  assert.equal(entry.engine.state, 'run', '엔트리의 상태와 화면은 그대로 바뀌어야 한다');
  assert.deepEqual(calls.run, [{ name: '내보낸 작품' }]);
  assert.deepEqual(raised, [], '엔트리 쪽 스크립트가 시작되었습니다');

  // 실행 중에 들어오는 키·마우스·신호도 마찬가지다.
  assert.deepEqual(entry.container.mapEntityIncludeCloneOnScene('raise', 'keyPress'), []);
  assert.deepEqual(raised, []);

  bridge.uninstall();
});

test('정지를 누르면 엔트리에게 실행을 돌려준다', () => {
  const { entry, raised } = fakeEntry();
  const { bridge, calls } = install(() => true, entry);

  entry.engine.toggleRun();
  void entry.engine.toggleStop();
  assert.equal(calls.stop, 1);
  assert.equal(entry.engine.state, 'stop');

  entry.container.mapEntityIncludeCloneOnScene('raise', 'start');
  assert.deepEqual(raised, ['start'], '정지 뒤에는 엔트리가 다시 스크립트를 돌려야 한다');

  bridge.uninstall();
});

test('일시정지와 이어하기를 그대로 전한다', () => {
  const { entry } = fakeEntry();
  const { bridge, calls } = install(() => true, entry);

  entry.engine.toggleRun();
  entry.engine.togglePause();
  assert.deepEqual(calls.pause, [true]);
  entry.engine.togglePause();
  assert.deepEqual(calls.pause, [true, false]);

  bridge.uninstall();
});

test('꺼져 있으면 엔트리 실행기가 그대로 돈다', () => {
  const { entry, raised } = fakeEntry();
  const { bridge, calls } = install(() => false, entry);

  entry.engine.toggleRun();
  assert.deepEqual(calls.run, []);
  assert.deepEqual(raised, ['start']);

  bridge.uninstall();
});

test('실행 페이지에서는 불러온 작품을 그대로 돌린다', () => {
  // 실행 페이지의 작품은 엔트리가 받은 그대로다. exportProject 는 편집기의 상태를
  // 필요로 하고 지나가는 길에 엔진을 멈추므로, 늦게 붙었을 때의 대비책으로만 둔다.
  const { entry } = fakeEntry({ name: '내보낸 작품' });
  const { bridge, calls } = install(() => true, entry);

  entry.loadProject({ name: '불러온 작품' });
  assert.deepEqual(calls.loaded, [{ name: '불러온 작품' }]);

  entry.engine.toggleRun();
  assert.deepEqual(calls.run, [{ name: '불러온 작품' }]);

  bridge.uninstall();
});

test('불러오는 것을 놓쳤으면 내보내기로 작품을 얻는다', () => {
  const { entry } = fakeEntry({ name: '내보낸 작품' });
  const { bridge, calls } = install(() => true, entry);

  entry.engine.toggleRun();
  assert.deepEqual(calls.run, [{ name: '내보낸 작품' }]);

  bridge.uninstall();
});

test('만들기 페이지는 엔트리 실행기의 자리로 남겨 둔다', () => {
  const { entry, raised } = fakeEntry();
  entry.type = 'workspace';
  // 실제 배선과 같게, 편집기인지까지 보고 넘겨받을지 정한다.
  const { bridge, calls } = install(() => entry.type !== 'workspace', entry);
  assert.equal(bridge.isEditor(), true);

  entry.engine.toggleRun();
  assert.deepEqual(calls.run, []);
  assert.deepEqual(raised, ['start'], '만들기 페이지에서는 엔트리가 그대로 돌아야 한다');

  bridge.uninstall();
});

test('실행 페이지는 편집기가 아니다', () => {
  const { entry } = fakeEntry();
  const { bridge } = install(() => true, entry);
  assert.equal(bridge.isEditor(), false);
  bridge.uninstall();
});

test('여러 번 감싸지 않는다', () => {
  const { entry, raised } = fakeEntry();
  const { bridge, calls } = install(() => true, entry);
  const patched = entry.engine.toggleRun;

  // install 은 주기적으로 다시 훑는다. 같은 함수를 두 번 감싸면 안 된다.
  bridge.install();
  (bridge as unknown as { patchAll(): void }).patchAll();
  assert.equal(entry.engine.toggleRun, patched);

  entry.engine.toggleRun();
  assert.equal(calls.run.length, 1);
  assert.deepEqual(raised, []);

  bridge.uninstall();
});

test('엔트리 캔버스를 찾는다', () => {
  const { entry } = fakeEntry();
  const { bridge } = install(() => true, entry);
  assert.equal(bridge.canvas()?.id, 'entryCanvas');
  assert.equal(bridge.engineState(), 'stop');
  bridge.uninstall();
});

test('release 는 엔트리에게 스크립트를 되돌려준다', () => {
  const { entry, raised } = fakeEntry();
  const { bridge } = install(() => true, entry);

  entry.engine.toggleRun();
  assert.deepEqual(raised, []);
  assert.equal(bridge.controlled, true);

  bridge.release();
  assert.equal(bridge.controlled, false);
  entry.container.mapEntityIncludeCloneOnScene('raise', 'start');
  assert.deepEqual(raised, ['start']);

  bridge.uninstall();
});

test('엔트리가 나중에 나타나도 바로 붙는다', () => {
  const window = dom.window as unknown as Record<string, unknown>;
  delete window.Entry;
  const { entry, raised } = fakeEntry();
  const calls: Calls = { loaded: [], run: [], stop: 0, pause: [] };
  const bridge = new EntryBridge({
    wantsControl: () => true,
    onProjectLoaded: (project) => calls.loaded.push(project),
    onRun: (project) => calls.run.push(project),
    onStop: () => {
      calls.stop += 1;
    },
    onPause: (paused) => calls.pause.push(paused),
  });
  bridge.install();

  // entryjs 가 지금 막 자기 전역을 올려놓은 순간이다.
  window.Entry = entry;
  entry.engine.toggleRun();
  assert.deepEqual(calls.run.length, 1, '주기 검사를 기다리지 않고 붙어야 한다');
  assert.deepEqual(raised, []);

  bridge.uninstall();
});

test.after(() => dom.window.close());
