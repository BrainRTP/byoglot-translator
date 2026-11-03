import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { createBackendProvider } from "../../../lib/background/connection";
import {
  createHandlers,
  type HandlerDeps,
  resolveStoredModel,
} from "../../../lib/background/handlers";
import { BackendError } from "../../../lib/opencode/errors";
import type {
  Connection,
  ModelInfo,
  ModelRef,
  TranslationBackend,
} from "../../../lib/opencode/types";
import { BUILTIN_TEMPLATE_ID, DEFAULT_GLOBALS } from "../../../lib/settings/defaults";
import {
  connectionItem,
  globalsItem,
  siteRulesItem,
  tabHostItem,
  tabSettings,
  templatesItem,
} from "../../../lib/settings/store";
import type { Template } from "../../../lib/settings/types";

const conn: Connection = { url: "http://127.0.0.1:4096", username: "opencode", password: "tok" };

const flash: ModelInfo = {
  providerID: "deepseek",
  id: "deepseek-flash",
  name: "Flash",
  variants: ["none", "high"],
  contextLimit: 1000,
  outputLimit: 100,
};

function fakeBackend(overrides: Partial<TranslationBackend> = {}): TranslationBackend {
  return {
    info: async () => ({ version: "2.1.0" }),
    listModels: async () => [flash],
    defaultModel: async () => flash,
    generate: async () => "",
    ...overrides,
  };
}

function setup(backend: TranslationBackend = fakeBackend(), extra: Partial<HandlerDeps> = {}) {
  const translateSelection = vi.fn(async () => "privet");
  const cache = {
    getMany: async () => new Map<string, string>(),
    putMany: async () => {},
    clear: vi.fn(async () => {}),
    stats: async () => ({ entries: 3 }),
  };
  const deps: HandlerDeps = {
    getBackend: async () => backend,
    createBackend: () => backend,
    pair: async () => conn,
    service: { translateSelection },
    cache,
    ...extra,
  };
  return { handlers: createHandlers(deps), translateSelection, cache };
}

const ruTemplate: Template = {
  id: "ru-wiki",
  name: "Wiki",
  builtin: false,
  settings: { prePrompt: "wiki", targetLang: "de" },
};

describe("background handlers", () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it("tabView picks the site-rule template for the hostname", async () => {
    const { handlers } = setup();
    await templatesItem.setValue([
      { id: BUILTIN_TEMPLATE_ID, name: "b", builtin: true, settings: { prePrompt: "x" } },
      ruTemplate,
    ]);
    await siteRulesItem.setValue([{ id: "r1", pattern: "*.wikipedia.org", templateId: "ru-wiki" }]);

    const view = await handlers.tabView({ tabId: 1, hostname: "ru.wikipedia.org" });
    expect(view.template.id).toBe("ru-wiki");
    expect(view.settings.targetLang).toBe("de");
    expect(view.rule?.id).toBe("r1");
    expect(view.modified).toBe(false);

    const other = await handlers.tabView({ tabId: 2, hostname: "example.com" });
    expect(other.template.id).toBe(BUILTIN_TEMPLATE_ID);
    expect(other.rule).toBeUndefined();
  });

  it("setTabSettings keeps the stored template unchanged and marks the view modified", async () => {
    const { handlers } = setup();
    const before = await handlers.templates();
    const view = await handlers.tabView({ tabId: 1, hostname: "example.com" });
    const changed = { ...view.settings, targetLang: "fr" };

    const next = await handlers.setTabSettings({ tabId: 1, settings: changed });
    expect(next.modified).toBe(true);
    expect(next.settings.targetLang).toBe("fr");
    expect(await handlers.templates()).toEqual(before);
    expect(
      (await handlers.tabView({ tabId: 1, hostname: "example.com" })).settings.targetLang,
    ).toBe("fr");
  });

  it("applyTemplate resets modified to false", async () => {
    const { handlers } = setup();
    const view = await handlers.tabView({ tabId: 1, hostname: "example.com" });
    await handlers.setTabSettings({ tabId: 1, settings: { ...view.settings, prePrompt: "zzz" } });

    const next = await handlers.applyTemplate({
      tabId: 1,
      hostname: "example.com",
      templateId: BUILTIN_TEMPLATE_ID,
    });
    expect(next.modified).toBe(false);
    expect(next.settings.prePrompt).toBe(view.settings.prePrompt);
  });

  it("deleting a rule's template makes tabView fall back to the default template", async () => {
    const { handlers } = setup();
    await handlers.templateOp({ type: "create", name: "Wiki", settings: { prePrompt: "w" } });
    const created = (await handlers.templates()).find((t) => !t.builtin);
    if (!created) throw new Error("template not created");
    await handlers.ruleOp({
      type: "upsert",
      rule: { id: "r1", pattern: "example.com", templateId: created.id },
    });
    expect((await handlers.tabView({ tabId: 1, hostname: "example.com" })).template.id).toBe(
      created.id,
    );

    await handlers.templateOp({ type: "delete", id: created.id });
    expect(await handlers.rules()).toEqual([]);
    const view = await handlers.tabView({ tabId: 2, hostname: "example.com" });
    expect(view.template.id).toBe(BUILTIN_TEMPLATE_ID);
  });

  it("deleting the default template resets defaultTemplateId to the builtin", async () => {
    const { handlers } = setup();
    await handlers.templateOp({ type: "create", name: "Mine", settings: {} });
    const created = (await handlers.templates()).find((t) => !t.builtin);
    if (!created) throw new Error("template not created");
    await handlers.setGlobals({ ...DEFAULT_GLOBALS, defaultTemplateId: created.id });

    await handlers.templateOp({ type: "delete", id: created.id });
    expect((await handlers.globals()).defaultTemplateId).toBe(BUILTIN_TEMPLATE_ID);
    expect((await globalsItem.getValue()).defaultTemplateId).toBe(BUILTIN_TEMPLATE_ID);
  });

  it("supports update, duplicate and resetBuiltin template ops", async () => {
    const { handlers } = setup();
    let list = await handlers.templateOp({
      type: "update",
      id: BUILTIN_TEMPLATE_ID,
      patch: { name: "Renamed" },
    });
    expect(list.find((t) => t.id === BUILTIN_TEMPLATE_ID)?.name).toBe("Renamed");
    list = await handlers.templateOp({ type: "resetBuiltin" });
    expect(list.find((t) => t.id === BUILTIN_TEMPLATE_ID)?.name).toBe("Plain translation");
    list = await handlers.templateOp({ type: "duplicate", id: BUILTIN_TEMPLATE_ID, name: "Copy" });
    expect(list.map((t) => t.name)).toContain("Copy");
  });

  it("rejects invalid rule patterns and replaces rules by id", async () => {
    const { handlers } = setup();
    await expect(
      handlers.ruleOp({
        type: "upsert",
        rule: { id: "r", pattern: "bad pattern", templateId: BUILTIN_TEMPLATE_ID },
      }),
    ).rejects.toThrow();
    await handlers.ruleOp({
      type: "upsert",
      rule: { id: "r", pattern: "a.com", templateId: BUILTIN_TEMPLATE_ID },
    });
    const rules = await handlers.ruleOp({
      type: "upsert",
      rule: { id: "r", pattern: "b.com", templateId: BUILTIN_TEMPLATE_ID },
    });
    expect(rules).toEqual([{ id: "r", pattern: "b.com", templateId: BUILTIN_TEMPLATE_ID }]);
  });

  describe("connection", () => {
    it("pair success stores the connection and initial models when pageModel is null", async () => {
      const { handlers } = setup();
      const status = await handlers.pair("http://127.0.0.1:4096/auth/connect/abc");
      expect(status).toEqual({ state: "connected", url: conn.url, version: "2.1.0" });
      expect(await connectionItem.getValue()).toEqual(conn);
      const g = await globalsItem.getValue();
      expect(g.pageModel).toEqual({
        providerID: "deepseek",
        id: "deepseek-flash",
        variant: "none",
      });
      expect(g.selectionModel).toEqual(g.pageModel);
    });

    it("pair does not overwrite a pageModel set while models were loading", async () => {
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const { handlers } = setup(
        fakeBackend({
          listModels: async () => {
            await gate;
            return [flash];
          },
        }),
      );
      const pending = handlers.pair("http://127.0.0.1:4096/auth/connect/abc");
      await vi.waitFor(async () => expect(await connectionItem.getValue()).toEqual(conn));
      const mine: ModelRef = { providerID: "x", id: "y" };
      await handlers.setGlobals({ ...DEFAULT_GLOBALS, pageModel: mine, targetLang: "de" });
      release();
      await pending;
      const g = await globalsItem.getValue();
      expect(g.pageModel).toEqual(mine);
      expect(g.targetLang).toBe("de");
    });

    it("pair keeps an existing pageModel", async () => {
      const { handlers } = setup();
      const mine: ModelRef = { providerID: "x", id: "y" };
      await globalsItem.setValue({ ...DEFAULT_GLOBALS, pageModel: mine });
      await handlers.pair("http://127.0.0.1:4096/auth/connect/abc");
      expect((await globalsItem.getValue()).pageModel).toEqual(mine);
    });

    it("pair failure returns an error status and stores nothing", async () => {
      const { handlers } = setup(fakeBackend(), {
        pair: async () => {
          throw new BackendError("offline");
        },
      });
      const status = await handlers.pair("http://127.0.0.1:4096/auth/connect/abc");
      expect(status).toMatchObject({
        state: "error",
        kind: "offline",
        url: "http://127.0.0.1:4096",
      });
      expect(await connectionItem.getValue()).toBeNull();
    });

    it("connectManual validates before storing", async () => {
      const failing = fakeBackend({
        info: async () => {
          throw new BackendError("unauthorized");
        },
      });
      const bad = setup(failing);
      expect(await bad.handlers.connectManual(conn)).toMatchObject({
        state: "error",
        kind: "unauthorized",
      });
      expect(await connectionItem.getValue()).toBeNull();

      const good = setup();
      expect((await good.handlers.connectManual(conn)).state).toBe("connected");
      expect(await connectionItem.getValue()).toEqual(conn);
    });

    it("status reports disconnected, connected and mapped errors", async () => {
      const { handlers } = setup();
      expect(await handlers.status()).toEqual({ state: "disconnected" });
      await connectionItem.setValue(conn);
      expect(await handlers.status()).toEqual({
        state: "connected",
        url: conn.url,
        version: "2.1.0",
      });
    });

    it("status maps an unauthorized backend error", async () => {
      const { handlers } = setup(
        fakeBackend({
          info: async () => {
            throw new BackendError("unauthorized");
          },
        }),
      );
      await connectionItem.setValue(conn);
      expect(await handlers.status()).toEqual({
        state: "error",
        url: conn.url,
        kind: "unauthorized",
        retryAfterMs: undefined,
      });
    });

    it("disconnect clears the connection", async () => {
      const { handlers } = setup();
      await connectionItem.setValue(conn);
      await handlers.disconnect();
      expect(await connectionItem.getValue()).toBeNull();
    });
  });

  describe("model resolution", () => {
    const models = [flash];

    it("keeps a valid variant", () => {
      const ref = { providerID: "deepseek", id: "deepseek-flash", variant: "high" };
      expect(resolveStoredModel(ref, models, null)).toEqual({ model: ref, missing: false });
    });

    it("drops an unknown variant and flags it missing", () => {
      const ref = { providerID: "deepseek", id: "deepseek-flash", variant: "ultra" };
      expect(resolveStoredModel(ref, models, null)).toEqual({
        model: { providerID: "deepseek", id: "deepseek-flash", variant: undefined },
        missing: true,
      });
    });

    it("falls back to the global model when the model is gone", () => {
      const fallback = { providerID: "deepseek", id: "deepseek-flash" };
      expect(resolveStoredModel({ providerID: "a", id: "b" }, models, fallback)).toEqual({
        model: fallback,
        missing: true,
      });
    });

    it("does not flag anything when the model list is unavailable", () => {
      const ref = { providerID: "a", id: "b", variant: "v" };
      expect(resolveStoredModel(ref, null, null)).toEqual({ model: ref, missing: false });
    });

    it("tabView flags a stale variant for the popup", async () => {
      const { handlers } = setup();
      await globalsItem.setValue({
        ...DEFAULT_GLOBALS,
        pageModel: { providerID: "deepseek", id: "deepseek-flash", variant: "ultra" },
      });
      const view = await handlers.tabView({ tabId: 1, hostname: "example.com" });
      expect(view.pageModel.missing).toBe(true);
      expect(view.pageModel.model?.variant).toBeUndefined();
    });
  });

  describe("translateSelection", () => {
    const selectionModel = { providerID: "deepseek", id: "deepseek-flash", variant: "none" };

    beforeEach(async () => {
      await connectionItem.setValue(conn);
    });

    it("translates with the sender tab settings and the selection model", async () => {
      const { handlers, translateSelection } = setup();
      await globalsItem.setValue({ ...DEFAULT_GLOBALS, selectionModel });
      const res = await handlers.translateSelection(
        { text: "hello", context: "ctx", hostname: "example.com" },
        { tab: { id: 5, url: "https://example.com/page" } },
      );
      expect(res).toEqual({
        text: "privet",
        sourceLang: "auto",
        targetLang: expect.any(String),
        model: selectionModel,
      });
      const call = translateSelection.mock.calls[0] as unknown as [
        { model: ModelRef; hostname: string; settings: { targetLang: string } },
      ];
      expect(call[0].model).toEqual(selectionModel);
      expect(call[0].hostname).toBe("example.com");
    });

    it("applies a templateId override for this call only", async () => {
      const { handlers, translateSelection } = setup();
      await globalsItem.setValue({ ...DEFAULT_GLOBALS, selectionModel });
      await templatesItem.setValue([
        { id: BUILTIN_TEMPLATE_ID, name: "b", builtin: true, settings: {} },
        ruTemplate,
      ]);
      await handlers.translateSelection(
        { text: "hello", context: "", hostname: "example.com", templateId: "ru-wiki" },
        { tab: { id: 5, url: "https://example.com/" } },
      );
      const call = translateSelection.mock.calls[0] as unknown as [
        { settings: { targetLang: string; prePrompt: string } },
      ];
      expect(call[0].settings.targetLang).toBe("de");
      expect(await tabSettings(5).getValue()).toBeNull();
    });

    it("ignores a templateId override equal to the stored tab template", async () => {
      const { handlers, translateSelection } = setup();
      await globalsItem.setValue({ ...DEFAULT_GLOBALS, selectionModel });
      const view = await handlers.tabView({ tabId: 5, hostname: "example.com" });
      await handlers.setTabSettings({ tabId: 5, settings: { ...view.settings, targetLang: "fr" } });
      await handlers.translateSelection(
        { text: "hello", context: "", hostname: "example.com", templateId: BUILTIN_TEMPLATE_ID },
        { tab: { id: 5, url: "https://example.com/" } },
      );
      const call = translateSelection.mock.calls[0] as unknown as [
        { settings: { targetLang: string } },
      ];
      expect(call[0].settings.targetLang).toBe("fr");
    });

    it("uses stored tab settings", async () => {
      const { handlers, translateSelection } = setup();
      await globalsItem.setValue({ ...DEFAULT_GLOBALS, selectionModel });
      const view = await handlers.tabView({ tabId: 5, hostname: "example.com" });
      await handlers.setTabSettings({ tabId: 5, settings: { ...view.settings, targetLang: "fr" } });
      await handlers.translateSelection(
        { text: "hello", context: "", hostname: "example.com" },
        { tab: { id: 5, url: "https://example.com/" } },
      );
      const call = translateSelection.mock.calls[0] as unknown as [
        { settings: { targetLang: string } },
      ];
      expect(call[0].settings.targetLang).toBe("fr");
    });

    it("returns an error result instead of throwing", async () => {
      const { handlers, translateSelection } = setup();
      await globalsItem.setValue({ ...DEFAULT_GLOBALS, selectionModel });
      translateSelection.mockRejectedValueOnce(
        new BackendError("rate_limit", { retryAfterMs: 1500 }),
      );
      expect(
        await handlers.translateSelection(
          { text: "hello", context: "", hostname: "example.com" },
          { tab: { id: 5, url: "https://example.com/" } },
        ),
      ).toEqual({ error: "rate_limit", retryAfterMs: 1500 });
    });

    it("returns unauthorized when not paired", async () => {
      const { handlers, translateSelection } = setup();
      await connectionItem.setValue(null);
      expect(
        await handlers.translateSelection(
          { text: "hello", context: "", hostname: "example.com" },
          { tab: { id: 5 } },
        ),
      ).toEqual({ error: "unauthorized" });
      expect(translateSelection).not.toHaveBeenCalled();
    });

    it("returns no_model when connected but no model can be resolved", async () => {
      const { handlers, translateSelection } = setup(
        fakeBackend({ listModels: async () => [], defaultModel: async () => null }),
      );
      expect(
        await handlers.translateSelection(
          { text: "hello", context: "", hostname: "example.com" },
          { tab: { id: 5 } },
        ),
      ).toEqual({ error: "no_model" });
      expect(translateSelection).not.toHaveBeenCalled();
    });

    it("initializes models lazily once and translates", async () => {
      const listModels = vi.fn(async () => [flash]);
      const { handlers, translateSelection } = setup(fakeBackend({ listModels }));
      const res = await handlers.translateSelection(
        { text: "hello", context: "", hostname: "example.com" },
        { tab: { id: 5 } },
      );
      expect(res).toMatchObject({ text: "privet" });
      expect((await globalsItem.getValue()).selectionModel).not.toBeNull();
      expect(translateSelection).toHaveBeenCalledTimes(1);
    });

    it("aborts the backend signal when the request is cancelled from the same tab", async () => {
      let signal: AbortSignal | undefined;
      const { handlers, translateSelection } = setup();
      await globalsItem.setValue({ ...DEFAULT_GLOBALS, selectionModel });
      translateSelection.mockImplementationOnce((async (_i: unknown, s: AbortSignal) => {
        signal = s;
        return new Promise<string>((_res, rej) =>
          s.addEventListener("abort", () => rej(new BackendError("aborted"))),
        );
      }) as never);
      const pending = handlers.translateSelection(
        { text: "hello", context: "", hostname: "example.com", requestId: "r1" },
        { tab: { id: 5, url: "https://example.com/" } },
      );
      await vi.waitFor(() => expect(signal).toBeDefined());
      await handlers.cancelSelection("r1", { tab: { id: 6 } });
      expect(signal?.aborted).toBe(false);
      await handlers.cancelSelection("r1", { tab: { id: 5 } });
      expect(signal?.aborted).toBe(true);
      expect(await pending).toEqual({ error: "aborted", retryAfterMs: undefined });
    });

    it("cancelling an unknown or finished request does nothing", async () => {
      const { handlers } = setup();
      await globalsItem.setValue({ ...DEFAULT_GLOBALS, selectionModel });
      await handlers.translateSelection(
        { text: "hello", context: "", hostname: "example.com", requestId: "r2" },
        { tab: { id: 5 } },
      );
      await expect(handlers.cancelSelection("r2", { tab: { id: 5 } })).resolves.toBeUndefined();
      await expect(handlers.cancelSelection("nope", { tab: { id: 5 } })).resolves.toBeUndefined();
    });
  });

  describe("pageJob", () => {
    const req = {
      segments: [{ id: "1", text: "a" }],
      page: { title: "T", hostname: "example.com" },
    };

    beforeEach(async () => {
      await connectionItem.setValue(conn);
    });

    it("builds a job from the tab view", async () => {
      const { handlers } = setup();
      const pageModel = { providerID: "deepseek", id: "deepseek-flash", variant: "none" };
      await globalsItem.setValue({ ...DEFAULT_GLOBALS, pageModel });
      const job = await handlers.pageJob({ tab: { id: 3, url: "https://example.com/" } }, req);
      expect(job?.model).toEqual(pageModel);
      expect(job?.segments).toEqual(req.segments);
      expect(job?.page).toEqual(req.page);
    });

    it("rejects with unauthorized when not paired", async () => {
      const { handlers } = setup();
      await connectionItem.setValue(null);
      await expect(handlers.pageJob({ tab: { id: 3 } }, req)).rejects.toMatchObject({
        kind: "unauthorized",
      });
    });

    it("rejects with no_model when connected but no model can be resolved", async () => {
      const { handlers } = setup(
        fakeBackend({ listModels: async () => [], defaultModel: async () => null }),
      );
      await expect(handlers.pageJob({ tab: { id: 3 } }, req)).rejects.toMatchObject({
        kind: "no_model",
      });
    });

    it("initializes models lazily when none are stored", async () => {
      const { handlers } = setup();
      const job = await handlers.pageJob({ tab: { id: 3 } }, req);
      expect(job.model).toMatchObject({ providerID: "deepseek", id: "deepseek-flash" });
    });
  });

  describe("models cache", () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    const view = (h: ReturnType<typeof setup>["handlers"]) =>
      h.tabView({ tabId: 1, hostname: "example.com" });

    it("reuses the model list for 30 seconds", async () => {
      const listModels = vi.fn(async () => [flash]);
      const { handlers } = setup(fakeBackend({ listModels }));
      await view(handlers);
      await view(handlers);
      expect(listModels).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(29_000);
      await view(handlers);
      expect(listModels).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(2_000);
      await view(handlers);
      expect(listModels).toHaveBeenCalledTimes(2);
    });

    it("the explicit models() call refreshes the cache", async () => {
      const listModels = vi.fn(async () => [flash]);
      const { handlers } = setup(fakeBackend({ listModels }));
      await view(handlers);
      await handlers.models();
      expect(listModels).toHaveBeenCalledTimes(2);
      await view(handlers);
      expect(listModels).toHaveBeenCalledTimes(2);
    });

    it("a connection change drops the cache", async () => {
      const listModels = vi.fn(async () => [flash]);
      const { handlers } = setup(fakeBackend({ listModels }));
      await view(handlers);
      await handlers.connectManual(conn);
      const afterConnect = listModels.mock.calls.length;
      expect(afterConnect).toBeGreaterThan(1);
      await handlers.disconnect();
      await connectionItem.setValue(conn);
      await view(handlers);
      expect(listModels.mock.calls.length).toBe(afterConnect + 1);
    });

    it("failed loads are not cached", async () => {
      const listModels = vi
        .fn<() => Promise<ModelInfo[]>>()
        .mockRejectedValueOnce(new BackendError("offline"))
        .mockResolvedValue([flash]);
      const { handlers } = setup(fakeBackend({ listModels }));
      await view(handlers);
      await view(handlers);
      expect(listModels).toHaveBeenCalledTimes(2);
    });
  });

  describe("pageBadge", () => {
    const top = { frameId: 0, tab: { id: 4 } };

    it("sets the badge text per page state and a red background for errors", async () => {
      const { handlers } = setup();
      const text = vi.spyOn(fakeBrowser.action, "setBadgeText");
      const color = vi.spyOn(fakeBrowser.action, "setBadgeBackgroundColor");
      await handlers.pageBadge("translating", top);
      expect(text).toHaveBeenLastCalledWith({ tabId: 4, text: "..." });
      await handlers.pageBadge("error", top);
      expect(text).toHaveBeenLastCalledWith({ tabId: 4, text: "!" });
      expect(color).toHaveBeenLastCalledWith({ tabId: 4, color: "#d93025" });
      await handlers.pageBadge("translated", top);
      expect(text).toHaveBeenLastCalledWith({ tabId: 4, text: "" });
      await handlers.pageBadge("idle", top);
      expect(text).toHaveBeenLastCalledWith({ tabId: 4, text: "" });
    });

    it("ignores child frames and senders without a tab", async () => {
      const { handlers } = setup();
      const text = vi.spyOn(fakeBrowser.action, "setBadgeText");
      await handlers.pageBadge("translating", { frameId: 3, tab: { id: 4 } });
      await handlers.pageBadge("translating", {});
      expect(text).not.toHaveBeenCalled();
    });
  });

  describe("tab host change", () => {
    it("drops tab settings edited on host A when the tab resolves to host B", async () => {
      const { handlers } = setup();
      await templatesItem.setValue([
        { id: BUILTIN_TEMPLATE_ID, name: "b", builtin: true, settings: { prePrompt: "x" } },
        ruTemplate,
      ]);
      await siteRulesItem.setValue([{ id: "r1", pattern: "b.example", templateId: "ru-wiki" }]);
      const view = await handlers.tabView({ tabId: 1, hostname: "a.example" });
      await handlers.setTabSettings({ tabId: 1, settings: { ...view.settings, targetLang: "fr" } });

      const next = await handlers.tabView({ tabId: 1, hostname: "b.example" });
      expect(next.template.id).toBe("ru-wiki");
      expect(next.settings.targetLang).toBe("de");
      expect(next.modified).toBe(false);
      expect(await tabSettings(1).getValue()).toBeNull();
      expect(await tabHostItem(1).getValue()).toBe("b.example");
    });

    it("keeps tab settings on the same host", async () => {
      const { handlers } = setup();
      const view = await handlers.tabView({ tabId: 1, hostname: "a.example" });
      await handlers.setTabSettings({ tabId: 1, settings: { ...view.settings, targetLang: "fr" } });
      const next = await handlers.tabView({ tabId: 1, hostname: "a.example" });
      expect(next.settings.targetLang).toBe("fr");
      expect(next.modified).toBe(true);
    });

    it("selection and page jobs on another host also ignore stale tab settings", async () => {
      await connectionItem.setValue(conn);
      const { handlers, translateSelection } = setup();
      const model = { providerID: "deepseek", id: "deepseek-flash", variant: "none" };
      await globalsItem.setValue({ ...DEFAULT_GLOBALS, selectionModel: model, pageModel: model });
      const view = await handlers.tabView({ tabId: 5, hostname: "a.example" });
      await handlers.setTabSettings({ tabId: 5, settings: { ...view.settings, targetLang: "fr" } });
      await handlers.translateSelection(
        { text: "hello", context: "", hostname: "b.example" },
        { tab: { id: 5, url: "https://b.example/" } },
      );
      const call = translateSelection.mock.calls[0] as unknown as [
        { settings: { targetLang: string } },
      ];
      expect(call[0].settings.targetLang).not.toBe("fr");
    });
  });

  describe("tab cleanup", () => {
    it("tabRemoved clears tab settings", async () => {
      const { handlers } = setup();
      const view = await handlers.tabView({ tabId: 1, hostname: "example.com" });
      await handlers.setTabSettings({ tabId: 1, settings: view.settings });
      await handlers.tabRemoved(1);
      expect(await tabSettings(1).getValue()).toBeNull();
    });

    it("tab settings survive a same-host navigation after a worker restart", async () => {
      const first = setup();
      const view = await first.handlers.tabView({ tabId: 1, hostname: "example.com" });
      await first.handlers.setTabSettings({
        tabId: 1,
        settings: { ...view.settings, targetLang: "fr" },
      });

      const restarted = setup();
      await restarted.handlers.tabNavigated(1, "https://example.com/next");
      expect((await tabSettings(1).getValue())?.targetLang).toBe("fr");

      await restarted.handlers.tabNavigated(1, "https://other.org/");
      expect(await tabSettings(1).getValue()).toBeNull();
    });

    it("an unknown previous hostname does not clear tab settings", async () => {
      const { handlers } = setup();
      const view = await handlers.tabView({ tabId: 1, hostname: "example.com" });
      await tabHostItem(1).removeValue();
      await tabSettings(1).setValue(view.settings);
      await handlers.tabNavigated(1, "https://other.org/");
      expect(await tabSettings(1).getValue()).not.toBeNull();
    });

    it("tabRemoved also forgets the stored hostname", async () => {
      const { handlers } = setup();
      await handlers.tabView({ tabId: 1, hostname: "example.com" });
      await handlers.tabRemoved(1);
      expect(await tabHostItem(1).getValue()).toBeNull();
    });

    it("tabNavigated clears only when the hostname changes", async () => {
      const { handlers } = setup();
      const view = await handlers.tabView({ tabId: 1, hostname: "example.com" });
      await handlers.setTabSettings({ tabId: 1, settings: view.settings });

      await handlers.tabNavigated(1, "https://example.com/other");
      expect(await tabSettings(1).getValue()).not.toBeNull();

      await handlers.tabNavigated(1, "https://other.org/");
      expect(await tabSettings(1).getValue()).toBeNull();
    });
  });

  it("cache handlers delegate to the cache", async () => {
    const { handlers, cache } = setup();
    expect(await handlers.cacheStats()).toEqual({ entries: 3 });
    await handlers.cacheClear();
    expect(cache.clear).toHaveBeenCalled();
  });
});

describe("createBackendProvider", () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it("throws unauthorized without a connection", async () => {
    const get = createBackendProvider(() => fakeBackend());
    await expect(get()).rejects.toMatchObject({ kind: "unauthorized" });
  });

  it("caches per connection and recreates when it changes", async () => {
    const create = vi.fn(() => fakeBackend());
    const get = createBackendProvider(create);
    await connectionItem.setValue(conn);
    const a = await get();
    expect(await get()).toBe(a);
    expect(create).toHaveBeenCalledTimes(1);

    await connectionItem.setValue({ ...conn, password: "other" });
    const b = await get();
    expect(b).not.toBe(a);
    expect(create).toHaveBeenCalledTimes(2);
  });
});
