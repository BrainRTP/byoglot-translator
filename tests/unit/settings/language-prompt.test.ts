import { describe, expect, it } from "vitest";
import {
  autoProfile,
  chosenProfile,
  isProfileModified,
  isProfileOutdated,
  languagePromptText,
  primaryLang,
  profileText,
} from "../../../lib/settings/language-prompt";
import type { ProfileOverride } from "../../../lib/settings/types";

const IDS = ["pt", "ru", "generic"];

function override(text: string, base: string): ProfileOverride {
  return { text, base, savedAt: 1 };
}

describe("primaryLang", () => {
  it("takes the primary subtag in lower case", () => {
    expect(primaryLang("pt-BR")).toBe("pt");
    expect(primaryLang("ZH_cn")).toBe("zh");
    expect(primaryLang("ru")).toBe("ru");
  });
});

describe("autoProfile", () => {
  it("picks the profile of the target language", () => {
    expect(autoProfile("ru", IDS)).toBe("ru");
  });

  it("falls back to generic when the language has no profile", () => {
    expect(autoProfile("de", IDS)).toBe("generic");
  });

  it("matches the primary subtag of a regional code", () => {
    expect(autoProfile("pt-BR", IDS)).toBe("pt");
  });
});

describe("chosenProfile", () => {
  it("resolves auto by the target language", () => {
    expect(chosenProfile("auto", "ru", IDS)).toBe("ru");
    expect(chosenProfile("auto", "de", IDS)).toBe("generic");
  });

  it("uses an explicit profile for any target language", () => {
    expect(chosenProfile("generic", "ru", IDS)).toBe("generic");
    expect(chosenProfile("ru", "de", IDS)).toBe("ru");
  });

  it("treats an unknown explicit id as auto", () => {
    expect(chosenProfile("xx", "ru", IDS)).toBe("ru");
    expect(chosenProfile("xx", "de", IDS)).toBe("generic");
  });
});

describe("profileText", () => {
  it("returns the builtin text without an override", () => {
    expect(profileText("builtin", undefined)).toBe("builtin");
  });

  it("returns the override text when it differs from the builtin", () => {
    expect(profileText("builtin", override("mine", "builtin"))).toBe("mine");
  });

  it("returns the builtin text when the override only differs in outer whitespace", () => {
    expect(profileText("builtin", override("  builtin\n", "old"))).toBe("builtin");
  });

  it("keeps an emptied override empty", () => {
    expect(profileText("builtin", override("", "builtin"))).toBe("");
  });
});

describe("isProfileModified", () => {
  it("is false without an override", () => {
    expect(isProfileModified("builtin", undefined)).toBe(false);
  });

  it("is false for an override equal to the builtin after trim", () => {
    expect(isProfileModified("builtin", override(" builtin ", "builtin"))).toBe(false);
  });

  it("is true for a different text", () => {
    expect(isProfileModified("builtin", override("mine", "builtin"))).toBe(true);
  });

  it("is true for an emptied override", () => {
    expect(isProfileModified("builtin", override("", "builtin"))).toBe(true);
  });
});

describe("isProfileOutdated", () => {
  it("is false without an override", () => {
    expect(isProfileOutdated("builtin", undefined)).toBe(false);
  });

  it("is false when the base matches the current builtin", () => {
    expect(isProfileOutdated("builtin", override("mine", " builtin "))).toBe(false);
  });

  it("is true when the base differs from the current builtin", () => {
    expect(isProfileOutdated("builtin", override("mine", "old builtin"))).toBe(true);
  });

  it("is false for an unmodified override even with another base", () => {
    expect(isProfileOutdated("builtin", override("builtin", "old builtin"))).toBe(false);
  });
});

describe("languagePromptText", () => {
  const builtins: ReadonlyMap<string, string> = new Map([
    ["ru", "ru builtin"],
    ["generic", "generic builtin"],
  ]);
  const on = { languagePromptEnabled: true, languageProfile: "auto" };

  it("returns an empty string when the toggle is off", () => {
    expect(languagePromptText({ ...on, languagePromptEnabled: false }, "ru", builtins, {})).toBe(
      "",
    );
  });

  it("returns the builtin text of the chosen profile", () => {
    expect(languagePromptText(on, "ru", builtins, {})).toBe("ru builtin");
    expect(languagePromptText(on, "de", builtins, {})).toBe("generic builtin");
  });

  it("returns the override of the chosen profile", () => {
    const overrides = { ru: override("my ru", "ru builtin") };
    expect(languagePromptText(on, "ru", builtins, overrides)).toBe("my ru");
  });

  it("follows an explicit profile choice", () => {
    const g = { languagePromptEnabled: true, languageProfile: "generic" };
    expect(languagePromptText(g, "ru", builtins, {})).toBe("generic builtin");
  });

  it("returns an empty string when the override is emptied", () => {
    const overrides = { ru: override("", "ru builtin") };
    expect(languagePromptText(on, "ru", builtins, overrides)).toBe("");
  });
});
