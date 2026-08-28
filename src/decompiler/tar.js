// ============================================================================
//  Reads .ent archives using the `tar` package.
//
//  Files exported by playentry.org may use GNU longname/PAX extensions and
//  other variants beyond plain ustar, and gzip compression is optional; the
//  `tar` package handles all of that.
// ============================================================================
import { Parser } from 'tar';

/**
 * Unpacks a ustar/GNU/PAX archive (gzip or not) into a { name, data } list.
 * Directory entries are skipped.
 *
 * @param {Buffer} bytes
 * @returns {Promise<Array<{name: string, data: Buffer}>>}
 */
export function readTar(bytes) {
  return new Promise((resolve, reject) => {
    const entries = [];
    const parser = new Parser({
      onReadEntry: (entry) => {
        if (entry.type !== 'File') {
          entry.resume();
          return;
        }
        const chunks = [];
        entry.on('data', (chunk) => chunks.push(chunk));
        entry.on('end', () => entries.push({ name: entry.path, data: Buffer.concat(chunks) }));
        entry.on('error', reject);
      },
    });
    parser.on('error', reject);
    parser.on('end', () => resolve(entries));
    parser.end(bytes);
  });
}
