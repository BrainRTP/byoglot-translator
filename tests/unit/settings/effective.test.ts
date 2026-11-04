import { describe, expect, it } from "vitest";
import type { ModelInfo } from "../../../lib/opencode/types";
import { builtinTemplate, DEFAULT_GLOBALS } from "../../../lib/settings/defaults";
import {
  applyTemplate,
  isModified,
  ownModel,
  pickInitialModels,
  resolveModel,
  stampModel,
  toTemplateSettings,
} from "../../../lib/settings/effective";
import type { GlobalSettings, Template } from "../../../lib/settings/types";

const globals: GlobalSettings = {
  ...DEFAULT_GLOBALS,
  sourceLang: "en",
  targetLang: "de",
  displayMode: "bilingual",
  pageModel: { providerID: "g", id: "page" },
  selectionModel: { providerID: "g", id: "sel", variant: "low" },
};

const model = (providerID: string, id: string, variants: string[] = []): ModelInfo => ({
  providerID,
  id,
  name: id,
  variants,
  contextLimit: 1000,
  outputLimit: 100,
});

describe("applyTemplate", () => {
  it("falls back to globals for unset template fields", () => {
    const e = applyTemplate(builtinTemplate(), globals, "a");
    expect(e).toEqual({
      templateId: "builtin-default",
      prePrompt: builtinTemplate().settings.prePrompt,
      sourceLang: "en",
      targetLang: "de",
      displayMode: "bilingual",
      pageModel: { providerID: "g", id: "page" },
      selectionModel: { providerID: "g", id: "sel", variant: "low" },
    });
  });

  it("takes template fields when set", () => {
    const t: Template = {
      id: "t1",
      name: "T",
      builtin: false,
      settings: {
        prePrompt: "P",
        targetLang: "fr",
        displayMode: "replace",
        pageModel: { providerID: "a", id: "b", variant: "none", connectionId: "a" },
        selectionModel: { providerID: "c", id: "d", connectionId: "a" },
      },
    };
    const e = applyTemplate(t, globals, "a");
    expect(e.templateId).toBe("t1");
    expect(e.prePrompt).toBe("P");
    expect(e.sourceLang).toBe("en");
    expect(e.targetLang).toBe("fr");
    expect(e.displayMode).toBe("replace");
    expect(e.pageModel).toEqual({
      providerID: "a",
      id: "b",
      variant: "none",
      connectionId: "a",
    });
    expect(e.selectionModel).toEqual({ providerID: "c", id: "d", connectionId: "a" });
  });

  it("returns a copy: mutating it does not touch the template or globals", () => {
    const t = builtinTemplate();
    t.settings.pageModel = { providerID: "a", id: "b", connectionId: "a" };
    const e = applyTemplate(t, globals, "a");
    e.prePrompt = "changed";
    if (e.pageModel) e.pageModel.id = "changed";
    if (e.selectionModel) e.selectionModel.id = "changed";
    expect(t.settings.prePrompt).toBe(builtinTemplate().settings.prePrompt);
    expect(t.settings.pageModel?.id).toBe("b");
    expect(globals.selectionModel?.id).toBe("sel");
  });

  describe("template models from another connection", () => {
    const t: Template = {
      id: "t1",
      name: "T",
      builtin: false,
      settings: {
        prePrompt: "P",
        targetLang: "fr",
        displayMode: "replace",
        pageModel: { providerID: "p", id: "m", connectionId: "a" },
        selectionModel: { providerID: "p", id: "s", connectionId: "a" },
      },
    };

    it("skips them and uses the globals", () => {
      const e = applyTemplate(t, globals, "b");
      expect(e.pageModel).toEqual(globals.pageModel);
      expect(e.selectionModel).toEqual(globals.selectionModel);
      expect(e.prePrompt).toBe("P");
      expect(e.targetLang).toBe("fr");
      expect(e.displayMode).toBe("replace");
    });

    it("uses them when the connection is active", () => {
      const e = applyTemplate(t, globals, "a");
      expect(e.pageModel).toEqual(t.settings.pageModel);
      expect(e.selectionModel).toEqual(t.settings.selectionModel);
      expect(e.prePrompt).toBe("P");
      expect(e.targetLang).toBe("fr");
      expect(e.displayMode).toBe("replace");
    });

    it("isModified follows the same rule", () => {
      expect(isModified(applyTemplate(t, globals, "b"), t, globals, "b")).toBe(false);
    });
  });
});

describe("ownModel and stampModel", () => {
  it("ownModel keeps only refs of the active connection", () => {
    const ref = { providerID: "p", id: "m", connectionId: "a" };
    expect(ownModel(ref, "a")).toBe(ref);
    expect(ownModel(ref, "b")).toBeNull();
    expect(ownModel(ref, null)).toBeNull();
    expect(ownModel(null, "a")).toBeNull();
  });

  it("stampModel tags untagged refs and keeps foreign ids", () => {
    expect(stampModel({ providerID: "p", id: "m" }, "a")).toEqual({
      providerID: "p",
      id: "m",
      connectionId: "a",
    });
    const foreign = { providerID: "p", id: "m", connectionId: "x" };
    expect(stampModel(foreign, "a")).toEqual(foreign);
    expect(stampModel(undefined, "a")).toBeNull();
  });
});

describe("isModified", () => {
  it("is false for a fresh copy, true after editing, false after reverting", () => {
    const t = builtinTemplate();
    const e = applyTemplate(t, globals, "a");
    expect(isModified(e, t, globals, "a")).toBe(false);
    const original = e.prePrompt;
    e.prePrompt = "other";
    expect(isModified(e, t, globals, "a")).toBe(true);
    e.prePrompt = original;
    expect(isModified(e, t, globals, "a")).toBe(false);
  });

  it("detects model variant, language and display mode changes", () => {
    const t = builtinTemplate();
    const base = applyTemplate(t, globals, "a");

    const variant = applyTemplate(t, globals, "a");
    if (variant.selectionModel) variant.selectionModel.variant = "high";
    expect(isModified(variant, t, globals, "a")).toBe(true);

    expect(isModified({ ...base, targetLang: "es" }, t, globals, "a")).toBe(true);
    expect(isModified({ ...base, displayMode: "replace" }, t, globals, "a")).toBe(true);
    expect(isModified({ ...base, pageModel: null }, t, globals, "a")).toBe(true);
  });

  it("editing never changes the stored template", () => {
    const t = builtinTemplate();
    const e = applyTemplate(t, globals, "a");
    e.prePrompt = "other";
    expect(t).toEqual(builtinTemplate());
  });
});

describe("toTemplateSettings", () => {
  it("round-trips through applyTemplate and omits null models and source language", () => {
    const e = applyTemplate(builtinTemplate(), { ...globals, pageModel: null }, "a");
    const s = toTemplateSettings(e);
    expect(s).toEqual({
      prePrompt: e.prePrompt,
      targetLang: "de",
      displayMode: "bilingual",
      selectionModel: { providerID: "g", id: "sel", variant: "low" },
    });
    expect("pageModel" in s).toBe(false);
  });
});

describe("resolveModel", () => {
  const models = [model("p", "m1")];
  const fallback = { providerID: "p", id: "m1" };

  it("returns the fallback and flags missing when the ref is absent from the list", () => {
    expect(resolveModel({ providerID: "x", id: "gone" }, models, fallback)).toEqual({
      model: fallback,
      missing: true,
    });
  });

  it("keeps a ref that is present", () => {
    const ref = { providerID: "p", id: "m1", variant: "high" };
    expect(resolveModel(ref, models, null)).toEqual({ model: ref, missing: false });
  });

  it("uses the fallback without flagging when no ref is set", () => {
    expect(resolveModel(null, models, fallback)).toEqual({ model: fallback, missing: false });
  });
});

describe("pickInitialModels", () => {
  it("prefers deepseek/deepseek-flash with variant none for both models", () => {
    const models = [
      model("a", "x", ["none"]),
      model("deepseek", "deepseek-flash", ["none", "high"]),
    ];
    const ref = {
      providerID: "deepseek",
      id: "deepseek-flash",
      variant: "none",
      connectionId: "c1",
    };
    expect(pickInitialModels(models, models[0] ?? null, "c1")).toEqual({
      pageModel: ref,
      selectionModel: ref,
    });
  });

  it("omits the variant for deepseek-flash when it has no none variant", () => {
    const models = [model("deepseek", "deepseek-flash", ["high"])];
    expect(pickInitialModels(models, null, "c1").pageModel).toEqual({
      providerID: "deepseek",
      id: "deepseek-flash",
      connectionId: "c1",
    });
  });

  it("uses the default model with none when available", () => {
    const def = model("a", "x", ["low", "none"]);
    const ref = { providerID: "a", id: "x", variant: "none", connectionId: "c1" };
    expect(pickInitialModels([def], def, "c1")).toEqual({ pageModel: ref, selectionModel: ref });
  });

  it("uses the first variant when none is not offered", () => {
    const def = model("a", "x", ["low", "high"]);
    expect(pickInitialModels([def], def, "c1").pageModel).toEqual({
      providerID: "a",
      id: "x",
      variant: "low",
      connectionId: "c1",
    });
  });

  it("uses no variant when the default model has none", () => {
    const def = model("a", "x");
    expect(pickInitialModels([def], def, "c1").selectionModel).toEqual({
      providerID: "a",
      id: "x",
      connectionId: "c1",
    });
  });

  it("returns nulls without a default model", () => {
    expect(pickInitialModels([model("a", "x")], null, "c1")).toEqual({
      pageModel: null,
      selectionModel: null,
    });
  });
});
