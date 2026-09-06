/**
 * @fileoverview The toolbar panel: one switch, written straight to storage.
 *
 * Open work pages watch the same key, so the change lands without a reload.
 */
import { isEnabled, setEnabled } from '../browser.ts';

const input = document.getElementById('enabled') as HTMLInputElement;
const note = document.getElementById('note') as HTMLElement;

const NOTE = {
  on: '작품 페이지에서 tessvm 실행기가 켜집니다.',
  off: '엔트리 기본 실행기를 그대로 씁니다.',
};

function show(value: boolean): void {
  input.checked = value;
  note.textContent = value ? NOTE.on : NOTE.off;
}

input.addEventListener('change', () => {
  show(input.checked);
  void setEnabled(input.checked);
});

void isEnabled().then(show);
