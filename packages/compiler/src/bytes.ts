/**
 * @fileoverview Reading numbers and tags out of a file's bytes.
 *
 * Node's `Buffer` has these built in, but the compiler also runs in a browser,
 * where a file arrives as a plain `Uint8Array`.
 */

const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

export const u16be = (bytes: Uint8Array, at: number) => view(bytes).getUint16(at, false);
export const u16le = (bytes: Uint8Array, at: number) => view(bytes).getUint16(at, true);
export const u32be = (bytes: Uint8Array, at: number) => view(bytes).getUint32(at, false);
export const u32le = (bytes: Uint8Array, at: number) => view(bytes).getUint32(at, true);
export const u64be = (bytes: Uint8Array, at: number) => Number(view(bytes).getBigUint64(at, false));
export const u64le = (bytes: Uint8Array, at: number) => Number(view(bytes).getBigUint64(at, true));

/** The bytes from `start` to `end` read one byte per character, as latin1 does. */
export function latin1(bytes: Uint8Array, start: number, end: number): string {
  let text = '';
  for (let at = start; at < end && at < bytes.length; at += 1) {
    text += String.fromCharCode(bytes[at]!);
  }
  return text;
}

/** Whether the file holds this ascii tag anywhere in its first `limit` bytes. */
export function includesText(bytes: Uint8Array, text: string, limit = bytes.length): boolean {
  return latin1(bytes, 0, Math.min(bytes.length, limit)).includes(text);
}
