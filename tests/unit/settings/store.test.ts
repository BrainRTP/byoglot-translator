import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import type { ConnectionRecord } from "../../../lib/connections/types";
import {
  BUILTIN_TEMPLATE_ID,
  DEFAULT_GLOBALS,
  initialGlobals,
} from "../../../lib/settings/defaults";
import {
  connectionsStore,
  globalsItem,
  profileOverridesItem,
  siteRulesItem,
  tabSettings,
  templatesItem,
} from "../../../lib/settings/store";
import type { Template } from "../../../lib/settings/types";

describe("settings store", () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it("defaults theme to system, also for stored globals without it", async () => {
    expect(DEFAULT_GLOBALS.theme).toBe("system");
    const { theme: _theme, ...legacy } = DEFAULT_GLOBALS;
    await globalsItem.setValue(legacy as never);
    expect((await globalsItem.getValue()).theme).toBe("system");
  });

  it("returns fallbacks when nothing is stored", async () => {
    expect(await connectionsStore.getAll()).toEqual([]);
    expect(await connectionsStore.getActive()).toBeNull();
    expect(await globalsItem.getValue()).toEqual(initialGlobals(navigator.language));
    expect((await templatesItem.getValue()).map((t) => t.id)).toEqual([BUILTIN_TEMPLATE_ID]);
    expect(await siteRulesItem.getValue()).toEqual([]);
    expect(await profileOverridesItem.getValue()).toEqual({});
    expect(await tabSettings(7).getValue()).toBeNull();
  });

  describe("animation", () => {
    it("defaults to wave when nothing is stored", async () => {
      expect((await globalsItem.getValue()).animation).toBe("wave");
      expect(DEFAULT_GLOBALS.animation).toBe("wave");
    });

    it("keeps a stored fade", async () => {
      await fakeBrowser.storage.local.set({ globals: { ...DEFAULT_GLOBALS, animation: "fade" } });
      expect((await globalsItem.getValue()).animation).toBe("fade");
    });

    it("keeps a stored none after rereading", async () => {
      await globalsItem.setValue({ ...DEFAULT_GLOBALS, animation: "none" });
      expect((await globalsItem.getValue()).animation).toBe("none");
    });
  });

  it("fills fields missing from stored globals with defaults", async () => {
    const { animation: _omit, ...old } = DEFAULT_GLOBALS;
    await fakeBrowser.storage.local.set({ globals: { ...old, targetLang: "fr" } });
    const g = await globalsItem.getValue();
    expect(g.animation).toBe("wave");
    expect(g.targetLang).toBe("fr");
  });

  it("defaults the progress bar to on for globals saved without it", async () => {
    const { progressBar: _omit, ...old } = DEFAULT_GLOBALS;
    await fakeBrowser.storage.local.set({ globals: old });
    expect((await globalsItem.getValue()).progressBar).toBe(true);
  });

  it("reads globals saved before pinnedEffort with null", async () => {
    const { pinnedEffort: _p, ...old } = DEFAULT_GLOBALS;
    await fakeBrowser.storage.local.set({ globals: old });
    expect(DEFAULT_GLOBALS.pinnedEffort).toBeNull();
    expect((await globalsItem.getValue()).pinnedEffort).toBeNull();
  });

  it("reads globals saved before the language prompt with its defaults", async () => {
    const { languagePromptEnabled: _on, languageProfile: _profile, ...old } = DEFAULT_GLOBALS;
    await fakeBrowser.storage.local.set({ globals: { ...old, targetLang: "fr" } });
    const g = await globalsItem.getValue();
    expect(g.languagePromptEnabled).toBe(true);
    expect(g.languageProfile).toBe("auto");
    expect(g.targetLang).toBe("fr");
  });

  describe("default target language", () => {
    afterEach(() => vi.unstubAllGlobals());

    async function globalsFor(language: string) {
      vi.stubGlobal("navigator", { language });
      vi.resetModules();
      return (await import("../../../lib/settings/store")).globalsItem;
    }

    it("follows a supported browser language when no globals are stored", async () => {
      expect((await (await globalsFor("de-DE")).getValue()).targetLang).toBe("de");
    });

    it("falls back to en for an unsupported language", async () => {
      expect((await (await globalsFor("xx-YY")).getValue()).targetLang).toBe("en");
    });

    it("does not touch globals that are already stored", async () => {
      await globalsItem.setValue({ ...DEFAULT_GLOBALS, targetLang: "fr" });
      expect((await (await globalsFor("de-DE")).getValue()).targetLang).toBe("fr");
    });
  });

  it("initialGlobals takes the primary subtag in any case", () => {
    expect(initialGlobals("pt_BR").targetLang).toBe("pt");
    expect(initialGlobals("RU").targetLang).toBe("ru");
    expect(initialGlobals("").targetLang).toBe("en");
    expect(initialGlobals(undefined).targetLang).toBe("en");
  });

  it("keeps per-tab settings separate", async () => {
    const e = {
      templateId: BUILTIN_TEMPLATE_ID,
      prePrompt: "p",
      sourceLang: "auto",
      targetLang: "ru",
      displayMode: "replace" as const,
      pageModel: null,
      selectionModel: null,
    };
    await tabSettings(1).setValue(e);
    expect(await tabSettings(1).getValue()).toEqual(e);
    expect(await tabSettings(2).getValue()).toBeNull();
  });

  describe("connections", () => {
    const legacy = { url: "http://127.0.0.1:4096", username: "opencode", password: "tok" };
    const page = { providerID: "deepseek", id: "deepseek-flash", variant: "none" };
    const rec = (id: string) =>
      ({
        kind: "opencode",
        id,
        ...legacy,
        pageModel: null,
        selectionModel: null,
      }) as const;

    async function seedLegacy() {
      await fakeBrowser.storage.local.set({
        connection: legacy,
        globals: { ...DEFAULT_GLOBALS, targetLang: "fr", pageModel: page },
        templates: [{ id: "t", name: "T", builtin: false, settings: { selectionModel: page } }],
      });
    }

    it("migrates the legacy connection on the first read", async () => {
      await seedLegacy();
      const all = await connectionsStore.getAll();
      expect(all).toHaveLength(1);
      const [first] = all;
      expect(first).toMatchObject({ kind: "opencode", ...legacy });
      expect(first?.pageModel).toEqual({ ...page, connectionId: first?.id });
      expect(await connectionsStore.getActiveId()).toBe(first?.id);
      const raw = await fakeBrowser.storage.local.get(["connection", "globals", "templates"]);
      expect(raw.connection).toBeUndefined();
      expect(raw.globals).not.toHaveProperty("pageModel");
      expect(raw.globals).toMatchObject({ targetLang: "fr" });
      expect((raw.templates as Template[])[0]?.settings.selectionModel?.connectionId).toBe(
        first?.id,
      );
    });

    it("keeps the models in connections and out of globals, and ignores a legacy key next to a list", async () => {
      await seedLegacy();
      const [first] = await connectionsStore.getAll();
      const raw = await fakeBrowser.storage.local.get(["globals", "connections"]);
      expect(raw.globals).not.toHaveProperty("pageModel");
      expect((raw.connections as ConnectionRecord[])[0]?.pageModel).toEqual({
        ...page,
        connectionId: first?.id,
      });
      await fakeBrowser.storage.local.set({ connection: { ...legacy, password: "late" } });
      expect(await connectionsStore.getAll()).toEqual([first]);
      expect((await globalsItem.getValue()).pageModel).toEqual(first?.pageModel);
    });

    it("is idempotent", async () => {
      await seedLegacy();
      const first = await connectionsStore.getAll();
      const second = await connectionsStore.getAll();
      expect(second).toEqual(first);
      expect(second).toHaveLength(1);
    });

    it("migrates once under concurrent reads", async () => {
      await seedLegacy();
      const [a, b] = await Promise.all([connectionsStore.getAll(), connectionsStore.getAll()]);
      expect(b).toEqual(a);
      expect(await connectionsStore.getAll()).toEqual(a);
    });

    it("ignores a stray legacy connection once connections exist", async () => {
      await connectionsStore.setAll([rec("x")]);
      await fakeBrowser.storage.local.set({ connection: { ...legacy, password: "other" } });
      expect(await connectionsStore.getAll()).toEqual([rec("x")]);
    });

    it("does not migrate over an existing empty list", async () => {
      await connectionsStore.setAll([]);
      await fakeBrowser.storage.local.set({ connection: legacy });
      expect(await connectionsStore.getAll()).toEqual([]);
    });

    it("stores and returns the active id and record", async () => {
      await connectionsStore.setAll([rec("a"), rec("b")]);
      await connectionsStore.setActiveId("b");
      expect(await connectionsStore.getActiveId()).toBe("b");
      expect((await connectionsStore.getActive())?.id).toBe("b");
      await connectionsStore.setActiveId(null);
      expect(await connectionsStore.getActive()).toBeNull();
    });
  });

  describe("globals models", () => {
    const rec = {
      kind: "opencode",
      id: "a",
      url: "http://127.0.0.1:1",
      username: "u",
      password: "p",
      pageModel: { providerID: "d", id: "m", connectionId: "a" },
      selectionModel: null,
    } as const;

    it("fills the models from the active connection", async () => {
      await connectionsStore.setAll([rec]);
      await connectionsStore.setActiveId("a");
      const g = await globalsItem.getValue();
      expect(g.pageModel).toEqual(rec.pageModel);
      expect(g.selectionModel).toBeNull();
    });

    it("returns null models without an active connection", async () => {
      await connectionsStore.setAll([rec]);
      const g = await globalsItem.getValue();
      expect(g.pageModel).toBeNull();
      expect(g.selectionModel).toBeNull();
    });

    it("writes models into the active record and stamps the active connectionId", async () => {
      await connectionsStore.setAll([rec]);
      await connectionsStore.setActiveId("a");
      await globalsItem.setValue({
        ...DEFAULT_GLOBALS,
        targetLang: "de",
        pageModel: { providerID: "d", id: "n" },
        selectionModel: { providerID: "d", id: "s", connectionId: "keep" },
      });
      const active = await connectionsStore.getActive();
      expect(active?.pageModel).toEqual({ providerID: "d", id: "n", connectionId: "a" });
      expect(active?.selectionModel).toEqual({ providerID: "d", id: "s", connectionId: "a" });
      const raw = await fakeBrowser.storage.local.get("globals");
      expect(raw.globals).not.toHaveProperty("pageModel");
      expect(raw.globals).not.toHaveProperty("selectionModel");
      expect((await globalsItem.getValue()).targetLang).toBe("de");
    });

    it("returns only models owned by the active connection", async () => {
      await connectionsStore.setAll([
        { ...rec, pageModel: { providerID: "d", id: "m", connectionId: "other" } },
      ]);
      await connectionsStore.setActiveId("a");
      const g = await globalsItem.getValue();
      expect(g.pageModel).toBeNull();
    });

    it("re-stamps a foreign connectionId to the active one on write", async () => {
      await connectionsStore.setAll([rec]);
      await connectionsStore.setActiveId("a");
      await globalsItem.setValue({
        ...DEFAULT_GLOBALS,
        pageModel: { providerID: "d", id: "n", variant: "high", connectionId: "old" },
      });
      expect((await globalsItem.getValue()).pageModel).toEqual({
        providerID: "d",
        id: "n",
        variant: "high",
        connectionId: "a",
      });
    });

    it("drops models when there is no active connection", async () => {
      await globalsItem.setValue({
        ...DEFAULT_GLOBALS,
        targetLang: "de",
        pageModel: { providerID: "d", id: "n" },
      });
      const g = await globalsItem.getValue();
      expect(g.pageModel).toBeNull();
      expect(g.targetLang).toBe("de");
      expect(await connectionsStore.getAll()).toEqual([]);
    });
  });
});
