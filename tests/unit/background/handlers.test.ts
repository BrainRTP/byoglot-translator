import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { createBackendProvider } from "../../../lib/background/connection";
import {
  createHandlers,
  type HandlerDeps,
  resolveStoredModel,
} from "../../../lib/background/handlers";
import type { ConnectionRecord, ProviderPreset } from "../../../lib/connections/types";
import { BackendError } from "../../../lib/opencode/errors";
import type {
  Connection,
  ModelInfo,
  ModelRef,
  TranslationBackend,
} from "../../../lib/opencode/types";
import { BUILTIN_TEMPLATE_ID, DEFAULT_GLOBALS } from "../../../lib/settings/defaults";
import { LANGUAGE_CODES } from "../../../lib/settings/languages";
import {
  connectionsStore,
  globalsItem,
  profileOverridesItem,
  siteRulesItem,
  tabHostItem,
  tabSettings,
  templatesItem,
} from "../../../lib/settings/store";
import type { Template } from "../../../lib/settings/types";
import { BUILTIN_PROFILES, PROFILE_IDS } from "../../../lib/translate/profiles";
import { OPENCODE_ID, seedOpencode, storedOpencode } from "./fixtures";

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
  const removeOrigin = vi.fn(async (_origin: string) => {});
  const deps: HandlerDeps = {
    getBackend: async () => backend,
    createBackend: () => backend,
    pair: async () => conn,
    removeOrigin,
    service: { translateSelection },
    cache,
    ...extra,
  };
  return { handlers: createHandlers(deps), translateSelection, cache, removeOrigin };
}

const ruTemplate: Template = {
  id: "ru-wiki",
  name: "Wiki",
  builtin: false,
  settings: { prePrompt: "wiki", targetLang: "de" },
};

const NO_PROFILE_LANG = LANGUAGE_CODES.find((c) => !BUILTIN_PROFILES.has(c)) as string;

const noProfileTemplate: Template = {
  ...ruTemplate,
  settings: { ...ruTemplate.settings, targetLang: NO_PROFILE_LANG },
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

  it("tabView carries the global animation setting", async () => {
    const { handlers } = setup();
    expect((await handlers.tabView({ tabId: 1, hostname: "example.com" })).animation).toBe("wave");
    await handlers.setGlobals({ ...(await handlers.globals()), animation: "none" });
    expect((await handlers.tabView({ tabId: 1, hostname: "example.com" })).animation).toBe("none");
  });

  it("tabView carries the progress bar setting", async () => {
    const { handlers } = setup();
    expect((await handlers.tabView({ tabId: 1, hostname: "example.com" })).progressBar).toBe(true);
    await handlers.setGlobals({ ...(await handlers.globals()), progressBar: false });
    expect((await handlers.tabView({ tabId: 1, hostname: "example.com" })).progressBar).toBe(false);
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
      expect(status).toEqual({
        state: "connected",
        kind: "opencode",
        name: "opencode",
        url: conn.url,
        version: "2.1.0",
      });
      expect(await storedOpencode()).toEqual(conn);
      const g = await globalsItem.getValue();
      expect(g.pageModel).toEqual({
        providerID: "deepseek",
        id: "deepseek-flash",
        variant: "none",
        connectionId: expect.any(String),
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
      await vi.waitFor(async () => expect(await storedOpencode()).toEqual(conn));
      const mine: ModelRef = { providerID: "x", id: "y" };
      await handlers.setGlobals({ ...DEFAULT_GLOBALS, pageModel: mine, targetLang: "de" });
      release();
      await pending;
      const g = await globalsItem.getValue();
      expect(g.pageModel).toEqual({ ...mine, connectionId: expect.any(String) });
      expect(g.targetLang).toBe("de");
    });

    it("pair keeps an existing pageModel", async () => {
      const { handlers } = setup();
      const mine: ModelRef = { providerID: "x", id: "y" };
      await seedOpencode(conn);
      await globalsItem.setValue({ ...DEFAULT_GLOBALS, pageModel: mine });
      await handlers.pair("http://127.0.0.1:4096/auth/connect/abc");
      expect((await globalsItem.getValue()).pageModel).toEqual({
        ...mine,
        connectionId: expect.any(String),
      });
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
      expect(await storedOpencode()).toBeNull();
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
      expect(await storedOpencode()).toBeNull();

      const good = setup();
      expect((await good.handlers.connectManual(conn)).state).toBe("connected");
      expect(await storedOpencode()).toEqual(conn);
    });

    it("status reports disconnected, connected and mapped errors", async () => {
      const { handlers } = setup();
      expect(await handlers.status()).toEqual({ state: "disconnected" });
      await seedOpencode(conn);
      expect(await handlers.status()).toEqual({
        state: "connected",
        kind: "opencode",
        name: "opencode",
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
      await seedOpencode(conn);
      expect(await handlers.status()).toEqual({
        state: "error",
        url: conn.url,
        kind: "unauthorized",
        backend: "opencode",
        retryAfterMs: undefined,
      });
    });

    it("removeConnection clears the connection", async () => {
      const { handlers } = setup();
      await seedOpencode(conn);
      expect(await handlers.removeConnection(OPENCODE_ID)).toEqual([]);
      expect(await storedOpencode()).toBeNull();
    });
  });

  describe("model resolution", () => {
    const models = [flash];

    it("keeps a valid variant", () => {
      const ref = {
        providerID: "deepseek",
        id: "deepseek-flash",
        variant: "high",
        connectionId: "c1",
      };
      expect(resolveStoredModel(ref, models, null, "c1")).toEqual({ model: ref, missing: false });
    });

    it("drops an unknown variant and flags it missing", () => {
      const ref = {
        providerID: "deepseek",
        id: "deepseek-flash",
        variant: "ultra",
        connectionId: "c1",
      };
      expect(resolveStoredModel(ref, models, null, "c1")).toEqual({
        model: { ...ref, variant: undefined },
        missing: true,
      });
    });

    it("falls back to the global model when the model is gone", () => {
      const fallback = { providerID: "deepseek", id: "deepseek-flash" };
      const ref = { providerID: "a", id: "b", connectionId: "c1" };
      expect(resolveStoredModel(ref, models, fallback, "c1")).toEqual({
        model: fallback,
        missing: true,
      });
    });

    it("skips a model of another connection without flagging it", () => {
      const fallback = { providerID: "deepseek", id: "deepseek-flash", connectionId: "c2" };
      const ref = { providerID: "a", id: "b", connectionId: "c1" };
      expect(resolveStoredModel(ref, models, fallback, "c2")).toEqual({
        model: fallback,
        missing: false,
      });
    });

    it("does not flag anything when the model list is unavailable", () => {
      const ref = { providerID: "a", id: "b", variant: "v", connectionId: "c1" };
      expect(resolveStoredModel(ref, null, null, "c1")).toEqual({ model: ref, missing: false });
    });

    it("tabView flags a stale variant for the popup", async () => {
      const { handlers } = setup();
      await seedOpencode(conn);
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
      await seedOpencode(conn);
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
        model: { ...selectionModel, connectionId: expect.any(String) },
      });
      const call = translateSelection.mock.calls[0] as unknown as [
        { model: ModelRef; hostname: string; settings: { targetLang: string } },
      ];
      expect(call[0].model).toEqual({ ...selectionModel, connectionId: expect.any(String) });
      expect(call[0].hostname).toBe("example.com");
    });

    it("passes the language prompt of the effective target language to the service", async () => {
      const { handlers, translateSelection } = setup();
      await globalsItem.setValue({ ...DEFAULT_GLOBALS, targetLang: "ru", selectionModel });
      await templatesItem.setValue([
        { id: BUILTIN_TEMPLATE_ID, name: "b", builtin: true, settings: {} },
        noProfileTemplate,
      ]);
      await handlers.translateSelection(
        { text: "hello", context: "", hostname: "example.com" },
        { tab: { id: 5, url: "https://example.com/" } },
      );
      await handlers.translateSelection(
        { text: "hello", context: "", hostname: "example.com", templateId: "ru-wiki" },
        { tab: { id: 6, url: "https://example.com/" } },
      );
      const prompts = translateSelection.mock.calls.map(
        (c) => (c as unknown as [{ languagePrompt: string }])[0].languagePrompt,
      );
      expect(prompts).toEqual([BUILTIN_PROFILES.get("ru"), BUILTIN_PROFILES.get("generic")]);
    });

    it("passes an empty language prompt when the toggle is off", async () => {
      const { handlers, translateSelection } = setup();
      await globalsItem.setValue({
        ...DEFAULT_GLOBALS,
        targetLang: "ru",
        languagePromptEnabled: false,
        selectionModel,
      });
      await handlers.translateSelection(
        { text: "hello", context: "", hostname: "example.com" },
        { tab: { id: 5, url: "https://example.com/" } },
      );
      const call = translateSelection.mock.calls[0] as unknown as [{ languagePrompt: string }];
      expect(call[0].languagePrompt).toBe("");
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
      ).toEqual({ error: "rate_limit", retryAfterMs: 1500, backend: "opencode" });
    });

    it("captures the connection kind before the request", async () => {
      const { handlers, translateSelection } = setup();
      await globalsItem.setValue({ ...DEFAULT_GLOBALS, selectionModel });
      translateSelection.mockImplementationOnce(async () => {
        await connectionsStore.setAll([
          { kind: "opencode", id: "other", ...conn, pageModel: null, selectionModel: null },
        ]);
        await connectionsStore.setActiveId("other");
        throw new BackendError("rate_limit");
      });
      const res = await handlers.translateSelection(
        { text: "hello", context: "", hostname: "example.com" },
        { tab: { id: 5, url: "https://example.com/" } },
      );
      expect(res).toMatchObject({ error: "rate_limit", backend: "opencode" });
    });

    it("returns unauthorized when not paired", async () => {
      const { handlers, translateSelection } = setup();
      await seedOpencode(null);
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
      ).toEqual({ error: "no_model", backend: "opencode" });
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
      expect(await pending).toEqual({ error: "aborted", backend: "opencode" });
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
      await seedOpencode(conn);
    });

    it("builds a job from the tab view", async () => {
      const { handlers } = setup();
      const pageModel = { providerID: "deepseek", id: "deepseek-flash", variant: "none" };
      await globalsItem.setValue({ ...DEFAULT_GLOBALS, pageModel });
      const job = await handlers.pageJob({ tab: { id: 3, url: "https://example.com/" } }, req);
      expect(job?.model).toEqual({ ...pageModel, connectionId: expect.any(String) });
      expect(job?.segments).toEqual(req.segments);
      expect(job?.page).toEqual(req.page);
    });

    it("takes the language prompt from the effective target language, not the global one", async () => {
      const { handlers } = setup();
      const pageModel = { providerID: "deepseek", id: "deepseek-flash", variant: "none" };
      await globalsItem.setValue({ ...DEFAULT_GLOBALS, targetLang: "ru", pageModel });
      const plain = await handlers.pageJob({ tab: { id: 3, url: "https://example.com/" } }, req);
      expect(plain.languagePrompt).toBe(BUILTIN_PROFILES.get("ru"));

      await templatesItem.setValue([
        { id: BUILTIN_TEMPLATE_ID, name: "b", builtin: true, settings: {} },
        noProfileTemplate,
      ]);
      await siteRulesItem.setValue([{ id: "r1", pattern: "example.com", templateId: "ru-wiki" }]);
      const viaTemplate = await handlers.pageJob(
        { tab: { id: 3, url: "https://example.com/" } },
        req,
      );
      expect(viaTemplate.settings.targetLang).toBe(NO_PROFILE_LANG);
      expect(viaTemplate.languagePrompt).toBe(BUILTIN_PROFILES.get("generic"));
    });

    it("uses the stored override of the chosen profile", async () => {
      const { handlers } = setup();
      await globalsItem.setValue({ ...DEFAULT_GLOBALS, targetLang: "ru" });
      await profileOverridesItem.setValue({ ru: { text: "my ru", base: "old", savedAt: 1 } });
      const job = await handlers.pageJob({ tab: { id: 3 } }, req);
      expect(job.languagePrompt).toBe("my ru");
    });

    it("gives an empty language prompt when the toggle is off", async () => {
      const { handlers } = setup();
      await globalsItem.setValue({
        ...DEFAULT_GLOBALS,
        targetLang: "ru",
        languagePromptEnabled: false,
      });
      const job = await handlers.pageJob({ tab: { id: 3 } }, req);
      expect(job.languagePrompt).toBe("");
    });

    it("rejects with unauthorized when not paired", async () => {
      const { handlers } = setup();
      await seedOpencode(null);
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

    it("concurrent tabView and models() share one request", async () => {
      const listModels = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return [flash];
      });
      const { handlers } = setup(fakeBackend({ listModels }));
      await Promise.all([view(handlers), handlers.models()]);
      expect(listModels).toHaveBeenCalledTimes(1);
    });

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
      await handlers.removeConnection((await handlers.connections())[0]?.id as string);
      await seedOpencode(conn);
      await view(handlers);
      expect(listModels.mock.calls.length).toBe(afterConnect + 1);
    });

    it("a connection change during a request leaves the cache empty", async () => {
      const listModels = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return [flash];
      });
      const { handlers } = setup(fakeBackend({ listModels }));
      await handlers.connectManual(conn);
      vi.advanceTimersByTime(31_000);
      const inFlight = handlers.models();
      await handlers.removeConnection((await handlers.connections())[0]?.id as string);
      await inFlight;
      await seedOpencode(conn);
      const before = listModels.mock.calls.length;
      await view(handlers);
      expect(listModels.mock.calls.length).toBe(before + 1);
    });

    it("a provider status check and tabView share one model list request", async () => {
      await connectionsStore.setAll([
        {
          kind: "provider",
          id: "p1",
          preset: "deepseek",
          name: "DeepSeek",
          baseUrl: "https://api.deepseek.com",
          apiKey: "k",
          pageModel: null,
          selectionModel: null,
        },
      ]);
      await connectionsStore.setActiveId("p1");
      const listModels = vi.fn(async () => [flash]);
      const info = async () => {
        await listModels();
        return { version: "" };
      };
      const { handlers } = setup(fakeBackend({ listModels, info }));
      expect(await handlers.status()).toMatchObject({ state: "connected", kind: "provider" });
      await view(handlers);
      expect(listModels).toHaveBeenCalledTimes(1);
    });

    it("the shared model list request carries an 8 second timeout signal", async () => {
      const timeout = vi.spyOn(AbortSignal, "timeout");
      const listModels = vi.fn(async (_signal?: AbortSignal) => [flash]);
      const { handlers } = setup(fakeBackend({ listModels }));
      await view(handlers);
      expect(timeout).toHaveBeenCalledWith(8_000);
      const signal = listModels.mock.calls[0]?.[0];
      expect(signal).toBeInstanceOf(AbortSignal);
      expect(signal?.aborted).toBe(false);
      timeout.mockRestore();
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
      await seedOpencode(conn);
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

  describe("language profiles", () => {
    const builtinRu = BUILTIN_PROFILES.get("ru") as string;
    const builtinGeneric = BUILTIN_PROFILES.get("generic") as string;

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("lists the built-in texts untouched, language ids first and generic last", async () => {
      const { handlers } = setup();
      const list = await handlers.languageProfiles();
      expect(list.map((p) => p.id)).toEqual([...PROFILE_IDS]);
      expect(list.at(-1)?.id).toBe("generic");
      for (const p of list) {
        expect(p).toEqual({
          id: p.id,
          builtin: BUILTIN_PROFILES.get(p.id),
          text: BUILTIN_PROFILES.get(p.id),
          modified: false,
          outdated: false,
        });
      }
    });

    it("save stores the text with the current builtin as base", async () => {
      const { handlers } = setup();
      vi.spyOn(Date, "now").mockReturnValue(1234);
      const list = await handlers.languageProfileOp({ type: "save", id: "ru", text: "my ru" });
      expect(await profileOverridesItem.getValue()).toEqual({
        ru: { text: "my ru", base: builtinRu, savedAt: 1234 },
      });
      expect(list.find((p) => p.id === "ru")).toEqual({
        id: "ru",
        builtin: builtinRu,
        text: "my ru",
        modified: true,
        outdated: false,
      });
      expect(list.find((p) => p.id === "generic")?.modified).toBe(false);
    });

    it("save of the builtin text padded with whitespace removes the override", async () => {
      const { handlers } = setup();
      await handlers.languageProfileOp({ type: "save", id: "ru", text: "my ru" });
      const list = await handlers.languageProfileOp({
        type: "save",
        id: "ru",
        text: `\n  ${builtinRu}\n  `,
      });
      expect(await profileOverridesItem.getValue()).toEqual({});
      expect(list.find((p) => p.id === "ru")?.modified).toBe(false);
    });

    it("an empty override is a modification with empty text", async () => {
      const { handlers } = setup();
      const list = await handlers.languageProfileOp({ type: "save", id: "ru", text: "" });
      expect(list.find((p) => p.id === "ru")).toMatchObject({ text: "", modified: true });
      expect((await profileOverridesItem.getValue()).ru?.text).toBe("");
    });

    it("save refreshes base of an outdated override", async () => {
      const { handlers } = setup();
      await profileOverridesItem.setValue({ ru: { text: "mine", base: "old", savedAt: 1 } });
      const list = await handlers.languageProfileOp({ type: "save", id: "ru", text: "mine 2" });
      expect((await profileOverridesItem.getValue()).ru?.base).toBe(builtinRu);
      expect(list.find((p) => p.id === "ru")?.outdated).toBe(false);
    });

    it("reset removes the override", async () => {
      const { handlers } = setup();
      await handlers.languageProfileOp({ type: "save", id: "ru", text: "my ru" });
      const list = await handlers.languageProfileOp({ type: "reset", id: "ru" });
      expect(await profileOverridesItem.getValue()).toEqual({});
      expect(list.find((p) => p.id === "ru")).toMatchObject({ text: builtinRu, modified: false });
    });

    it("keep rewrites only base", async () => {
      const { handlers } = setup();
      await profileOverridesItem.setValue({ ru: { text: "mine", base: "old", savedAt: 7 } });
      const before = await handlers.languageProfiles();
      expect(before.find((p) => p.id === "ru")).toMatchObject({ modified: true, outdated: true });

      const list = await handlers.languageProfileOp({ type: "keep", id: "ru" });
      expect(await profileOverridesItem.getValue()).toEqual({
        ru: { text: "mine", base: builtinRu, savedAt: 7 },
      });
      expect(list.find((p) => p.id === "ru")).toMatchObject({
        text: "mine",
        modified: true,
        outdated: false,
      });
    });

    it("any op removes an override that equals the builtin text", async () => {
      const { handlers } = setup();
      for (const type of ["keep", "reset"] as const) {
        await profileOverridesItem.setValue({
          ru: { text: builtinRu, base: "old", savedAt: 1 },
          generic: { text: builtinGeneric, base: "old", savedAt: 1 },
        });
        await handlers.languageProfileOp({ type, id: "ru" });
        expect(await profileOverridesItem.getValue(), type).toEqual({
          generic: { text: builtinGeneric, base: "old", savedAt: 1 },
        });
      }
    });

    it("rejects an unknown id and a text over 20000 characters without writing", async () => {
      const { handlers } = setup();
      await expect(
        handlers.languageProfileOp({ type: "save", id: "xx", text: "a" }),
      ).rejects.toThrow();
      await expect(
        handlers.languageProfileOp({ type: "save", id: "ru", text: "a".repeat(20_001) }),
      ).rejects.toThrow();
      expect(await profileOverridesItem.getValue()).toEqual({});

      await handlers.languageProfileOp({ type: "save", id: "ru", text: "a".repeat(20_000) });
      expect((await profileOverridesItem.getValue()).ru?.text).toHaveLength(20_000);
    });

    it("rejects reset and keep for an unknown id and keeps its stored override", async () => {
      const { handlers } = setup();
      const orphan = { xx: { text: "gone", base: "b", savedAt: 1 } };
      await profileOverridesItem.setValue(orphan);
      await expect(handlers.languageProfileOp({ type: "reset", id: "xx" })).rejects.toThrow();
      await expect(handlers.languageProfileOp({ type: "keep", id: "xx" })).rejects.toThrow();
      expect(await profileOverridesItem.getValue()).toEqual(orphan);
    });

    it("never lists or deletes an override whose profile disappeared", async () => {
      const { handlers } = setup();
      const orphan = { text: "gone", base: "b", savedAt: 1 };
      await profileOverridesItem.setValue({ xx: orphan });
      expect((await handlers.languageProfiles()).map((p) => p.id)).not.toContain("xx");

      const ops = [
        { type: "save", id: "ru", text: "my ru" },
        { type: "keep", id: "ru" },
        { type: "reset", id: "ru" },
        { type: "save", id: "generic", text: builtinGeneric },
      ] as const;
      for (const op of ops) {
        const list = await handlers.languageProfileOp(op);
        expect(list.map((p) => p.id)).toEqual([...PROFILE_IDS]);
        expect((await profileOverridesItem.getValue()).xx).toEqual(orphan);
      }
    });
  });

  it("cache handlers delegate to the cache", async () => {
    const { handlers, cache } = setup();
    expect(await handlers.cacheStats()).toEqual({ entries: 3 });
    await handlers.cacheClear();
    expect(cache.clear).toHaveBeenCalled();
  });
});

describe("connection operations", () => {
  const ocModel: ModelInfo = { ...flash, providerID: "oc", id: "oc-model" };
  const prModel: ModelInfo = { ...flash, providerID: "pr", id: "pr-model" };
  const deepseek = {
    preset: "deepseek" as const,
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    apiKey: "sk-secret",
  };
  const ollama = {
    preset: "ollama" as const,
    name: "Ollama",
    baseUrl: "http://localhost:11434/v1",
    apiKey: "",
  };

  function multi(infoImpl?: (rec: ConnectionRecord) => Promise<{ version: string }>) {
    const info = vi.fn(async (rec: ConnectionRecord) => infoImpl?.(rec) ?? { version: "9.9" });
    const createBackend = (rec: ConnectionRecord): TranslationBackend => {
      const model = rec.kind === "opencode" ? ocModel : prModel;
      return fakeBackend({
        info: () => info(rec),
        listModels: async () => [model],
        defaultModel: async () => model,
      });
    };
    const { handlers, removeOrigin } = setup(fakeBackend(), {
      getBackend: createBackendProvider(createBackend),
      createBackend,
    });
    return { handlers, removeOrigin, info };
  }

  async function saved(): Promise<ConnectionRecord[]> {
    return connectionsStore.getAll();
  }

  beforeEach(() => {
    fakeBrowser.reset();
  });

  it("a new provider becomes active and the list never carries its key", async () => {
    const { handlers } = multi();
    await handlers.connectManual(conn);
    const res = await handlers.saveProvider(deepseek);
    expect(res.status).toMatchObject({
      state: "connected",
      kind: "provider",
      name: "DeepSeek",
      url: "https://api.deepseek.com",
      version: "9.9",
    });
    expect((await handlers.status()).state).toBe("connected");
    expect(res.connections).toHaveLength(2);
    expect(res.connections.find((c) => c.active)?.kind).toBe("provider");
    expect(JSON.stringify(res.connections)).not.toContain("sk-secret");
    expect(JSON.stringify(await handlers.connections())).not.toContain("sk-secret");
    expect((await handlers.connections()).find((c) => c.kind === "provider")?.hasKey).toBe(true);
  });

  it("switching connections keeps each pageModel", async () => {
    const { handlers } = multi();
    await handlers.connectManual(conn);
    const ocRef = (await handlers.globals()).pageModel;
    expect(ocRef).toMatchObject({ providerID: "oc", id: "oc-model" });

    const { connections } = await handlers.saveProvider(deepseek);
    const prRef = (await handlers.globals()).pageModel;
    expect(prRef).toMatchObject({ providerID: "pr", id: "pr-model" });

    const ocId = connections.find((c) => c.kind === "opencode")?.id as string;
    const prId = connections.find((c) => c.kind === "provider")?.id as string;
    expect(await handlers.activateConnection(ocId)).toMatchObject({ kind: "opencode" });
    expect((await handlers.globals()).pageModel).toEqual(ocRef);
    expect(await handlers.activateConnection(prId)).toMatchObject({ kind: "provider" });
    expect((await handlers.globals()).pageModel).toEqual(prRef);
  });

  it("changing the domain with an empty key is refused and nothing changes", async () => {
    const { handlers, info, removeOrigin } = multi();
    const { connections } = await handlers.saveProvider(deepseek);
    const id = connections[0]?.id as string;
    info.mockClear();
    const before = await saved();

    const res = await handlers.saveProvider({
      ...deepseek,
      id,
      preset: "custom",
      baseUrl: "https://evil.example/v1",
      apiKey: "",
    });
    expect(res.status).toMatchObject({
      state: "error",
      kind: "provider_auth",
      backend: "provider",
    });
    expect(info).not.toHaveBeenCalled();
    expect(removeOrigin).not.toHaveBeenCalled();
    expect(await saved()).toEqual(before);
  });

  it("rejects an unknown id and the id of the opencode record", async () => {
    const { handlers } = multi();
    await handlers.connectManual(conn);
    const before = await saved();
    const ocId = before[0]?.id as string;
    for (const id of ["nope", ocId]) {
      const res = await handlers.saveProvider({ ...deepseek, id });
      expect(res.status).toMatchObject({ state: "error", kind: "incompatible" });
      expect(res.connections).toHaveLength(1);
    }
    expect(await saved()).toEqual(before);
  });

  it("rejects an unknown preset without throwing", async () => {
    const { handlers } = multi();
    const res = await handlers.saveProvider({ ...deepseek, preset: "foo" as ProviderPreset });
    expect(res.status).toMatchObject({ state: "error", kind: "incompatible" });
    expect(await saved()).toHaveLength(0);
  });

  it("revokes the origin when the edited record was deleted during the key check", async () => {
    let remove: (() => Promise<void>) | undefined;
    const { handlers, removeOrigin } = multi(async () => {
      await remove?.();
      return { version: "9.9" };
    });
    const { connections } = await handlers.saveProvider(deepseek);
    const id = connections[0]?.id as string;
    remove = () => connectionsStore.setAll([]);
    const res = await handlers.saveProvider({
      ...deepseek,
      id,
      baseUrl: "https://other.example/v1",
    });
    expect(res.status).toMatchObject({ state: "error", kind: "incompatible" });
    expect(removeOrigin).toHaveBeenCalledWith("https://other.example");
  });

  it("custom on localhost does not need a key", async () => {
    const { handlers } = multi();
    const res = await handlers.saveProvider({
      preset: "custom",
      name: "Local",
      baseUrl: "http://localhost:8080/v1",
      apiKey: "",
    });
    expect(res.status).toMatchObject({ state: "connected" });
  });

  it("an empty key on edit keeps the stored key and models", async () => {
    const { handlers, info } = multi();
    const { connections } = await handlers.saveProvider(deepseek);
    const id = connections[0]?.id as string;
    const modelsBefore = (await handlers.globals()).pageModel;

    const res = await handlers.saveProvider({ ...deepseek, id, name: "Renamed", apiKey: "" });
    expect(res.status).toMatchObject({ state: "connected", name: "Renamed" });
    const [rec] = await saved();
    expect(rec).toMatchObject({ kind: "provider", name: "Renamed", apiKey: "sk-secret" });
    expect((await handlers.globals()).pageModel).toEqual(modelsBefore);
    expect(info.mock.calls.at(-1)?.[0]).toMatchObject({ apiKey: "sk-secret" });
  });

  it("changing the origin with a new key revokes the old origin and keeps models", async () => {
    const { handlers, removeOrigin } = multi();
    const { connections } = await handlers.saveProvider(deepseek);
    const id = connections[0]?.id as string;
    const modelsBefore = (await handlers.globals()).pageModel;

    const res = await handlers.saveProvider({
      ...deepseek,
      id,
      preset: "custom",
      baseUrl: "https://proxy.example/v1",
      apiKey: "new",
    });
    expect(res.status.state).toBe("connected");
    expect(removeOrigin).toHaveBeenCalledWith("https://api.deepseek.com");
    expect((await handlers.globals()).pageModel).toEqual(modelsBefore);
  });

  it("does not revoke an origin another record still uses", async () => {
    const { handlers, removeOrigin } = multi();
    await handlers.saveProvider(deepseek);
    const second = await handlers.saveProvider({ ...deepseek, name: "Second" });
    const id = second.connections.find((c) => c.name === "Second")?.id as string;
    await handlers.saveProvider({
      ...deepseek,
      id,
      baseUrl: "https://proxy.example/v1",
      preset: "custom",
      apiKey: "k2",
    });
    expect(removeOrigin).not.toHaveBeenCalled();
  });

  it("a new provider without a key is refused when the preset needs one", async () => {
    const { handlers, info } = multi();
    const res = await handlers.saveProvider({ ...deepseek, apiKey: "" });
    expect(res.status).toMatchObject({ state: "error", kind: "provider_auth" });
    expect(info).not.toHaveBeenCalled();
    expect(await saved()).toEqual([]);
  });

  it("a model change written during the check survives the save", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let slow = false;
    const { handlers } = multi(async () => {
      if (slow) await gate;
      return { version: "1" };
    });
    const { connections } = await handlers.saveProvider(deepseek);
    const id = connections[0]?.id as string;
    slow = true;
    const pending = handlers.saveProvider({ ...deepseek, id, name: "Renamed", apiKey: "" });
    await vi.waitFor(() => expect(slow).toBe(true));
    const mine: ModelRef = { providerID: "pr", id: "other", connectionId: id };
    await globalsItem.setValue({ ...(await handlers.globals()), pageModel: mine });
    release();
    await pending;
    const [rec] = await saved();
    expect(rec).toMatchObject({ name: "Renamed", pageModel: mine });
  });

  it("an edit whose record was deleted during the check saves nothing", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let slow = false;
    const { handlers } = multi(async () => {
      if (slow) await gate;
      return { version: "1" };
    });
    const { connections } = await handlers.saveProvider(deepseek);
    const id = connections[0]?.id as string;
    slow = true;
    const pending = handlers.saveProvider({ ...deepseek, id, name: "Renamed", apiKey: "" });
    await handlers.removeConnection(id);
    release();
    const res = await pending;
    expect(res.status).toMatchObject({ state: "error", kind: "incompatible" });
    expect(await saved()).toEqual([]);
  });

  it("a keyless local preset is accepted", async () => {
    const { handlers } = multi();
    const res = await handlers.saveProvider(ollama);
    expect(res.status).toMatchObject({ state: "connected", kind: "provider" });
    expect((await handlers.connections())[0]?.hasKey).toBe(false);
  });

  it("an invalid base URL gives incompatible and saves nothing", async () => {
    const { handlers, info, removeOrigin } = multi();
    const res = await handlers.saveProvider({ ...deepseek, preset: "custom", baseUrl: "nope" });
    expect(res.status).toMatchObject({ state: "error", kind: "incompatible" });
    expect(info).not.toHaveBeenCalled();
    expect(removeOrigin).not.toHaveBeenCalled();
    expect(await saved()).toEqual([]);
  });

  it("a failed check saves nothing and revokes a remote origin", async () => {
    const { handlers, removeOrigin } = multi(async () => {
      throw new BackendError("provider_auth");
    });
    const res = await handlers.saveProvider(deepseek);
    expect(res.status).toMatchObject({
      state: "error",
      kind: "provider_auth",
      backend: "provider",
    });
    expect(res.connections).toEqual([]);
    expect(await saved()).toEqual([]);
    expect(removeOrigin).toHaveBeenCalledWith("https://api.deepseek.com");
  });

  it("a failed check on a local origin does not revoke anything", async () => {
    const { handlers, removeOrigin } = multi(async () => {
      throw new BackendError("offline");
    });
    const res = await handlers.saveProvider(ollama);
    expect(res.status).toMatchObject({ state: "error", kind: "offline" });
    expect(removeOrigin).not.toHaveBeenCalled();
  });

  it("a failed check keeps the origin when another record uses it", async () => {
    let fail = false;
    const { handlers, removeOrigin } = multi(async () => {
      if (fail) throw new BackendError("provider_auth");
      return { version: "1" };
    });
    await handlers.saveProvider(deepseek);
    fail = true;
    await handlers.saveProvider({ ...deepseek, name: "Other" });
    expect(removeOrigin).not.toHaveBeenCalled();
    expect(await saved()).toHaveLength(1);
  });

  it("removing the active connection leaves nothing active", async () => {
    const { handlers, removeOrigin } = multi();
    await handlers.connectManual(conn);
    const { connections } = await handlers.saveProvider(deepseek);
    const prId = connections.find((c) => c.kind === "provider")?.id as string;

    const left = await handlers.removeConnection(prId);
    expect(left.map((c) => c.kind)).toEqual(["opencode"]);
    expect(left.some((c) => c.active)).toBe(false);
    expect(await handlers.status()).toEqual({ state: "disconnected" });
    expect(await connectionsStore.getActiveId()).toBeNull();
    expect(removeOrigin).toHaveBeenCalledWith("https://api.deepseek.com");
    await expect(
      handlers.pageJob(
        { tab: { id: 1, url: "https://example.com/" } },
        {
          segments: [],
          page: { title: "t", hostname: "example.com" },
        },
      ),
    ).rejects.toMatchObject({ kind: "unauthorized" });
  });

  it("removing an inactive connection keeps the active one", async () => {
    const { handlers, removeOrigin } = multi();
    await handlers.connectManual(conn);
    const first = await handlers.connections();
    await handlers.saveProvider(ollama);
    await handlers.activateConnection(first[0]?.id as string);
    const prId = (await handlers.connections()).find((c) => c.kind === "provider")?.id as string;
    const left = await handlers.removeConnection(prId);
    expect(left).toHaveLength(1);
    expect(left[0]?.active).toBe(true);
    expect(removeOrigin).not.toHaveBeenCalled();
  });

  it("pair while a provider is active activates opencode without a second record", async () => {
    const { handlers } = multi();
    await handlers.connectManual(conn);
    await handlers.saveProvider(deepseek);
    const status = await handlers.pair("http://127.0.0.1:4096/auth/connect/abc");
    expect(status).toMatchObject({ state: "connected", kind: "opencode" });
    const list = await handlers.connections();
    expect(list.filter((c) => c.kind === "opencode")).toHaveLength(1);
    expect(list.find((c) => c.active)?.kind).toBe("opencode");
  });

  it("setTabSettings and templateOp stamp models with the active connection", async () => {
    const { handlers } = multi();
    await handlers.connectManual(conn);
    const activeId = (await connectionsStore.getActiveId()) as string;
    const mine: ModelRef = { providerID: "oc", id: "oc-model", variant: "high" };

    const view = await handlers.tabView({ tabId: 1, hostname: "example.com" });
    const next = await handlers.setTabSettings({
      tabId: 1,
      settings: { ...view.settings, pageModel: mine },
    });
    expect(next.settings.pageModel).toEqual({ ...mine, connectionId: activeId });
    expect(next.pageModel.model).toEqual({ ...mine, connectionId: activeId });

    const created = await handlers.templateOp({
      type: "create",
      name: "T",
      settings: { pageModel: mine },
    });
    expect(created.find((t) => t.name === "T")?.settings.pageModel).toEqual({
      ...mine,
      connectionId: activeId,
    });
    const id = created.find((t) => t.name === "T")?.id as string;
    const updated = await handlers.templateOp({
      type: "update",
      id,
      patch: { settings: { selectionModel: mine } },
    });
    const t = updated.find((x) => x.id === id);
    expect(t?.settings.selectionModel).toEqual({ ...mine, connectionId: activeId });
    expect(t?.settings.pageModel).toBeUndefined();
  });
});
