import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setUiLang } from "../../../lib/i18n";
import { autoProfile } from "../../../lib/settings/language-prompt";
import {
  buttons,
  CONTRIBUTING_URL,
  createDrafts,
  editedProfile,
  noProfileText,
  normalizedChoice,
  profileLabel,
  showNoProfile,
  showOtherLang,
} from "../../../lib/ui/language-prompt-logic";

vi.mock("../../../lib/ui/i18n.svelte", async () => ({
  tr: (await import("../../../lib/i18n")).t,
}));

const IDS = ["ru", "pt", "generic"];

beforeEach(() => setUiLang("ru"));
afterEach(() => setUiLang("auto"));

describe("CONTRIBUTING_URL", () => {
  it("points to the language profiles section of the contributing guide", () => {
    expect(CONTRIBUTING_URL).toBe(
      "https://github.com/BrainRTP/byoglot-translator/blob/main/CONTRIBUTING.md#language-profiles",
    );
  });
});

describe("editedProfile", () => {
  it("shows the explicit profile", () => {
    expect(editedProfile("generic", "ru", IDS)).toBe("generic");
    expect(editedProfile("pt", "ru", IDS)).toBe("pt");
  });

  it("follows the target language on auto", () => {
    expect(editedProfile("auto", "ru", IDS)).toBe("ru");
    expect(editedProfile("auto", "pt-BR", IDS)).toBe("pt");
    expect(editedProfile("auto", "de", IDS)).toBe("generic");
  });

  it("treats an unknown profile as auto", () => {
    expect(editedProfile("xx", "ru", IDS)).toBe("ru");
  });
});

describe("buttons", () => {
  it("is idle without a draft and without a saved edit", () => {
    expect(buttons({ draft: "a", saved: "a", modified: false })).toEqual({
      save: false,
      discard: false,
      reset: false,
    });
  });

  it("offers reset for a saved edit without a draft", () => {
    expect(buttons({ draft: "a", saved: "a", modified: true })).toEqual({
      save: false,
      discard: false,
      reset: true,
    });
  });

  it("offers save and discard for a draft without a saved edit", () => {
    expect(buttons({ draft: "b", saved: "a", modified: false })).toEqual({
      save: true,
      discard: true,
      reset: false,
    });
  });

  it("shows all three for a saved edit with a draft", () => {
    expect(buttons({ draft: "b", saved: "a", modified: true })).toEqual({
      save: true,
      discard: true,
      reset: true,
    });
  });
});

describe("normalizedChoice", () => {
  it("keeps auto and a known profile id", () => {
    expect(normalizedChoice("auto", IDS)).toBe("auto");
    expect(normalizedChoice("pt", IDS)).toBe("pt");
    expect(normalizedChoice("generic", IDS)).toBe("generic");
  });

  it("turns an unknown id into auto", () => {
    expect(normalizedChoice("xx", IDS)).toBe("auto");
  });

  it("turns any id into auto when there are no profiles", () => {
    expect(normalizedChoice("ru", [])).toBe("auto");
    expect(normalizedChoice("auto", [])).toBe("auto");
  });
});

describe("profileLabel", () => {
  it("names a language profile in the interface language", () => {
    expect(profileLabel("ru")).toBe("Русский");
    setUiLang("en");
    expect(profileLabel("ru")).toBe("Russian");
  });

  it("names the generic profile from the dictionary", () => {
    expect(profileLabel("generic")).toBe("Общий");
    setUiLang("en");
    expect(profileLabel("generic")).toBe("Generic");
  });

  it("gives the auto caption for the global language", () => {
    expect(profileLabel(autoProfile("ru", IDS))).toBe("Русский");
    expect(profileLabel(autoProfile("de", IDS))).toBe("Общий");
  });
});

describe("showNoProfile", () => {
  it("shows only on auto for a language without a profile", () => {
    expect(showNoProfile("auto", "de", IDS)).toBe(true);
    expect(showNoProfile("auto", "ru", IDS)).toBe(false);
    expect(showNoProfile("auto", "pt-BR", IDS)).toBe(false);
  });

  it("hides for an explicit choice", () => {
    expect(showNoProfile("ru", "de", IDS)).toBe(false);
    expect(showNoProfile("generic", "de", IDS)).toBe(false);
  });

  it("treats an unknown choice as auto", () => {
    expect(showNoProfile("xx", "de", IDS)).toBe(true);
    expect(showNoProfile("xx", "ru", IDS)).toBe(false);
  });
});

describe("showOtherLang", () => {
  it("warns for an explicit profile of another language", () => {
    expect(showOtherLang("ru", "de")).toBe(true);
  });

  it("does not warn for the generic profile", () => {
    expect(showOtherLang("generic", "de")).toBe(false);
  });

  it("does not warn for the profile of the target language", () => {
    expect(showOtherLang("ru", "ru-RU")).toBe(false);
    expect(showOtherLang("ru", "ru")).toBe(false);
  });

  it("does not warn on auto", () => {
    expect(showOtherLang("auto", "de")).toBe(false);
  });
});

describe("noProfileText", () => {
  it("uses the genitive form in the Russian interface", () => {
    expect(noProfileText("de")).toBe("Для немецкого своего профиля пока нет, используется общий.");
    expect(noProfileText("he")).toBe("Для иврита своего профиля пока нет, используется общий.");
  });

  it("looks the form up by the primary language", () => {
    expect(noProfileText("de-AT")).toBe(
      "Для немецкого своего профиля пока нет, используется общий.",
    );
  });

  it("falls back to the language name for a code outside the table", () => {
    expect(noProfileText("fi")).toBe(
      "Для языка «Финский» своего профиля пока нет, используется общий.",
    );
  });

  it("uses the plain language name in the English interface", () => {
    setUiLang("en");
    expect(noProfileText("de")).toBe("There is no German profile yet, the generic one is used.");
    expect(noProfileText("fi")).toBe("There is no Finnish profile yet, the generic one is used.");
  });
});

describe("createDrafts", () => {
  it("keeps drafts per profile id across profile switches", () => {
    const drafts = createDrafts();
    drafts.set("ru", "my ru text");
    drafts.set("generic", "my generic text");
    expect(drafts.get("ru")).toBe("my ru text");
    expect(drafts.get("generic")).toBe("my generic text");
    expect(drafts.get("pt")).toBeUndefined();
  });

  it("drops one draft and keeps the others", () => {
    const drafts = createDrafts();
    drafts.set("ru", "a");
    drafts.set("pt", "b");
    drafts.drop("ru");
    expect(drafts.get("ru")).toBeUndefined();
    expect(drafts.get("pt")).toBe("b");
  });

  it("keeps an empty draft", () => {
    const drafts = createDrafts();
    drafts.set("ru", "");
    expect(drafts.get("ru")).toBe("");
  });

  it("does not share state between instances", () => {
    const a = createDrafts();
    const b = createDrafts();
    a.set("ru", "x");
    expect(b.get("ru")).toBeUndefined();
  });
});
