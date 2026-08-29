// ============================================================================
//  모양 미리보기(썸네일) 만들기
//
//  엔트리 작품 파일은 그림마다 원본과 미리보기를 같이 담는다.
//    temp/<앞2자>/<다음2자>/image/<파일명>.png   원본
//    temp/<앞2자>/<다음2자>/thumb/<파일명>.png   미리보기 (96×96 안에 맞춤)
//  편집기의 오브젝트·모양 목록이 이 미리보기를 쓴다. 없으면 목록이 비어 보인다.
//
//  실제 작품 파일을 재 보면 미리보기는 96×96 상자 안에 비율을 지켜 넣은 PNG 다.
//  SVG 는 엔트리도 미리보기를 만들지 않는다(그려 봐야 알 수 있는 형식이라).
// ============================================================================
import sharp from 'sharp';

const THUMB_BOX = 96;

/**
 * 그림 파일 바이트열에서 미리보기 PNG 를 만든다. 만들 수 없으면 null 을 돌려주고,
 * 그러면 그 그림은 미리보기 없이 담긴다 (엔트리도 SVG 는 그렇게 둔다).
 *
 * @param {Buffer} bytes 원본 그림 파일
 * @param {number} [box] 미리보기가 들어갈 정사각형 상자의 한 변
 * @returns {Promise<Buffer|null>}
 */
export async function makeThumbnail(bytes, box = THUMB_BOX) {
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
