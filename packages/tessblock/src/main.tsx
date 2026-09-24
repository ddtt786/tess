import { render } from 'preact';
import { initTreeSitterForVite } from '@tess/parser/vite';
import './ui/style.css';
import { openAssets } from './model/assets.ts';
import { restoreFolderState } from './model/folder.ts';
import { App } from './ui/App.tsx';
import { loadFonts } from './model/fonts.ts';

// Program sources parse through tree-sitter once it has loaded.
void initTreeSitterForVite();

loadFonts();

const host = document.getElementById('app');
// Costumes and sounds come out of IndexedDB before the first paint, so nothing
// draws with a missing picture.
void openAssets().then(() => {
  if (host) render(<App />, host);
  // The folder used last time is shown, to be reconnected with one click.
  void restoreFolderState();
});

if (import.meta.env.DEV) {
  // Dev handle for driving the editor from the console.
  void (async () => {
    const [store, source, run, host2, paint, blockly, parser] = await Promise.all([
      import('./model/store.ts'),
      import('./ui/source.ts'),
      import('./runtime/run.ts'),
      import('./ui/blockly-host.ts'),
      import('./ui/painter-host.ts'),
      import('blockly/core'),
      import('@tess/parser'),
    ]);
    Object.assign(window, {
      tessblock: { ...store, ...source, ...run, ...host2, ...paint, Blockly: blockly, parser },
    });
  })();
}
