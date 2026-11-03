import type { TranslationCache } from "../cache/cache";
import { BackendError } from "../opencode/errors";
import type { Connection, TranslationBackend } from "../opencode/types";
import { connectionItem } from "../settings/store";

function sameConnection(a: Connection, b: Connection): boolean {
  return a.url === b.url && a.username === b.username && a.password === b.password;
}

export function createBackendProvider(
  create: (conn: Connection) => TranslationBackend,
): () => Promise<TranslationBackend> {
  let cached: { conn: Connection; backend: TranslationBackend } | null = null;
  return async () => {
    const conn = await connectionItem.getValue();
    if (!conn) {
      cached = null;
      throw new BackendError("unauthorized");
    }
    if (!cached || !sameConnection(cached.conn, conn)) {
      cached = { conn, backend: create(conn) };
    }
    return cached.backend;
  };
}

export function lazyCache(open: () => Promise<TranslationCache>): TranslationCache {
  let opened: Promise<TranslationCache> | null = null;
  const get = () => {
    opened ??= open().catch((error) => {
      opened = null;
      throw error;
    });
    return opened;
  };
  return {
    async getMany(keys) {
      return (await get()).getMany(keys);
    },
    async putMany(entries) {
      return (await get()).putMany(entries);
    },
    async clear() {
      return (await get()).clear();
    },
    async stats() {
      return (await get()).stats();
    },
  };
}
