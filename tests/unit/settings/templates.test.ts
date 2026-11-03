import { describe, expect, it } from "vitest";
import { BUILTIN_TEMPLATE_ID, builtinTemplate } from "../../../lib/settings/defaults";
import {
  createTemplate,
  deleteTemplate,
  duplicateTemplate,
  resetBuiltin,
  updateTemplate,
} from "../../../lib/settings/templates";
import type { SiteRule } from "../../../lib/settings/types";

describe("templates", () => {
  it("builtin template has the agreed id and pre-prompt", () => {
    const t = builtinTemplate();
    expect(t.id).toBe("builtin-default");
    expect(t.builtin).toBe(true);
    expect(t.settings.prePrompt).toBe(
      "Translate naturally, preserving meaning, tone and context. Keep names, code, numbers and product names as they are.",
    );
  });

  it("createTemplate appends a new user template without mutating the input", () => {
    const list = [builtinTemplate()];
    const { list: next, template } = createTemplate(list, "Legal", { prePrompt: "Be formal" });
    expect(list).toHaveLength(1);
    expect(next).toHaveLength(2);
    expect(template.builtin).toBe(false);
    expect(template.id).not.toBe(BUILTIN_TEMPLATE_ID);
    expect(next[1]).toBe(template);
  });

  it("duplicateTemplate copies settings into an independent user template", () => {
    const { list, template } = createTemplate([builtinTemplate()], "A", {
      pageModel: { providerID: "p", id: "m", variant: "high" },
    });
    const { list: next, template: copy } = duplicateTemplate(list, template.id, "A copy");
    expect(next).toHaveLength(3);
    expect(copy.name).toBe("A copy");
    expect(copy.builtin).toBe(false);
    expect(copy.id).not.toBe(template.id);
    expect(copy.settings).toEqual(template.settings);
    expect(copy.settings.pageModel).not.toBe(template.settings.pageModel);
  });

  it("deleteTemplate removes the template and the rules pointing to it", () => {
    const { list, template } = createTemplate([builtinTemplate()], "A", {});
    const rules: SiteRule[] = [
      { id: "r1", pattern: "a.com", templateId: template.id },
      { id: "r2", pattern: "b.com", templateId: BUILTIN_TEMPLATE_ID },
    ];
    const res = deleteTemplate(list, rules, template.id);
    expect(res.list.map((t) => t.id)).toEqual([BUILTIN_TEMPLATE_ID]);
    expect(res.rules.map((r) => r.id)).toEqual(["r2"]);
  });

  it("deleteTemplate throws for the built-in template", () => {
    expect(() => deleteTemplate([builtinTemplate()], [], BUILTIN_TEMPLATE_ID)).toThrow();
  });

  it("updateTemplate patches name and settings; resetBuiltin restores the original", () => {
    const original = builtinTemplate();
    const updated = updateTemplate([original], BUILTIN_TEMPLATE_ID, {
      name: "Mine",
      settings: { prePrompt: "Custom" },
    });
    expect(updated[0]?.settings.prePrompt).toBe("Custom");
    expect(updated[0]?.name).toBe("Mine");
    expect(resetBuiltin(updated)).toEqual([original]);
  });

  it("updateTemplate throws for an unknown id", () => {
    expect(() => updateTemplate([builtinTemplate()], "nope", { name: "x" })).toThrow();
  });
});
