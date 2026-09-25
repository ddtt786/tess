import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm', 'cjs'],
  // Declarations are emitted by `tsc -p tsconfig.build.json` (rollup-plugin-dts
  // does not support the TypeScript version this project pins).
  dts: false,
  sourcemap: true,
  clean: true,
  target: 'es2020',
  external: ['@svgdotjs/svg.js', 'clipper2-ts', 'perfect-freehand'],
});
