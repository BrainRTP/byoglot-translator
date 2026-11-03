import { en } from "./en";
import { ru } from "./ru";

export type MessageKey = keyof typeof en;
export type UiLang = "auto" | "ru" | "en";

const dictionaries: Record<"ru" | "en", Record<MessageKey, string>> = { ru, en };
let uiLang: UiLang = "auto";

export function setUiLang(l: UiLang): void {
  uiLang = l;
}

export function resolveLang(): "ru" | "en" {
  if (uiLang !== "auto") return uiLang;
  return navigator.language.toLowerCase().startsWith("ru") ? "ru" : "en";
}

export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const template = dictionaries[resolveLang()][key];
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (m, name: string) =>
    name in params ? String(params[name]) : m,
  );
}

export function formatRetryAfter(ms: number): string {
  const totalMin = Math.max(0, Math.floor(ms / 60000));
  const hours = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  if (hours > 0) return `${hours} ${t("unit.h")} ${min} ${t("unit.min")}`;
  return `${Math.max(1, min)} ${t("unit.min")}`;
}
