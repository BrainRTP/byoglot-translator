import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cacheKey, openTranslationCache } from "../../../lib/cache/cache";

const model = { providerID: "anthropic", id: "claude-haiku" };
const base = {
  text: "Hello",
  sourceLang: "auto",
  targetLang: "ru",
  model,
  prePrompt: "",
  languagePrompt: "",
};

let n = 0;
const open = (maxEntries?: number) => openTranslationCache({ dbName: `test-${n++}`, maxEntries });

afterEach(() => {
  vi.useRealTimers();
});

describe("cacheKey", () => {
  it("is stable for the same input and a 64-char hex string", async () => {
    const a = await cacheKey(base);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await cacheKey({ ...base })).toBe(a);
  });

  it("differs when the model variant differs", async () => {
    const a = await cacheKey(base);
    const b = await cacheKey({ ...base, model: { ...model, variant: "high" } });
    expect(b).not.toBe(a);
  });

  it("differs by text, source language, target language and pre-prompt", async () => {
    const a = await cacheKey(base);
    expect(await cacheKey({ ...base, text: "Hello!" })).not.toBe(a);
    expect(await cacheKey({ ...base, sourceLang: "en" })).not.toBe(a);
    expect(await cacheKey({ ...base, targetLang: "de" })).not.toBe(a);
    expect(await cacheKey({ ...base, prePrompt: "explain" })).not.toBe(a);
  });
});

describe("cacheKey language prompt", () => {
  const sha256 = async (data: string) => {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  };

  it("keeps the 7-field key when the language prompt is empty", async () => {
    const legacy = await sha256(
      JSON.stringify(["Hello", "auto", "ru", "anthropic", "claude-haiku", "", ""]),
    );
    expect(await cacheKey(base)).toBe(legacy);
  });

  it("differs for different language prompts", async () => {
    const a = await cacheKey({ ...base, languagePrompt: "a" });
    const b = await cacheKey({ ...base, languagePrompt: "b" });
    expect(a).not.toBe(b);
    expect(a).not.toBe(await cacheKey(base));
  });

  it("ignores surrounding whitespace in the language prompt", async () => {
    expect(await cacheKey({ ...base, languagePrompt: " a " })).toBe(
      await cacheKey({ ...base, languagePrompt: "a" }),
    );
  });

  it("treats a whitespace-only language prompt as empty", async () => {
    expect(await cacheKey({ ...base, languagePrompt: "   " })).toBe(await cacheKey(base));
  });
});

describe("translation cache", () => {
  it("returns stored values and omits unknown keys", async () => {
    const cache = await open();
    await cache.putMany([
      ["a", "A"],
      ["b", "B"],
    ]);
    const got = await cache.getMany(["a", "b", "zzz"]);
    expect(got.get("a")).toBe("A");
    expect(got.get("b")).toBe("B");
    expect(got.has("zzz")).toBe(false);
    expect(got.size).toBe(2);
  });

  it("treats empty getMany and putMany as no-ops", async () => {
    const cache = await open();
    await cache.putMany([]);
    expect((await cache.getMany([])).size).toBe(0);
    expect(await cache.stats()).toEqual({ entries: 0 });
  });

  it("keeps the last value for duplicate keys in one putMany", async () => {
    const cache = await open();
    await cache.putMany([
      ["a", "first"],
      ["a", "second"],
    ]);
    expect((await cache.getMany(["a"])).get("a")).toBe("second");
    expect((await cache.stats()).entries).toBe(1);
  });

  it("evicts the oldest entries beyond maxEntries", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_000);
    const cache = await open(3);
    for (const k of ["1", "2", "3", "4", "5"]) await cache.putMany([[k, `v${k}`]]);
    expect((await cache.stats()).entries).toBe(3);
    const got = await cache.getMany(["1", "2", "3", "4", "5"]);
    expect([...got.keys()].sort()).toEqual(["3", "4", "5"]);
  });

  it("evicts oldest within a single large putMany", async () => {
    const cache = await open(2);
    await cache.putMany([
      ["1", "a"],
      ["2", "b"],
      ["3", "c"],
    ]);
    const got = await cache.getMany(["1", "2", "3"]);
    expect([...got.keys()].sort()).toEqual(["2", "3"]);
  });

  it("refreshes recency on getMany hits", async () => {
    const cache = await open(3);
    await cache.putMany([
      ["1", "a"],
      ["2", "b"],
      ["3", "c"],
    ]);
    await cache.getMany(["1"]);
    await cache.putMany([["4", "d"]]);
    const got = await cache.getMany(["1", "2", "3", "4"]);
    expect([...got.keys()].sort()).toEqual(["1", "3", "4"]);
  });

  it("clear empties the cache", async () => {
    const cache = await open();
    await cache.putMany([["a", "A"]]);
    await cache.clear();
    expect(await cache.stats()).toEqual({ entries: 0 });
    expect((await cache.getMany(["a"])).size).toBe(0);
  });
});
