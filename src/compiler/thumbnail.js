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
//
//  의존성 없이 만들기 위해 PNG 를 직접 풀고(zlib) 줄인 뒤 다시 쓴다.
// ============================================================================
import zlib from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const THUMB_BOX = 96;

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = -1;
  for (let i = 0; i < buffer.length; i += 1) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** PNG 청크들을 { type, data } 목록으로 */
function readChunks(bytes) {
  const chunks = [];
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const start = offset + 8;
    if (start + length > bytes.length) break;
    chunks.push({ type, data: bytes.subarray(start, start + length) });
    offset = start + length + 4; // 뒤에 CRC 4바이트
    if (type === 'IEND') break;
  }
  return chunks;
}

/** 한 줄에 걸린 PNG 필터를 되돌린다 (스펙 9.2) */
function undoFilter(type, line, previous, bytesPerPixel) {
  const paeth = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) return a;
    return pb <= pc ? b : c;
  };
  for (let i = 0; i < line.length; i += 1) {
    const left = i >= bytesPerPixel ? line[i - bytesPerPixel] : 0;
    const up = previous[i];
    const upLeft = i >= bytesPerPixel ? previous[i - bytesPerPixel] : 0;
    switch (type) {
      case 0: break;
      case 1: line[i] = (line[i] + left) & 0xff; break;
      case 2: line[i] = (line[i] + up) & 0xff; break;
      case 3: line[i] = (line[i] + ((left + up) >> 1)) & 0xff; break;
      case 4: line[i] = (line[i] + paeth(left, up, upLeft)) & 0xff; break;
      default: return false;
    }
  }
  return true;
}

const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/**
 * PNG 를 { width, height, rgba } 로 푼다. 다룰 수 없는 형태(16비트·인터레이스)면 null.
 * 실제 작품의 모양 파일은 거의 다 8비트 비인터레이스라 이 범위로 충분하다.
 */
function decodePng(bytes) {
  if (bytes.length < 8 || !bytes.subarray(0, 8).equals(SIGNATURE)) return null;
  const chunks = readChunks(bytes);
  const ihdr = chunks.find((c) => c.type === 'IHDR');
  if (!ihdr || ihdr.data.length < 13) return null;

  const width = ihdr.data.readUInt32BE(0);
  const height = ihdr.data.readUInt32BE(4);
  const bitDepth = ihdr.data[8];
  const colorType = ihdr.data[9];
  const interlace = ihdr.data[12];
  if (bitDepth !== 8 || interlace !== 0 || !(colorType in CHANNELS)) return null;
  if (width <= 0 || height <= 0) return null;

  const palette = chunks.find((c) => c.type === 'PLTE')?.data;
  const alphaTable = chunks.find((c) => c.type === 'tRNS')?.data;
  if (colorType === 3 && !palette) return null;

  const idat = chunks.filter((c) => c.type === 'IDAT').map((c) => c.data);
  if (idat.length === 0) return null;

  let raw;
  try {
    raw = zlib.inflateSync(Buffer.concat(idat));
  } catch { return null; }

  const channels = CHANNELS[colorType];
  const stride = width * channels;
  if (raw.length < (stride + 1) * height) return null;

  const rgba = Buffer.alloc(width * height * 4);
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    if (!undoFilter(filter, line, previous, channels)) return null;

    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 4;
      const source = x * channels;
      if (colorType === 3) {
        const index = line[source];
        rgba[at] = palette[index * 3];
        rgba[at + 1] = palette[index * 3 + 1];
        rgba[at + 2] = palette[index * 3 + 2];
        rgba[at + 3] = alphaTable && index < alphaTable.length ? alphaTable[index] : 255;
      } else if (colorType === 0 || colorType === 4) {
        rgba[at] = line[source];
        rgba[at + 1] = line[source];
        rgba[at + 2] = line[source];
        rgba[at + 3] = colorType === 4 ? line[source + 1] : 255;
      } else {
        rgba[at] = line[source];
        rgba[at + 1] = line[source + 1];
        rgba[at + 2] = line[source + 2];
        rgba[at + 3] = colorType === 6 ? line[source + 3] : 255;
      }
    }
    previous = line;
  }
  return { width, height, rgba };
}

/** 원본의 여러 픽셀을 평균 내서 줄인다 (그냥 골라 쓰면 가는 선이 사라진다) */
function shrink(image, targetWidth, targetHeight) {
  const out = Buffer.alloc(targetWidth * targetHeight * 4);
  const xRatio = image.width / targetWidth;
  const yRatio = image.height / targetHeight;

  for (let y = 0; y < targetHeight; y += 1) {
    const y0 = Math.floor(y * yRatio);
    const y1 = Math.max(y0 + 1, Math.min(image.height, Math.ceil((y + 1) * yRatio)));
    for (let x = 0; x < targetWidth; x += 1) {
      const x0 = Math.floor(x * xRatio);
      const x1 = Math.max(x0 + 1, Math.min(image.width, Math.ceil((x + 1) * xRatio)));

      let r = 0; let g = 0; let b = 0; let a = 0; let n = 0;
      for (let sy = y0; sy < y1; sy += 1) {
        for (let sx = x0; sx < x1; sx += 1) {
          const at = (sy * image.width + sx) * 4;
          const alpha = image.rgba[at + 3];
          // 투명한 픽셀의 색은 의미가 없으므로 알파로 가중치를 준다
          r += image.rgba[at] * alpha;
          g += image.rgba[at + 1] * alpha;
          b += image.rgba[at + 2] * alpha;
          a += alpha;
          n += 1;
        }
      }
      const at = (y * targetWidth + x) * 4;
      out[at] = a ? Math.round(r / a) : 0;
      out[at + 1] = a ? Math.round(g / a) : 0;
      out[at + 2] = a ? Math.round(b / a) : 0;
      out[at + 3] = Math.round(a / n);
    }
  }
  return { width: targetWidth, height: targetHeight, rgba: out };
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

function encodePng(image) {
  const stride = image.width * 4;
  const raw = Buffer.alloc((stride + 1) * image.height);
  for (let y = 0; y < image.height; y += 1) {
    raw[y * (stride + 1)] = 0; // 필터 없음 — 작은 그림이라 줄여 봐야 얼마 안 된다
    image.rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(image.width, 0);
  ihdr.writeUInt32BE(image.height, 4);
  ihdr[8] = 8;  // 비트 깊이
  ihdr[9] = 6;  // 색 종류: RGBA
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * 그림 파일 바이트열에서 미리보기 PNG 를 만든다. 만들 수 없으면 null 을 돌려주고,
 * 그러면 그 그림은 미리보기 없이 담긴다 (엔트리도 SVG 는 그렇게 둔다).
 *
 * @param {Buffer} bytes 원본 그림 파일
 * @param {number} [maxWidth] 미리보기 가로 크기
 * @returns {Buffer|null}
 */
export function makeThumbnail(bytes, box = THUMB_BOX) {
  const image = decodePng(bytes);
  if (!image) return null;

  // 96×96 상자 안에 비율을 지켜 넣는다. 원본이 그보다 작으면 늘리지 않는다.
  const scale = Math.min(box / image.width, box / image.height, 1);
  if (scale === 1) return encodePng(image);

  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  return encodePng(shrink(image, width, height));
}

export { THUMB_BOX };
