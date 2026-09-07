/**
 * @fileoverview A store-and-deflate ZIP writer, a CRX3 signer, and the CRC-32
 * both the zip and the icon writer need.
 *
 * Firefox loads a temporary add-on from a single file, so a zip is the way in
 * when the browser cannot reach the whole folder (a flatpak build only gets the
 * one file the picker handed it). Chrome takes a zip in its store and a signed
 * crx everywhere else.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }
  return table;
})();

export function crc32(bytes: Buffer | Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** 1980-01-01 in the DOS fields zip uses; month and day 0 are not valid there. */
const DOS_DATE = (1 << 5) | 1;

interface Entry {
  name: string;
  data: Buffer;
  deflated: Buffer;
  crc: number;
  offset: number;
}

/** Every file under `dir`, as zip-style paths relative to it. */
function walk(dir: string, prefix = ''): string[] {
  const found: string[] = [];
  for (const item of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const name = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.isDirectory()) {
      found.push(...walk(path.join(dir, item.name), name));
    } else {
      found.push(name);
    }
  }
  return found;
}

function localHeader(entry: Entry): Buffer {
  const name = Buffer.from(entry.name, 'utf-8');
  const head = Buffer.alloc(30);
  head.writeUInt32LE(0x04034b50, 0);
  head.writeUInt16LE(20, 4); // version needed
  head.writeUInt16LE(0x0800, 6); // utf-8 names
  head.writeUInt16LE(8, 8); // deflate
  head.writeUInt16LE(0, 10); // time
  head.writeUInt16LE(DOS_DATE, 12);
  head.writeUInt32LE(entry.crc, 14);
  head.writeUInt32LE(entry.deflated.length, 18);
  head.writeUInt32LE(entry.data.length, 22);
  head.writeUInt16LE(name.length, 26);
  return Buffer.concat([head, name]);
}

function centralHeader(entry: Entry): Buffer {
  const name = Buffer.from(entry.name, 'utf-8');
  const head = Buffer.alloc(46);
  head.writeUInt32LE(0x02014b50, 0);
  head.writeUInt16LE(20, 4); // version made by
  head.writeUInt16LE(20, 6); // version needed
  head.writeUInt16LE(0x0800, 8);
  head.writeUInt16LE(8, 10);
  head.writeUInt16LE(0, 12); // time
  head.writeUInt16LE(DOS_DATE, 14);
  head.writeUInt32LE(entry.crc, 16);
  head.writeUInt32LE(entry.deflated.length, 20);
  head.writeUInt32LE(entry.data.length, 24);
  head.writeUInt16LE(name.length, 28);
  head.writeUInt32LE(entry.offset, 42);
  return Buffer.concat([head, name]);
}

/** Zips everything under `dir` into `target`, with paths relative to `dir`. */
export function zipDirectory(dir: string, target: string): void {
  const entries: Entry[] = [];
  const parts: Buffer[] = [];
  let offset = 0;
  for (const name of walk(dir)) {
    const data = fs.readFileSync(path.join(dir, name));
    const entry: Entry = {
      name,
      data,
      deflated: zlib.deflateRawSync(data, { level: 9 }),
      crc: crc32(data),
      offset,
    };
    entries.push(entry);
    const head = localHeader(entry);
    parts.push(head, entry.deflated);
    offset += head.length + entry.deflated.length;
  }
  const central = entries.map(centralHeader);
  const centralSize = central.reduce((total, part) => total + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  fs.writeFileSync(target, Buffer.concat([...parts, ...central, end]));
}

// ---------------------------------------------------------------------------
//  CRX3
// ---------------------------------------------------------------------------

/**
 * A crx is the zip with a signed header in front:
 *
 * ```
 * "Cr24" · version 3 · header length · CrxFileHeader · zip
 * ```
 *
 * The header is protobuf, and every field it needs is length-delimited, so the
 * few bytes of encoding below stand in for a protobuf library.
 */
const CRX_MAGIC = 'Cr24';
const CRX_VERSION = 3;
/** What the signature covers, ahead of the header size and the zip. */
const SIGN_PREFIX = Buffer.from('CRX3 SignedData\0', 'binary');

function varint(value: number): Buffer {
  const bytes: number[] = [];
  let rest = value;
  do {
    const byte = rest & 0x7f;
    rest >>>= 7;
    bytes.push(rest > 0 ? byte | 0x80 : byte);
  } while (rest > 0);
  return Buffer.from(bytes);
}

/** One length-delimited protobuf field: its key, its size, its bytes. */
function field(number: number, data: Buffer): Buffer {
  return Buffer.concat([varint((number << 3) | 2), varint(data.length), data]);
}

/** `CrxFileHeader.signed_header_data` holds only the id, and the id is the key. */
function crxId(publicKey: Buffer): Buffer {
  return crypto.createHash('sha256').update(publicKey).digest().subarray(0, 16);
}

/** The id chrome shows, with each hex digit moved from `0-9a-f` onto `a-p`. */
export function crxIdText(publicKey: Buffer): string {
  return [...crxId(publicKey)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .replace(/[0-9a-f]/g, (digit) => String.fromCharCode(97 + parseInt(digit, 16)));
}

/** The signing key's public half, as chrome wants it in the header. */
export function publicKeyOf(privateKeyPem: string): Buffer {
  return crypto.createPublicKey(privateKeyPem).export({ type: 'spki', format: 'der' });
}

/** Wraps a zip as a crx signed with `privateKeyPem` (RSA, PKCS#1 v1.5, SHA-256). */
export function packCrx(archive: Buffer, privateKeyPem: string): Buffer {
  const publicKey = publicKeyOf(privateKeyPem);
  const signedHeaderData = field(1, crxId(publicKey));
  const headerSize = Buffer.alloc(4);
  headerSize.writeUInt32LE(signedHeaderData.length, 0);
  const signature = crypto.sign(
    'sha256',
    Buffer.concat([SIGN_PREFIX, headerSize, signedHeaderData, archive]),
    privateKeyPem,
  );
  const header = Buffer.concat([
    // sha256_with_rsa = 2, holding one proof of public_key = 1 and signature = 2
    field(2, Buffer.concat([field(1, publicKey), field(2, signature)])),
    field(10000, signedHeaderData),
  ]);
  const head = Buffer.alloc(12);
  head.write(CRX_MAGIC, 0, 'binary');
  head.writeUInt32LE(CRX_VERSION, 4);
  head.writeUInt32LE(header.length, 8);
  return Buffer.concat([head, header, archive]);
}

/** The key at `file`, made and left there on the first ask. */
export function signingKey(file: string): string {
  if (!fs.existsSync(file)) {
    const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    fs.writeFileSync(file, pair.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  }
  return fs.readFileSync(file, 'utf-8');
}
