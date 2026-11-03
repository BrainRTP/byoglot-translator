import { storage } from "wxt/utils/storage";
import type { Connection } from "../opencode/types";
import { builtinTemplate, DEFAULT_GLOBALS, initialGlobals } from "./defaults";
import type { EffectiveSettings, GlobalSettings, SiteRule, Template } from "./types";

export const connectionItem = storage.defineItem<Connection | null>("local:connection", {
  fallback: null,
});

const rawGlobals = storage.defineItem<GlobalSettings>("local:globals", {
  fallback: initialGlobals(globalThis.navigator?.language),
});

// Stored globals from older versions may miss newer fields: fill them from defaults.
export const globalsItem = {
  async getValue(): Promise<GlobalSettings> {
    return { ...DEFAULT_GLOBALS, ...(await rawGlobals.getValue()) };
  },
  setValue: (value: GlobalSettings): Promise<void> => rawGlobals.setValue(value),
};

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
