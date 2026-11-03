import type { Overlay } from "./overlay";

export type AnimationKind =
  | "none"
  | "fade"
  | "scramble"
  | "flap"
  | "typewriter"
  | "pen"
  | "wave"
  | "meteor";

export type TextChange = { node: Text; from: string; to: string };

// true = keep going
export type Frame = (now: number) => boolean;

export type { Overlay };

export type EffectContext = {
  block: Element;
  changes: TextChange[];
  bilingual: boolean;
  write(node: Text, value: string): boolean;
  overlay(): Overlay | null;
  now(): number;
  random(): number;
};

// Data captured before the translation is applied (for example, old text coordinates).
export type Prepared = unknown;

export type Effect = {
  kind: AnimationKind;
  heavy?: boolean;
  // Uses ctx.overlay(); finished on scroll and resize.
  usesOverlay?: boolean;
  before?(block: Element, opts: { bilingual: boolean }): Prepared;
  start(ctx: EffectContext, prepared: Prepared): Frame;
  finish(ctx: EffectContext): void;
};
