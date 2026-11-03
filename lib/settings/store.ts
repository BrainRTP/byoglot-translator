import { storage } from "wxt/utils/storage";
import type { Connection } from "../opencode/types";
import { builtinTemplate, initialGlobals } from "./defaults";
import type { EffectiveSettings, GlobalSettings, SiteRule, Template } from "./types";

export const connectionItem = storage.defineItem<Connection | null>("local:connection", {
  fallback: null,
});

export const globalsItem = storage.defineItem<GlobalSettings>("local:globals", {
  fallback: initialGlobals(globalThis.navigator?.language),
});

export const templatesItem = storage.defineItem<Template[]>("local:templates", {
  fallback: [builtinTemplate()],
});

export const siteRulesItem = storage.defineItem<SiteRule[]>("local:siteRules", {
  fallback: [],
});

export function tabSettings(tabId: number) {
  return storage.defineItem<EffectiveSettings | null>(`session:tab-${tabId}`, { fallback: null });
}

export function tabHostItem(tabId: number) {
  return storage.defineItem<string | null>(`session:tabhost-${tabId}`, { fallback: null });
}
