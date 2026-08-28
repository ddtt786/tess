// Builds an Entry project file (.ent).
//
// An .ent is a tar bundle with everything under temp/:
//   temp/project.json
//   temp/<first2>/<next2>/image/<filename>.png
//   temp/<first2>/<next2>/sound/<filename>.mp3
//
// Writes ustar headers by hand to avoid a tar dependency.
import fs from 'node:fs';

const BLOCK_SIZE = 512;

/** Builds the 512-byte header for one tar entry. */
function header(name, size, mtime) {
  const buffer = Buffer.alloc(BLOCK_SIZE);
  const write = (text, offset, length) => buffer.write(String(text), offset, length, 'utf-8');
  const octal = (value, length) => `${value.toString(8).padStart(length - 1, '0')}\0`;

  if (Buffer.byteLength(name) > 100) throw new Error(`tar path too long: ${name}`);
  write(name, 0, 100);
  write(octal(0o644, 8), 100, 8);   // mode
  write(octal(0, 8), 108, 8);       // uid
  write(octal(0, 8), 116, 8);       // gid
  write(octal(size, 12), 124, 12);
  write(octal(mtime, 12), 136, 12);
  write('        ', 148, 8);        // checksum field left blank, filled below
  write('0', 156, 1);               // typeflag: regular file
  write('ustar\0', 257, 6);
  write('00', 263, 2);

  let checksum = 0;
  for (const byte of buffer) checksum += byte;
  write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8);
  return buffer;
}

function padding(size) {
  const remainder = size % BLOCK_SIZE;
  return remainder === 0 ? Buffer.alloc(0) : Buffer.alloc(BLOCK_SIZE - remainder);
}

/**
 * @param {Array<{name: string, data: Buffer}>} entries
 * @returns {Buffer} tar byte stream
 */
export function makeTar(entries) {
  const mtime = Math.floor(Date.now() / 1000);
  const chunks = [];
  for (const { name, data } of entries) {
    chunks.push(header(name, data.length, mtime), data, padding(data.length));
  }
  chunks.push(Buffer.alloc(BLOCK_SIZE * 2)); // two zero blocks mark the end
  return Buffer.concat(chunks);
}

/**
 * Packs a compiled project into an .ent bundle byte stream.
 *
 * @param {object} project the project object produced by compileProject()
 * @param {Array<{source: string, target: string}>} assets resource files to bundle
 */
export function makeEntryBundle(project, assets = []) {
  const entries = [{
    name: 'temp/project.json',
    data: Buffer.from(JSON.stringify(project), 'utf-8'),
  }];

  const packed = new Set();
  for (const asset of assets) {
    if (packed.has(asset.target)) continue;
    packed.add(asset.target);
    entries.push({ name: asset.target, data: fs.readFileSync(asset.source) });
  }
  return makeTar(entries);
}
