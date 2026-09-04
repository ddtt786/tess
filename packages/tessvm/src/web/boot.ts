/**
 * @fileoverview 브라우저에서 tessvm 을 띄우는 진입점입니다.
 *
 * 작품을 받아 렌더러·소리·입력을 붙이고 프레임 루프를 돌립니다. 화면에 얹는 것 중
 * 캔버스에 그릴 이유가 없는 것(대답 입력칸, 실행 단추, 상태 표시)은 HTML 로 둡니다 —
 * 해상도를 올려도 흐려지지 않고, 모바일 키보드도 그대로 동작합니다.
 */
import { Vm, type EntryProjectLike } from '../runtime/engine.ts';
import { PixiRenderer } from '../render/renderer.ts';
import { SpeechSynthesisEngine, WebAudioEngine } from '../audio/sound.ts';
import { STAGE_HEIGHT, STAGE_WIDTH, WORLD_SCALE, WORLD_WIDTH, WORLD_HEIGHT, type Entity } from '../runtime/model.ts';

export interface BootOptions {
  projectUrl?: string;
  project?: EntryProjectLike;
  container?: HTMLElement;
  autoStart?: boolean;
  quality?: number;
  fps?: number;
  showStats?: boolean;
  /** What `boost_mode?` answers; the renderer is WebGL regardless. */
  boost?: boolean;
}

export interface TessVmHandle {
  vm: Vm;
  renderer: PixiRenderer;
  audio: WebAudioEngine;
  start(): void;
  stop(): void;
  pause(): void;
}

/** Legacy key codes entry stores in `when_some_key_pressed`. */
const KEY_CODES: Record<string, number> = {
  Backspace: 8, Tab: 9, Enter: 13, ShiftLeft: 16, ShiftRight: 16, ControlLeft: 17,
  ControlRight: 17, AltLeft: 18, AltRight: 18, CapsLock: 20, Escape: 27, Space: 32,
  PageUp: 33, PageDown: 34, End: 35, Home: 36, ArrowLeft: 37, ArrowUp: 38,
  ArrowRight: 39, ArrowDown: 40, Insert: 45, Delete: 46,
  Digit0: 48, Digit1: 49, Digit2: 50, Digit3: 51, Digit4: 52, Digit5: 53,
  Digit6: 54, Digit7: 55, Digit8: 56, Digit9: 57,
  KeyA: 65, KeyB: 66, KeyC: 67, KeyD: 68, KeyE: 69, KeyF: 70, KeyG: 71, KeyH: 72,
  KeyI: 73, KeyJ: 74, KeyK: 75, KeyL: 76, KeyM: 77, KeyN: 78, KeyO: 79, KeyP: 80,
  KeyQ: 81, KeyR: 82, KeyS: 83, KeyT: 84, KeyU: 85, KeyV: 86, KeyW: 87, KeyX: 88,
  KeyY: 89, KeyZ: 90,
  Numpad0: 96, Numpad1: 97, Numpad2: 98, Numpad3: 99, Numpad4: 100, Numpad5: 101,
  Numpad6: 102, Numpad7: 103, Numpad8: 104, Numpad9: 105,
  F1: 112, F2: 113, F3: 114, F4: 115, F5: 116, F6: 117, F7: 118, F8: 119,
  F9: 120, F10: 121, F11: 122, F12: 123,
  Semicolon: 186, Equal: 187, Comma: 188, Minus: 189, Period: 190, Slash: 191,
  Backquote: 192, BracketLeft: 219, Backslash: 220, BracketRight: 221, Quote: 222,
};

function keyCodeOf(event: KeyboardEvent): number {
  const mapped = KEY_CODES[event.code];
  if (mapped !== undefined) {
    return mapped;
  }
  return event.keyCode || 0;
}

export async function boot(options: BootOptions = {}): Promise<TessVmHandle> {
  const container = options.container ?? document.body;
  const project =
    options.project ??
    ((await (await fetch(options.projectUrl ?? '/project.json')).json()) as EntryProjectLike);

  const stage = document.createElement('div');
  stage.className = 'tessvm-stage';
  container.appendChild(stage);

  const renderer = new PixiRenderer({ parent: stage, quality: options.quality ?? 1 });
  await renderer.init();

  const audio = new WebAudioEngine();
  const vm = new Vm({
    renderer,
    audio,
    speech: new SpeechSynthesisEngine(),
    fps: options.fps ?? 60,
    boost: options.boost ?? false,
    touch: 'ontouchstart' in window || navigator.maxTouchPoints > 0,
    deviceType: /Mobi|Android/i.test(navigator.userAgent) ? 'mobile' : 'desktop',
  });

  vm.load(project);
  renderer.overlayView?.bind({
    variables: vm.variables,
    answer: () => vm.answer,
    answerVisible: () => vm.answerVisible,
    timer: () => vm.timerValue(),
    timerVisible: () => vm.timerVisible,
    scene: () => vm.currentSceneId,
  });
  await renderer.preload(vm.targets);
  void audio.preload(vm.targets.flatMap((target) => target.sounds));
  // Paint the opening frame even when the project is not started yet.
  renderer.flush();

  const question = makeQuestionField(stage, (value) => {
    vm.pendingAnswer = value;
  });
  const originalShow = renderer.showQuestion.bind(renderer);
  renderer.showQuestion = (text: string) => {
    originalShow(text);
    question.show();
  };
  const originalHide = renderer.hideQuestion.bind(renderer);
  renderer.hideQuestion = () => {
    originalHide();
    question.hide();
  };

  bindInput(vm, renderer, stage);

  const resize = () => {
    const rect = stage.getBoundingClientRect();
    renderer.layout(rect.width || WORLD_WIDTH, rect.height || WORLD_HEIGHT);
  };
  resize();
  window.addEventListener('resize', resize);
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(resize).observe(stage);
  }

  const stats = options.showStats ? makeStats(stage) : null;
  let last = performance.now();
  let frames = 0;
  let accumulated = 0;

  const loop = (now: number) => {
    vm.advance(now);
    if (stats) {
      frames += 1;
      accumulated += now - last;
      last = now;
      if (accumulated >= 500) {
        stats.textContent = `${Math.round((frames * 1000) / accumulated)} fps · ${vm.frame} tick`;
        frames = 0;
        accumulated = 0;
      }
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  const handle: TessVmHandle = {
    vm,
    renderer,
    audio,
    start: () => vm.start(),
    stop: () => {
      vm.stop();
      vm.reset();
      renderer.flush();
    },
    pause: () => vm.pause(),
  };

  if (options.autoStart !== false) {
    vm.start();
  }
  (window as unknown as { tessvm: TessVmHandle }).tessvm = handle;
  return handle;
}

function bindInput(vm: Vm, renderer: PixiRenderer, stage: HTMLElement): void {
  const toStage = (clientX: number, clientY: number) => {
    const rect = renderer.canvasRect();
    return {
      x: STAGE_WIDTH * ((clientX - rect.left) / rect.width - 0.5),
      y: -STAGE_HEIGHT * ((clientY - rect.top) / rect.height - 0.5),
    };
  };

  window.addEventListener('keydown', (event) => {
    const code = keyCodeOf(event);
    if (!vm.pressedKeys.has(code)) {
      vm.pressedKeys.add(code);
      vm.fireEvent('keyPress', String(code));
    }
    if (code >= 37 && code <= 40 && document.activeElement?.tagName !== 'INPUT') {
      event.preventDefault();
    }
  });
  window.addEventListener('keyup', (event) => {
    vm.pressedKeys.delete(keyCodeOf(event));
  });
  window.addEventListener('blur', () => vm.pressedKeys.clear());

  const move = (clientX: number, clientY: number) => {
    const point = toStage(clientX, clientY);
    vm.mouseX = point.x;
    vm.mouseY = point.y;
  };

  stage.addEventListener('pointermove', (event) => move(event.clientX, event.clientY));
  stage.addEventListener('pointerdown', (event) => {
    move(event.clientX, event.clientY);
    vm.mouseDown = true;
    vm.fireEvent('mouse_clicked');
    const hit = pick(vm, renderer);
    if (hit) {
      vm.clickedEntityId = hit.id;
      vm.fireEventOn('when_object_click', hit);
    }
  });
  const up = () => {
    vm.mouseDown = false;
    vm.fireEvent('mouse_click_cancled');
    const clicked = vm.clickedEntityId;
    vm.clickedEntityId = null;
    if (clicked) {
      const entity = vm.targets
        .flatMap((target) => [target.entity, ...target.clones])
        .find((candidate) => candidate.id === clicked);
      if (entity) {
        vm.fireEventOn('when_object_click_canceled', entity);
      }
    }
  };
  stage.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}

/** Front-most entity under the pointer, tested against its own pixels. */
function pick(vm: Vm, _renderer: PixiRenderer): Entity | null {
  const worldX = vm.mouseX * WORLD_SCALE + WORLD_WIDTH / 2;
  const worldY = -vm.mouseY * WORLD_SCALE + WORLD_HEIGHT / 2;
  const scene = vm.currentSceneId;
  for (const target of vm.targets) {
    if (target.sceneId !== scene) {
      continue;
    }
    for (const entity of [target.entity, ...target.clones]) {
      if (vm.collision.touchingMouse(entity, worldX, worldY)) {
        return entity;
      }
    }
  }
  return null;
}

function makeQuestionField(stage: HTMLElement, submit: (value: string) => void) {
  const wrap = document.createElement('form');
  wrap.className = 'tessvm-ask';
  wrap.hidden = true;
  const input = document.createElement('input');
  input.type = 'text';
  input.autocomplete = 'off';
  const button = document.createElement('button');
  button.type = 'submit';
  button.textContent = '확인';
  wrap.append(input, button);
  wrap.addEventListener('submit', (event) => {
    event.preventDefault();
    submit(input.value);
    input.value = '';
  });
  stage.appendChild(wrap);
  return {
    show() {
      wrap.hidden = false;
      input.focus();
    },
    hide() {
      wrap.hidden = true;
      input.blur();
    },
  };
}

function makeStats(stage: HTMLElement): HTMLElement {
  const element = document.createElement('div');
  element.className = 'tessvm-stats';
  stage.appendChild(element);
  return element;
}

export { STAGE_WIDTH, STAGE_HEIGHT, WORLD_HEIGHT };
