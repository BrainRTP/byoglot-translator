import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { browser } from "wxt/browser";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { createBackendProvider, withConnectionPolicy } from "../../../lib/background/connection";
import {
  isLanOrigin,
  isLocalOrigin,
  normalizeBaseUrl,
  originPattern,
} from "../../../lib/connections/list";
import type { ConnectionRecord } from "../../../lib/connections/types";
import { createProviderBackend } from "../../../lib/provider/backend";
import { needsKey } from "../../../lib/provider/presets";
import { connectionsStore } from "../../../lib/settings/store";
import { validProviderUrl } from "../../../lib/ui/connection-logic";
import { requestOrigin } from "../../../lib/ui/host-permission";

const provider = {
  kind: "provider" as const,
  id: "saved",
  preset: "ollama" as const,
  name: "Ollama",
  baseUrl: "http://192.168.1.5/v1",
  apiKey: "",
  pageModel: null,
  selectionModel: null,
};

describe("host and key policy", () => {
  beforeEach(() => {
    fakeBrowser.reset();
    vi.spyOn(fakeBrowser.runtime, "getPlatformInfo").mockResolvedValue({ os: "mac" } as never);
  });
  afterEach(() => vi.restoreAllMocks());

  it.each(["localhost", "127.0.0.1", "127.42.1.2", "127.255.255.255", "[::1]"])(
    "%s is loopback and needs no local preset key",
    (host) => {
      const url = `http://${host}/v1`;
      expect(isLocalOrigin(url)).toBe(true);
      expect(isLanOrigin(url)).toBe(false);
      for (const preset of ["ollama", "lmstudio", "custom"] as const)
        expect(needsKey(preset, url)).toBe(false);
    },
  );

  it.each([
    "10.0.0.1",
    "10.255.255.255",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.5",
    "169.254.1.5",
    "model.local",
    "[fc00::1]",
    "[fdff::1]",
    "[fe80::1]",
    "[febf::1]",
  ])("%s is LAN, with a key required for custom only", (host) => {
    const url = `http://${host}/v1`;
    expect(isLocalOrigin(url)).toBe(false);
    expect(isLanOrigin(url)).toBe(true);
    expect(needsKey("ollama", url)).toBe(false);
    expect(needsKey("lmstudio", url)).toBe(false);
    expect(needsKey("custom", url)).toBe(true);
    expect(needsKey("openai", url)).toBe(true);
  });

  it.each([
    "external.example",
    "localhost.example",
    "127.example",
    "127.0.0.1.example",
    "126.255.255.255",
    "128.0.0.1",
    "172.15.255.255",
    "172.32.0.1",
    "169.255.0.1",
    "local",
    "10.example",
    "[fbff::1]",
    "[fe7f::1]",
    "[fec0::1]",
    "[2001:db8::1]",
    "010.1.2.3",
    "172.016.0.1",
    "012.1.2.3",
    "0x7f.0.0.1",
    "2130706433",
    "127.1",
  ])("%s is external and requires a key", (host) => {
    const url = `https://${host}/v1`;
    expect(isLocalOrigin(url)).toBe(false);
    expect(isLanOrigin(url)).toBe(false);
    expect(needsKey("ollama", url)).toBe(true);
    expect(needsKey("lmstudio", url)).toBe(true);
  });

  it.each(["010.1.2.3", "172.016.0.1", "012.1.2.3", "0x7f.0.0.1", "2130706433", "127.1"])(
    "%s stays external after saving and requires HTTPS",
    (host) => {
      const saved = normalizeBaseUrl(`https://user:secret@${host}/v1/?query=1#fragment`);
      expect(saved).toBe(`https://${host}/v1`);
      expect(needsKey("ollama", saved)).toBe(true);
      expect(needsKey("custom", saved)).toBe(true);
      expect(validProviderUrl(`http://${host}/v1`)).toBe(false);
      expect(validProviderUrl(saved)).toBe(true);
    },
  );

  it("does not send any backend request to LAN before permission, then honors revocation", async () => {
    const contains = vi
      .spyOn(browser.permissions, "contains")
      .mockImplementation(async () => false);
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ data: [] })));
    const backend = withConnectionPolicy(provider, createProviderBackend(provider, fetchImpl));
    const model = { providerID: "ollama", id: "model" };
    for (const run of [
      () => backend.info(),
      () => backend.listModels(),
      () => backend.defaultModel(),
      () => backend.generate("private text", model),
      () => backend.generateWithMetadata?.("private text", model),
    ]) {
      await expect(run()).rejects.toMatchObject({ kind: "permission_required" });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(contains).toHaveBeenCalledWith({ origins: [originPattern(provider.baseUrl)] });
    contains.mockImplementation(async () => true);
    await backend.listModels();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    contains.mockImplementation(async () => false);
    await expect(backend.listModels()).rejects.toMatchObject({ kind: "permission_required" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each(["localhost", "127.42.1.2", "[::1]"])("%s models bypass consent", async (host) => {
    const contains = vi
      .spyOn(browser.permissions, "contains")
      .mockImplementation(async () => false);
    const rec = { ...provider, baseUrl: `http://${host}/v1` };
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ data: [] })));
    await withConnectionPolicy(rec, createProviderBackend(rec, fetchImpl)).listModels();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(contains).not.toHaveBeenCalled();
  });

  it("keeps a saved external keyless connection but refuses its requests", async () => {
    const rec = { ...provider, baseUrl: "https://external.example/v1" };
    await connectionsStore.setAll([rec]);
    await connectionsStore.setActiveId(rec.id);
    const fetchImpl = vi.fn(async () => new Response());
    const getBackend = createBackendProvider((record: ConnectionRecord) => {
      if (record.kind !== "provider") throw new Error("provider expected");
      return withConnectionPolicy(record, createProviderBackend(record, fetchImpl));
    });
    await expect((await getBackend()).listModels()).rejects.toMatchObject({
      kind: "missing_key",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await connectionsStore.getAll()).toEqual([rec]);
  });

  it("blocks Android LAN HTTP before sending even with permission and a key", async () => {
    vi.mocked(fakeBrowser.runtime.getPlatformInfo).mockResolvedValue({ os: "android" } as never);
    vi.spyOn(browser.permissions, "contains").mockImplementation(async () => true);
    const rec = { ...provider, apiKey: "key" };
    const fetchImpl = vi.fn(async () => new Response());
    await expect(
      withConnectionPolicy(rec, createProviderBackend(rec, fetchImpl)).listModels(),
    ).rejects.toMatchObject({ kind: "https_required" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("blocks LAN HTTP when the platform cannot be determined", async () => {
    vi.mocked(fakeBrowser.runtime.getPlatformInfo).mockRejectedValue(new Error("unavailable"));
    const fetchImpl = vi.fn(async () => new Response());
    await expect(
      withConnectionPolicy(provider, createProviderBackend(provider, fetchImpl)).listModels(),
    ).rejects.toMatchObject({ kind: "https_required" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("requests browser permission for LAN in the existing consent flow", async () => {
    const request = vi.spyOn(browser.permissions, "request").mockImplementation(async () => true);
    expect(await requestOrigin(provider.baseUrl)).toBe(true);
    expect(request).toHaveBeenCalledWith({ origins: ["http://192.168.1.5/*"] });
  });
});
