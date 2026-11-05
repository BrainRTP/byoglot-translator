import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LANGUAGE_CODES } from "../../../lib/settings/languages";
import { BUILTIN_PROFILES, GENERIC_PROFILE, PROFILE_IDS } from "../../../lib/translate/profiles";

const STAND_DIR = join(process.cwd(), "tests/quality/prompts/lang");

function standVersions(stem: string): string[] {
  const pattern = new RegExp(`^${stem}-v\\d+\\.md$`);
  return readdirSync(STAND_DIR)
    .filter((name) => pattern.test(name))
    .map((name) => readFileSync(join(STAND_DIR, name), "utf8").trim());
}

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

  it("serves every profile as one of its versions on the stand", () => {
    for (const [id, text] of BUILTIN_PROFILES) {
      const stem = id === GENERIC_PROFILE ? "default" : id;
      const versions = standVersions(stem);
      expect(
        versions.length,
        `no tests/quality/prompts/lang/${stem}-v*.md for ${id}`,
      ).toBeGreaterThan(0);
      expect(versions.includes(text), `${id} matches none of ${stem}-v*.md`).toBe(true);
    }
  });
});
