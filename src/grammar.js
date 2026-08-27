import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ohm from 'ohm-js';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Tess 언어의 Ohm 문법 소스 */
export const grammarSource = fs.readFileSync(path.join(here, 'tess.ohm'), 'utf-8');

/** Tess 언어의 Ohm Grammar 인스턴스 */
export const grammar = ohm.grammar(grammarSource);

export default grammar;
