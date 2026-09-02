/**
 * @fileoverview 이미지 썸네일(미리보기)을 생성하는 모듈입니다.
 * 
 * 엔트리 작품 파일은 원본 이미지와 썸네일을 함께 저장합니다.
 * - 원본: temp/<앞2자>/<다음2자>/image/<파일명>.png
 * - 썸네일: temp/<앞2자>/<다음2자>/thumb/<파일명>.png (96x96 사이즈)
 * 
 * 썸네일은 96x96 해상도 내에서 원본의 비율을 유지한 PNG 파일로 생성됩니다.
 * SVG 형식은 렌더링이 필요하므로 썸네일을 생성하지 않습니다.
 */
import sharp from 'sharp';

const THUMB_BOX = 96;

/**
 * 이미지 버퍼 데이터를 받아 썸네일 PNG 버퍼를 생성합니다.
 * 지원하지 않는 포맷(예: SVG)의 경우 null을 반환합니다.
 *
 * @param bytes - 원본 이미지 파일 버퍼
 * @param box - 썸네일이 들어갈 정사각형의 한 변의 길이 (기본값: 96)
 * @returns 생성된 썸네일 PNG 버퍼, 혹은 생성 불가 시 null
 * @example
 * const thumbnailBuffer = await makeThumbnail(imageBuffer);
 * if (thumbnailBuffer) {
 *   // 썸네일 생성 완료
 * }
 */
export async function makeThumbnail(bytes: Buffer, box = THUMB_BOX): Promise<Buffer | null> {
  if (!bytes?.length) return null;
  try {
    const image = sharp(bytes, { animated: false });
    const { format, width, height } = await image.metadata();
    // SVG 는 크기를 정해 줘야 그려지는 형식이라 엔트리도 미리보기를 만들지 않는다.
    if (!format || format === 'svg' || !width || !height) return null;

    return await image
      // `inside` 는 비율을 지키면서 상자 안에 넣고, withoutEnlargement 가
      // 원본이 상자보다 작을 때 늘리지 않게 막는다.
      .resize({ width: box, height: box, fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer();
  } catch {
    return null; // 그림 하나를 못 읽었다고 빌드가 멈추지는 않는다
  }
}

export { THUMB_BOX };
