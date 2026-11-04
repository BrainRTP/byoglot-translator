import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { createBackendProvider } from "../../../lib/background/connection";
import type { ConnectionRecord } from "../../../lib/connections/types";
import type { TranslationBackend } from "../../../lib/opencode/types";
import { connectionsStore } from "../../../lib/settings/store";

function fakeBackend(): TranslationBackend {
  return {
    info: async () => ({ version: "1" }),
    listModels: async () => [],
    defaultModel: async () => null,
    generate: async () => "",
  };
}

const opencode: ConnectionRecord = {
  kind: "opencode",
  id: "a",
  url: "http://127.0.0.1:4096",
  username: "opencode",
  password: "tok",
  pageModel: null,
  selectionModel: null,
};

const provider: ConnectionRecord = {
  kind: "provider",
  id: "b",
  preset: "deepseek",
  name: "DeepSeek",
  baseUrl: "https://api.deepseek.com",
  apiKey: "k",
  pageModel: null,
  selectionModel: null,
};

async function activate(list: ConnectionRecord[], id: string | null) {
  await connectionsStore.setAll(list);
  await connectionsStore.setActiveId(id);
}

describe("createBackendProvider", () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it("throws unauthorized without an active connection", async () => {
    const get = createBackendProvider(() => fakeBackend());
    await expect(get()).rejects.toMatchObject({ kind: "unauthorized" });
    await activate([opencode], null);
    await expect(get()).rejects.toMatchObject({ kind: "unauthorized" });
  });

  it("caches per connection and recreates when its data changes", async () => {
    const create = vi.fn(() => fakeBackend());
    const get = createBackendProvider(create);
    await activate([opencode], "a");
    const first = await get();
    expect(await get()).toBe(first);
    expect(create).toHaveBeenCalledTimes(1);

    await activate([{ ...opencode, password: "other" }], "a");
    const second = await get();
    expect(second).not.toBe(first);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("keeps the backend when only the stored models change", async () => {
    const create = vi.fn(() => fakeBackend());
    const get = createBackendProvider(create);
    await activate([provider], "b");
    const first = await get();
    await activate(
      [{ ...provider, pageModel: { providerID: "p", id: "m", connectionId: "b" } }],
      "b",
    );
    expect(await get()).toBe(first);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("creates a new backend when the active connection switches", async () => {
    const create = vi.fn((rec: ConnectionRecord) => ({ ...fakeBackend(), rec }));
    const get = createBackendProvider(create);
    await activate([opencode, provider], "a");
    await get();
    await connectionsStore.setActiveId("b");
    await get();
    expect(create.mock.calls.map(([rec]) => rec.kind)).toEqual(["opencode", "provider"]);
  });
});
