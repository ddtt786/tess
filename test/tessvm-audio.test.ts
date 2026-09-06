/**
 * 소리 재생기(`packages/tessvm/src/audio/sound.ts`)와 VM 의 소리 처리 규칙이
 * 엔트리와 같은지 확인합니다.
 *
 * 기준은 entryjs 의 `Entry.Utils.playSound`·`playBGM`·`forceStopSounds`·
 * `forceStopBGM` 과 `block_sound.js`, 그리고 `Entry.scene.selectScene` 입니다.
 * 엔트리는 소리(`Entry.soundInstances`)와 배경음악(`Entry.bgmInstances`)을 서로
 * 다른 목록에 담아 두고, 소리 크기·재생 속도·소리 멈추기 블록은 앞의 목록만
 * 훑습니다.
 *
 * 재생기는 브라우저 모듈이라 노드 타입 검사에서 빠져 있으므로, 디버그 패널
 * 테스트와 같은 방식으로 타입만 지운 원본을 가짜 `AudioContext` 위에 올립니다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';
import { compileProject } from '@tess/compiler';
import { Vm } from '@tess/vm';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

interface FakeSource {
  buffer: unknown;
  loop: boolean;
  playbackRate: { value: number };
  target: unknown;
  started: unknown[] | null;
  stopped: boolean;
  onended: (() => void) | null;
  connect(node: unknown): void;
  start(...args: unknown[]): void;
  stop(): void;
}

interface FakeGain {
  gain: { value: number };
  target: unknown;
  connect(node: unknown): void;
}

function fakeGain(): FakeGain {
  const node: FakeGain = {
    gain: { value: 1 },
    target: null,
    connect(to) { node.target = to; },
  };
  return node;
}

function fakeSource(): FakeSource {
  const node: FakeSource = {
    buffer: null,
    loop: false,
    playbackRate: { value: 1 },
    target: null,
    started: null,
    stopped: false,
    onended: null,
    connect(to) { node.target = to; },
    start(...args) { node.started = args; },
    stop() {
      node.stopped = true;
      node.onended?.();
    },
  };
  return node;
}

/**
 * 재생기가 쓰는 만큼의 WebAudio 를 흉내 냅니다. 만들어진 소스를 모두 들고 있어
 * 무엇이 어디에 이어졌고 무엇이 멈췄는지 확인할 수 있습니다.
 */
function fakeAudio() {
  const sources: FakeSource[] = [];
  const resumed = { count: 0 };
  const context = {
    state: 'running',
    destination: { name: 'destination' },
    resume: () => {
      resumed.count += 1;
      return Promise.resolve();
    },
    suspend: () => Promise.resolve(),
    close: () => Promise.resolve(),
    decodeAudioData: (bytes: unknown) => Promise.resolve({ bytes }),
    createGain: fakeGain,
    createBufferSource() {
      const source = fakeSource();
      sources.push(source);
      return source;
    },
  };
  return { context, sources, resumed };
}

/** 타입만 지운 재생기 원본을 가짜 브라우저 위에 올립니다. */
function loadEngine(context: unknown) {
  const source = stripTypeScriptTypes(
    fs.readFileSync(path.join(root, 'packages/tessvm/src/audio/sound.ts'), 'utf-8'),
    { mode: 'strip' },
  );
  const sandbox: Record<string, unknown> = {
    AudioContext: function AudioContext() { return context; },
    fetch: () => Promise.resolve({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }),
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(`${source.replace(/^export /gm, '')};\nthis.WebAudioEngine = WebAudioEngine;`, sandbox);
  return sandbox.WebAudioEngine as new () => Record<string, (...args: never[]) => unknown>;
}

const sound = (id: string) => ({ id, name: id, fileurl: `/${id}.mp3`, duration: 1 });

/** 파일이 이미 와 있는 상태에서 시작하도록 미리 받아 둡니다. */
async function ready(ids: string[]) {
  const { context, sources, resumed } = fakeAudio();
  const Engine = loadEngine(context);
  const engine = new Engine() as never as {
    preload(sounds: unknown[]): Promise<void>;
    play(sound: unknown, entityId: string, startMs?: number, durationMs?: number): void;
    playBgm(sound: unknown): void;
    stopAll(): void;
    stopBgm(): void;
    stopEntity(id: string): void;
    stopExcept(id: string): void;
    setVolume(value: number): void;
    setSpeed(value: number): void;
  };
  await engine.preload(ids.map(sound));
  return { engine, sources, context, resumed };
}

test('모든 소리 멈추기는 배경음악을 건드리지 않는다', async () => {
  const { engine, sources } = await ready(['a', 'bgm']);
  engine.play(sound('a'), 'e1');
  engine.playBgm(sound('bgm'));
  assert.equal(sources.length, 2);

  engine.stopAll();
  assert.equal(sources[0]!.stopped, true, '소리는 멈춰야 합니다');
  assert.equal(sources[1]!.stopped, false, '배경음악은 이어져야 합니다');

  engine.stopBgm();
  assert.equal(sources[1]!.stopped, true);
});

test('한 오브젝트만·다른 오브젝트만 멈추기도 배경음악은 남긴다', async () => {
  const own = await ready(['a', 'bgm']);
  own.engine.play(sound('a'), 'e1');
  own.engine.playBgm(sound('bgm'));
  own.engine.stopEntity('e1');
  assert.equal(own.sources[0]!.stopped, true);
  assert.equal(own.sources[1]!.stopped, false);

  const others = await ready(['a', 'bgm']);
  others.engine.play(sound('a'), 'e1');
  others.engine.playBgm(sound('bgm'));
  others.engine.stopExcept('e2');
  assert.equal(others.sources[0]!.stopped, true);
  assert.equal(others.sources[1]!.stopped, false, '배경음악은 오브젝트의 소리가 아닙니다');
});

test('배경음악은 한 번만 재생되고 소리 크기·속도를 따르지 않는다', async () => {
  const { engine, sources, context } = await ready(['a', 'bgm']);
  engine.setVolume(0.2);
  engine.setSpeed(2);
  engine.play(sound('a'), 'e1');
  engine.playBgm(sound('bgm'));

  const [normal, bgm] = sources as [FakeSource, FakeSource];
  assert.equal(bgm.loop, false, '엔트리의 배경음악은 반복하지 않습니다');
  assert.equal(bgm.playbackRate.value, 1, '재생 속도는 소리에만 걸립니다');
  assert.equal(normal.playbackRate.value, 2);
  assert.equal((bgm.target as FakeGain).target, context.destination, '배경음악은 소리 크기를 거치지 않습니다');
  assert.notEqual((normal.target as FakeGain).target, context.destination);

  engine.setSpeed(0.5);
  assert.equal(bgm.playbackRate.value, 1, '이미 나고 있는 배경음악도 그대로입니다');
  assert.equal(normal.playbackRate.value, 0.5);
});

test('배경음악은 끝나면 스스로 물러난다', async () => {
  const { engine, sources } = await ready(['bgm']);
  engine.playBgm(sound('bgm'));
  sources[0]!.onended?.();
  engine.stopBgm();
  assert.equal(sources.length, 1, '끝난 배경음악을 다시 멈추려 들지 않습니다');
});

test('일시정지를 푼 뒤에야 소리 요청이 오디오를 되살린다', async () => {
  const { engine, context, resumed } = await ready(['a']);
  const held = engine as never as { pause(): void; resume(): void };
  held.pause();
  context.state = 'suspended';
  const before = resumed.count;

  engine.play(sound('a'), 'e1');
  assert.equal(resumed.count, before, '붙잡아 둔 동안에는 되살리지 않습니다');

  held.resume();
  engine.play(sound('a'), 'e1');
  assert.ok(resumed.count > before, '풀린 뒤에는 되살립니다');
});

// ---------------------------------------------------------------------------
//  VM
// ---------------------------------------------------------------------------

/** 무엇이 불렸는지만 적어 두는 재생기입니다. 오브젝트 아이디는 매번 달라지므로 적지 않습니다. */
function recorder() {
  const calls: string[] = [];
  return {
    calls,
    audio: {
      play: () => calls.push('play'),
      playBgm: () => calls.push('playBgm'),
      stopBgm: () => calls.push('stopBgm'),
      stopAll: () => calls.push('stopAll'),
      stopEntity: () => calls.push('stopEntity'),
      stopExcept: () => calls.push('stopExcept'),
      setVolume: () => {},
      getVolume: () => 1,
      setSpeed: () => {},
      getSpeed: () => 1,
      pause: () => calls.push('pause'),
      resume: () => calls.push('resume'),
    },
    speech: {
      speak: () => Promise.resolve(),
      stop: () => calls.push('speechStop'),
      pause: () => {},
      resume: () => {},
    },
  };
}

function runVm(source: string) {
  const result = compileProject(source, { path: 'test.tess' });
  assert.ok(result.project, result.errors[0]?.message ?? '컴파일 실패');
  const log = recorder();
  const machine = new Vm({ renderer: null, audio: log.audio as never, speech: log.speech as never });
  machine.load(result.project as unknown as never);
  machine.start();
  return { vm: machine, calls: log.calls };
}

test('장면을 바꾸면 그 장면이 켜 둔 소리가 멎는다', () => {
  const { vm: machine, calls } = runVm(`
scene "첫째":
  object "가":
    sound s "s.mp3" for 3
    when start do
      play sound "s"
      jump "둘째"
    end
  end
end

scene "둘째":
  object "나":
  end
end`);
  machine.tick();
  assert.deepEqual(calls, ['play', 'stopAll', 'speechStop']);
  assert.ok(!calls.includes('stopBgm'), '배경음악은 장면을 따라 넘어갑니다');
});

test('같은 장면으로 넘어가면 소리는 그대로다', () => {
  const { vm: machine, calls } = runVm(`
scene "첫째":
  object "가":
    sound s "s.mp3" for 3
    when start do
      play sound "s"
      jump "첫째"
    end
  end
end`);
  machine.tick();
  assert.deepEqual(calls, ['play']);
});

test('소리 멈추기의 대상에 따라 읽어주기까지 멎는다', () => {
  const all = runVm(`
scene "s":
  object "o":
    when start do
      stop sound all
    end
  end
end`);
  all.vm.tick();
  assert.deepEqual(all.calls, ['stopAll', 'speechStop']);

  const mine = runVm(`
scene "s":
  object "o":
    when start do
      stop sound this
    end
  end
end`);
  mine.vm.tick();
  assert.deepEqual(mine.calls, ['stopEntity'], '자기 소리만 멈출 때는 읽어주기가 남습니다');
});

test('배경음악 재생은 앞의 것을 한 번만 물린다', () => {
  const { vm: machine, calls } = runVm(`
scene "s":
  object "o":
    sound s "s.mp3" for 3
    when start do
      play bgm "s"
    end
  end
end`);
  machine.tick();
  assert.deepEqual(calls, ['playBgm']);
});

test('일시정지한 채로 멈추면 다음 실행이 벙어리가 되지 않는다', () => {
  const { vm: machine, calls } = runVm(`
scene "s":
  object "o":
    when start do
      forever:
        wait 1
      end
    end
  end
end`);
  machine.pause();
  machine.stop();
  assert.deepEqual(
    calls.filter((name) => name === 'pause' || name === 'resume'),
    ['pause', 'resume'],
    '멈추면 붙잡아 둔 것이 없으므로 일시정지도 함께 풀립니다',
  );
});

test('장면이 바뀌면 묻고 기다리기 상자가 내려간다', () => {
  const { vm: machine } = runVm(`
scene "첫째":
  object "가":
    when start do
      ask "이름은?"
    end
    when signal "가자" do
      jump "둘째"
    end
  end
end

scene "둘째":
  object "나":
  end
end`);
  machine.tick();
  assert.equal(machine.question, '이름은?');
  machine.fireEvent('when_message_cast', machine.messages[0]!.id);
  machine.tick();
  assert.equal(machine.question, null);
  assert.equal(machine.pendingAnswer, null);
});
