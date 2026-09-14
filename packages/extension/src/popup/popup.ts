/**
 * @fileoverview The toolbar panel: switches written straight to storage.
 *
 * Open work pages watch the same keys, so a change lands without a reload.
 * The runner itself is one button — pressing it turns it on, pressing it again
 * takes it off — and the rows under it are that runner's own settings.
 */
import { readSettings, write, ENABLED_KEY, SVG_KEY, MASK_KEY, NOTICE_KEY } from '../browser.ts';
import {
  clearWorks, exportAll, exportName, importAll, listWorks, removeWork, type SavedSummary,
} from '../store-db.ts';

const power = document.getElementById('enabled') as HTMLButtonElement;
const svg = document.getElementById('svg') as HTMLInputElement;
const mask = document.getElementById('mask') as HTMLInputElement;
const notice = document.getElementById('notice') as HTMLInputElement;
const chip = document.getElementById('chip') as HTMLElement;
const saves = document.getElementById('saves') as HTMLElement;
const savesEmpty = document.getElementById('saves-empty') as HTMLElement;
const clearAll = document.getElementById('clear') as HTMLButtonElement;
const exportButton = document.getElementById('export') as HTMLButtonElement;
const importButton = document.getElementById('import') as HTMLButtonElement;
const file = document.getElementById('file') as HTMLInputElement;
const savesNote = document.getElementById('saves-note') as HTMLElement;
const state = document.getElementById('state') as HTMLElement;
const note = document.getElementById('note') as HTMLElement;

const TEXT = {
  on: {
    chip: '켜짐',
    state: 'tessvm 으로 실행 중',
    note: ['작품 페이지의 실행 화면을 tessvm 이 대신합니다.', '눌러서 끌 수 있습니다.'],
  },
  off: {
    chip: '꺼짐',
    state: '엔트리 기본 실행기',
    note: ['작품 페이지를 원래대로 둡니다.', '눌러서 tessvm 실행기를 켭니다.'],
  },
};

/** The lines of a note, broken where the sentence ends rather than where it fits. */
function lines(text: string[]): Node[] {
  return text.flatMap((line, index) =>
    index === 0
      ? [document.createTextNode(line)]
      : [document.createElement('br'), document.createTextNode(line)],
  );
}

function paint(on: boolean): void {
  const text = on ? TEXT.on : TEXT.off;
  power.setAttribute('aria-checked', String(on));
  document.body.classList.toggle('is-off', !on);
  chip.textContent = text.chip;
  state.textContent = text.state;
  note.replaceChildren(...lines(text.note));
}

power.addEventListener('click', () => {
  const on = power.getAttribute('aria-checked') !== 'true';
  paint(on);
  void write(ENABLED_KEY, on);
});

svg.addEventListener('change', () => {
  void write(SVG_KEY, svg.checked);
});

mask.addEventListener('change', () => {
  void write(MASK_KEY, mask.checked);
});

notice.addEventListener('change', () => {
  void write(NOTICE_KEY, notice.checked);
});

void readSettings().then((settings) => {
  svg.checked = settings.svg;
  mask.checked = settings.mask;
  notice.checked = settings.notice;
  paint(settings.enabled);
});

// ---------------------------------------------------------------------------
//  저장된 데이터
// ---------------------------------------------------------------------------
/** `1.2 KB` — 목록에 적을 만큼만 어림합니다. */
function sizeText(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

const when = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'short', timeStyle: 'short' });

/**
 * 한 번 누르면 묻고, 이어서 누르면 지웁니다 — 팝업에서 창을 띄우면 팝업이 닫히므로
 * 확인도 그 단추 자리에서 받습니다. 다른 곳을 누르면 되돌아갑니다.
 */
function confirmingButton(label: string, sure: string, run: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  let asked = false;
  const reset = () => {
    asked = false;
    button.textContent = label;
    button.classList.remove('is-sure');
  };
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    if (asked) {
      reset();
      run();
      return;
    }
    asked = true;
    button.textContent = sure;
    button.classList.add('is-sure');
  });
  button.addEventListener('blur', reset);
  return button;
}

function saveRow(saved: SavedSummary, again: () => void): HTMLLIElement {
  const row = document.createElement('li');
  row.className = 'save';
  const text = document.createElement('span');
  text.className = 'save-text';
  const title = document.createElement('span');
  title.className = 'save-title';
  title.textContent = saved.title;
  title.title = saved.work;
  const meta = document.createElement('span');
  meta.className = 'save-meta';
  meta.textContent = `${saved.names}개 · ${sizeText(saved.bytes)}`
    + (saved.updated ? ` · ${when.format(saved.updated)}` : '');
  text.append(title, meta);

  const drop = confirmingButton('삭제', '정말 삭제', () => {
    void removeWork(saved.work).then(again);
  });
  drop.className = 'save-drop';
  row.append(text, drop);
  return row;
}

/** 목록에 있는 것을 모두 지우는 단추. 비어 있으면 자리도 없습니다. */
const clearButton = confirmingButton('전체 삭제', '정말 전체 삭제', () => {
  void clearWorks().then(() => paintSaves());
});
clearButton.id = 'clear';
clearButton.className = 'link';
clearButton.hidden = true;
clearAll.replaceWith(clearButton);

async function paintSaves(): Promise<void> {
  const rows = await listWorks().catch(() => []);
  saves.replaceChildren(...rows.map((row) => saveRow(row, () => void paintSaves())));
  savesEmpty.hidden = rows.length > 0;
  clearButton.hidden = rows.length === 0;
}

void paintSaves();

// ---------------------------------------------------------------------------
//  파일로 내보내기 · 파일에서 가져오기
// ---------------------------------------------------------------------------
/** One line under the buttons, gone again once something else happens. */
function say(text: string, bad = false): void {
  savesNote.textContent = text;
  savesNote.classList.toggle('is-bad', bad);
  savesNote.hidden = text === '';
}

exportButton.addEventListener('click', () => {
  say('');
  void exportAll().then(
    (blob) => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = exportName();
      link.click();
      // The browser has read it by the time the click returns; letting the url
      // go keeps the blob from being held for as long as the panel is open.
      setTimeout(() => URL.revokeObjectURL(url), 0);
      say(`${exportName()} 으로 내보냈습니다.`);
    },
    () => say('내보내지 못했습니다.', true),
  );
});

importButton.addEventListener('click', () => {
  say('');
  file.click();
});

file.addEventListener('change', () => {
  const picked = file.files?.[0];
  // The same file picked twice must be read twice, so the input is emptied.
  file.value = '';
  if (!picked) {
    return;
  }
  importButton.disabled = true;
  void importAll(picked)
    .then(
      (works) => {
        say(`작품 ${works}개를 가져왔습니다.`);
        return paintSaves();
      },
      (error: Error) => say(error?.message || '가져오지 못했습니다.', true),
    )
    .finally(() => {
      importButton.disabled = false;
    });
});
