// ============================================================================
//  소리 파일에서 재생 길이 읽기
//
//  엔트리는 project.json 의 `duration` 을 그대로 믿고 소리 목록에 길이를 보여 준다.
//  컴파일러가 그 값을 구하지 못하면 모든 소리가 1초로 굳어서, 되돌린 작품이 원본과
//  달라진다. 그렇다고 코드에 `for 1.3` 을 늘 적게 하면 소리 파일을 바꿀 때마다 숫자까지
//  함께 고쳐야 한다(모양의 `size` 와 같은 이유). 그래서 파일에서 직접 잰다.
//
//  소리를 디코딩하지는 않는다. 헤더만 읽어서 길이를 계산한다.
// ============================================================================

/** 엔트리가 소리 길이를 적는 자릿수(소수점 한 자리)에 맞춘다 */
const round = (seconds) => Math.round(seconds * 10) / 10;

/**
 * 소리 파일에서 재생 길이(초)를 잰다. 재지 못하면 null 을 돌려준다.
 * @param {Buffer} bytes
 * @param {string} ext 확장자 (`.mp3` 처럼 점을 포함한 소문자)
 */
export function audioDuration(bytes, ext) {
  try {
    const seconds = measure(bytes, ext);
    return Number.isFinite(seconds) && seconds > 0 ? round(seconds) : null;
  } catch {
    return null; // 파일 하나가 깨졌다고 컴파일이 멈추지는 않는다
  }
}

function measure(bytes, ext) {
  if (ext === '.wav') return wavDuration(bytes);
  if (ext === '.ogg') return oggDuration(bytes);
  if (ext === '.m4a' || ext === '.mp4') return mp4Duration(bytes);
  if (ext === '.mp3') return mp3Duration(bytes);
  // 확장자를 믿을 수 없으면 파일 내용으로 형식을 알아본다
  if (bytes.length > 12 && bytes.toString('latin1', 0, 4) === 'RIFF') return wavDuration(bytes);
  if (bytes.length > 4 && bytes.toString('latin1', 0, 4) === 'OggS') return oggDuration(bytes);
  return mp3Duration(bytes);
}

// ---------------------------------------------------------------------------
//  WAV — fmt 청크의 초당 바이트 수로 data 청크를 나눈다
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
      // 크기 칸이 0 이거나 잘못된 파일(스트리밍으로 기록한 것)은 남은 바이트를 모두 센다
      const dataSize = size > 0 && body + size <= bytes.length ? size : bytes.length - body;
      return dataSize / byteRate;
    }
    offset = body + size + (size % 2); // 청크 크기는 짝수 바이트로 맞춰져 있다
  }
  return null;
}

// ---------------------------------------------------------------------------
//  Ogg (Vorbis · Opus) — 마지막 페이지의 granule position 이 총 샘플 수다
// ---------------------------------------------------------------------------
function oggDuration(bytes) {
  if (bytes.toString('latin1', 0, 4) !== 'OggS') return null;

  // 첫 페이지의 식별 헤더에서 표본율을 읽는다. Opus 는 언제나 48kHz 를 기준으로 센다.
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

  // 파일 끝에서부터 거슬러 올라가 마지막 페이지를 찾는다
  for (let offset = bytes.length - 14; offset >= 0; offset -= 1) {
    if (bytes.toString('latin1', offset, offset + 4) !== 'OggS') continue;
    const granule = Number(bytes.readBigUInt64LE(offset + 6));
    if (granule <= 0) continue;
    return Math.max(0, granule - preSkip) / rate;
  }
  return null;
}

// ---------------------------------------------------------------------------
//  MP4 · M4A — moov > mvhd 의 duration / timescale
// ---------------------------------------------------------------------------
function mp4Duration(bytes, start = 0, end = bytes.length) {
  let offset = start;
  while (offset + 8 <= end) {
    let size = bytes.readUInt32BE(offset);
    const type = bytes.toString('latin1', offset + 4, offset + 8);
    let body = offset + 8;
    if (size === 1) { // 크기가 1 이면 뒤에 64비트 크기가 따로 온다
      if (body + 8 > end) return null;
      size = Number(bytes.readBigUInt64BE(body));
      body += 8;
    }
    if (size === 0) size = end - offset; // 크기가 0 이면 파일 끝까지가 이 아톰이다

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
//  MP3 — 첫 프레임 헤더를 읽고, VBR 표(Xing/VBRI)가 있으면 프레임 수로,
//  없으면 고정 비트레이트로 나눈다
// ---------------------------------------------------------------------------
const MP3_BITRATES = {
  // [MPEG 버전][레이어] 별 비트레이트 표(kbps). 인덱스 0 은 free, 15 는 예약값이라 쓰지 않는다.
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

/** 파일 앞에 붙은 ID3v2 태그를 건너뛴 위치 */
function skipId3(bytes) {
  if (bytes.length < 10 || bytes.toString('latin1', 0, 3) !== 'ID3') return 0;
  // 태그 크기는 바이트마다 7비트만 쓰는 synchsafe 정수로 적혀 있다
  const size = ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14)
    | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f);
  return 10 + size + (bytes[5] & 0x10 ? 10 : 0); // 꼬리말(footer)이 있으면 10 바이트를 더 건너뛴다
}

function mp3FrameHeader(bytes, offset) {
  if (offset + 4 > bytes.length) return null;
  if (bytes[offset] !== 0xff || (bytes[offset + 1] & 0xe0) !== 0xe0) return null;

  const versionBits = (bytes[offset + 1] >> 3) & 0x03;
  const layerBits = (bytes[offset + 1] >> 1) & 0x03;
  if (versionBits === 1 || layerBits === 0) return null; // 쓰지 않는 예약값이다

  const version = { 0: 2.5, 2: 2, 3: 1 }[versionBits];
  const layer = { 1: 3, 2: 2, 3: 1 }[layerBits];
  const bitrate = MP3_BITRATES[version === 1 ? 1 : 2][layer][(bytes[offset + 2] >> 4) & 0x0f];
  const sampleRate = MP3_RATES[version][(bytes[offset + 2] >> 2) & 0x03];
  if (!bitrate || !sampleRate) return null;

  const padding = (bytes[offset + 2] >> 1) & 0x01;
  const mono = ((bytes[offset + 3] >> 6) & 0x03) === 3;
  // 레이어 I 은 한 프레임이 384 표본이고 슬롯이 4바이트다. 레이어 III 은 MPEG2·2.5 에서 표본이 절반이다.
  const samples = layer === 1 ? 384 : (layer === 2 || version === 1 ? 1152 : 576);
  const size = layer === 1
    ? Math.floor((12000 * bitrate) / sampleRate + padding) * 4
    : Math.floor((samples / 8000 * bitrate) / sampleRate) + padding;

  return { version, layer, bitrate, sampleRate, samples, size, mono };
}

function mp3Duration(bytes) {
  const start = skipId3(bytes);

  // 첫 프레임을 찾는다. 태그 뒤에 알 수 없는 바이트가 조금 붙어 있는 파일도 있다.
  let frame = null;
  let offset = start;
  for (const limit = Math.min(bytes.length, start + 65536); offset < limit; offset += 1) {
    frame = mp3FrameHeader(bytes, offset);
    if (frame) break;
  }
  if (!frame) return null;

  // VBR 표가 있으면 전체 프레임 수가 그대로 적혀 있다
  const vbrFrames = xingFrames(bytes, offset, frame) ?? vbriFrames(bytes, offset);
  if (vbrFrames) return (vbrFrames * frame.samples) / frame.sampleRate;

  // 없으면 고정 비트레이트로 계산한다. 파일 뒤에 붙은 ID3v1 태그(128바이트)는 빼고 센다.
  const hasId3v1 = bytes.length >= 128
    && bytes.toString('latin1', bytes.length - 128, bytes.length - 125) === 'TAG';
  const audioBytes = (bytes.length - (hasId3v1 ? 128 : 0)) - offset;
  return (audioBytes * 8) / (frame.bitrate * 1000);
}

function xingFrames(bytes, frameStart, frame) {
  // Xing/Info 표는 프레임 헤더 뒤의 side info 다음에 온다. 그 자리는 버전과 채널 수에 따라 다르다.
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
