import { type DBSchema, type IDBPDatabase, openDB } from "idb";
import type { ModelRef } from "../opencode/types";

interface Entry {
  key: string;
  value: string;
  at: number;
}

interface CacheDB extends DBSchema {
  entries: { key: string; value: Entry; indexes: { at: number } };
}

export interface TranslationCache {
  getMany(keys: string[]): Promise<Map<string, string>>;
  putMany(entries: [key: string, value: string][]): Promise<void>;
  clear(): Promise<void>;
  stats(): Promise<{ entries: number }>;
}

export async function cacheKey(i: {
  text: string;
  sourceLang: string;
  targetLang: string;
  model: ModelRef;
  prePrompt: string;
}): Promise<string> {
  const data = JSON.stringify([
    i.text,
    i.sourceLang,
    i.targetLang,
    i.model.providerID,
    i.model.id,
    i.model.variant ?? "",
    i.prePrompt,
  ]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function openTranslationCache(
  opts: { maxEntries?: number; dbName?: string } = {},
): Promise<TranslationCache> {
  const maxEntries = opts.maxEntries ?? 50000;
  const db: IDBPDatabase<CacheDB> = await openDB<CacheDB>(opts.dbName ?? "oct-cache", 1, {
    upgrade(d) {
      const store = d.createObjectStore("entries", { keyPath: "key" });
      store.createIndex("at", "at");
    },
  });

  // Strictly increasing so same-millisecond writes keep their order.
  let last = 0;
  const tick = () => {
    last = Math.max(Date.now(), last + 1);
    return last;
  };

  return {
    async getMany(keys) {
      const result = new Map<string, string>();
      if (keys.length === 0) return result;
      const tx = db.transaction("entries", "readwrite");
      const found = await Promise.all(keys.map((k) => tx.store.get(k)));
      for (const entry of found) {
        if (!entry) continue;
        result.set(entry.key, entry.value);
        tx.store.put({ ...entry, at: tick() });
      }
      await tx.done;
      return result;
    },

    async putMany(entries) {
      if (entries.length === 0) return;
      const tx = db.transaction("entries", "readwrite");
      for (const [key, value] of entries) tx.store.put({ key, value, at: tick() });
      let excess = (await tx.store.count()) - maxEntries;
      if (excess > 0) {
        let cursor = await tx.store.index("at").openCursor();
        while (cursor && excess > 0) {
          await cursor.delete();
          excess--;
          cursor = await cursor.continue();
        }
      }
      await tx.done;
    },

    async clear() {
      await db.clear("entries");
    },

    async stats() {
      return { entries: await db.count("entries") };
    },
  };
}
