import { render } from 'preact';
import './ui/style.css';
import { App } from './ui/App.tsx';

const host = document.getElementById('app');
if (host) render(<App />, host);

if (import.meta.env.DEV) {
  // Dev handle for driving the editor from the console.
  void (async () => {
    const [store, source, run, host2, paint, blockly] = await Promise.all([
      import('./model/store.ts'),
      import('./ui/source.ts'),
      import('./runtime/run.ts'),
      import('./ui/blockly-host.ts'),
      import('./ui/painter-host.ts'),
      import('blockly/core'),
    ]);
    Object.assign(window, { tessblock: { ...store, ...source, ...run, ...host2, ...paint, Blockly: blockly } });
  })();
}
