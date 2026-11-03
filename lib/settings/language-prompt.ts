import type { GlobalSettings, ProfileOverride, ProfileOverrides } from "./types";

export const GENERIC_PROFILE = "generic";
export const MAX_PROFILE_TEXT = 20_000;

export function primaryLang(code: string): string {
  return (code.split(/[-_]/)[0] ?? "").toLowerCase();
}

export function autoProfile(targetLang: string, ids: readonly string[]): string {
  const own = primaryLang(targetLang);
  return ids.includes(own) ? own : GENERIC_PROFILE;
}

export function chosenProfile(choice: string, targetLang: string, ids: readonly string[]): string {
  return ids.includes(choice) ? choice : autoProfile(targetLang, ids);
}

export function isProfileModified(builtin: string, o: ProfileOverride | undefined): boolean {
  return o !== undefined && o.text.trim() !== builtin.trim();
}

export function isProfileOutdated(builtin: string, o: ProfileOverride | undefined): boolean {
  return o !== undefined && isProfileModified(builtin, o) && o.base.trim() !== builtin.trim();
}

export function profileText(builtin: string, o: ProfileOverride | undefined): string {
  return o !== undefined && isProfileModified(builtin, o) ? o.text : builtin;
}

export function languagePromptText(
  g: Pick<GlobalSettings, "languagePromptEnabled" | "languageProfile">,
  targetLang: string,
  builtins: ReadonlyMap<string, string>,
  overrides: ProfileOverrides,
): string {
  if (!g.languagePromptEnabled) return "";
  const id = chosenProfile(g.languageProfile, targetLang, [...builtins.keys()]);
  return profileText(builtins.get(id) ?? "", overrides[id]);
}
