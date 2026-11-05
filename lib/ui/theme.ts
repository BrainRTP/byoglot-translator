import type { ThemeChoice } from "../settings/types";

export function applyTheme(root: HTMLElement, choice: ThemeChoice): void {
  if (choice === "system") root.removeAttribute("data-theme");
  else root.dataset.theme = choice;
}
