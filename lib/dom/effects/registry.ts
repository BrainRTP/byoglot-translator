import { fadeEffect } from "./fade";
import { flapEffect } from "./flap";
import { meteorEffect } from "./meteor";
import { noneEffect } from "./none";
import { penEffect } from "./pen";
import { scrambleEffect } from "./scramble";
import type { AnimationKind, Effect } from "./types";
import { typewriterEffect } from "./typewriter";
import { waveEffect } from "./wave";

const ORDER: AnimationKind[] = [
  "none",
  "fade",
  "scramble",
  "flap",
  "typewriter",
  "pen",
  "wave",
  "meteor",
];

export const registry: Partial<Record<AnimationKind, Effect>> = {
  none: noneEffect,
  fade: fadeEffect,
  scramble: scrambleEffect,
  flap: flapEffect,
  typewriter: typewriterEffect,
  pen: penEffect,
  wave: waveEffect,
  meteor: meteorEffect,
};

export function availableKinds(): AnimationKind[] {
  return ORDER.filter((kind) => registry[kind]);
}
