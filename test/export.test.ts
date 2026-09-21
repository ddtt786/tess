/**
 * 작품을 혼자 도는 한 덩어리로 내보내는 `tessvm export` 를 확인합니다.
 *
 * 실제로 도는지는 브라우저에서 봐야 하므로, 여기서는 그 덩어리가 도는 데 필요한 모양을
 * 갖췄는지를 지킵니다 — 모듈이 전부 들어갔는지, 주소가 덩어리 안을 가리키는지, 모양과
 * 소리가 같이 실렸는지.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { compileProject } from '@tess/compiler';
import { exportHtml, exportZip } from '../packages/tessvm/src/node/export.ts';

/** 1x1 png. 컴파일러가 실제 파일을 읽으므로 진짜 바이트가 필요합니다. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const SOURCE = `scene "s":
  object "o":
    default costume 기본 "dot.png" size 1 1
    when start do
      move 10 steps
    end
  end
end`;

function fixture(): { project: ReturnType<typeof compileProject>['project']; assets: { source: string; target: string }[] } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tess-export-'));
  fs.writeFileSync(path.join(dir, 'dot.png'), PNG);
  const main = path.join(dir, 'main.tess');
  fs.writeFileSync(main, SOURCE);
  const result = compileProject(SOURCE, { path: main, assetDirs: [dir] });
  assert.ok(result.project, result.errors.map((error) => error.message).join('\n'));
  return { project: result.project, assets: result.assets };
}

/** Reads the archive back through its local headers, in the order it was written. */
function unzip(data: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  let at = 0;
  while (data.readUInt32LE(at) === 0x04034b50) {
    const compressed = data.readUInt32LE(at + 18);
    const nameLength = data.readUInt16LE(at + 26);
    const extraLength = data.readUInt16LE(at + 28);
    const name = data.subarray(at + 30, at + 30 + nameLength).toString('utf-8');
    const start = at + 30 + nameLength + extraLength;
    files.set(name, zlib.inflateRawSync(data.subarray(start, start + compressed)));
    at = start + compressed;
  }
  return files;
}

test('zip 으로 내보내면 페이지·작품·모듈·에셋이 모두 들어간다', () => {
  const { project, assets } = fixture();
  const made = exportZip({ project: project!, assets, name: '내보내기', kernel: false });
  const files = unzip(made.data);

  assert.ok(files.has('index.html'));
  assert.ok(files.has('project.json'));
  assert.ok(files.has('vm/web/boot.js'));
  assert.ok(files.has('vm/pixi.mjs'));
  assert.equal(made.assets, 1);
  assert.equal(made.kernel, 'none');

  // 정적 서버는 `.ts` 를 브라우저가 실행하지 않는 형식으로 내주므로 `.js` 로 나가야 한다.
  for (const name of files.keys()) {
    assert.ok(!name.endsWith('.ts'), name);
  }
  const boot = files.get('vm/web/boot.js')!.toString('utf-8');
  assert.match(boot, /from '\.\.\/runtime\/engine\.js'/);
  assert.doesNotMatch(boot, /from '[^']*\.ts'/);

  // 작품이 가리키는 주소가 덩어리 안의 파일이어야 한다.
  const served = JSON.parse(files.get('project.json')!.toString('utf-8'));
  const fileurl = served.objects[0].sprite.pictures[0].fileurl;
  assert.match(fileurl, /^assets\//);
  assert.ok(files.has(fileurl));
});

test('단일 html 은 모듈·작품·에셋을 글 안에 담고 커널을 끈 채로도 돈다', () => {
  const { project, assets } = fixture();
  const made = exportHtml({ project: project!, assets, name: '내보내기', kernel: false });
  const html = made.data.toString('utf-8');

  // 모듈은 blob 주소를 받으므로 상대 주소가 남아 있으면 안 된다.
  assert.match(html, /tessvm\/web\/boot\.ts/);
  assert.match(html, /tessvm\/runtime\/engine\.ts/);
  assert.ok(!html.includes('../runtime/engine.ts'));
  // 모양은 worker 가 아니라 이 스레드에서 읽어야 페이지가 담아 둔 파일에 닿는다.
  assert.match(html, /preferWorkers = false/);
  // 작품 주소는 그대로 두고, 그 파일을 fetch 가 대신 내준다.
  assert.match(html, /\\"fileurl\\":\\"temp\//);
  assert.match(html, new RegExp(PNG.toString('base64').slice(0, 24)));
  // 실행 모듈은 글 안에 문자열로 들어 있으므로 따옴표가 한 번 더 감싸 있습니다.
  assert.match(html, /\\"kernelUrl\\":null/);
  assert.equal(made.assets, 1);
});

test('단일 html 이 바깥에서 받아 오는 것은 엔트리 글꼴뿐이다', () => {
  const { project, assets } = fixture();
  const html = exportHtml({ project: project!, assets, name: '내보내기', kernel: false })
    .data.toString('utf-8');
  const linked = [...html.matchAll(/<(?:script|link|img)\b[^>]*\b(?:src|href)="([^"]*)"/g)]
    .map((match) => match[1]!)
    .filter((url) => !url.startsWith('https://entry-cdn.pstatic.net/'));
  assert.deepEqual(linked, []);
});
