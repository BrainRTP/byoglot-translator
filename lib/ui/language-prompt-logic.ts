import { resolveLang } from "../i18n";
import {
  autoProfile,
  chosenProfile,
  GENERIC_PROFILE,
  primaryLang,
} from "../settings/language-prompt";
import { tr } from "./i18n.svelte";
import { languageGenitive, languageName } from "./languages";

export const CONTRIBUTING_URL =
  "https://github.com/BrainRTP/byoglot-translator/blob/main/CONTRIBUTING.md#language-profiles";

const AUTO = "auto";

export function normalizedChoice(choice: string, ids: readonly string[]): string {
  return choice === AUTO || ids.includes(choice) ? choice : AUTO;
}

export function editedProfile(choice: string, targetLang: string, ids: readonly string[]): string {
  return chosenProfile(choice, targetLang, ids);
}

export function buttons(i: { draft: string; saved: string; modified: boolean }): {
  save: boolean;
  discard: boolean;
  reset: boolean;
} {
  const dirty = i.draft !== i.saved;
  return { save: dirty, discard: dirty, reset: i.modified };
}

export function showNoProfile(choice: string, targetLang: string, ids: readonly string[]): boolean {
  return !ids.includes(choice) && autoProfile(targetLang, ids) === GENERIC_PROFILE;
}

export function showOtherLang(choice: string, targetLang: string): boolean {
  return choice !== AUTO && choice !== GENERIC_PROFILE && choice !== primaryLang(targetLang);
}

export function createDrafts(): {
  get(id: string): string | undefined;
  set(id: string, text: string): void;
  drop(id: string): void;
} {
  const drafts = new Map<string, string>();
  return {
    get: (id) => drafts.get(id),
    set: (id, text) => void drafts.set(id, text),
    drop: (id) => void drafts.delete(id),
  };
}

export function profileLabel(id: string): string {
  return id === GENERIC_PROFILE ? tr("opt.lp.generic") : languageName(id);
}

export function noProfileText(targetLang: string): string {
  const lang = primaryLang(targetLang);
  const genitive = languageGenitive(lang);
  if (genitive === null) return tr("opt.lp.noProfileOther", { name: languageName(lang) });
  return tr("opt.lp.noProfile", {
    lang: resolveLang() === "ru" ? genitive : languageName(lang),
  });
}
