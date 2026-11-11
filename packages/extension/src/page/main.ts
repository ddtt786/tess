/** Mounts one player per host and follows host settings across page navigation. */
import { mountPlayer, type MountedPlayer } from './player.ts';

const HOST_SELECTOR = '[data-tess-project], [data-tessvm-project]';
interface Mounted {
  id: string;
  svg: boolean;
  mask: boolean;
  notice: boolean;
  player: MountedPlayer;
}
const players = new Map<HTMLElement, Mounted>();

function scan(): void {
  for (const [host, mounted] of players) {
    const id = host.dataset.tessProject || host.dataset.tessvmProject;
    if (!host.isConnected || mounted.id !== id || mounted.svg !== (host.dataset.tessvmSvg !== '0')) {
      mounted.player.dispose();
      players.delete(host);
    }
  }
  for (const host of document.querySelectorAll<HTMLElement>(HOST_SELECTOR)) {
    const id = host.dataset.tessProject || host.dataset.tessvmProject;
    if (!id) continue;
    const svg = host.dataset.tessvmSvg !== '0';
    const mask = host.dataset.tessvmMask !== '0';
    const notice = host.dataset.tessvmNotice === '1';
    const mounted = players.get(host);
    if (mounted) {
      if (mounted.mask !== mask) mounted.player.setMaskUserId(mask);
      if (mounted.notice !== notice) mounted.player.setShowNotice(notice);
      mounted.mask = mask;
      mounted.notice = notice;
      continue;
    }
    players.set(host, {
      id, svg, mask, notice,
      player: mountPlayer(host, id, host.dataset.tessvmGroup ?? null, svg, mask, notice),
    });
  }
}

const observer = new MutationObserver((records) => {
  const changed = records.some(record => record.type === 'attributes'
    || [...record.addedNodes, ...record.removedNodes].some(node =>
      node instanceof Element && (node.matches(HOST_SELECTOR) || node.querySelector(HOST_SELECTOR))));
  if (changed) scan();
});
observer.observe(document.documentElement, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ['data-tess-project', 'data-tessvm-project', 'data-tessvm-svg', 'data-tessvm-mask', 'data-tessvm-notice'],
});
scan();
