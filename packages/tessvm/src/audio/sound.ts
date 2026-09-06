/**
 * @fileoverview 소리 재생기입니다. WebAudio 로 직접 재생합니다.
 *
 * 소리 파일은 한 번만 받아서 디코딩해 두고 그 뒤로는 버퍼를 재사용합니다. 재생 속도
 * (`playbackRate`)와 소리 크기는 엔트리처럼 작품 전체에 하나씩만 있고, 이미 나고 있는
 * 소리에도 곧바로 적용됩니다.
 *
 * 배경음악은 소리와 따로 놉니다 — 엔트리가 `Entry.bgmInstances` 로 갈라 두어서
 * 소리 크기·재생 속도·소리 멈추기 블록이 닿지 않습니다. `AI/AI_TESSVM.md` 참고.
 */
import type { AudioEngine } from '../runtime/engine.ts';
import type { Sound } from '../runtime/model.ts';

interface Playing {
  source: AudioBufferSourceNode;
  gain: GainNode;
  entityId: string;
}

export class WebAudioEngine implements AudioEngine {
  private context: AudioContext | null = null;
  /**
   * Carries the sounds, not the background music. Entry keeps the two in
   * separate lists (`Entry.soundInstances` and `Entry.bgmInstances`) and the
   * volume, speed and stop blocks all walk the first one only.
   */
  private master: GainNode | null = null;
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly loading = new Map<string, Promise<AudioBuffer | null>>();
  private readonly playing = new Set<Playing>();
  private bgm: Playing | null = null;
  private volume = 1;
  private speed = 1;
  private paused = false;
  /**
   * Sounds asked for while their file is still on the way. Without these a
   * `stop` or a scene change only reaches what is already playing, and the
   * request that was still loading starts afterwards — the work then sings in
   * the wrong scene, and a bgm asked for twice ends up playing twice over.
   */
  private readonly pending = new Set<{ entityId: string; bgm: boolean; live: boolean }>();

  /** Browsers only allow audio after a gesture, so the context opens lazily. */
  private ensure(): AudioContext | null {
    if (this.context) {
      if (this.context.state === 'suspended' && !this.paused) {
        void this.context.resume().catch(() => undefined);
      }
      return this.context;
    }
    const Ctor = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
    if (!Ctor) {
      return null;
    }
    this.context = new Ctor();
    this.master = this.context.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.context.destination);
    return this.context;
  }

  /**
   * Fetches and decodes sounds ahead of time, a few at a time. Asking for a
   * thousand files at once starves the costume loads the first frame needs.
   */
  async preload(sounds: Sound[], limit = 6, onLoaded?: () => void): Promise<void> {
    let next = 0;
    const runners = new Array(Math.min(limit, sounds.length)).fill(0).map(async () => {
      while (next < sounds.length) {
        const sound = sounds[next];
        next += 1;
        if (sound) {
          await this.buffer(sound);
          onLoaded?.();
        }
      }
    });
    await Promise.all(runners);
  }

  private buffer(sound: Sound): Promise<AudioBuffer | null> {
    const cached = this.buffers.get(sound.id);
    if (cached) {
      return Promise.resolve(cached);
    }
    const inFlight = this.loading.get(sound.id);
    if (inFlight) {
      return inFlight;
    }
    const job = (async () => {
      const context = this.ensure();
      if (!context) {
        return null;
      }
      try {
        const response = await fetch(sound.fileurl);
        const bytes = await response.arrayBuffer();
        const decoded = await context.decodeAudioData(bytes);
        this.buffers.set(sound.id, decoded);
        return decoded;
      } catch {
        return null;
      } finally {
        this.loading.delete(sound.id);
      }
    })();
    this.loading.set(sound.id, job);
    return job;
  }

  play(sound: Sound, entityId: string, startMs = 0, durationMs?: number): void {
    const context = this.ensure();
    if (!context) {
      return;
    }
    const buffer = this.buffers.get(sound.id);
    if (!buffer) {
      const ticket = this.ticket(entityId, false);
      void this.buffer(sound).then((loaded) => {
        if (this.claim(ticket) && loaded) {
          this.start(loaded, entityId, startMs, durationMs, false);
        }
      });
      return;
    }
    this.start(buffer, entityId, startMs, durationMs, false);
  }

  playBgm(sound: Sound): void {
    // One background track at a time. Without this a second call while the first
    // is still loading leaves two copies playing over each other, and only the
    // later one can ever be stopped.
    this.stopBgm();
    const buffer = this.buffers.get(sound.id);
    if (!buffer) {
      const ticket = this.ticket('', true);
      void this.buffer(sound).then((loaded) => {
        if (this.claim(ticket) && loaded) {
          this.start(loaded, '', 0, undefined, true);
        }
      });
      return;
    }
    this.start(buffer, '', 0, undefined, true);
  }

  private ticket(entityId: string, bgm: boolean) {
    const item = { entityId, bgm, live: true };
    this.pending.add(item);
    return item;
  }

  private claim(item: { entityId: string; bgm: boolean; live: boolean }): boolean {
    this.pending.delete(item);
    return item.live;
  }

  /** Drops the waiting requests a stop has just made pointless. */
  private cancel(matches: (item: { entityId: string; bgm: boolean }) => boolean): void {
    for (const item of this.pending) {
      if (matches(item)) {
        item.live = false;
      }
    }
  }

  /**
   * Background music runs beside the sounds rather than among them:
   * `Entry.Utils.playBGM` plays it once at full volume and files it in
   * `Entry.bgmInstances`, which the volume, speed and stop-sound blocks never
   * walk. Only `stop_bgm` and the next `play_bgm` reach it.
   */
  private start(
    buffer: AudioBuffer,
    entityId: string,
    startMs: number,
    durationMs: number | undefined,
    bgm: boolean,
  ): void {
    const context = this.ensure();
    if (!context || !this.master) {
      return;
    }
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = bgm ? 1 : this.speed;
    const gain = context.createGain();
    source.connect(gain);
    gain.connect(bgm ? context.destination : this.master);
    const offset = Math.max(0, startMs / 1000);
    const entry: Playing = { source, gain, entityId };
    if (durationMs !== undefined) {
      source.start(0, offset, durationMs / 1000);
    } else {
      source.start(0, offset);
    }
    source.onended = () => {
      this.playing.delete(entry);
      if (this.bgm === entry) {
        this.bgm = null;
      }
    };
    if (bgm) {
      this.bgm = entry;
    } else {
      this.playing.add(entry);
    }
  }

  /** `Entry.Utils.forceStopSounds` — the background music plays on. */
  stopAll(): void {
    this.cancel((item) => !item.bgm);
    for (const entry of [...this.playing]) {
      this.stopEntry(entry);
    }
  }

  /** `Entry.Utils.pauseSoundInstances` — held where they are, not thrown away. */
  pause(): void {
    this.paused = true;
    void this.context?.suspend().catch(() => undefined);
  }

  resume(): void {
    this.paused = false;
    void this.context?.resume().catch(() => undefined);
  }

  /** Releases the audio context; browsers only allow a handful per page. */
  close(): void {
    this.stopAll();
    this.stopBgm();
    this.buffers.clear();
    this.loading.clear();
    void this.context?.close().catch(() => undefined);
    this.context = null;
    this.master = null;
  }

  stopEntity(entityId: string): void {
    this.cancel((item) => !item.bgm && item.entityId === entityId);
    for (const entry of [...this.playing]) {
      if (entry.entityId === entityId) {
        this.stopEntry(entry);
      }
    }
  }

  stopExcept(entityId: string): void {
    this.cancel((item) => !item.bgm && item.entityId !== entityId);
    for (const entry of [...this.playing]) {
      if (entry.entityId !== entityId) {
        this.stopEntry(entry);
      }
    }
  }

  stopBgm(): void {
    this.cancel((item) => item.bgm);
    if (this.bgm) {
      this.stopEntry(this.bgm);
      this.bgm = null;
    }
  }

  private stopEntry(entry: Playing): void {
    try {
      entry.source.stop();
    } catch {
      // Already finished; nothing to stop.
    }
    this.playing.delete(entry);
  }

  setVolume(volume: number): void {
    this.volume = volume;
    if (this.master) {
      this.master.gain.value = volume;
    }
  }

  getVolume(): number {
    return this.volume;
  }

  setSpeed(speed: number): void {
    this.speed = speed;
    for (const entry of this.playing) {
      entry.source.playbackRate.value = speed;
    }
  }

  getSpeed(): number {
    return this.speed;
  }
}

/**
 * `읽어주기` 블록을 브라우저의 음성 합성으로 대신합니다. 엔트리는 playentry.org 의
 * TTS 서버가 만든 mp3 를 받아 재생하므로 목소리는 다르고, 인터넷 없이도 됩니다.
 */
/**
 * The voices entry's `읽어주기` offers. They are clova voices on entry's own
 * service and cannot be reproduced here, so each one is pinned to a korean
 * voice the browser has, with the pitch nudged the way the name suggests. What
 * matters most is that a korean voice is chosen at all: without one the browser
 * reads hangul with whatever its default is, which is what makes it unlistenable.
 */
const SPEAKERS: Record<string, { pitch: number; rate: number }> = {
  kyuri: { pitch: 1.05, rate: 1 },
  jinho: { pitch: 0.8, rate: 1 },
  hana: { pitch: 1.1, rate: 0.95 },
  dinna: { pitch: 1.15, rate: 0.95 },
  brown: { pitch: 0.85, rate: 0.95 },
  minions: { pitch: 1.5, rate: 1.15 },
  sally: { pitch: 1.25, rate: 1.05 },
  nsabina: { pitch: 1, rate: 0.95 },
  nmammon: { pitch: 0.7, rate: 0.9 },
  nmeow: { pitch: 1.6, rate: 1.1 },
  nwoof: { pitch: 0.75, rate: 1 },
};

export class SpeechSynthesisEngine {
  private voice: SpeechSynthesisVoice | null = null;
  private looked = false;

  /**
   * The list is empty until the browser has loaded it, so it is looked up again
   * until something korean turns up.
   */
  private korean(): SpeechSynthesisVoice | null {
    const synth = (globalThis as { speechSynthesis?: SpeechSynthesis }).speechSynthesis;
    if (this.voice || !synth) {
      return this.voice;
    }
    const voices = synth.getVoices();
    if (!voices.length) {
      if (!this.looked) {
        this.looked = true;
        synth.addEventListener?.('voiceschanged', () => {
          this.voice = null;
          this.korean();
        });
      }
      return null;
    }
    const korean = voices.filter((item) => item.lang.replace('_', '-').startsWith('ko'));
    this.voice = korean.find((item) => item.localService) ?? korean[0] ?? null;
    return this.voice;
  }

  speak(text: string, voice: { speaker?: string; speed: number; pitch: number; volume: number }): Promise<void> {
    const synth = (globalThis as { speechSynthesis?: SpeechSynthesis }).speechSynthesis;
    if (!synth || !text) {
      return Promise.resolve();
    }
    const utterance = new SpeechSynthesisUtterance(text);
    const speaker = SPEAKERS[voice.speaker ?? 'kyuri'] ?? SPEAKERS.kyuri!;
    const picked = this.korean();
    if (picked) {
      utterance.voice = picked;
    }
    utterance.lang = picked?.lang ?? 'ko-KR';
    // Entry's speed and pitch fields run -1…1 around the middle setting.
    utterance.rate = Math.max(0.1, Math.min(10, speaker.rate * (1 + voice.speed * 0.5)));
    utterance.pitch = Math.max(0, Math.min(2, speaker.pitch * (1 + voice.pitch * 0.5)));
    utterance.volume = voice.volume;
    return new Promise((resolve) => {
      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();
      synth.speak(utterance);
    });
  }

  pause(): void {
    (globalThis as { speechSynthesis?: SpeechSynthesis }).speechSynthesis?.pause();
  }

  resume(): void {
    (globalThis as { speechSynthesis?: SpeechSynthesis }).speechSynthesis?.resume();
  }

  stop(): void {
    (globalThis as { speechSynthesis?: SpeechSynthesis }).speechSynthesis?.cancel();
  }
}
