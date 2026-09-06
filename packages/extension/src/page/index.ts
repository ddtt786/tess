/**
 * @fileoverview The runner, in playentry.org's own page.
 *
 * This stands in for entry's runner where a work is played —
 * `playentry.org/project/<id>` and the full-screen and embedded views of it.
 * The block editor is left alone: there the runner is part of the editing loop.
 *
 * The code has to be in the page's own world rather than the content script's:
 * `Entry` is a page global, and the JIT compiles the work with `new Function`.
 * The extension APIs are out of reach from here, so settings arrive over
 * `postMessage` from the content script.
 */
import { DEFAULT_SETTINGS, type Settings } from '../common/settings.ts';
import { CHANNEL, isContentMessage, type PageMessage, type RunnerStatus } from '../common/protocol.ts';
import { EntryBridge } from './entry-hook.ts';
import { StageOverlay } from './overlay.ts';
import { TessvmRunner } from './runner.ts';
import { entryPaths } from './assets.ts';
import { TESSVM_VARIABLE, type BuildResult } from './pipeline.ts';

let settings: Settings = { ...DEFAULT_SETTINGS };
let overlay: StageOverlay | null = null;
/** Set while we are driving entry's buttons, so its hooks do not answer back. */
let entrySync = false;
const runner = new TessvmRunner();

/** Whether the page lets us compile — the JIT needs `new Function`. */
function jitAvailable(): boolean {
  try {
    return new Function('return 1')() === 1;
  } catch {
    return false;
  }
}

function post(message: PageMessage): void {
  window.postMessage(message, window.location.origin);
}

function report(status: RunnerStatus): void {
  post({ channel: CHANNEL, from: 'page', type: 'status', status });
}

function stageOverlay(): StageOverlay {
  if (!overlay) {
    overlay = new StageOverlay();
    overlay.onDisable(() => {
      settings = { ...settings, enabled: false };
      post({ channel: CHANNEL, from: 'page', type: 'save', settings });
      handOverToEntry('사용자가 엔트리 실행기로 되돌렸습니다.');
    });
    // The run is tessvm's, so the run controls act on tessvm first. Entry's
    // page is told afterwards, so its own buttons keep showing the truth.
    overlay.onTransport({
      start: () => {
        runner.start();
        showTransport();
        syncEntry('run');
      },
      pause: () => {
        runner.pause();
        showTransport();
        syncEntry('pause');
      },
      stop: () => {
        runner.stop();
        showTransport();
        syncEntry('stop');
      },
    });
  }
  return overlay;
}

/** Puts the panel's controls in step with what tessvm is actually doing. */
function showTransport(): void {
  overlay?.setTransport(runner.state);
}

/**
 * Moves entry's own state machine to match, so its start and stop buttons are
 * not left saying the opposite of what tessvm is doing. Never the other way
 * round: tessvm is what is running the work.
 */
function syncEntry(want: 'run' | 'pause' | 'stop'): void {
  const engine = bridge.entry?.engine as
    | { state?: string; toggleRun?: () => void; toggleStop?: () => void; togglePause?: () => void }
    | undefined;
  if (!engine || engine.state === want) return;
  entrySync = true;
  try {
    if (want === 'stop') engine.toggleStop?.();
    else if (want === 'pause') engine.togglePause?.();
    else if (engine.state === 'pause') engine.togglePause?.();
    else engine.toggleRun?.();
  } catch {
    // Entry's page is a courtesy here; tessvm has already done the real work.
  } finally {
    entrySync = false;
  }
}

const bridge = new EntryBridge({
  // The block editor keeps entry's runner: there the runner is half of the
  // editing loop (a block lights up as it runs, the debugger steps through it).
  wantsControl: () => settings.enabled && !bridge.isEditor(),
  onProjectLoaded() {
    // A newly loaded work makes whatever is booted useless. Mid-run this does
    // not happen — entry stops the engine before it loads anything.
    if (!bridge.controlled) runner.dispose();
  },
  onRun(project) {
    // Not when the button entry just moved was moved by us.
    if (entrySync) return;
    void takeRun(project);
  },
  onStop() {
    if (entrySync) return;
    runner.stop();
    overlay?.hide();
    report({ active: false, detail: 'tessvm 대기 중' });
  },
  onPause(paused) {
    if (entrySync) return;
    if (paused) runner.pause();
    else runner.start();
    showTransport();
  },
});

/**
 * Stops standing in for entry and lets entry's own runner take the run.
 * The overlay is left alone when it is showing a notice, which has to stay
 * readable while entry plays underneath it.
 */
function handOverToEntry(reason: string, keepOverlay = false): void {
  runner.stop();
  if (!keepOverlay) overlay?.hide();
  bridge.release();
  report({ active: false, detail: reason });
  // `toggleRun` already fired 'start' while we were holding events shut, so the
  // work would sit still otherwise.
  const engine = bridge.entry?.engine as { fireEvent?: (name: string) => void } | undefined;
  if (bridge.engineState() === 'run') engine?.fireEvent?.('start');
}

async function takeRun(project: Record<string, unknown> | null): Promise<void> {
  const view = stageOverlay();
  const canvas = bridge.canvas();
  if (!project || !canvas) {
    handOverToEntry(project ? '엔트리 캔버스를 찾지 못했습니다.' : '작품을 읽지 못했습니다.');
    return;
  }
  if (!jitAvailable()) {
    view.notice(canvas, 'tessvm 실행 불가', [
      '이 페이지의 보안 정책(CSP)이 코드 생성을 막고 있어 tessvm 이 작품을 컴파일할 수 없습니다.',
      '',
      '확장 프로그램 팝업에서 "CSP 완화" 를 켜고 페이지를 새로 고치면 실행됩니다.',
      '작품은 엔트리 실행기로 그대로 돌아갑니다.',
    ]);
    handOverToEntry('CSP 가 코드 생성을 막고 있습니다.', true);
    return;
  }

  view.attachTo(canvas);
  view.show();
  view.setStatus('tessvm 준비 중', 'busy');
  view.setDetail(['작품을 Tess 로 되돌려 다시 컴파일하는 중입니다…']);

  try {
    const { build, bootMs } = await runner.prepare(project, {
      container: view.stage,
      paths: entryPaths(bridge.entry as unknown as Record<string, unknown>),
      route: settings.pipeline,
      quality: settings.quality,
      showStats: settings.showStats,
    });
    if (bridge.engineState() !== 'run') {
      // Stopped while it was still building.
      view.hide();
      return;
    }
    runner.start();
    view.setStatus(build.route === 'tess' ? 'tessvm · Tess' : 'tessvm · 직접', 'ready');
    view.setDetail(describe(build, bootMs));
    showTransport();
    report({
      active: true,
      detail: `tessvm 실행 중 (${build.route === 'tess' ? 'Tess 경유' : '직접'})`,
    });
  } catch (error) {
    const message = (error as Error).message;
    view.notice(canvas, 'tessvm 실패', [
      `작품을 준비하지 못했습니다: ${message}`,
      '',
      '작품은 엔트리 실행기로 그대로 돌아갑니다.',
    ]);
    handOverToEntry(`준비 실패: ${message}`, true);
  }
}

function describe(build: BuildResult, bootMs: number): string[] {
  const project = build.project as unknown as {
    objects?: unknown[];
    scenes?: unknown[];
    variables?: unknown[];
  };
  const lines = [
    build.route === 'tess'
      ? '작품을 Tess 소스로 되돌린 뒤 다시 컴파일해서 실행합니다.'
      : '작품을 그대로 tessvm 으로 실행합니다.',
    `오브젝트 ${project.objects?.length ?? 0} · 장면 ${project.scenes?.length ?? 0} · 변수 ${project.variables?.length ?? 0}`,
    `변환 ${build.elapsed.toFixed(0)}ms · 적재 ${bootMs.toFixed(0)}ms · 리소스 ${build.restored}개`,
    build.marked
      ? `${TESSVM_VARIABLE} 변수를 1 로 두었습니다.`
      : `${TESSVM_VARIABLE} 변수가 없어 표시하지 않았습니다.`,
  ];
  if (build.warnings.length) {
    lines.push('', `경고 ${build.warnings.length}건`, ...build.warnings.slice(0, 8).map((item) => `· ${item}`));
  }
  return lines;
}

function applySettings(next: Settings): void {
  const wasEnabled = settings.enabled;
  settings = next;
  // Settings that shape the work are part of what the runner is keyed on, so a
  // change to one of them rebuilds at the next run on its own — a run already
  // under way is left alone.
  if (wasEnabled && !next.enabled && bridge.controlled) {
    handOverToEntry('tessvm 을 껐습니다.');
  }
  if (!next.enabled) {
    report({ active: false, detail: 'tessvm 꺼짐' });
    return;
  }
  report({ active: bridge.controlled, detail: bridge.controlled ? 'tessvm 실행 중' : 'tessvm 대기 중' });
}

window.addEventListener('message', (event) => {
  // Only the content script's own messages, and only from this page — never
  // from a frame the work happens to have opened.
  if (event.source && event.source !== window) return;
  if (event.origin && event.origin !== window.location.origin) return;
  if (!isContentMessage(event.data)) return;
  applySettings(event.data.settings);
});

bridge.install();
post({ channel: CHANNEL, from: 'page', type: 'ready' });
