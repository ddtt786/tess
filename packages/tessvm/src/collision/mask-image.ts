/**
 * @fileoverview 브라우저에서 그림의 알파값을 읽어 마스크로 만듭니다.
 *
 * 캔버스가 필요한 부분만 여기 모아 두었습니다 — `mask.ts` 는 브라우저 없이도
 * 돌아가야 하기 때문입니다(테스트·헤드리스 실행).
 */
import { maskFromPixels, type AlphaMask } from './mask.ts';

/** Reads the alpha channel of an already-decoded image into a mask. */
export function buildMask(
  source: CanvasImageSource,
  width: number,
  height: number,
): AlphaMask | null {
  if (!(width > 0) || !(height > 0)) {
    return null;
  }
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as
    | CanvasRenderingContext2D
    | null;
  if (!ctx) {
    return null;
  }
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(source, 0, 0, width, height);
  try {
    return maskFromPixels(ctx.getImageData(0, 0, width, height).data, width, height);
  } catch {
    return null;
  }
}

function createCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height);
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}
