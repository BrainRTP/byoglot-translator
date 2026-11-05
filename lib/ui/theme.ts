import type { GlobalSettings, ThemeChoice } from "../settings/types";

export function applyTheme(root: HTMLElement, choice: ThemeChoice): void {
  if (choice === "system") root.removeAttribute("data-theme");
  else root.dataset.theme = choice;
}

type Look = Pick<GlobalSettings, "theme" | "uiLang">;
const LOOK_KEY = "byoglot:look";

// a sync copy in localStorage lets a page apply theme and language before the first frame
export function rememberLook(g: Look): void {
  try {
    localStorage.setItem(LOOK_KEY, JSON.stringify({ theme: g.theme, uiLang: g.uiLang }));
  } catch {}
}

export function recallLook(): Look | null {
  try {
    return JSON.parse(localStorage.getItem(LOOK_KEY) ?? "null");
  } catch {
    return null;
  }
}
