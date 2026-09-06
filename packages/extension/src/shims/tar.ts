/**
 * @fileoverview `tar` stand-in for the browser bundle.
 *
 * `.ent` files are packed and unpacked with this on the command line. The
 * extension reads the work straight out of the running page, so neither side of
 * that path is reachable here.
 */
export class Parser {
  constructor() {
    throw new Error('tar 는 브라우저에서 쓸 수 없습니다.');
  }
}

export class Header {
  constructor() {
    throw new Error('tar 는 브라우저에서 쓸 수 없습니다.');
  }
}

export default { Parser, Header };
