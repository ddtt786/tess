/**
 * @fileoverview The toolbar popup — where tessvm is switched on and shaped.
 */
import { api, readSettings, writeSettings } from '../common/browser.ts';
import { DEFAULT_SETTINGS, type Settings } from '../common/settings.ts';

const enabled = document.getElementById('enabled') as HTMLInputElement;
const pipeline = document.getElementById('pipeline') as HTMLSelectElement;
const quality = document.getElementById('quality') as HTMLSelectElement;
const showStats = document.getElementById('showStats') as HTMLInputElement;
const relaxCsp = document.getElementById('relaxCsp') as HTMLInputElement;
const state = document.getElementById('state') as HTMLParagraphElement;
const note = document.getElementById('note') as HTMLSpanElement;
const reload = document.getElementById('reload') as HTMLButtonElement;

// The defaults stand in until storage answers, so an early click still writes
// a whole record rather than a half of one.
let current: Settings = { ...DEFAULT_SETTINGS };

function render(): void {
  enabled.checked = current.enabled;
  pipeline.value = current.pipeline;
  quality.value = String(current.quality);
  showStats.checked = current.showStats;
  relaxCsp.checked = current.relaxCsp;
  state.textContent = current.enabled
    ? current.pipeline === 'tess'
      ? '켜짐 — 작품을 Tess 로 컴파일해서 실행합니다.'
      : '켜짐 — 작품을 그대로 실행합니다.'
    : '꺼짐 — 엔트리 실행기를 그대로 씁니다.';
}

async function save(patch: Partial<Settings>): Promise<void> {
  current = { ...current, ...patch };
  render();
  await writeSettings(current);
  note.textContent = '저장했습니다.';
}

enabled.addEventListener('change', () => void save({ enabled: enabled.checked }));
pipeline.addEventListener('change', () =>
  void save({ pipeline: pipeline.value === 'direct' ? 'direct' : 'tess' }));
quality.addEventListener('change', () =>
  void save({ quality: Number(quality.value) === 4 ? 4 : Number(quality.value) === 2 ? 2 : 1 }));
showStats.addEventListener('change', () => void save({ showStats: showStats.checked }));
relaxCsp.addEventListener('change', async () => {
  await save({ relaxCsp: relaxCsp.checked });
  note.textContent = '새로 고침해야 적용됩니다.';
});

reload.addEventListener('click', () => {
  void api.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
    const id = tabs[0]?.id;
    if (id !== undefined) void api.tabs.reload(id);
  });
});

void readSettings().then((settings) => {
  current = settings;
  render();
});
