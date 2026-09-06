#!/usr/bin/env node
/**
 * @fileoverview Builds the unpacked extension for chrome and firefox.
 *
 * Two folders come out of one bundle: the scripts are identical and only the
 * manifest differs, because chrome runs the worker as a service worker and
 * firefox as an event page.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import * as esbuild from 'esbuild';
import { bundleOptions, ENTRIES, OUT, SRC, TARGETS } from './bundle.ts';
import { CSP_RULES, manifestFor, NAME, VERSION } from './manifest.ts';
import { ICON_SIZES, makeIcon } from './icon.ts';

const dev = process.argv.includes('--dev');
const watch = process.argv.includes('--watch');
const OPTIONS = bundleOptions({ dev });

function writeStaticFiles(target: (typeof TARGETS)[number]): void {
  const dir = path.join(OUT, target);
  fs.mkdirSync(path.join(dir, 'rules'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'icons'), { recursive: true });

  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    `${JSON.stringify(manifestFor(target), null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(dir, 'rules', 'relax-csp.json'),
    `${JSON.stringify(CSP_RULES, null, 2)}\n`,
  );
  for (const file of ['popup.html', 'popup.css']) {
    fs.copyFileSync(path.join(SRC, 'popup', file), path.join(dir, file));
  }
  for (const size of ICON_SIZES) {
    fs.writeFileSync(path.join(dir, 'icons', `icon-${size}.png`), makeIcon(size));
  }
}

async function bundle(): Promise<number> {
  let bytes = 0;
  for (const entry of ENTRIES) {
    const result = await esbuild.build({
      ...OPTIONS,
      entryPoints: [entry.input],
      outfile: path.join(OUT, TARGETS[0], entry.output),
      metafile: true,
    });
    for (const info of Object.values(result.metafile?.outputs ?? {})) bytes += info.bytes;
    // The two builds are byte for byte the same; only the manifest differs.
    for (const target of TARGETS.slice(1)) {
      fs.copyFileSync(
        path.join(OUT, TARGETS[0], entry.output),
        path.join(OUT, target, entry.output),
      );
    }
  }
  return bytes;
}

async function build(): Promise<void> {
  fs.rmSync(OUT, { recursive: true, force: true });
  for (const target of TARGETS) writeStaticFiles(target);
  const bytes = await bundle();
  const size = (bytes / 1024 / 1024).toFixed(2);
  console.log(`${NAME} ${VERSION} — ${size} MB`);
  for (const target of TARGETS) console.log(`  ${path.relative(process.cwd(), path.join(OUT, target))}`);
}

await build();

if (watch) {
  console.log('  src 를 지켜봅니다. Ctrl+C 로 끕니다.');
  let queued: NodeJS.Timeout | null = null;
  fs.watch(SRC, { recursive: true }, () => {
    if (queued) clearTimeout(queued);
    queued = setTimeout(() => {
      queued = null;
      build().then(
        () => console.log('  다시 만들었습니다.'),
        (error: unknown) => console.error(`  실패: ${(error as Error).message}`),
      );
    }, 120);
  });
}
