import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import {
  BUILTIN_TEMPLATE_ID,
  DEFAULT_GLOBALS,
  initialGlobals,
} from "../../../lib/settings/defaults";
import {
  connectionItem,
  globalsItem,
  siteRulesItem,
  tabSettings,
  templatesItem,
} from "../../../lib/settings/store";

describe("settings store", () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it("returns fallbacks when nothing is stored", async () => {
    expect(await connectionItem.getValue()).toBeNull();
    expect(await globalsItem.getValue()).toEqual(initialGlobals(navigator.language));
    expect((await templatesItem.getValue()).map((t) => t.id)).toEqual([BUILTIN_TEMPLATE_ID]);
    expect(await siteRulesItem.getValue()).toEqual([]);
    expect(await tabSettings(7).getValue()).toBeNull();
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
});
