# src/legacy

`tess.ohm` is the original Ohm statement of the Tess grammar. It is kept as a
reference only — nothing loads it and Ohm is no longer a dependency.

The running grammar is `src/parser/`:

| Concern | File |
| --- | --- |
| Tokens, keywords, reserved words | `src/parser/tokens.js` |
| Grammar rules | `src/parser/parser.js` |
| CST to AST | `src/parser/visitor.js` |
| `parseSource` entry point | `src/parser/index.js` |

Change the grammar in `src/parser/`. This file is not updated in step.
