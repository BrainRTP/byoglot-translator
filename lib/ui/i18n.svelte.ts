import { type MessageKey, setUiLang, t, type UiLang } from "../i18n";

let version = $state(0);

/** Reactive wrapper: components re-render when the UI language changes. */
export function tr(key: MessageKey, params?: Record<string, string | number>): string {
  void version;
  return t(key, params);
}

export function changeUiLang(lang: UiLang): void {
  setUiLang(lang);
  version++;
}
