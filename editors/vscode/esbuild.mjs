// Bundles the client and the server, compiler front end included, into two
// CommonJS files so the packaged extension carries no runtime dependencies.
import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const common = {
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node18',
    sourcemap: true,
    minify: process.argv.includes('--minify'),
    logLevel: 'info',
};

const builds = [
    { ...common, entryPoints: ['src/extension/main.ts'], outfile: 'out/extension.cjs', external: ['vscode'] },
    { ...common, entryPoints: ['src/language/main.ts'], outfile: 'out/server.cjs', external: ['vscode'] },
    // Headless analysis, used by the tests and by tools that want editor-accurate results.
    { ...common, entryPoints: ['src/language/api.ts'], outfile: 'out/language.cjs', external: ['vscode'] },
];

if (watch) {
    for (const options of builds) {
        const ctx = await esbuild.context(options);
        await ctx.watch();
    }
} else {
    await Promise.all(builds.map((options) => esbuild.build(options)));
}
