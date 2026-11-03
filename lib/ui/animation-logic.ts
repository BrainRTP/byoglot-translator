import type { AnimationKind } from "../dom/effects/types";

export type Lang = "en" | "ru";

const STEP: Record<string, 1 | -1> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
};

/** Target of a radio-group key press, or null when the key is not a navigation key. */
export function radioMove(
  kinds: readonly AnimationKind[],
  current: AnimationKind,
  key: string,
): AnimationKind | null {
  if (kinds.length === 0) return null;
  if (key === "Home") return kinds[0] ?? null;
  if (key === "End") return kinds[kinds.length - 1] ?? null;
  const step = STEP[key];
  if (!step) return null;
  const at = kinds.indexOf(current);
  if (at < 0) return (step > 0 ? kinds[0] : kinds[kinds.length - 1]) ?? null;
  return kinds[(at + step + kinds.length) % kinds.length] ?? null;
}

/** Roving tabindex: the selected card, or the first one when the stored kind has no card. */
export function tabbableKind(
  kinds: readonly AnimationKind[],
  selected: AnimationKind,
): AnimationKind | undefined {
  return kinds.includes(selected) ? selected : kinds[0];
}

export function nextLang(shown: Lang): Lang {
  return shown === "ru" ? "en" : "ru";
}
