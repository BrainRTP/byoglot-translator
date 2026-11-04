import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { browser } from "wxt/browser";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { type BackgroundDeps, registerBackground } from "../../../lib/background/register";
import { PAGE_PORT_NAME } from "../../../lib/messaging/page-port";
import { removeAllListeners } from "../../../lib/messaging/protocol";
import { tabHostItem } from "../../../lib/settings/store";
import type { EffectiveSettings } from "../../../lib/settings/types";

const EXT_ID = fakeBrowser.runtime.id;

function deps(): BackgroundDeps {
  const backend = {
    info: async () => ({ version: "2.1.0" }),
    listModels: async () => [],
    defaultModel: async () => null,
    generate: async () => "",
  };
  return {
    getBackend: async () => backend,
    createBackend: () => backend,
    pair: async () => ({ url: "http://127.0.0.1:1", username: "opencode", password: "t" }),
    removeOrigin: async () => {},
    cache: {
      getMany: async () => new Map(),
      putMany: async () => {},
      clear: async () => {},
      stats: async () => ({ entries: 0 }),
    },
    service: {
      translatePage: async () => {},
      translateSelection: async () => "x",
    },
  };
}

async function dispatch(type: string, data: unknown, sender: Record<string, unknown>) {
  let response: unknown;
  const listeners = messageListeners;
  expect(listeners.length).toBeGreaterThan(0);
  for (const listener of listeners) {
    const result = await new Promise<unknown>((resolve) => {
      const returned = listener({ id: 1, type, data, timestamp: Date.now() }, sender, resolve);
      if (returned !== true) resolve(undefined);
    });
    if (result !== undefined) response = result;
  }
  return response as { res?: unknown; err?: { message: string } };
}

const extPage = () => ({ id: EXT_ID, url: browser.runtime.getURL("/popup.html") });
const contentScript = () => ({
  id: EXT_ID,
  url: "https://example.com/page",
  frameId: 0,
  tab: { id: 3, url: "https://example.com/page" },
});
const childFrame = () => ({
  ...contentScript(),
  url: "https://ads.other.net/frame",
  frameId: 7,
});

let messageListeners: ((...args: unknown[]) => unknown)[] = [];
let connectListeners: ((port: unknown) => void)[] = [];

describe("registerBackground", () => {
  beforeEach(() => {
    fakeBrowser.reset();
    removeAllListeners();
    connectListeners = [];
    messageListeners = [];
    vi.spyOn(fakeBrowser.runtime.onMessage, "addListener").mockImplementation((cb) => {
      messageListeners.push(cb as (...args: unknown[]) => unknown);
    });
    vi.spyOn(fakeBrowser.runtime.onConnect, "addListener").mockImplementation((cb) => {
      connectListeners.push(cb as (port: unknown) => void);
    });
    vi.spyOn(fakeBrowser.commands.onCommand, "addListener").mockImplementation(() => {});
    vi.spyOn(fakeBrowser.contextMenus.onClicked, "addListener").mockImplementation(() => {});
    registerBackground(deps());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects a message from another extension id", async () => {
    const res = await dispatch("status", undefined, { ...extPage(), id: "other" });
    expect(res.err?.message).toMatch(/Rejected sender/);
  });

  it("rejects connection-level messages from a content script", async () => {
    for (const type of [
      "status",
      "connectManual",
      "pair",
      "setGlobals",
      "cacheClear",
      "connections",
      "saveProvider",
      "activateConnection",
      "removeConnection",
    ]) {
      const res = await dispatch(type, undefined, contentScript());
      expect(res.err?.message, type).toMatch(/not allowed/);
    }
  });

  it("keeps language profile messages away from content scripts", async () => {
    for (const [type, data] of [
      ["languageProfiles", undefined],
      ["languageProfileOp", { type: "reset", id: "ru" }],
    ] as const) {
      const res = await dispatch(type, data, contentScript());
      expect(res.err?.message, type).toMatch(/not allowed/);
    }
  });

  it("serves language profiles to an extension page", async () => {
    const list = await dispatch("languageProfiles", undefined, extPage());
    expect(list.err).toBeUndefined();
    expect((list.res as { id: string }[]).at(-1)?.id).toBe("generic");
    const next = await dispatch(
      "languageProfileOp",
      { type: "save", id: "ru", text: "x" },
      extPage(),
    );
    expect(next.err).toBeUndefined();
    expect(
      (next.res as { id: string; modified: boolean }[]).find((p) => p.id === "ru")?.modified,
    ).toBe(true);
  });

  it("lets a content script call tabView and templates", async () => {
    const view = await dispatch("tabView", { tabId: 3, hostname: "example.com" }, contentScript());
    expect(view.err).toBeUndefined();
    expect((view.res as { template: { id: string } }).template.id).toBe("builtin-default");
    const templates = await dispatch("templates", undefined, contentScript());
    expect(templates.err).toBeUndefined();
  });

  it("lets a content script open the options page", async () => {
    const spy = vi.spyOn(fakeBrowser.runtime, "openOptionsPage").mockResolvedValue(undefined);
    const res = await dispatch("openOptions", undefined, contentScript());
    expect(res.err).toBeUndefined();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("gives a content script its own tab's settings and ignores the tabId it passes", async () => {
    const own = await dispatch("tabView", { tabId: 3, hostname: "example.com" }, contentScript());
    const base = (own.res as { settings: EffectiveSettings }).settings;
    await dispatch(
      "setTabSettings",
      { tabId: 3, settings: { ...base, targetLang: "fr" } },
      extPage(),
    );
    await dispatch(
      "setTabSettings",
      { tabId: 4, settings: { ...base, targetLang: "de" } },
      extPage(),
    );

    const view = await dispatch("tabView", { tabId: 4, hostname: "example.com" }, contentScript());
    expect((view.res as { settings: EffectiveSettings }).settings.targetLang).toBe("fr");
    const popup = await dispatch("tabView", { tabId: 4, hostname: "example.com" }, extPage());
    expect((popup.res as { settings: EffectiveSettings }).settings.targetLang).toBe("de");
  });

  it("takes the hostname from the sender tab when the content script omits it", async () => {
    const rules = await dispatch(
      "ruleOp",
      { type: "upsert", rule: { id: "r1", pattern: "example.com", templateId: "builtin-default" } },
      extPage(),
    );
    expect(rules.err).toBeUndefined();
    const view = await dispatch("tabView", { tabId: -1 }, contentScript());
    expect((view.res as { rule?: { id: string } }).rule?.id).toBe("r1");
  });

  it("remembers the host only for top-frame content senders", async () => {
    await dispatch("tabView", {}, contentScript());
    expect(await tabHostItem(3).getValue()).toBe("example.com");

    const res = await dispatch("tabView", { hostname: "ads.other.net" }, childFrame());
    expect(res.err).toBeUndefined();
    expect(await tabHostItem(3).getValue()).toBe("example.com");
  });

  it("lets a top-frame content script set the page badge and cancel a selection", async () => {
    const spy = vi.spyOn(fakeBrowser.action, "setBadgeText");
    const badge = await dispatch("pageBadge", "translating", contentScript());
    expect(badge.err).toBeUndefined();
    expect(spy).toHaveBeenCalledWith({ tabId: 3, text: "..." });
    const cancel = await dispatch("cancelSelection", "r1", contentScript());
    expect(cancel.err).toBeUndefined();
  });

  it("does not let a child frame change the page badge", async () => {
    const spy = vi.spyOn(fakeBrowser.action, "setBadgeText");
    const res = await dispatch("pageBadge", "translating", childFrame());
    expect(res.err).toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
  });

  it("allows an extension page sender", async () => {
    const res = await dispatch("status", undefined, extPage());
    expect(res.err).toBeUndefined();
    expect(res.res).toEqual({ state: "disconnected" });
  });

  it("allows an extension page opened in a tab", async () => {
    const res = await dispatch("status", undefined, {
      ...extPage(),
      tab: { id: 9, url: browser.runtime.getURL("/popup.html") },
    });
    expect(res.err).toBeUndefined();
  });

  function connect(name: string, senderId: string) {
    const port = {
      name,
      sender: { id: senderId, tab: { id: 3, url: "https://example.com/" } },
      disconnect: vi.fn(),
      postMessage: vi.fn(),
      onMessage: { addListener: vi.fn() },
      onDisconnect: { addListener: vi.fn() },
    };
    for (const listener of connectListeners) listener(port);
    return port;
  }

  it("ignores ports with another name", () => {
    const port = connect("something-else", EXT_ID);
    expect(port.disconnect).not.toHaveBeenCalled();
    expect(port.onMessage.addListener).not.toHaveBeenCalled();
  });

  it("disconnects a page port from a foreign id", () => {
    const port = connect(PAGE_PORT_NAME, "other");
    expect(port.disconnect).toHaveBeenCalled();
    expect(port.onMessage.addListener).not.toHaveBeenCalled();
  });

  it("attaches a page port from our own content script", () => {
    const port = connect(PAGE_PORT_NAME, EXT_ID);
    expect(port.disconnect).not.toHaveBeenCalled();
    expect(port.onMessage.addListener).toHaveBeenCalled();
  });
});
