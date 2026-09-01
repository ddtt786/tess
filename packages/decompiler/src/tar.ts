// ============================================================================
//  .ent 묶음 읽기 — `tar` 패키지로
//
//  처음에는 의존성 없이 ustar 헤더를 직접 파싱했는데, playentry.org 가 실제로
//  내보내는 파일 중에는 GNU longname/PAX 확장이나 그 밖의 변형을 쓰는 것도
//  있어서 손으로 짠 파서가 깨지는 경우가 있었다. `tar` 는 이런 변형을 전부
//  이해하는 검증된 패키지라 그걸 쓴다. gzip 압축 여부도 알아서 판단한다.
// ============================================================================
import { Parser } from 'tar';
import type { TarEntry } from './types.ts';

/**
 * ustar/GNU/PAX 묶음(gzip 이든 아니든)을 { name, data } 목록으로 푼다.
 * 디렉터리 항목은 건너뛴다.
 */
export function readTar(bytes: Buffer): Promise<TarEntry[]> {
  return new Promise((resolve, reject) => {
    const entries: TarEntry[] = [];
    const parser = new Parser({
      onReadEntry: (entry) => {
        if (entry.type !== 'File') {
          entry.resume();
          return;
        }
        const chunks: Buffer[] = [];
        entry.on('data', (chunk: Buffer) => chunks.push(chunk));
        entry.on('end', () => entries.push({ name: entry.path, data: Buffer.concat(chunks) }));
        entry.on('error', reject);
      },
    });
    parser.on('error', reject);
    parser.on('end', () => resolve(entries));
    parser.end(bytes);
  });
}
