/** 소리 tab: sounds uploaded from the computer. */
import { useRef } from 'preact/hooks';
import { addSound, removeSound, selectedObject } from '../model/store.ts';
import { resolveAsset, saveAsset } from '../model/assets.ts';
import { audioDuration, readDataUrl } from '../model/files.ts';
import { PlayIcon, TrashIcon, UploadIcon } from './icons.tsx';
import { notify } from './state.ts';

export function SoundPane() {
  const object = selectedObject.value;
  const upload = useRef<HTMLInputElement>(null);

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
        <table class="tbl">
          <thead>
            <tr><th style="width:44px" /><th>이름</th><th style="width:20%">길이</th><th style="width:90px" /></tr>
          </thead>
          <tbody>
            {object.sounds.map((sound) => (
              <tr key={sound.id}>
                <td>
                  <button
                    class="iconbtn"
                    title="들어보기"
                    onClick={() => {
                      void new Audio(resolveAsset(sound.url)).play().catch(() => notify('소리를 재생하지 못했습니다.'));
                    }}
                  >
                    <PlayIcon size={13} />
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
            ))}
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
