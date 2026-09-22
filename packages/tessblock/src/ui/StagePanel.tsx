/** The stage: tessvm runs the compiled work right here. */
import { useSignal } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';
import { project } from '../model/store.ts';
import { start, stop } from '../runtime/run.ts';
import { currentSource } from './source.ts';
import { codeOpen, notify } from './state.ts';
import { StagePreview } from './StagePreview.tsx';
import { PlayIcon, StopIcon } from './icons.tsx';

export function StagePanel() {
  const host = useRef<HTMLDivElement>(null);
  const running = useSignal(false);
  const busy = useSignal(false);

  useEffect(() => () => stop(), []);

  async function run() {
    if (!host.current || busy.value) return;
    busy.value = true;
    try {
      const built = await start(host.current, currentSource(), project.peek().name);
      if (!built.project) {
        const first = built.errors[0];
        notify(first ? `${first.line}:${first.column} ${first.message}` : '작품을 만들 수 없습니다.');
        codeOpen.value = true;
        return;
      }
      running.value = true;
      host.current.focus();
    } catch (error) {
      notify(error instanceof Error ? error.message : '실행하지 못했습니다.');
    } finally {
      busy.value = false;
    }
  }

  function halt() {
    stop();
    running.value = false;
    host.current?.replaceChildren();
  }

  return (
    <section class="stage-block">
      <div class="stage-frame">
        {!running.value && <StagePreview />}
        <div class="stage-host" ref={host} tabIndex={0} />
      </div>
      <div class="stage-controls">
        {running.value
          ? <button class="play stop" onClick={halt}><StopIcon size={13} /> 정지하기</button>
          : <button class="play" onClick={run} disabled={busy.value}><PlayIcon size={13} /> 시작하기</button>}
      </div>
    </section>
  );
}
