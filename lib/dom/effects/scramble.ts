import type { Effect, EffectContext } from "./types";

const FRAME_MS = 40;
const MIN_D = 600;
const MAX_D = 1800;
const EARLIEST = 0.15;

const LATIN_UP = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LATIN_LOW = "abcdefghijklmnopqrstuvwxyz";
const CYR_UP = "АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ";
const CYR_LOW = "абвгдежзийклмнопрстуфхцчшщъыьэюя";
const DIGITS = "0123456789";
const SYMBOLS = "#%&*+=?@$";

const LATIN = /^\p{Script=Latin}$/u;
const CYRILLIC = /^\p{Script=Cyrillic}$/u;
const DIGIT = /^\p{Nd}$/u;
// whitespace, combining marks and surrogate halves stay as they are
const FIXED = /^[\s\p{M}\ud800-\udfff]$/u;

type NodeState = {
  node: Text;
  to: string;
  // settle time per UTF-16 position, null = never scrambled
  settle: Array<number | null>;
  released: boolean;
};

type State = {
  t0: number;
  last: number;
  duration: number;
  nodes: NodeState[];
};

function duration(totalChars: number): number {
  return Math.min(MAX_D, Math.max(MIN_D, 400 + 6 * totalChars));
}

function glyphSet(ch: string): string {
  const lower = ch === ch.toLowerCase();
  if (LATIN.test(ch)) return lower ? LATIN_LOW : LATIN_UP;
  if (CYRILLIC.test(ch)) return lower ? CYR_LOW : CYR_UP;
  if (DIGIT.test(ch)) return DIGITS;
  return SYMBOLS;
}

function pick(set: string, r: number): string {
  return set[Math.min(set.length - 1, Math.floor(r * set.length))] ?? "";
}

function render(ctx: EffectContext, ns: NodeState, elapsed: number): string {
  let out = "";
  for (let i = 0; i < ns.to.length; i++) {
    const ch = ns.to[i] as string;
    const at = ns.settle[i];
    out += at == null || elapsed >= at ? ch : pick(glyphSet(ch), ctx.random());
  }
  return out;
}

function paint(ctx: EffectContext, state: State, now: number) {
  const elapsed = now - state.t0;
  for (const ns of state.nodes) {
    if (ns.released) continue;
    if (!ctx.write(ns.node, render(ctx, ns, elapsed))) ns.released = true;
  }
}

export const scrambleEffect: Effect = {
  kind: "scramble",
  start(ctx) {
    let total = 0;
    for (const c of ctx.changes) total += c.to.length;
    const d = duration(total);
    const t0 = ctx.now();
    // settle times are drawn in document order across all nodes
    const nodes: NodeState[] = ctx.changes.map((c) => ({
      node: c.node,
      to: c.to,
      settle: Array.from({ length: c.to.length }, (_, i) =>
        FIXED.test(c.to[i] as string) ? null : d * (EARLIEST + (1 - EARLIEST) * ctx.random()),
      ),
      released: false,
    }));
    const state: State = { t0, last: t0, duration: d, nodes };
    paint(ctx, state, t0);
    return (now) => {
      if (now - state.t0 >= state.duration) {
        paint(ctx, state, state.t0 + state.duration);
        return false;
      }
      if (now - state.last < FRAME_MS) return true;
      state.last = now;
      paint(ctx, state, now);
      return true;
    };
  },
  finish(ctx) {
    // write() refuses nodes the page touched
    for (const c of ctx.changes) ctx.write(c.node, c.to);
  },
};
