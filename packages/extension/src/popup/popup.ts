/**
 * @fileoverview The toolbar panel: switches written straight to storage.
 *
 * Open work pages watch the same keys, so a change lands without a reload.
 * The runner itself is one button — pressing it turns it on, pressing it again
 * takes it off — and the rows under it are that runner's own settings.
 */
import { readSettings, write, ENABLED_KEY, SVG_KEY, MASK_KEY, NOTICE_KEY } from '../browser.ts';

const power = document.getElementById('enabled') as HTMLButtonElement;
const svg = document.getElementById('svg') as HTMLInputElement;
const mask = document.getElementById('mask') as HTMLInputElement;
const notice = document.getElementById('notice') as HTMLInputElement;
const chip = document.getElementById('chip') as HTMLElement;
const state = document.getElementById('state') as HTMLElement;
const note = document.getElementById('note') as HTMLElement;

const TEXT = {
  on: {
    chip: '켜짐',
    state: 'tessvm 으로 실행 중',
    note: '작품 페이지의 실행 화면을 tessvm 이 대신합니다. 눌러서 끌 수 있습니다.',
  },
  off: {
    chip: '꺼짐',
    state: '엔트리 기본 실행기',
    note: '작품 페이지를 원래대로 둡니다. 눌러서 tessvm 실행기를 켭니다.',
  },
};

function paint(on: boolean): void {
  const text = on ? TEXT.on : TEXT.off;
  power.setAttribute('aria-checked', String(on));
  document.body.classList.toggle('is-off', !on);
  chip.textContent = text.chip;
  state.textContent = text.state;
  note.textContent = text.note;
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
