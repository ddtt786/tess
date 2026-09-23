/** The stage: tessvm runs the compiled work right here. */
import { useSignal } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';
import { currentScene, project } from '../model/store.ts';
import { pause, relayout, resume, start, stop } from '../runtime/run.ts';
import { currentSource } from './source.ts';
import { codeOpen, debugRequest, notify, stageFullscreen } from './state.ts';
import { StagePreview } from './StagePreview.tsx';
import { FlagIcon, MaximizeIcon, MinimizeIcon, PauseIcon, PlayIcon, StopIcon } from './icons.tsx';

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

  /** Starts from the scene being worked on; with Shift held, from the first scene as entry does. */
  function run(event?: MouseEvent) {
    const fromFirst = Boolean(event?.shiftKey);
    void launch(currentSource(), fromFirst ? '' : currentScene.peek()?.name ?? '', null);
  }

  // A double-clicked stack runs on its own; stopping puts the stage back as it was.
  useEffect(() => debugRequest.subscribe((request) => {
    if (!request) return;
    debugRequest.value = null;
    if (running.value) halt();
    void launch(request.source, request.scene, request.label);
  }), []);

  async function launch(source: string, scene: string, debugLabel: string | null) {
    if (!host.current || busy.value) return;
    busy.value = true;
    revealed.value = false;
    debugging.value = debugLabel;
    try {
      const built = await start(
        host.current,
        source,
        project.peek().name,
        scene,
        (loaded, total) => { if (loaded >= total) revealed.value = true; },
      );
      // Costumes that are slow to come in do not hold the picture back for long.
      setTimeout(() => { revealed.value = true; }, REVEAL_LIMIT_MS);
      if (!built.project) {
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

  function halt() {
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
        class="play pause"
        onClick={togglePause}
        title={paused.value ? '계속하기' : '일시정지'}
        aria-label={paused.value ? '계속하기' : '일시정지'}
      >
        {paused.value ? <PlayIcon size={20} /> : <PauseIcon size={20} />}
      </button>
      <button class="play stop" onClick={halt} title="정지하기" aria-label="정지하기">
        <StopIcon size={20} />
      </button>
    </>
  ) : (
    <button
      class="play flag-btn"
      onClick={(event) => void run(event)}
      disabled={busy.value}
      title="시작하기 (Shift: 첫 장면부터)"
      aria-label="시작하기"
    >
      <FlagIcon size={22} />
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

      <div class="stage-frame">
        {(!running.value || !revealed.value) && <StagePreview />}
        <div class={`stage-host ${revealed.value ? '' : 'concealed'}`} ref={host} tabIndex={0} />
        {running.value && debugging.value && (
          <div class="debug-badge" title="정지하면 원래 상태로 돌아갑니다">
            블록 실행 · {debugging.value}
          </div>
        )}
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
