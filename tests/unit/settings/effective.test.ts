import { describe, expect, it } from "vitest";
import type { ModelInfo } from "../../../lib/opencode/types";
import { builtinTemplate, DEFAULT_GLOBALS } from "../../../lib/settings/defaults";
import {
  applyTemplate,
  isModified,
  pickInitialModels,
  resolveModel,
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
    const e = applyTemplate(builtinTemplate(), globals);
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
        pageModel: { providerID: "a", id: "b", variant: "none" },
        selectionModel: { providerID: "c", id: "d" },
      },
    };
    const e = applyTemplate(t, globals);
    expect(e.templateId).toBe("t1");
    expect(e.prePrompt).toBe("P");
    expect(e.sourceLang).toBe("en");
    expect(e.targetLang).toBe("fr");
    expect(e.displayMode).toBe("replace");
    expect(e.pageModel).toEqual({ providerID: "a", id: "b", variant: "none" });
    expect(e.selectionModel).toEqual({ providerID: "c", id: "d" });
  });

  it("returns a copy: mutating it does not touch the template or globals", () => {
    const t = builtinTemplate();
    t.settings.pageModel = { providerID: "a", id: "b" };
    const e = applyTemplate(t, globals);
    e.prePrompt = "changed";
    if (e.pageModel) e.pageModel.id = "changed";
    if (e.selectionModel) e.selectionModel.id = "changed";
    expect(t.settings.prePrompt).toBe(builtinTemplate().settings.prePrompt);
    expect(t.settings.pageModel?.id).toBe("b");
    expect(globals.selectionModel?.id).toBe("sel");
  });
});

describe("isModified", () => {
  it("is false for a fresh copy, true after editing, false after reverting", () => {
    const t = builtinTemplate();
    const e = applyTemplate(t, globals);
    expect(isModified(e, t, globals)).toBe(false);
    const original = e.prePrompt;
    e.prePrompt = "other";
    expect(isModified(e, t, globals)).toBe(true);
    e.prePrompt = original;
    expect(isModified(e, t, globals)).toBe(false);
  });

  it("detects model variant, language and display mode changes", () => {
    const t = builtinTemplate();
    const base = applyTemplate(t, globals);

    const variant = applyTemplate(t, globals);
    if (variant.selectionModel) variant.selectionModel.variant = "high";
    expect(isModified(variant, t, globals)).toBe(true);

    expect(isModified({ ...base, targetLang: "es" }, t, globals)).toBe(true);
    expect(isModified({ ...base, displayMode: "replace" }, t, globals)).toBe(true);
    expect(isModified({ ...base, pageModel: null }, t, globals)).toBe(true);
  });

  it("editing never changes the stored template", () => {
    const t = builtinTemplate();
    const e = applyTemplate(t, globals);
    e.prePrompt = "other";
    expect(t).toEqual(builtinTemplate());
  });
});

describe("toTemplateSettings", () => {
  it("round-trips through applyTemplate and omits null models and source language", () => {
    const e = applyTemplate(builtinTemplate(), { ...globals, pageModel: null });
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
    const ref = { providerID: "deepseek", id: "deepseek-flash", variant: "none" };
    expect(pickInitialModels(models, models[0] ?? null)).toEqual({
      pageModel: ref,
      selectionModel: ref,
    });
  });

  it("omits the variant for deepseek-flash when it has no none variant", () => {
    const models = [model("deepseek", "deepseek-flash", ["high"])];
    expect(pickInitialModels(models, null).pageModel).toEqual({
      providerID: "deepseek",
      id: "deepseek-flash",
    });
  });

  it("uses the default model with none when available", () => {
    const def = model("a", "x", ["low", "none"]);
    const ref = { providerID: "a", id: "x", variant: "none" };
    expect(pickInitialModels([def], def)).toEqual({ pageModel: ref, selectionModel: ref });
  });

  it("uses the first variant when none is not offered", () => {
    const def = model("a", "x", ["low", "high"]);
    expect(pickInitialModels([def], def).pageModel).toEqual({
      providerID: "a",
      id: "x",
      variant: "low",
    });
  });

  it("uses no variant when the default model has none", () => {
    const def = model("a", "x");
    expect(pickInitialModels([def], def).selectionModel).toEqual({ providerID: "a", id: "x" });
  });

  it("returns nulls without a default model", () => {
    expect(pickInitialModels([model("a", "x")], null)).toEqual({
      pageModel: null,
      selectionModel: null,
    });
  });
});
