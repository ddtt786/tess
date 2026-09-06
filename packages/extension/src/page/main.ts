/**
 * @fileoverview Page-side entry point, loaded into playentry.org as a module.
 *
 * The content script marks where a player belongs; a runner is mounted there and
 * taken down again when the page drops that mount point.
 */
import { mountPlayer, type MountedPlayer } from './player.ts';

const HOST_SELECTOR = '[data-tessvm-project]';
const players = new Map<HTMLElement, MountedPlayer>();

function scan(): void {
  for (const [host, player] of players) {
    if (!host.isConnected) {
      player.dispose();
      players.delete(host);
    }
  }
  for (const host of document.querySelectorAll<HTMLElement>(HOST_SELECTOR)) {
    const id = host.dataset.tessvmProject;
    if (players.has(host) || !id) {
      continue;
    }
    players.set(
      host,
      mountPlayer(host, id, host.dataset.tessvmGroup ?? null, host.dataset.tessvmSvg !== '0'),
    );
  }
}

function unmountAll(): void {
  for (const player of players.values()) {
    player.dispose();
  }
  players.clear();
}

window.addEventListener('message', (event) => {
  if (event.source !== window) {
    return;
  }
  const data = event.data as { __tessvm?: string } | null;
  if (!data || typeof data !== 'object') {
    return;
  }
  if (data.__tessvm === 'scan') {
    scan();
  } else if (data.__tessvm === 'unmount') {
    unmountAll();
  }
});

scan();
