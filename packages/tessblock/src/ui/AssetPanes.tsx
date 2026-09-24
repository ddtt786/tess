/** 소리 tab: sounds uploaded from the computer. */
import { useSignal } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';
import { addSound, removeSound, selectedObject } from '../model/store.ts';
import { resolveAsset, saveAsset } from '../model/assets.ts';
import { audioDuration, readDataUrl } from '../model/files.ts';
import { PlayIcon, StopIcon, TrashIcon, UploadIcon } from './icons.tsx';
import { notify } from './state.ts';

export function SoundPane() {
  const object = selectedObject.value;
  const upload = useRef<HTMLInputElement>(null);
  const playingId = useSignal<string | null>(null);
  const activeAudio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    return () => {
      if (activeAudio.current) {
        activeAudio.current.pause();
        activeAudio.current = null;
      }
    };
  }, []);

  function togglePlay(soundId: string, url: string) {
    if (playingId.value === soundId && activeAudio.current) {
      activeAudio.current.pause();
      activeAudio.current = null;
      playingId.value = null;
      return;
    }
    if (activeAudio.current) {
      activeAudio.current.pause();
      activeAudio.current = null;
      playingId.value = null;
    }
    try {
      const audio = new Audio(resolveAsset(url));
      activeAudio.current = audio;
      playingId.value = soundId;
      audio.onended = () => {
        if (playingId.value === soundId) {
          playingId.value = null;
          activeAudio.current = null;
        }
      };
      audio.onerror = () => {
        notify('소리를 재생하지 못했습니다.');
        if (playingId.value === soundId) {
          playingId.value = null;
          activeAudio.current = null;
        }
      };
      void audio.play().catch(() => {
        notify('소리를 재생하지 못했습니다.');
        if (playingId.value === soundId) {
          playingId.value = null;
          activeAudio.current = null;
        }
      });
    } catch {
      notify('소리를 재생하지 못했습니다.');
      playingId.value = null;
    }
  }

  async function addFiles(files: FileList | null) {
    if (!object || !files?.length) return;
    for (const file of Array.from(files)) {
      const url = await readDataUrl(file);
      const duration = await audioDuration(url);
      const reference = await saveAsset(url);
      addSound(object.id, { name: file.name.replace(/\.[^.]+$/, '') || '소리', url: reference, duration });
    }
  }

  if (!object) return <div class="sheet"><p class="sub">오브젝트를 먼저 선택하세요.</p></div>;

  return (
    <div class="sheet">
      <div class="sheet-head">
        <div>
          <h3>소리</h3>
          <p class="sub">올린 소리는 블록에서 이름으로 고릅니다.</p>
        </div>
        <span class="spacer" />
        <button class="btn primary" onClick={() => upload.current?.click()}>
          <UploadIcon /> 소리 올리기
        </button>
        <input
          ref={upload}
          type="file"
          accept="audio/*"
          multiple
          hidden
          onChange={(event) => {
            void addFiles((event.target as HTMLInputElement).files);
            (event.target as HTMLInputElement).value = '';
          }}
        />
      </div>

      {object.sounds.length ? (
        <table class="tbl sounds">
          <thead>
            <tr><th style="width:44px" /><th>이름</th><th style="width:20%">길이</th><th style="width:56px" /></tr>
          </thead>
          <tbody>
            {object.sounds.map((sound) => {
              const isPlaying = playingId.value === sound.id;
              return (
                <tr key={sound.id}>
                  <td>
                    <button
                      class={`iconbtn ${isPlaying ? 'on' : ''}`}
                      title={isPlaying ? '멈추기' : '들어보기'}
                      aria-label={isPlaying ? '멈추기' : '들어보기'}
                      onClick={() => togglePlay(sound.id, sound.url)}
                    >
                      {isPlaying ? <StopIcon size={13} /> : <PlayIcon size={13} />}
                    </button>
                  </td>
                  <td>{sound.name}</td>
                  <td class="muted">{sound.duration} 초</td>
                  <td>
                    <div class="actions">
                      <button class="btn ghost danger" onClick={() => removeSound(object.id, sound.id)}>
                        <TrashIcon size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <div class="dropzone" onClick={() => upload.current?.click()}>
          <UploadIcon size={22} />
          <strong>소리 파일을 올려주세요</strong>
          <span>mp3 · wav · ogg</span>
        </div>
      )}
    </div>
  );
}
