// Tests imageSize (reads original dimensions from asset files), especially SVG.
//
// Entry trusts project.json's dimension value as-is for render size
// (entryjs entity.js `setImage`: `this.setWidth(dimension.width)`) rather than
// re-measuring the loaded image's pixel size. SVG has no magic-byte header like
// PNG/GIF/JPEG, so when the size can't be read, makeAsset falls back to 100x100.
// If scale_x/scale_y were set relative to the SVG's real size (e.g. an 800x490
// background), rescaling against a 100x100 fallback shrinks the result badly.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { imageSize } from '../src/compiler/assets.js';
import { audioDuration } from '../src/compiler/audio.js';
import { compileProject } from '../src/compiler/index.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

test('PNG 헤더에서 원본 크기를 읽는다 (회귀)', () => {
  const bytes = fs.readFileSync(path.join(root, 'examples/cat_idle.png'));
  assert.deepEqual(imageSize(bytes), { width: 220, height: 350 });
});

test('SVG 는 viewBox 에서 원본 크기를 읽는다', () => {
  const svg = Buffer.from(
    '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 490"></svg>',
    'utf-8',
  );
  assert.deepEqual(imageSize(svg), { width: 800, height: 490 });
});

test('SVG 는 width/height 속성을 viewBox 보다 먼저 쓴다', () => {
  const svg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="120px" height="80" viewBox="0 0 800 490"></svg>',
    'utf-8',
  );
  assert.deepEqual(imageSize(svg), { width: 120, height: 80 });
});

test('SVG 의 width/height 가 %(퍼센트) 뿐이면 무시하고 viewBox 로 넘어간다', () => {
  const svg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 640 360"></svg>',
    'utf-8',
  );
  assert.deepEqual(imageSize(svg), { width: 640, height: 360 });
});

test('크기를 전혀 알 수 없는 SVG 는 null 을 돌려준다 (makeAsset 이 100x100 으로 대체)', () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'utf-8');
  assert.equal(imageSize(svg), null);
});

test('실제로 디컴파일한 배경 SVG(새그림1.svg, 800x490)에서도 정확히 읽힌다', () => {
  const file = path.join(root, 'temp/dd_tess/assets/image/새그림1.svg');
  if (!fs.existsSync(file)) return; // temp/ holds example assets; skip if not present
  const bytes = fs.readFileSync(file);
  assert.deepEqual(imageSize(bytes), { width: 800, height: 490 });
});

// ---------------------------------------------------------------------------
//  Tests audioDuration (reads playback length from audio files)
//
//  Entry also trusts project.json's duration for sound length. If the compiler
//  can't determine it, it defaults to 1 second, which would force every `play
//  sound` call to redundantly declare `for 1.3`. Instead, duration is read
//  directly from the file header.
// ---------------------------------------------------------------------------

/** Minimal WAV fixture with a 2.5s playback length, byteRate bytes/sec. */
function wavFixture(seconds, byteRate = 88200) {
  const dataSize = Math.round(seconds * byteRate);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8, 'latin1');
  header.write('fmt ', 12, 'latin1');
  header.writeUInt32LE(16, 16);            // fmt chunk size
  header.writeUInt16LE(1, 20);             // PCM
  header.writeUInt16LE(2, 22);             // channels
  header.writeUInt32LE(44100, 24);         // sample rate
  header.writeUInt32LE(byteRate, 28);      // bytes per second
  header.writeUInt16LE(4, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'latin1');
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, Buffer.alloc(dataSize)]);
}

/** One MPEG1 Layer III, 44.1kHz, 128kbps stereo frame (417 bytes). */
function mp3Frame() {
  const frame = Buffer.alloc(417);
  frame[0] = 0xff;
  frame[1] = 0xfb; // MPEG1, Layer III, no CRC
  frame[2] = 0x90; // 128kbps, 44.1kHz, no padding
  frame[3] = 0x00; // stereo
  return frame;
}

test('WAV 는 fmt 의 초당 바이트로 data 청크를 나눈다', () => {
  assert.equal(audioDuration(wavFixture(2.5), '.wav'), 2.5);
  assert.equal(audioDuration(wavFixture(0.3), '.wav'), 0.3);
});

test('MP3 는 고정 비트레이트면 파일 크기로 잰다', () => {
  // 100 frames at 128kbps = 41700 bytes -> 2.6s
  const bytes = Buffer.concat(Array.from({ length: 100 }, mp3Frame));
  assert.equal(audioDuration(bytes, '.mp3'), 2.6);
});

test('MP3 앞의 ID3v2 태그와 뒤의 ID3v1 태그는 길이에서 뺀다', () => {
  const id3v2 = Buffer.alloc(2010);
  id3v2.write('ID3', 0, 'latin1');
  id3v2[6] = 0x00; id3v2[7] = 0x00; id3v2[8] = 0x0f; id3v2[9] = 0x50; // synchsafe 2000
  const id3v1 = Buffer.alloc(128);
  id3v1.write('TAG', 0, 'latin1');
  const audio = Buffer.concat(Array.from({ length: 100 }, mp3Frame));

  assert.equal(audioDuration(Buffer.concat([id3v2, audio, id3v1]), '.mp3'), 2.6);
});

test('MP3 에 Xing/Info 표가 있으면 프레임 수로 잰다 (VBR)', () => {
  // Must trust frame count; file size is unreliable since VBR bitrate varies
  const first = mp3Frame();
  first.write('Info', 36, 'latin1');       // MPEG1 stereo header is 36 bytes
  first.writeUInt32BE(0x01, 40);           // frame count field present
  first.writeUInt32BE(200, 44);            // 200 frames -> 200 * 1152 / 44100 = 5.2s
  const bytes = Buffer.concat([first, Buffer.alloc(999999)]);
  assert.equal(audioDuration(bytes, '.mp3'), 5.2);
});

test('소리가 아닌/깨진 파일은 null 을 돌려준다 (makeAsset 이 1초로 대체)', () => {
  assert.equal(audioDuration(Buffer.from('그냥 글자입니다'), '.mp3'), null);
  assert.equal(audioDuration(Buffer.alloc(0), '.wav'), null);
});

test('컴파일러는 for 를 안 적어도 소리 파일에서 길이를 재서 넣는다', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tess-duration-'));
  fs.writeFileSync(path.join(dir, 'click.wav'), wavFixture(2.5));
  const main = path.join(dir, 'main.tess');
  const source = `scene "s":
  object "o":
    default costume 기본 "없음.png" size 10 10
    sound 딸깍 "click.wav"
    when start do
      play sound "딸깍"
    end
  end
end`;
  fs.writeFileSync(main, source);

  const result = compileProject(source, { path: main, assetDirs: [dir] });
  assert.deepEqual(result.warnings, [], result.warnings.map((w) => w.message).join('\n'));
  assert.equal(result.project.objects[0].sprite.sounds[0].duration, 2.5);

  // An explicit duration in source overrides the measured one (for when the file isn't added yet)
  const declared = compileProject(source.replace('"click.wav"', '"click.wav" for 9'), { path: main, assetDirs: [dir] });
  assert.equal(declared.project.objects[0].sprite.sounds[0].duration, 9);

  fs.rmSync(dir, { recursive: true, force: true });
});
