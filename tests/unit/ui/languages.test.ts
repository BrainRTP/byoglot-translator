import { describe, expect, it } from "vitest";
import { LANGUAGE_CODES, languageGenitive } from "../../../lib/ui/languages";

describe("languageGenitive", () => {
  it("has a form for every language code", () => {
    for (const code of LANGUAGE_CODES) {
      const form = languageGenitive(code);
      expect(form, code).toBeTruthy();
    }
  });

  it("returns Russian genitive forms", () => {
    expect(languageGenitive("de")).toBe("немецкого");
    expect(languageGenitive("he")).toBe("иврита");
    expect(languageGenitive("hi")).toBe("хинди");
    expect(languageGenitive("zh")).toBe("китайского");
  });

  it("has no letter yo in any form", () => {
    for (const code of LANGUAGE_CODES) expect(languageGenitive(code)).not.toContain("\u0451");
  });

  it("returns null for a code outside the table", () => {
    expect(languageGenitive("fi")).toBeNull();
    expect(languageGenitive("pt-BR")).toBeNull();
    expect(languageGenitive("constructor")).toBeNull();
    expect(languageGenitive("")).toBeNull();
  });
});
