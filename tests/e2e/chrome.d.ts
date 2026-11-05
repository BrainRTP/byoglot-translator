type ChromeTab = { id?: number; url?: string };

// Only what code evaluated inside extension pages and the service worker uses.
declare const chrome: {
  storage: {
    local: {
      get(key: string | string[]): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
    };
  };
  runtime: {
    sendMessage(msg: { type?: string }, callback: (response: unknown) => void): void;
    lastError?: { message: string };
  };
  tabs: {
    query(info: { active?: boolean; lastFocusedWindow?: boolean }): Promise<ChromeTab[]>;
  };
};
