/**
 * @fileoverview Draws the toolbar icon at the sizes the manifest asks for.
 *
 * A tiny PNG writer keeps the build free of an image dependency: one IHDR, one
 * deflated IDAT of 8-bit RGBA rows, one IEND.
 */
import zlib from 'node:zlib';
import { crc32 } from './pack.ts';

const BACKGROUND = [0x16, 0xd7, 0x99];
const MARK = [0xff, 0xff, 0xff];
/** Samples per pixel side; smooths the corner curve and the mark's edges. */
const SAMPLES = 4;

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([head, body, crc]);
}

function encodePng(size: number, rgba: Buffer): Buffer {
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
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

/** Rounded square, in unit coordinates. */
function insideTile(x: number, y: number): boolean {
  const radius = 0.22;
  const dx = Math.max(radius - x, 0, x - (1 - radius));
  const dy = Math.max(radius - y, 0, y - (1 - radius));
  return Math.hypot(dx, dy) <= radius;
}

/** A "T": one bar across the top, one stem down the middle. */
function insideMark(x: number, y: number): boolean {
  const bar = x >= 0.22 && x <= 0.78 && y >= 0.25 && y <= 0.39;
  const stem = x >= 0.43 && x <= 0.57 && y >= 0.25 && y <= 0.76;
  return bar || stem;
}

export function icon(size: number): Buffer {
  const rgba = Buffer.alloc(size * size * 4);
  const step = 1 / (size * SAMPLES);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let tile = 0;
      let mark = 0;
      for (let sy = 0; sy < SAMPLES; sy += 1) {
        for (let sx = 0; sx < SAMPLES; sx += 1) {
          const u = (x * SAMPLES + sx + 0.5) * step;
          const v = (y * SAMPLES + sy + 0.5) * step;
          if (!insideTile(u, v)) {
            continue;
          }
          tile += 1;
          if (insideMark(u, v)) {
            mark += 1;
          }
        }
      }
      const total = SAMPLES * SAMPLES;
      const alpha = tile / total;
      const blend = tile ? mark / tile : 0;
      const offset = (y * size + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        rgba[offset + channel] = Math.round(
          BACKGROUND[channel]! * (1 - blend) + MARK[channel]! * blend,
        );
      }
      rgba[offset + 3] = Math.round(alpha * 255);
    }
  }
  return encodePng(size, rgba);
}
