/** The stage: tessvm runs the compiled work right here. */
import { useSignal } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';
import { currentScene, project } from '../model/store.ts';
import { activeThreads, pause, relayout, resume, start, stop } from '../runtime/run.ts';
import { currentSource } from './source.ts';
import { codeOpen, debugRequest, notify, runningStack, stageFullscreen } from './state.ts';
import { StagePreview } from './StagePreview.tsx';
import { FireFlagIcon, FlagIcon, MaximizeIcon, MinimizeIcon, PauseIcon, PlayIcon, StopIcon } from './icons.tsx';

/** Longest the preview stays in front of a started work waiting for its costumes. */
const REVEAL_LIMIT_MS = 1500;

export function StagePanel() {
  const host = useRef<HTMLDivElement>(null);
  const running = useSignal(false);
  const paused = useSignal(false);
  const busy = useSignal(false);
  /** False while a started work is still bringing its costumes in; the preview stays in front until then. */
  const revealed = useSignal(true);
  /** Name of the object whose double-clicked stack is running on its own, or null. */
  const debugging = useSignal<string | null>(null);
  const shiftHeld = useSignal(false);
  /** The running work was started in boost mode; its pause button smoulders. */
  const boosted = useSignal(false);
  const stackWatch = useRef<number | undefined>(undefined);

  useEffect(() => () => stop(), []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && stageFullscreen.value) {
        stageFullscreen.value = false;
        if (running.value) setTimeout(() => relayout(), 50);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  /**
   * Starts from the scene being worked on. Shift runs in boost mode (the flag
   * catches fire while Shift is held); Alt starts from the first scene, as entry does.
   */
  function run(event?: MouseEvent) {
    const fromFirst = Boolean(event?.altKey);
    void launch(currentSource(), fromFirst ? '' : currentScene.peek()?.name ?? '', null, Boolean(event?.shiftKey));
  }

  // Shift turns the flag into the boost flag while it is held.
  useEffect(() => {
    const track = (event: KeyboardEvent) => { shiftHeld.value = event.shiftKey; };
    const release = () => { shiftHeld.value = false; };
    window.addEventListener('keydown', track);
    window.addEventListener('keyup', track);
    window.addEventListener('blur', release);
    return () => {
      window.removeEventListener('keydown', track);
      window.removeEventListener('keyup', track);
      window.removeEventListener('blur', release);
    };
  }, []);

  // A double-clicked stack runs on its own; stopping puts the stage back as it was.
  useEffect(() => debugRequest.subscribe((request) => {
    if (!request) return;
    debugRequest.value = null;
    if (running.value) halt();
    void launch(request.source, request.scene, request.label, request.boost);
  }), []);

  async function launch(source: string, scene: string, debugLabel: string | null, boost = false) {
    if (!host.current || busy.value) return;
    busy.value = true;
    revealed.value = false;
    debugging.value = debugLabel;
    boosted.value = boost;
    if (!debugLabel) runningStack.value = null;
    try {
      const built = await start(
        host.current,
        source,
        project.peek().name,
        scene,
        (loaded, total) => { if (loaded >= total) revealed.value = true; },
        boost,
      );
      // Costumes that are slow to come in do not hold the picture back for long.
      setTimeout(() => { revealed.value = true; }, REVEAL_LIMIT_MS);
      if (!built.project) {
        runningStack.value = null;
        const first = built.errors[0];
        notify(
          first
            ? `${first.line}:${first.column} ${first.message}`
            : '작품을 만들 수 없습니다.',
        );
        codeOpen.value = true;
        return;
      }
      running.value = true;
      paused.value = false;
      host.current.focus();
      if (debugLabel) watchStack();
    } catch (error) {
      notify(error instanceof Error ? error.message : '실행하지 못했습니다.');
    } finally {
      busy.value = false;
    }
  }

  function togglePause() {
    if (paused.value) resume();
    else pause();
    paused.value = !paused.value;
  }

  /** Lights the double-clicked stack until its scripts have all ended (a `forever` keeps it lit). */
  function watchStack() {
    window.clearInterval(stackWatch.current);
    const began = performance.now();
    let seen = false;
    stackWatch.current = window.setInterval(() => {
      const threads = activeThreads();
      if (threads > 0) seen = true;
      // A stack over within the first frame is never seen running; it stays lit briefly.
      if ((seen && threads === 0) || (!seen && performance.now() - began > 1000)) {
        window.clearInterval(stackWatch.current);
        runningStack.value = null;
      }
    }, 150);
  }

  function halt() {
    window.clearInterval(stackWatch.current);
    runningStack.value = null;
    stop();
    running.value = false;
    paused.value = false;
    debugging.value = null;
    host.current?.replaceChildren();
  }

  function setFullscreen(on: boolean) {
    stageFullscreen.value = on;
    if (running.value) setTimeout(() => relayout(), 50);
  }

  const isFs = stageFullscreen.value;

  const controls = running.value ? (
    <>
      <button
        class={`play pause ${boosted.value ? 'boost' : ''}`}
        onClick={togglePause}
        title={paused.value ? '계속하기' : '일시정지'}
        aria-label={paused.value ? '계속하기' : '일시정지'}
      >
        {paused.value ? <PlayIcon size={20} /> : <PauseIcon size={20} />}
      </button>
      <button class="play stop" onClick={halt} title="정지하기" aria-label="정지하기">
        <StopIcon size={20} />
      </button>
      {debugging.value && (
        <span class="debug-pill" title="더블클릭한 블록만 실행 중입니다. 정지하면 원래 상태로 돌아갑니다.">
          <span class="debug-dot" aria-hidden="true" />
          디버깅 중 · {debugging.value}
        </span>
      )}
    </>
  ) : (
    <button
      class={`play flag-btn ${shiftHeld.value ? 'shift' : ''}`}
      onClick={(event) => void run(event)}
      disabled={busy.value}
      title="시작하기 (Shift: 부스트 모드 · Alt: 첫 장면부터)"
      aria-label="시작하기"
    >
      <span class="flag-plain"><FlagIcon size={22} /></span>
      <span class="flag-fire"><FireFlagIcon size={22} /></span>
    </button>
  );

  return (
    <section class={`stage-block ${isFs ? 'is-fullscreen' : ''}`}>
      {isFs && (
        <div class="fs-topbar">
          <div class="fs-controls">
            {controls}
          </div>
          <span class="spacer" />
          <button
            class="iconbtn fs-close"
            title="전체화면 나가기 (ESC)"
            onClick={() => setFullscreen(false)}
          >
            <MinimizeIcon size={15} />
          </button>
        </div>
      )}

      <div class={`stage-frame ${running.value && debugging.value ? 'debugging' : ''}`}>
        {(!running.value || !revealed.value) && <StagePreview />}
        <div
          class={`stage-host ${revealed.value ? '' : 'concealed'}`}
          ref={host}
          tabIndex={0}
        />
      </div>

      {!isFs && (
        <div class="stage-controls">
          {controls}
          <span class="spacer" style="flex:1" />
          <button
            class="iconbtn"
            title="전체화면"
            aria-label="전체화면"
            onClick={() => setFullscreen(true)}
          >
            <MaximizeIcon size={14} />
          </button>
        </div>
      )}
    </section>
  );
}
