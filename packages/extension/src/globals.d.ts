/**
 * @fileoverview The slice of the extension API this code calls.
 *
 * Declared here rather than pulled in as a dependency: the extension uses a
 * handful of calls, and both chrome and firefox answer all of them with
 * promises.
 */

declare namespace chrome {
  namespace storage {
    interface StorageArea {
      get(keys?: string | string[] | null): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
      remove(keys: string | string[]): Promise<void>;
    }
    interface StorageChange {
      oldValue?: unknown;
      newValue?: unknown;
    }
    const local: StorageArea;
    const sync: StorageArea;
    const onChanged: {
      addListener(
        listener: (changes: Record<string, StorageChange>, areaName: string) => void,
      ): void;
    };
  }

  namespace runtime {
    const id: string;
    const lastError: { message?: string } | undefined;
    function getURL(path: string): string;
    function sendMessage(message: unknown): Promise<unknown>;
    const onMessage: {
      addListener(
        listener: (
          message: unknown,
          sender: { tab?: { id?: number } },
          sendResponse: (response?: unknown) => void,
        ) => boolean | void,
      ): void;
    };
    const onInstalled: {
      addListener(listener: (details: { reason: string }) => void): void;
    };
    const onStartup: {
      addListener(listener: () => void): void;
    };
  }

  namespace action {
    function setBadgeText(details: { text: string; tabId?: number }): Promise<void> | void;
    function setBadgeBackgroundColor(
      details: { color: string; tabId?: number },
    ): Promise<void> | void;
    function setTitle(details: { title: string; tabId?: number }): Promise<void> | void;
  }

  namespace tabs {
    function query(query: Record<string, unknown>): Promise<Array<{ id?: number; url?: string }>>;
    function reload(tabId: number): Promise<void>;
    function sendMessage(tabId: number, message: unknown): Promise<unknown>;
  }

  namespace declarativeNetRequest {
    function updateEnabledRulesets(
      options: { enableRulesetIds?: string[]; disableRulesetIds?: string[] },
    ): Promise<void>;
    function getEnabledRulesets(): Promise<string[]>;
  }
}
