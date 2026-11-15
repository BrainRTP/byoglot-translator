import type { TranslationCache } from "../cache/cache";
import { isLanOrigin, isLocalOrigin } from "../connections/list";
import type { ConnectionRecord } from "../connections/types";
import { BackendError } from "../opencode/errors";
import type { TranslationBackend } from "../opencode/types";
import { needsKey } from "../provider/presets";
import { connectionsStore } from "../settings/store";
import { requireOriginAccess } from "../ui/host-permission";

export function withConnectionPolicy(
  rec: ConnectionRecord,
  backend: TranslationBackend,
): TranslationBackend {
  async function call<T>(run: () => Promise<T>): Promise<T> {
    const url = rec.kind === "provider" ? rec.baseUrl : rec.url;
    if (rec.kind === "provider") {
      if (!rec.apiKey.trim() && needsKey(rec.preset, url)) throw new BackendError("provider_auth");
    } else if (!rec.password.trim() && !isLocalOrigin(url) && !isLanOrigin(url)) {
      throw new BackendError("unauthorized");
    }
    await requireOriginAccess(url);
    return run();
  }
  return {
    info: (signal) => call(() => backend.info(signal)),
    listModels: (signal) => call(() => backend.listModels(signal)),
    defaultModel: (signal) => call(() => backend.defaultModel(signal)),
    generate: (prompt, model, signal) => call(() => backend.generate(prompt, model, signal)),
    generateWithMetadata: (prompt, model, signal) =>
      call(async () =>
        backend.generateWithMetadata
          ? backend.generateWithMetadata(prompt, model, signal)
          : { text: await backend.generate(prompt, model, signal) },
      ),
  };
}

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
