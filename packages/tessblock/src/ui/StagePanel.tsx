/** The stage: tessvm runs the compiled work right here. */
import { useSignal } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';
import { currentScene, project } from '../model/store.ts';
import { pause, relayout, resume, start, stop } from '../runtime/run.ts';
import { currentSource } from './source.ts';
import { codeOpen, notify, stageFullscreen } from './state.ts';
import { StagePreview } from './StagePreview.tsx';
import { FlagIcon, MaximizeIcon, MinimizeIcon, PauseIcon, PlayIcon, StopIcon } from './icons.tsx';

export function StagePanel() {
  const host = useRef<HTMLDivElement>(null);
  const running = useSignal(false);
  const paused = useSignal(false);
  const busy = useSignal(false);

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

  async function run() {
    if (!host.current || busy.value) return;
    busy.value = true;
    try {
      const built = await start(
        host.current,
        currentSource(),
        project.peek().name,
        currentScene.peek()?.name ?? '',
      );
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
    host.current?.replaceChildren();
  }

  function setFullscreen(on: boolean) {
    stageFullscreen.value = on;
    if (running.value) setTimeout(() => relayout(), 50);
  }

  const isFs = stageFullscreen.value;

  return (
    <section class={`stage-block ${isFs ? 'is-fullscreen' : ''}`}>
      {isFs && (
        <div class="fs-topbar">
          <div class="fs-controls">
            {running.value ? (
              <>
                <button class="play pause" onClick={togglePause} title={paused.value ? '계속하기' : '일시정지'}>
                  {paused.value ? <PlayIcon size={14} /> : <PauseIcon size={14} />}
                  {paused.value ? '계속하기' : '일시정지'}
                </button>
                <button class="play stop" onClick={halt}>
                  <StopIcon size={14} /> 정지하기
                </button>
              </>
            ) : (
              <button class="play flag-btn" onClick={run} disabled={busy.value}>
                <FlagIcon size={14} /> 시작하기
              </button>
            )}
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
        {!running.value && <StagePreview />}
        <div class="stage-host" ref={host} tabIndex={0} />
      </div>

      {!isFs && (
        <div class="stage-controls">
          {running.value ? (
            <>
              <button class="play pause" onClick={togglePause} title={paused.value ? '계속하기' : '일시정지'}>
                {paused.value ? <PlayIcon size={13} /> : <PauseIcon size={13} />}
                {paused.value ? '계속하기' : '일시정지'}
              </button>
              <button class="play stop" onClick={halt}>
                <StopIcon size={13} /> 정지하기
              </button>
            </>
          ) : (
            <button class="play flag-btn" onClick={run} disabled={busy.value}>
              <FlagIcon size={14} /> 시작하기
            </button>
          )}
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
