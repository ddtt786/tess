/**
 * @fileoverview Owns the tessvm instance that stands in for entry's runner.
 *
 * A work is converted and booted once and then kept: pressing 시작하기 again
 * only starts the same runner over. It is rebuilt when the work itself changes,
 * which on the workspace page happens every time the blocks are edited.
 */
import { boot, type TessVmHandle } from '@tess/vm/src/web/boot.ts';
import { buildForTessvm, type BuildResult, type RawEntryProject } from './pipeline.ts';
import type { EntryPaths } from './assets.ts';

export interface RunnerOptions {
  container: HTMLElement;
  paths: EntryPaths;
  route: 'tess' | 'direct';
  quality: number;
  showStats: boolean;
}

export interface PreparedRun {
  handle: TessVmHandle;
  build: BuildResult;
  /** Milliseconds spent booting the renderer and preloading the first scene. */
  bootMs: number;
}

export class TessvmRunner {
  private handle: TessVmHandle | null = null;
  private build: BuildResult | null = null;
  private signature = '';
  private pending: Promise<PreparedRun> | null = null;
  private bootMs = 0;

  get current(): BuildResult | null {
    return this.build;
  }

  get running(): boolean {
    return this.handle !== null;
  }

  /**
   * Converts and boots the work, reusing what is already up when the work and
   * the settings that shape it have not changed.
   */
  prepare(raw: RawEntryProject, options: RunnerOptions): Promise<PreparedRun> {
    const signature = `${options.route}|${options.quality}|${options.showStats}|${JSON.stringify(raw)}`;
    if (this.handle && this.build && signature === this.signature) {
      return Promise.resolve({ handle: this.handle, build: this.build, bootMs: this.bootMs });
    }
    if (this.pending && signature === this.signature) return this.pending;

    this.signature = signature;
    // A build already under way is waited out rather than raced: two runners
    // finishing at once would leave the first one's canvas and listeners behind.
    const previous: Promise<unknown> = this.pending ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(() => this.rebuild(raw, options));
    this.pending = next;
    void next.catch(() => undefined).then(() => {
      if (this.pending === next) this.pending = null;
    });
    return next;
  }

  private async rebuild(raw: RawEntryProject, options: RunnerOptions): Promise<PreparedRun> {
    this.dispose();
    const build = buildForTessvm(raw, { paths: options.paths, route: options.route });
    const started = performance.now();
    const handle = await boot({
      project: build.project as never,
      container: options.container,
      autoStart: false,
      quality: options.quality,
      showStats: options.showStats,
    });
    this.bootMs = performance.now() - started;
    this.handle = handle;
    this.build = build;
    return { handle, build, bootMs: this.bootMs };
  }

  start(): void {
    this.handle?.start();
  }

  stop(): void {
    this.handle?.stop();
  }

  pause(): void {
    this.handle?.pause();
  }

  relayout(): void {
    this.handle?.relayout();
  }

  /** Throws the runner away so the next run builds from scratch. */
  dispose(): void {
    this.handle?.dispose();
    this.handle = null;
    this.build = null;
    this.signature = '';
    this.bootMs = 0;
  }
}
