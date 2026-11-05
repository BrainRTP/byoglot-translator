import { describe, expect, it } from "vitest";
import type { ModelInfo } from "../../../lib/opencode/types";
import type { SiteRule, Template } from "../../../lib/settings/types";
import {
  filterTemplates,
  formToSettings,
  groupByProvider,
  isFirefoxAgent,
  modelVariants,
  reconcileVariant,
  ruleError,
  rulesUsing,
  sameForm,
  templateToForm,
} from "../../../lib/ui/options-logic";

const model = (providerID: string, id: string, variants: string[] = []): ModelInfo => ({
  providerID,
  id,
  name: id,
  variants,
  contextLimit: 1,
  outputLimit: 1,
});

describe("templateToForm / formToSettings", () => {
  it("maps an empty template to empty-means-default fields", () => {
    const t: Template = { id: "a", name: "A", builtin: false, settings: {} };
    const form = templateToForm(t);
    expect(form).toEqual({
      name: "A",
      prePrompt: "",
      targetLang: "",
      displayMode: "",
      visibleOnly: false,
      pageModel: null,
      pageVariant: "",
      selectionModel: null,
      selectionVariant: "",
    });
    expect(formToSettings(form)).toEqual({});
  });

  it("round-trips a full template", () => {
    const t: Template = {
      id: "a",
      name: "A",
      builtin: false,
      settings: {
        prePrompt: "Be exact",
        targetLang: "de",
        displayMode: "bilingual",
        visibleOnly: true,
        pageModel: { providerID: "deepseek", id: "flash", variant: "low" },
        selectionModel: { providerID: "openai", id: "gpt" },
      },
    };
    const form = templateToForm(t);
    expect(form.pageModel).toEqual({ providerID: "deepseek", id: "flash" });
    expect(form.pageVariant).toBe("low");
    expect(form.selectionVariant).toBe("");
    expect(formToSettings(form)).toEqual(t.settings);
  });

  it("omits blank pre-prompt and keeps non-blank text untrimmed", () => {
    const form = { ...templateToForm({ id: "a", name: "A", builtin: false, settings: {} }) };
    expect(formToSettings({ ...form, prePrompt: "  \n " })).toEqual({});
    expect(formToSettings({ ...form, prePrompt: " x " })).toEqual({ prePrompt: " x " });
  });

  it("never pins a model when the model is inherited, whatever the effort", () => {
    const form = templateToForm({ id: "a", name: "A", builtin: false, settings: {} });
    expect(formToSettings({ ...form, pageVariant: "high" })).toEqual({});
    expect(formToSettings({ ...form, selectionVariant: "low" })).toEqual({});
  });

  it("does not mutate stored model refs", () => {
    const t: Template = {
      id: "a",
      name: "A",
      builtin: false,
      settings: { pageModel: { providerID: "p", id: "m", variant: "low" } },
    };
    const form = templateToForm(t);
    form.pageVariant = "high";
    expect(t.settings.pageModel?.variant).toBe("low");
  });
});

describe("sameForm", () => {
  it("detects changes", () => {
    const form = templateToForm({ id: "a", name: "A", builtin: false, settings: {} });
    expect(sameForm(form, { ...form })).toBe(true);
    expect(sameForm(form, { ...form, name: "B" })).toBe(false);
    expect(sameForm(form, { ...form, pageModel: { providerID: "p", id: "m" } })).toBe(false);
  });
});

describe("modelVariants", () => {
  const models = [model("deepseek", "flash", ["none", "low"]), model("openai", "gpt", ["high"])];
  it("lists variants of the chosen model only", () => {
    expect(modelVariants(models, { providerID: "openai", id: "gpt" })).toEqual(["high"]);
    expect(modelVariants(models, null)).toEqual([]);
    expect(modelVariants(models, { providerID: "x", id: "y" })).toEqual([]);
  });
});

describe("reconcileVariant", () => {
  const models = [
    model("deepseek", "flash", ["none", "low"]),
    model("openai", "gpt", ["high"]),
    model("qwen", "plain", []),
  ];
  const flash = { providerID: "deepseek", id: "flash" };
  it("keeps a supported variant and the model default", () => {
    expect(reconcileVariant(models, flash, "low")).toBe("low");
    expect(reconcileVariant(models, flash, "")).toBe("");
  });
  it("replaces an unsupported variant with none or the model default", () => {
    expect(reconcileVariant(models, flash, "high")).toBe("none");
    expect(reconcileVariant(models, { providerID: "openai", id: "gpt" }, "low")).toBe("");
    expect(reconcileVariant(models, { providerID: "qwen", id: "plain" }, "low")).toBe("");
  });
  it("clears the variant when the model is inherited", () => {
    expect(reconcileVariant(models, null, "low")).toBe("");
  });
});

describe("ruleError", () => {
  const rules: SiteRule[] = [
    { id: "1", pattern: "example.com", templateId: "t" },
    { id: "2", pattern: "*.Wikipedia.org", templateId: "t" },
  ];
  it("accepts a valid new pattern", () => {
    expect(ruleError("news.example.org", rules)).toBeNull();
    expect(ruleError("*.example.org", rules)).toBeNull();
  });
  it("rejects empty and invalid patterns", () => {
    expect(ruleError("  ", rules)).toBe("empty");
    expect(ruleError("http://example.com", rules)).toBe("invalid");
    expect(ruleError("a b", rules)).toBe("invalid");
  });
  it("rejects duplicates ignoring case and spaces", () => {
    expect(ruleError(" EXAMPLE.com ", rules)).toBe("duplicate");
    expect(ruleError("*.wikipedia.org", rules)).toBe("duplicate");
  });
  it("allows keeping the pattern of the rule being edited", () => {
    expect(ruleError("example.com", rules, "1")).toBeNull();
    expect(ruleError("*.wikipedia.org", rules, "1")).toBe("duplicate");
  });
});

describe("rulesUsing", () => {
  it("counts rules bound to a template", () => {
    const rules: SiteRule[] = [
      { id: "1", pattern: "a.com", templateId: "t" },
      { id: "2", pattern: "b.com", templateId: "u" },
      { id: "3", pattern: "c.com", templateId: "t" },
    ];
    expect(rulesUsing(rules, "t")).toBe(2);
    expect(rulesUsing(rules, "zzz")).toBe(0);
  });
});

describe("filterTemplates", () => {
  const list: Template[] = [
    { id: "1", name: "Plain", builtin: true, settings: {} },
    { id: "2", name: "Technical text", builtin: false, settings: {} },
  ];
  it("matches the displayed name case-insensitively", () => {
    const nameOf = (t: Template) => (t.builtin ? "Обычный перевод" : t.name);
    expect(filterTemplates(list, " TECH ", nameOf).map((t) => t.id)).toEqual(["2"]);
    expect(filterTemplates(list, "обыч", nameOf).map((t) => t.id)).toEqual(["1"]);
    expect(filterTemplates(list, "", nameOf)).toHaveLength(2);
  });
});

describe("groupByProvider", () => {
  it("keeps model order inside providers", () => {
    const groups = groupByProvider([model("a", "1"), model("b", "2"), model("a", "3")]);
    expect(groups.map(([p, l]) => [p, l.map((m) => m.id)])).toEqual([
      ["a", ["1", "3"]],
      ["b", ["2"]],
    ]);
  });
});

describe("isFirefoxAgent", () => {
  it("detects Firefox", () => {
    expect(isFirefoxAgent("Mozilla/5.0 (X11; Linux) Gecko/20100101 Firefox/130.0")).toBe(true);
    expect(isFirefoxAgent("Mozilla/5.0 Chrome/130.0 Safari/537.36")).toBe(false);
  });
});
