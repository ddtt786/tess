import { Parser } from 'tar';
import type { TarEntry } from './types.ts';

/**
 * .ent 파일이나 tar 묶음(gzip 포함)을 파싱하여 `{ name, data }` 형태의 파일 목록을 반환합니다.
 * 디렉터리 항목은 결과에서 제외됩니다.
 *
 * @param bytes - 파싱할 tar 묶음의 버퍼 데이터
 * @returns 파일 이름과 버퍼 데이터를 포함하는 객체의 배열을 반환하는 프로미스
 *
 * @example
 * const buffer = fs.readFileSync('project.ent');
 * const entries = await readTar(buffer);
 * const projectJson = entries.find(e => e.name === 'project.json');
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
