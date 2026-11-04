import type { TranslationCache } from "../cache/cache";
import type { ConnectionRecord } from "../connections/types";
import { BackendError } from "../opencode/errors";
import type { TranslationBackend } from "../opencode/types";
import { connectionsStore } from "../settings/store";

function fingerprint(rec: ConnectionRecord): string {
  const { pageModel: _page, selectionModel: _selection, ...rest } = rec;
  return JSON.stringify(rest);
}

export function createBackendProvider(
  create: (rec: ConnectionRecord) => TranslationBackend,
): () => Promise<TranslationBackend> {
  let cached: { key: string; backend: TranslationBackend } | null = null;
  return async () => {
    const rec = await connectionsStore.getActive();
    if (!rec) {
      cached = null;
      throw new BackendError("unauthorized");
    }
    const key = fingerprint(rec);
    if (cached?.key !== key) cached = { key, backend: create(rec) };
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
