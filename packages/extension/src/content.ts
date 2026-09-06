/**
 * @fileoverview Puts the runner into the page and carries settings to it.
 *
 * The script tag goes in at `document_start` so the hooks are in place before
 * entryjs loads the work. Settings are read after that and posted across, since
 * storage cannot be read synchronously and waiting for it would lose the race.
 */
import { api, readSettings, onSettingsChanged, writeSettings } from './common/browser.ts';
import { CHANNEL, isPageMessage, type ContentMessage, type RunnerStatus } from './common/protocol.ts';
import type { Settings } from './common/settings.ts';

function injectRunner(): void {
  const script = document.createElement('script');
  script.src = api.runtime.getURL('page.js');
  script.async = false;
  script.dataset.tessvm = 'runner';
  (document.head ?? document.documentElement).appendChild(script);
  script.addEventListener('load', () => script.remove());
}

function send(settings: Settings): void {
  const message: ContentMessage = { channel: CHANNEL, from: 'content', type: 'settings', settings };
  window.postMessage(message, window.location.origin);
}

function reportStatus(status: RunnerStatus): void {
  void api.runtime.sendMessage({ type: 'tessvm-status', status }).catch(() => {
    // The worker may be asleep with nothing listening; the badge catches up
    // from storage the next time it wakes.
  });
}

window.addEventListener('message', (event) => {
  // Only the runner we injected into this page, never a frame inside it.
  if (event.source && event.source !== window) return;
  if (event.origin && event.origin !== window.location.origin) return;
  if (!isPageMessage(event.data)) return;
  const message = event.data;
  if (message.type === 'ready') {
    void readSettings().then(send);
    return;
  }
  if (message.type === 'save') {
    void writeSettings(message.settings);
    return;
  }
  if (message.type === 'status') {
    reportStatus(message.status);
  }
});

injectRunner();
void readSettings().then(send);
onSettingsChanged(send);
