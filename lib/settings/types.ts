import type { AnimationKind } from "../dom/effects/types";
import type { ModelRef } from "../opencode/types";

export type DisplayMode = "replace" | "bilingual";

export type TemplateSettings = {
  prePrompt?: string;
  targetLang?: string;
  displayMode?: DisplayMode;
  pageModel?: ModelRef;
  selectionModel?: ModelRef;
};

export type Template = {
  id: string;
  name: string;
  builtin: boolean;
  settings: TemplateSettings;
};

export type ThemeChoice = "system" | "light" | "dark";

export type GlobalSettings = {
  sourceLang: "auto" | string;
  targetLang: string;
  displayMode: DisplayMode;
  animation: AnimationKind;
  progressBar: boolean;
  pageModel: ModelRef | null;
  selectionModel: ModelRef | null;
  pinnedEffort: string | null;
  defaultTemplateId: string;
  uiLang: "auto" | "ru" | "en";
  languagePromptEnabled: boolean;
  languageProfile: "auto" | string;
  theme: ThemeChoice;
};

export type ProfileOverride = { text: string; base: string; savedAt: number };
export type ProfileOverrides = Record<string, ProfileOverride>;

export type SiteRule = { id: string; pattern: string; templateId: string };

export type EffectiveSettings = {
  templateId: string;
  prePrompt: string;
  sourceLang: string;
  targetLang: string;
  displayMode: DisplayMode;
  pageModel: ModelRef | null;
  selectionModel: ModelRef | null;
};
