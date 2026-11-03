import { afterEach, describe, expect, it, vi } from "vitest";
import { formatRetryAfter, setUiLang, t } from "../../../lib/i18n";
import { en } from "../../../lib/i18n/en";
import { ru } from "../../../lib/i18n/ru";

afterEach(() => {
  vi.unstubAllGlobals();
  setUiLang("auto");
});

describe("i18n", () => {
  it("ru and en have the same keys", () => {
    expect(Object.keys(ru).sort()).toEqual(Object.keys(en).sort());
  });

  it("ru has no letter yo", () => {
    for (const v of Object.values(ru)) expect(v.toLowerCase()).not.toContain("\u0451");
  });

  it("has no em or en dashes", () => {
    for (const v of [...Object.values(ru), ...Object.values(en)])
      expect(v).not.toMatch(/[\u2014\u2013]/);
  });

  it("has animation keys in both languages", () => {
    for (const k of [
      "opt.nav.animation",
      "opt.anim.lead",
      "opt.anim.reduced",
      "opt.anim.group",
      "opt.anim.mode",
      "opt.anim.repeat",
      "opt.anim.scene",
      "anim.none",
      "anim.fade",
      "anim.scramble",
      "anim.flap",
      "anim.typewriter",
      "anim.pen",
      "anim.wave",
      "anim.meteor",
      "anim.none.desc",
      "anim.fade.desc",
      "anim.scramble.desc",
      "anim.flap.desc",
      "anim.typewriter.desc",
      "anim.pen.desc",
      "anim.wave.desc",
      "anim.meteor.desc",
    ]) {
      expect(en).toHaveProperty(k);
      expect(ru).toHaveProperty(k);
    }
  });

  it("includes all error keys", () => {
    for (const k of [
      "offline",
      "unauthorized",
      "rate_limit",
      "provider_auth",
      "provider_error",
      "bad_response",
      "incompatible",
      "no_model",
    ]) {
      expect(en).toHaveProperty(`error.${k}`);
      expect(ru).toHaveProperty(`error.${k}`);
    }
  });

  it("formats retry-after in the selected language", () => {
    setUiLang("ru");
    expect(formatRetryAfter(72020000)).toBe("20 ч 0 мин");
    expect(t("error.rate_limit", { time: formatRetryAfter(72020000) })).toContain("20 ч");
    setUiLang("en");
    expect(formatRetryAfter(72020000)).toBe("20 h 0 min");
    expect(formatRetryAfter(30_000)).toBe("1 min");
  });

  it("auto picks ru for ru browsers and en otherwise", () => {
    vi.stubGlobal("navigator", { language: "ru-RU" });
    setUiLang("auto");
    expect(t("selection.copy")).toBe(ru["selection.copy"]);
    vi.stubGlobal("navigator", { language: "de-DE" });
    expect(t("selection.copy")).toBe(en["selection.copy"]);
  });

  it("explicit language overrides the browser", () => {
    vi.stubGlobal("navigator", { language: "ru-RU" });
    setUiLang("en");
    expect(t("selection.copy")).toBe("Copy");
  });
});
