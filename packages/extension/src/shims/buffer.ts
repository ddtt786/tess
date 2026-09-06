/**
 * @fileoverview Minimal `Buffer` for the browser bundle.
 *
 * The decompiler hands object fragments back as `Buffer.from(text, 'utf-8')`
 * and the pipeline reads them back with `toString('utf-8')`. That pair is what
 * the browser path exercises; the rest is here so byte-level callers still find
 * what they reach for.
 */
class BrowserBuffer extends Uint8Array {
  override toString(encoding?: string): string {
    if (encoding === 'base64') {
      let binary = '';
      for (const byte of this) binary += String.fromCharCode(byte);
      return btoa(binary);
    }
    return new TextDecoder('utf-8').decode(this);
  }

  readUInt32BE(offset = 0): number {
    return this.view().getUint32(offset, false);
  }

  readUInt16BE(offset = 0): number {
    return this.view().getUint16(offset, false);
  }

  readUInt16LE(offset = 0): number {
    return this.view().getUint16(offset, true);
  }

  private view(): DataView {
    return new DataView(this.buffer as ArrayBuffer, this.byteOffset, this.byteLength);
  }
}

function from(value: string | ArrayLike<number> | ArrayBufferLike, encoding?: string): BrowserBuffer {
  if (typeof value === 'string') {
    if (encoding === 'base64') {
      const binary = atob(value);
      const bytes = new BrowserBuffer(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      return bytes;
    }
    return new BrowserBuffer(new TextEncoder().encode(value));
  }
  if (value instanceof ArrayBuffer) return new BrowserBuffer(value);
  return new BrowserBuffer(value as ArrayLike<number>);
}

function alloc(size: number): BrowserBuffer {
  return new BrowserBuffer(size);
}

function concat(list: Uint8Array[]): BrowserBuffer {
  const out = new BrowserBuffer(list.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of list) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function isBuffer(value: unknown): boolean {
  return value instanceof Uint8Array;
}

export const Buffer = Object.assign(BrowserBuffer, { from, alloc, concat, isBuffer });

export default Buffer;
