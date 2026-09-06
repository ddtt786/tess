/**
 * @fileoverview Settings defaults, the toolbar badge, and the CSP ruleset.
 *
 * The CSP ruleset is off unless the user asks for it: dropping a site's
 * content security policy is a real change to that site, and most pages let the
 * JIT compile without it.
 */
import { api, readSettings, onSettingsChanged, writeSettings } from './common/browser.ts';
import { DEFAULT_SETTINGS, STORAGE_KEY } from './common/settings.ts';
import type { Settings } from './common/settings.ts';
import type { RunnerStatus } from './common/protocol.ts';

const CSP_RULESET = 'relax-csp';

async function applyCspRuleset(relax: boolean): Promise<void> {
  try {
    await api.declarativeNetRequest.updateEnabledRulesets(
      relax ? { enableRulesetIds: [CSP_RULESET] } : { disableRulesetIds: [CSP_RULESET] },
    );
  } catch {
    // Older firefox builds have no header rules; the popup says as much.
  }
}

function paintBadge(settings: Settings, status?: RunnerStatus, tabId?: number): void {
  const text = settings.enabled ? (status?.active ? '▶' : 'on') : '';
  const color = status?.error ? '#f87171' : status?.active ? '#22c55e' : '#64748b';
  try {
    void api.action.setBadgeText(tabId === undefined ? { text } : { text, tabId });
    void api.action.setBadgeBackgroundColor(tabId === undefined ? { color } : { color, tabId });
    const title = settings.enabled
      ? `tessvm: ${status?.detail ?? '켜짐'}`
      : 'tessvm: 꺼짐 (엔트리 실행기 사용)';
    void api.action.setTitle(tabId === undefined ? { title } : { title, tabId });
  } catch {
    // A badge is not worth failing a startup over.
  }
}

async function refresh(): Promise<void> {
  const settings = await readSettings();
  await applyCspRuleset(settings.relaxCsp);
  paintBadge(settings);
}

api.runtime.onInstalled.addListener(() => {
  void (async () => {
    const stored = await api.storage.local.get(STORAGE_KEY);
    if (stored?.[STORAGE_KEY] === undefined) await writeSettings({ ...DEFAULT_SETTINGS });
    await refresh();
  })();
});

api.runtime.onStartup.addListener(() => {
  void refresh();
});

onSettingsChanged((settings) => {
  void applyCspRuleset(settings.relaxCsp);
  paintBadge(settings);
});

api.runtime.onMessage.addListener((message, sender) => {
  const payload = message as { type?: string; status?: RunnerStatus } | null;
  if (payload?.type !== 'tessvm-status' || !payload.status) return;
  void readSettings().then((settings) => paintBadge(settings, payload.status, sender.tab?.id));
});

void refresh();
