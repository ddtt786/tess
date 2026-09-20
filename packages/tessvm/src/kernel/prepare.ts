/**
 * @fileoverview 작품 하나를 위한 커널을 미리 만들어 둡니다 (노드 쪽).
 *
 * 브라우저에는 MoonBit 툴체인이 없으므로, 작품을 열어 줄 쪽에서 같은 계획을 한 번
 * 세워 wasm 으로 빌드해 둡니다. 페이지는 자기가 세운 계획의 지문이 서버가 준 것과
 * 같을 때만 그 모듈을 씁니다.
 */
import { Vm } from '../runtime/engine.ts';
import { SilentAudioEngine } from '../audio/silent.ts';
import { buildKernel, moonPath } from './build.ts';
import { fingerprint, type KernelPlan } from './plan.ts';

export interface PreparedKernel {
  wasm: Uint8Array<ArrayBuffer>;
  fingerprint: string;
  /** Functions the kernel took over, and how deep their calls run. */
  roots: number;
  slots: number;
  /** Functions it could not take, with the block that stopped each one. */
  rejected: Map<string, string>;
  ms: number;
  cached: boolean;
}

export interface PrepareResult {
  kernel: PreparedKernel | null;
  /** Why there is none, when there is none. */
  reason: string;
}

/**
 * Plans and builds the kernel for a project. Never throws: a work that cannot
 * have one runs exactly as it did before.
 */
export function prepareKernel(project: unknown): PrepareResult {
  if (!moonPath()) {
    return { kernel: null, reason: 'moonbit 툴체인이 없습니다 (moon)' };
  }
  let plan: KernelPlan | null = null;
  try {
    const vm = new Vm({
      renderer: null,
      audio: new SilentAudioEngine(),
      kernel: (found) => {
        plan = found;
        return null;
      },
    });
    vm.load(project as never);
  } catch (error) {
    return { kernel: null, reason: `계획을 세우지 못했습니다: ${String(error)}` };
  }
  const made = plan as KernelPlan | null;
  if (!made || !made.roots.size) {
    return { kernel: null, reason: 'wasm 으로 내릴 수 있는 함수가 없습니다' };
  }
  try {
    const built = buildKernel(made.source, [...made.roots.values()].map((root) => root.name));
    if (!built) {
      return { kernel: null, reason: 'moonbit 툴체인이 없습니다 (moon)' };
    }
    return {
      kernel: {
        wasm: built.wasm,
        fingerprint: fingerprint(made.source),
        roots: made.roots.size,
        slots: made.size,
        rejected: made.rejected,
        ms: built.ms,
        cached: built.cached,
      },
      reason: '',
    };
  } catch (error) {
    return { kernel: null, reason: String(error instanceof Error ? error.message : error) };
  }
}
