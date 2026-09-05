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
import { setStageSize, stage, type Entity } from '../runtime/model.ts';

export interface BootOptions {
  projectUrl?: string;
  project?: EntryProjectLike;
  container?: HTMLElement;
  autoStart?: boolean;
  quality?: number;
  /** Overrides the project's own `speed`; leave unset to follow it. */
  fps?: number;
  showStats?: boolean;
  /** What `boost_mode?` answers. On by default — the renderer is WebGL anyway. */
  boost?: boolean;
  /** Stage size in entry units. Entry's own stage is 480×270. */
  stageWidth?: number;
  stageHeight?: number;
}

export interface TessVmHandle {
  vm: Vm;
  renderer: PixiRenderer;
  audio: WebAudioEngine;
  /** Live stage metrics — read `stage.width` · `stage.height`. */
  stage: typeof stage;
  /** What this runner started with; the debug panel's "as it really is" restores these. */
  defaultBoost: boolean;
  defaultTouch: boolean;
  defaultDeviceType: 'desktop' | 'tablet' | 'mobile';
  start(): void;
  stop(): void;
  pause(): void;
  /** Re-fits the canvas after the window or the quality setting changed. */
  relayout(): void;
  /** Resizes the stage itself, in entry units. */
  setStageSize(width: number, height: number): void;
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

/**
 * A worker that only ticks. Timers on a hidden page are clamped to one wake-up
 * a second (and one a minute after a while), but a dedicated worker's are not,
 * so this is what keeps the frames coming while the tab is in the background.
 */
const TICKER_WORKER = `let id = 0;
onmessage = (e) => {
  clearInterval(id);
  id = e.data > 0 ? setInterval(() => postMessage(0), e.data) : 0;
};`;

/**
 * Calls `step` once a frame. `requestAnimationFrame` follows the display while
 * the page is visible; the browser stops it altogether once the tab is hidden,
 * so a worker's timer takes over there and the project keeps running. `step`
 * reads the clock itself, so a driver that fires late or unevenly only means
 * the engine catches up on its own.
 */
function startFrameDriver(step: (now: number) => void): void {
  const INTERVAL = 1000 / 60;
  let raf = 0;
  let timer = 0;
  let worker: Worker | null = null;

  const tick = () => step(performance.now());
  const loop = () => {
    raf = requestAnimationFrame(loop);
    tick();
  };

  const makeWorker = () => {
    try {
      const url = URL.createObjectURL(new Blob([TICKER_WORKER], { type: 'text/javascript' }));
      const made = new Worker(url);
      URL.revokeObjectURL(url);
      made.onmessage = tick;
      return made;
    } catch (error) {
      // Blob workers can be barred (a page CSP, a hardened browser). A plain
      // timer still runs in the background, just at whatever rate it is held to.
      return null;
    }
  };

  const startBackground = () => {
    if (worker || timer) {
      return;
    }
    worker = makeWorker();
    if (worker) {
      worker.postMessage(INTERVAL);
    } else {
      timer = window.setInterval(tick, INTERVAL);
    }
  };

  const stopBackground = () => {
    worker?.terminate();
    worker = null;
    if (timer) {
      clearInterval(timer);
      timer = 0;
    }
  };

  const follow = () => {
    if (document.hidden) {
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      startBackground();
      return;
    }
    stopBackground();
    if (!raf) {
      raf = requestAnimationFrame(loop);
    }
  };

  document.addEventListener('visibilitychange', follow);
  follow();
}

export async function boot(options: BootOptions = {}): Promise<TessVmHandle> {
  const container = options.container ?? document.body;
  const project =
    options.project ??
    ((await (await fetch(options.projectUrl ?? '/project.json')).json()) as EntryProjectLike);

  if (options.stageWidth && options.stageHeight) {
    setStageSize(options.stageWidth, options.stageHeight);
  }

  const view = document.createElement('div');
  view.className = 'tessvm-stage';
  container.appendChild(view);
  // The canvas and everything pinned to it live in one box, so the readout
  // below can sit just outside the picture instead of over it.
  const frame = document.createElement('div');
  frame.className = 'tessvm-frame';
  view.appendChild(frame);

  const renderer = new PixiRenderer({ parent: frame, quality: options.quality ?? 1 });
  await renderer.init();

  const audio = new WebAudioEngine();
  const boost = options.boost ?? true;
  const touch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  const deviceType = /Mobi|Android/i.test(navigator.userAgent) ? 'mobile' : 'desktop';
  const vm = new Vm({
    renderer,
    audio,
    speech: new SpeechSynthesisEngine(),
    fps: options.fps,
    boost,
    touch,
    deviceType,
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
  // Only the opening scene is worth waiting for; the rest streams in.
  await renderer.preload(vm.targets, vm.currentSceneId);
  void audio.preload(vm.targets.flatMap((target) => target.sounds));
  // Paint the opening frame even when the project is not started yet, then
  // measure the text boxes again once the entry web fonts have arrived.
  renderer.flush();
  void renderer.waitForFonts();

  const question = makeQuestionField(frame, (value) => {
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

  bindInput(vm, renderer, view);

  // The canvas is fitted into the box the host gives us, and that box holds the
  // canvas: writing a new canvas size from inside a ResizeObserver callback
  // feeds straight back into the same observer. Two things break that loop —
  // a box that has not changed is not laid out again, and the layout itself is
  // written in a later frame instead of inside the observation pass.
  let lastWidth = 0;
  let lastHeight = 0;
  const layout = (force: boolean) => {
    const width = view.clientWidth || stage.worldWidth;
    const height = view.clientHeight || stage.worldHeight;
    if (!force && width === lastWidth && height === lastHeight) {
      return;
    }
    lastWidth = width;
    lastHeight = height;
    renderer.layout(width, height);
  };
  const resize = () => layout(true);
  let queued = 0;
  const layoutSoon = () => {
    if (queued) {
      return;
    }
    queued = requestAnimationFrame(() => {
      queued = 0;
      layout(false);
    });
  };
  resize();
  window.addEventListener('resize', resize);
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(layoutSoon).observe(view);
  }

  const stats = options.showStats ? makeStats(frame) : null;
  let last = performance.now();
  let frames = 0;
  let accumulated = 0;

  const step = (now: number) => {
    vm.advance(now);
    if (stats) {
      frames += 1;
      accumulated += now - last;
      last = now;
      if (accumulated >= 500) {
        stats.textContent =
          `${Math.round((frames * 1000) / accumulated)} fps · ${vm.frame} tick` +
          ` · ${vm.frameRate}Hz · ${stage.width}×${stage.height}`;
        frames = 0;
        accumulated = 0;
      }
    }
  };
  startFrameDriver(step);

  const handle: TessVmHandle = {
    vm,
    renderer,
    audio,
    stage,
    defaultBoost: boost,
    defaultTouch: touch,
    defaultDeviceType: deviceType,
    start: () => vm.start(),
    stop: () => {
      vm.stop();
      vm.reset();
      renderer.flush();
    },
    pause: () => vm.pause(),
    relayout: resize,
    setStageSize(width: number, height: number) {
      setStageSize(width, height);
      renderer.applyStageSize();
      for (const target of vm.targets) {
        target.forEachEntity((entity) => {
          entity.touch();
        });
      }
      resize();
      renderer.flush();
    },
  };

  if (options.autoStart !== false) {
    vm.start();
  }
  (window as unknown as { tessvm: TessVmHandle }).tessvm = handle;
  return handle;
}

function bindInput(vm: Vm, renderer: PixiRenderer, view: HTMLElement): void {
  const toStage = (clientX: number, clientY: number) => {
    const rect = renderer.canvasRect();
    return {
      x: stage.width * ((clientX - rect.left) / rect.width - 0.5),
      y: -stage.height * ((clientY - rect.top) / rect.height - 0.5),
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

  view.addEventListener('pointermove', (event) => move(event.clientX, event.clientY));
  view.addEventListener('pointerdown', (event) => {
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
    // A release outside the stage still clears the press. A release that never
    // began on the stage (a click on the debug panel, say) is not the work's.
    if (!vm.mouseDown && !vm.clickedEntityId) {
      return;
    }
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
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}

/** Front-most entity under the pointer, tested against its own pixels. */
function pick(vm: Vm, _renderer: PixiRenderer): Entity | null {
  const worldX = vm.mouseX * stage.scale + stage.worldWidth / 2;
  const worldY = -vm.mouseY * stage.scale + stage.worldHeight / 2;
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

function makeQuestionField(view: HTMLElement, submit: (value: string) => void) {
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
  view.appendChild(wrap);
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

function makeStats(view: HTMLElement): HTMLElement {
  const element = document.createElement('div');
  element.className = 'tessvm-stats';
  view.appendChild(element);
  return element;
}

