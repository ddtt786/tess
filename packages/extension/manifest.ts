/**
 * @fileoverview The manifest, written for both browsers from one description.
 *
 * Chrome runs the worker as a service worker and firefox as an event page;
 * everything else the two ask for is the same, so only that part and the gecko
 * id differ.
 */

export const NAME = 'tessvm — 엔트리 작품 실행기 바꾸기';
export const VERSION = '0.1.0';
export const DESCRIPTION =
  'playentry.org 에서 작품을 실행할 때 엔트리 실행기 대신 tessvm 으로 돌립니다. '
  + '작품을 Tess 로 컴파일해 실행하고, $tessvm 변수가 있으면 1 로 둡니다.';

export const MATCHES = ['https://playentry.org/*', 'https://*.playentry.org/*'];

export const CSP_RULESET_ID = 'relax-csp';

/** Removes playentry.org's CSP so the page allows the JIT to compile. */
export const CSP_RULES = [
  {
    id: 1,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      responseHeaders: [
        { header: 'content-security-policy', operation: 'remove' },
        { header: 'content-security-policy-report-only', operation: 'remove' },
      ],
    },
    condition: {
      requestDomains: ['playentry.org'],
      resourceTypes: ['main_frame', 'sub_frame'],
    },
  },
];

const ICONS = {
  16: 'icons/icon-16.png',
  32: 'icons/icon-32.png',
  48: 'icons/icon-48.png',
  128: 'icons/icon-128.png',
};

function base(): Record<string, unknown> {
  return {
    manifest_version: 3,
    name: NAME,
    version: VERSION,
    description: DESCRIPTION,
    icons: ICONS,
    permissions: ['storage', 'declarativeNetRequestWithHostAccess'],
    host_permissions: MATCHES,
    action: {
      default_popup: 'popup.html',
      default_icon: ICONS,
      default_title: 'tessvm 실행기',
    },
    content_scripts: [
      {
        matches: MATCHES,
        js: ['content.js'],
        run_at: 'document_start',
        // The play page embeds the stage in a frame of its own in some views;
        // the runner only acts where it finds entry, so every frame is watched.
        all_frames: true,
      },
    ],
    web_accessible_resources: [{ resources: ['page.js'], matches: MATCHES }],
    declarative_net_request: {
      rule_resources: [
        { id: CSP_RULESET_ID, enabled: false, path: 'rules/relax-csp.json' },
      ],
    },
  };
}

export function manifestFor(target: 'chrome' | 'firefox'): Record<string, unknown> {
  const manifest = base();
  if (target === 'chrome') {
    manifest.background = { service_worker: 'background.js' };
    manifest.minimum_chrome_version = '110';
    return manifest;
  }
  manifest.background = { scripts: ['background.js'] };
  manifest.browser_specific_settings = {
    gecko: { id: 'tessvm@tess.playentry', strict_min_version: '128.0' },
  };
  return manifest;
}
