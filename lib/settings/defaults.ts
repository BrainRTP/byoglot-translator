import { LANGUAGE_CODES } from "./languages";
import type { GlobalSettings, Template } from "./types";

export const BUILTIN_TEMPLATE_ID = "builtin-default";

const BUILTIN_PRE_PROMPT =
  "Translate naturally, preserving meaning, tone and context. Keep names, code, numbers and product names as they are.";

export function builtinTemplate(): Template {
  return {
    id: BUILTIN_TEMPLATE_ID,
    name: "Plain translation",
    builtin: true,
    settings: { prePrompt: BUILTIN_PRE_PROMPT },
  };
}

export const DEFAULT_GLOBALS: GlobalSettings = {
  sourceLang: "auto",
  targetLang: "en",
  displayMode: "replace",
  animation: "wave",
  pageModel: null,
  selectionModel: null,
  defaultTemplateId: BUILTIN_TEMPLATE_ID,
  uiLang: "auto",
  languagePromptEnabled: true,
  languageProfile: "auto",
};

export function initialGlobals(browserLanguage: string | undefined): GlobalSettings {
  const primary = (browserLanguage ?? "").split(/[-_]/)[0]?.toLowerCase() ?? "";
  return { ...DEFAULT_GLOBALS, targetLang: LANGUAGE_CODES.includes(primary) ? primary : "en" };
}
