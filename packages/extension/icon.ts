/**
 * @fileoverview Draws the toolbar icon at the sizes the browsers ask for.
 *
 * Generated rather than checked in: the shape is a rounded square with a play
 * mark, which is a few lines of arithmetic and stays reviewable as text.
 */
import zlib from 'node:zlib';

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const BACKGROUND: Rgba = { r: 16, g: 20, b: 27, a: 255 };
const MARK: Rgba = { r: 79, g: 128, b: 255, a: 255 };
const ACCENT: Rgba = { r: 74, g: 222, b: 128, a: 255 };

function blend(base: Rgba, over: Rgba, coverage: number): Rgba {
  const alpha = (over.a / 255) * coverage;
  return {
    r: Math.round(base.r * (1 - alpha) + over.r * alpha),
    g: Math.round(base.g * (1 - alpha) + over.g * alpha),
    b: Math.round(base.b * (1 - alpha) + over.b * alpha),
    a: Math.round(Math.min(255, base.a + over.a * coverage)),
  };
}

/** Coverage of one pixel, sampled on a 4×4 grid so edges stay smooth. */
function coverage(x: number, y: number, inside: (px: number, py: number) => boolean): number {
  let hits = 0;
  for (let sy = 0; sy < 4; sy += 1) {
    for (let sx = 0; sx < 4; sx += 1) {
      if (inside(x + (sx + 0.5) / 4, y + (sy + 0.5) / 4)) hits += 1;
    }
  }
  return hits / 16;
}

function roundedSquare(size: number) {
  const radius = size * 0.22;
  return (x: number, y: number) => {
    const dx = Math.max(radius - x, x - (size - radius), 0);
    const dy = Math.max(radius - y, y - (size - radius), 0);
    return dx * dx + dy * dy <= radius * radius;
  };
}

function playMark(size: number) {
  const left = size * 0.36;
  const right = size * 0.72;
  const top = size * 0.26;
  const bottom = size * 0.74;
  return (x: number, y: number) => {
    if (x < left || x > right || y < top || y > bottom) return false;
    const progress = (x - left) / (right - left);
    const half = ((bottom - top) / 2) * (1 - progress);
    return Math.abs(y - (top + bottom) / 2) <= half;
  };
}

function dot(size: number) {
  const cx = size * 0.78;
  const cy = size * 0.78;
  const r = size * 0.13;
  return (x: number, y: number) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function crc32(data: Buffer): number {
  let crc = ~0;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function chunk(type: string, body: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  const tagged = Buffer.concat([Buffer.from(type, 'ascii'), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(tagged));
  return Buffer.concat([length, tagged, crc]);
}

/** Encodes RGBA pixels as a PNG. */
function encodePng(size: number, pixels: Rgba[][]): Buffer {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  let offset = 0;
  for (let y = 0; y < size; y += 1) {
    raw[offset++] = 0;
    for (let x = 0; x < size; x += 1) {
      const pixel = pixels[y]![x]!;
      raw[offset++] = pixel.r;
      raw[offset++] = pixel.g;
      raw[offset++] = pixel.b;
      raw[offset++] = pixel.a;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export function makeIcon(size: number): Buffer {
  const square = roundedSquare(size);
  const mark = playMark(size);
  const badge = dot(size);
  const pixels: Rgba[][] = [];
  for (let y = 0; y < size; y += 1) {
    const row: Rgba[] = [];
    for (let x = 0; x < size; x += 1) {
      let pixel: Rgba = { r: 0, g: 0, b: 0, a: 0 };
      pixel = blend(pixel, BACKGROUND, coverage(x, y, square));
      pixel = blend(pixel, MARK, coverage(x, y, mark));
      if (size >= 32) pixel = blend(pixel, ACCENT, coverage(x, y, badge));
      row.push(pixel);
    }
    pixels.push(row);
  }
  return encodePng(size, pixels);
}

export const ICON_SIZES = [16, 32, 48, 128];
