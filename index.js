// ============================================================================
//  tess — 엔트리 블록 코드로 변환되는 텍스트 언어의 Ohm 문법 구현
//
//  라이브러리로 쓸 때:  import { parse } from 'tess'
//  CLI 로 쓸 때:        node index.js examples/cat_run.tess [--ast]
// ============================================================================
export { parse, parseOrThrow, check, trace, grammar, semantics, validate } from './src/parse.js';
export { grammarSource } from './src/grammar.js';
export * as builtins from './src/builtins.js';

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parse } from './src/parse.js';

function main(argv) {
  const showAst = argv.includes('--ast');
  const files = argv.filter((a) => !a.startsWith('--'));

  if (files.length === 0) {
    console.error('사용법: node index.js <파일.tess> [--ast]');
    process.exit(2);
  }

  let failed = false;
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf-8');
    const result = parse(source);
    const label = path.basename(file);

    for (const error of result.errors) {
      failed = true;
      if (error.detail) {
        // 문법 에러: Ohm 이 만들어 준 발췌 메시지를 그대로 보여준다.
        console.error(`${label}: 문법 에러`);
        console.error(error.detail);
      } else {
        console.error(`${label}:${error.line}:${error.column}  에러: ${error.message}`);
      }
    }
    for (const warning of result.warnings) {
      console.warn(`${label}:${warning.line}:${warning.column}  경고: ${warning.message}`);
    }
    if (result.ok) console.log(`${label}: OK`);
    if (result.ok && showAst) console.log(JSON.stringify(result.ast, null, 2));
  }
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
