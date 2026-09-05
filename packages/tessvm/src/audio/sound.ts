/**
 * @fileoverview 소리 재생기입니다. WebAudio 로 직접 재생합니다.
 *
 * 소리 파일은 한 번만 받아서 디코딩해 두고 그 뒤로는 버퍼를 재사용합니다. 재생 속도
 * (`playbackRate`)와 소리 크기는 엔트리처럼 작품 전체에 하나씩만 있고, 이미 나고 있는
 * 소리에도 곧바로 적용됩니다.
 */
import type { AudioEngine } from '../runtime/engine.ts';
import type { Sound } from '../runtime/model.ts';

interface Playing {
  source: AudioBufferSourceNode;
  gain: GainNode;
  entityId: string;
  timer: number | null;
}

export class WebAudioEngine implements AudioEngine {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly loading = new Map<string, Promise<AudioBuffer | null>>();
  private readonly playing = new Set<Playing>();
  private bgm: Playing | null = null;
  private volume = 1;
  private speed = 1;

  /** Browsers only allow audio after a gesture, so the context opens lazily. */
  private ensure(): AudioContext | null {
    if (this.context) {
      if (this.context.state === 'suspended') {
        void this.context.resume();
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
  async preload(sounds: Sound[], limit = 6): Promise<void> {
    let next = 0;
    const runners = new Array(Math.min(limit, sounds.length)).fill(0).map(async () => {
      while (next < sounds.length) {
        const sound = sounds[next];
        next += 1;
        if (sound) {
          await this.buffer(sound);
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
      void this.buffer(sound).then((loaded) => {
        if (loaded) {
          this.start(loaded, entityId, startMs, durationMs, false);
        }
      });
      return;
    }
    this.start(buffer, entityId, startMs, durationMs, false);
  }

  playBgm(sound: Sound): void {
    const buffer = this.buffers.get(sound.id);
    if (!buffer) {
      void this.buffer(sound).then((loaded) => {
        if (loaded) {
          this.bgm = this.start(loaded, '', 0, undefined, true);
        }
      });
      return;
    }
    this.bgm = this.start(buffer, '', 0, undefined, true);
  }

  private start(
    buffer: AudioBuffer,
    entityId: string,
    startMs: number,
    durationMs: number | undefined,
    loop: boolean,
  ): Playing | null {
    const context = this.ensure();
    if (!context || !this.master) {
      return null;
    }
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = loop;
    source.playbackRate.value = this.speed;
    const gain = context.createGain();
    source.connect(gain);
    gain.connect(this.master);
    const offset = Math.max(0, startMs / 1000);
    const entry: Playing = { source, gain, entityId, timer: null };
    if (durationMs !== undefined) {
      source.start(0, offset, durationMs / 1000);
    } else {
      source.start(0, offset);
    }
    source.onended = () => {
      this.playing.delete(entry);
    };
    this.playing.add(entry);
    return entry;
  }

  stopAll(): void {
    for (const entry of [...this.playing]) {
      this.stopEntry(entry);
    }
  }

  stopEntity(entityId: string): void {
    for (const entry of [...this.playing]) {
      if (entry.entityId === entityId) {
        this.stopEntry(entry);
      }
    }
  }

  stopExcept(entityId: string): void {
    for (const entry of [...this.playing]) {
      if (entry.entityId !== entityId) {
        this.stopEntry(entry);
      }
    }
  }

  stopBgm(): void {
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
export class SpeechSynthesisEngine {
  speak(text: string, voice: { speed: number; pitch: number; volume: number }): Promise<void> {
    const synth = (globalThis as { speechSynthesis?: SpeechSynthesis }).speechSynthesis;
    if (!synth || !text) {
      return Promise.resolve();
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'ko-KR';
    // Entry's speed and pitch fields run -1…1 around the middle setting.
    utterance.rate = Math.max(0.1, Math.min(10, 1 + voice.speed * 0.5));
    utterance.pitch = Math.max(0, Math.min(2, 1 + voice.pitch * 0.5));
    utterance.volume = voice.volume;
    return new Promise((resolve) => {
      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();
      synth.speak(utterance);
    });
  }

  stop(): void {
    (globalThis as { speechSynthesis?: SpeechSynthesis }).speechSynthesis?.cancel();
  }
}
