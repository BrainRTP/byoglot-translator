import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LANGUAGE_CODES } from "../../../lib/settings/languages";
import { BUILTIN_PROFILES, GENERIC_PROFILE, PROFILE_IDS } from "../../../lib/translate/profiles";

describe("built-in profiles", () => {
  it("ships generic and ru", () => {
    expect(BUILTIN_PROFILES.has(GENERIC_PROFILE)).toBe(true);
    expect(BUILTIN_PROFILES.has("ru")).toBe(true);
  });

  it("names every profile after generic or a language code", () => {
    for (const id of BUILTIN_PROFILES.keys()) {
      expect(id === GENERIC_PROFILE || LANGUAGE_CODES.includes(id), id).toBe(true);
    }
  });

  it("keeps texts non-empty, bounded and free of frame markers", () => {
    for (const [id, text] of BUILTIN_PROFILES) {
      expect(text.length, id).toBeGreaterThan(0);
      expect(text.length, id).toBeLessThanOrEqual(8000);
      for (const marker of ["{{", "USER INSTRUCTIONS", "INPUT:", "JSON"]) {
        expect(text.includes(marker), `${id} contains ${marker}`).toBe(false);
      }
    }
  });

  it("has no U+0451 in ru", () => {
    expect(BUILTIN_PROFILES.get("ru")?.includes("\u0451")).toBe(false);
  });

  it("lists language profiles first and generic last", () => {
    expect(PROFILE_IDS.at(-1)).toBe(GENERIC_PROFILE);
    expect([...PROFILE_IDS].sort()).toEqual([...BUILTIN_PROFILES.keys()].sort());
    const languageIds = PROFILE_IDS.slice(0, -1);
    expect(languageIds).toEqual([...languageIds].sort());
  });

  it("serves ru as the trimmed ru-v4 file", () => {
    const file = readFileSync(join(process.cwd(), "tests/quality/prompts/lang/ru-v4.md"), "utf8");
    expect(BUILTIN_PROFILES.get("ru")).toBe(file.trim());
  });

  it("serves generic as the trimmed default-v1 file", () => {
    const file = readFileSync(
      join(process.cwd(), "tests/quality/prompts/lang/default-v1.md"),
      "utf8",
    );
    expect(BUILTIN_PROFILES.get(GENERIC_PROFILE)).toBe(file.trim());
  });
});
