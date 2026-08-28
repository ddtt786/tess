// Reads playback duration from a sound file.
//
// Entry trusts project.json's `duration` verbatim, so an unmeasurable
// sound would default to 1s for everything. Measures from headers only,
// without decoding.

/** Rounds to the one decimal place Entry uses for sound duration. */
const round = (seconds) => Math.round(seconds * 10) / 10;

/**
 * Measures a sound file's duration in seconds; null if it can't be measured.
 * @param {Buffer} bytes
 * @param {string} ext lowercase extension with dot (e.g. `.mp3`)
 */
export function audioDuration(bytes, ext) {
  try {
    const seconds = measure(bytes, ext);
    return Number.isFinite(seconds) && seconds > 0 ? round(seconds) : null;
  } catch {
    return null; // one broken file shouldn't halt compilation
  }
}

function measure(bytes, ext) {
  if (ext === '.wav') return wavDuration(bytes);
  if (ext === '.ogg') return oggDuration(bytes);
  if (ext === '.m4a' || ext === '.mp4') return mp4Duration(bytes);
  if (ext === '.mp3') return mp3Duration(bytes);
  // extension isn't trustworthy — sniff the format from content instead
  if (bytes.length > 12 && bytes.toString('latin1', 0, 4) === 'RIFF') return wavDuration(bytes);
  if (bytes.length > 4 && bytes.toString('latin1', 0, 4) === 'OggS') return oggDuration(bytes);
  return mp3Duration(bytes);
}

// ---------------------------------------------------------------------------
//  WAV — divides the data chunk by the fmt chunk's byte rate
// ---------------------------------------------------------------------------
function wavDuration(bytes) {
  if (bytes.length < 12 || bytes.toString('latin1', 8, 12) !== 'WAVE') return null;

  let byteRate = 0;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString('latin1', offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ' && body + 16 <= bytes.length) byteRate = bytes.readUInt32LE(body + 8);
    if (id === 'data') {
      if (!byteRate) return null;
      // a zero or invalid size field (streamed writes) means count all remaining bytes
      const dataSize = size > 0 && body + size <= bytes.length ? size : bytes.length - body;
      return dataSize / byteRate;
    }
    offset = body + size + (size % 2); // chunks are padded to an even byte count
  }
  return null;
}

// ---------------------------------------------------------------------------
//  Ogg (Vorbis / Opus) — the last page's granule position is the total sample count
// ---------------------------------------------------------------------------
function oggDuration(bytes) {
  if (bytes.toString('latin1', 0, 4) !== 'OggS') return null;

  // reads the sample rate from the first page's identification header;
  // Opus is always counted against a fixed 48kHz
  const head = bytes.toString('latin1', 0, Math.min(bytes.length, 4096));
  let rate = null;
  let preSkip = 0;
  const opus = head.indexOf('OpusHead');
  if (opus >= 0) {
    rate = 48000;
    preSkip = bytes.readUInt16LE(opus + 10);
  } else {
    const vorbis = head.indexOf('\x01vorbis');
    if (vorbis < 0) return null;
    rate = bytes.readUInt32LE(vorbis + 12);
  }
  if (!rate) return null;

  // scans backward from the end of the file to find the last page
  for (let offset = bytes.length - 14; offset >= 0; offset -= 1) {
    if (bytes.toString('latin1', offset, offset + 4) !== 'OggS') continue;
    const granule = Number(bytes.readBigUInt64LE(offset + 6));
    if (granule <= 0) continue;
    return Math.max(0, granule - preSkip) / rate;
  }
  return null;
}

// ---------------------------------------------------------------------------
//  MP4 / M4A — moov > mvhd duration / timescale
// ---------------------------------------------------------------------------
function mp4Duration(bytes, start = 0, end = bytes.length) {
  let offset = start;
  while (offset + 8 <= end) {
    let size = bytes.readUInt32BE(offset);
    const type = bytes.toString('latin1', offset + 4, offset + 8);
    let body = offset + 8;
    if (size === 1) { // size 1 means a separate 64-bit size follows
      if (body + 8 > end) return null;
      size = Number(bytes.readBigUInt64BE(body));
      body += 8;
    }
    if (size === 0) size = end - offset; // size 0 means this atom runs to end of file

    if (type === 'moov') return mp4Duration(bytes, body, Math.min(end, offset + size));
    if (type === 'mvhd') {
      const version = bytes[body];
      const at = version === 1 ? body + 20 : body + 12;
      const timescale = bytes.readUInt32BE(at);
      const duration = version === 1 ? Number(bytes.readBigUInt64BE(at + 4)) : bytes.readUInt32BE(at + 4);
      return timescale ? duration / timescale : null;
    }
    if (size < 8) return null;
    offset += size;
  }
  return null;
}

// ---------------------------------------------------------------------------
//  MP3 — reads the first frame header; uses frame count from a VBR table
//  (Xing/VBRI) if present, otherwise divides by the fixed bitrate
// ---------------------------------------------------------------------------
const MP3_BITRATES = {
  // bitrate table (kbps) by [MPEG version][layer]. Index 0 is "free", 15 is reserved/unused.
  1: {
    1: [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
    2: [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
    3: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  },
  2: {
    1: [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
    2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
    3: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  },
};
const MP3_RATES = { 1: [44100, 48000, 32000], 2: [22050, 24000, 16000], 2.5: [11025, 12000, 8000] };

/** Offset past a leading ID3v2 tag, if present. */
function skipId3(bytes) {
  if (bytes.length < 10 || bytes.toString('latin1', 0, 3) !== 'ID3') return 0;
  // tag size is a synchsafe integer: only 7 bits used per byte
  const size = ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14)
    | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f);
  return 10 + size + (bytes[5] & 0x10 ? 10 : 0); // footer present adds 10 more bytes to skip
}

function mp3FrameHeader(bytes, offset) {
  if (offset + 4 > bytes.length) return null;
  if (bytes[offset] !== 0xff || (bytes[offset + 1] & 0xe0) !== 0xe0) return null;

  const versionBits = (bytes[offset + 1] >> 3) & 0x03;
  const layerBits = (bytes[offset + 1] >> 1) & 0x03;
  if (versionBits === 1 || layerBits === 0) return null; // reserved, unused values

  const version = { 0: 2.5, 2: 2, 3: 1 }[versionBits];
  const layer = { 1: 3, 2: 2, 3: 1 }[layerBits];
  const bitrate = MP3_BITRATES[version === 1 ? 1 : 2][layer][(bytes[offset + 2] >> 4) & 0x0f];
  const sampleRate = MP3_RATES[version][(bytes[offset + 2] >> 2) & 0x03];
  if (!bitrate || !sampleRate) return null;

  const padding = (bytes[offset + 2] >> 1) & 0x01;
  const mono = ((bytes[offset + 3] >> 6) & 0x03) === 3;
  // layer I has 384 samples/frame with a 4-byte slot; layer III halves samples on MPEG2/2.5
  const samples = layer === 1 ? 384 : (layer === 2 || version === 1 ? 1152 : 576);
  const size = layer === 1
    ? Math.floor((12000 * bitrate) / sampleRate + padding) * 4
    : Math.floor((samples / 8000 * bitrate) / sampleRate) + padding;

  return { version, layer, bitrate, sampleRate, samples, size, mono };
}

function mp3Duration(bytes) {
  const start = skipId3(bytes);

  // finds the first frame — some files have stray bytes after the tag
  let frame = null;
  let offset = start;
  for (const limit = Math.min(bytes.length, start + 65536); offset < limit; offset += 1) {
    frame = mp3FrameHeader(bytes, offset);
    if (frame) break;
  }
  if (!frame) return null;

  // a VBR table, if present, states the total frame count directly
  const vbrFrames = xingFrames(bytes, offset, frame) ?? vbriFrames(bytes, offset);
  if (vbrFrames) return (vbrFrames * frame.samples) / frame.sampleRate;

  // otherwise compute from the fixed bitrate, excluding a trailing 128-byte ID3v1 tag
  const hasId3v1 = bytes.length >= 128
    && bytes.toString('latin1', bytes.length - 128, bytes.length - 125) === 'TAG';
  const audioBytes = (bytes.length - (hasId3v1 ? 128 : 0)) - offset;
  return (audioBytes * 8) / (frame.bitrate * 1000);
}

function xingFrames(bytes, frameStart, frame) {
  // the Xing/Info table follows the frame header's side info; its offset depends on version/channels
  const skip = frame.version === 1 ? (frame.mono ? 21 : 36) : (frame.mono ? 13 : 21);
  const at = frameStart + skip;
  if (at + 12 > bytes.length) return null;
  const tag = bytes.toString('latin1', at, at + 4);
  if (tag !== 'Xing' && tag !== 'Info') return null;
  const flags = bytes.readUInt32BE(at + 4);
  return flags & 0x01 ? bytes.readUInt32BE(at + 8) : null;
}

function vbriFrames(bytes, frameStart) {
  const at = frameStart + 36;
  if (at + 18 > bytes.length) return null;
  if (bytes.toString('latin1', at, at + 4) !== 'VBRI') return null;
  return bytes.readUInt32BE(at + 14);
}
