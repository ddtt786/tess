/**
 * @fileoverview A tar writer for the browser.
 *
 * An `.ent` file is a plain tar of `temp/…`. The compiler's own writer runs on
 * node buffers, so the editor carries this small one.
 */
export interface TarFile {
  name: string;
  data: Uint8Array<ArrayBuffer>;
}

const BLOCK = 512;

export function makeTar(files: TarFile[]): Uint8Array<ArrayBuffer> {
  const blocks: Array<Uint8Array<ArrayBuffer>> = [];
  const mtime = Math.floor(Date.now() / 1000);
  for (const file of files) {
    blocks.push(header(file.name, file.data.length, mtime), file.data, padding(file.data.length));
  }
  blocks.push(new Uint8Array(new ArrayBuffer(BLOCK * 2)));
  return concat(blocks);
}

function header(name: string, size: number, mtime: number): Uint8Array<ArrayBuffer> {
  const block = new Uint8Array(new ArrayBuffer(BLOCK));
  const encoder = new TextEncoder();
  const put = (text: string, at: number, length: number) => {
    block.set(encoder.encode(text).slice(0, length), at);
  };
  const octal = (value: number, length: number) => value.toString(8).padStart(length - 1, '0');

  put(name, 0, 100);
  put(octal(0o644, 8), 100, 8);
  put(octal(0, 8), 108, 8);
  put(octal(0, 8), 116, 8);
  put(octal(size, 12), 124, 12);
  put(octal(mtime, 12), 136, 12);
  put('        ', 148, 8); // checksum placeholder: spaces
  put('0', 156, 1);
  put('ustar', 257, 6);
  put('00', 263, 2);

  let sum = 0;
  for (const byte of block) sum += byte;
  put(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8);
  return block;
}

function padding(size: number): Uint8Array<ArrayBuffer> {
  const left = size % BLOCK;
  return new Uint8Array(new ArrayBuffer(left === 0 ? 0 : BLOCK - left));
}

function concat(parts: Array<Uint8Array<ArrayBuffer>>): Uint8Array<ArrayBuffer> {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(new ArrayBuffer(total));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
