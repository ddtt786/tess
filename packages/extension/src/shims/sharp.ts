/**
 * @fileoverview `sharp` stand-in for the browser bundle.
 *
 * Only thumbnail generation uses it, and the extension never builds a `.ent`.
 */
export default function sharp(): never {
  throw new Error('sharp 는 브라우저에서 쓸 수 없습니다.');
}
