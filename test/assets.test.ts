// imageSize (모양 파일 원본 크기 읽기) 검사 — 특히 SVG.
//
// 엔트리는 project.json 의 dimension 값을 그대로 믿고 렌더링 크기를 정한다
// (entryjs entity.js `setImage`: `this.setWidth(dimension.width)`) — 실제로 로드한
// 이미지 픽셀 크기를 다시 재서 쓰지 않는다. SVG 는 PNG/GIF/JPEG 처럼 매직 바이트
// 헤더가 없어서 크기를 못 읽으면 makeAsset 이 100x100 으로 대체하는데, 디컴파일한
// 소스처럼 scale_x/scale_y 가 SVG 의 진짜 크기(예: 무대를 덮는 800x490 배경) 기준으로
// 정해져 있으면 100x100 기준으로 다시 스케일된 결과가 원래보다 훨씬 작게 나온다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { imageSize } from '@tess/compiler';
import { audioDuration } from '@tess/compiler';
import { compileProject } from '@tess/compiler';
import { makeEntryBundle } from '@tess/compiler';
import { makeThumbnail } from '@tess/compiler';
import { readTar } from '@tess/decompiler';

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
  if (!fs.existsSync(file)) return; // temp/ 는 예제 자산이라 없어도 이 테스트만 건너뛴다
  const bytes = fs.readFileSync(file);
  assert.deepEqual(imageSize(bytes), { width: 800, height: 490 });
});

// ---------------------------------------------------------------------------
//  audioDuration (소리 재생 길이 읽기)
//
//  엔트리는 소리 길이도 project.json 의 duration 을 그대로 믿는다. 컴파일러가 이 값을
//  못 구하면 전부 1초로 굳는데, 그렇다고 코드에 `for 1.3` 을 늘 적게 하면 소리 파일을
//  바꿀 때마다 사람이 숫자까지 고쳐야 한다 — 그래서 헤더를 읽어 직접 잰다.
//  (실제 작품 310개 소리를 ffprobe 와 맞춰 확인했다.)
// ---------------------------------------------------------------------------

/** 재생 길이 2.5초짜리 최소 WAV — 초당 byteRate 바이트 */
function wavFixture(seconds: any, byteRate = 88200) {
  const dataSize = Math.round(seconds * byteRate);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8, 'latin1');
  header.write('fmt ', 12, 'latin1');
  header.writeUInt32LE(16, 16);            // fmt 청크 크기
  header.writeUInt16LE(1, 20);             // PCM
  header.writeUInt16LE(2, 22);             // 채널
  header.writeUInt32LE(44100, 24);         // 표본율
  header.writeUInt32LE(byteRate, 28);      // 초당 바이트
  header.writeUInt16LE(4, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'latin1');
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, Buffer.alloc(dataSize)]);
}

/** MPEG1 Layer III · 44.1kHz · 128kbps 스테레오 프레임 하나 (417 바이트) */
function mp3Frame() {
  const frame = Buffer.alloc(417);
  frame[0] = 0xff;
  frame[1] = 0xfb; // MPEG1, Layer III, CRC 없음
  frame[2] = 0x90; // 128kbps, 44.1kHz, 패딩 없음
  frame[3] = 0x00; // 스테레오
  return frame;
}

test('WAV 는 fmt 의 초당 바이트로 data 청크를 나눈다', () => {
  assert.equal(audioDuration(wavFixture(2.5), '.wav'), 2.5);
  assert.equal(audioDuration(wavFixture(0.3), '.wav'), 0.3);
});

test('MP3 는 고정 비트레이트면 파일 크기로 잰다', () => {
  // 128kbps 프레임 100개 = 41700 바이트 -> 2.6초
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
  // 프레임 수만 믿어야 한다 — 파일 크기로 재면 비트레이트가 들쭉날쭉해 틀린다
  const first = mp3Frame();
  first.write('Info', 36, 'latin1');       // MPEG1 스테레오는 헤더 뒤 36바이트
  first.writeUInt32BE(0x01, 40);           // 프레임 수 칸이 있다
  first.writeUInt32BE(200, 44);            // 200 프레임 -> 200 * 1152 / 44100 = 5.2초
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
  assert.equal(result.project!.objects[0].sprite.sounds[0].duration, 2.5);

  // 코드에 적어 둔 값이 있으면 그 값이 우선이다 (파일을 아직 안 넣었을 때를 위해서)
  const declared = compileProject(source.replace('"click.wav"', '"click.wav" for 9'), { path: main, assetDirs: [dir] });
  assert.equal(declared.project!.objects[0].sprite.sounds[0].duration, 9);

  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
//  모양 미리보기(썸네일)
//
//  엔트리 작품 파일은 그림마다 image/ 옆에 thumb/ 를 나란히 갖고 있고, 편집기의
//  오브젝트·모양 목록이 그걸 쓴다. 우리가 만든 .ent 에는 이게 빠져 있었다.
// ---------------------------------------------------------------------------
test('PNG 에서 96x96 안에 맞춘 미리보기를 만든다', async () => {
  const bytes = fs.readFileSync(path.join(root, 'examples/cat_run.png'));
  const original = imageSize(bytes);
  const thumb = await makeThumbnail(bytes);
  assert.ok(thumb, '미리보기를 만들어야 한다');

  const size = imageSize(thumb);
  assert.ok(size!.width <= 96 && size!.height <= 96, `96 안에 들어와야 한다: ${size!.width}x${size!.height}`);
  assert.equal(Math.max(size!.width, size!.height), 96); // 긴 쪽이 96 에 딱 맞는다
  // 비율이 유지된다
  const before = original!.width / original!.height;
  const after = size!.width / size!.height;
  assert.ok(Math.abs(before - after) / before < 0.02, `비율이 달라졌다: ${before} -> ${after}`);
  assert.ok(thumb.length < bytes.length, '미리보기가 원본보다 작아야 한다');
});

test('원본이 96 보다 작으면 늘리지 않는다', async () => {
  // 8x4 짜리 아주 작은 PNG 를 만들어서 넣는다
  const tiny = await makeThumbnail(fs.readFileSync(path.join(root, 'examples/cat_run.png')), 4096);
  assert.equal(imageSize(tiny!)!.width, imageSize(fs.readFileSync(path.join(root, 'examples/cat_run.png')))!.width);
});

test('PNG 가 아닌 파일은 미리보기를 만들지 않는다 (엔트리도 SVG 는 안 만든다)', async () => {
  assert.equal(await makeThumbnail(Buffer.from('<svg viewBox="0 0 10 10"></svg>')), null);
  assert.equal(await makeThumbnail(Buffer.alloc(0)), null);
});

test('.ent 묶음에 image/ 와 나란히 thumb/ 가 들어간다', async () => {
  const source = `scene "s":
  object "o":
    default costume 달리기 "cat_run.png"
  end
end`;
  const result = compileProject(source, { path: path.join(root, 'x.tess'), assetDirs: [path.join(root, 'examples')] });
  assert.deepEqual(result.errors, []);

  const entries = await readTar(await makeEntryBundle(result.project!, result.assets));
  const names = entries.map((e) => e.name);
  const image = names.find((n) => n.includes('/image/'));
  assert.ok(image, '그림이 담겨야 한다');
  const thumb = image.replace('/image/', '/thumb/');
  assert.ok(names.includes(thumb), `미리보기가 같이 담겨야 한다: ${thumb}`);

  const thumbBytes = entries.find((e) => e.name === thumb)!.data;
  assert.equal(Math.max(imageSize(thumbBytes)!.width, imageSize(thumbBytes)!.height), 96);
});
