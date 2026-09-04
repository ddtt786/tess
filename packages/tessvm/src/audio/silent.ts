/**
 * @fileoverview 소리 없이 돌릴 때 쓰는 재생기입니다. 헤드리스 실행과 속도 측정에
 * 씁니다 — 소리 크기와 재생 속도는 블록이 읽어 갈 수 있도록 값만 들고 있습니다.
 */
import type { AudioEngine } from '../runtime/engine.ts';

/** Stand-in used when the VM runs without sound (headless, benchmarks). */
export class SilentAudioEngine implements AudioEngine {
  private volume = 1;
  private speed = 1;

  play(): void {}
  playBgm(): void {}
  stopBgm(): void {}
  stopAll(): void {}
  stopEntity(): void {}
  stopExcept(): void {}

  setVolume(volume: number): void {
    this.volume = volume;
  }

  getVolume(): number {
    return this.volume;
  }

  setSpeed(speed: number): void {
    this.speed = speed;
  }

  getSpeed(): number {
    return this.speed;
  }
}

