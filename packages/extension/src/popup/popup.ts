/**
 * @fileoverview The toolbar panel: switches written straight to storage.
 *
 * Open work pages watch the same keys, so a change lands without a reload.
 */
import { readSettings, write, ENABLED_KEY, SVG_KEY } from '../browser.ts';

const enabled = document.getElementById('enabled') as HTMLInputElement;
const svg = document.getElementById('svg') as HTMLInputElement;
const note = document.getElementById('note') as HTMLElement;

const NOTE = {
  on: '작품 페이지에서 tessvm 실행기가 켜집니다.',
  off: '엔트리 기본 실행기를 그대로 씁니다.',
};

enabled.addEventListener('change', () => {
  note.textContent = enabled.checked ? NOTE.on : NOTE.off;
  void write(ENABLED_KEY, enabled.checked);
});

svg.addEventListener('change', () => {
  void write(SVG_KEY, svg.checked);
});

void readSettings().then((settings) => {
  enabled.checked = settings.enabled;
  svg.checked = settings.svg;
  note.textContent = settings.enabled ? NOTE.on : NOTE.off;
});
