/**
 * @fileoverview 모양 이미지의 알파값을 한 번만 읽어 두는 마스크 저장소입니다.
 *
 * 엔트리는 충돌을 볼 때마다 두 스프라이트를 캔버스에 다시 그리고 `getImageData` 로
 * 픽셀을 읽습니다. 여기서는 모양마다 알파 배열을 한 번 만들어 두고 그 뒤로는 표를
 * 찾기만 합니다. 불투명한 부분의 경계 상자도 같이 재 두어 검사 범위를 줄입니다.
 */

export interface AlphaMask {
  width: number;
  height: number;
  /** One byte of alpha per pixel, row-major. */
  data: Uint8Array;
  /** Tight box around every pixel with a non-zero alpha. */
  trimX: number;
  trimY: number;
  trimWidth: number;
  trimHeight: number;
}

/** Builds a mask, or null while the costume image has not arrived yet. */
export type MaskLoader = (key: string, width: number, height: number) => AlphaMask | null;

/** Builds the mask (and its trimmed box) from raw RGBA bytes. */
export function maskFromPixels(
  pixels: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
): AlphaMask {
  const data = new Uint8Array(width * height);
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let offset = 3;
  let index = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = pixels[offset]!;
      data[index] = alpha;
      if (alpha !== 0) {
        if (x < minX) {
          minX = x;
        }
        if (x > maxX) {
          maxX = x;
        }
        if (y < minY) {
          minY = y;
        }
        if (y > maxY) {
          maxY = y;
        }
      }
      offset += 4;
      index += 1;
    }
  }
  if (maxX < 0) {
    return { width, height, data, trimX: 0, trimY: 0, trimWidth: 0, trimHeight: 0 };
  }
  return {
    width,
    height,
    data,
    trimX: minX,
    trimY: minY,
    trimWidth: maxX - minX + 1,
    trimHeight: maxY - minY + 1,
  };
}

/** A mask whose every pixel is opaque — the stage walls are drawn from one. */
export function solidMask(width: number, height: number): AlphaMask {
  const data = new Uint8Array(width * height);
  data.fill(255);
  return { width, height, data, trimX: 0, trimY: 0, trimWidth: width, trimHeight: height };
}

/**
 * Keeps one mask per costume. Masks are built the first time a costume takes
 * part in a collision, so projects that never call the touching blocks pay
 * nothing for them.
 */
export class MaskStore {
  private readonly masks = new Map<string, AlphaMask | null>();
  private readonly loader: MaskLoader;

  constructor(loader: MaskLoader) {
    this.loader = loader;
  }

  get(key: string, width: number, height: number): AlphaMask | null {
    const cached = this.masks.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const mask = this.loader(key, width, height);
    if (!mask) {
      // The image has not finished loading; ask again on a later frame.
      return null;
    }
    this.masks.set(key, mask);
    return mask;
  }

  put(key: string, mask: AlphaMask | null): void {
    this.masks.set(key, mask);
  }

  clear(): void {
    this.masks.clear();
  }
}
