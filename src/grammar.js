import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ohm from 'ohm-js';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Ohm grammar source for the Tess language. */
export const grammarSource = fs.readFileSync(path.join(here, 'tess.ohm'), 'utf-8');

/** Ohm Grammar instance for the Tess language. */
export const grammar = ohm.grammar(grammarSource);

export default grammar;
