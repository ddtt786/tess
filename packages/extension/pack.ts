/**
 * @fileoverview The folder-to-zip step and a CRX3 signer. The archive format
 * itself is tessvm's (`src/node/zip.ts`), which the work exporter also writes.
 *
 * Firefox loads a temporary add-on from a single file, so a zip is the way in
 * when the browser cannot reach the whole folder (a flatpak build only gets the
 * one file the picker handed it). Chrome takes a zip in its store and a signed
 * crx everywhere else.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
export { crc32 } from '@tess/vm';
import { zipFiles } from '@tess/vm';

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

/** Zips everything under `dir` into `target`, with paths relative to `dir`. */
export function zipDirectory(dir: string, target: string): void {
  fs.writeFileSync(
    target,
    zipFiles(walk(dir).map((name) => ({ name, data: fs.readFileSync(path.join(dir, name)) }))),
  );
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
